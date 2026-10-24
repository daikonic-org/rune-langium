// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActivityBar } from '../../src/shell/ActivityBar.js';
import { usePerspectiveStore } from '../../src/store/perspective-store.js';

describe('ActivityBar (perspective rail)', () => {
  beforeEach(() => usePerspectiveStore.setState({ activePerspective: 'workspaces' }));

  it('renders a button per perspective', () => {
    render(<ActivityBar hasWorkspace />);
    for (const label of ['Explore', 'Workspaces', 'Git / Sync', 'Export / Packaging', 'Settings']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });
  it('clicking a perspective sets it active', () => {
    render(<ActivityBar hasWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: 'Git / Sync' }));
    expect(usePerspectiveStore.getState().activePerspective).toBe('git');
  });
  it('marks the active perspective aria-pressed', () => {
    usePerspectiveStore.setState({ activePerspective: 'git' });
    render(<ActivityBar hasWorkspace />);
    expect(screen.getByRole('button', { name: 'Git / Sync' }).getAttribute('aria-pressed')).toBe('true');
  });
  it('disables requiresWorkspace perspectives when no workspace', () => {
    render(<ActivityBar hasWorkspace={false} />);
    expect((screen.getByRole('button', { name: 'Explore' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Workspaces' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
