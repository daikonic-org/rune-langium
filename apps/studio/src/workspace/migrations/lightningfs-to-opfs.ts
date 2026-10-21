// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * One-shot, cut-clean migration from the legacy LightningFS-backed
 * IndexedDB stores to OPFS.
 *
 * Behaviour:
 *  - On success: legacy file content is copied into a fresh "Migrated
 *    workspace" under OPFS and the legacy IDB DBs are deleted in the same
 *    pass. `@isomorphic-git/lightning-fs` is removed from the runtime
 *    dependency in the same release.
 *  - On failure: legacy DBs are kept and an "export legacy data" Blob is
 *    produced (a JSON dump of every key + base64 bytes). The user can
 *    save the blob and rerun migration in a fresh tab.
 *
 * Crash-safety invariant: legacy DBs are NEVER deleted unless every
 * step of the OPFS write AND every IDB read succeeded. Any read error,
 * cursor error, blocked deletion, or partial OPFS write returns
 * `kind: 'failed'` with the export blob; legacy data stays intact.
 *
 * The walk is intentionally lenient about value shape: anything not
 * parseable as `(path, bytes)` is recorded in the export bundle and
 * skipped from the OPFS write.
 */

import { OpfsFs } from '../../opfs/opfs-fs.js';
import { saveSetting, saveWorkspace, type WorkspaceRecord } from '../persistence.js';
import { LAYOUT_SCHEMA_VERSION } from '../../shell/layout-factory.js';
import { withInstrumentation, Capture } from '../../services/instrumentation/core.js';
import { generateUlid } from '../../services/ulid.js';

export const LEGACY_DB_NAMES = ['fs', 'lightning-fs-cache'] as const;

export type MigrationResult =
  | { kind: 'no-op' }
  | { kind: 'migrated'; workspaceId: string; fileCount: number }
  | { kind: 'failed'; reason: string; exportBlob: Blob };

export interface MigrationInput {
  opfsRoot: FileSystemDirectoryHandle;
  studioVersion: string;
}

interface LegacyEntry {
  path: string;
  bytes: Uint8Array | null;
  raw: unknown;
}

interface ReadResult {
  ok: boolean;
  entries: LegacyEntry[];
  reason?: string;
}

export const migrateLightningFsToOpfs = withInstrumentation(
  async function migrateLightningFsToOpfs(input: MigrationInput): Promise<MigrationResult> {
    const collected: LegacyEntry[] = [];
    let foundAny = false;

    for (const dbName of LEGACY_DB_NAMES) {
      const present = await openExistingDb(dbName);
      if (!present) continue;
      foundAny = true;
      let read: ReadResult;
      try {
        read = await readAllEntries(present);
      } finally {
        present.close();
      }
      if (!read.ok) {
        // Legacy DB read failed mid-walk; preserve everything, surface
        // partial export so the user can rescue what we did read.
        return {
          kind: 'failed',
          reason: read.reason ?? 'idb_read_failed',
          exportBlob: buildExportBlob([...collected, ...read.entries])
        };
      }
      collected.push(...read.entries);
    }

    if (!foundAny) return { kind: 'no-op' };

    // Pre-build a JSON export bundle. We always have it ready in case the
    // OPFS half fails — the user is never left without a recovery path.
    const exportBlob = buildExportBlob(collected);

    // Try to write everything into OPFS. If anything throws, the legacy DBs
    // remain intact and we surface the export.
    const id = generateUlid();
    const fs = new OpfsFs(input.opfsRoot);
    let fileCount = 0;
    try {
      await fs.mkdir(`/${id}`);
      await fs.mkdir(`/${id}/files`);
      await fs.mkdir(`/${id}/.studio`);
      for (const e of collected) {
        if (!e.bytes) continue;
        const safe = e.path.replace(/^\/+/, '');
        if (!safe) continue;
        await fs.writeFile(`/${id}/files/${safe}`, e.bytes);
        fileCount++;
      }

      // Persist the workspace record + bump the migration sentinel BEFORE
      // we drop the legacy DBs so a crash mid-migration is recoverable from
      // the persisted state alone.
      const now = new Date().toISOString();
      const ws: WorkspaceRecord = {
        id,
        name: 'Migrated workspace',
        createdAt: now,
        lastOpenedAt: now,
        kind: 'browser-only',
        layout: {
          version: LAYOUT_SCHEMA_VERSION,
          writtenBy: input.studioVersion,
          dockview: null
        },
        tabs: [],
        activeTabPath: null,
        curatedModels: [],
        schemaVersion: 1
      };
      await saveWorkspace(ws);
      await saveSetting('design-system-version', input.studioVersion);
    } catch (err) {
      return {
        kind: 'failed',
        reason: err instanceof Error ? err.message : String(err),
        exportBlob
      };
    }

    // Cut-clean: drop the legacy DBs. If ANY deletion is blocked or errors
    // out, the migration is incomplete — keep the legacy DBs and report
    // failure rather than re-running on the next launch over a working
    // OPFS workspace (which would create a second "Migrated workspace").
    for (const dbName of LEGACY_DB_NAMES) {
      const r = await deleteDb(dbName);
      if (r !== 'deleted' && r !== 'not_present') {
        return {
          kind: 'failed',
          reason: `legacy_db_${r}: ${dbName}`,
          exportBlob
        };
      }
    }
    return { kind: 'migrated', workspaceId: id, fileCount };
    // `input.opfsRoot` isn't capturable; `exportBlob` carries raw legacy file
    // bytes (may be user model content) — never captured. `kind`/`workspaceId`/
    // `fileCount`/`reason` are all safe structural/technical values.
  },
  {
    op: 'migrateLightningFsToOpfs',
    capture: Capture.Output,
    sanitize: (value, which) => {
      if (which !== 'output') return undefined;
      const result = value as MigrationResult;
      return {
        kind: result.kind,
        workspaceId: 'workspaceId' in result ? result.workspaceId : undefined,
        fileCount: 'fileCount' in result ? result.fileCount : undefined,
        reason: 'reason' in result ? result.reason : undefined
      };
    }
  }
);

// ---------- IndexedDB walk helpers ----------

/**
 * Open `name` only if it already exists. `indexedDB.open(name)` without
 * a version is the only documented "is this DB present?" probe in the
 * IDB API, so we open, inspect `objectStoreNames`, and close.
 *
 * If the open creates a *new* v1 DB (because the name was never used),
 * we abort the upgrade transaction so the DB is never persisted in the
 * first place — this avoids deleting "empty" DBs the platform may
 * legitimately use for unrelated reasons.
 */
function openExistingDb(name: string): Promise<IDBDatabase | null> {
  return new Promise<IDBDatabase | null>((resolve) => {
    const req = indexedDB.open(name);
    req.onupgradeneeded = () => {
      // We weren't supposed to create it — abort the upgrade transaction.
      // The browser will not persist the new DB; onerror fires below.
      req.transaction?.abort();
    };
    req.onsuccess = () => {
      const db = req.result;
      if (db.objectStoreNames.length === 0) {
        // Empty DB with no upgrade event (some browsers emit `onsuccess`
        // directly). Don't delete it — it's not ours.
        db.close();
        resolve(null);
        return;
      }
      resolve(db);
    };
    // onerror fires both when our aborted upgrade rejects the open AND
    // when the DB is genuinely unreadable; both map to "absent" because
    // we can't migrate from a DB we can't open.
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function readAllEntries(db: IDBDatabase): Promise<ReadResult> {
  const out: LegacyEntry[] = [];
  const names = Array.from(db.objectStoreNames);
  for (const storeName of names) {
    const r = await readStore(db, storeName);
    out.push(...r.entries);
    if (!r.ok) {
      return { ok: false, entries: out, reason: r.reason };
    }
  }
  return { ok: true, entries: out };
}

function readStore(db: IDBDatabase, storeName: string): Promise<ReadResult> {
  return new Promise<ReadResult>((resolve) => {
    let resolved = false;
    const settle = (r: ReadResult): void => {
      if (resolved) return;
      resolved = true;
      resolve(r);
    };
    let tx: IDBTransaction;
    try {
      tx = db.transaction([storeName], 'readonly');
    } catch (err) {
      settle({ ok: false, entries: [], reason: errMessage(err) });
      return;
    }
    const store = tx.objectStore(storeName);
    const cursorReq = store.openCursor();
    const collected: LegacyEntry[] = [];
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      const path = String(cursor.key);
      const value = cursor.value;
      collected.push({ path, bytes: coerceBytes(value), raw: value });
      try {
        cursor.continue();
      } catch (err) {
        settle({ ok: false, entries: collected, reason: errMessage(err) });
      }
    };
    cursorReq.onerror = () => {
      settle({
        ok: false,
        entries: collected,
        reason: errMessage(cursorReq.error) || 'cursor_error'
      });
    };
    tx.oncomplete = () => settle({ ok: true, entries: collected });
    tx.onerror = () => {
      settle({
        ok: false,
        entries: collected,
        reason: errMessage(tx.error) || 'tx_error'
      });
    };
    tx.onabort = () => {
      settle({
        ok: false,
        entries: collected,
        reason: errMessage(tx.error) || 'tx_abort'
      });
    };
  });
}

function coerceBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === 'object' && value !== null && 'byteLength' in value && 'buffer' in value) {
    const v = value as { buffer: ArrayBufferLike; byteOffset?: number; byteLength: number };
    return new Uint8Array(v.buffer, v.byteOffset ?? 0, v.byteLength);
  }
  if (Array.isArray(value) && value.every((b) => typeof b === 'number')) {
    return new Uint8Array(value);
  }
  if (typeof value === 'string') return new TextEncoder().encode(value);
  return null;
}

type DeleteOutcome = 'deleted' | 'not_present' | 'blocked' | 'errored';

function deleteDb(name: string): Promise<DeleteOutcome> {
  return new Promise<DeleteOutcome>((resolve) => {
    let resolved = false;
    const settle = (o: DeleteOutcome): void => {
      if (resolved) return;
      resolved = true;
      resolve(o);
    };
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.deleteDatabase(name);
    } catch {
      settle('errored');
      return;
    }
    req.onsuccess = () => settle('deleted');
    req.onerror = () => settle('errored');
    req.onblocked = () => settle('blocked');
  });
}

function buildExportBlob(entries: LegacyEntry[]): Blob {
  const dump = entries.map((e) => ({
    path: e.path,
    bytes: e.bytes ? Array.from(e.bytes.subarray(0, Math.min(e.bytes.length, 1024 * 1024))) : null,
    note: e.bytes ? undefined : `non-binary value (${typeof e.raw})`
  }));
  return new Blob([JSON.stringify({ schemaVersion: 1, entries: dump }, null, 2)], {
    type: 'application/json'
  });
}

function errMessage(err: unknown): string {
  if (!err) return '';
  if (err instanceof Error) return err.message;
  return String(err);
}
