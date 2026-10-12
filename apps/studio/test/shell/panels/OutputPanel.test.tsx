// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useContext } from 'react';
import { useOutputStore } from '../../../src/store/output-store.js';
import { OutputPanel } from '../../../src/shell/panels/OutputPanel.js';
import {
  UtilityHeaderActionsProvider,
  UtilityHeaderActionsContext
} from '../../../src/shell/utility-header-actions-context.js';
import { downloadStudioDebugReport } from '../../../src/services/debug-report.js';

vi.mock('../../../src/services/debug-report.js', () => ({ downloadStudioDebugReport: vi.fn() }));
function HeaderActions() {
  const { actions } = useContext(UtilityHeaderActionsContext);
  return <>{actions.get('workspace.output')}</>;
}

afterEach(() => useOutputStore.setState({ lines: [] }));

describe('OutputPanel', () => {
  it('offers an explicit local download with source opt-in reset each time', () => {
    render(
      <UtilityHeaderActionsProvider>
        <OutputPanel />
        <HeaderActions />
      </UtilityHeaderActionsProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export debug info' }));
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Download report' }));
    expect(downloadStudioDebugReport).toHaveBeenCalledWith(null, { includeSource: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export debug info' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download report' }));
    expect(downloadStudioDebugReport).toHaveBeenLastCalledWith(null, { includeSource: false });
  });
  it('shows local diagnostic metadata when hovering an output line', () => {
    useOutputStore.getState().addLine('[preview] Validation failed', 'error', {
      op: 'preview',
      subject: 'local type',
      durationMs: 8.4,
      signature: 'Error:def456',
      opId: 9
    });
    render(
      <UtilityHeaderActionsProvider>
        <OutputPanel />
      </UtilityHeaderActionsProvider>
    );

    const tooltip = screen.getByText('✗ [preview] Validation failed').getAttribute('title');
    expect(tooltip).toContain('Message: [preview] Validation failed');
    expect(tooltip).toContain('Subject: local type');
    expect(tooltip).toContain('Duration: 8 ms');
    expect(tooltip).toContain('Signature: Error:def456');
    expect(tooltip).toContain('Correlation ID: 9');
  });
});
