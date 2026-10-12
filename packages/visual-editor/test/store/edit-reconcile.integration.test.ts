// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Integration test for the Mutative edit-reconcile foundation wired into the
 * store. Unlike edit-reconcile.test.ts (which exercises the pure module), this
 * drives the real flow: a semantic edit action captures pending patches, and a
 * subsequent `loadModels` (a reparse) either replays the still-in-flight edit or
 * drops it once the parse has caught up.
 *
 * This is the regression guard for the source-corruption follow-up: an edit made
 * just before its own reparse lands must NOT be momentarily reverted, because
 * that reverted graph would otherwise be serialized back over the real source.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '@rune-langium/core';
import { createEditorStore } from '../../src/store/editor-store.js';
import { buildSourceForNamespaces } from '../../src/hooks/useModelSourceSync.js';

const BASE_SOURCE = `
namespace test.reconcile
version "1.0.0"

type Alpha:
  x string (1..1)
  y string (1..1)
`;

// Same model with Alpha.x renamed to `renamed` — i.e. the source AFTER the edit
// has round-tripped through serialize + save + reparse.
const CAUGHT_UP_SOURCE = `
namespace test.reconcile
version "1.0.0"

type Alpha:
  renamed string (1..1)
  y string (1..1)
`;

function alphaAttrNames(store: ReturnType<typeof createEditorStore>): string[] {
  const alpha = store.getState().nodes.find((n) => n.data.name === 'Alpha');
  return ((alpha!.data as { attributes?: Array<{ name: string }> }).attributes ?? []).map((a) => a.name);
}

describe('edit-reconcile — store integration', () => {
  let store: ReturnType<typeof createEditorStore>;
  let baseModels: unknown;

  beforeEach(async () => {
    store = createEditorStore();
    baseModels = (await parse(BASE_SOURCE)).value;
    store.getState().loadModels(baseModels);
  });

  it('captures pending patches when a source-affecting action runs (no parseEpoch bump)', () => {
    const epochBefore = store.getState().parseEpoch;
    const alphaId = store.getState().nodes.find((n) => n.data.name === 'Alpha')!.id;

    store.getState().renameAttribute(alphaId, 'x', 'renamed');

    expect(alphaAttrNames(store)).toEqual(['renamed', 'y']);
    expect(store.getState().pendingEditPatches.length).toBeGreaterThan(0);
    // USER-origin edit must NOT advance parseEpoch (so useModelSourceSync serializes it).
    expect(store.getState().parseEpoch).toBe(epochBefore);
  });

  it('replays an in-flight edit over a STALE reparse instead of reverting it', async () => {
    const alphaId = store.getState().nodes.find((n) => n.data.name === 'Alpha')!.id;
    store.getState().renameAttribute(alphaId, 'x', 'renamed');
    expect(alphaAttrNames(store)).toEqual(['renamed', 'y']);

    // A reparse of the PRE-edit source lands (the save's reparse is still in
    // flight, so it carries the old attribute name). Without reconcile this
    // would revert the rename and the stale graph would be re-serialized.
    const staleModels = (await parse(BASE_SOURCE)).value;
    store.getState().loadModels(staleModels);

    expect(alphaAttrNames(store)).toEqual(['renamed', 'y']); // edit survived the stale reparse
    // One-shot: the edit was replayed onto this parse, then the patches cleared.
    // The save-triggered reparse that reflects the rename is the next parse.
    expect(store.getState().pendingEditPatches.length).toBe(0);
  });

  it('drops the pending patch once the parse has caught up to the edit', async () => {
    const alphaId = store.getState().nodes.find((n) => n.data.name === 'Alpha')!.id;
    store.getState().renameAttribute(alphaId, 'x', 'renamed');

    // The source caught up: this reparse already reflects the rename.
    const caughtUpModels = (await parse(CAUGHT_UP_SOURCE)).value;
    store.getState().loadModels(caughtUpModels);

    expect(alphaAttrNames(store)).toEqual(['renamed', 'y']);
    expect(store.getState().pendingEditPatches.length).toBe(0); // converged — no longer replayed
  });

  it('reconciles the combined updateAttribute (inspector form) across a stale reparse', async () => {
    const alphaId = store.getState().nodes.find((n) => n.data.name === 'Alpha')!.id;
    // Combined name+type+cardinality edit (the inspector form's path).
    store.getState().updateAttribute(alphaId, 'x', 'renamed', 'string', '0..1');
    expect(alphaAttrNames(store)).toEqual(['renamed', 'y']);
    expect(store.getState().pendingEditPatches.length).toBeGreaterThan(0);

    const staleModels = (await parse(BASE_SOURCE)).value; // still has x
    store.getState().loadModels(staleModels);

    expect(alphaAttrNames(store)).toEqual(['renamed', 'y']); // combined edit survived
  });

  it('preserves an in-flight attribute REMOVAL across a stale reparse', async () => {
    const alphaId = store.getState().nodes.find((n) => n.data.name === 'Alpha')!.id;
    store.getState().removeAttribute(alphaId, 'y');
    expect(alphaAttrNames(store)).toEqual(['x']);

    const staleModels = (await parse(BASE_SOURCE)).value; // still has y
    store.getState().loadModels(staleModels);

    expect(alphaAttrNames(store)).toEqual(['x']); // deletion not resurrected
  });

  it('retains consecutive child metadata edits and reorder when an older source parse completes', async () => {
    const id = store.getState().nodes.find((node) => node.data.name === 'Alpha')!.id;
    const first = store.getState().captureMetadataTarget(id, ['attributes', 0])!;
    store.getState().applyMetadataCommand(first, { kind: 'definition', value: 'First docs' });
    const state = store.getState();
    const rendered = buildSourceForNamespaces({
      nodes: state.nodes,
      edges: state.edges,
      originalSourceByNamespace: new Map([['test.reconcile', BASE_SOURCE]]),
      patches: state.pendingEditPatches,
      inversePatches: state.pendingInversePatches
    }).get('test.reconcile')!;
    const parsed = await parse(rendered);
    expect(parsed.hasErrors).toBe(false);
    store.getState().reorderAttribute(id, 0, 1);
    const second = store.getState().captureMetadataTarget(id, ['attributes', 1])!;
    store.getState().applyMetadataCommand(second, { kind: 'definition', value: 'Second docs' });
    store.getState().loadModels(parsed.value);
    expect(alphaAttrNames(store)).toEqual(['y', 'x']);
    expect(store.getState().captureMetadataTarget(id, ['attributes', 1])?.expected).toMatchObject({
      name: 'x',
      definition: 'Second docs'
    });
    expect(store.getState().captureMetadataTarget(id, ['attributes', 0])?.expected).not.toHaveProperty('definition');
  });
});
