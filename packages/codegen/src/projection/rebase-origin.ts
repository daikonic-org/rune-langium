// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { AstUtils, DefaultAstNodeLocator, type AstNode } from 'langium';
import { getNodeSourceRegion, parseExpression, type RosettaExpression } from '@rune-langium/core';
import { treesEquivalent } from '../emit/rosetta/expression-tree-equivalence.js';
import type { ProjectionOrigin } from './types.js';

const locator = new DefaultAstNodeLocator();

/** Stable within the captured expression, independently of its owning document. */
export function projectionNodePath(root: AstNode, node: AstNode): string {
  const rootPath = locator.getAstNodePath(root);
  const path = locator.getAstNodePath(node);
  if (node !== root && !path.startsWith(`${rootPath}/`))
    throw new Error('The projection fragment is outside its expression.');
  return path.slice(rootPath.length);
}

/** Restore source coordinates without re-rendering linked spellings or callback bindings. */
export function rebaseProjectionOrigin(expression: RosettaExpression, origin: ProjectionOrigin): ProjectionOrigin {
  const original = parseExpression(origin.rune);
  if (original.hasErrors || !treesEquivalent(original.value, expression))
    throw new Error('The projection origin no longer matches the captured Rune expression.');
  if (!expression.$cstNode) throw new Error('The captured Rune expression has no source coordinates.');
  const root = getNodeSourceRegion(expression);
  const rune = expression.$cstNode.text;
  const paths =
    origin.fragmentPaths ??
    origin.fragments.map(({ from, to, ...fragment }) => {
      // Older origins can still be rebased when their original CST ranges are unambiguous.
      const start = getNodeSourceRegion(original.value).from;
      const nodes = AstUtils.streamAst(original.value)
        .filter((node) => {
          const region = getNodeSourceRegion(node);
          return node.$type === fragment.kind && region.from - start === from && region.to - start === to;
        })
        .toArray();
      if (nodes.length !== 1) throw new Error('The projection fragment has no unique source origin. Reopen the draft.');
      return { ...fragment, path: projectionNodePath(original.value, nodes[0]!) };
    });
  return {
    ...origin,
    rune,
    fragments: paths.map(({ path, ...fragment }) => {
      const node = locator.getAstNode(expression, path);
      if (!node?.$cstNode || node.$type !== fragment.kind)
        throw new Error('The projection fragment no longer matches the captured Rune expression.');
      const region = getNodeSourceRegion(node);
      const from = region.from - root.from;
      const to = region.to - root.from;
      if (from < 0 || to > rune.length || to <= from)
        throw new Error('The projection fragment is outside the captured source.');
      return { ...fragment, from, to };
    })
  };
}
