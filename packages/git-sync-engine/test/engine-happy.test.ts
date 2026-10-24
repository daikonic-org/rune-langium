// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect, vi } from 'vitest';
import { createGitSyncEngine } from '../src/engine.js';
import type { GitOps } from '../src/git-ops.js';

function happyOps(): GitOps {
  return {
    stageAll: vi.fn().mockResolvedValue(['a.rosetta']),
    commit: vi.fn().mockResolvedValue('localsha'),
    fetch: vi.fn().mockResolvedValue(undefined),
    computeAheadBehind: vi.fn().mockResolvedValue({ ahead: 1, behind: 0 }),
    fastForward: vi.fn().mockResolvedValue(undefined),
    merge: vi.fn(),
    push: vi.fn().mockResolvedValue(undefined),
    resetTo: vi.fn(),
    currentSha: vi.fn().mockResolvedValue('localsha'),
    remoteSha: vi.fn().mockResolvedValue('remotesha')
  } as unknown as GitOps;
}

const baseOpts = {
  fs: {} as never,
  http: {},
  dir: '/w/files',
  gitdir: '/w/.git',
  remoteUrl: 'https://x',
  ref: 'main',
  onAuth: () => ({ username: 'x', password: 't' }),
  author: { name: 'A', email: 'a@x' },
  debounceMs: 0
};

describe('GitSyncEngine happy path', () => {
  it('coalesces rapid notifyDirty into one commit, then pushes; ends idle', async () => {
    const ops = happyOps();
    const engine = createGitSyncEngine({ ...baseOpts, __opsForTest: ops } as never);
    engine.notifyDirty();
    engine.notifyDirty();
    engine.notifyDirty();
    await engine.syncNow();
    expect(ops.commit as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(ops.push as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    expect(engine.getState().phase).toBe('idle');
  });

  it('notifies subscribers of phase transitions', async () => {
    const ops = happyOps();
    const phases: string[] = [];
    const engine = createGitSyncEngine({ ...baseOpts, __opsForTest: ops } as never);
    engine.subscribe((s) => phases.push(s.phase));
    await engine.syncNow();
    expect(phases).toContain('committing');
    expect(phases).toContain('pushing');
    expect(phases[phases.length - 1]).toBe('idle');
  });
});

it('keeps reviewed working-copy changes local until explicit sync in manual mode', async () => {
  const ops = happyOps();
  const schedule = vi.fn();
  const engine = createGitSyncEngine({
    ...baseOpts,
    __opsForTest: ops,
    autoSync: false,
    setTimeoutFn: schedule
  } as never);
  engine.notifyDirty();
  expect(schedule).not.toHaveBeenCalled();
  expect(ops.stageAll).not.toHaveBeenCalled();
  expect(ops.commit).not.toHaveBeenCalled();
  expect(ops.push).not.toHaveBeenCalled();
  expect(engine.getState()).toMatchObject({ dirty: true, phase: 'idle' });
  await engine.syncNow();
  expect(ops.commit).toHaveBeenCalledOnce();
  expect(ops.push).toHaveBeenCalledOnce();
  expect(engine.getState().dirty).toBe(false);
});

it('does not lose new working-copy changes that arrive during a manual sync', async () => {
  const ops = happyOps();
  let finish!: () => void;
  ops.push = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const engine = createGitSyncEngine({ ...baseOpts, __opsForTest: ops, autoSync: false } as never);
  const pending = engine.syncNow();
  while (!finish) await Promise.resolve();
  engine.notifyDirty();
  finish();
  await pending;
  expect(engine.getState().dirty).toBe(true);
  expect(ops.commit).toHaveBeenCalledOnce();
});
