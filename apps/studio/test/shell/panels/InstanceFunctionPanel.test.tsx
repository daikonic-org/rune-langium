// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RosettaModel } from '@rune-langium/core';
import type { FormPreviewSchema, PreviewField } from '@rune-langium/codegen/export';
import type { PreviewSessionClient } from '../../../src/services/preview-session-client.js';
import { PreviewSessionContext } from '../../../src/shell/providers/preview-session-context.js';
import { WorkspaceStateContext, type WorkspaceState } from '../../../src/shell/providers/workspace-context.js';
import { InstanceFunctionPanel } from '../../../src/shell/panels/InstanceFunctionPanel.js';
import { usePrototypeNavigationStore } from '../../../src/services/prototype-navigation.js';
import { useInstanceStore } from '../../../src/store/instance-store.js';
import { useFormPresentationStore } from '../../../src/store/form-presentation-store.js';

vi.mock('../../../src/components/WorkspaceTypePicker.js', () => ({
  WorkspaceTypePicker: ({ onSelectOption }: { onSelectOption(option: { value: string } | null): void }) => (
    <button type="button" onClick={() => onSelectOption({ value: 'test.BuildParty#RosettaFunction' })}>
      Choose test.BuildParty
    </button>
  )
}));

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
const party: PreviewField = {
  path: 'party',
  label: 'Party',
  kind: 'object',
  required: true,
  referencedTypeFqn: 'test.Party',
  assignableTypeFqns: ['test.Party', 'test.CorporateParty'],
  children: []
};
const schema = (fields: PreviewField[] = [party]): FormPreviewSchema => ({
  schemaVersion: 1,
  targetId: 'test.BuildParty',
  title: 'Build party',
  status: 'ready',
  kind: 'function',
  fields,
  functionOutput: { typeFqn: 'test.Party', kind: 'data', cardinality: { min: 1, max: 1 } }
});
function clientFor(fields?: PreviewField[]): PreviewSessionClient {
  return {
    schema: vi.fn().mockResolvedValue(schema(fields)),
    execute: vi.fn().mockResolvedValue({ name: 'Result' }),
    dispose: vi.fn()
  };
}
function panel(client: PreviewSessionClient | null, instanceId: string, onStateChange = vi.fn()) {
  return (
    <WorkspaceStateContext.Provider value={workspace}>
      <PreviewSessionContext.Provider value={client ? () => client : null}>
        <InstanceFunctionPanel instanceId={instanceId} onStateChange={onStateChange} />
      </PreviewSessionContext.Provider>
    </WorkspaceStateContext.Provider>
  );
}
const choose = () => fireEvent.click(screen.getByRole('button', { name: 'Choose test.BuildParty' }));

describe('InstanceFunctionPanel', () => {
  let instanceId: string;
  beforeEach(() => {
    workspace.models = [] as RosettaModel[];
    usePrototypeNavigationStore.setState({ pending: null });
    useFormPresentationStore.setState({ workspaces: {} });
    useInstanceStore.setState({
      instances: {},
      validationErrors: {},
      validationStatus: {},
      saveStates: {},
      recordRevisions: {}
    });
    instanceId = useInstanceStore.getState().createInstance('test.CorporateParty', 'Acme', { data: { name: 'Acme' } });
  });

  it('automatically binds the only compatible input and saves a separate result through the shared creation intent', async () => {
    const client = clientFor();
    render(panel(client, instanceId));
    choose();
    expect(await screen.findByText('Using Acme as Party.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Additional parameters' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    expect(await screen.findByRole('button', { name: 'Save result as instance…' })).toBeVisible();
    expect(client.execute).toHaveBeenCalledWith(
      'test.BuildParty',
      { party: { name: 'Acme' } },
      expect.any(AbortSignal)
    );
    expect(useInstanceStore.getState().instances[instanceId]!.data).toEqual({ name: 'Acme' });
    fireEvent.click(screen.getByRole('button', { name: 'Save result as instance…' }));
    expect(usePrototypeNavigationStore.getState().pending).toEqual({
      workspaceId: 'workspace-a',
      intent: {
        kind: 'create',
        seed: { typeFqn: 'test.Party', data: { name: 'Result' } }
      }
    });
  });

  it('shows only extra parameters behind … and preserves them when instance data changes', async () => {
    const client = clientFor([party, { path: 'suffix', label: 'Suffix', kind: 'string', required: true }]);
    render(panel(client, instanceId));
    choose();
    const more = await screen.findByRole('button', { name: 'Additional parameters' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Suffix')).not.toBeInTheDocument();
    fireEvent.click(more);
    fireEvent.change(await screen.findByLabelText('Suffix'), { target: { value: 'Ltd' } });
    expect(screen.queryByLabelText('Party')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run', exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit layout' })).not.toBeInTheDocument();
    act(() => useInstanceStore.getState().updateInstanceData(instanceId, { name: 'Updated' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    await waitFor(() =>
      expect(client.execute).toHaveBeenCalledWith(
        'test.BuildParty',
        { party: { name: 'Updated' }, suffix: 'Ltd' },
        expect.any(AbortSignal)
      )
    );
  });

  it('requires an explicit parameter when two inputs accept the instance', async () => {
    const user = userEvent.setup();
    const client = clientFor([party, { ...party, path: 'counterparty', label: 'Counterparty' }]);
    render(panel(client, instanceId));
    choose();
    const apply = await screen.findByRole('button', { name: 'Apply', exact: true });
    expect(apply).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: 'Instance parameter' }));
    await user.click(screen.getByRole('option', { name: 'Counterparty', exact: true }));
    expect(apply).toBeEnabled();
    expect(screen.getByText('Using Acme as Counterparty.')).toBeVisible();
    await user.click(apply);
    await waitFor(() =>
      expect(client.execute).toHaveBeenCalledWith(
        'test.BuildParty',
        { party: {}, counterparty: { name: 'Acme' } },
        expect.any(AbortSignal)
      )
    );
  });

  it('does not offer Apply for an incompatible instance type', async () => {
    const client = clientFor([{ ...party, referencedTypeFqn: 'test.Address', assignableTypeFqns: ['test.Address'] }]);
    render(panel(client, instanceId));
    choose();
    expect(await screen.findByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
    expect(screen.getByText(/no parameter that accepts/)).toBeVisible();
    expect(client.execute).not.toHaveBeenCalled();
  });

  it('discards an in-flight result when the source instance changes', async () => {
    let finish!: (value: unknown) => void;
    const client = clientFor();
    vi.mocked(client.execute).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    render(panel(client, instanceId));
    choose();
    fireEvent.click(await screen.findByRole('button', { name: 'Apply', exact: true }));
    expect(screen.getByRole('button', { name: 'Applying…' })).toBeDisabled();
    act(() => useInstanceStore.getState().updateInstanceData(instanceId, { name: 'Newer' }));
    await act(async () => finish({ name: 'Old result' }));
    expect(screen.queryByRole('button', { name: 'Save result as instance…' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  });

  it('disposes the session and clears selection when the inspected instance changes', async () => {
    const client = clientFor();
    const { rerender } = render(panel(client, instanceId));
    choose();
    await screen.findByText('Using Acme as Party.');
    rerender(panel(client, 'another-instance'));
    expect(client.dispose).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Apply a function to this instance’s data.')).toBeVisible();
  });

  it('recreates an executable session after StrictMode cleanup replay', async () => {
    const clients: PreviewSessionClient[] = [];
    render(
      <StrictMode>
        <WorkspaceStateContext.Provider value={workspace}>
          <PreviewSessionContext.Provider
            value={() => {
              const client = clientFor();
              clients.push(client);
              return client;
            }}
          >
            <InstanceFunctionPanel instanceId={instanceId} />
          </PreviewSessionContext.Provider>
        </WorkspaceStateContext.Provider>
      </StrictMode>
    );
    expect(clients).toHaveLength(2);
    expect(clients[0]!.dispose).toHaveBeenCalledOnce();
    choose();
    fireEvent.click(await screen.findByRole('button', { name: 'Apply', exact: true }));
    await screen.findByRole('button', { name: 'Save result as instance…' });
    expect(clients[1]!.execute).toHaveBeenCalledOnce();
    expect(clients[1]!.dispose).not.toHaveBeenCalled();
  });

  it('shows a recoverable preparing state until execution is ready', () => {
    render(panel(null, instanceId));
    expect(screen.getByText('Function execution is preparing…')).toBeVisible();
  });
});
