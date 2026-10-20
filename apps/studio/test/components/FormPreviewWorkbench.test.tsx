// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormPreviewSchema } from '@rune-langium/codegen/export';
import { usePreviewStore } from '../../src/store/preview-store.js';
import { FormPreviewPanel } from '../../src/components/FormPreviewPanel.js';

const schema: FormPreviewSchema = {
  schemaVersion: 1,
  targetId: 'test.Collection',
  title: 'Collection',
  status: 'ready',
  fields: [
    {
      path: 'parties',
      label: 'Parties',
      kind: 'array',
      required: false,
      children: [
        {
          path: 'parties[]',
          label: 'Party',
          kind: 'object',
          required: true,
          children: [
            { path: 'parties[].name', label: 'Name', kind: 'string', required: true },
            { path: 'parties[].enabled', label: 'Enabled', kind: 'boolean', required: false },
            { path: 'parties[].amount', label: 'Amount', kind: 'number', required: false },
            {
              path: 'parties[].contact',
              label: 'Contact',
              kind: 'object',
              required: false,
              children: [{ path: 'parties[].contact.email', label: 'Email', kind: 'string', required: true }]
            }
          ]
        }
      ]
    }
  ]
};
const initial = {
  parties: [{ name: 'Acme', enabled: false, amount: 0, contact: { email: 'a@example.com' } }, { name: 'Beta' }]
};
function Editor({
  model = schema,
  values = initial as Record<string, unknown>,
  errors = {}
}: {
  model?: FormPreviewSchema;
  values?: Record<string, unknown>;
  errors?: Record<string, string>;
}) {
  const [data, setData] = useState(values);
  return (
    <>
      <FormPreviewPanel
        schema={model}
        status={{ state: 'ready' }}
        values={data}
        onValuesChange={setData}
        errors={errors}
        validated={Object.keys(errors).length > 0}
      />
      <output data-testid="values">{JSON.stringify(data)}</output>
    </>
  );
}

describe('preview collection workbench', () => {
  it('summarizes schema columns, retaining zero/false, and edits the selected item live', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    const table = screen.getByRole('table', { name: 'Parties' });
    expect(within(table).getByRole('cell', { name: 'false' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '0' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
    const opener = screen.getByRole('button', { name: 'Open Parties 1 details' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog');
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Updated');
    expect(screen.getByTestId('values')).toHaveTextContent('"name":"Updated"');
    await user.click(within(dialog).getByText('Enabled', { exact: true }));
    expect(within(dialog).getByRole('checkbox', { name: 'Enabled' })).toBeChecked();
    expect(screen.getByTestId('values')).toHaveTextContent('"enabled":true');
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(within(table).getByRole('cell', { name: 'Updated' })).toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('opens nested details in one dialog and returns to the original item without losing edits', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await user.click(screen.getByRole('button', { name: 'Open Parties 1 details' }));
    await user.click(screen.getByRole('button', { name: 'Open Contact details' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'new@example.com' } });
    await user.click(screen.getByRole('button', { name: 'Back', exact: true }));
    expect(screen.getByRole('heading', { name: 'Party 1' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('new@example.com');
  });

  it('adds and removes object rows with canonical indices and an honest empty state', async () => {
    const user = userEvent.setup();
    render(<Editor values={{ parties: [] }} />);
    expect(screen.getByText('No items yet. Add an item to edit its details.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add Parties item' }));
    expect(screen.getByRole('button', { name: 'Open Parties 1 details' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actions for Parties 1' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove item' }));
    expect(screen.getByTestId('values')).toHaveTextContent('"parties":[]');
  });

  it('shows grid validation cues and the actual error alongside the field in full details', async () => {
    const user = userEvent.setup();
    render(<Editor errors={{ 'parties[1].name': 'Name is required' }} />);
    const cell = screen.getByRole('cell', { name: 'Beta' });
    expect(cell).toHaveAttribute('data-invalid', 'true');
    expect(cell).toHaveAttribute('title', 'Name is required');
    await user.click(screen.getByRole('button', { name: 'Open Parties 2 details' }));
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Name is required');
    expect(screen.getByRole('textbox', { name: 'Name' }).closest('[data-field-path]')).toHaveAttribute(
      'data-field-path',
      'parties[1].name'
    );
  });

  it('selects array-valued choice arms atomically and edits their list values', async () => {
    const model: FormPreviewSchema = {
      schemaVersion: 1,
      targetId: 'test.Choice',
      title: 'Choice',
      status: 'ready',
      kind: 'choice',
      fields: [
        { path: 'cash', label: 'Cash', kind: 'string', required: false },
        {
          path: 'tags',
          label: 'Tags',
          kind: 'array',
          required: false,
          children: [{ path: 'tags[]', label: 'Tag', kind: 'string', required: true }]
        }
      ]
    };
    const user = userEvent.setup();
    render(<Editor model={model} values={{ cash: '10' }} />);
    await user.click(screen.getByRole('combobox', { name: 'Choose one option' }));
    await user.click(await screen.findByRole('option', { name: 'Tags' }));
    expect(screen.getByTestId('values')).toHaveTextContent('{"tags":[]}');
    await user.click(screen.getByRole('button', { name: 'Add Tags item' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Tag 1' }), { target: { value: 'primary' } });
    expect(screen.getByTestId('values')).toHaveTextContent('{"tags":["primary"]}');
  });
  it('commits a picked time once without a closing blur restoring the old sample', async () => {
    const model: FormPreviewSchema = {
      schemaVersion: 1,
      targetId: 'test.PickedClock',
      title: 'Clock',
      status: 'ready',
      fields: [{ path: 'clock', label: 'Clock', kind: 'string', format: 'time', required: true }]
    };
    const user = userEvent.setup();
    render(<FormPreviewPanel schema={model} status={{ state: 'ready' }} />);
    await user.click(screen.getByRole('button', { name: 'Edit ISO value' }));
    fireEvent.change(screen.getByLabelText('Clock'), { target: { value: '14:30:12.123456780' } });
    await user.click(screen.getByRole('button', { name: 'Open Clock picker' }));
    fireEvent.change(screen.getByLabelText('Clock hour'), { target: { value: '15' } });
    await user.click(screen.getByRole('button', { name: 'Set time' }));
    expect(screen.getByLabelText('Clock')).toHaveValue('15:30:12.123456780');
    expect(usePreviewStore.getState().samples.get(model.targetId)?.values).toEqual({ clock: '15:30:12.123456780' });
  });

  it('does not reopen an old detail editor when returning to a previous schema target', async () => {
    const user = userEvent.setup();
    const view = render(<FormPreviewPanel schema={schema} status={{ state: 'ready' }} values={initial} />);
    await user.click(screen.getByRole('button', { name: 'Open Parties 1 details' }));
    view.rerender(
      <FormPreviewPanel schema={{ ...schema, targetId: 'test.Other' }} status={{ state: 'ready' }} values={initial} />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    view.rerender(<FormPreviewPanel schema={schema} status={{ state: 'ready' }} values={initial} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
