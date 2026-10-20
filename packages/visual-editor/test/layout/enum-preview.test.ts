// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { layoutStructureGraph } from '../../src/layout/structure-layout.js';
import { estimateNodeHeight } from '../../src/layout/node-dimensions.js';
import type { StructureEnumNode } from '../../src/types/structure-view.js';
import type { TypeGraphNode } from '../../src/types.js';

describe('bounded enum geometry', () => {
  it('keeps thousands of undisplayed members out of both layout estimates without changing model values', () => {
    const values = Array.from({ length: 1000 }, (_, i) => `V${i}`);
    const node: StructureEnumNode = { id: 'Status', kind: 'enum', name: 'Status', namespaceUri: 'demo', values };
    const result = layoutStructureGraph({ rootNodeId: 'Status', nodes: new Map([['Status', node]]) });
    expect(result.nodes[0]!.style!.height).toBeLessThan(400);
    expect(result.nodes[0]!.data.values).toHaveLength(1000);
    expect(values).toHaveLength(1000);
    const graph = { type: 'enum', data: { enumValues: values.map((name) => ({ name })) } } as unknown as TypeGraphNode;
    expect(estimateNodeHeight(graph)).toBeLessThan(400);
    expect(
      estimateNodeHeight({ ...graph, type: 'data', data: { attributes: values } } as unknown as TypeGraphNode)
    ).toBeGreaterThan(20000);
  });
});
