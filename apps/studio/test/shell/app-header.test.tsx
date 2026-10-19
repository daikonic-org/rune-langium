// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PERSPECTIVES } from '../../src/shell/perspectives/perspective-registry.js';
import { usePerspectiveStore } from '../../src/store/perspective-store.js';
import { AppHeader } from '../../src/shell/AppHeader.js';
import { PerspectiveHeading } from '../../src/shell/perspectives/PerspectiveHeading.js';
import { WorkspaceStateContext, type WorkspaceState } from '../../src/shell/providers/workspace-context.js';
import {
  WorkspaceActionsContext,
  type WorkspaceActions
} from '../../src/shell/perspectives/workspace-actions-context.js';
import { LspContext, type LspContextValue } from '../../src/shell/providers/lsp-context.js';
import { GitSyncPerspective } from '../../src/shell/perspectives/screens/GitSyncPerspective.js';
import { ExportPerspective } from '../../src/shell/perspectives/screens/ExportPerspective.js';
import { SettingsPerspective } from '../../src/shell/perspectives/screens/SettingsPerspective.js';

const noop = () => {};

function makeWorkspaceState(overrides?: Partial<WorkspaceState>): WorkspaceState {
  return {
    workspaceId: 'ws-1',
    workspaceKind: 'browser-only',
    workspaceName: 'Test workspace',
    fileCount: 1,
    files: [{ path: 'a.rosetta', name: 'a.rosetta', content: 'namespace a', dirty: false }],
    models: [],
    parsedModels: [],
    deferredExports: [],
    parseErrors: new Map(),
    ...overrides
  };
}

function makeWorkspaceActions(overrides?: Partial<WorkspaceActions>): WorkspaceActions {
  return {
    files: [],
    onFilesLoaded: noop,
    createGitBackedWorkspace: async () => ({ id: 'ws-1' }),
    onGitHubWorkspaceCreated: noop,
    onOpenWorkspace: noop,
    onCreateWorkspace: noop,
    onDeleteWorkspace: noop,
    onFilesChange: noop,
    onClose: noop,
    onSwitchWorkspace: noop,
    ...overrides
  };
}

const lspValue: LspContextValue = { lspClient: null, transportState: undefined, reconnect: noop };

interface RenderAppHeaderOptions {
  workspaceStateOverrides?: Partial<WorkspaceState>;
  /** Default true — the passthrough case (a workspace/explore content is
   *  present, so resolveEffectivePerspective doesn't fall back). */
  hasWorkspace?: boolean;
  hasExploreContent?: boolean;
}

function renderAppHeaderWithWorkspace(options: RenderAppHeaderOptions = {}) {
  const { workspaceStateOverrides, hasWorkspace = true, hasExploreContent = true } = options;
  return render(
    <WorkspaceActionsContext.Provider value={makeWorkspaceActions()}>
      <WorkspaceStateContext.Provider value={makeWorkspaceState(workspaceStateOverrides)}>
        <LspContext.Provider value={lspValue}>
          <AppHeader hasWorkspace={hasWorkspace} hasExploreContent={hasExploreContent} />
        </LspContext.Provider>
      </WorkspaceStateContext.Provider>
    </WorkspaceActionsContext.Provider>
  );
}

/** Passthrough-case AppHeader (no workspace context) — used by tests that
 *  don't care about workspace/switcher rendering. */
function renderAppHeader(props: Partial<{ hasWorkspace: boolean; hasExploreContent: boolean }> = {}) {
  return render(
    <AppHeader hasWorkspace={props.hasWorkspace ?? true} hasExploreContent={props.hasExploreContent ?? true} />
  );
}

describe('perspective registry chrome contract', () => {
  it('every non-explore perspective declares a bar title', () => {
    for (const p of PERSPECTIVES.filter((p) => p.id !== 'explore')) {
      expect(p.title, `${p.id} needs a title`).toBeTruthy();
    }
  });
  it('showsFileTabs is retired', () => {
    for (const p of PERSPECTIVES) {
      expect('showsFileTabs' in p, `${p.id} still carries showsFileTabs`).toBe(false);
    }
  });
  it('each perspective has one accessible page heading in the shared chrome', () => {
    for (const perspective of PERSPECTIVES) {
      const { unmount } = render(<PerspectiveHeading perspectiveId={perspective.id} />);
      expect(
        screen.getByRole('heading', { level: 1, name: perspective.title ?? perspective.label })
      ).toBeInTheDocument();
      unmount();
    }
  });
});

describe('AppHeader', () => {
  afterEach(() => {
    cleanup();
    usePerspectiveStore.getState().setActivePerspective('workspaces');
  });

  it('renders exactly one app-header for a non-explore perspective', () => {
    usePerspectiveStore.getState().setActivePerspective('git');
    renderAppHeader();
    expect(screen.getAllByTestId('app-header')).toHaveLength(1);
  });

  it('does NOT render the perspective title in the topbar — it lives in the chrome row below (PerspectiveHeading)', () => {
    usePerspectiveStore.getState().setActivePerspective('git');
    renderAppHeader();
    expect(screen.queryByText('Git / Sync')).not.toBeInTheDocument();
  });

  it('Explore renders the FileTabStrip and the model-actions cluster', () => {
    usePerspectiveStore.getState().setActivePerspective('explore');
    renderAppHeaderWithWorkspace();
    // Exact match (issue #405): the tab strip now also renders a "Delete
    // a.rosetta" button per tab, which a substring regex here would also
    // match — the tab itself has an aria-label of exactly "a.rosetta".
    expect(screen.getByRole('button', { name: 'a.rosetta DSL' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByText('Import')).toBeInTheDocument();
  });

  it('non-Explore perspectives render neither the FileTabStrip nor Explore actions', () => {
    usePerspectiveStore.getState().setActivePerspective('git');
    renderAppHeaderWithWorkspace();
    expect(screen.queryByRole('button', { name: 'a.rosetta DSL' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Validate' })).not.toBeInTheDocument();
    expect(screen.queryByText('Import')).not.toBeInTheDocument();
  });

  it('renders exactly one .studio-topbar in every perspective', () => {
    for (const p of PERSPECTIVES) {
      usePerspectiveStore.getState().setActivePerspective(p.id);
      const { container, unmount } = renderAppHeaderWithWorkspace();
      expect(
        container.querySelectorAll('.studio-topbar'),
        `${p.id} should render exactly one .studio-topbar`
      ).toHaveLength(1);
      unmount();
    }
  });

  it('settings renders with NO workspace and does not throw; switcher hidden', () => {
    usePerspectiveStore.getState().setActivePerspective('settings');
    expect(() => renderAppHeader()).not.toThrow();
    expect(screen.queryByLabelText(/Workspace menu/)).not.toBeInTheDocument();
    // Title moved out of the topbar into the chrome row (PerspectiveHeading).
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });

  it('shows the workspace switcher for a workspace-requiring perspective with a loaded workspace', () => {
    usePerspectiveStore.getState().setActivePerspective('git');
    renderAppHeaderWithWorkspace({ workspaceStateOverrides: { workspaceName: 'CDM Workspace' } });
    expect(screen.getByLabelText(/Workspace menu/)).toBeInTheDocument();
    expect(screen.getByText('CDM Workspace')).toBeInTheDocument();
  });

  it('drift guard: explore active but no explore content renders the Workspaces chrome in the bar (PR #369)', () => {
    usePerspectiveStore.getState().setActivePerspective('explore');
    renderAppHeaderWithWorkspace({ hasWorkspace: false, hasExploreContent: false });
    // Bar must not show Explore's FileTabStrip/actions in this state; the
    // Workspaces title now renders in the chrome row (PerspectiveHeading),
    // matching what PerspectiveHost renders in the body for this same state.
    expect(screen.queryByText('Workspaces / Models')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'a.rosetta DSL' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Validate' })).not.toBeInTheDocument();
    expect(screen.queryByText('Import')).not.toBeInTheDocument();
  });
});

describe('perspective screens no longer render their own h1 (the bar owns the title)', () => {
  afterEach(cleanup);

  it('GitSyncPerspective has no h1', () => {
    render(<GitSyncPerspective />);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('ExportPerspective has no h1', () => {
    render(<ExportPerspective />);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('SettingsPerspective has no h1', () => {
    render(<SettingsPerspective />);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });
});
