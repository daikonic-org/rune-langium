// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeLayout, computeLayoutIncremental, clearLayoutCache } from '../../src/layout/dagre-layout.js';
import { computeLayoutAsync, cancelAsyncLayout } from '../../src/layout/layout-worker.js';
import { getNodeHeight, getNodeWidth } from '../../src/layout/node-dimensions.js';
import type { WorkerRequest, WorkerResponse } from '../../src/layout/dagre-worker-script.js';
import type { TypeGraphNode, TypeGraphEdge } from '../../src/types.js';

const nodes = [
  {
    id: 'A',
    type: 'data',
    position: { x: 99, y: 99 },
    data: { $type: 'Data', name: 'A' },
    measured: { width: 310, height: 160 }
  },
  {
    id: 'B',
    type: 'data',
    position: { x: 99, y: 99 },
    data: { $type: 'Data', name: 'B' },
    style: { width: '180px', height: '140px' }
  }
] as TypeGraphNode[];
const edges = [{ id: 'A-B', source: 'A', target: 'B', data: { kind: 'extends' } }] as TypeGraphEdge[];

afterEach(() => {
  cancelAsyncLayout();
  clearLayoutCache();
  vi.unstubAllGlobals();
});

function noWorker() {
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        throw new Error('Worker unavailable');
      }
    }
  );
}

describe('Dagre execution adapters', () => {
  it.each(['TB', 'BT', 'LR', 'RL'] as const)(
    'keeps fallback geometry identical to synchronous layout: %s',
    async (direction) => {
      noWorker();
      const before = structuredClone(nodes);
      const options = { direction, nodeSeparation: 60, rankSeparation: 110 };
      const expected = computeLayout(nodes, edges, options);
      expect(await computeLayoutAsync(nodes, edges, options)).toEqual(expected);
      expect(nodes).toEqual(before);
    }
  );

  it('still rejects superseded fallback work instead of publishing stale positions', async () => {
    noWorker();
    const first = computeLayoutAsync(nodes, edges, { direction: 'TB' });
    const latest = computeLayoutAsync(nodes, edges, { direction: 'LR' });
    expect(await first).toBeNull();
    expect(await latest).toEqual(computeLayout(nodes, edges, { direction: 'LR' }));
  });

  it('uses the same measured dimensions and top-left coordinates inside the actual worker entry point', async () => {
    const scope = { onmessage: null as ((event: MessageEvent<WorkerRequest>) => void) | null, postMessage: vi.fn() };
    vi.stubGlobal('self', scope);
    await import('../../src/layout/dagre-worker-script.js');
    const request: WorkerRequest = {
      id: 17,
      nodes: nodes.map((node) => ({ id: node.id, width: getNodeWidth(node), height: getNodeHeight(node) })),
      edges: edges.map(({ source, target }) => ({ source, target })),
      direction: 'LR',
      nodeSeparation: 50,
      rankSeparation: 100
    };
    scope.onmessage!({ data: request } as MessageEvent<WorkerRequest>);
    const response = scope.postMessage.mock.calls[0]?.[0] as WorkerResponse;
    expect(response.id).toBe(17);
    expect(response.positions).toEqual(
      Object.fromEntries(computeLayout(nodes, edges, { direction: 'LR' }).map((node) => [node.id, node.position]))
    );
  });
});

it.each(['TB', 'LR'] as const)(
  'preserves the measured extent of cached nodes during large incremental layout: %s',
  (direction) => {
    const cachedNodes = Array.from({ length: 50 }, (_, i) => ({ ...nodes[0]!, id: `cached-${i}` }));
    clearLayoutCache();
    const cachedLayout = computeLayout(cachedNodes, [], { direction });
    const result = computeLayoutIncremental([...cachedNodes, { ...nodes[1]!, id: 'added' }], [], { direction });
    for (const cached of cachedLayout) {
      expect(result.find((node) => node.id === cached.id)?.position).toEqual(cached.position);
    }
    const added = result.find((node) => node.id === 'added')!;
    if (direction === 'TB') {
      expect(added.position.y).toBeGreaterThan(
        Math.max(...cachedLayout.map((node) => node.position.y + getNodeHeight(node)))
      );
    } else {
      expect(added.position.x).toBeGreaterThan(
        Math.max(...cachedLayout.map((node) => node.position.x + getNodeWidth(node)))
      );
    }
  }
);
