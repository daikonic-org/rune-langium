// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import dagre from '@dagrejs/dagre';
import type { graphlib, GraphLabel, NodeLabel } from '@dagrejs/dagre';
import type { TypeGraphNode, LayoutOptions } from '../types.js';
import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH, getNodeHeight, getNodeWidth } from './node-dimensions.js';

export const DEFAULT_GRAPH_LAYOUT_OPTIONS: Required<LayoutOptions> = {
  engine: 'dagre',
  direction: 'TB',
  nodeSeparation: 50,
  rankSeparation: 100,
  groupByInheritance: false
};

/** Serializable node dimensions used by both worker and main-thread layout. */
export function layoutNodeDimensions(nodes: readonly TypeGraphNode[]) {
  return nodes.map((node) => ({ id: node.id, width: getNodeWidth(node), height: getNodeHeight(node) }));
}

/** Build the same Dagre graph regardless of the execution/scheduling adapter. */
export function buildDagreGraph(
  nodes: readonly { id: string; width: number; height: number }[],
  edges: readonly { source: string; target: string }[],
  options: Pick<Required<LayoutOptions>, 'direction' | 'nodeSeparation' | 'rankSeparation'>
): graphlib.Graph<GraphLabel, NodeLabel> {
  const graph = new dagre.graphlib.Graph<GraphLabel, NodeLabel>();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: options.direction,
    nodesep: options.nodeSeparation,
    ranksep: options.rankSeparation,
    marginx: 20,
    marginy: 20
  });
  for (const node of nodes) graph.setNode(node.id, { width: node.width, height: node.height });
  for (const edge of edges) graph.setEdge(edge.source, edge.target);
  return graph;
}

/** Convert Dagre centers to the top-left coordinates consumed by React Flow. */
export function dagrePositions(graph: ReturnType<typeof buildDagreGraph>, nodes: readonly { id: string }[]) {
  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of nodes) {
    const placed = graph.node(node.id);
    if (placed)
      positions[node.id] = {
        x: placed.x! - (placed.width ?? DEFAULT_NODE_WIDTH) / 2,
        y: placed.y! - (placed.height ?? DEFAULT_NODE_HEIGHT) / 2
      };
  }
  return positions;
}
