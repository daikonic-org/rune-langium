// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('../../src/workspace/workflow-repository.js', () => ({ saveWorkflow: vi.fn().mockResolvedValue(undefined) }));
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
  await waitFor(() => expect(capture).toHaveBeenCalledOnce());
  expect(capture.mock.calls[0]?.[0]).not.toBe('old');
});
