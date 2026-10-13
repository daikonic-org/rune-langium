// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { AstUtils, type AstNode } from 'langium';
import { isAnnotationRef, isRosettaModel } from '../generated/ast.js';

export interface AnnotationDefinitionIdentity {
  name: string;
  namespace: string;
}

/** Scope facts from the actual linked references, without rebuilding import/name resolution. */
export function getAnnotationDefinitions(owner: AstNode): Readonly<Record<string, AnnotationDefinitionIdentity>> {
  const definitions: Record<string, AnnotationDefinitionIdentity> = Object.create(null);
  for (const node of AstUtils.streamAst(owner)) {
    if (!isAnnotationRef(node)) continue;
    const target = node.annotation.ref;
    const model = target?.$container;
    if (target && isRosettaModel(model) && typeof model.name === 'string')
      definitions[node.annotation.$refText] = { name: target.name, namespace: model.name };
  }
  return definitions;
}
