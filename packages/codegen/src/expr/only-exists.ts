// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import {
  isChoiceOption,
  isListLiteral,
  isRosettaFeatureCall,
  isRosettaSymbolReference,
  type RosettaExpression,
  type RosettaOnlyExistsExpression
} from '@rune-langium/core';
import { expressionType, featureName, typeFeatures } from './navigation.js';
import type { ExpressionTranspilerContext } from './transpiler.js';
import { treesEquivalent } from '../emit/rosetta/expression-tree-equivalence.js';
import { renderPresence } from './presence.js';

/** Shared parent/field selection; emitters own their target predicate syntax. */
export function onlyExistsSelection(
  expr: RosettaOnlyExistsExpression,
  rootAttributes: readonly string[],
  render: (node: RosettaExpression) => string
) {
  const args = expr.args.length
    ? expr.args
    : isListLiteral(expr.argument)
      ? expr.argument.elements
      : expr.argument
        ? [expr.argument]
        : [];
  if (!args.length) return undefined;
  const first = args[0]!;
  const parent = isRosettaFeatureCall(first) ? first.receiver : undefined;
  const names: string[] = [];
  for (const arg of args) {
    if (parent && isRosettaFeatureCall(arg) && arg.receiver && treesEquivalent(arg.receiver, parent))
      names.push(isChoiceOption(arg.feature?.ref) ? featureName(arg.feature.ref) : (arg.feature?.$refText ?? ''));
    else if (!parent && isRosettaSymbolReference(arg)) names.push(arg.symbol.$refText);
    else return undefined;
  }
  const attributes = parent ? typeFeatures(expressionType(parent)).map(featureName) : rootAttributes;
  const allowed = new Set(names);
  const parentText = parent ? render(parent) : undefined;
  return { parent, parentText, attributes, forbidden: attributes.filter((name) => !allowed.has(name)) };
}

export function renderOnlyExists(
  expr: RosettaOnlyExistsExpression,
  ctx: ExpressionTranspilerContext,
  render: (node: RosettaExpression) => string,
  renderAttribute: (name: string) => string
): string | undefined {
  const selected = onlyExistsSelection(expr, [...ctx.attributeTypes.keys()], render);
  if (!selected) return undefined;
  const { parent, parentText, forbidden } = selected;
  const access = (name: string) => (parent ? `__parent?.[${JSON.stringify(name)}]` : renderAttribute(name));
  const checks = forbidden.map(
    (name) => `(${renderPresence(access(name), undefined, undefined, true, ctx.emitMode.startsWith('ts-'))})`
  );
  const predicate = checks.join(' && ') || 'true';
  return parent ? `((__parent) => ${predicate})(${parentText})` : `(${predicate})`;
}
