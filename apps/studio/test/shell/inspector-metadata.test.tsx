// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect } from 'vitest';
import { parse } from '@rune-langium/core';
import { createEditorStore } from '@rune-langium/visual-editor';
import { createScopedMetadataActions } from '../../src/shell/inspector-metadata-actions.js';

describe('Inspector host metadata scope', () => {
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
