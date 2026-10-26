// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { WorkflowImport } from '../../src/components/WorkflowImport.js';
import { PreviewSessionContext } from '../../src/shell/providers/preview-session-context.js';
import { useInstanceStore } from '../../src/store/instance-store.js';

async function setup(
  decode = vi.fn(async (_type: string, data: unknown, _signal: AbortSignal) => data),
  typeFqn = 'test.Payment'
) {
  const onImport = vi.fn();
  const factory = () => ({
    decode,
    schema: vi.fn(),
    validate: vi.fn(),
    execute: vi.fn(),
    project: vi.fn(),
    dispose: vi.fn()
  });
  render(
    <StrictMode>
      <PreviewSessionContext value={factory}>
        <WorkflowImport typeFqn={typeFqn} onImport={onImport} />
      </PreviewSessionContext>
    </StrictMode>
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Import input…' }));
  await user.click(screen.getByRole('combobox', { name: 'Import format' }));
  await user.click(await screen.findByRole('option', { name: 'Rune JSON', exact: true }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Import JSON data' }), {
    target: { value: JSON.stringify({ amount: { '@data': 21, '@scheme': 'USD' } }) }
  });
  return { user, onImport, decode };
}
it('uses the shared decoder before publishing a Rune JSON object as a workflow input', async () => {
  const { user, onImport, decode } = await setup();
  await user.click(screen.getByRole('button', { name: 'Import', exact: true }));
  await waitFor(() =>
    expect(onImport).toHaveBeenCalledWith(
      [{ amount: { value: 21, meta: { scheme: 'USD' } } }],
      'test.Payment',
      'RUNE_JSON'
    )
  );
  expect(decode).toHaveBeenCalledWith(
    'test.Payment',
    { amount: { value: 21, meta: { scheme: 'USD' } } },
    expect.any(AbortSignal)
  );
});
it.each(['workspace', 'cancel'])('does not publish delayed input after %s changes', async (mode) => {
  let finish!: (data: unknown) => void;
  const decode = vi.fn(
    (_type: string, _data: unknown, _signal: AbortSignal) =>
      new Promise<unknown>((resolve) => {
        finish = resolve;
      })
  );
  const { user, onImport } = await setup(decode);
  await user.click(screen.getByRole('button', { name: 'Import', exact: true }));
  await waitFor(() => expect(decode).toHaveBeenCalledOnce());
  if (mode === 'cancel') await user.click(screen.getByRole('button', { name: 'Cancel' }));
  else act(() => useInstanceStore.setState({ workspaceEpoch: useInstanceStore.getState().workspaceEpoch + 1 }));
  await act(async () => finish({ amount: 21 }));
  expect(onImport).not.toHaveBeenCalled();
});

it.each([true, false])(
  'defers concrete Choice identity to the linked decoder and preserves its rejection (valid=%s)',
  async (valid) => {
    const decode = vi.fn(async (_type: string, data: unknown, _signal: AbortSignal) => {
      if (!valid) throw new Error('Concrete type is not assignable to test.Instrument.');
      return { bond: data };
    });
    const { user, onImport } = await setup(decode, 'test.Instrument#Choice');
    const value = { '@type': 'test.Bond', amount: 21 };
    fireEvent.change(screen.getByRole('textbox', { name: 'Import JSON data' }), {
      target: { value: JSON.stringify(value) }
    });
    await user.click(screen.getByRole('button', { name: 'Import', exact: true }));
    await waitFor(() => expect(decode).toHaveBeenCalledWith('test.Instrument#Choice', value, expect.any(AbortSignal)));
    if (valid) expect(onImport).toHaveBeenCalledWith([{ bond: value }], 'test.Instrument#Choice', 'RUNE_JSON');
    else {
      expect(await screen.findByRole('alert')).toHaveTextContent('not assignable');
      expect(onImport).not.toHaveBeenCalled();
    }
  }
);
