// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectContext } from '../../src/shell/providers/project-context.js';
import { WorkflowFunctionBuilder } from '../../src/components/WorkflowFunctionBuilder.js';
import { saveWorkflowFunction } from '../../src/workspace/workflow-repository.js';
import { useEditorStore } from '@rune-langium/visual-editor';
import {
  PreviewSessionContext,
  type PreviewSessionFactory
} from '../../src/shell/providers/preview-session-context.js';
import type { PreviewSessionClient } from '../../src/services/preview-session-client.js';

vi.mock('../../src/workspace/workflow-repository.js', () => ({ saveWorkflowFunction: vi.fn() }));

afterEach(() => {
  useEditorStore.getState().loadDeferredExports([]);
  useEditorStore.getState().loadModels([]);
});

function view(factory: PreviewSessionFactory | null = null) {
  const onClose = vi.fn(),
    onCreated = vi.fn();
  const rendered = render(
    <ProjectContext value={{ workspaceId: 'one', status: 'ready', diagnostics: [], controller: {} as never }}>
      <PreviewSessionContext value={factory}>
        <WorkflowFunctionBuilder onClose={onClose} onCreated={onCreated} />
      </PreviewSessionContext>
    </ProjectContext>
  );
  return { ...rendered, onClose, onCreated };
}

it('retains the complete draft after a failed save and retries the same source definition', async () => {
  vi.mocked(saveWorkflowFunction).mockRejectedValueOnce(new Error('Project file changed. Reload and retry.'));
  const host = view(),
    user = userEvent.setup();
  await user.type(screen.getByLabelText('Function name', { exact: true }), 'Calculate');
  await user.clear(screen.getByLabelText('Step 1 expression', { exact: true }));
  await user.type(screen.getByLabelText('Step 1 expression', { exact: true }), 'input * 2');
  await user.click(screen.getByRole('button', { name: 'Create function', exact: true }));
  await screen.findByRole('alert');
  expect(host.onCreated).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Step 1 expression', { exact: true })).toHaveValue('input * 2');
  const workflow = { schemaVersion: 1 as const, id: 'new', name: 'Calculate', inputs: {}, outputs: {} };
  vi.mocked(saveWorkflowFunction).mockResolvedValueOnce({ workflow, snapshot: {} as never });
  await user.click(screen.getByRole('button', { name: 'Create function', exact: true }));
  await waitFor(() => expect(host.onCreated).toHaveBeenCalledWith(workflow));
  expect(vi.mocked(saveWorkflowFunction).mock.lastCall?.[1]).toMatchObject({
    path: 'model/workflows/local/compositions/Calculate.rosetta',
    definition: { name: 'Calculate', steps: [{ name: 'step1', expression: 'input * 2' }], result: 'step1' }
  });
});

it('uses a deferred function identity for its signature and recovers argument loading without losing the draft', async () => {
  useEditorStore
    .getState()
    .loadDeferredExports([
      { filePath: 'reference.rosetta', namespace: 'reference', exports: [{ name: 'Double', type: 'RosettaFunction' }] }
    ]);
  useEditorStore.getState().loadModels([]);
  const schema = vi.fn<PreviewSessionClient['schema']>().mockRejectedValueOnce(new Error('Signature unavailable.'));
  const client: PreviewSessionClient = {
    schema,
    execute: vi.fn(),
    validate: vi.fn(),
    project: vi.fn(),
    dispose: vi.fn()
  };
  view(() => client);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Function name', { exact: true }), 'Calculate');
  await user.click(screen.getByRole('combobox', { name: 'Step 1 kind', exact: true }));
  await user.click(await screen.findByRole('option', { name: 'Function call', exact: true }));
  await user.click(screen.getByRole('button', { name: 'Step 1 function', exact: true }));
  await user.click(await screen.findByRole('option', { name: 'Double — reference', exact: true }));
  await screen.findByRole('alert');
  expect(schema).toHaveBeenCalledWith('reference.Double#RosettaFunction', expect.any(AbortSignal));
  expect(screen.getByRole('button', { name: 'Create function', exact: true })).toBeDisabled();
  schema.mockResolvedValueOnce({
    schemaVersion: 1,
    targetId: 'reference.Double#RosettaFunction',
    kind: 'function',
    title: 'Double',
    status: 'ready',
    fields: [{ path: 'value', label: 'Value', kind: 'number', required: true }]
  });
  await user.click(screen.getByRole('button', { name: 'Retry arguments', exact: true }));
  await user.type(await screen.findByLabelText('Step 1 argument value', { exact: true }), 'input');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create function', exact: true })).toBeEnabled());
  expect(screen.getByRole('region', { name: 'Rune source preview', exact: true })).toHaveTextContent(
    'reference.Double(input)'
  );
  expect(screen.getByLabelText('Function name', { exact: true })).toHaveValue('Calculate');
  await user.click(screen.getByRole('button', { name: 'Step 1 function: Double — reference', exact: true }));
  await user.click(await screen.findByRole('option', { name: 'Double — reference', exact: true }));
  expect(screen.getByLabelText('Step 1 argument value', { exact: true })).toHaveValue('input');
  expect(screen.getByRole('button', { name: 'Create function', exact: true })).toBeEnabled();
  expect(schema).toHaveBeenCalledTimes(2);
});

it('does not publish an old completion after the builder is unmounted on a workspace change', async () => {
  let finish!: (value: Awaited<ReturnType<typeof saveWorkflowFunction>>) => void;
  vi.mocked(saveWorkflowFunction).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const host = view(),
    user = userEvent.setup();
  await user.type(screen.getByLabelText('Function name', { exact: true }), 'OldWorkspace');
  await user.click(screen.getByRole('button', { name: 'Create function', exact: true }));
  await waitFor(() => expect(finish).toBeDefined());
  host.unmount();
  finish({ workflow: { schemaVersion: 1, id: 'old', name: 'Old', inputs: {}, outputs: {} }, snapshot: {} as never });
  await Promise.resolve();
  expect(host.onCreated).not.toHaveBeenCalled();
});

it('blocks malformed expressions and incomplete call bindings without saving', async () => {
  vi.mocked(saveWorkflowFunction).mockClear();
  view();
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Function name', { exact: true }), 'Calculate');
  await user.clear(screen.getByLabelText('Step 1 expression', { exact: true }));
  await user.type(screen.getByLabelText('Step 1 expression', { exact: true }), 'if');
  expect(screen.getByRole('button', { name: 'Create function', exact: true })).toBeDisabled();
  await user.click(screen.getByRole('combobox', { name: 'Step 1 kind', exact: true }));
  await user.click(await screen.findByRole('option', { name: 'Function call', exact: true }));
  expect(screen.getByRole('button', { name: 'Create function', exact: true })).toBeDisabled();
  expect(saveWorkflowFunction).not.toHaveBeenCalled();
});
