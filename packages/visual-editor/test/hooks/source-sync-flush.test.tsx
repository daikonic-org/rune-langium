// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { useLayoutEffect } from 'react';
import { renderHook, act } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { loadInspectorFixture } from '../helpers/inspector-fixture.js';
import { useModelSourceSync, type SourceSyncSnapshot } from '../../src/hooks/useModelSourceSync.js';
import { parseWorkspace } from '@rune-langium/core';
import { createSynonymDraft } from '../../src/store/metadata-ops.js';
import { createEditorStore } from '../../src/store/editor-store.js';

it('flushes a rename into its owning file before React rerenders, preserving a same-namespace sibling file', async () => {
  const sources = ['A', 'B'].map((name) => `override namespace shared\ntype ${name}:\n value string (0..1)\n`);
  const entries = sources.map((content, index) => ({ content, uri: `file:///${index}.rosetta` }));
  const parsed = await parseWorkspace(entries);
  expect(parsed.every((entry) => !entry.hasErrors)).toBe(true);
  const store = createEditorStore();
  store.getState().loadModels(parsed.map((entry) => entry.value));
  const initial = store.getState();
  const files = new Map(
    ['A', 'B'].map((name, index) => {
      const node = initial.nodes.find((entry) => entry.data.name === name)!;
      return [
        `${name}.rosetta`,
        {
          namespace: 'shared',
          text: sources[index]!,
          nodeIds: new Set([node.id]),
          sourceUris: new Set([entries[index]!.uri])
        }
      ] as const;
    })
  );
  const handler = vi.fn();
  const { result } = renderHook(() =>
    useModelSourceSync(
      initial.nodes,
      initial.edges,
      handler,
      initial.parseEpoch,
      [],
      new Map([['shared', sources[0]!]]),
      [],
      files
    )
  );
  const oldId = initial.nodes.find((node) => node.data.name === 'B')!.id;
  store.getState().renameType(oldId, 'RenamedB');
  const latest = store.getState();
  // No rerender: the publication barrier must use this exact store snapshot.
  await act(async () =>
    result.current.flush({
      nodes: latest.nodes,
      edges: latest.edges,
      parseEpoch: latest.parseEpoch,
      patches: latest.pendingEditPatches,
      inversePatches: latest.pendingInversePatches
    })
  );
  expect(handler).toHaveBeenCalledTimes(1);
  const saved = handler.mock.calls[0]![0] as Map<string, string>;
  expect(saved.get('A.rosetta')).toBe(sources[0]);
  expect(saved.get('B.rosetta')).toContain('type RenamedB:');
  expect(saved.get('B.rosetta')).not.toContain('type B:');
  expect(saved.get('B.rosetta')).not.toContain('type A:');
});

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

it('serializes a new input synonym after its definition has been reparsed', async () => {
  const source = `namespace demo
synonym source FpML
func Identity:
  inputs:
    value string (1..1)
      <"Function input">
  output:
    result string (1..1)
  set result: value
`;
  const { store, getNode } = await loadInspectorFixture(source);
  const id = getNode('Identity').id;
  const state = store.getState();
  const published = vi.fn();
  const { result } = renderHook(() =>
    useModelSourceSync(
      state.nodes,
      state.edges,
      published,
      state.parseEpoch,
      [],
      new Map([['demo', source]]),
      [],
      new Map([
        [
          'details.rosetta',
          {
            namespace: 'demo',
            text: source,
            nodeIds: new Set([id]),
            sourceUris: new Set([getNode('Identity').meta.sourceUri!])
          }
        ]
      ])
    )
  );
  const target = store.getState().captureMetadataTarget(id, ['inputs', 0])!;
  const value = createSynonymDraft('body', 'FpML', 'Wire value')!;
  expect(store.getState().applyMetadataCommand(target, { kind: 'append', field: 'synonyms', value }).status).toBe(
    'committed'
  );
  const latest = store.getState();
  await act(async () =>
    result.current.flush({
      nodes: latest.nodes,
      edges: latest.edges,
      parseEpoch: latest.parseEpoch,
      patches: latest.pendingEditPatches,
      inversePatches: latest.pendingInversePatches
    })
  );
  expect(published.mock.calls.at(-1)![0].get('details.rosetta')).toContain('[synonym FpML value "Wire value"]');
});

it('does not publish an older render snapshot after an explicit flush captures a newer edit', async () => {
  const source = `namespace demo
synonym source FpML
func Identity:
  inputs: value string (1..1)
  output: result string (1..1)
  set result: value
`;
  const { store, getNode } = await loadInspectorFixture(source);
  const id = getNode('Identity').id;
  const initial = store.getState();
  const published = vi.fn();
  const { rerender } = renderHook(
    ({ snapshot, flushLatest }) => {
      const handle = useModelSourceSync(
        snapshot.nodes,
        snapshot.edges,
        published,
        snapshot.parseEpoch,
        snapshot.pendingEditPatches,
        new Map([['demo', source]]),
        snapshot.pendingInversePatches
      );
      useLayoutEffect(() => {
        if (!flushLatest) return;
        const latest = store.getState();
        void handle.flush({
          nodes: latest.nodes,
          edges: latest.edges,
          parseEpoch: latest.parseEpoch,
          patches: latest.pendingEditPatches,
          inversePatches: latest.pendingInversePatches
        });
      }, [flushLatest, handle.flush]);
    },
    { initialProps: { snapshot: initial, flushLatest: false } }
  );
  const target = store.getState().captureMetadataTarget(id, ['inputs', 0])!;
  expect(store.getState().applyMetadataCommand(target, { kind: 'definition', value: 'Function input' }).status).toBe(
    'committed'
  );
  const olderRender = store.getState();
  const current = store.getState().captureMetadataTarget(id, ['inputs', 0])!;
  const value = createSynonymDraft('body', 'FpML', 'Wire value')!;
  expect(store.getState().applyMetadataCommand(current, { kind: 'append', field: 'synonyms', value }).status).toBe(
    'committed'
  );
  await act(async () => rerender({ snapshot: olderRender, flushLatest: true }));
  expect(published.mock.calls.at(-1)![0].get('demo')).toContain('[synonym FpML value "Wire value"]');
  expect(published).toHaveBeenCalledTimes(1);
});
