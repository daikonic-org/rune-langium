// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { FormPreviewSchema } from '@rune-langium/codegen/export';

const { read, write } = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('../../src/shell/workbench-settings.js', () => ({
  readWorkbenchSettings: read,
  writeWorkbenchSettings: write
}));
import { useExploreNavigationStore } from '../../src/services/explore-navigation.js';
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
  useExploreNavigationStore.setState({ navigateToType: undefined });
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

it('offers canonical header navigation without replacing native input menus', async () => {
  read.mockResolvedValue({ layouts: {}, formats: {} });
  const navigate = vi.fn();
  useExploreNavigationStore.setState({ navigateToType: navigate });
  const { container } = render(
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
        type="Money"
        typeNodeId="test.Money#Data"
        schema={schema}
        values={{ amount: 1, currency: 'USD' }}
        onChange={vi.fn()}
      />
    </WorkspaceStateContext>
  );
  const chip = screen.getByRole('button', { name: 'View Money in Explore' });
  fireEvent.keyDown(chip, { key: 'F10', shiftKey: true });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Go to type' }));
  expect(navigate).toHaveBeenLastCalledWith('test.Money#Data');
  fireEvent.contextMenu(container.querySelector('header')!);
  expect(await screen.findByRole('menuitem', { name: 'Go to type' })).toBeVisible();
  await userEvent.keyboard('{Escape}');
  expect(fireEvent.contextMenu(screen.getByRole('textbox', { name: 'Currency' }))).toBe(true);
  expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
});
it('shows shared save readiness and keeps layout completion disabled until persistence finishes', async () => {
  read.mockResolvedValue(saved);
  let finish!: () => void;
  write.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  renderNode();
  const edit = screen.getByRole('button', { name: 'value: Edit layout' });
  await vi.waitFor(() => expect(edit).toBeEnabled());
  await userEvent.click(edit);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Move Amount' }), { key: 'ArrowUp' });
  await screen.findByText('Saving…', { exact: true });
  const done = screen.getByRole('button', { name: 'Done', exact: true });
  expect(done).toBeDisabled();
  expect(screen.getByRole('button', { name: 'value: Finish editing layout' })).toBeDisabled();
  await act(async () => finish());
  await screen.findByText('Saved in this workspace', { exact: true });
  expect(done).toBeEnabled();
  await userEvent.click(done);
  expect(screen.queryByRole('button', { name: 'Move Amount' })).toBeNull();
});
