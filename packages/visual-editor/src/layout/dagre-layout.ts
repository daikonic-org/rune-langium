// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Dagre-based auto-layout engine for ReactFlow graphs.
 *
 * Computes hierarchical node positions using @dagrejs/dagre.
 * Includes a position cache to avoid re-running dagre when
 * re-expanding previously collapsed namespaces.
 */

import dagre from '@dagrejs/dagre';
import { getNodeWidth, getNodeHeight } from './node-dimensions.js';
import type { TypeGraphNode, TypeGraphEdge, LayoutOptions } from '../types.js';
import { computeGroupedLayout } from './grouped-layout.js';
import {
  buildDagreGraph,
  dagrePositions,
  layoutNodeDimensions,
  DEFAULT_GRAPH_LAYOUT_OPTIONS as DEFAULT_LAYOUT_OPTIONS
} from './dagre-graph.js';

// ---------------------------------------------------------------------------
// Layout position cache
// ---------------------------------------------------------------------------

/** Cached position for a previously laid-out node. */
interface CachedPosition {
  x: number;
  y: number;
}

/**
 * Global layout position cache.
 * Maps node ID → last computed position from dagre.
 * Cleared on full model reload, reused across namespace toggles.
 */
const positionCache = new Map<string, CachedPosition>();
let lastLayoutCacheKey: string | null = null;

function normalizeLayoutOptions(options?: LayoutOptions): Required<LayoutOptions> {
  return { ...DEFAULT_LAYOUT_OPTIONS, ...options };
}

function getLayoutCacheKey(options: Required<LayoutOptions>): string {
  return [
    options.engine,
    options.direction,
    options.nodeSeparation,
    options.rankSeparation,
    options.groupByInheritance ? 'grouped' : 'flat'
  ].join(':');
}

function ensureCompatibleLayoutCache(options?: LayoutOptions): Required<LayoutOptions> {
  const normalized = normalizeLayoutOptions(options);
  const nextKey = getLayoutCacheKey(normalized);
  if (lastLayoutCacheKey !== nextKey) {
    positionCache.clear();
    lastLayoutCacheKey = nextKey;
  }
  return normalized;
}

/** Clear the entire position cache (call on model reload). */
export function clearLayoutCache(): void {
  positionCache.clear();
  lastLayoutCacheKey = null;
}

/**
 * Compute layout positions for ReactFlow nodes using dagre.
 *
 * Returns a new array of nodes with updated positions.
 * Does not mutate the input.
 */
export function computeLayout(
  nodes: TypeGraphNode[],
  edges: TypeGraphEdge[],
  options?: LayoutOptions
): TypeGraphNode[] {
  if (nodes.length === 0) return [];

  // Delegate to grouped layout if requested
  if (options?.groupByInheritance) {
    ensureCompatibleLayoutCache(options);
    const result = computeGroupedLayout(nodes, edges, options);
    // Update cache with grouped positions
    for (const node of result) {
      positionCache.set(node.id, node.position);
    }
    return result;
  }

  const opts = ensureCompatibleLayoutCache(options);

  const g = buildDagreGraph(layoutNodeDimensions(nodes), edges, opts);

  // Compute layout
  dagre.layout(g);

  const positions = dagrePositions(g, nodes);
  return nodes.map((node) => {
    const position = positions[node.id];
    if (!position) return node;
    positionCache.set(node.id, position);
    return { ...node, position };
  });
}

/**
 * Compute layout with cache-first strategy.
 *
 * For incremental visibility changes (toggling a single namespace),
 * nodes with cached positions reuse them. Only nodes without cached
 * positions trigger a full dagre run.
 *
 * When the ratio of uncached nodes is small (<30%), we place cached
 * nodes at their old positions and only run dagre for the new ones,
 * offsetting them near related cached nodes.
 *
 * When the ratio is large (>=30%), we run a full dagre layout and
 * update the cache.
 */
export function computeLayoutIncremental(
  nodes: TypeGraphNode[],
  edges: TypeGraphEdge[],
  options?: LayoutOptions
): TypeGraphNode[] {
  if (nodes.length === 0) return [];
  const opts = ensureCompatibleLayoutCache(options);

  // Check how many nodes have cached positions
  const uncached: TypeGraphNode[] = [];
  const cached: TypeGraphNode[] = [];
  for (const node of nodes) {
    if (positionCache.has(node.id)) {
      cached.push(node);
    } else {
      uncached.push(node);
    }
  }

  // If all nodes are cached, just apply cached positions (no dagre needed)
  if (uncached.length === 0) {
    return nodes.map((node) => ({
      ...node,
      position: positionCache.get(node.id)!
    }));
  }

  // If >30% are uncached or total nodes are small, run full dagre
  if (uncached.length / nodes.length > 0.3 || nodes.length < 50) {
    return computeLayout(nodes, edges, opts);
  }

  // Incremental: place cached nodes at old positions, run dagre only for uncached
  const result: TypeGraphNode[] = cached.map((node) => ({
    ...node,
    position: positionCache.get(node.id)!
  }));

  // For uncached nodes, run dagre on just the uncached set with their edges
  const uncachedIds = new Set(uncached.map((n) => n.id));
  const uncachedEdges = edges.filter((e) => uncachedIds.has(e.source) && uncachedIds.has(e.target));

  // Run dagre on the uncached subset
  const layouted = computeLayout(uncached, uncachedEdges, opts);

  // Offset uncached nodes to avoid overlapping with cached nodes
  const horizontalLayout = opts.direction === 'LR' || opts.direction === 'RL';
  let maxX = 0;
  let maxY = 0;
  for (const node of result) {
    maxX = Math.max(maxX, node.position.x + getNodeWidth(node));
    maxY = Math.max(maxY, node.position.y + getNodeHeight(node));
  }

  for (const node of layouted) {
    const position = horizontalLayout
      ? { x: node.position.x + maxX + 50, y: node.position.y }
      : { x: node.position.x, y: node.position.y + maxY + 50 };
    result.push({
      ...node,
      position
    });
    positionCache.set(node.id, position);
  }

  return result;
}
