// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstanceExplorerPanel } from '../../../src/shell/panels/InstanceExplorerPanel.js';
import { useInstanceStore } from '../../../src/store/instance-store.js';

describe('InstanceExplorerPanel', () => {
  beforeEach(() => {
    useInstanceStore.setState({ instances: {} });
  });

  it('lists existing instances and calls onSelect when a row is clicked', () => {
    useInstanceStore.getState().createInstance('test.Party', 'My Party');
    const onSelect = vi.fn();
    render(<InstanceExplorerPanel onSelect={onSelect} selectedId={undefined} />);
    fireEvent.click(screen.getByText('My Party'));
    expect(onSelect).toHaveBeenCalledWith(expect.any(String));
  });

  it('filters the list by the search box', () => {
    useInstanceStore.getState().createInstance('test.Party', 'Alpha');
    useInstanceStore.getState().createInstance('test.Party', 'Beta');
    render(<InstanceExplorerPanel onSelect={() => {}} selectedId={undefined} />);
    fireEvent.change(screen.getByPlaceholderText('Search examples'), { target: { value: 'Alp' } });
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  });

  it('creates a new instance from the type FQN + name inputs and selects it', () => {
    const onSelect = vi.fn();
    render(<InstanceExplorerPanel onSelect={onSelect} selectedId={undefined} />);

    fireEvent.change(screen.getByLabelText('Create example type'), { target: { value: 'test.Party' } });
    fireEvent.change(screen.getByLabelText('Create example name'), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    const instances = Object.values(useInstanceStore.getState().instances);
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({ typeFqn: 'test.Party', name: 'Acme' });
    expect(onSelect).toHaveBeenCalledWith(instances[0]!.id);
  });

  it('disables the Create button when the type or name input is empty/whitespace-only', () => {
    render(<InstanceExplorerPanel onSelect={() => {}} selectedId={undefined} />);
    const createButton = screen.getByRole('button', { name: 'Create' });

    expect(createButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Create example type'), { target: { value: 'test.Party' } });
    expect(createButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Create example name'), { target: { value: '   ' } });
    expect(createButton).toBeDisabled();

    fireEvent.click(createButton);
    expect(Object.values(useInstanceStore.getState().instances)).toHaveLength(0);
  });
});
