// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { FlatTreeRow, SegmentNode } from './namespace-tree.js';

export const NAMESPACE_TREE_STEP = 8;
export const NAMESPACE_TREE_MAX_DEPTH = 5;
export const NAMESPACE_TREE_INDENT_BASE = 8;

/** Bound visual indentation; canonical depth and identity never change. */
export function namespaceTreeIndent(depth: number): number {
  return NAMESPACE_TREE_INDENT_BASE + Math.min(Math.max(depth, 0), NAMESPACE_TREE_MAX_DEPTH) * NAMESPACE_TREE_STEP;
}

/** Re-root a compacted tree, including ancestors hidden inside compressed paths. */
export function namespaceTreeScope(roots: SegmentNode[], path: string | null): SegmentNode[] {
  if (path === null) return roots;
  for (const node of roots) {
    if (node.fullPath === path)
      return [{ ...node, segment: node.fullPath.slice(node.fullPath.lastIndexOf('.') + 1) || node.segment }];
    if (node.fullPath.startsWith(`${path}.`)) {
      return [{ ...node, segment: node.fullPath.slice(path.length + 1) }];
    }
    const found = namespaceTreeScope(node.children, path);
    if (found.length) return found;
  }
  return [];
}

export interface NamespaceTypeLabel {
  qualifier: string;
  fullLabel: string;
}

/** Qualify colliding names using namespaces, then kinds, then actual declaration IDs. */
export function namespaceTypeLabels(roots: SegmentNode[], showNamespace: boolean): Map<string, NamespaceTypeLabel> {
  const groups = new Map<string, Extract<FlatTreeRow, { kind: 'type' }>[]>();
  const collect = (nodes: SegmentNode[]) => {
    for (const node of nodes) {
      for (const type of node.types) {
        const row: Extract<FlatTreeRow, { kind: 'type' }> = {
          kind: 'type',
          nodeId: type.nodeId,
          name: type.name,
          namespace: node.fullPath,
          typeKind: type.kind,
          hidden: false
        };
        const group = groups.get(type.name) ?? [];
        group.push(row);
        groups.set(type.name, group);
      }
      collect(node.children);
    }
  };
  collect(roots);
  const labels = new Map<string, NamespaceTypeLabel>();
  for (const group of groups.values()) {
    for (const row of group) {
      let qualifier = '';
      if (showNamespace || group.length > 1) {
        const parts = row.namespace.split('.');
        let length = 1;
        while (
          length < parts.length &&
          group.some(
            (other) =>
              other.namespace !== row.namespace &&
              other.namespace.split('.').slice(-length).join('.') === parts.slice(-length).join('.')
          )
        )
          length++;
        qualifier = parts.slice(-length).join('.') || '(default)';
        const sameNamespace = group.filter((other) => other.namespace === row.namespace);
        if (sameNamespace.length > 1) qualifier += ` · ${row.typeKind}`;
        if (sameNamespace.some((other) => other.nodeId !== row.nodeId && other.typeKind === row.typeKind))
          qualifier += ` · ${row.nodeId}`;
      }
      labels.set(row.nodeId, {
        qualifier,
        fullLabel: `${row.namespace ? `${row.namespace}.` : ''}${row.name} [${row.typeKind}] — ${row.nodeId}`
      });
    }
  }
  return labels;
}
