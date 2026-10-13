// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useInspectorSelection } from '../../src/components/forms/metadata/useInspectorSelection.js';
import { loadInspectorFixture } from '../helpers/inspector-fixture.js';
import { useMetadataBinding } from '../../src/components/forms/metadata/MetadataTargetContext.js';
import { useAutoSave } from '../../src/hooks/useAutoSave.js';
import { createEditorCommitRegistry } from '../../src/hooks/editor-commit-lifecycle.js';

describe('form-local Inspector row identity', () => {
  it('commits a debounced edit to its original child after selection changes and rejects an old workspace', async () => {
    const { store, getNode } = await loadInspectorFixture();
    const id = getNode('Person').id;
    const rows = [0, 1].map((index) => ({
      key: `row-${index}`,
      name: index === 0 ? 'name' : 'age',
      inherited: false,
      path: ['attributes', index] as const,
      node: store.getState().captureMetadataTarget(id, ['attributes', index])!.expected
    }));
    vi.useFakeTimers();
    try {
      const hook = renderHook(
        ({ scope, active }) => {
          const selection = useInspectorSelection(scope, rows);
          const binding = useMetadataBinding({
            scopeKey: scope,
            nodeId: id,
            root: getNode('Person').data,
            row: rows[active],
            selection,
            actions: store.getState()
          });
          const save = useAutoSave(binding.commitPending);
          return { binding, save };
        },
        { initialProps: { scope: 'workspace-a', active: 0 } }
      );
      act(() =>
        hook.result.current.save(hook.result.current.binding.envelope({ kind: 'definition', value: 'Full name' }))
      );
      hook.rerender({ scope: 'workspace-a', active: 1 });
      act(() => vi.advanceTimersByTime(500));
      expect(store.getState().captureMetadataTarget(id, ['attributes', 0])?.expected).toMatchObject({
        definition: 'Full name'
      });
      expect(store.getState().captureMetadataTarget(id, ['attributes', 1])?.expected).not.toHaveProperty('definition');
      act(() => hook.result.current.save(hook.result.current.binding.envelope({ kind: 'definition', value: 'stale' })));
      hook.rerender({ scope: 'workspace-b', active: 1 });
      act(() => vi.advanceTimersByTime(500));
      expect(store.getState().captureMetadataTarget(id, ['attributes', 1])?.expected).not.toHaveProperty('definition');
      hook.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
  it('registers only callbacks and removes disposed flush handlers', () => {
    const registry = createEditorCommitRegistry();
    const first = vi.fn();
    const disposed = vi.fn();
    registry.register(first);
    const remove = registry.register(disposed);
    remove();
    registry.flush();
    expect(first).toHaveBeenCalledOnce();
    expect(disposed).not.toHaveBeenCalled();
  });
  it('does not invoke a newly registered handler during the current flush', () => {
    const registry = createEditorCommitRegistry();
    const mounted = vi.fn();
    registry.register(() => registry.register(mounted));
    registry.flush();
    expect(mounted).not.toHaveBeenCalled();
    registry.flush();
    expect(mounted).toHaveBeenCalledOnce();
  });
  it('retains a selected child through rename and reorder while resolving its current path', async () => {
    const { store, getNode } = await loadInspectorFixture();
    const id = getNode('Person').id;
    const rows = () =>
      [0, 1].map((index) => {
        const node = store.getState().captureMetadataTarget(id, ['attributes', index])!.expected;
        return {
          key: `row-${index}`,
          name: 'name' in node ? node.name : '',
          path: ['attributes', index] as const,
          inherited: false,
          node,
          parseEpoch: store.getState().parseEpoch
        };
      });
    const initial = rows();
    const hook = renderHook(({ items }) => useInspectorSelection('a', items), { initialProps: { items: initial } });
    act(() => hook.result.current.select('row-0'));
    store.getState().renameAttribute(id, 'name', 'fullName');
    store.getState().reorderAttribute(id, 0, 1);
    const moved = rows().map((r, index) => ({ ...r, key: index === 1 ? 'row-0' : 'row-1' }));
    hook.rerender({ items: moved });
    expect(hook.result.current.resolve('row-0', 'a')).toMatchObject({ name: 'fullName', path: ['attributes', 1] });
  });
  it('rejects deleted/name-reused children and previous workspace scopes', async () => {
    const { store, getNode } = await loadInspectorFixture();
    const id = getNode('Person').id;
    const node = store.getState().captureMetadataTarget(id, ['attributes', 0])!.expected;
    const initial = [
      { key: 'original', name: 'name', inherited: false, node, path: ['attributes', 0] as const, parseEpoch: 0 }
    ];
    const hook = renderHook(({ scope, items }) => useInspectorSelection(scope, items), {
      initialProps: { scope: 'a', items: initial }
    });
    act(() => hook.result.current.select('original'));
    store.getState().removeAttribute(id, 'name');
    store.getState().addAttribute(id, 'name', 'string', '0..1');
    const next = store.getState().captureMetadataTarget(id, ['attributes', 1])!.expected;
    hook.rerender({ scope: 'a', items: [{ ...initial[0]!, key: 'replacement', node: next, path: ['attributes', 1] }] });
    expect(hook.result.current.resolve('original', 'a')).toBeUndefined();
    hook.rerender({ scope: 'b', items: initial });
    expect(hook.result.current.resolve('original', 'a')).toBeUndefined();
  });
});
