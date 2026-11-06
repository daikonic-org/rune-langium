// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useStore } from 'zustand';
import { parse } from '@rune-langium/core';
import { createEditorStore, EnumForm } from '@rune-langium/visual-editor';
import { createScopedMetadataActions } from '../../src/shell/inspector-metadata-actions.js';

describe('Inspector host metadata scope', () => {
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
