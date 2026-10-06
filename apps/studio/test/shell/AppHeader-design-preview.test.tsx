// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useDesignPreviewStore } from '../../src/store/design-preview-store.js';

const action = vi.fn();
vi.mock('../../src/shell/perspectives/perspective-registry.js', () => ({
  resolveEffectivePerspective: () => 'explore',
  PERSPECTIVES: [
    {
      id: 'explore',
      requiresWorkspace: true,
      centerSlot: () => <span>active.rosetta</span>,
      actions: () => <button onClick={action}>Export code</button>
    }
  ]
}));
vi.mock('../../src/shell/providers/workspace-context.js', () => ({
  useWorkspaceOptional: () => ({ workspaceName: 'Model workspace', fileCount: 2, workspaceId: 'test' })
}));
vi.mock('../../src/shell/perspectives/workspace-actions-context.js', () => ({
  useWorkspaceActionsOptional: () => ({})
}));
vi.mock('../../src/shell/GlobalSearch.js', () => ({ GlobalSearch: () => <button>Search</button> }));

import { AppHeader } from '../../src/shell/AppHeader.js';

const originalWidth = window.innerWidth;
afterEach(() => {
  useDesignPreviewStore.getState().reset();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
  action.mockClear();
});

describe('top-bar design preview', () => {
  it('keeps workspace/file context and search visible while moving actions to reachable overflow', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 });
    useDesignPreviewStore.getState().setPreference('header', true);
    render(<AppHeader hasWorkspace hasExploreContent />);
    expect(screen.getByRole('button', { name: 'Workspace menu — Model workspace' })).toBeInTheDocument();
    expect(screen.getByText('active.rosetta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export code' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Workspace actions' }));
    await user.click(screen.getByRole('button', { name: 'Export code' }));
    expect(action).toHaveBeenCalledOnce();
    await user.keyboard('{Escape}');
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 });
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.queryByRole('button', { name: 'Workspace actions' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export code' })).toBeInTheDocument();
  });
});
