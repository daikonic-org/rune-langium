// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { renderHook, act } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { loadInspectorFixture } from '../helpers/inspector-fixture.js';
import { useModelSourceSync, type SourceSyncSnapshot } from '../../src/hooks/useModelSourceSync.js';

it('explicit flush awaits the existing publication receipt and retries a failed receipt', async () => {
  const { store, source, getNode } = await loadInspectorFixture();
  const initial = store.getState();
  const gate = Promise.withResolvers<void>();
  const handler = vi.fn(async () => gate.promise);
  const { result } = renderHook(() =>
    useModelSourceSync(
      initial.nodes,
      initial.edges,
      handler,
      initial.parseEpoch,
      [],
      new Map([['demo.forms', source]]),
      []
    )
  );
  const id = getNode('Person').id;
  store.getState().updateDefinition(id, 'Saved before switching');
  const snapshot = (): SourceSyncSnapshot => {
    const state = store.getState();
    return {
      nodes: state.nodes,
      edges: state.edges,
      parseEpoch: state.parseEpoch,
      patches: state.pendingEditPatches,
      inversePatches: state.pendingInversePatches
    };
  };
  let done = false;
  const flush = result.current.flush(snapshot()).then(() => {
    done = true;
  });
  await act(async () => Promise.resolve());
  expect(handler).toHaveBeenCalledTimes(1);
  expect(done).toBe(false);
  expect(handler.mock.calls[0]?.[0]?.get('demo.forms')).toContain('Saved before switching');
  gate.resolve();
  await act(async () => flush);
  expect(done).toBe(true);
  store.getState().updateDefinition(id, 'Retryable edit');
  handler.mockRejectedValueOnce(new Error('publication failed'));
  await expect(result.current.flush(snapshot())).rejects.toThrow('publication failed');
  await result.current.flush(snapshot());
  expect(handler).toHaveBeenCalledTimes(3);
});

it('refuses a snapshot whose parse epoch has no adopted source baseline', async () => {
  const { store, source } = await loadInspectorFixture();
  const initial = store.getState();
  const handler = vi.fn();
  const { result } = renderHook(() =>
    useModelSourceSync(
      initial.nodes,
      initial.edges,
      handler,
      initial.parseEpoch,
      [],
      new Map([['demo.forms', source]]),
      []
    )
  );
  await expect(
    result.current.flush({
      nodes: initial.nodes,
      edges: initial.edges,
      parseEpoch: initial.parseEpoch + 1,
      patches: [{ op: 'replace', path: ['nodes', initial.nodes[0]!.id, 'data', 'name'], value: 'Changed' }],
      inversePatches: []
    })
  ).rejects.toThrow('Source has changed');
  expect(handler).not.toHaveBeenCalled();
});
