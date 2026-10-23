// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
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
      saveTarget: vi.fn(),
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
  ExportSettingsPanel: (props: { onGenerate(): void }) => {
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

it('starts with compact output and applies selection constraints when restoring without resetting sizes', async () => {
  render(<ExportPerspective workspaceId="workspace-a" />);
  await screen.findByTestId('mock-export-workbench');
  const fresh = layoutApi();
  capturedDefinition.buildDefault(fresh.api, 1280);
  expect(fresh.preview.group.api.setSize).toHaveBeenCalledWith({ height: 128 });
  expect(fresh.selection.group.api.setConstraints).toHaveBeenCalledWith({ minimumHeight: 352 });

  const restored = layoutApi(300);
  capturedDefinition.reconcile?.(restored.api, 1280);
  expect(restored.selection.group.api.setConstraints).toHaveBeenCalledWith({ minimumHeight: 352 });
  expect(restored.api.addPanel).not.toHaveBeenCalled();
  expect(restored.selection.group.api.setSize).not.toHaveBeenCalled();
  expect(restored.preview.group.api.setSize).not.toHaveBeenCalled();
});

it('expands compact output when its first artifact arrives', async () => {
  const { rerender } = render(<ExportPerspective workspaceId="workspace-a" />);
  await screen.findByTestId('mock-export-workbench');
  const layout = layoutApi();
  capturedDefinition.buildDefault(layout.api, 1280);
  layout.preview.group.api.setSize.mockClear();
  act(() => capturedReady?.(layout.api));
  state.run = readyArtifact();
  rerender(<ExportPerspective workspaceId="workspace-a" />);
  expect(layout.preview.group.api.setSize).toHaveBeenCalledOnce();
  expect(layout.preview.group.api.setSize).toHaveBeenCalledWith({ height: 256 });
  rerender(<ExportPerspective workspaceId="workspace-a" />);
  expect(layout.preview.group.api.setSize).toHaveBeenCalledOnce();
});

it.each(['resized', 'tabbed', 'restored'] as const)(
  'preserves %s output when an artifact arrives',
  async (arrangement) => {
    const { rerender } = render(<ExportPerspective workspaceId="workspace-a" />);
    await screen.findByTestId('mock-export-workbench');
    const layout = layoutApi();
    if (arrangement !== 'restored') capturedDefinition.buildDefault(layout.api, 1280);
    if (arrangement === 'resized') layout.preview.group.api.setSize({ height: 100 });
    if (arrangement === 'tabbed') layout.preview.group.panels.push('export.settings');
    layout.preview.group.api.setSize.mockClear();
    act(() => capturedReady?.(layout.api));
    state.run = readyArtifact();
    rerender(<ExportPerspective workspaceId="workspace-a" />);
    expect(layout.preview.group.api.setSize).not.toHaveBeenCalled();
  }
);

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
