// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { useStore } from 'zustand';
import { parse } from '@rune-langium/core';
import {
  useModelSourceSync,
  createEditorStore,
  createEditorCommitRegistry,
  EnumForm,
  FunctionForm
} from '@rune-langium/visual-editor';
import { createSynonymDraft } from '@rune-langium/visual-editor/model';
import { createScopedMetadataActions } from '../../src/shell/inspector-metadata-actions.js';

describe('Inspector host metadata scope', () => {
  it('retains one synonym Add while a function source reparse blocks structural edits', async () => {
    const source = `namespace test
synonym source FpML
func Identity:
 inputs: value string (1..1)
 output: result string (1..1)
 set result: value
`;
    const parsed = (await parse(source)).value;
    const store = createEditorStore();
    store.getState().loadModels(parsed);
    const id = store.getState().nodes.find((node) => node.data.name === 'Identity')!.id;
    let blocked = false;
    const registry = createEditorCommitRegistry();
    const metadata = createScopedMetadataActions(
      'A:1',
      () => ({ scope: 'A:1', canEdit: () => !blocked }),
      store.getState()
    );
    function Fixture() {
      const state = useStore(store);
      const node = state.nodesById.get(id)!;
      if (node.data.$type !== 'RosettaFunction') throw new Error('Missing function');
      return (
        <FunctionForm
          nodeId={id}
          data={node.data}
          meta={node.meta}
          actions={{ ...state, ...metadata }}
          availableTypes={[]}
          synonymSourceOptions={[{ label: 'FpML', value: 'test.FpML' }]}
          allNodes={state.nodes}
          parseEpoch={state.parseEpoch}
          structuralEditsDisabled={blocked}
          registerCommitFlush={registry.register}
        />
      );
    }
    const view = render(<Fixture />);
    try {
      fireEvent.focus(screen.getByRole('textbox', { name: 'Attribute name: value' }));
      const details = within(screen.getByRole('region', { name: 'Details: value' }));
      fireEvent.click(details.getByRole('button', { name: 'Select source…' }));
      fireEvent.click(screen.getByRole('option', { name: /FpML/ }));
      fireEvent.change(details.getByLabelText('Synonym value'), { target: { value: 'Wire value' } });
      blocked = true;
      view.rerender(<Fixture />);
      const add = details.getByRole('button', { name: 'Add', exact: true });
      expect(add).toBeEnabled();
      fireEvent.click(add);
      expect(store.getState().captureMetadataTarget(id, ['inputs', 0])?.expected).toHaveProperty('synonyms', []);
      expect(details.getByLabelText('Synonym value')).toHaveValue('Wire value');
      expect(() => registry.flush()).toThrow(/waiting/);
      blocked = false;
      view.rerender(<Fixture />);
      await waitFor(() =>
        expect(store.getState().captureMetadataTarget(id, ['inputs', 0])?.expected).toMatchObject({
          synonyms: [{ body: { values: [{ name: 'Wire value' }] } }]
        })
      );
      act(() => registry.flush());
      const committed = store.getState().captureMetadataTarget(id, ['inputs', 0])!;
      view.rerender(<Fixture />);
      fireEvent.blur(details.getByLabelText('Synonym value'));
      expect(store.getState().captureMetadataTarget(id, ['inputs', 0])?.expected).toEqual(committed.expected);
      expect(details.getByLabelText('Synonym value')).toHaveValue('');
      expect(details.getByRole('button', { name: 'Edit synonym 1', exact: true })).toBeVisible();
      expect(details.queryByRole('button', { name: 'Edit synonym 2', exact: true })).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      cleanup();
    }
  });

  it('retries an enum display edit after the renamed source becomes current', async () => {
    const source = 'namespace test\nenum Role:\n  First\n  Last\n';
    const original = (await parse(source)).value;
    const renamed = (await parse(source.replace('  Last', '  Renamed'))).value;
    const store = createEditorStore();
    store.getState().loadModels(original);
    const id = store.getState().nodes.find((node) => node.data.name === 'Role')!.id;
    let allowed = true;
    const metadata = createScopedMetadataActions(
      'A:1',
      () => ({ scope: 'A:1', canEdit: () => allowed }),
      store.getState()
    );
    function Fixture() {
      const state = useStore(store);
      const node = state.nodesById.get(id)!;
      return (
        <EnumForm
          nodeId={id}
          data={node.data}
          meta={node.meta}
          actions={{ ...state, ...metadata }}
          availableTypes={[]}
          allNodes={state.nodes}
          parseEpoch={state.parseEpoch}
        />
      );
    }
    vi.useFakeTimers();
    try {
      render(<Fixture />);
      const row = screen.getByLabelText('Value name for Last');
      fireEvent.focus(row);
      fireEvent.change(row, { target: { value: 'Renamed' } });
      await act(async () => vi.advanceTimersByTime(500));
      // Source publication has advanced beyond the last parsed snapshot.
      allowed = false;
      const display = within(screen.getByRole('region', { name: 'Details: Renamed' })).getByLabelText('Display name');
      fireEvent.change(display, { target: { value: 'Last role display' } });
      await act(async () => vi.advanceTimersByTime(500));
      expect(store.getState().captureMetadataTarget(id, ['enumValues', 1])?.expected).toHaveProperty(
        'display',
        undefined
      );
      expect(display).toHaveValue('Last role display');
      allowed = true;
      act(() => store.getState().loadModels(renamed));
      await act(async () => vi.advanceTimersByTime(500));
      expect(store.getState().captureMetadataTarget(id, ['enumValues', 1])?.expected).toMatchObject({
        name: 'Renamed',
        display: 'Last role display'
      });
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it('rejects old callbacks even when a replacement workspace uses identical IDs', async () => {
    const parsed = await parse('namespace test\nversion "1"\ntype Person:\n  name string (1..1)\n');
    const store = createEditorStore();
    store.getState().loadModels(parsed.value);
    let scope = 'A:1';
    let allowed = true;
    const actions = createScopedMetadataActions(scope, () => ({ scope, canEdit: () => allowed }), store.getState());
    const id = store.getState().nodes[0]!.id;
    const target = actions.captureMetadataTarget(id, ['attributes', 0])!;
    expect(actions.applyMetadataCommand(target, { kind: 'definition', value: 'Workspace A' }).status).toBe('committed');
    const old = actions.captureMetadataTarget(id, ['attributes', 0])!;
    scope = 'B:2';
    store.getState().loadModels(parsed.value);
    const before = store.getState().pendingEditPatches;
    expect(actions.captureMetadataTarget(id, ['attributes', 0])).toBeUndefined();
    expect(actions.applyMetadataCommand(old, { kind: 'definition', value: 'Wrong workspace' })).toEqual({
      status: 'stale'
    });
    expect(store.getState().pendingEditPatches).toBe(before);
    const fresh = createScopedMetadataActions(scope, () => ({ scope, canEdit: () => allowed }), store.getState());
    const freshTarget = fresh.captureMetadataTarget(id, ['attributes', 0])!;
    allowed = false;
    expect(fresh.applyMetadataCommand(freshTarget, { kind: 'definition', value: 'Locked source' })).toEqual({
      status: 'readOnly'
    });
  });
});

it('publishes an accepted metadata edit before a preceding reparse consumes its patches', async () => {
  const source = `namespace demo
synonym source FpML
func Identity:
  inputs: value string (1..1)
  output: result string (1..1)
  set result: value
`;
  const parsed = (await parse(source)).value;
  const store = createEditorStore();
  store.getState().loadModels(parsed);
  const id = store.getState().nodes.find((node) => node.data.name === 'Identity')!.id;
  const published = vi.fn();
  const { result, unmount } = renderHook(() => {
    const state = useStore(store);
    return useModelSourceSync(
      state.nodes,
      state.edges,
      published,
      state.parseEpoch,
      state.pendingEditPatches,
      new Map([['demo', source]]),
      state.pendingInversePatches
    );
  });
  const metadata = createScopedMetadataActions(
    'A:1',
    () => ({ scope: 'A:1', canEdit: () => true }),
    store.getState(),
    () => {
      const state = store.getState();
      void result.current.flush({
        nodes: state.nodes,
        edges: state.edges,
        parseEpoch: state.parseEpoch,
        patches: state.pendingEditPatches,
        inversePatches: state.pendingInversePatches
      });
    }
  );
  try {
    await act(async () => {
      const target = metadata.captureMetadataTarget(id, ['inputs', 0])!;
      expect(metadata.applyMetadataCommand(target, { kind: 'definition', value: 'Function input' }).status).toBe(
        'committed'
      );
    });
    const definitionSource = published.mock.calls.at(-1)![0].get('demo')!;
    const precedingParse = await parse(definitionSource);
    expect(precedingParse.hasErrors).toBe(false);
    await act(async () => {
      const target = metadata.captureMetadataTarget(id, ['inputs', 0])!;
      const value = createSynonymDraft('body', 'FpML', 'Wire value')!;
      expect(metadata.applyMetadataCommand(target, { kind: 'append', field: 'synonyms', value }).status).toBe(
        'committed'
      );
      store.getState().loadModels(precedingParse.value);
    });
    expect(published.mock.calls.at(-1)![0].get('demo')).toContain('[synonym FpML value "Wire value"]');
  } finally {
    unmount();
  }
});
