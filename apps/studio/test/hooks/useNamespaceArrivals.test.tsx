// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { selectNodeRepository, type TypeGraphNode } from '@rune-langium/visual-editor';
import { useNamespaceArrivals } from '../../src/hooks/useChangeFeedback.js';
import { CHANGE_HIGHLIGHT_MS } from '../../src/services/change-feedback.js';

const workspace = vi.hoisted(() => ({ workspaceId: 'project', workspaceEpoch: 1 }));
vi.mock('../../src/shell/providers/workspace-context.js', () => ({
  useWorkspaceOptional: () => workspace
}));

function modelNode(namespace: string, deferred = false): TypeGraphNode {
  return {
    id: `${namespace}.Quote#Data`,
    type: 'data',
    position: { x: 0, y: 0 },
    data: { $type: 'Data', name: 'Quote', attributes: [], conditions: [], annotations: [] },
    meta: { namespace, deferred, hasExternalRefs: false, errors: [] }
  };
}

function inventory(...nodes: TypeGraphNode[]) {
  return selectNodeRepository(new Map(nodes.map((node) => [node.id, node])));
}

afterEach(() => {
  vi.useRealTimers();
});

it('cues both newly listed and hydrated namespaces and expires the cue', () => {
  vi.useFakeTimers();
  const deferred = modelNode('example.deferred', true);
  const ready = modelNode('example.deferred');
  const added = modelNode('example.added');
  const { result, rerender } = renderHook(useNamespaceArrivals, { initialProps: inventory(deferred) });
  expect(result.current).toBeUndefined();

  rerender(inventory(ready, added));
  expect(result.current).toEqual(new Set(['example.deferred', 'example.added']));
  act(() => vi.advanceTimersByTime(CHANGE_HIGHLIGHT_MS));
  expect(result.current).toBeUndefined();

  rerender(inventory(ready));
  expect(result.current).toBeUndefined();
});

it('drops active cues across workspace activation', () => {
  const { result, rerender } = renderHook(useNamespaceArrivals, { initialProps: inventory() });
  rerender(inventory(modelNode('example.added')));
  expect(result.current).toEqual(new Set(['example.added']));

  workspace.workspaceEpoch += 1;
  rerender(inventory(modelNode('another.workspace')));
  expect(result.current).toBeUndefined();
});
