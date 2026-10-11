// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from '@rune-langium/core';
import { createEditorStore } from '../../src/store/editor-store.js';
import { makeNodeId } from '../../src/store/node-projection.js';

const namespace = 'test.selection';
const originalId = makeNodeId(namespace, 'Original', 'Data');
const renamedId = makeNodeId(namespace, 'Renamed', 'Data');
const otherId = makeNodeId(namespace, 'Other', 'Data');

function source(name = 'Original'): string {
  return `namespace ${namespace}
version "1.0.0"
type ${name}:
  value string (1..1)
type Other:
  value string (1..1)
`;
}

describe('editor-store selection rekeys', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(async () => {
    store = createEditorStore({ focusMode: false });
    store.getState().loadModels((await parse(source())).value);
    store.getState().selectNode(originalId);
  });

  it('reports the selected rename atomically with the renamed node and selection', () => {
    const updates: Array<{ selected: string | null; rekey: unknown; renamedNodePresent: boolean }> = [];
    const unsubscribe = store.subscribe((state) => {
      updates.push({
        selected: state.selectedNodeId,
        rekey: state.selectionRekey,
        renamedNodePresent: state.nodesById.has(renamedId)
      });
    });

    store.getState().renameType(originalId, 'Renamed');

    expect(updates).toEqual([
      {
        selected: renamedId,
        rekey: { from: originalId, to: renamedId },
        renamedNodePresent: true
      }
    ]);
    unsubscribe();
  });

  it('composes consecutive selected renames from the last explicitly selected identity', () => {
    store.getState().renameType(originalId, 'Renamed');
    store.getState().renameType(renamedId, 'RenamedAgain');

    expect(store.getState().selectionRekey).toEqual({
      from: originalId,
      to: makeNodeId(namespace, 'RenamedAgain', 'Data'),
      intermediateIds: [renamedId]
    });
  });

  it('retains intermediate identities across three selected renames without mutating earlier mappings', () => {
    const secondRenamedId = makeNodeId(namespace, 'RenamedAgain', 'Data');
    store.getState().renameType(originalId, 'Renamed');
    store.getState().renameType(renamedId, 'RenamedAgain');
    const previousRekey = store.getState().selectionRekey;
    store.getState().renameType(secondRenamedId, 'FinalName');

    expect(store.getState().selectionRekey).toEqual({
      from: originalId,
      to: makeNodeId(namespace, 'FinalName', 'Data'),
      intermediateIds: [renamedId, secondRenamedId]
    });
    expect(previousRekey).toEqual({
      from: originalId,
      to: secondRenamedId,
      intermediateIds: [renamedId]
    });
  });

  it('records each intermediate identity only once when a rename revisits a previous name', () => {
    const secondRenamedId = makeNodeId(namespace, 'RenamedAgain', 'Data');
    store.getState().renameType(originalId, 'Renamed');
    store.getState().renameType(renamedId, 'RenamedAgain');
    store.getState().renameType(secondRenamedId, 'Renamed');
    store.getState().renameType(renamedId, 'FinalName');

    expect(store.getState().selectionRekey).toEqual({
      from: originalId,
      to: makeNodeId(namespace, 'FinalName', 'Data'),
      intermediateIds: [renamedId, secondRenamedId]
    });
  });

  it('starts a fresh rename mapping after an explicit selection of the renamed type', () => {
    store.getState().renameType(originalId, 'Renamed');
    store.getState().selectNode(renamedId);
    store.getState().renameType(renamedId, 'RenamedAgain');

    expect(store.getState().selectionRekey).toEqual({
      from: renamedId,
      to: makeNodeId(namespace, 'RenamedAgain', 'Data')
    });
  });

  it('does not mark a rename of an unselected type', () => {
    store.getState().renameType(otherId, 'UnselectedRenamed');

    expect(store.getState().selectedNodeId).toBe(originalId);
    expect(store.getState().selectionRekey).toBeUndefined();
  });

  it.each(['Original', 'Other'])('leaves selection unchanged for a no-op or colliding rename to %s', (name) => {
    const before = store.getState();

    store.getState().renameType(originalId, name);

    expect(store.getState()).toBe(before);
    expect(store.getState().selectionRekey).toBeUndefined();
  });

  it('preserves an existing rekey through unrelated edits and rejected renames', () => {
    store.getState().renameType(originalId, 'Renamed');
    const rekey = store.getState().selectionRekey;
    expect(rekey).toEqual({ from: originalId, to: renamedId });

    store.getState().renameType(otherId, 'OtherRenamed');
    store.getState().renameType(renamedId, 'OtherRenamed');
    store.getState().renameType(renamedId, 'Renamed');
    store.getState().addAttribute(renamedId, 'added', 'string', '(0..1)');

    expect(store.getState().selectionRekey).toBe(rekey);
  });

  it('clears the rekey and notifies subscribers for an explicit same-node selection', () => {
    store.getState().renameType(originalId, 'Renamed');
    const before = store.getState();
    const updates: Array<unknown> = [];
    const unsubscribe = store.subscribe((state) => updates.push(state.selectionRekey));

    store.getState().selectNode(renamedId);

    expect(store.getState()).not.toBe(before);
    expect(store.getState().selectedNodeId).toBe(renamedId);
    expect(store.getState().selectionRekey).toBeUndefined();
    expect(updates).toEqual([undefined]);
    store.getState().selectNode(renamedId);
    expect(updates).toEqual([undefined]);
    unsubscribe();
  });

  it.each([otherId, null])('clears the rekey when explicitly selecting %s', (nextId) => {
    store.getState().renameType(originalId, 'Renamed');
    expect(store.getState().selectionRekey).toBeDefined();

    store.getState().selectNode(nextId);

    expect(store.getState().selectedNodeId).toBe(nextId);
    expect(store.getState().selectionRekey).toBeUndefined();
  });

  it('clears the rekey when deleting the selected type', () => {
    store.getState().renameType(originalId, 'Renamed');
    expect(store.getState().selectionRekey).toBeDefined();

    store.getState().deleteType(renamedId);

    expect(store.getState().selectedNodeId).toBeNull();
    expect(store.getState().selectionRekey).toBeUndefined();
  });

  it('preserves the rekey when deleting a different type', () => {
    store.getState().renameType(originalId, 'Renamed');
    const rekey = store.getState().selectionRekey;
    expect(rekey).toBeDefined();

    store.getState().deleteType(otherId);

    expect(store.getState().selectedNodeId).toBe(renamedId);
    expect(store.getState().selectionRekey).toBe(rekey);
  });

  it('preserves the rekey through an in-flight parse and the following renamed model refresh', async () => {
    store.getState().renameType(originalId, 'Renamed');
    const rekey = store.getState().selectionRekey;
    expect(rekey).toEqual({ from: originalId, to: renamedId });

    store.getState().loadModels((await parse(source())).value);
    expect(store.getState().selectedNodeId).toBe(renamedId);
    expect(store.getState().selectionRekey).toBe(rekey);

    store.getState().loadModels((await parse(source('Renamed'))).value);
    expect(store.getState().selectedNodeId).toBe(renamedId);
    expect(store.getState().selectionRekey).toBe(rekey);
  });

  it('clears the rekey when a model reload removes the selected identity', async () => {
    store.getState().renameType(originalId, 'Renamed');
    store.getState().loadModels((await parse(source('Renamed'))).value);
    expect(store.getState().selectionRekey).toBeDefined();

    store.getState().loadModels((await parse(source('Replacement'))).value);

    expect(store.getState().selectedNodeId).toBeNull();
    expect(store.getState().selectionRekey).toBeUndefined();
  });

  it('does not record selection rekeys or their clearing in graph history or source patches', () => {
    store.getState().renameType(originalId, 'Renamed');
    expect(store.getState().selectionRekey).toBeDefined();
    store.getState().addAttribute(renamedId, 'added', 'string', '(0..1)');
    const pastStates = store.temporal.getState().pastStates;
    const patches = store.getState().pendingEditPatches;
    expect(pastStates.every((state) => !Object.hasOwn(state, 'selectionRekey'))).toBe(true);
    expect(patches.every((patch) => patch.path[0] === 'nodes' || patch.path[0] === 'edges')).toBe(true);

    store.getState().selectNode(renamedId);

    expect(store.temporal.getState().pastStates).toBe(pastStates);
    expect(store.getState().pendingEditPatches).toBe(patches);
  });
});
