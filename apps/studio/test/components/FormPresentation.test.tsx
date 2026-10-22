// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormPreviewPanel } from '../../src/components/FormPreviewPanel.js';
import { useFormPresentationStore } from '../../src/store/form-presentation-store.js';
import type { FormPreviewSchema } from '@rune-langium/codegen/export';
const schema: FormPreviewSchema = {
  schemaVersion: 1,
  targetId: 'test.Trade',
  kind: 'data',
  title: 'Trade',
  status: 'ready',
  fields: [
    { path: 'amount', label: 'Amount', kind: 'number', typeSymbol: 'typeAlias:test.Amount', required: true },
    { path: 'tax', label: 'Tax', kind: 'number', typeSymbol: 'typeAlias:test.Amount', required: true },
    { path: 'quantity', label: 'Quantity', kind: 'number', typeSymbol: 'builtin:number', required: true },
    { path: 'name', label: 'Name', kind: 'string', typeSymbol: 'builtin:string', required: true }
  ]
};
beforeEach(() => {
  useFormPresentationStore.setState({ workspaces: {} });
});
const status = { state: 'ready' as const, targetId: schema.targetId };
const values = { amount: 1234.56789, tax: 12.3456, quantity: 125, name: 'Trade A' };
async function select(label: string, option: string) {
  const user = userEvent.setup({ writeToClipboard: false });
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option, exact: true }));
}
it('reorders actual DOM fields by keyboard, preserving values and ignoring deleted fields on restore', async () => {
  const change = vi.fn();
  const { container, rerender } = render(
    <FormPreviewPanel schema={schema} status={status} values={values} onValuesChange={change} />
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Edit layout' }));
  const handle = screen.getByRole('button', { name: 'Move Amount', exact: true });
  handle.focus();
  fireEvent.keyDown(handle, { key: 'End' });
  expect(
    [...container.querySelectorAll('[data-layout-field]')].map((node) => node.getAttribute('data-layout-field'))
  ).toEqual(['tax', 'quantity', 'name', 'amount']);
  expect(handle).toHaveFocus();
  expect(change).not.toHaveBeenCalled();
  rerender(
    <FormPreviewPanel
      schema={{
        ...schema,
        fields: [...schema.fields.slice(0, 3), { path: 'added', label: 'Added', kind: 'string', required: false }]
      }}
      status={status}
      values={values}
      onValuesChange={change}
    />
  );
  expect(
    [...container.querySelectorAll('[data-layout-field]')].map((node) => node.getAttribute('data-layout-field'))
  ).toEqual(['tax', 'quantity', 'amount', 'added']);
});
it('applies a format to the declared scalar symbol, leaving other numeric symbols and raw payloads intact', async () => {
  const change = vi.fn();
  render(<FormPreviewPanel schema={schema} status={status} values={values} onValuesChange={change} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Edit layout' }));
  await userEvent.click(screen.getAllByRole('button', { name: 'Format test.Amount' })[0]!);
  await select('Number format', 'Currency');
  expect(screen.getByLabelText('Amount', { exact: true })).toHaveValue('$1,234.57');
  expect(screen.getByLabelText('Tax', { exact: true })).toHaveValue('$12.35');
  expect(screen.getByLabelText('Quantity', { exact: true })).toHaveValue(125);
  await userEvent.keyboard('{Escape}');
  const input = screen.getByLabelText('Amount', { exact: true });
  fireEvent.focus(input);
  expect(input).toHaveValue(1234.56789);
  fireEvent.blur(input);
  expect(input).toHaveValue('$1,234.57');
  expect(change).not.toHaveBeenCalled();
  expect(values.amount).toBe(1234.56789);
});
it('shares an object symbol layout between different nested paths', async () => {
  await useFormPresentationStore.getState().load();
  useFormPresentationStore.getState().update(undefined, (current) => ({
    ...current,
    layouts: { 'data:test.Address': { columns: 2, order: ['postalCode', 'city'], spans: { city: 'full' } } }
  }));
  const address = (path: string) => ({
    path,
    label: path,
    kind: 'object' as const,
    typeSymbol: 'data:test.Address',
    required: true,
    children: [
      { path: `${path}.city`, label: 'City', kind: 'string' as const, required: true },
      { path: `${path}.postalCode`, label: 'Postal code', kind: 'string' as const, required: true }
    ]
  });
  const { container } = render(
    <FormPreviewPanel
      schema={{ ...schema, fields: [address('billing'), address('shipping')] }}
      status={status}
      values={{ billing: { city: 'London', postalCode: 'E1' }, shipping: { city: 'Paris', postalCode: '75001' } }}
      onValuesChange={() => {}}
    />
  );
  for (const path of ['billing', 'shipping']) {
    const group = container.querySelector(`[data-field-path="${path}"]`)!;
    expect(
      [...group.querySelectorAll('[data-layout-field]')].map((node) => node.getAttribute('data-layout-field'))
    ).toEqual(['postalCode', 'city']);
    expect(within(group as HTMLElement).getByLabelText('City', { exact: true })).toHaveValue(
      path === 'billing' ? 'London' : 'Paris'
    );
  }
});

it('retains precise decimal strings and validation cues through focus and display formatting', async () => {
  await useFormPresentationStore.getState().load();
  useFormPresentationStore.getState().update(undefined, (current) => ({
    ...current,
    formats: { 'typeAlias:test.Amount': { style: 'currency', currency: 'JPY', grouping: true, fractionDigits: 0 } }
  }));
  const change = vi.fn();
  const raw = '123456789012345678.123456';
  render(
    <FormPreviewPanel
      schema={schema}
      status={status}
      values={{ ...values, amount: raw }}
      onValuesChange={change}
      errors={{ amount: 'Amount needs review' }}
      validated
      valid={false}
    />
  );
  const amount = screen.getByLabelText('Amount', { exact: true });
  expect(amount).toHaveAttribute('aria-invalid', 'true');
  expect(amount).toHaveAccessibleDescription('Amount needs review');
  fireEvent.focus(amount);
  expect((amount as HTMLInputElement).value).toBe(raw);
  fireEvent.blur(amount);
  expect((amount as HTMLInputElement).value).toContain('123,456,789,012,345,678');
  expect(change).not.toHaveBeenCalled();
});
