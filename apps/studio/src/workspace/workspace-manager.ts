// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * WorkspaceManager — high-level lifecycle API.
 *
 * Wires three primitives:
 *  - persistence: IndexedDB metadata
 *  - OpfsFs: file content
 *  - WorkspaceOwnership: cross-tab single-writer coordination
 *
 * Currently exposes create / open / close / delete / listRecents.
 * Folder-backed handle binding, git-backed init/push, tab restore, and
 * dirty-buffer recovery land in subsequent commits.
 */

import { OpfsFs } from '../opfs/opfs-fs.js';
import {
  saveWorkspace,
  loadWorkspace,
  loadFolderHandle,
  deleteWorkspace as removeWorkspace,
  listRecents as listRecentsFromDb,
  type WorkspaceRecord,
  type RecentWorkspaceRecord
} from './persistence.js';
import { WorkspaceOwnership } from '../services/multi-tab-broadcast.js';
import { cloneRepository } from '../services/git-backing.js';
import { storeWorkspaceToken } from '../services/github-auth.js';
import { LAYOUT_SCHEMA_VERSION } from '../shell/layout-factory.js';
import { useOutputStore, fmtLine } from '../store/output-store.js';
import { generateUlid } from '../services/ulid.js';
import { createProjectFileAdapter } from './project-file-adapter.js';
import type { ProjectFileAdapter } from '@rune-langium/project-config';

export interface WorkspaceManagerOptions {
  opfsRoot: FileSystemDirectoryHandle;
  tabId: string;
  studioVersion: string;
}

export interface OpenOptions {
  /** Override the broadcast claim timeout. Default 250ms. */
  claimTimeoutMs?: number;
}

export class WorkspaceManager {
  private readonly fs: OpfsFs;
  private readonly ownership: WorkspaceOwnership;
  /** ws-id → true iff this tab is read-only on it (peer owns). */
  private readonlyState = new Map<string, boolean>();

  constructor(private readonly opts: WorkspaceManagerOptions) {
    this.fs = new OpfsFs(opts.opfsRoot);
    this.ownership = new WorkspaceOwnership(opts.tabId);
  }

  /** Expose the shared OpfsFs so callers (e.g. git-sync wiring) can reuse it. */
  getFs(): OpfsFs {
    return this.fs;
  }

  /** Bind project IO to this workspace's working copy and current ownership. */
  async getProjectFileAdapter(id: string): Promise<ProjectFileAdapter> {
    const workspace = await loadWorkspace(id);
    if (!workspace) throw new Error('Workspace not found');
    const backing = await this.opts.opfsRoot.getDirectoryHandle(id);
    const privateRoot = await backing.getDirectoryHandle('.studio');
    let root: FileSystemDirectoryHandle;
    if (workspace.kind === 'folder-backed') {
      const folder = await loadFolderHandle(workspace.folderHandle);
      if (!folder) throw new Error('Workspace folder is unavailable');
      root = folder.handle;
    } else {
      root = await backing.getDirectoryHandle('files');
    }
    return createProjectFileAdapter({
      workspaceId: id,
      root,
      privateRoot,
      isWritable: () => this.isOwner(id) && !this.isReadOnly(id)
    });
  }

  /**
   * Clone a GitHub repository into a fresh git-backed workspace.
   * Closes T032d (014/Phase 6 deferred). Persists a `git-backed`
   * `WorkspaceRecord`, stashes the access token under the workspace's
   * private OPFS path (per `services/github-auth.ts`'s storage layout),
   * and claims ownership.
   *
   * The token is held only on the user's device — `services/github-auth.ts`
   * writes it to `<workspaceId>/.studio/token` in OPFS. Deleting the
   * workspace clears it. Per FR-018, no Worker ever sees or persists it.
   */
  async createGitBacked(input: {
    name: string;
    repoUrl: string;
    branch?: string;
    user: string;
    token: string;
    onProgress?: (evt: { phase: string; loaded?: number; total?: number }) => void;
  }): Promise<WorkspaceRecord> {
    const id = generateUlid();
    const branch = input.branch ?? 'main';
    const now = new Date().toISOString();

    // Reserve the OPFS dir tree before any write — clone() expects
    // <id>/ to exist; it manages /.git internally.
    await this.fs.mkdir('/' + id);
    await this.fs.mkdir('/' + id + '/files');
    await this.fs.mkdir('/' + id + '/.studio');

    // Persist the token first; if the clone fails partway, the user's
    // retry doesn't have to redo device-flow auth.
    await storeWorkspaceToken(this.fs, id, input.token);

    try {
      await cloneRepository(this.fs, id, {
        remoteUrl: input.repoUrl,
        ref: branch,
        token: input.token,
        user: input.user,
        onProgress: input.onProgress
      });
    } catch (err) {
      // Clean up on failure so the user doesn't see an orphan record.
      try {
        await this.opts.opfsRoot.removeEntry(id, { recursive: true });
      } catch {
        /* best-effort */
      }
      throw err;
    }

    const ws: WorkspaceRecord = {
      id,
      name: input.name,
      createdAt: now,
      lastOpenedAt: now,
      kind: 'git-backed',
      gitBacking: {
        repoUrl: input.repoUrl,
        branch,
        user: input.user,
        tokenPath: `/${id}/.studio/token`,
        syncState: 'clean',
        lastSyncedSha: null
      },
      layout: {
        version: LAYOUT_SCHEMA_VERSION,
        writtenBy: this.opts.studioVersion,
        dockview: null
      },
      tabs: [],
      activeTabPath: null,
      curatedModels: [],
      schemaVersion: 1
    };
    await saveWorkspace(ws);
    await this.ownership.claim(id);
    return ws;
  }

  /** Create a fresh browser-only workspace and return its record. */
  async create(name: string): Promise<WorkspaceRecord> {
    const id = generateUlid();
    const now = new Date().toISOString();
    const ws: WorkspaceRecord = {
      id,
      name,
      createdAt: now,
      lastOpenedAt: now,
      kind: 'browser-only',
      layout: {
        version: LAYOUT_SCHEMA_VERSION,
        writtenBy: this.opts.studioVersion,
        dockview: null
      },
      tabs: [],
      activeTabPath: null,
      curatedModels: [],
      schemaVersion: 1
    };
    // Reserve the OPFS dir up-front so writes never trip on a missing root.
    await this.fs.mkdir('/' + id);
    await this.fs.mkdir('/' + id + '/files');
    await this.fs.mkdir('/' + id + '/.studio');

    await saveWorkspace(ws);
    // We claim ownership on create; failure here is benign — it just means
    // a stale ghost claim from a closed tab denied us. We still write the
    // record so the user can retry from their tab.
    await this.ownership.claim(id);
    return ws;
  }

  /**
   * Open an existing workspace. Returns undefined if it doesn't exist.
   * Bumps `lastOpenedAt`. Falls into read-only mode if a peer tab owns it.
   */
  async open(id: string, options: OpenOptions = {}): Promise<WorkspaceRecord | undefined> {
    const ws = await loadWorkspace(id);
    if (!ws) return undefined;

    ws.lastOpenedAt = new Date().toISOString();
    await saveWorkspace(ws);

    await this.claimProjectAccess(id, options);
    return ws;
  }

  /** Coordinate project IO without rewriting App-owned workspace metadata. */
  async claimProjectAccess(id: string, options: OpenOptions = {}): Promise<boolean> {
    const claimed = await this.ownership.claim(id, { timeoutMs: options.claimTimeoutMs });
    this.readonlyState.set(id, !claimed);
    return claimed;
  }

  /** Close — flush + release ownership. */
  async close(id: string): Promise<void> {
    this.ownership.release(id);
    this.readonlyState.delete(id);
  }

  /** Delete metadata + OPFS tree. Irreversible. */
  async delete(id: string): Promise<void> {
    this.ownership.release(id);
    this.readonlyState.delete(id);
    await removeWorkspace(id);
    try {
      await this.opts.opfsRoot.removeEntry(id, { recursive: true });
    } catch (err) {
      // NotFoundError is expected when no OPFS dir exists for this id
      // (e.g., create() partially failed). Anything else (NotAllowedError,
      // InvalidStateError) means we have orphan data — surface it.
      if (err instanceof Error && err.name !== 'NotFoundError') {
        // eslint-disable-next-line no-console
        console.error(`[workspace-manager] delete: OPFS removeEntry(${id}) failed:`, err);
        useOutputStore.getState().addLine(fmtLine('workspace', `OPFS removeEntry(${id}) failed`, err.message), 'error');
      }
    }
  }

  async listRecents(): Promise<RecentWorkspaceRecord[]> {
    return listRecentsFromDb();
  }

  isOwner(id: string): boolean {
    return this.ownership.isOwner(id);
  }

  isReadOnly(id: string): boolean {
    return this.readonlyState.get(id) ?? false;
  }
}
