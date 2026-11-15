// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { act, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PreviewSessionContext } from '../../src/shell/providers/preview-session-context.js';
import { useWorkflowValidation } from '../../src/services/workflow-validation.js';
import { ProjectContext } from '../../src/shell/providers/project-context.js';
import { createProjectSnapshot } from '@rune-langium/project-config';
import { captureProjectRuntimeInput } from '../../src/services/project-runtime-input.js';
import { useWorkflowSchema } from '../../src/services/workflow-schema.js';
import { WorkspaceStateContext } from '../../src/shell/providers/workspace-context.js';
import type { PreviewSessionClient } from '../../src/services/preview-session-client.js';

it('retains in-flight managed schema and validation while read-only models are published', async () => {
  const snapshot = await createProjectSnapshot('p', new Map([['resources/codes.json', '[]']]), () => []);
  const input = await captureProjectRuntimeInput(snapshot, [], []);
  const pendingValidation = Promise.withResolvers<Awaited<ReturnType<PreviewSessionClient['validate']>>>();
  const pendingSchema = Promise.withResolvers<Awaited<ReturnType<PreviewSessionClient['schema']>>>();
  const validate = vi.fn<PreviewSessionClient['validate']>().mockReturnValue(pendingValidation.promise);
  const schema = vi.fn<PreviewSessionClient['schema']>().mockReturnValue(pendingSchema.promise);
  const factory = () => ({ schema, validate, execute: vi.fn(), project: vi.fn(), dispose: vi.fn() });
  const data = {};
  function View() {
    const validation = useWorkflowValidation('test.Quote', data);
    const form = useWorkflowSchema('test.Quote');
    return (
      <p>
        {validation.state} · {form.schema?.title ?? 'loading schema'}
      </p>
    );
  }
  const view = () => (
    <ProjectContext
      value={{
        workspaceId: 'p',
        snapshot,
        status: 'ready',
        diagnostics: [],
        runtime: { managed: true, status: 'captured', input, diagnostics: [] }
      }}
    >
      <WorkspaceStateContext
        value={{
          workspaceId: 'p',
          files: [],
          models: [],
          parsedModels: [],
          deferredExports: [],
          parseErrors: new Map(),
          fileCount: 0
        }}
      >
        <PreviewSessionContext value={factory}>
          <View />
        </PreviewSessionContext>
      </WorkspaceStateContext>
    </ProjectContext>
  );
  const { rerender } = render(view());
  await waitFor(() => expect(validate).toHaveBeenCalledOnce());
  rerender(view());
  expect(validate.mock.calls[0]?.[2].aborted).toBe(false);
  expect(schema.mock.calls[0]?.[1].aborted).toBe(false);
  await act(async () => {
    pendingValidation.resolve([]);
    pendingSchema.resolve({ schemaVersion: 1, targetId: 'test.Quote', title: 'Quote', status: 'ready', fields: [] });
  });
  await screen.findByText('valid · Quote');
  expect(validate).toHaveBeenCalledOnce();
  expect(schema).toHaveBeenCalledOnce();
});

it('invalidates cached validation when only saved project resource bytes change', async () => {
  const first = await createProjectSnapshot('p', new Map([['resources/codes.json', '[]']]), () => []);
  const second = await createProjectSnapshot('p', new Map([['resources/codes.json', '["EUR"]']]), () => []);
  const validate = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('Resource unavailable'));
  const factory = () => ({ schema: vi.fn(), execute: vi.fn(), project: vi.fn(), dispose: vi.fn(), validate });
  const data = { currency: 'EUR' };
  function View() {
    return <p>{useWorkflowValidation('test.Quote', data).state}</p>;
  }
  function view(snapshot: typeof first) {
    return (
      <ProjectContext value={{ status: 'ready', diagnostics: [], snapshot }}>
        <PreviewSessionContext value={factory}>
          <View />
        </PreviewSessionContext>
      </ProjectContext>
    );
  }
  const { rerender } = render(view(first));
  await screen.findByText('valid');
  rerender(view(second));
  expect(screen.getByText('pending')).toBeVisible();
  await screen.findByText('unavailable');
  expect(validate).toHaveBeenCalledTimes(2);
});

it('never reports an older validation as valid for newer input values', async () => {
  const requests: Array<{ resolve(value: unknown[]): void; signal: AbortSignal }> = [];
  const dispose = vi.fn();
  const factory = () => ({
    schema: vi.fn(),
    execute: vi.fn(),
    project: vi.fn(),
    dispose,
    validate: (_target: string, _data: unknown, signal: AbortSignal) =>
      new Promise<never>((resolve) => requests.push({ resolve: resolve as never, signal }))
  });
  function View({ data }: { data: Record<string, unknown> }) {
    const validation = useWorkflowValidation('test.Money', data);
    return <p>{validation.state}</p>;
  }
  const first = { amount: 1 },
    second = { amount: '' };
  const { rerender, unmount } = render(
    <PreviewSessionContext value={factory}>
      <View data={first} />
    </PreviewSessionContext>
  );
  await waitFor(() => expect(requests).toHaveLength(1));
  rerender(
    <PreviewSessionContext value={factory}>
      <View data={second} />
    </PreviewSessionContext>
  );
  expect(requests[0]!.signal.aborted).toBe(true);
  await act(async () => requests[0]!.resolve([]));
  expect(screen.getByText('pending')).toBeVisible();
  await waitFor(() => expect(requests).toHaveLength(2));
  await act(async () => requests[1]!.resolve([{ path: 'amount', message: 'Required' }]));
  expect(screen.getByText('invalid')).toBeVisible();
  unmount();
  expect(requests[1]!.signal.aborted).toBe(true);
  expect(dispose).toHaveBeenCalledTimes(2);
});
