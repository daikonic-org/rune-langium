// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { InstanceInspectorPanel } from '../../../src/shell/panels/InstanceInspectorPanel.js';
import { PreviewSessionContext } from '../../../src/shell/providers/preview-session-context.js';
import { useInstanceStore } from '../../../src/store/instance-store.js';
import { usePrototypeViewStore } from '../../../src/store/prototype-view-store.js';
import type { FormPreviewSchema } from '@rune-langium/codegen/export';

vi.mock('../../../src/components/WorkspaceTypePicker.js', () => ({
  WorkspaceTypePicker: ({ onSelectOption }: { onSelectOption(option: unknown): void }) => (
    <div>
      <button onClick={() => onSelectOption({ value: 'test.Add#RosettaFunction' })}>Choose Add</button>
      <button onClick={() => onSelectOption(null)}>No transform</button>
    </div>
  )
}));
const money: FormPreviewSchema = {
  schemaVersion: 1,
  targetId: 'test.Money',
  title: 'Money',
  kind: 'data',
  status: 'ready',
  fields: [
    { path: 'amount', label: 'Amount', kind: 'number', required: true },
    { path: 'currency', label: 'Currency', kind: 'string', required: true }
  ]
};
const schema: FormPreviewSchema = {
  schemaVersion: 1,
  targetId: 'test.Add',
  title: 'Add',
  kind: 'function',
  status: 'ready',
  fields: ['value', 'other'].map((path) => ({
    path,
    label: path,
    kind: 'object',
    required: true,
    referencedTypeFqn: 'test.Money',
    typeSymbol: 'data:test.Money',
    children: money.fields.map((field) => ({ ...field, path: path + '.' + field.path }))
  })),
  result: {
    path: 'result',
    label: 'Result',
    kind: 'object',
    required: true,
    referencedTypeFqn: 'test.Money',
    children: money.fields.map((field) => ({ ...field, path: 'result.' + field.path }))
  }
};
const execute = vi.fn(async () => ({ amount: 1275, currency: 'USD' }));
const validate = vi.fn(async (target: string, data: Record<string, unknown>) => {
  if (target === 'test.Add') {
    const a = data.value as Record<string, unknown> | undefined,
      b = data.other as Record<string, unknown> | undefined;
    if (typeof b?.amount !== 'number') return [{ path: 'other.amount', message: 'Required number' }];
    if (a?.currency !== b.currency) return [{ path: '', message: 'SameCurrency failed' }];
  }
  return [];
});
const factory = () => ({
  schema: vi.fn(async (target: string) => (target === 'test.Money' ? money : schema)),
  validate,
  execute,
  project: vi.fn(),
  dispose: vi.fn()
});
function setup() {
  return render(
    <StrictMode>
      <PreviewSessionContext value={factory}>
        <InstanceInspectorPanel instanceId="stored" />
      </PreviewSessionContext>
    </StrictMode>
  );
}
beforeEach(() => {
  execute.mockClear();
  validate.mockClear();
  useInstanceStore.getState().setWorker(undefined);
  useInstanceStore.setState({
    instances: {
      stored: {
        id: 'stored',
        typeFqn: 'test.Money',
        name: 'Saved money',
        data: { amount: 1250, currency: 'USD' }
      } as never
    },
    schemas: new Map([['test.Money', money]]),
    prepareInstance: vi.fn(async () => {}),
    validationErrors: {},
    validationStatus: {},
    saveStates: {}
  });
  usePrototypeViewStore.setState({ state: { selectedId: 'stored', query: '', typeFqn: null, graphVisible: false } });
});
it('uses an independent draft and a complete no-function output', async () => {
  setup();
  const fields = await screen.findByRole('region', { name: 'input fields' });
  fireEvent.change(within(fields).getByRole('spinbutton', { name: 'Amount' }), { target: { value: '1300' } });
  await waitFor(() => expect(screen.getByTestId('instance-payload-output')).toHaveTextContent('1300'));
  expect(useInstanceStore.getState().instances.stored?.data).toEqual({ amount: 1250, currency: 'USD' });
  expect(execute).not.toHaveBeenCalled();
});
it('assigns equal inputs, validates conditions separately, executes and invalidates output on edit', async () => {
  setup();
  await screen.findByRole('region', { name: 'input fields' });
  fireEvent.click(screen.getByText('Choose Add'));
  fireEvent.click(within(await screen.findByRole('dialog')).getByText('value', { exact: true }));
  const other = await screen.findByRole('region', { name: 'other fields' });
  fireEvent.change(within(other).getByRole('spinbutton', { name: 'Amount' }), { target: { value: '25' } });
  fireEvent.change(within(other).getByRole('textbox', { name: 'Currency' }), { target: { value: 'EUR' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Add: 1 issue · View validation' }));
  expect(await screen.findByText(/SameCurrency failed/)).toBeVisible();
  expect(execute).not.toHaveBeenCalled();
  fireEvent.click(document.body);
  fireEvent.change(within(other).getByRole('textbox', { name: 'Currency' }), { target: { value: 'USD' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Execute' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Execute' }));
  await waitFor(() => expect(screen.getByTestId('instance-payload-output')).toHaveTextContent('1275'));
  expect(execute).toHaveBeenCalledWith(
    'test.Add',
    { value: { amount: 1250, currency: 'USD' }, other: { amount: 25, currency: 'USD' } },
    expect.any(AbortSignal)
  );
  fireEvent.change(within(other).getByRole('spinbutton', { name: 'Amount' }), { target: { value: '26' } });
  expect(screen.queryByTestId('instance-payload-output')).not.toBeInTheDocument();
  expect(useInstanceStore.getState().instances.stored?.data).toEqual({ amount: 1250, currency: 'USD' });
});
