// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useEditorStore, type TypeGraphNode } from '@rune-langium/visual-editor';
import { useDesignPreviewStore } from '../../src/store/design-preview-store.js';

vi.mock('../../src/shell/perspectives/perspective-registry.js', () => ({
  PERSPECTIVES: [
    { id: 'explore', label: 'Explore', icon: () => null },
    { id: 'export', label: 'Export', icon: () => null }
  ]
}));

import { PerspectiveHeading } from '../../src/shell/perspectives/PerspectiveHeading.js';

const original = useEditorStore.getState();
afterEach(() => {
  useDesignPreviewStore.getState().reset();
  useEditorStore.setState({ nodesById: original.nodesById, selectedNodeId: original.selectedNodeId });
});

it('follows canonical selection after the heading and clears when selection disappears', () => {
  const node: TypeGraphNode = {
    id: 'cdm.base.math.Rounding',
    position: { x: 0, y: 0 },
    data: { $type: 'RosettaEnumeration', name: 'Rounding', enumValues: [] },
    meta: { namespace: 'cdm.base.math', errors: [], hasExternalRefs: false }
  };
  useEditorStore.setState({ nodesById: new Map([[node.id, node]]), selectedNodeId: node.id });
  const { rerender } = render(<PerspectiveHeading perspectiveId="explore" />);
  expect(screen.queryByRole('navigation', { name: 'Explore location' })).not.toBeInTheDocument();
  act(() => useDesignPreviewStore.getState().setPreference('path', true));
  const path = screen.getByRole('navigation', { name: 'Explore location' });
  expect(path).toHaveAttribute('title', 'cdm / base / math / Enum / Rounding');
  expect(path.querySelector('[aria-current="location"]')).toHaveTextContent('Rounding');
  expect(
    screen.getByRole('heading', { name: 'Explore' }).compareDocumentPosition(path) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
  rerender(<PerspectiveHeading perspectiveId="export" />);
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  rerender(<PerspectiveHeading perspectiveId="explore" />);
  act(() => useEditorStore.setState({ selectedNodeId: null }));
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
});
