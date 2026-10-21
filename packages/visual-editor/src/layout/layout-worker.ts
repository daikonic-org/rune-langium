// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Async layout computation with Web Worker support.
 *
 * Attempts to run dagre layout in a dedicated Web Worker for true
 * off-main-thread execution. Falls back to requestIdleCallback-based
 * yielding when Workers are unavailable (e.g. SSR, unsupported bundler).
 *
 * For grouped layout (groupByInheritance), delegates to the grouped
 * layout engine on the main thread with yielding.
 */

import dagre from '@dagrejs/dagre';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { TypeGraphNode, TypeGraphEdge, LayoutOptions } from '../types.js';
import { computeGroupedLayout } from './grouped-layout.js';
import type { WorkerRequest, WorkerResponse } from './dagre-worker-script.js';
import { getNodeHeight, getNodeWidth } from './node-dimensions.js';
import {
  buildDagreGraph,
  dagrePositions,
  layoutNodeDimensions,
  DEFAULT_GRAPH_LAYOUT_OPTIONS as DEFAULT_LAYOUT_OPTIONS
} from './dagre-graph.js';

const elk = new ELK();

/** Sequence number to cancel stale async layout requests. */
let layoutSeq = 0;

// ---------------------------------------------------------------------------
// Web Worker management
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let workerFailed = false;
const pendingRequests = new Map<
  number,
  {
    resolve: (positions: Record<string, { x: number; y: number }>) => void;
    reject: (err: Error) => void;
  }
>();
let requestId = 0;

function getWorker(): Worker | null {
  if (workerFailed) return null;
  if (worker) return worker;

  try {
    worker = new Worker(new URL('./dagre-worker-script.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const pending = pendingRequests.get(e.data.id);
      if (pending) {
        pendingRequests.delete(e.data.id);
        pending.resolve(e.data.positions);
      }
    };
    worker.onerror = () => {
      // Worker failed to load — fall back permanently
      workerFailed = true;
      worker = null;
      // Reject all pending requests so they can retry via fallback
      for (const [id, pending] of pendingRequests) {
        pendingRequests.delete(id);
        pending.reject(new Error('Worker failed'));
      }
    };
    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

function runInWorker(
  nodes: TypeGraphNode[],
  edges: TypeGraphEdge[],
  opts: Required<LayoutOptions>
): Promise<Record<string, { x: number; y: number }>> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('No worker'));

  const id = ++requestId;
  const request: WorkerRequest = {
    id,
    nodes: layoutNodeDimensions(nodes),
    edges: edges.map((e) => ({ source: e.source, target: e.target })),
    direction: opts.direction,
    nodeSeparation: opts.nodeSeparation,
    rankSeparation: opts.rankSeparation
  };

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    w.postMessage(request);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute layout asynchronously.
 *
 * Prefers a Web Worker for true off-main-thread execution.
 * Falls back to requestIdleCallback-based yielding on the main thread.
 *
 * Returns null if a newer layout request superseded this one.
 */
export async function computeLayoutAsync(
  nodes: TypeGraphNode[],
  edges: TypeGraphEdge[],
  options?: LayoutOptions
): Promise<TypeGraphNode[] | null> {
  if (nodes.length === 0) return [];

  const seq = ++layoutSeq;
  const opts = { ...DEFAULT_LAYOUT_OPTIONS, ...options };

  if (opts.engine === 'elk' && !opts.groupByInheritance) {
    const layouted = await computeLayoutWithElk(nodes, edges, opts);
    if (layoutSeq !== seq) return null;
    return layouted;
  }

  // Delegate to grouped layout if requested (main thread with yielding)
  if (opts.groupByInheritance) {
    await yieldToMainThread();
    if (layoutSeq !== seq) return null;
    return computeGroupedLayout(nodes, edges, options);
  }

  // Try Web Worker first
  try {
    const positions = await runInWorker(nodes, edges, opts);
    if (layoutSeq !== seq) return null;
    return nodes.map((node) => {
      const pos = positions[node.id];
      return pos ? { ...node, position: pos } : node;
    });
  } catch {
    // Worker unavailable — fall through to main-thread fallback
  }

  if (layoutSeq !== seq) return null;

  // Fallback: main-thread dagre with yielding
  return computeLayoutMainThread(nodes, edges, opts, seq);
}

async function computeLayoutWithElk(
  nodes: TypeGraphNode[],
  edges: TypeGraphEdge[],
  opts: Required<LayoutOptions>
): Promise<TypeGraphNode[]> {
  type ElkChildPosition = {
    id?: string;
    x?: number;
    y?: number;
  };
  type ElkLayoutResult = {
    children?: ElkChildPosition[];
  };

  const isHorizontal = opts.direction === 'LR' || opts.direction === 'RL';
  const elkDirection =
    opts.direction === 'LR' ? 'RIGHT' : opts.direction === 'RL' ? 'LEFT' : opts.direction === 'BT' ? 'UP' : 'DOWN';

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': elkDirection,
      'elk.layered.spacing.nodeNodeBetweenLayers': String(opts.rankSeparation),
      'elk.spacing.nodeNode': String(opts.nodeSeparation)
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: getNodeWidth(node),
      height: getNodeHeight(node),
      targetPosition: isHorizontal ? 'left' : 'top',
      sourcePosition: isHorizontal ? 'right' : 'bottom'
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target]
    }))
  };

  const layoutedGraph = (await elk.layout(graph as never)) as ElkLayoutResult;
  const positionById = new Map<string, { x: number; y: number }>();
  for (const child of layoutedGraph.children ?? []) {
    if (typeof child.id !== 'string') continue;
    if (typeof child.x !== 'number' || typeof child.y !== 'number') continue;
    positionById.set(child.id, { x: child.x, y: child.y });
  }

  return nodes.map((node) => {
    const position = positionById.get(node.id);
    if (!position) return node;
    return {
      ...node,
      position
    };
  });
}

/** Cancel any in-flight async layout. */
export function cancelAsyncLayout(): void {
  layoutSeq++;
}

// ---------------------------------------------------------------------------
// Main-thread fallback with yielding
// ---------------------------------------------------------------------------

async function computeLayoutMainThread(
  nodes: TypeGraphNode[],
  edges: TypeGraphEdge[],
  opts: Required<LayoutOptions>,
  seq: number
): Promise<TypeGraphNode[] | null> {
  const g = buildDagreGraph(layoutNodeDimensions(nodes), edges, opts);

  await yieldToMainThread();
  if (layoutSeq !== seq) return null;

  dagre.layout(g);

  await yieldToMainThread();
  if (layoutSeq !== seq) return null;

  const positions = dagrePositions(g, nodes);
  return nodes.map((node) => (positions[node.id] ? { ...node, position: positions[node.id]! } : node));
}

/**
 * Yield control to the main thread.
 * Uses requestIdleCallback if available, otherwise setTimeout(0).
 */
function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 100 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}
