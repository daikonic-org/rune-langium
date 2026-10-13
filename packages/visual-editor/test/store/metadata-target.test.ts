// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { loadInspectorFixture } from '../helpers/inspector-fixture.js';
import {
  captureMetadataTarget,
  resolveMetadataTarget,
  getMetadataCapabilities
} from '../../src/store/metadata-target.js';

describe('Inspector metadata ownership', () => {
  it('captures canonical root and child objects and rejects an old epoch', async () => {
    const { store, getNode } = await loadInspectorFixture();
    const id = getNode('Person').id;
    const target = captureMetadataTarget(store.getState(), id, ['attributes', 0])!;
    expect(target.expected).toMatchObject({ name: 'name' });
    expect(resolveMetadataTarget(store.getState(), target)).toBe(target.expected);
    expect(captureMetadataTarget(store.getState(), id, [])?.expected).toBe(getNode('Person').data);
    store.setState({ parseEpoch: store.getState().parseEpoch + 1 });
    expect(resolveMetadataTarget(store.getState(), target)).toBeUndefined();
  });
  it('rejects a reordered or deleted child rather than reusing its index/name', async () => {
    const { store, getNode } = await loadInspectorFixture();
    const id = getNode('Person').id;
    const target = captureMetadataTarget(store.getState(), id, ['attributes', 0])!;
    store.getState().reorderAttribute(id, 0, 1);
    expect(resolveMetadataTarget(store.getState(), target)).toBeUndefined();
    const reordered = captureMetadataTarget(store.getState(), id, ['attributes', 1])!;
    expect(reordered.expected).toMatchObject({ name: 'name' });
    store.getState().removeAttribute(id, 'name');
    store.getState().addAttribute(id, 'name', 'string', '0..1');
    expect(resolveMetadataTarget(store.getState(), reordered)).toBeUndefined();
  });
  it('validates owner kinds and array bounds', async () => {
    const { store, getNode } = await loadInspectorFixture();
    const id = getNode('Person').id;
    for (const index of [-1, NaN, Infinity, 0.5, 100])
      expect(captureMetadataTarget(store.getState(), id, ['attributes', index])).toBeUndefined();
    expect(captureMetadataTarget(store.getState(), id, ['enumValues', 0])).toBeUndefined();
    expect(
      captureMetadataTarget(store.getState(), getNode('ResolveEmployee').id, ['inputs', 0])?.expected
    ).toMatchObject({ name: 'id' });
    expect(captureMetadataTarget(store.getState(), getNode('ResolveEmployee').id, ['output'])?.expected).toMatchObject({
      name: 'result'
    });
  });
  it('derives enum display and child metadata capabilities from declared schema fields', async () => {
    const { store, getNode } = await loadInspectorFixture();
    const member = captureMetadataTarget(store.getState(), getNode('RoleEnum').id, ['enumValues', 0])!.expected;
    expect(getMetadataCapabilities(member)).toMatchObject({
      display: true,
      definition: true,
      annotations: true,
      synonymField: 'enumSynonyms',
      synonymKind: 'enumValue'
    });
    const attr = captureMetadataTarget(store.getState(), getNode('Person').id, ['attributes', 0])!.expected;
    expect(getMetadataCapabilities(attr)).toMatchObject({ display: false, synonymKind: 'body' });
  });
});
