// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstanceInspectorPanel } from '../../../src/shell/panels/InstanceInspectorPanel.js';
import { useInstanceStore } from '../../../src/store/instance-store.js';
import { usePrototypeViewStore } from '../../../src/store/prototype-view-store.js';
import { useExploreNavigationStore } from '../../../src/services/explore-navigation.js';

vi.mock('../../../src/shell/panels/InstanceFormPanel.js', () => ({
  InstanceFormPanel: () => <div>Instance fields</div>
}));

describe('InstanceInspectorPanel', () => {
  beforeEach(() => {
    useInstanceStore.setState({
      instances: {},
      validationErrors: {},
      validationStatus: {},
      saveStates: {},
      recordRevisions: {}
    });
    usePrototypeViewStore.setState({
      state: {
        selectedId: null,
        query: '',
        typeFqn: null,

        graphVisible: false
      }
    });
    useExploreNavigationStore.setState({ navigateToType: undefined });
  });

  it('keeps identity, validation, and a single payload surface with the selected instance', () => {
    const postMessage = vi.fn();
    useInstanceStore.getState().setWorker({ postMessage } as unknown as Worker);
    const id = useInstanceStore.getState().createInstance('test.Party', 'My Party');
    useInstanceStore.getState().updateInstanceData(id, { name: 'Acme' });
    // updateInstanceData auto-dispatches a validate request; grab its requestId
    // to simulate the worker's async reply, the same way real production code does.
    const requestId = postMessage.mock.calls.at(-1)?.[0]?.requestId as string;
    useInstanceStore.getState().receiveValidateResult(requestId, [{ path: 'name', message: 'too short' }]);
    useInstanceStore.setState({
      saveStates: { [id]: { state: 'saved', revision: 1 } },
      validationStatus: { [id]: 'invalid' }
    });
    render(<InstanceInspectorPanel instanceId={id} />);
    expect(screen.getByRole('heading', { name: 'My Party' })).toBeVisible();
    expect(screen.getByRole('status', { name: 'Save status' })).toHaveTextContent('Saved');
    expect(screen.getByText(/"Acme"/)).toBeInTheDocument();
    expect(screen.queryByText('too short')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1 issue' }));
    expect(screen.getByText('too short')).toBeVisible();
    expect(screen.getAllByLabelText('Instance payload')).toHaveLength(1);
    expect(screen.queryByText('Raw JSON')).not.toBeInTheDocument();
  });

  it('returns to the selected instance type through Explore navigation', () => {
    const navigateToType = vi.fn();
    useExploreNavigationStore.getState().setNavigateToType(navigateToType);
    const id = useInstanceStore.getState().createInstance('test.Party', 'My Party');

    render(<InstanceInspectorPanel instanceId={id} />);
    screen.getByRole('button', { name: 'View type in Explore' }).click();

    expect(navigateToType).toHaveBeenCalledWith('test.Party');
  });

  it('does not label an unavailable validation run as valid', () => {
    const id = useInstanceStore.getState().createInstance('test.Party', 'My Party');
    useInstanceStore.setState({
      validationStatus: { [id]: 'unavailable' },
      schemaErrors: new Map([
        ['test.Party', { reason: 'generation-error', message: 'Curated dependency is unavailable.' }]
      ])
    });

    render(<InstanceInspectorPanel instanceId={id} />);

    expect(screen.getByText('Curated dependency is unavailable.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry validation' })).toBeVisible();
    expect(screen.queryByText('Valid')).not.toBeInTheDocument();
  });

  it('flushes an instance before downloading its JSON payload', async () => {
    const id = useInstanceStore.getState().createInstance('test.Party', 'My Party');
    const flushInstance = vi.fn().mockResolvedValue(undefined);
    useInstanceStore.setState({ flushInstance });

    render(<InstanceInspectorPanel instanceId={id} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(flushInstance).toHaveBeenCalledWith(id));
  });
});
