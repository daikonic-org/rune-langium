// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useEditorStore } from '@rune-langium/visual-editor';
import { FormPreviewPanel } from '../../src/shell/panels/FormPreviewPanel.js';
import { usePreviewStore } from '../../src/store/preview-store.js';

describe('Shell FormPreviewPanel', () => {
  beforeEach(() => {
    usePreviewStore.getState().resetPreviewState();
    useEditorStore.setState({ pendingHydrationNamespaces: [], hydratedNamespaces: [] });
  });

  function selectUnavailable() {
    usePreviewStore
      .getState()
      .setAvailableTargets([{ id: 'preview.alpha.Trade', namespace: 'preview.alpha', name: 'Trade', kind: 'data' }]);
    usePreviewStore.getState().selectTarget('preview.alpha.Trade');
    usePreviewStore.getState().receivePreviewStale({
      targetId: 'preview.alpha.Trade',
      reason: 'unsupported-target',
      message: 'No schema available.'
    });
  }

  it('shows pending generation while the selected namespace hydrates and then shows the ready form', () => {
    selectUnavailable();
    useEditorStore.setState({ pendingHydrationNamespaces: ['preview.alpha'] });
    render(<FormPreviewPanel />);
    expect(screen.getByText('Generating preview for the selected type…')).toBeVisible();
    expect(screen.queryByText('No schema available.')).toBeNull();
    act(() => {
      useEditorStore.getState().markNamespacesHydrated(['preview.alpha']);
      usePreviewStore.getState().receivePreviewResult({
        schemaVersion: 1,
        targetId: 'preview.alpha.Trade',
        title: 'Trade',
        status: 'ready',
        fields: [{ path: 'id', label: 'Trade id', kind: 'string', required: true }]
      });
    });
    expect(screen.getByLabelText('Trade id')).toBeVisible();
  });

  it('restores unavailable on cancellation and does not mask unrelated hydration or genuine failures', () => {
    selectUnavailable();
    useEditorStore.setState({ pendingHydrationNamespaces: ['preview.alpha'] });
    render(<FormPreviewPanel />);
    expect(screen.getByText('Generating preview for the selected type…')).toBeVisible();
    act(() => useEditorStore.setState({ pendingHydrationNamespaces: ['other.namespace'] }));
    expect(screen.getByText('No schema available.')).toBeVisible();
    act(() => {
      useEditorStore.setState({ pendingHydrationNamespaces: ['preview.alpha'] });
      usePreviewStore.getState().receivePreviewStale({
        targetId: 'preview.alpha.Trade',
        reason: 'generation-error',
        message: 'Worker failed.'
      });
    });
    expect(screen.getByText('Worker failed.')).toBeVisible();
  });

  it('renders the selected target form without raw source metadata', () => {
    usePreviewStore.getState().setAvailableTargets([
      {
        id: 'preview.alpha.Trade',
        namespace: 'preview.alpha',
        name: 'Trade',
        kind: 'data'
      }
    ]);
    usePreviewStore.getState().selectTarget('preview.alpha.Trade');
    usePreviewStore.getState().receivePreviewResult({
      schemaVersion: 1,
      targetId: 'preview.alpha.Trade',
      title: 'Trade',
      status: 'ready',
      fields: [
        {
          path: 'tradeId',
          label: 'Trade id',
          kind: 'string',
          required: true
        }
      ],
      sourceMap: [
        {
          fieldPath: 'tradeId',
          sourceUri: 'file:///workspace/preview-alpha.rosetta',
          sourceLine: 7,
          sourceChar: 2
        }
      ]
    });

    render(<FormPreviewPanel />);

    expect(screen.getByText('Trade')).toBeInTheDocument();
    expect(screen.getByLabelText('Trade id')).toBeInTheDocument();
    expect(screen.queryByText(/preview-alpha\.rosetta:7:2/i)).not.toBeInTheDocument();
  });
});
