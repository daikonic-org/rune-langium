// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { act, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PreviewSessionContext } from '../../src/shell/providers/preview-session-context.js';
import { useWorkflowValidation } from '../../src/services/workflow-validation.js';

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
