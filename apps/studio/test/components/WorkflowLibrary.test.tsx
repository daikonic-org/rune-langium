// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../../src/workspace/workflow-repository.js', () => ({ saveWorkflow: vi.fn().mockResolvedValue(undefined) }));
import { saveWorkflow } from '../../src/workspace/workflow-repository.js';
import { WorkflowLibrary } from '../../src/components/WorkflowLibrary.js';
import { ProjectContext } from '../../src/shell/providers/project-context.js';
import type { ProjectSnapshot } from '@rune-langium/project-config';
it('does not carry a saved recipe selection into another workspace', async () => {
  const recipe = { schemaVersion: 1, id: 'old', name: 'Old workflow', inputs: {}, outputs: {} };
  const snapshot = (files: Map<string, string>) =>
    ({
      files,
      project: { studio: { workflows: 'workflows', examples: 'examples', layouts: 'layouts' } }
    }) as unknown as ProjectSnapshot;
  const capture = vi.fn((id: string, name: string) => ({ ...recipe, id, name }) as never),
    open = vi.fn().mockResolvedValue(undefined);
  const controller = {} as never;
  const view = render(
    <ProjectContext
      value={{
        status: 'ready',
        workspaceId: 'one',
        diagnostics: [],
        controller,
        snapshot: snapshot(new Map([['workflows/old.workflow.json', JSON.stringify(recipe)]]))
      }}
    >
      <WorkflowLibrary capture={capture} open={open} />
    </ProjectContext>
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: 'Saved workflow', exact: true }));
  await user.click(await screen.findByRole('option', { name: 'Old workflow', exact: true }));
  await waitFor(() => expect(open).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Saved workflow', exact: true })).toHaveTextContent('Old workflow')
  );
  view.rerender(
    <ProjectContext
      value={{
        status: 'ready',
        workspaceId: 'two',
        diagnostics: [],
        controller,
        snapshot: snapshot(
          new Map([['workflows/copied.workflow.json', JSON.stringify({ ...recipe, name: 'Copied workflow' })]])
        )
      }}
    >
      <WorkflowLibrary capture={capture} open={open} />
    </ProjectContext>
  );
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Saved workflow', exact: true })).toHaveTextContent('Unsaved workflow')
  );
  await user.click(screen.getByRole('button', { name: 'Save workflow…', exact: true }));
  await user.type(await screen.findByLabelText('Workflow name', { exact: true }), 'New workspace recipe');
  await user.click(screen.getByRole('button', { name: 'Save workflow', exact: true }));
  await waitFor(() => expect(capture).toHaveBeenCalledWith(expect.any(String), 'New workspace recipe'));
  expect(capture.mock.lastCall?.[0]).not.toBe('old');
});

it('marks edited recipes unsaved and restores each recipe draft when switching back', async () => {
  const recipe = (id: string, amount: number) => ({
    schemaVersion: 1 as const,
    id,
    name: id,
    inputs: { amount: { kind: 'literal' as const, value: amount } },
    outputs: {}
  });
  function Host() {
    const [amount, setAmount] = useState(0);
    return (
      <ProjectContext
        value={{
          status: 'ready',
          workspaceId: 'drafts',
          diagnostics: [],
          controller: {} as never,
          snapshot: {
            files: new Map(
              ['One', 'Two'].map((id, i) => [`workflows/${id}.workflow.json`, JSON.stringify(recipe(id, i + 1))])
            ),
            project: { studio: { workflows: 'workflows', examples: 'examples', layouts: 'layouts' } }
          } as never
        }}
      >
        <input aria-label="Amount" type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        <WorkflowLibrary
          capture={(id, name) => ({ ...recipe(id, amount), name })}
          open={async (value) => setAmount(Number((value.inputs.amount as { value: number }).value))}
        />
      </ProjectContext>
    );
  }
  render(<Host />);
  const user = userEvent.setup();
  const choose = async (name: string) => {
    await user.click(screen.getByRole('combobox', { name: 'Saved workflow', exact: true }));
    await user.click(await screen.findByRole('option', { name, exact: true }));
  };
  await choose('One');
  await waitFor(() => expect(screen.getByLabelText('Amount')).toHaveValue(1));
  expect(screen.queryByText('Unsaved changes')).toBeNull();
  await user.clear(screen.getByLabelText('Amount'));
  await user.type(screen.getByLabelText('Amount'), '7');
  expect(screen.getByText('Unsaved changes')).toBeVisible();
  await choose('Two');
  await waitFor(() => expect(screen.getByLabelText('Amount')).toHaveValue(2));
  await choose('One');
  await waitFor(() => expect(screen.getByLabelText('Amount')).toHaveValue(7));
  expect(screen.getByText('Unsaved changes')).toBeVisible();
});

it('keeps edits made during Save visibly dirty against the exact recipe that was written', async () => {
  let finish!: () => void;
  vi.mocked(saveWorkflow).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  function Host() {
    const [amount, setAmount] = useState(3);
    return (
      <ProjectContext value={{ status: 'ready', workspaceId: 'save-race', diagnostics: [], controller: {} as never }}>
        <input aria-label="Amount" type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        <WorkflowLibrary
          capture={(id, name) => ({
            schemaVersion: 1,
            id,
            name,
            inputs: { amount: { kind: 'literal', value: amount } },
            outputs: {}
          })}
          open={async () => {}}
        />
      </ProjectContext>
    );
  }
  render(<Host />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Save workflow…', exact: true }));
  await user.type(screen.getByLabelText('Workflow name'), 'Bonds');
  await user.click(screen.getByRole('button', { name: 'Save workflow', exact: true }));
  // Programmatic input edits model a worker/store update while the modal Save is pending.
  const { fireEvent, act } = await import('@testing-library/react');
  fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '9' } });
  await act(async () => finish());
  expect(await screen.findByText('Unsaved changes')).toBeVisible();
  expect(vi.mocked(saveWorkflow).mock.lastCall?.[1].inputs.amount).toEqual({ kind: 'literal', value: 3 });
});

it('starts a separate unsaved workflow while preserving the named recipe draft', async () => {
  const user = userEvent.setup();
  const recipe = {
    schemaVersion: 1 as const,
    id: 'cash',
    name: 'Cash',
    inputs: { change: { kind: 'literal' as const, value: 250 } },
    outputs: {}
  };
  const open = vi.fn().mockResolvedValue(undefined),
    onNew = vi.fn();
  render(
    <ProjectContext
      value={{
        status: 'ready',
        workspaceId: 'new-workflow',
        diagnostics: [],
        controller: {} as never,
        snapshot: {
          files: new Map([['workflows/cash.workflow.json', JSON.stringify(recipe)]]),
          project: { studio: { workflows: 'workflows', examples: 'examples' } }
        } as never
      }}
    >
      <WorkflowLibrary
        capture={() => ({ ...recipe, inputs: { change: { kind: 'literal', value: 500 } } })}
        open={open}
        onNew={onNew}
      />
    </ProjectContext>
  );
  await user.click(screen.getByRole('combobox', { name: 'Saved workflow' }));
  await user.click(await screen.findByRole('option', { name: 'Cash', exact: true }));
  await waitFor(() => expect(open).toHaveBeenCalledOnce());
  await user.click(screen.getByRole('button', { name: 'New workflow', exact: true }));
  expect(onNew).toHaveBeenCalledOnce();
  expect(screen.getByRole('combobox', { name: 'Saved workflow' })).toHaveTextContent('Unsaved workflow');
  await user.click(screen.getByRole('combobox', { name: 'Saved workflow' }));
  await user.click(await screen.findByRole('option', { name: 'Cash', exact: true }));
  await waitFor(() =>
    expect(open).toHaveBeenLastCalledWith(
      expect.objectContaining({ inputs: { change: { kind: 'literal', value: 500 } } })
    )
  );
});
