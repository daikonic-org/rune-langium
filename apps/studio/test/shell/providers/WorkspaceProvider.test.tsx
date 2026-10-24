// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect, vi } from 'vitest';
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

function RuntimeProbe() {
  const project = useProject();
  return (
    <span data-testid="runtime">
      {project.runtime?.status}:{project.runtime?.input?.snapshot.workspaceId}:
      {project.runtime?.input?.snapshot.files.get('model/a.rosetta')}
    </span>
  );
}
it('captures named-project drafts without publishing them as saved repository state', async () => {
  const adapter = createProjectFileAdapter({
    workspaceId: 'draft',
    root: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  await adapter.write('rune-config.yml', 'model: {name: Demo}', null);
  await adapter.write('build-config.yml', 'schemaVersion: 1', null);
  await adapter.write('model/a.rosetta', 'namespace saved', null);
  const files = [{ path: 'model/a.rosetta', name: 'a.rosetta', content: 'namespace draft', dirty: true }];
  render(
    <WorkspaceProvider
      state={{ ...stateFor('draft'), files }}
      actions={{ ...noopActions, getProjectFileAdapter: async () => adapter }}
    >
      <RuntimeProbe />
    </WorkspaceProvider>
  );
  await waitFor(() => expect(screen.getByTestId('runtime').textContent).toBe('captured:draft:namespace draft'));
  expect((await adapter.read('model/a.rosetta'))!.text).toBe('namespace saved');
});
it('keeps an unmanaged workspace on the established legacy runtime', async () => {
  const adapter = createProjectFileAdapter({
    workspaceId: 'legacy',
    root: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  render(
    <WorkspaceProvider
      state={stateFor('legacy')}
      actions={{ ...noopActions, getProjectFileAdapter: async () => adapter }}
    >
      <RuntimeProbe />
    </WorkspaceProvider>
  );
  await waitFor(() => expect(screen.getByTestId('runtime').textContent).toBe('legacy::'));
});

it('discards a late draft capture after newer editor text is captured', async () => {
  const capture = await import('../../../src/services/project-runtime-input.js');
  const originalCapture = capture.captureProjectRuntimeInput;
  let finish!: (input: Awaited<ReturnType<typeof originalCapture>>) => void;
  const spy = vi.spyOn(capture, 'captureProjectRuntimeInput').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  try {
    const adapter = createProjectFileAdapter({
      workspaceId: 'race',
      root: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
      privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
      isWritable: () => true
    });
    await adapter.write('rune-config.yml', 'model: {name: Demo}', null);
    await adapter.write('build-config.yml', 'schemaVersion: 1', null);
    await adapter.write('model/a.rosetta', 'namespace saved', null);
    const actions = { ...noopActions, getProjectFileAdapter: async () => adapter };
    const files = [{ path: 'model/a.rosetta', name: 'a.rosetta', content: 'namespace oldDraft', dirty: true }];
    const view = render(
      <WorkspaceProvider state={{ ...stateFor('race'), files }} actions={actions}>
        <RuntimeProbe />
      </WorkspaceProvider>
    );
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const newer = [{ ...files[0]!, content: 'namespace newest' }];
    view.rerender(
      <WorkspaceProvider state={{ ...stateFor('race'), files: newer }} actions={actions}>
        <RuntimeProbe />
      </WorkspaceProvider>
    );
    await waitFor(() => expect(screen.getByTestId('runtime').textContent).toBe('captured:race:namespace newest'));
    const args = spy.mock.calls[0]!;
    await act(async () => {
      finish(await originalCapture(...args));
    });
    expect(screen.getByTestId('runtime').textContent).toBe('captured:race:namespace newest');
  } finally {
    spy.mockRestore();
  }
});
