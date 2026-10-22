// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { FormPreviewSchema } from '@rune-langium/codegen/export';

const { read, write } = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('../../src/shell/workbench-settings.js', () => ({
  readWorkbenchSettings: read,
  writeWorkbenchSettings: write
}));
import { WorkflowNode } from '../../src/components/WorkflowNode.js';
import { useFormPresentationStore } from '../../src/store/form-presentation-store.js';
import { WorkspaceStateContext } from '../../src/shell/providers/workspace-context.js';

const saved = {
  layouts: { 'data:test.Money': { columns: 1, order: ['currency', 'amount'], spans: {} } },
  formats: {}
};
const schema: FormPreviewSchema = {
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

function renderNode(readOnly = false) {
  return render(
    <WorkspaceStateContext
      value={{
        workspaceId: 'a',
        fileCount: 0,
        files: [],
        models: [],
        parsedModels: [],
        deferredExports: [],
        parseErrors: new Map()
      }}
    >
      <WorkflowNode
        name="value"
        schema={schema}
        values={{ amount: 1, currency: 'USD' }}
        onChange={vi.fn()}
        readOnly={readOnly}
      />
    </WorkspaceStateContext>
  );
}

beforeEach(() => {
  useFormPresentationStore.setState({ workspaces: {} });
  read.mockReset();
  write.mockReset().mockResolvedValue(undefined);
});

it('waits for saved preferences before enabling node layout edits', async () => {
  let finish!: (value: unknown) => void;
  read.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { container } = renderNode();
  const edit = screen.getByRole('button', { name: 'value: Edit layout' });
  expect(edit).toBeDisabled();
  await userEvent.click(edit);
  expect(screen.queryByRole('button', { name: 'Move Amount' })).not.toBeInTheDocument();
  expect(write).not.toHaveBeenCalled();
  useFormPresentationStore.getState().setEditing('a', false);
  await act(async () => finish(saved));
  expect(edit).toBeEnabled();
  await userEvent.click(edit);
  expect(
    [...container.querySelectorAll('[data-layout-field]')].map((el) => el.getAttribute('data-layout-field'))
  ).toEqual(['currency', 'amount']);
  expect(screen.getByRole('button', { name: 'Move Amount' })).toBeVisible();
});

it.each([false, true])('keeps failed preferences recoverable before editing (readOnly=%s)', async (readOnly) => {
  read.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(saved);
  const { container } = renderNode(readOnly);
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'value: Edit layout' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Retry', exact: true }));
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'value: Edit layout' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'value: Edit layout' }));
  expect(
    [...container.querySelectorAll('[data-layout-field]')].map((el) => el.getAttribute('data-layout-field'))
  ).toEqual(['currency', 'amount']);
  expect(write).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledTimes(2);
});
