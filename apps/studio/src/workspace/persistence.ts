// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Workspace persistence over IndexedDB. Feature 012-studio-workspace-ux,
 * T015. Schema: see specs/012-studio-workspace-ux/data-model.md §1.
 *
 * The full WorkspaceRecord shape is defined in the spec; this module
 * declares the typed surface and the four object stores
 * (`workspaces`, `recents`, `settings`, `handles`).
 *
 * Storage budget: each record is small (≪ 1MB). Heavy file content lives
 * in OPFS; IndexedDB only holds metadata.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DockviewPayload } from '../shell/layout-types.js';
import { withInstrumentation, Capture } from '../services/instrumentation/core.js';

export type WorkspaceKind = 'browser-only' | 'folder-backed' | 'git-backed';

/**
 * Persisted layout shape. The `dockview` payload is a tagged union
 * discriminated by `shape`:
 *   - `factory`: emitted by `layout-factory.ts`, fixed-arity columns
 *   - `native`:  round-tripped `api.toJSON()`; opaque to this module
 *
 * Older records (pre-tagged-union) had a bare `unknown` here; the
 * `layout-migrations` sanitiser upgrades them to factory shape on
 * read, so consumers only ever see one of the two tagged variants
 * (or `null` for fresh workspaces).
 */
export interface PanelLayoutRecord {
  /** Bumped on any breaking change to the dockview JSON shape. */
  version: number;
  /** Studio version that wrote this layout (display only). */
  writtenBy: string;
  dockview: DockviewPayload | null;
}

export interface TabRecord {
  path: string;
  order: number;
  dirty: boolean;
}

export interface CuratedModelBinding {
  modelId: string;
  loadedVersion: string;
  loadedAt: string;
  updateAvailable: boolean;
}

export interface GitBackingRecord {
  repoUrl: string;
  branch: string;
  user: string;
  tokenPath: string;
  syncState: 'clean' | 'ahead' | 'behind' | 'diverged' | 'conflict';
  lastSyncedSha: string | null;
}

interface BaseWorkspaceFields {
  /** Origin only; a starter is not a writable Git remote. */
  starterProvenance?: { repository: string; commit: string };
  id: string;
  name: string;
  createdAt: string;
  lastOpenedAt: string;
  layout: PanelLayoutRecord;
  tabs: TabRecord[];
  activeTabPath: string | null;
  curatedModels: CuratedModelBinding[];
  schemaVersion: number;
  /**
   * Per-workspace Structure View state. Optional so pre-`DB_VERSION=2`
   * records remain valid without a data migration — readers default to
   * an empty expansion map.
   */
  structureView?: { expansionMap: Record<string, boolean> };
}

/**
 * Discriminated union on `kind`. Folder-backed and git-backed records
 * carry their backing-specific fields; browser-only carries neither.
 * This makes it impossible to construct a `kind: 'git-backed'` record
 * without `gitBacking`, etc.
 */
export type WorkspaceRecord =
  | (BaseWorkspaceFields & { kind: 'browser-only' })
  | (BaseWorkspaceFields & { kind: 'folder-backed'; folderHandle: string })
  | (BaseWorkspaceFields & { kind: 'git-backed'; gitBacking: GitBackingRecord });

export interface RecentWorkspaceRecord {
  id: string;
  name: string;
  kind: WorkspaceKind;
  lastOpenedAt: string;
}

export interface FolderHandleRecord {
  id: string;
  handle: FileSystemDirectoryHandle;
  lastPermission: 'granted' | 'prompt' | 'denied';
}

export type WorkbenchSettingKey = `workbench:${string}:v1`;
export type SettingKey =
  | 'theme'
  | 'telemetry-enabled'
  | 'reduced-motion'
  | 'editor.tab-size'
  | 'design-system-version'
  | WorkbenchSettingKey;

interface RuneStudioDB extends DBSchema {
  workspaces: { key: string; value: WorkspaceRecord };
  recents: {
    key: string;
    value: RecentWorkspaceRecord;
    indexes: { 'by-lastOpenedAt': string };
  };
  settings: { key: string; value: { key: SettingKey; value: unknown } };
  handles: { key: string; value: FolderHandleRecord };
}

const DB_NAME = 'rune-studio';
/**
 * Bumped from 1 → 2 when the optional `structureView` slot was added to
 * `WorkspaceRecord` (spec 020). The field is optional, so the upgrade is
 * a no-op for the object-store schema; the bump exists only to invalidate
 * older idb caches that asserted on the schema version.
 */
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<RuneStudioDB>> | undefined;
let closeInFlight: Promise<void> | undefined;

function getDb(): Promise<IDBPDatabase<RuneStudioDB>> {
  if (closeInFlight) {
    // Wait for any pending close before opening a new connection — otherwise
    // a test that didn't await `_resetForTests` would race two open() calls.
    return closeInFlight.then(() => getDb());
  }
  if (!dbPromise) {
    dbPromise = openDB<RuneStudioDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('workspaces')) {
          db.createObjectStore('workspaces', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('recents')) {
          const recents = db.createObjectStore('recents', { keyPath: 'id' });
          recents.createIndex('by-lastOpenedAt', 'lastOpenedAt');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles', { keyPath: 'id' });
        }
      }
    });
  }
  return dbPromise;
}

export const _resetForTests = withInstrumentation(
  async function _resetForTests(): Promise<void> {
    const prev = dbPromise;
    dbPromise = undefined;
    if (prev) {
      closeInFlight = (async () => {
        try {
          const db = await prev;
          db.close();
        } catch {
          /* nothing to close */
        }
      })();
      try {
        await closeInFlight;
      } finally {
        closeInFlight = undefined;
      }
    }
  },
  { op: '_resetForTests' }
);

// ---------- workspaces ----------

export const saveWorkspace = withInstrumentation(
  async function saveWorkspace(ws: WorkspaceRecord): Promise<void> {
    const db = await getDb();
    const tx = db.transaction(['workspaces', 'recents'], 'readwrite');
    const wsStore = tx.objectStore('workspaces');
    // `structureView` is owned by `saveStructureViewState`; `saveWorkspace`
    // is for workspace metadata only. Callers reach this function via a
    // `load → mutate field → save` cycle that inevitably carries forward
    // the `structureView` they read, which may be stale relative to a
    // concurrent toggle. Unconditionally read the persisted value inside
    // this tx and write that back, ignoring the caller's input for this
    // field. (A conditional merge — "only when input is undefined" — left
    // the stale-snapshot case wide open because stale snapshots almost
    // always *do* carry a non-undefined, outdated structureView.)
    const existing = await wsStore.get(ws.id);
    const { structureView: _ignoredCaller, ...rest } = ws;
    const toWrite: WorkspaceRecord = existing?.structureView
      ? { ...rest, structureView: existing.structureView }
      : rest;
    await wsStore.put(toWrite);
    await tx.objectStore('recents').put({
      id: ws.id,
      name: ws.name,
      kind: ws.kind,
      lastOpenedAt: ws.lastOpenedAt
    });
    await tx.done;
    // `ws.name` (user-chosen) and `ws.gitBacking.repoUrl` (may name a private
    // repo) are never captured; id/kind/schemaVersion/tabCount are safe.
  },
  {
    op: 'saveWorkspace',
    capture: Capture.Input,
    sanitize: (value, which) => {
      if (which !== 'input') return undefined;
      const [ws] = value as [WorkspaceRecord];
      return { id: ws.id, kind: ws.kind, schemaVersion: ws.schemaVersion, tabCount: ws.tabs.length };
    }
  }
);

// Output carries `name`/`gitBacking.repoUrl` — never captured.
export const loadWorkspace = withInstrumentation(
  async function loadWorkspace(id: string): Promise<WorkspaceRecord | undefined> {
    const db = await getDb();
    return db.get('workspaces', id);
  },
  {
    op: 'loadWorkspace',
    capture: Capture.Input,
    sanitize: (value, which) => (which === 'input' ? { id: (value as [string])[0] } : undefined)
  }
);

export const deleteWorkspace = withInstrumentation(
  async function deleteWorkspace(id: string): Promise<void> {
    const db = await getDb();
    const tx = db.transaction(['workspaces', 'recents'], 'readwrite');
    await tx.objectStore('workspaces').delete(id);
    await tx.objectStore('recents').delete(id);
    await tx.done;
  },
  {
    op: 'deleteWorkspace',
    capture: Capture.Input,
    sanitize: (value, which) => (which === 'input' ? { id: (value as [string])[0] } : undefined)
  }
);

// Entries carry `name` (user-chosen) — never captured; only a count.
export const listRecents = withInstrumentation(
  async function listRecents(): Promise<RecentWorkspaceRecord[]> {
    const db = await getDb();
    const all = await db.getAllFromIndex('recents', 'by-lastOpenedAt');
    return all.reverse(); // index is ascending; we want most-recent first
  },
  {
    op: 'listRecents',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' && Array.isArray(value) ? { count: value.length } : undefined)
  }
);

// ---------- structure-view ----------

export const loadStructureViewState = withInstrumentation(
  async function loadStructureViewState(workspaceId: string): Promise<Record<string, boolean>> {
    const ws = await loadWorkspace(workspaceId);
    return ws?.structureView?.expansionMap ?? {};
    // Output's expansionMap is keyed by user model TYPE NAMES — never captured.
  },
  {
    op: 'loadStructureViewState',
    capture: Capture.Input,
    sanitize: (value, which) => (which === 'input' ? { workspaceId: (value as [string])[0] } : undefined)
  }
);

export const saveStructureViewState = withInstrumentation(
  async function saveStructureViewState(workspaceId: string, expansionMap: Record<string, boolean>): Promise<void> {
    const db = await getDb();
    const tx = db.transaction('workspaces', 'readwrite');
    const store = tx.objectStore('workspaces');
    const ws = await store.get(workspaceId);
    if (!ws) {
      await tx.done.catch(() => undefined);
      return;
    }
    await store.put({ ...ws, structureView: { expansionMap } });
    await tx.done;
    // `expansionMap` is keyed by user model TYPE NAMES — never captured.
  },
  {
    op: 'saveStructureViewState',
    capture: Capture.Input,
    sanitize: (value, which) => (which === 'input' ? { workspaceId: (value as [string, unknown])[0] } : undefined)
  }
);

// ---------- settings ----------

export const saveSetting = withInstrumentation(
  async function saveSetting(key: SettingKey, value: unknown): Promise<void> {
    const db = await getDb();
    await db.put('settings', { key, value });
    // Workbench keys can include workspace identifiers and values can include
    // model names, so neither input is safe to capture.
  },
  { op: 'saveSetting' }
);

export const loadSetting = withInstrumentation(
  async function loadSetting<T = unknown>(key: SettingKey): Promise<T | undefined> {
    const db = await getDb();
    const row = await db.get('settings', key);
    return row?.value as T | undefined;
  },
  { op: 'loadSetting' }
);

// ---------- handles ----------

export const saveFolderHandle = withInstrumentation(
  async function saveFolderHandle(rec: FolderHandleRecord): Promise<void> {
    const db = await getDb();
    await db.put('handles', rec);
    // `rec.handle` (a FileSystemDirectoryHandle) isn't capturable.
  },
  {
    op: 'saveFolderHandle',
    capture: Capture.Input,
    sanitize: (value, which) => {
      if (which !== 'input') return undefined;
      const [rec] = value as [FolderHandleRecord];
      return { id: rec.id, lastPermission: rec.lastPermission };
    }
  }
);

export const loadFolderHandle = withInstrumentation(
  async function loadFolderHandle(id: string): Promise<FolderHandleRecord | undefined> {
    const db = await getDb();
    return db.get('handles', id);
  },
  {
    op: 'loadFolderHandle',
    capture: Capture.Input | Capture.Output,
    sanitize: (value, which) =>
      which === 'input'
        ? { id: (value as [string])[0] }
        : { lastPermission: (value as FolderHandleRecord | undefined)?.lastPermission }
  }
);
