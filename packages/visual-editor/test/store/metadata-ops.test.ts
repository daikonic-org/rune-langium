// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { loadInspectorFixture } from '../helpers/inspector-fixture.js';
import { createAnnotationDraft, createSynonymDraft } from '../../src/store/metadata-ops.js';

describe('canonical metadata mutations', () => {
  it('commits one child edit with one history entry and preserves undo', async () => {
    const { store, getNode } = await loadInspectorFixture();
    const id = getNode('Person').id;
    const actions = store.getState();
    const target = actions.captureMetadataTarget(id, ['attributes', 0])!;
    const history = store.temporal.getState().pastStates.length;
    expect(actions.applyMetadataCommand(target, { kind: 'definition', value: 'Full name' })).toEqual({
      status: 'committed'
    });
    expect(store.getState().pendingEditPatches.at(-1)?.path).toEqual([
      'nodes',
      id,
      'data',
      'attributes',
      0,
      'definition'
    ]);
    expect(store.temporal.getState().pastStates).toHaveLength(history + 1);
    expect(getNode('Person').data).not.toHaveProperty('definition');
    store.temporal.getState().undo();
    expect(store.getState().captureMetadataTarget(id, ['attributes', 0])?.expected.definition).toBeUndefined();
  });
  it('rejects stale, invalid, unsupported and read-only commands without history changes', async () => {
    const { store, getNode } = await loadInspectorFixture();
    const id = getNode('Person').id;
    const target = store.getState().captureMetadataTarget(id, ['attributes', 0])!;
    const before = store.temporal.getState().pastStates.length;
    expect(store.getState().applyMetadataCommand(target, { kind: 'display', value: 'label' })).toEqual({
      status: 'unsupported'
    });
    expect(
      store.getState().applyMetadataCommand(target, {
        kind: 'append',
        field: 'annotations',
        value: { $type: 'RosettaClassSynonym', sources: [] }
      }).status
    ).toBe('invalid');
    expect(store.temporal.getState().pastStates).toHaveLength(before);
    store.getState().reorderAttribute(id, 0, 1);
    expect(store.getState().applyMetadataCommand(target, { kind: 'definition', value: 'wrong' })).toEqual({
      status: 'stale'
    });
    store.setState({
      nodesById: new Map(store.getState().nodesById).set(id, {
        ...getNode('Person'),
        meta: { ...getNode('Person').meta, isReadOnly: true }
      })
    });
    const readonlyTarget = store.getState().captureMetadataTarget(id, [])!;
    expect(store.getState().applyMetadataCommand(readonlyTarget, { kind: 'definition', value: 'wrong' })).toEqual({
      status: 'readOnly'
    });
  });
  it('retains rich annotation fields and refuses stale chip removal', async () => {
    const { store, getNode } = await loadInspectorFixture();
    const id = getNode('Person').id;
    const annotation = createAnnotationDraft('other.tag', 'other.field', [
      { $type: 'AnnotationQualifier', qualName: 'scheme', qualValue: 'ISIN' }
    ]);
    let target = store.getState().captureMetadataTarget(id, ['attributes', 0])!;
    expect(
      store.getState().applyMetadataCommand(target, { kind: 'append', field: 'annotations', value: annotation }).status
    ).toBe('committed');
    target = store.getState().captureMetadataTarget(id, ['attributes', 0])!;
    expect(
      store
        .getState()
        .applyMetadataCommand(target, { kind: 'remove', field: 'annotations', index: -1, expected: annotation }).status
    ).toBe('stale');
    const edited = { ...annotation, annotation: { $refText: 'other.updated' } };
    expect(
      store.getState().applyMetadataCommand(target, {
        kind: 'replace',
        field: 'annotations',
        index: 0,
        expected: annotation,
        value: edited
      }).status
    ).toBe('committed');
    expect(store.getState().captureMetadataTarget(id, ['attributes', 0])?.expected).toMatchObject({
      annotations: [{ attribute: { $refText: 'other.field' }, qualifiers: [{ qualValue: 'ISIN' }] }]
    });
  });
  it('uses canonical synonym variants and preserves optional enum display through undo', async () => {
    expect(createSynonymDraft('class', 'other.FpML', 'Trade')).toMatchObject({
      $type: 'RosettaClassSynonym',
      value: { name: 'Trade' }
    });
    expect(createSynonymDraft('body', 'other.FpML', 'Manager')).toMatchObject({
      $type: 'RosettaSynonym',
      body: { values: [{ name: 'Manager' }] }
    });
    expect(createSynonymDraft('enumValue', 'other.FpML', 'Manager')).toMatchObject({
      $type: 'RosettaEnumSynonym',
      synonymValue: 'Manager'
    });
    expect(createSynonymDraft('body', 'other.FpML', '')).toBeUndefined();
    const { store, getNode } = await loadInspectorFixture();
    const id = getNode('RoleEnum').id;
    const apply = (value: string | undefined) =>
      store.getState().applyMetadataCommand(store.getState().captureMetadataTarget(id, ['enumValues', 0])!, {
        kind: 'display',
        value
      });
    expect(apply('Account manager').status).toBe('committed');
    expect(apply(undefined).status).toBe('committed');
    store.temporal.getState().undo();
    expect(store.getState().captureMetadataTarget(id, ['enumValues', 0])?.expected).toMatchObject({
      name: 'Manager',
      display: 'Account manager'
    });
  });
});
