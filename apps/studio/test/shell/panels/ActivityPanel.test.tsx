// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useContext } from 'react';
import userEvent from '@testing-library/user-event';
import { useActivityStore } from '../../../src/store/activity-store.js';
import { ActivityPanel } from '../../../src/shell/panels/ActivityPanel.js';
import {
  UtilityHeaderActionsContext,
  UtilityHeaderActionsProvider
} from '../../../src/shell/utility-header-actions-context.js';

afterEach(() => {
  cleanup();
  useActivityStore.setState({ entries: [] });
});

/** The namespace filter now lives in the dockview group header (first row),
 * published through the utility header-actions registry. This probe renders
 * the published node the way DockShell's header-actions component does. */
function HeaderActionsProbe() {
  const { actions } = useContext(UtilityHeaderActionsContext);
  return <div>{actions.get('workspace.activity') ?? null}</div>;
}

function renderActivityPanel() {
  return render(
    <UtilityHeaderActionsProvider>
      <ActivityPanel />
      <HeaderActionsProbe />
    </UtilityHeaderActionsProvider>
  );
}

describe('ActivityPanel namespace filter', () => {
  it('shows all entries by default', () => {
    useActivityStore.getState().addActivity('codegen', true, 'generated');
    useActivityStore.getState().addActivity('lsp', true, 'connected');
    renderActivityPanel();
    expect(screen.getByText('generated')).toBeInTheDocument();
    expect(screen.getByText('connected')).toBeInTheDocument();
  });

  it('filters entries and shows an empty state for an unmatched namespace', async () => {
    useActivityStore.getState().addActivity('codegen', true, 'generated');
    useActivityStore.getState().addActivity('lsp', true, 'connected');
    renderActivityPanel();
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Filter activity by namespace' }));
    await user.click(await screen.findByRole('option', { name: 'codegen', exact: true }));
    expect(screen.getByText('generated')).toBeInTheDocument();
    expect(screen.queryByText('connected')).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Filter activity by namespace' }));
    await user.click(await screen.findByRole('option', { name: 'git', exact: true }));
    expect(screen.getByText('No activity matches this filter.')).toBeInTheDocument();
  });

  it('shows local diagnostic metadata when hovering an activity entry', () => {
    useActivityStore.getState().addActivity('lsp', false, 'Connection failed', {
      op: 'mintSessionToken',
      durationMs: 123.6,
      signature: 'TypeError:abc123',
      opId: 42
    });
    renderActivityPanel();

    const tooltip = screen.getByText('Connection failed').parentElement?.getAttribute('title');
    expect(tooltip).toContain('Message: Connection failed');
    expect(tooltip).toContain('Operation: mintSessionToken');
    expect(tooltip).toContain('Duration: 124 ms');
    expect(tooltip).toContain('Signature: TypeError:abc123');
    expect(tooltip).toContain('Correlation ID: 42');
  });
});
