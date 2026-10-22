// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { mockReadWorkbenchSettings } = vi.hoisted(() => ({
  mockReadWorkbenchSettings: vi.fn(async (_workspaceId: string, _key: string, fallback: unknown) => fallback)
}));
vi.mock('../../../../src/shell/workbench-settings.js', () => ({
  readWorkbenchSettings: mockReadWorkbenchSettings,
  writeWorkbenchSettings: vi.fn(async () => undefined)
}));
vi.mock('../../../../src/shell/WorkbenchHost.js', () => ({
  WorkbenchHost: ({ definition }: { definition: { panels: Record<string, () => React.ReactElement> } }) => (
    <div data-testid="mock-prototype-workbench">
      {Object.entries(definition.panels).map(([id, Panel]) => (
        <div key={id} data-testid={`prototype-workbench-panel-${id}`}>
          <Panel />
        </div>
      ))}
    </div>
  )
}));
import { PrototypePerspective } from '../../../../src/shell/perspectives/screens/PrototypePerspective.js';
import { useInstanceStore } from '../../../../src/store/instance-store.js';
import { usePrototypeViewStore } from '../../../../src/store/prototype-view-store.js';
import { requestPrototype, usePrototypeNavigationStore } from '../../../../src/services/prototype-navigation.js';
import { WorkspaceStateContext, type WorkspaceState } from '../../../../src/shell/providers/workspace-context.js';

describe('PrototypePerspective', () => {
  beforeEach(() => {
    mockReadWorkbenchSettings.mockReset();
    mockReadWorkbenchSettings.mockImplementation(
      async (_workspaceId: string, _key: string, fallback: unknown) => fallback
    );
    useInstanceStore.setState({
      instances: {},
      validationErrors: {},
      validationStatus: {},
      schemas: new Map(),
      schemaErrors: new Map(),
      saveStates: {},
      recordRevisions: {}
    });
    usePrototypeViewStore.setState({
      workspaceId: 'workspace-a',
      state: {
        selectedId: null,
        query: '',
        typeFqn: null,

        graphVisible: false
      }
    });
    usePrototypeNavigationStore.setState({ pending: null });
  });

  const workspace: WorkspaceState = {
    workspaceId: 'workspace-a',
    workspaceKind: 'browser-only',
    workspaceName: 'workspace-a',
    fileCount: 0,
    files: [],
    models: [],
    parsedModels: [],
    deferredExports: [],
    parseErrors: new Map()
  };

  async function renderPerspective() {
    const result = render(
      <WorkspaceStateContext.Provider value={workspace}>
        <PrototypePerspective />
      </WorkspaceStateContext.Provider>
    );
    await screen.findByTestId('mock-prototype-workbench');
    return result;
  }

  it('opens an empty workflow with Add in the main header', async () => {
    await renderPerspective();
    expect(screen.getByRole('region', { name: 'Prototype workflow' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Import JSON' })).not.toBeInTheDocument();
    expect(screen.queryByText('Persistent instances')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Workflow', exact: true })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Object builder', exact: true }));
    expect(screen.getByRole('button', { name: 'Object builder', exact: true })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
    expect(await screen.findByRole('heading', { name: 'New instance' })).toBeVisible();
  });

  it('selecting a grid object requests an input binding without a privileged instance header', async () => {
    const id = useInstanceStore.getState().createInstance('test.Party', 'Acme');
    await renderPerspective();
    fireEvent.click(screen.getByRole('row', { name: /Acme/ }));
    expect(usePrototypeViewStore.getState().state.selectedId).toBe(id);
    expect(screen.getByRole('heading', { name: 'Transform' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Acme' })).not.toBeInTheDocument();
  });

  it('registers the Workflow, Instances and optional Payload graph panels', async () => {
    await renderPerspective();
    expect(screen.queryByTestId('prototype-workbench-panel-prototype.payloadGraph')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Payload graph' }));
    for (const id of ['prototype.inspector', 'prototype.grid', 'prototype.payloadGraph'])
      expect(screen.getByTestId(`prototype-workbench-panel-${id}`)).toBeInTheDocument();
  });

  it('adds a JSON batch to the grid without selecting or opening an input', async () => {
    await renderPerspective();
    act(() => usePrototypeViewStore.getState().patch({ typeFqn: 'test.Party' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import objects…' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Import JSON data' }), {
      target: { value: '[{"name":"Alice"},{"name":"Bob"}]' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import', exact: true }));
    expect(Object.values(useInstanceStore.getState().instances).map((record) => record.data)).toEqual([
      { name: 'Alice' },
      { name: 'Bob' }
    ]);
    expect(usePrototypeViewStore.getState().state.selectedId).toBeNull();
    expect(screen.queryByRole('heading', { name: 'New instance' })).not.toBeInTheDocument();
  });

  it('keeps malformed JSON out of grid storage', async () => {
    await renderPerspective();
    act(() => usePrototypeViewStore.getState().patch({ typeFqn: 'test.Party' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import objects…' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Import JSON data' }), { target: { value: '{' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/JSON/i);
    expect(Object.values(useInstanceStore.getState().instances)).toHaveLength(0);
  });

  it('consumes a creation intent that arrives after Prototype is mounted', async () => {
    await renderPerspective();

    act(() =>
      requestPrototype('workspace-a', { kind: 'create', seed: { typeFqn: 'test.Party', data: { name: 'Acme' } } })
    );

    expect(await screen.findByRole('heading', { name: 'New instance' })).toBeVisible();
  });

  it('consumes an instance-opening intent after the workspace is active', async () => {
    const id = useInstanceStore.getState().createInstance('test.Party', 'Acme');
    await renderPerspective();

    act(() => requestPrototype('workspace-a', { kind: 'open', instanceId: id }));

    await vi.waitFor(() => expect(usePrototypeViewStore.getState().state.selectedId).toBe(id));
    expect(screen.getByRole('region', { name: 'Prototype workflow' })).toBeVisible();
  });

  it('applies an opening intent after delayed workspace preferences restore', async () => {
    let resolveSettings!: (value: unknown) => void;
    mockReadWorkbenchSettings.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSettings = resolve;
        })
    );
    usePrototypeViewStore.setState({ workspaceId: null });
    const id = useInstanceStore.getState().createInstance('test.Party', 'Acme');
    render(
      <WorkspaceStateContext.Provider value={workspace}>
        <PrototypePerspective />
      </WorkspaceStateContext.Provider>
    );

    act(() => requestPrototype('workspace-a', { kind: 'open', instanceId: id }));
    await act(async () => resolveSettings({ selectedId: 'restored' }));
    await screen.findByTestId('mock-prototype-workbench');

    expect(usePrototypeViewStore.getState().state.selectedId).toBe(id);
    expect(screen.getByRole('region', { name: 'Prototype workflow' })).toBeVisible();
  });
});
