// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { TypeGraphEdge } from '../types.js';

/** Child-to-parent lookup for data and enum inheritance; reference edges are excluded. */
export function buildInheritanceMap(edges: TypeGraphEdge[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const edge of edges) {
    if (edge.data?.kind === 'extends' || edge.data?.kind === 'enum-extends') {
      map.set(edge.source, edge.target);
    }
  }
  return map;
}
