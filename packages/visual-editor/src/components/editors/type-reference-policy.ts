// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { AST_TYPE_TO_NODE_TYPE } from '../../adapters/model-helpers.js';
import { TYPE_DECLARATION_KINDS } from '../../store/node-projection.js';
import { TYPE_REF_KINDS, type TypeRefPayload } from '../../types/structure-view.js';
import type { TypeKind } from '../../types.js';

export const DEFAULT_REFERENCE_KINDS = new Set([
  ...TYPE_DECLARATION_KINDS.map((kind) => AST_TYPE_TO_NODE_TYPE[kind]),
  'builtin'
]);

/** Picking and dropping use the same declaration-kind policy, including explicit function-parent filters. */
export function referenceDropKinds(
  disabled = false,
  filterKinds?: Array<TypeKind | 'builtin'>
): TypeRefPayload['kind'][] {
  if (disabled) return [];
  const kinds = filterKinds?.length ? new Set(filterKinds) : DEFAULT_REFERENCE_KINDS;
  return TYPE_REF_KINDS.filter((kind) =>
    kinds.has(
      kind === 'BasicType' ? 'basicType' : kind === 'TypeAlias' ? 'typeAlias' : (kind.toLowerCase() as TypeKind)
    )
  );
}
