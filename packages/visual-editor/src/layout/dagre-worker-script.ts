// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Web Worker entry point for dagre layout computation.
 *
 * Receives a serialised graph (nodes + edges + options) via postMessage,
 * runs dagre.layout(), and posts back the computed positions.
 *
 * This file is imported via `new Worker(new URL(...), { type: 'module' })`
 * by bundlers that support it (Vite, webpack 5, etc.).
 */

import dagre from '@dagrejs/dagre';
import type { LayoutOptions } from '../types.js';

import { buildDagreGraph, dagrePositions } from './dagre-graph.js';

export interface WorkerRequest {
  id: number;
  nodes: Array<{ id: string; width: number; height: number }>;
  edges: Array<{ source: string; target: string }>;
  direction: Required<LayoutOptions>['direction'];
  nodeSeparation: number;
  rankSeparation: number;
}

export interface WorkerResponse {
  id: number;
  positions: Record<string, { x: number; y: number }>;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, nodes, edges } = e.data;
  const graph = buildDagreGraph(nodes, edges, e.data);
  dagre.layout(graph);
  const response: WorkerResponse = { id, positions: dagrePositions(graph, nodes) };
  self.postMessage(response);
};
