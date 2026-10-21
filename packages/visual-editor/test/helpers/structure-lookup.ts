// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { StructureNode } from '../../src/types/structure-view.js';

export function findByCanonicalId(
  nodes: ReadonlyMap<string, StructureNode>,
  canonicalId: string
): StructureNode | undefined {
  for (const node of nodes.values()) {
    if (node.id === canonicalId) return node;
  }
  return undefined;
}
export function findAllByCanonicalId(nodes: ReadonlyMap<string, StructureNode>, canonicalId: string): StructureNode[] {
  const out: StructureNode[] = [];
  for (const node of nodes.values()) {
    if (node.id === canonicalId) out.push(node);
  }
  return out;
}
