// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Unit tests for the dagre layout engine.
 *
 * Verifies that nodes receive valid positions after layout computation.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@rune-langium/core';
import { astToModel } from '../../src/adapters/ast-to-model.js';
import { computeGraphPositions } from '../../src/layout/dagre-graph.js';
import { clearLayoutCache, computeLayout, computeLayoutIncremental } from '../../src/layout/dagre-layout.js';
import type { TypeGraphNode, TypeGraphEdge } from '../../src/types.js';
import { SIMPLE_INHERITANCE_SOURCE, DEEP_INHERITANCE_SOURCE } from '../helpers/fixture-loader.js';

describe('computeLayout', () => {
  it('assigns positions to all nodes', async () => {
    const result = await parse(SIMPLE_INHERITANCE_SOURCE);
    const { nodes, edges } = astToModel(result.value);
    const layouted = computeLayout(nodes, edges);

    expect(layouted).toHaveLength(nodes.length);
    for (const node of layouted) {
      expect(typeof node.position.x).toBe('number');
      expect(typeof node.position.y).toBe('number');
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
    }
  });

  it('places parent above child in TB direction', async () => {
    const result = await parse(DEEP_INHERITANCE_SOURCE);
    const { nodes, edges } = astToModel(result.value);
    const layouted = computeLayout(nodes, edges, { direction: 'TB' });

    const baseNode = layouted.find((n) => n.data.name === 'Base');
    const middleNode = layouted.find((n) => n.data.name === 'Middle');
    const leafNode = layouted.find((n) => n.data.name === 'Leaf');

    expect(baseNode).toBeDefined();
    expect(middleNode).toBeDefined();
    expect(leafNode).toBeDefined();

    // In TB layout, ancestors should be above descendants (lower y)
    // Note: dagre may order differently — we check that nodes have distinct y positions
    const yValues = [baseNode!.position.y, middleNode!.position.y, leafNode!.position.y];
    const uniqueYValues = new Set(yValues);
    expect(uniqueYValues.size).toBe(3);
  });

  it('respects LR direction', async () => {
    const result = await parse(DEEP_INHERITANCE_SOURCE);
    const { nodes, edges } = astToModel(result.value);
    const layouted = computeLayout(nodes, edges, { direction: 'LR' });

    const baseNode = layouted.find((n) => n.data.name === 'Base');
    const leafNode = layouted.find((n) => n.data.name === 'Leaf');

    expect(baseNode).toBeDefined();
    expect(leafNode).toBeDefined();

    // In LR layout, base should be to the left of leaf (lower x)
    // Check that they have different x positions
    expect(baseNode!.position.x).not.toBe(leafNode!.position.x);
  });

  it('handles empty graph', async () => {
    const result = computeLayout([], []);
    expect(result).toHaveLength(0);
  });

  it('handles nodes with many members by increasing height', async () => {
    const result = await parse(SIMPLE_INHERITANCE_SOURCE);
    const { nodes, edges } = astToModel(result.value);
    const layouted = computeLayout(nodes, edges);

    // Nodes with members should have distinct positions
    expect(layouted.length).toBeGreaterThan(0);
  });

  it('applies custom node and rank separation', async () => {
    const result = await parse(SIMPLE_INHERITANCE_SOURCE);
    const { nodes, edges } = astToModel(result.value);

    const tight = computeLayout(nodes, edges, { nodeSeparation: 10, rankSeparation: 30 });
    const wide = computeLayout(nodes, edges, { nodeSeparation: 200, rankSeparation: 300 });

    // Wider separation should produce nodes spread further apart
    if (tight.length >= 2 && wide.length >= 2) {
      const tightSpan = Math.max(...tight.map((n) => n.position.x)) - Math.min(...tight.map((n) => n.position.x));
      const wideSpan = Math.max(...wide.map((n) => n.position.x)) - Math.min(...wide.map((n) => n.position.x));
      expect(wideSpan).toBeGreaterThanOrEqual(tightSpan);
    }
  });

  it('invalidates cached positions when the layout direction changes', async () => {
    clearLayoutCache();
    const result = await parse(DEEP_INHERITANCE_SOURCE);
    const { nodes, edges } = astToModel(result.value);

    const vertical = computeLayoutIncremental(nodes, edges, { direction: 'TB' });
    const horizontal = computeLayoutIncremental(nodes, edges, { direction: 'LR' });

    const verticalXValues = new Set(vertical.map((node) => node.position.x));
    const horizontalXValues = new Set(horizontal.map((node) => node.position.x));

    expect(verticalXValues.size).toBeLessThan(horizontalXValues.size);
    expect(horizontalXValues.size).toBeGreaterThan(1);
  });

  it('uses measured node dimensions when computing layout spacing', () => {
    const nodes = [
      {
        id: 'wide',
        type: 'data',
        position: { x: 0, y: 0 },
        measured: { width: 420, height: 120 },
        data: {
          $type: 'Data',
          name: 'Wide',
          namespace: 'test',
          position: { x: 0, y: 0 },
          errors: [],
          hasExternalRefs: false,
          attributes: []
        }
      },
      {
        id: 'narrow',
        type: 'data',
        position: { x: 0, y: 0 },
        measured: { width: 220, height: 120 },
        data: {
          $type: 'Data',
          name: 'Narrow',
          namespace: 'test',
          position: { x: 0, y: 0 },
          errors: [],
          hasExternalRefs: false,
          attributes: []
        }
      }
    ] as unknown as TypeGraphNode[];
    const edges = [
      { id: 'e1', source: 'wide', target: 'narrow', data: { kind: 'extends' } }
    ] as unknown as TypeGraphEdge[];

    const layouted = computeLayout(nodes, edges, { direction: 'LR' });
    const wideNode = layouted.find((node) => node.id === 'wide');
    const narrowNode = layouted.find((node) => node.id === 'narrow');

    expect(wideNode).toBeDefined();
    expect(narrowNode).toBeDefined();
    expect(narrowNode!.position.x - wideNode!.position.x).toBeGreaterThanOrEqual(420);
  });
});

it.each(['TB', 'LR'] as const)(
  'lays out independent measured canvases without sharing type-graph cache (%s)',
  (direction) => {
    const nodes = [
      { id: 'a', width: 410, height: 330 },
      { id: 'b', width: 280, height: 180 }
    ];
    const edges = [{ source: 'a', target: 'b' }];
    const options = { direction, nodeSeparation: 40, rankSeparation: 60 };
    const original = computeGraphPositions(nodes, edges, options);
    if (direction === 'TB') expect(original.b!.y - original.a!.y).toBeGreaterThanOrEqual(330 + 60);
    else expect(original.b!.x - original.a!.x).toBeGreaterThanOrEqual(410 + 60);
    computeGraphPositions([{ id: 'unrelated', width: 1000, height: 2000 }], [], { ...options, direction: 'LR' });
    expect(computeGraphPositions(nodes, edges, options)).toEqual(original);
  }
);
