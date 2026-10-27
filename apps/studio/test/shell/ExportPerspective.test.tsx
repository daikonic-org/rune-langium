// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ProjectContext, type ProjectState } from '../../src/shell/providers/project-context.js';
import { WorkspaceActionsContext } from '../../src/shell/perspectives/workspace-actions-context.js';
import type { WorkspaceActions } from '../../src/shell/perspectives/workspace-actions-context.js';
import type { DockviewApi } from 'dockview-react';
import { ExportPerspective } from '../../src/shell/perspectives/screens/ExportPerspective.js';
import type { WorkbenchDefinition } from '../../src/shell/workbench-types.js';
import type { ExportRunState } from '../../src/store/export-workbench-store.js';

const { state, mockGenerate, mockActivate, mockConfigure, mockInvalidate, mockSetActiveFile, mockCancel } = vi.hoisted(
  () => {
    const store = {
      config: {
        target: 'typescript' as const,
        selection: { namespaces: [], declarations: [] },
        options: { typescript: { layout: 'barrel' } }
      },
      run: { status: 'idle' } as ExportRunState,
      activeFile: undefined as string | undefined,
      generate: vi.fn(),
      activate: vi.fn().mockResolvedValue(undefined),
      configure: vi.fn(),
      invalidate: vi.fn(),
      setActiveFile: vi.fn(),
      bindProject: vi.fn(() => () => undefined),
      selectTarget: vi.fn(),
      targetDrafts: {},
      saveTarget: vi.fn(),
      removeTarget: vi.fn(),
      buildTargets: vi.fn(),
      cancel: vi.fn()
    };
    return {
      state: store,
      mockGenerate: store.generate,
      mockActivate: store.activate,
      mockConfigure: store.configure,
      mockInvalidate: store.invalidate,
      mockSetActiveFile: store.setActiveFile,
      mockCancel: store.cancel
    };
  }
);

let capturedBuild: ((names: readonly string[] | 'all') => void) | undefined;
let capturedCancel: (() => void) | undefined;
let capturedGenerate: (() => void) | undefined;
let capturedDefinition: WorkbenchDefinition;
let capturedReady: ((api: DockviewApi) => void) | undefined;

vi.mock('../../src/store/export-workbench-store.js', () => ({
  useExportWorkbenchStore: Object.assign(<T,>(selector: (value: typeof state) => T) => selector(state), {
    getState: () => state
  })
}));
vi.mock('../../src/shell/panels/ExportSelectionPanel.js', () => ({
  ExportSelectionPanel: () => <div data-testid="mock-export-selection-panel" />
}));
vi.mock('../../src/shell/panels/ExportSettingsPanel.js', () => ({
  ExportSettingsPanel: (props: {
    onGenerate(): void;
    onBuildTargets(names: readonly string[] | 'all'): void;
    onCancel(): void;
  }) => {
    capturedBuild = props.onBuildTargets;
    capturedCancel = props.onCancel;
    capturedGenerate = props.onGenerate;
    return <div data-testid="mock-export-settings-panel" />;
  }
}));
vi.mock('../../src/shell/panels/ExportPreviewPanel.js', () => ({
  ExportPreviewPanel: () => <div data-testid="mock-export-preview-panel" />
}));
vi.mock('../../src/shell/WorkbenchHost.js', () => ({
  WorkbenchHost: ({ definition, onReady }: { definition: WorkbenchDefinition; onReady?(api: DockviewApi): void }) => {
    capturedDefinition = definition;
    capturedReady = onReady;
    return (
      <div data-testid="mock-export-workbench">
        {Object.entries(definition.panels).map(([id, Panel]) => (
          <Panel key={id} />
        ))}
      </div>
    );
  }
}));

beforeEach(() => {
  state.config = {
    target: 'typescript',
    selection: { namespaces: [], declarations: [] },
    options: { typescript: { layout: 'barrel' } }
  };
  state.buildTargets.mockClear();
  state.run = { status: 'idle' };
  capturedGenerate = undefined;
  capturedReady = undefined;
  mockGenerate.mockClear();
  mockActivate.mockClear();
  mockConfigure.mockClear();
  mockInvalidate.mockClear();
  mockSetActiveFile.mockClear();
  mockCancel.mockClear();
});

function layoutApi(previewHeight = 128) {
  function panel(id: string, initialHeight: number) {
    let height = initialHeight;
    const group = {
      id: `${id}-group`,
      panels: [id],
      api: {
        get height() {
          return height;
        },
        setConstraints: vi.fn(),
        setSize: vi.fn((size: { height?: number }) => {
          height = size.height ?? height;
        })
      }
    };
    return {
      id,
      group,
      api: {
        get height() {
          return height;
        },
        setActive: vi.fn()
      }
    };
  }
  const selection = panel('export.selection', 480);
  const settings = panel('export.settings', 640);
  const preview = panel('export.preview', previewHeight);
  const panels = new Map([selection, settings, preview].map((item) => [item.id, item]));
  const api = {
    height: 640,
    width: 1280,
    addPanel: vi.fn(({ id }: { id: string }) => panels.get(id)),
    getPanel: (id: string) => panels.get(id)
  };
  return { api: api as unknown as DockviewApi, selection, settings, preview };
}

function readyArtifact(): ExportRunState {
  return {
    status: 'ready',
    inputKey: 'test-artifact',
    artifact: {
      blob: new Blob(),
      filename: 'export.zip',
      readText: async () => '',
      manifest: { version: 1, target: 'typescript', files: [], diagnostics: [] }
    }
  };
}

it('places settings and output in one full-height task panel beside a compact selection explorer', async () => {
  render(<ExportPerspective workspaceId="workspace-a" />);
  await screen.findByTestId('mock-export-workbench');
  const fresh = layoutApi();
  capturedDefinition.buildDefault(fresh.api, 1280);
  expect(fresh.api.addPanel.mock.calls.map(([options]) => options.id)).toEqual(['export.selection', 'export.settings']);
  expect(fresh.selection.group.api.setSize).toHaveBeenCalledWith({ width: expect.closeTo(358.4) });
  expect(fresh.preview.group.api.setSize).not.toHaveBeenCalled();
  const restored = layoutApi(300);
  capturedDefinition.reconcile?.(restored.api, 1280);
  expect(restored.selection.group.api.setConstraints).toHaveBeenCalledWith({ minimumWidth: 220 });
  expect(restored.api.addPanel).not.toHaveBeenCalled();
  expect(restored.selection.group.api.setSize).not.toHaveBeenCalled();
});
it('reveals output when a fresh artifact arrives without resizing restored groups', async () => {
  const { rerender } = render(<ExportPerspective workspaceId="workspace-a" />);
  await screen.findByTestId('mock-export-workbench');
  expect(screen.getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute('aria-selected', 'true');
  const layout = layoutApi();
  act(() => capturedReady?.(layout.api));
  state.run = readyArtifact();
  rerender(<ExportPerspective workspaceId="workspace-a" />);
  expect(screen.getByRole('tab', { name: 'Generated output', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(layout.preview.group.api.setSize).not.toHaveBeenCalled();
});

it('reveals output when generation fails without a previous artifact', async () => {
  const { rerender } = render(<ExportPerspective workspaceId="workspace-a" />);
  await screen.findByTestId('mock-export-workbench');
  expect(screen.getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute('aria-selected', 'true');
  state.run = {
    status: 'failed',
    message: 'Selected declaration cannot be generated.',
    diagnostics: [{ severity: 'error', code: 'unsupported-expression', message: 'Unsupported expression.' }]
  };
  rerender(<ExportPerspective workspaceId="workspace-a" />);
  expect(screen.getByRole('tab', { name: 'Generated output', exact: true })).toHaveAttribute('aria-selected', 'true');
});

it('composes stable selection, settings, and preview workbench panels', async () => {
  render(<ExportPerspective workspaceId="workspace-a" />);
  await screen.findByTestId('mock-export-workbench');
  expect(screen.getByTestId('export-selection')).toContainElement(screen.getByTestId('mock-export-selection-panel'));
  expect(screen.getByTestId('export-settings')).toContainElement(screen.getByTestId('mock-export-settings-panel'));
  expect(screen.getByTestId('export-preview')).toContainElement(screen.getByTestId('mock-export-preview-panel'));
  expect(mockActivate).toHaveBeenCalledWith('workspace-a');
});

it('invalidates the artifact when a curated bundle version changes', () => {
  const files = [
    {
      name: '.bundle-marker',
      path: '[cdm]/.bundle-marker',
      content: '',
      dirty: false,
      readOnly: true,
      serializedModelJson: '{}',
      bundleId: 'cdm',
      bundleVersion: 'first'
    }
  ];
  const { rerender } = render(<ExportPerspective workspaceId="workspace-a" files={files} />);
  expect(mockInvalidate).toHaveBeenCalledTimes(1);

  rerender(<ExportPerspective workspaceId="workspace-a" files={[{ ...files[0]!, bundleVersion: 'second' }]} />);

  expect(mockInvalidate).toHaveBeenCalledTimes(2);
});

it('captures the selected roots and workspace files exactly once when generating', async () => {
  state.config = {
    ...state.config,
    selection: { namespaces: [], declarations: [{ namespace: 'test', name: 'Party', kind: 'Data' }] }
  };
  const files = [{ name: 'test.rune', path: 'test.rune', content: 'namespace test', dirty: false }];
  render(<ExportPerspective workspaceId="workspace-a" files={files} />);
  await screen.findByTestId('mock-export-workbench');

  act(() => capturedGenerate?.());

  expect(mockGenerate).toHaveBeenCalledOnce();
  expect(mockGenerate).toHaveBeenCalledWith(
    expect.objectContaining({ workspaceId: 'workspace-a', config: state.config, files })
  );
});

it('flushes source Save and waits for the refreshed runtime receipt before building', async () => {
  let finishSave!: () => void;
  const flushWorkspaceSave = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishSave = resolve;
      })
  );
  const old = { workspaceId: 'workspace-a', revision: 'old' };
  const fresh = { workspaceId: 'workspace-a', revision: 'fresh' };
  let current = old;
  const controller = {
    current: () => current,
    load: vi.fn(async () => {
      current = fresh;
      return fresh;
    })
  };
  const project = (snapshot = old, status = 'captured'): ProjectState => ({
    workspaceId: 'workspace-a',
    status: 'ready',
    diagnostics: [],
    controller: controller as never,
    snapshot: snapshot as never,
    runtime: {
      managed: true,
      status,
      diagnostics: [],
      input: status === 'captured' ? { snapshot, receipt: { revision: snapshot.revision } } : undefined
    } as never
  });
  const ui = (value: ProjectState) => (
    <WorkspaceActionsContext value={{ flushWorkspaceSave } as WorkspaceActions}>
      <ProjectContext value={value}>
        <ExportPerspective workspaceId="workspace-a" />
      </ProjectContext>
    </WorkspaceActionsContext>
  );
  const view = render(ui(project()));
  await screen.findByTestId('mock-export-workbench');
  act(() => capturedBuild?.(['pg']));
  expect(flushWorkspaceSave).toHaveBeenCalledOnce();
  expect(controller.load).not.toHaveBeenCalled();
  await act(async () => finishSave());
  expect(controller.load).toHaveBeenCalledOnce();
  expect(state.buildTargets).not.toHaveBeenCalled();
  view.rerender(ui(project(fresh, 'loading')));
  expect(state.buildTargets).not.toHaveBeenCalled();
  view.rerender(ui(project(fresh)));
  await waitFor(() =>
    expect(state.buildTargets).toHaveBeenCalledWith(
      ['pg'],
      expect.objectContaining({ project: expect.objectContaining({ snapshot: fresh }) })
    )
  );
});

it('does not start a named build when preparation is canceled during source Save', async () => {
  let finishSave!: () => void;
  const flushWorkspaceSave = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishSave = resolve;
      })
  );
  const controller = { current: () => undefined, load: vi.fn() };
  render(
    <WorkspaceActionsContext value={{ flushWorkspaceSave } as WorkspaceActions}>
      <ProjectContext
        value={{ workspaceId: 'workspace-a', status: 'ready', diagnostics: [], controller: controller as never }}
      >
        <ExportPerspective workspaceId="workspace-a" />
      </ProjectContext>
    </WorkspaceActionsContext>
  );
  await screen.findByTestId('mock-export-workbench');
  act(() => capturedBuild?.('all'));
  act(() => capturedCancel?.());
  await act(async () => finishSave());
  expect(controller.load).not.toHaveBeenCalled();
  expect(state.buildTargets).not.toHaveBeenCalled();
});

it('reports source Save failures without loading or building an older project', async () => {
  const load = vi.fn();
  render(
    <WorkspaceActionsContext
      value={
        { flushWorkspaceSave: vi.fn().mockRejectedValue(new Error('Source Save failed. Retry.')) } as WorkspaceActions
      }
    >
      <ProjectContext
        value={{ workspaceId: 'workspace-a', status: 'ready', diagnostics: [], controller: { load } as never }}
      >
        <ExportPerspective workspaceId="workspace-a" />
      </ProjectContext>
    </WorkspaceActionsContext>
  );
  await screen.findByTestId('mock-export-workbench');
  act(() => capturedBuild?.('all'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Source Save failed. Retry.');
  expect(load).not.toHaveBeenCalled();
  expect(state.buildTargets).not.toHaveBeenCalled();
});

it('abandons preparation when the workspace changes during source Save', async () => {
  let finishSave!: () => void;
  const flushWorkspaceSave = () =>
    new Promise<void>((resolve) => {
      finishSave = resolve;
    });
  const controller = { load: vi.fn(), current: () => undefined };
  const view = render(
    <WorkspaceActionsContext value={{ flushWorkspaceSave } as WorkspaceActions}>
      <ProjectContext
        value={{ workspaceId: 'workspace-a', status: 'ready', diagnostics: [], controller: controller as never }}
      >
        <ExportPerspective workspaceId="workspace-a" />
      </ProjectContext>
    </WorkspaceActionsContext>
  );
  await screen.findByTestId('mock-export-workbench');
  act(() => capturedBuild?.('all'));
  view.rerender(<ExportPerspective workspaceId="workspace-b" />);
  await act(async () => finishSave());
  expect(controller.load).not.toHaveBeenCalled();
  expect(state.buildTargets).not.toHaveBeenCalled();
});

it('rejects a changed draft while waiting for a refreshed runtime capture', async () => {
  const snapshot = { workspaceId: 'workspace-a', revision: 'saved' };
  const controller = { current: () => snapshot, load: vi.fn().mockResolvedValue(snapshot) };
  const value: ProjectState = {
    workspaceId: 'workspace-a',
    status: 'ready',
    diagnostics: [],
    controller: controller as never,
    snapshot: snapshot as never,
    runtime: { managed: true, status: 'loading', diagnostics: [] }
  };
  const ui = (files: NonNullable<Parameters<typeof ExportPerspective>[0]['files']> = []) => (
    <ProjectContext value={value}>
      <ExportPerspective workspaceId="workspace-a" files={files} />
    </ProjectContext>
  );
  const view = render(ui());
  await screen.findByTestId('mock-export-workbench');
  await act(async () => capturedBuild?.('all'));
  view.rerender(ui([{ name: 'new.rosetta', path: 'new.rosetta', content: 'namespace new', dirty: true }]));
  expect(await screen.findByRole('alert')).toHaveTextContent('Source changed while preparing');
  expect(state.buildTargets).not.toHaveBeenCalled();
});
