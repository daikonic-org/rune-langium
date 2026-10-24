// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Minimal isomorphic-git fs/http shapes. We avoid importing isomorphic-git's
 * own types so consumers can pass any compatible implementation (OPFS-backed,
 * in-memory, lightning-fs).
 */
export interface IsoGitFs {
  promises: {
    readFile(path: string, opts?: unknown): Promise<Uint8Array | string>;
    writeFile(path: string, data: Uint8Array | string): Promise<void>;
    mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
    rmdir(path: string): Promise<void>;
    unlink(path: string): Promise<void>;
    readdir(path: string): Promise<string[]>;
    stat(path: string): Promise<unknown>;
    lstat(path: string): Promise<unknown>;
    readlink(path: string): Promise<string>;
    symlink(target: string, path: string): Promise<void>;
    chmod?(path: string, mode: number): Promise<void>;
  };
}

// isomorphic-git http client (e.g. `isomorphic-git/http/web`).
export type IsoGitHttp = unknown;

export type SyncPhase = 'idle' | 'committing' | 'fetching' | 'merging' | 'pushing' | 'blocked' | 'offline';

export type SyncErrorCode = 'network' | 'no_push_access' | 'auth' | 'non_fast_forward' | 'unknown';

export interface SyncStatus {
  phase: SyncPhase;
  ahead: number;
  behind: number;
  lastSyncedSha: string | null;
  /** Uncommitted working-copy changes; independent of ahead/behind commit counts. */
  dirty?: boolean;
  lastError?: { code: SyncErrorCode; message: string };
  conflictPaths?: string[];
}

export interface ConflictContext {
  conflictPaths: string[];
  localSha: string;
  remoteSha: string;
  fs: IsoGitFs;
  dir: string;
  gitdir: string;
}

export type ConflictResolution =
  | { action: 'block' }
  | { action: 'keepMine' }
  | { action: 'takeRemote' }
  | { action: 'merged' };

export interface ConflictPolicy {
  onConflict(ctx: ConflictContext): Promise<ConflictResolution>;
}

export interface GitSyncEngineOptions {
  fs: IsoGitFs;
  http: IsoGitHttp;
  dir: string;
  gitdir: string;
  remoteUrl: string;
  ref: string;
  corsProxy?: string;
  onAuth: () => { username: string; password: string } | Promise<{ username: string; password: string }>;
  author: { name: string; email: string };
  debounceMs?: number;
  /** Set false to keep Save local; only syncNow may then commit/push. */
  autoSync?: boolean;
  conflictPolicy?: ConflictPolicy;
  generateMessage?: (changed: string[]) => string;
  /** Injectable clock/timer for deterministic tests. Defaults to global. */
  setTimeoutFn?: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  /** Injectable online check. Defaults to `() => true` in non-browser. */
  isOnline?: () => boolean;
}

export interface GitSyncEngine {
  notifyDirty(): void;
  syncNow(): Promise<SyncStatus>;
  getState(): SyncStatus;
  subscribe(cb: (s: SyncStatus) => void): () => void;
  unsubscribe(cb: (s: SyncStatus) => void): void;
  dispose(): void;
}
