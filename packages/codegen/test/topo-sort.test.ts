// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect } from 'vitest';
import { topoSort, topoSortComponents } from '../src/topo-sort.js';
import type { TypeReferenceGraph } from '../src/cycle-detector.js';

function makeGraph(nodes: string[], edges: Record<string, string[]>): TypeReferenceGraph {
  const edgeMap = new Map<string, string[]>();
  for (const [node, targets] of Object.entries(edges)) {
    edgeMap.set(node, targets);
  }
  for (const node of nodes) {
    if (!edgeMap.has(node)) {
      edgeMap.set(node, []);
    }
  }
  return { nodes, edges: edgeMap };
}

describe('topoSort', () => {
  it('handles an empty graph', () => {
    const graph = makeGraph([], {});
    const result = topoSort(graph, new Set());
    expect(result).toEqual([]);
  });

  it('sorts a linear chain (A → B → C) with C first (dependency before dependent)', () => {
    // A depends on B, B depends on C; so C should come first
    const graph = makeGraph(['A', 'B', 'C'], {
      A: ['B'],
      B: ['C'],
      C: []
    });
    const result = topoSort(graph, new Set());
    // C should come before B, B should come before A
    expect(result.indexOf('C')).toBeLessThan(result.indexOf('B'));
    expect(result.indexOf('B')).toBeLessThan(result.indexOf('A'));
    expect(result).toHaveLength(3);
  });

  it('handles a multi-root DAG', () => {
    // A → C, B → C, C has no deps
    const graph = makeGraph(['A', 'B', 'C'], {
      A: ['C'],
      B: ['C'],
      C: []
    });
    const result = topoSort(graph, new Set());
    expect(result.indexOf('C')).toBeLessThan(result.indexOf('A'));
    expect(result.indexOf('C')).toBeLessThan(result.indexOf('B'));
    expect(result).toHaveLength(3);
  });

  it('places cyclic types at the end in alphabetical order', () => {
    // A ↔ B (cyclic), C and D are acyclic with D → C
    const graph = makeGraph(['C', 'D', 'A', 'B'], {
      A: ['B'],
      B: ['A'],
      C: [],
      D: ['C']
    });
    const cyclic = new Set(['A', 'B']);
    const result = topoSort(graph, cyclic);

    // Non-cyclic: C and D, with C before D (D depends on C)
    expect(result.indexOf('C')).toBeLessThan(result.indexOf('D'));
    // Cyclic types come after all non-cyclic
    expect(result.indexOf('A')).toBeGreaterThan(result.indexOf('D'));
    expect(result.indexOf('B')).toBeGreaterThan(result.indexOf('D'));
    // Cyclic types sorted alphabetically: A before B
    expect(result.indexOf('A')).toBeLessThan(result.indexOf('B'));
    expect(result).toHaveLength(4);
  });

  it('handles an all-cyclic graph — output is the cyclic set sorted alphabetically', () => {
    const graph = makeGraph(['B', 'A', 'C'], {
      A: ['B'],
      B: ['C'],
      C: ['A']
    });
    const cyclic = new Set(['A', 'B', 'C']);
    const result = topoSort(graph, cyclic);
    expect(result).toEqual(['A', 'B', 'C']);
  });

  it('is deterministic for identical input', () => {
    const graph = makeGraph(['A', 'B', 'C', 'D'], {
      A: [],
      B: ['A'],
      C: ['A'],
      D: ['B', 'C']
    });
    const result1 = topoSort(graph, new Set());
    const result2 = topoSort(graph, new Set());
    expect(result1).toEqual(result2);
  });

  it('handles a single node with no edges', () => {
    const graph = makeGraph(['A'], { A: [] });
    const result = topoSort(graph, new Set());
    expect(result).toEqual(['A']);
  });

  it('handles a single cyclic node (self-loop)', () => {
    const graph = makeGraph(['A'], { A: ['A'] });
    const result = topoSort(graph, new Set(['A']));
    expect(result).toEqual(['A']);
  });
});

describe('topoSortComponents', () => {
  it('keeps cycles before every downstream consumer', () => {
    const graph = makeGraph(['z', 'a', 'b', 'last'], { z: ['a'], a: ['b'], b: ['a'], last: ['z'] });
    expect(topoSortComponents(graph)).toEqual(['a', 'b', 'z', 'last']);
  });
  it('orders multiple cycle groups through their condensation dependencies', () => {
    const graph = makeGraph(['a', 'b', 'c', 'd', 'consumer'], {
      a: ['b', 'c'],
      b: ['a'],
      c: ['d'],
      d: ['c'],
      consumer: ['a']
    });
    expect(topoSortComponents(graph)).toEqual(['c', 'd', 'a', 'b', 'consumer']);
  });
  it('retains self cycles and excludes dependencies outside the emitted graph', () => {
    expect(
      topoSortComponents(makeGraph(['consumer', 'self'], { consumer: ['self'], self: ['self', 'external'] }))
    ).toEqual(['self', 'consumer']);
    expect(topoSortComponents(makeGraph([], {}))).toEqual([]);
  });
});
