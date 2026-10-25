// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { act, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PreviewSessionContext } from '../../src/shell/providers/preview-session-context.js';
import { useWorkflowValidation } from '../../src/services/workflow-validation.js';
import { ProjectContext } from '../../src/shell/providers/project-context.js';
import { createProjectSnapshot } from '@rune-langium/project-config';

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
