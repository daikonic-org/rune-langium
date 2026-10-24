// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstanceGridPanel } from '../../../src/shell/panels/InstanceGridPanel.js';
import { useInstanceStore } from '../../../src/store/instance-store.js';
import { usePrototypeViewStore } from '../../../src/store/prototype-view-store.js';
import { OpfsFs } from '../../../src/opfs/opfs-fs.js';
import { readInstance } from '../../../src/opfs/instances-fs.js';
import { createOpfsRoot } from '../../setup/opfs-mock.js';

describe('InstanceGridPanel', () => {
  afterEach(async () => {
    await act(async () => {
      useInstanceStore.getState().setOpfsContext(new OpfsFs(createOpfsRoot() as never), '/grid-cleanup');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
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
  });

  it('renames an instance through the lifecycle action', () => {
    const id = useInstanceStore.getState().createInstance('test.Party', 'Acme');
    render(<InstanceGridPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Example name'), { target: { value: 'Acme Holdings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename', exact: true }));

    expect(useInstanceStore.getState().instances[id]?.name).toBe('Acme Holdings');
  });

  it('requires confirmation before deleting an instance', () => {
    const id = useInstanceStore.getState().createInstance('test.Party', 'Acme');
    render(<InstanceGridPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('heading', { name: 'Delete example?' })).toBeVisible();
    expect(useInstanceStore.getState().instances[id]).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useInstanceStore.getState().instances[id]).toBeDefined();
  });

  it('shows preview-schema fields for a selected type', () => {
    const id = useInstanceStore.getState().createInstance('test.Party', 'Acme', { name: 'Acme' });
    useInstanceStore.setState({
      schemas: new Map([
        [
          'test.Party',
          {
            schemaVersion: 1,
            targetId: 'test.Party',
            title: 'Party',
            status: 'ready',
            fields: [{ path: 'name', label: 'Legal name', kind: 'string', required: true }]
          }
        ]
      ]),
      instances: {
        ...useInstanceStore.getState().instances,
        [id]: { ...useInstanceStore.getState().instances[id]!, data: { name: 'Acme' } }
      }
    });
    usePrototypeViewStore.setState((store) => ({ state: { ...store.state, typeFqn: 'test.Party' } }));

    render(<InstanceGridPanel />);

    expect(screen.getByRole('columnheader', { name: 'Legal name' })).toBeVisible();
    expect(screen.getByRole('row', { name: /Acme test\.Party Acme/ })).toBeVisible();
  });

  it('retries a failed save from the grid and persists the same object without selecting it', async () => {
    const fs = new OpfsFs(createOpfsRoot() as never);
    const originalWrite = fs.writeFile.bind(fs);
    let fail = true;
    vi.spyOn(fs, 'writeFile').mockImplementation(async (path, data) => {
      if (fail) throw new Error('disk full');
      return originalWrite(path, data);
    });
    useInstanceStore.getState().setOpfsContext(fs, '/grid-retry');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const id = useInstanceStore.getState().createInstance('test.Party', 'Recover me', { data: { name: 'Alice' } });
    await vi.waitFor(() => expect(useInstanceStore.getState().saveStates[id]?.state).toBe('failed'));
    render(<InstanceGridPanel />);
    const user = userEvent.setup({ writeToClipboard: false });
    await user.click(screen.getByRole('button', { name: 'Retry saving Recover me' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full');
    fail = false;
    const retry = await screen.findByRole('button', { name: 'Retry saving Recover me' });
    retry.focus();
    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(useInstanceStore.getState().saveStates[id]?.state).toBe('saved'));
    expect(screen.queryByRole('button', { name: 'Retry saving Recover me' })).not.toBeInTheDocument();
    expect(usePrototypeViewStore.getState().state.selectedId).toBeNull();
    expect((await readInstance(fs, '/grid-retry', id)).data).toEqual({ name: 'Alice' });
  });
});
