// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { stronglyConnectedComponents, type TypeReferenceGraph } from './cycle-detector.js';

/**
 * Topologically sorts the non-cyclic types in the graph using Kahn's algorithm
 * over the non-cyclic subgraph. Cyclic types are placed at the end in stable
 * (alphabetic) order.
 *
 * The output is deterministic for identical input: non-cyclic types are
 * sorted topologically (dependencies before dependents), and for any ambiguous
 * ordering the nodes appear in the order they were listed in the graph.
 * Cyclic types are appended at the end, sorted alphabetically.
 *
 * FR-007 (topological ordering for emission).
 *
 * @param graph - The type reference graph.
 * @param cyclicTypes - The set of cyclic type names (from findCyclicTypes).
 * @returns Ordered list of type names: non-cyclic (topo order) then cyclic (alpha order).
 */
export function topoSort(graph: TypeReferenceGraph, cyclicTypes: Set<string>): string[] {
  // Partition into non-cyclic (DAG) and cyclic
  const dacNodes = graph.nodes.filter((n) => !cyclicTypes.has(n));
  const cyclicNodes = Array.from(cyclicTypes).sort();

  // Build reversed adjacency and in-degree only for non-cyclic nodes.
  //
  // Edges in the TypeReferenceGraph represent "A references B" (A depends on B).
  // For topological emission order (dependencies before dependents), we want B
  // to appear before A. We achieve this by:
  //   - tracking in-degree of A (A must wait for its dependencies)
  //   - building a reversed adjacency: B → [A, ...] so when B is processed,
  //     we decrement in-degree of all nodes that depend on B.
  const inDegree = new Map<string, number>();
  // reversedAdj[dep] = [nodes that depend on dep]
  const reversedAdj = new Map<string, string[]>();

  for (const node of dacNodes) {
    inDegree.set(node, 0);
    reversedAdj.set(node, []);
  }

  for (const node of dacNodes) {
    const deps = graph.edges.get(node) ?? [];
    for (const dep of deps) {
      // Only consider edges within the non-cyclic set
      if (!dacNodes.includes(dep)) continue;
      // node depends on dep → increment in-degree of node
      inDegree.set(node, (inDegree.get(node) ?? 0) + 1);
      // When dep is processed, node's in-degree decreases
      reversedAdj.get(dep)!.push(node);
    }
  }

  // Kahn's algorithm — seed with nodes that have in-degree 0 (no dependencies)
  // Use the original node order for stable output
  const queue: string[] = [];
  for (const node of dacNodes) {
    if ((inDegree.get(node) ?? 0) === 0) {
      queue.push(node);
    }
  }

  const result: string[] = [];
  while (queue.length > 0) {
    // Stable: pick lowest-index element (already in original order)
    const node = queue.shift()!;
    result.push(node);

    for (const dependent of reversedAdj.get(node) ?? []) {
      const newDegree = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  // Remaining non-cyclic nodes that weren't sorted (shouldn't happen if
  // cyclicTypes is correct, but handle defensively)
  for (const node of dacNodes) {
    if (!result.includes(node)) {
      result.push(node);
    }
  }

  // Append cyclic types at the end, sorted alphabetically
  return [...result, ...cyclicNodes];
}

/** Dependency-first ordering of whole SCC groups, keeping each cycle before its consumers. */
export function topoSortComponents(graph: TypeReferenceGraph): string[] {
  const included = new Set(graph.nodes);
  const edges = new Map(
    graph.nodes.map((node) => [node, (graph.edges.get(node) ?? []).filter((dependency) => included.has(dependency))])
  );
  const rank = new Map(graph.nodes.map((node, index) => [node, index]));
  const components = stronglyConnectedComponents({ nodes: graph.nodes, edges })
    .map((component) => component.sort((a, b) => rank.get(a)! - rank.get(b)!))
    .sort((a, b) => rank.get(a[0]!)! - rank.get(b[0]!)!);
  const componentOf = new Map<string, string>();
  components.forEach((component, index) => component.forEach((node) => componentOf.set(node, String(index))));
  const condensed = {
    nodes: components.map((_, index) => String(index)),
    edges: new Map(
      components.map((component, index) => [
        String(index),
        [
          ...new Set(
            component
              .flatMap((node) => edges.get(node) ?? [])
              .map((dependency) => componentOf.get(dependency)!)
              .filter((id) => id !== String(index))
          )
        ]
      ])
    )
  };
  return topoSort(condensed, new Set()).flatMap((id) => components[Number(id)]!);
}
