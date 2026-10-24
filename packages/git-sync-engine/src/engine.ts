// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { createGitOps, type GitOps } from './git-ops.js';
import { pushForceWithLease } from './force-with-lease.js';
import type { ConflictPolicy, GitSyncEngine, GitSyncEngineOptions, SyncStatus } from './types.js';

const blockPolicy: ConflictPolicy = { onConflict: async () => ({ action: 'block' }) };

interface InternalOptions extends GitSyncEngineOptions {
  __opsForTest?: GitOps; // test seam; never set in production
}

export function createGitSyncEngine(options: GitSyncEngineOptions): GitSyncEngine {
  const opts = options as InternalOptions;
  const ops: GitOps =
    opts.__opsForTest ??
    createGitOps({
      fs: opts.fs,
      http: opts.http,
      dir: opts.dir,
      gitdir: opts.gitdir,
      corsProxy: opts.corsProxy,
      onAuth: opts.onAuth
    });
  const policy = opts.conflictPolicy ?? blockPolicy;
  const debounceMs = opts.debounceMs ?? 2500;
  const setT = opts.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
  const clearT = opts.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const isOnline = opts.isOnline ?? (() => true);
  const genMessage =
    opts.generateMessage ??
    ((changed: string[]) => (changed.length === 1 ? `Update ${changed[0]}` : `Update ${changed.length} files`));

  let state: SyncStatus = { phase: 'idle', ahead: 0, behind: 0, lastSyncedSha: null };
  const subs = new Set<(s: SyncStatus) => void>();
  let timer: unknown = null;
  let running: Promise<SyncStatus> | null = null;
  let pendingSync = false;
  let dirtyGeneration = 0;

  function emit(next: Partial<SyncStatus>) {
    state = { ...state, ...next };
    for (const cb of subs) cb(state);
  }

  async function runSync(): Promise<SyncStatus> {
    if (!isOnline()) {
      emit({ phase: 'offline' });
      return state;
    }
    try {
      const capturedDirty = dirtyGeneration;
      emit({ phase: 'committing', lastError: undefined });
      const changed = await ops.stageAll();
      if (changed.length > 0) await ops.commit(genMessage(changed), opts.author);

      emit({ phase: 'fetching', dirty: capturedDirty !== dirtyGeneration });
      await ops.fetch(opts.ref, opts.remoteUrl);
      const { ahead, behind } = await ops.computeAheadBehind(opts.ref);
      emit({ ahead, behind });

      if (behind > 0) {
        if (ahead === 0) {
          emit({ phase: 'merging' });
          await ops.fastForward(opts.ref);
        } else {
          emit({ phase: 'merging' });
          const m = await ops.merge(opts.ref, opts.author);
          if (!m.ok) return await handleConflict(m.conflictPaths ?? []);
        }
      }

      return await doPush();
    } catch (err) {
      if (isAuthError(err)) {
        emit({ phase: 'blocked', conflictPaths: undefined, lastError: { code: 'auth', message: msg(err) } });
        return state;
      }
      if (isNoPushAccess(err)) {
        emit({ phase: 'blocked', conflictPaths: undefined, lastError: { code: 'no_push_access', message: msg(err) } });
        return state;
      }
      emit({ phase: 'offline', lastError: { code: 'network', message: msg(err) } });
      return state;
    }
  }

  async function doPush(): Promise<SyncStatus> {
    emit({ phase: 'pushing' });
    try {
      await ops.push(opts.ref, opts.remoteUrl);
      const sha = await ops.currentSha(opts.ref);
      emit({ phase: 'idle', ahead: 0, behind: 0, conflictPaths: undefined, lastSyncedSha: sha });
      return state;
    } catch (err) {
      if (isNonFastForward(err)) {
        emit({ phase: 'fetching' });
        await ops.fetch(opts.ref, opts.remoteUrl);
        const { ahead, behind } = await ops.computeAheadBehind(opts.ref);
        if (behind > 0 && ahead > 0) {
          emit({ phase: 'merging' });
          const m = await ops.merge(opts.ref, opts.author);
          if (!m.ok) return await handleConflict(m.conflictPaths ?? []);
        } else if (behind > 0) {
          await ops.fastForward(opts.ref);
        }
        emit({ phase: 'pushing' });
        try {
          await ops.push(opts.ref, opts.remoteUrl);
        } catch (err2) {
          // Remote moved again between our fetch and this retry push.
          // Classify as blocked/non_fast_forward rather than falling through
          // to the outer catch which would mis-report this as offline/network.
          if (isNonFastForward(err2)) {
            emit({
              phase: 'blocked',
              conflictPaths: undefined,
              lastError: { code: 'non_fast_forward', message: msg(err2) }
            });
            return state;
          }
          throw err2; // other errors propagate to runSync's classifier
        }
        const sha = await ops.currentSha(opts.ref);
        emit({ phase: 'idle', ahead: 0, behind: 0, conflictPaths: undefined, lastSyncedSha: sha });
        return state;
      }
      if (isAuthError(err)) {
        emit({ phase: 'blocked', conflictPaths: undefined, lastError: { code: 'auth', message: msg(err) } });
        return state;
      }
      if (isNoPushAccess(err)) {
        emit({ phase: 'blocked', conflictPaths: undefined, lastError: { code: 'no_push_access', message: msg(err) } });
        return state;
      }
      emit({ phase: 'offline', lastError: { code: 'network', message: msg(err) } });
      return state;
    }
  }

  async function handleConflict(paths: string[]): Promise<SyncStatus> {
    const localSha = (await ops.currentSha(opts.ref)) ?? '';
    const remoteSha = (await ops.remoteSha(opts.ref)) ?? '';
    emit({ phase: 'blocked', conflictPaths: paths });
    const res = await policy.onConflict({
      conflictPaths: paths,
      localSha,
      remoteSha,
      fs: opts.fs,
      dir: opts.dir,
      gitdir: opts.gitdir
    });
    switch (res.action) {
      case 'block':
        emit({ phase: 'blocked', conflictPaths: paths });
        return state;
      case 'keepMine': {
        await ops.restoreLocal(opts.ref); // discard conflict markers, restore local HEAD
        const lease = await pushForceWithLease(ops, opts.ref, opts.remoteUrl, remoteSha);
        if (!lease.ok) {
          // Clear stale conflictPaths so the badge shows the error message
          // rather than the (no longer actionable) resolve buttons.
          emit({
            phase: 'blocked',
            conflictPaths: undefined,
            lastError: { code: 'non_fast_forward', message: 'remote moved' }
          });
          return state;
        }
        const sha = await ops.currentSha(opts.ref);
        emit({ phase: 'idle', ahead: 0, behind: 0, conflictPaths: undefined, lastSyncedSha: sha });
        return state;
      }
      case 'takeRemote': {
        await ops.resetTo(opts.ref);
        const sha = await ops.currentSha(opts.ref);
        emit({ phase: 'idle', ahead: 0, behind: 0, conflictPaths: undefined, lastSyncedSha: sha });
        return state;
      }
      case 'merged': {
        // Contract: the ConflictPolicy must write a resolved working tree before
        // returning `merged`; the engine then stages + commits + pushes it.
        const changed = await ops.stageAll();
        if (changed.length > 0) await ops.commit(genMessage(changed), opts.author);
        emit({ conflictPaths: undefined });
        return await doPush();
      }
    }
  }

  function scheduleSync() {
    if (timer) clearT(timer);
    timer = setT(() => {
      void syncNow();
    }, debounceMs);
  }

  function syncNow(): Promise<SyncStatus> {
    if (timer) {
      clearT(timer);
      timer = null;
    }
    if (running) {
      pendingSync = true;
      return running;
    }
    running = runSync().finally(() => {
      running = null;
      if (pendingSync) {
        pendingSync = false;
        void syncNow();
      }
    });
    return running;
  }

  return {
    notifyDirty() {
      dirtyGeneration++;
      emit({ dirty: true });
      if (opts.autoSync !== false) scheduleSync();
    },
    syncNow,
    getState() {
      return state;
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    unsubscribe(cb) {
      subs.delete(cb);
    },
    dispose() {
      if (timer) clearT(timer);
      subs.clear();
    }
  };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function codeOf(e: unknown): string {
  return (e as { code?: string; name?: string })?.code ?? (e as Error)?.name ?? '';
}
// These classifiers match isomorphic-git error shapes (`code` / `name`),
// confirmed against ^1.37. If that internal shape changes, update them here.
function isNonFastForward(e: unknown): boolean {
  return codeOf(e) === 'PushRejectedError' || /non-fast-forward|fetch first/i.test(msg(e));
}
function isAuthError(e: unknown): boolean {
  return codeOf(e) === 'HttpError' && /401/.test(msg(e));
}
function isNoPushAccess(e: unknown): boolean {
  return codeOf(e) === 'HttpError' && /403/.test(msg(e));
}
