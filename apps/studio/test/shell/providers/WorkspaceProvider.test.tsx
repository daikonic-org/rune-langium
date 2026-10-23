// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { saveSetting, loadSetting } from '../../../src/workspace/persistence.js';
import { workbenchSettingsKey } from '../../../src/shell/workbench-settings.js';
import { render, screen, act, waitFor } from '@testing-library/react';
import { useState, memo } from 'react';
import { WorkspaceProvider } from '../../../src/shell/providers/WorkspaceProvider.js';
import { useWorkspace } from '../../../src/shell/providers/workspace-context.js';
import { useWorkspaceActions } from '../../../src/shell/perspectives/workspace-actions-context.js';

import { useProject } from '../../../src/shell/providers/project-context.js';
import { createProjectFileAdapter } from '../../../src/workspace/project-file-adapter.js';
import { createOpfsRoot } from '../../setup/opfs-mock.js';
import type { ProjectFileAdapter } from '@rune-langium/project-config';

const noopActions = {
  files: [],
  onFilesLoaded: () => {},
  createGitBackedWorkspace: () => {},
  onGitHubWorkspaceCreated: () => {},
  onOpenWorkspace: () => {},
  onCreateWorkspace: () => {},
  onDeleteWorkspace: () => {}
};
function stateFor(id: string) {
  return {
    workspaceId: id,
    workspaceKind: 'browser-only' as const,
    workspaceName: id,
    fileCount: 0,
    files: [],
    models: [],
    parsedModels: [],
    deferredExports: []
  };
}

function StateProbe() {
  return <span data-testid="id">{useWorkspace().workspaceId}</span>;
}

describe('WorkspaceProvider', () => {
  it('publishes state + actions to consumers', () => {
    render(
      <WorkspaceProvider state={stateFor('ws-A')} actions={noopActions}>
        <StateProbe />
      </WorkspaceProvider>
    );
    expect(screen.getByTestId('id').textContent).toBe('ws-A');
  });

  it('swaps the published model atomically on a workspace change', () => {
    function Host() {
      const [id, setId] = useState('ws-A');
      return (
        <>
          <button onClick={() => setId('ws-B')}>switch</button>
          <WorkspaceProvider state={stateFor(id)} actions={noopActions}>
            <StateProbe />
          </WorkspaceProvider>
        </>
      );
    }
    render(<Host />);
    expect(screen.getByTestId('id').textContent).toBe('ws-A');
    act(() => screen.getByText('switch').click());
    expect(screen.getByTestId('id').textContent).toBe('ws-B');
  });

  it('split contexts isolate re-renders: memoized action-only consumers skip state-only changes', () => {
    let actionRenders = 0;
    let stateRenders = 0;
    const ActionsOnly = memo(function ActionsOnly() {
      useWorkspaceActions();
      actionRenders += 1;
      return null;
    });
    const StateReader = memo(function StateReader() {
      useWorkspace();
      stateRenders += 1;
      return null;
    });

    function Host() {
      const [id, setId] = useState('ws-A');
      return (
        <>
          <button onClick={() => setId('ws-B')}>switch</button>
          <WorkspaceProvider state={stateFor(id)} actions={noopActions}>
            <ActionsOnly />
            <StateReader />
          </WorkspaceProvider>
        </>
      );
    }
    render(<Host />);
    const actionsBefore = actionRenders;
    const stateBefore = stateRenders;
    act(() => screen.getByText('switch').click());
    // State context value changed → the state reader re-renders…
    expect(stateRenders).toBeGreaterThan(stateBefore);
    // …but the memoized action-only consumer does NOT (it never subscribed to state).
    expect(actionRenders).toBe(actionsBefore);
  });
});

function ProjectProbe() {
  const project = useProject();
  return <span data-testid="project">{project.snapshot?.workspaceId ?? project.status}</span>;
}

it('publishes repository snapshots and ignores a late adapter from the previous workspace', async () => {
  const root = createOpfsRoot();
  const privateRoot = createOpfsRoot();
  const adapter = createProjectFileAdapter({
    workspaceId: 'ws-B',
    root: root as unknown as FileSystemDirectoryHandle,
    privateRoot: privateRoot as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  let resolveA!: (value: ProjectFileAdapter) => void;
  const pendingA = new Promise<ProjectFileAdapter>((resolve) => {
    resolveA = resolve;
  });
  const actions = {
    ...noopActions,
    getProjectFileAdapter: (id: string) => (id === 'ws-A' ? pendingA : Promise.resolve(adapter))
  };
  const view = render(
    <WorkspaceProvider state={stateFor('ws-A')} actions={actions}>
      <ProjectProbe />
    </WorkspaceProvider>
  );
  view.rerender(
    <WorkspaceProvider state={stateFor('ws-B')} actions={actions}>
      <ProjectProbe />
    </WorkspaceProvider>
  );
  await waitFor(() => expect(screen.getByTestId('project').textContent).toBe('ws-B'));
  await act(async () => {
    resolveA(adapter);
    await pendingA;
  });
  expect(screen.getByTestId('project').textContent).toBe('ws-B');
});

it('reads repository settings over stale browser preferences without deleting those preferences', async () => {
  const key = workbenchSettingsKey('repository-wins', 'export-workbench');
  const legacy = {
    config: {
      target: 'sql',
      selection: { namespaces: [], declarations: [] },
      options: { sql: { dialect: 'sqlserver' } }
    }
  };
  await saveSetting(key, legacy);
  const adapter = createProjectFileAdapter({
    workspaceId: 'repository-wins',
    root: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  await adapter.write('rune-config.yml', 'model: {name: Repository}', null);
  await adapter.write(
    'build-config.yml',
    'schemaVersion: 1\ntargets:\n  postgres:\n    generator: sql\n    output: generated/pg\n    options: {dialect: postgres}\n',
    null
  );
  function TargetProbe() {
    return (
      <span data-testid="dialect">
        {String(useProject().snapshot?.project.build.targets.postgres?.options.dialect ?? '')}
      </span>
    );
  }
  render(
    <WorkspaceProvider
      state={stateFor('repository-wins')}
      actions={{ ...noopActions, getProjectFileAdapter: async () => adapter }}
    >
      <TargetProbe />
    </WorkspaceProvider>
  );
  await waitFor(() => expect(screen.getByTestId('dialect').textContent).toBe('postgres'));
  expect(await loadSetting(key)).toEqual(legacy);
});
