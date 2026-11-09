// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEditorStore } from '@rune-langium/visual-editor';
import { createProjectSnapshot } from '@rune-langium/project-config';
import { afterEach, expect, it, vi } from 'vitest';
import { PrototypeWorkflow } from '../../../src/shell/panels/PrototypeWorkflow.js';
import { ProjectContext } from '../../../src/shell/providers/project-context.js';
import { PreviewSessionContext } from '../../../src/shell/providers/preview-session-context.js';
import { WorkspaceStateContext } from '../../../src/shell/providers/workspace-context.js';
import { captureProjectRuntimeInput } from '../../../src/services/project-runtime-input.js';
import type { PreviewSessionClient } from '../../../src/services/preview-session-client.js';
import type { WorkspaceFile } from '../../../src/services/workspace.js';

afterEach(() => {
  act(() => {
    useEditorStore.getState().loadDeferredExports([]);
    useEditorStore.getState().loadModels([]);
  });
});

it('keeps execution on the current project while its reference view is published', async () => {
  const source: WorkspaceFile = {
    name: 'run.rosetta',
    path: 'model/run.rosetta',
    content: 'namespace test\nfunc Run:\n  output: result int (1..1)\n  set result: 42\n',
    dirty: false
  };
  const reference: WorkspaceFile = {
    name: 'cdm.rosetta',
    path: 'cdm/cdm.rosetta',
    content: 'namespace cdm',
    bundleId: 'cdm',
    refOnly: true,
    readOnly: true,
    dirty: false
  };
  const snapshot = await createProjectSnapshot('workflow', new Map([[source.path, source.content]]), () => []);
  const input = await captureProjectRuntimeInput(
    snapshot,
    [source],
    [{ uri: reference.path, content: reference.content }]
  );
  const pending = Promise.withResolvers<number>();
  const execute = vi.fn<PreviewSessionClient['execute']>().mockReturnValue(pending.promise);
  const schema = vi.fn<PreviewSessionClient['schema']>().mockResolvedValue({
    schemaVersion: 1,
    targetId: 'test.Run#RosettaFunction',
    title: 'Run',
    status: 'ready',
    kind: 'function',
    fields: [],
    result: { path: 'result', label: 'Result', kind: 'number', required: true }
  });
  const factory = () => ({
    execute,
    schema,
    validate: vi.fn().mockResolvedValue([]),
    project: vi.fn(),
    dispose: vi.fn()
  });
  useEditorStore
    .getState()
    .loadDeferredExports([
      { filePath: source.path, namespace: 'test', exports: [{ name: 'Run', type: 'RosettaFunction' }] }
    ]);
  useEditorStore.getState().loadModels([]);

  function view(files: readonly WorkspaceFile[]) {
    return (
      <ProjectContext
        value={{
          status: 'ready',
          diagnostics: [],
          snapshot,
          runtime: { managed: true, status: 'captured', diagnostics: [], input }
        }}
      >
        <WorkspaceStateContext
          value={{
            workspaceId: snapshot.workspaceId,
            files,
            fileCount: 1,
            models: [],
            parsedModels: [],
            deferredExports: [],
            parseErrors: new Map()
          }}
        >
          <PreviewSessionContext value={factory}>
            <PrototypeWorkflow />
          </PreviewSessionContext>
        </WorkspaceStateContext>
      </ProjectContext>
    );
  }
  const { rerender } = render(view([source]));
  fireEvent.click(screen.getByRole('button', { name: 'Choose a function' }));
  const option = await screen.findByRole('option', { name: /^Run/ });
  await act(async () => {
    fireEvent.click(option);
  });
  const button = await screen.findByRole('button', { name: 'Execute', exact: true });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  expect(execute).toHaveBeenCalledOnce();

  rerender(view([source, reference]));
  expect(execute.mock.calls[0]![2].aborted).toBe(false);
  await act(async () => pending.resolve(42));
  await waitFor(() => expect(screen.getByRole('region', { name: 'result output' })).toHaveTextContent('42'));
  expect(schema).toHaveBeenCalledOnce();

  await act(async () => {
    rerender(view([{ ...source, content: source.content.replace('42', '43'), dirty: true }, reference]));
  });
  await waitFor(() => expect(schema).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('region', { name: 'result output' })).not.toHaveTextContent('42');
});
