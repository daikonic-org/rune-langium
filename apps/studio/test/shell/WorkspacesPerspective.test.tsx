// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkspacesPerspective } from '../../src/shell/perspectives/screens/WorkspacesPerspective.js';
import {
  WorkspaceActionsContext,
  type WorkspaceActions
} from '../../src/shell/perspectives/workspace-actions-context.js';

// ---------------------------------------------------------------------------
// Mock the three heavy children so jsdom doesn't need real OPFS / IDB / LSP.
// We assert that WorkspacesPerspective wires the right props from context.
// ---------------------------------------------------------------------------

vi.mock('../../src/components/FileLoader.js', () => ({
  FileLoader: vi.fn((props: Record<string, unknown>) => (
    <div
      data-testid="file-loader"
      data-has-on-files-loaded={String(typeof props['onFilesLoaded'] === 'function')}
      data-has-create-git={String(typeof props['createGitBackedWorkspace'] === 'function')}
      data-has-on-gh-created={String(typeof props['onGitHubWorkspaceCreated'] === 'function')}
    />
  ))
}));

vi.mock('../../src/components/WorkspaceSwitcher.js', () => ({
  WorkspaceSwitcher: vi.fn((props: Record<string, unknown>) => (
    <div
      data-testid="workspace-switcher"
      data-has-on-open={String(typeof props['onOpen'] === 'function')}
      data-has-on-create={String(typeof props['onCreate'] === 'function')}
      data-has-on-delete={String(typeof props['onDelete'] === 'function')}
    />
  ))
}));

vi.mock('../../src/components/ModelLoader.js', () => ({
  ModelLoader: vi.fn(() => <div data-testid="model-loader" />)
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActions(overrides?: Partial<WorkspaceActions>): WorkspaceActions {
  return {
    files: [],
    onFilesLoaded: vi.fn(),
    createGitBackedWorkspace: vi.fn().mockResolvedValue({ id: 'ws-1' }),
    onGitHubWorkspaceCreated: vi.fn(),
    onOpenWorkspace: vi.fn(),
    onCreateWorkspace: vi.fn(),
    onDeleteWorkspace: vi.fn(),
    ...overrides
  };
}

function renderWithActions(actions: WorkspaceActions) {
  return render(
    <WorkspaceActionsContext.Provider value={actions}>
      <WorkspacesPerspective />
    </WorkspaceActionsContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspacesPerspective', () => {
  let actions: WorkspaceActions;

  beforeEach(() => {
    actions = makeActions();
  });

  it('renders the root container with data-testid="workspaces-perspective"', () => {
    renderWithActions(actions);
    expect(screen.getByTestId('workspaces-perspective')).toBeTruthy();
  });

  it('renders FileLoader wired to context handlers', () => {
    renderWithActions(actions);
    const loader = screen.getByTestId('file-loader');
    expect(loader.dataset['hasOnFilesLoaded']).toBe('true');
    expect(loader.dataset['hasCreateGit']).toBe('true');
    expect(loader.dataset['hasOnGhCreated']).toBe('true');
  });

  it('renders WorkspaceSwitcher wired to context handlers', () => {
    renderWithActions(actions);
    const switcher = screen.getByTestId('workspace-switcher');
    expect(switcher.dataset['hasOnOpen']).toBe('true');
    expect(switcher.dataset['hasOnCreate']).toBe('true');
    expect(switcher.dataset['hasOnDelete']).toBe('true');
  });

  it('omits the legacy model loader from the unified reference surface', () => {
    renderWithActions(actions);
    expect(screen.queryByTestId('model-loader')).toBeNull();
  });

  it('throws when rendered without a WorkspaceActionsContext provider', () => {
    // React will catch the error in a boundary; we can detect via console.error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<WorkspacesPerspective />)).toThrow(
      /useWorkspaceActions must be used within a WorkspaceActionsContext provider/
    );
    spy.mockRestore();
  });
});
