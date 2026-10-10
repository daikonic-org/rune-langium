// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { AstUtils, type AstNode } from 'langium';
import {
  getNodeSourceRegion,
  getFunctionImplementationRegion,
  isCondition,
  isRosettaFunction
} from '@rune-langium/core';
import type { EmittedProjection, ProjectionSubject } from './types.js';

/** Record original source identity alongside authoritative generated text. */
export function recordedProjection(
  node: AstNode,
  code: string,
  kind: EmittedProjection['kind'],
  body?: string
): EmittedProjection | undefined {
  const sourceNode = kind === 'condition' && isCondition(node) ? node.expression : node;
  let document, region;
  try {
    document = AstUtils.getDocument(sourceNode);
    region = getNodeSourceRegion(sourceNode);
    if (kind === 'function' && isRosettaFunction(sourceNode)) {
      region = { ...region, to: getFunctionImplementationRegion(sourceNode, document.textDocument.getText()).to };
    }
  } catch {
    return undefined;
  }
  const serialized = sourceNode as AstNode & {
    $textRegion?: { range?: { start: { line: number; character: number } } };
  };
  const start =
    sourceNode.$cstNode?.range.start ??
    serialized.$textRegion?.range?.start ??
    document.textDocument.positionAt(region.from);
  const uri = document.uri.toString();
  const bodyNode = isRosettaFunction(sourceNode)
    ? [...sourceNode.shortcuts, ...sourceNode.conditions, ...sourceNode.operations, ...sourceNode.postConditions][0]
    : sourceNode;
  const bodyStart =
    bodyNode?.$cstNode?.range.start ??
    (bodyNode as (AstNode & { $textRegion?: { range?: { start: { line: number; character: number } } } }) | undefined)
      ?.$textRegion?.range?.start ??
    document.textDocument.positionAt(
      isRosettaFunction(sourceNode)
        ? getFunctionImplementationRegion(sourceNode, document.textDocument.getText()).from
        : region.from
    );
  return {
    kind,
    source: { uri, region },
    code,
    sourceMap: [{ outputLine: 0, sourceUri: uri, sourceLine: start.line + 1, sourceChar: start.character + 1 }],
    ...(body !== undefined
      ? {
          body: {
            code: body,
            sourceMap: [
              { outputLine: 0, sourceUri: uri, sourceLine: bodyStart.line + 1, sourceChar: bodyStart.character + 1 }
            ]
          }
        }
      : {})
  };
}

export function findProjectionFragment(
  projections: readonly EmittedProjection[],
  subject: ProjectionSubject,
  kind: EmittedProjection['kind']
): EmittedProjection | undefined {
  return projections.find(
    (entry) =>
      entry.kind === kind &&
      entry.source.uri === subject.uri &&
      (kind === 'condition'
        ? entry.source.region.from === subject.region.from && entry.source.region.to === subject.region.to
        : entry.source.region.from <= subject.region.from && entry.source.region.to >= subject.region.to)
  );
}
