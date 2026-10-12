// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { useStore } from 'zustand';
import { render, screen, fireEvent, act, within, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DataTypeForm } from '../../src/components/editors/DataTypeForm.js';
import { EnumForm } from '../../src/components/editors/EnumForm.js';
import { ChoiceForm } from '../../src/components/editors/ChoiceForm.js';
import { loadInspectorFixture } from '../helpers/inspector-fixture.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('Data keeps invalid row drafts and targets member metadata through rename/reorder', async () => {
  const { store, getNode } = await loadInspectorFixture();
  const id = getNode('Person').id;
  function Fixture() {
    const state = useStore(store);
    const node = state.nodesById.get(id)!;
    return (
      <DataTypeForm
        nodeId={id}
        data={node.data}
        meta={node.meta}
        actions={state}
        availableTypes={[]}
        allNodes={state.nodes}
        parseEpoch={state.parseEpoch}
      />
    );
  }
  vi.useFakeTimers();
  render(<Fixture />);
  const first = screen.getByLabelText('Attribute name: name');
  fireEvent.focus(first);
  let details = screen.getByRole('region', { name: 'Details: name' });
  fireEvent.change(within(details).getByLabelText('Definition'), { target: { value: 'Full name' } });
  fireEvent.focus(screen.getByLabelText('Attribute name: age'));
  await act(async () => vi.advanceTimersByTime(500));
  expect(store.getState().captureMetadataTarget(id, ['attributes', 0])?.expected).toMatchObject({
    definition: 'Full name'
  });
  expect(getNode('Person').data).not.toHaveProperty('definition');
  fireEvent.focus(screen.getByLabelText('Attribute name: name'));
  fireEvent.change(screen.getByLabelText('Attribute name: name'), { target: { value: '' } });
  fireEvent.focus(screen.getByLabelText('Attribute name: age'));
  fireEvent.focus(screen.getByLabelText(/^Attribute name:\s*$/));
  expect(screen.getByLabelText(/^Attribute name:\s*$/)).toHaveValue('');
  await act(async () => Promise.resolve());
  expect(screen.getByLabelText(/^Attribute name:\s*$/)).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(screen.getByLabelText(/^Attribute name:\s*$/), { target: { value: 'fullName' } });
  await act(async () => vi.advanceTimersByTime(500));
  const payload = new Map<string, string>();
  const dataTransfer = {
    setData: (key: string, value: string) => payload.set(key, value),
    getData: (key: string) => payload.get(key) ?? '',
    effectAllowed: 'move',
    dropEffect: 'move'
  };
  fireEvent.dragStart(screen.getByLabelText('Attribute name: fullName').closest('[data-slot="attribute-row"]')!, {
    dataTransfer
  });
  fireEvent.drop(screen.getByLabelText('Attribute name: age').closest('[data-slot="attribute-row"]')!, {
    dataTransfer
  });
  details = screen.getByRole('region', { name: 'Details: fullName' });
  fireEvent.change(within(details).getByLabelText('Definition'), { target: { value: 'Renamed docs' } });
  await act(async () => vi.advanceTimersByTime(500));
  expect(store.getState().captureMetadataTarget(id, ['attributes', 1])?.expected).toMatchObject({
    name: 'fullName',
    definition: 'Renamed docs'
  });
});

it('Enum details on a later page retain display through a pending rename and clear', async () => {
  const { store, getNode } = await loadInspectorFixture(
    `namespace demo.forms\nversion "1"\nenum Values:\n${Array.from({ length: 60 }, (_, i) => `  Value${i}`).join('\n')}\n`
  );
  const id = getNode('Values').id;
  function Fixture() {
    const state = useStore(store);
    const node = state.nodesById.get(id)!;
    return (
      <EnumForm
        nodeId={id}
        data={node.data}
        meta={node.meta}
        actions={state}
        availableTypes={[]}
        allNodes={state.nodes}
        parseEpoch={state.parseEpoch}
      />
    );
  }
  vi.useFakeTimers();
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: /Show more/ }));
  const row = screen.getByLabelText('Value name for Value55');
  fireEvent.focus(row);
  const details = screen.getByRole('region', { name: 'Details: Value55' });
  expect(row.closest('[data-slot="enum-value-row"]')?.querySelector('[aria-label="Display name"]')).toBeNull();
  fireEvent.change(within(details).getByLabelText('Display name'), { target: { value: 'Readable value' } });
  fireEvent.change(row, { target: { value: 'LaterValue' } });
  await act(async () => vi.advanceTimersByTime(500));
  expect(store.getState().captureMetadataTarget(id, ['enumValues', 55])?.expected).toMatchObject({
    name: 'LaterValue',
    display: 'Readable value'
  });
  fireEvent.change(within(screen.getByRole('region', { name: 'Details: LaterValue' })).getByLabelText('Display name'), {
    target: { value: '' }
  });
  await act(async () => vi.advanceTimersByTime(500));
  fireEvent.change(screen.getByLabelText('Value name for LaterValue'), { target: { value: 'FinalValue' } });
  await act(async () => vi.advanceTimersByTime(500));
  expect(store.getState().captureMetadataTarget(id, ['enumValues', 55])?.expected).toMatchObject({
    name: 'FinalValue',
    display: undefined
  });
});

it('inherited Data details remain inspection-only until an explicit override', async () => {
  const { store, getNode } = await loadInspectorFixture();
  const id = getNode('Employee').id;
  function Fixture() {
    const state = useStore(store);
    const node = state.nodesById.get(id)!;
    return (
      <DataTypeForm
        nodeId={id}
        data={node.data}
        meta={node.meta}
        actions={state}
        availableTypes={[]}
        allNodes={state.nodes}
      />
    );
  }
  render(<Fixture />);
  fireEvent.focus(screen.getByRole('listitem', { name: 'Inspect name' }));
  expect(within(screen.getByRole('region', { name: 'Details: name' })).queryByRole('textbox')).toBeNull();
  const before = getNode('Person').data;
  fireEvent.click(screen.getByRole('button', { name: 'Override inherited attribute name from Person' }));
  expect(getNode('Person').data).toBe(before);
});

it('Choice selects canonical options without registering unsupported metadata', async () => {
  const { store, getNode } = await loadInspectorFixture();
  const node = getNode('PersonOrRole');
  render(
    <ChoiceForm
      nodeId={node.id}
      data={node.data}
      meta={node.meta}
      actions={store.getState()}
      availableTypes={[]}
      allNodes={store.getState().nodes}
    />
  );
  fireEvent.focus(screen.getByRole('listitem', { name: 'Inspect Person' }));
  expect(screen.getByRole('region', { name: 'Details: Person' })).toBeVisible();
  expect(within(screen.getByRole('region', { name: 'Details: Person' })).queryByLabelText('Display name')).toBeNull();
});
