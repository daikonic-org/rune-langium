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
import { reconcileParse } from '../../src/store/edit-reconcile.js';
import { getMetadataItems, updateSynonymDraft } from '../../src/store/metadata-ops.js';
import { readAtMetadataPath, type MetadataPath } from '../../src/store/metadata-target.js';
import { loadInspectorFixture } from '../helpers/inspector-fixture.js';

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

it.each(['annotation', 'class synonym', 'body synonym', 'enum synonym'] as const)(
  'retires a length-changing %s replacement and preserves later Source edits',
  async (kind) => {
    const source = `namespace test.reconcile
synonym source FpML
annotation marking:
  scheme string (1..1)
type Alpha:
  [synonym FpML value "oldClass"]
  // field owner
  x string (1..1) [marking scheme "scheme"="oldAnnotation"] [synonym FpML value "oldBody"]
enum Role:
  Value [synonym FpML value "oldEnum"]
`;
    const { store, getNode } = await loadInspectorFixture(source);
    const id = getNode(kind === 'enum synonym' ? 'Role' : 'Alpha').id;
    const path: MetadataPath =
      kind === 'class synonym' ? [] : kind === 'enum synonym' ? ['enumValues', 0] : ['attributes', 0];
    const field = kind === 'annotation' ? 'annotations' : kind === 'enum synonym' ? 'enumSynonyms' : 'synonyms';
    const target = store.getState().captureMetadataTarget(id, path)!;
    const original = getMetadataItems(target.expected, field)[0]!;
    const inspectorValue = 'A much longer Inspector value';
    const value =
      original.$type === 'AnnotationRef'
        ? {
            ...original,
            qualifiers: original.qualifiers.map((qualifier) => ({ ...qualifier, qualValue: inspectorValue }))
          }
        : updateSynonymDraft(original, { value: inspectorValue });
    expect(
      store.getState().applyMetadataCommand(target, { kind: 'replace', field, index: 0, expected: original, value })
        .status
    ).toBe('committed');
    const edited = store.getState();
    const output = buildSourceForNamespaces({
      nodes: edited.nodes,
      edges: edited.edges,
      originalSourceByNamespace: new Map([['test.reconcile', source]]),
      patches: edited.pendingEditPatches,
      inversePatches: edited.pendingInversePatches
    }).get('test.reconcile')!;
    expect(output).toContain(inspectorValue);
    expect(output.split('field owner')).toHaveLength(2);
    const caughtUp = await loadInspectorFixture(output);
    const freshItem = getMetadataItems(caughtUp.store.getState().captureMetadataTarget(id, path)!.expected, field)[0]!;
    expect(freshItem.$cstRange).not.toEqual(original.$cstRange);
    const reconciled = reconcileParse(
      caughtUp.store.getState().nodes,
      caughtUp.store.getState().edges,
      edited.pendingEditPatches
    );
    expect(reconciled.remainingPatches).toEqual([]);
    const owner = readAtMetadataPath(reconciled.nodesById.get(id)!.data, path)!;
    expect(getMetadataItems(owner, field)[0]?.$cstRange).toEqual(freshItem.$cstRange);

    const sourceEdit = output.replace(inspectorValue, 'Source value');
    const later = await loadInspectorFixture(sourceEdit);
    const afterSource = reconcileParse(
      later.store.getState().nodes,
      later.store.getState().edges,
      reconciled.remainingPatches
    );
    const laterOwner = readAtMetadataPath(afterSource.nodesById.get(id)!.data, path)!;
    expect(getMetadataItems(laterOwner, field)[0]).toEqual(
      getMetadataItems(later.store.getState().captureMetadataTarget(id, path)!.expected, field)[0]
    );
    expect(
      buildSourceForNamespaces({
        nodes: [...afterSource.nodesById.values()],
        edges: [...afterSource.edgesById.values()],
        originalSourceByNamespace: new Map([['test.reconcile', sourceEdit]]),
        patches: afterSource.remainingPatches
      }).get('test.reconcile')
    ).toBe(sourceEdit);

    // The production store also clears replay intent after loading a parse.
    // A caught-up parse must retain fresh ranges, rather than replay old coordinates once.
    store.getState().loadModels((await parse(output)).value);
    expect(getMetadataItems(store.getState().captureMetadataTarget(id, path)!.expected, field)[0]?.$cstRange).toEqual(
      freshItem.$cstRange
    );
    store.getState().loadModels((await parse(sourceEdit)).value);
    expect(getMetadataItems(store.getState().captureMetadataTarget(id, path)!.expected, field)[0]).toEqual(
      getMetadataItems(later.store.getState().captureMetadataTarget(id, path)!.expected, field)[0]
    );
  }
);

it('retires an optional enum display clear and preserves a later Source display name', async () => {
  const source = 'namespace test.reconcile\nenum Role:\n  Value displayName "Original label"\n';
  const { store, getNode } = await loadInspectorFixture(source);
  const id = getNode('Role').id;
  const path = ['enumValues', 0] as const;
  const target = store.getState().captureMetadataTarget(id, path)!;
  expect(store.getState().applyMetadataCommand(target, { kind: 'display', value: undefined }).status).toBe('committed');
  const edited = store.getState();
  const output = buildSourceForNamespaces({
    nodes: edited.nodes,
    edges: edited.edges,
    originalSourceByNamespace: new Map([['test.reconcile', source]]),
    patches: edited.pendingEditPatches,
    inversePatches: edited.pendingInversePatches
  }).get('test.reconcile')!;
  expect(output).not.toContain('displayName');
  const caughtUp = await loadInspectorFixture(output);
  const reconciled = reconcileParse(
    caughtUp.store.getState().nodes,
    caughtUp.store.getState().edges,
    edited.pendingEditPatches
  );
  expect(reconciled.remainingPatches).toEqual([]);
  const sourceEdit = output.replace('Value', 'Value displayName "Source label"');
  const later = await loadInspectorFixture(sourceEdit);
  const next = reconcileParse(later.store.getState().nodes, later.store.getState().edges, reconciled.remainingPatches);
  expect(readAtMetadataPath(next.nodesById.get(id)!.data, path)).toMatchObject({ display: 'Source label' });
  expect(
    buildSourceForNamespaces({
      nodes: [...next.nodesById.values()],
      edges: [...next.edgesById.values()],
      originalSourceByNamespace: new Map([['test.reconcile', sourceEdit]]),
      patches: next.remainingPatches
    }).get('test.reconcile')
  ).toBe(sourceEdit);
  store.getState().loadModels((await parse(output)).value);
  store.getState().loadModels((await parse(sourceEdit)).value);
  expect(store.getState().captureMetadataTarget(id, path)!.expected).toMatchObject({ display: 'Source label' });
});

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

it.each(['data', 'precondition', 'postcondition', 'numeric', 'unnamed'] as const)(
  'does not replay an already parsed %s condition added from a draft',
  async (kind) => {
    const source =
      kind === 'data' || kind === 'numeric' || kind === 'unnamed'
        ? 'namespace test.reconcile\ntype Alpha:\n x string (1..1)\n condition Existing: x exists\n'
        : 'namespace test.reconcile\nfunc Alpha:\n inputs: x string (1..1)\n output: result string (1..1)\n condition Existing: x exists\n set result: x\n';
    const { store, getNode } = await loadInspectorFixture(source);
    const id = getNode('Alpha').id;
    store.getState().addCondition(id, {
      name: kind === 'unnamed' ? undefined : 'Present',
      expressionText: kind === 'numeric' ? 'x count > 0' : 'x  exists',
      isPostCondition: kind === 'postcondition'
    });
    const edited = store.getState();
    const output = buildSourceForNamespaces({
      nodes: edited.nodes,
      edges: edited.edges,
      originalSourceByNamespace: new Map([['test.reconcile', source]]),
      patches: edited.pendingEditPatches,
      inversePatches: edited.pendingInversePatches
    }).get('test.reconcile')!;
    const caughtUp = await loadInspectorFixture(output);
    const reconciled = reconcileParse(
      caughtUp.store.getState().nodes,
      caughtUp.store.getState().edges,
      edited.pendingEditPatches
    );
    const data = reconciled.nodesById.get(id)!.data as {
      conditions: Array<{ name?: string }>;
      postConditions?: Array<{ name?: string }>;
    };
    expect([...data.conditions, ...(data.postConditions ?? [])].map((condition) => condition.name)).toEqual([
      'Existing',
      kind === 'unnamed' ? undefined : 'Present'
    ]);
    expect(reconciled.remainingPatches).toEqual([]);
    store.getState().loadModels((await parse(output)).value);
    const reloaded = getNode('Alpha').data as typeof data;
    expect([...reloaded.conditions, ...(reloaded.postConditions ?? [])]).toHaveLength(2);
  }
);
