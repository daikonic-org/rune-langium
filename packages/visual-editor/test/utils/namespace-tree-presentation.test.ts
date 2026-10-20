// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import {
  buildSegmentedNamespaceTreeFromOptions,
  compactSegmentedNamespaceTree
} from '../../src/utils/namespace-tree.js';
import {
  namespaceTreeIndent,
  namespaceTreeScope,
  namespaceTypeLabels
} from '../../src/utils/namespace-tree-presentation.js';

const roots = compactSegmentedNamespaceTree(
  buildSegmentedNamespaceTreeFromOptions([
    { value: 'cdm.PaymentDate', label: 'PaymentDate', kind: 'func', namespace: 'cdm.product.common.schedule' },
    { value: 'event.PaymentDate', label: 'PaymentDate', kind: 'func', namespace: 'cdm.event.common.schedule' },
    { value: 'fpml.PaymentDate', label: 'PaymentDate', kind: 'data', namespace: 'fpml.shared' }
  ])
);

describe('namespace presentation', () => {
  it('uses the shortest unique suffix without changing identities', () => {
    const labels = namespaceTypeLabels(roots, true);
    expect(labels.get('cdm.PaymentDate')?.qualifier).toBe('product.common.schedule');
    expect(labels.get('event.PaymentDate')?.qualifier).toBe('event.common.schedule');
    expect(labels.get('fpml.PaymentDate')?.qualifier).toBe('shared');
    expect([...labels.keys()]).toHaveLength(3);
  });
  it('retains kind and actual IDs when namespace and display names collide', () => {
    const same = buildSegmentedNamespaceTreeFromOptions([
      { value: 'reference', label: 'Date', kind: 'data', namespace: 'model' },
      { value: 'workspace', label: 'Date', kind: 'data', namespace: 'model' },
      { value: 'function', label: 'Date', kind: 'func', namespace: 'model' }
    ]);
    const labels = namespaceTypeLabels(same, false);
    expect(labels.get('reference')?.qualifier).toBe('model · data · reference');
    expect(labels.get('workspace')?.qualifier).toBe('model · data · workspace');
    expect(labels.get('function')?.qualifier).toBe('model · func');
  });
  it('focuses compressed and intermediate ancestors without mutating the tree', () => {
    const original = JSON.stringify(roots);
    const focused = namespaceTreeScope(roots, 'cdm.product');
    expect(focused).toHaveLength(1);
    expect(focused[0]?.segment).toBe('common.schedule');
    expect(focused[0]?.fullPath).toBe('cdm.product.common.schedule');
    expect(namespaceTreeScope(roots, 'cdm.product.common.schedule')[0]?.segment).toBe('schedule');
    expect(namespaceTreeScope(roots, 'cdm.prod')).toEqual([]);
    expect(namespaceTreeScope(roots, null)).toBe(roots);
    expect(JSON.stringify(roots)).toBe(original);
  });
  it('bounds the visual step while keeping deep paths intact', () => {
    expect(namespaceTreeIndent(0)).toBe(8);
    expect(namespaceTreeIndent(1)).toBe(16);
    expect(namespaceTreeIndent(40)).toBe(48);
  });
});
