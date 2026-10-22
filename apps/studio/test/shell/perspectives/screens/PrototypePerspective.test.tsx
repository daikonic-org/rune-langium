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
import { installFakeValidatingWorkerForInstances } from '../../../helpers/fake-validating-worker.js';

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

  it('renders the empty state when no instance is selected', async () => {
    await renderPerspective();
    expect(screen.getByTestId('prototype-perspective')).toBeInTheDocument();
    expect(screen.getByText(/select or create an instance to inspect it/i)).toBeInTheDocument();
  });

  it('selecting a grid row keeps the form and Functions visible', async () => {
    const id = useInstanceStore.getState().createInstance('test.Party', 'Acme');
    await renderPerspective();
    fireEvent.click(screen.getByRole('row', { name: /Acme/ }));
    expect(usePrototypeViewStore.getState().state.selectedId).toBe(id);
    expect(screen.getByRole('region', { name: 'Instance form' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Functions' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Form' })).not.toBeInTheDocument();
  });

  it('opens the existing new-instance dialog from New… beside the form', async () => {
    useInstanceStore.getState().createInstance('test.Party', 'Acme');
    await renderPerspective();
    fireEvent.click(screen.getByRole('row', { name: /Acme/ }));
    fireEvent.click(screen.getByRole('button', { name: 'New…', exact: true }));
    expect(await screen.findByRole('heading', { name: 'New instance' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Instance type' })).toBeVisible();
  });

  it('registers Inspector, Instances, and Payload graph panels with the shared host', async () => {
    useInstanceStore.getState().createInstance('test.Party', 'Acme', {
      data: { address: { city: 'London' } }
    });
    await renderPerspective();
    fireEvent.click(screen.getByRole('button', { name: 'Payload graph' }));

    expect(screen.getByTestId('prototype-workbench-panel-prototype.inspector')).toBeInTheDocument();
    expect(screen.getByTestId('prototype-workbench-panel-prototype.grid')).toBeInTheDocument();
    expect(screen.getByTestId('prototype-workbench-panel-prototype.payloadGraph')).toBeInTheDocument();
  });

  it('omits the Payload graph panel until it is enabled', async () => {
    await renderPerspective();

    expect(screen.queryByTestId('prototype-workbench-panel-prototype.payloadGraph')).not.toBeInTheDocument();
  });

  it('keeps Inspector details with the selected Form', async () => {
    useInstanceStore.getState().createInstance('test.Party', 'Acme');
    await renderPerspective();
    fireEvent.click(screen.getByRole('row', { name: /Acme/ }));
    expect(screen.getAllByText('Validation')).not.toHaveLength(0);
    expect(screen.getByText('Provenance')).toBeInTheDocument();
    expect(screen.getByLabelText('Instance payload')).toBeInTheDocument();
  });

  it('opens the shared creation dialog with imported JSON values', async () => {
    await renderPerspective();
    const file = new File(['{"name":"Acme"}'], 'party.json', { type: 'application/json' });

    fireEvent.change(screen.getByLabelText('Import JSON'), { target: { files: [file] } });

    expect(await screen.findByRole('heading', { name: 'New instance' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Instance type' })).toBeVisible();
  });

  it('keeps malformed JSON out of the creation flow', async () => {
    await renderPerspective();
    const file = new File(['{'], 'broken.json', { type: 'application/json' });

    fireEvent.change(screen.getByLabelText('Import JSON'), { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/JSON/i);
    expect(screen.queryByRole('heading', { name: 'New instance' })).not.toBeInTheDocument();
  });

  it('does not carry over stale field-level validation errors when switching between instances of the same type (finding #8)', async () => {
    const partySchema = {
      schemaVersion: 1 as const,
      targetId: 'test.Party',
      title: 'Party',
      status: 'ready' as const,
      fields: [{ path: 'name', label: 'Name', kind: 'string' as const, required: true }]
    };
    useInstanceStore.setState((s) => ({
      schemas: new Map(s.schemas).set('test.Party', partySchema)
    }));
    installFakeValidatingWorkerForInstances(partySchema);
    const idA = useInstanceStore.getState().createInstance('test.Party', 'Instance A');
    const idB = useInstanceStore.getState().createInstance('test.Party', 'Instance B');
    // Instance B has its own genuinely-valid data (not just "never
    // touched") — createInstance/updateInstanceData validate eagerly on
    // every change (round-5 finding #2), so B's own validationErrors entry
    // is real, not absent-because-unvalidated. This isolates the actual
    // regression this test guards against: A's error must not leak onto
    // B, distinct from B correctly having no error of its own.
    act(() => {
      useInstanceStore.getState().updateInstanceData(idB, { name: 'Bob' });
    });

    await renderPerspective();

    // Select instance A and blur its empty required field to produce a
    // validation error.
    act(() => {
      fireEvent.click(screen.getByRole('row', { name: /Instance A/ }));
    });
    act(() => {
      fireEvent.blur(screen.getByLabelText('Name'));
    });
    expect(screen.getAllByText('Name is required')).not.toHaveLength(0);

    // Switch to instance B — its Name field is genuinely valid, so it must
    // NOT show A's stale error.
    act(() => {
      fireEvent.click(screen.getByRole('row', { name: /Instance B/ }));
    });

    expect(screen.queryAllByText('Name is required')).toHaveLength(0);
    expect(useInstanceStore.getState().instances[idA]).toBeDefined();
    expect(useInstanceStore.getState().instances[idB]).toBeDefined();
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
    expect(screen.getByRole('region', { name: 'Instance form' })).toBeVisible();
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
    expect(screen.getByRole('region', { name: 'Instance form' })).toBeVisible();
  });
});
