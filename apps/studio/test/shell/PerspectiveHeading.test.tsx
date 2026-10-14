// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useEditorStore, type TypeGraphNode } from '@rune-langium/visual-editor';

vi.mock('../../src/shell/perspectives/perspective-registry.js', () => ({
  PERSPECTIVES: [
    { id: 'explore', label: 'Explore', icon: () => null },
    { id: 'export', label: 'Export', icon: () => null }
  ]
}));

import { PerspectiveHeading } from '../../src/shell/perspectives/PerspectiveHeading.js';

const original = useEditorStore.getState();
afterEach(() => {
  useEditorStore.setState({ nodesById: original.nodesById, selectedNodeId: original.selectedNodeId });
});

it('shows canonical selection after the heading without a design preview and clears when selection disappears', () => {
  const node: TypeGraphNode = {
    id: 'cdm.base.math.Rounding#RosettaEnumeration',
    position: { x: 0, y: 0 },
    data: { $type: 'RosettaEnumeration', name: 'Rounding', enumValues: [] },
    meta: { namespace: 'cdm.base.math', errors: [], hasExternalRefs: false }
  };
  useEditorStore.setState({ nodesById: new Map([[node.id, node]]), selectedNodeId: node.id });
  const { rerender } = render(<PerspectiveHeading perspectiveId="explore" />);
  const path = screen.getByRole('navigation', { name: 'Explore location' });
  expect(path).toHaveAttribute('title', 'cdm / base / math / Rounding');
  expect(path.querySelector('[aria-current="location"]')).toHaveTextContent('Rounding');
  expect(
    screen.getByRole('heading', { name: 'Explore' }).compareDocumentPosition(path) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
  const sameNameInAnotherNamespace = {
    ...node,
    id: 'other.math.Rounding#RosettaEnumeration',
    meta: { ...node.meta, namespace: 'other.math' }
  };
  act(() =>
    useEditorStore.setState({
      nodesById: new Map([[sameNameInAnotherNamespace.id, sameNameInAnotherNamespace]]),
      selectedNodeId: sameNameInAnotherNamespace.id
    })
  );
  expect(screen.getByRole('navigation', { name: 'Explore location' })).toHaveAttribute(
    'title',
    'other / math / Rounding'
  );
  rerender(<PerspectiveHeading perspectiveId="export" />);
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  rerender(<PerspectiveHeading perspectiveId="explore" />);
  act(() => useEditorStore.setState({ selectedNodeId: null }));
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
});

it('omits a stale selection and shows an unqualified declaration without an empty namespace segment', () => {
  const node: TypeGraphNode = {
    id: 'Status#RosettaEnumeration',
    position: { x: 0, y: 0 },
    data: { $type: 'RosettaEnumeration', name: 'Status', enumValues: [] },
    meta: { namespace: '', errors: [], hasExternalRefs: false }
  };
  useEditorStore.setState({ nodesById: new Map([[node.id, node]]), selectedNodeId: 'missing.Type#Data' });
  render(<PerspectiveHeading perspectiveId="explore" />);
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  act(() => useEditorStore.setState({ selectedNodeId: node.id }));
  expect(screen.getByRole('navigation', { name: 'Explore location' })).toHaveAttribute('title', 'Status');
});
