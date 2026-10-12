// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceAutosave } from '../../src/services/workspace-autosave.js';
import type { WorkspaceFile } from '../../src/services/workspace.js';

const files = (content: string): WorkspaceFile[] => [{ name: 'a.rosetta', path: 'a.rosetta', content, dirty: true }];
afterEach(() => vi.useRealTimers());

describe('workspace autosave', () => {
  it('rejects a failed transition flush and retries the retained snapshot without another edit', async () => {
    const error = new Error('quota');
    const save = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const autosave = createWorkspaceAutosave(save, vi.fn());
    autosave.schedule('a', files('unsaved draft'));
    await expect(autosave.flush()).rejects.toBe(error);
    await autosave.flush();
    expect(save.mock.calls).toEqual([
      ['a', files('unsaved draft')],
      ['a', files('unsaved draft')]
    ]);
  });

  it('retains failed background writes for a rejecting flush and a later retry', async () => {
    vi.useFakeTimers();
    const error = new Error('quota');
    const save = vi.fn().mockRejectedValue(error);
    const autosave = createWorkspaceAutosave(save, vi.fn());
    autosave.schedule('a', files('background draft'));
    await vi.advanceTimersByTimeAsync(500);
    await expect(autosave.flush()).rejects.toBe(error);
    save.mockResolvedValue(undefined);
    await autosave.flush();
    expect(save).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenLastCalledWith('a', files('background draft'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('flushes a newer edit that arrives while the transition write is in flight', async () => {
    const first = Promise.withResolvers<void>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const autosave = createWorkspaceAutosave(save, vi.fn());
    autosave.schedule('a', files('first'));
    const flushing = autosave.flush();
    await Promise.resolve();
    autosave.schedule('a', files('latest'));
    first.resolve();
    await flushing;
    expect(save.mock.calls).toEqual([
      ['a', files('first')],
      ['a', files('latest')]
    ]);
  });

  it('coalesces keystrokes into the newest snapshot and flushes on a workspace boundary', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createWorkspaceAutosave(save, vi.fn());
    for (let i = 0; i < 50; i++) {
      autosave.schedule('a', files(String(i)));
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(save).not.toHaveBeenCalled();
    await autosave.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith('a', files('49'));
    autosave.schedule('b', files('new workspace'));
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenLastCalledWith('b', files('new workspace'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds continuous typing latency and reports a failed save without breaking later writes', async () => {
    vi.useFakeTimers();
    const error = new Error('quota');
    const save = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const onError = vi.fn();
    const autosave = createWorkspaceAutosave(save, onError);
    for (let i = 0; i < 20; i++) {
      autosave.schedule('a', files(String(i)));
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(save).toHaveBeenCalledExactlyOnceWith('a', files('19'));
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    autosave.schedule('a', files('recovered'));
    await autosave.flush();
    expect(save).toHaveBeenLastCalledWith('a', files('recovered'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for an in-flight write on flush and preserves separate workspace identities', async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            resolve = r;
          })
      )
      .mockResolvedValue(undefined);
    const autosave = createWorkspaceAutosave(save, vi.fn());
    autosave.schedule('a', files('a'));
    await vi.advanceTimersByTimeAsync(500);
    autosave.schedule('b', files('b'));
    let done = false;
    const flushed = autosave.flush().then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    resolve();
    await flushed;
    expect(save.mock.calls).toEqual([
      ['a', files('a')],
      ['b', files('b')]
    ]);
  });
});
