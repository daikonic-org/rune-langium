// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import {
  recoverProjectSave,
  ProjectSnapshotError,
  type ProjectFileAdapter,
  type ProjectChange
} from '@rune-langium/project-config';
import { createProjectController } from './project-controller.js';
import { OpfsFs } from '../opfs/opfs-fs.js';
import type { WorkspaceFile } from '../services/workspace.js';
import { notifySyncOnSave } from '../services/git-sync.js';
import { withInstrumentation, Capture } from '../services/instrumentation/core.js';

interface WorkspaceFilesDeps {
  getFolderProjectAdapter?: (workspaceId: string) => Promise<ProjectFileAdapter | undefined>;
  getOpfsRoot: () => Promise<FileSystemDirectoryHandle>;
}

let deps: WorkspaceFilesDeps = {
  async getOpfsRoot() {
    if (!navigator.storage?.getDirectory) {
      throw new Error('Origin Private File System is not available in this browser');
    }
    return navigator.storage.getDirectory();
  }
};

export const setWorkspaceFilesDeps = withInstrumentation(
  function setWorkspaceFilesDeps(next: Partial<WorkspaceFilesDeps>): void {
    deps = { ...deps, ...next };
  },
  { op: 'setWorkspaceFilesDeps' }
);

function isNotFoundError(error: unknown): boolean {
  // 'NotFoundError' is the DOM exception name (FileSystemDirectoryHandle
  // APIs); 'ENOENT' is OpfsFs's isomorphic-git-shaped FsError name/code.
  return error instanceof Error && (error.name === 'NotFoundError' || error.name === 'ENOENT');
}

function toStoredWorkspaceFiles(files: readonly WorkspaceFile[]): WorkspaceFile[] {
  return files.filter((file) => !file.readOnly);
}

// Serialize and coalesce source autosaves per workspace. A typing burst
// writes the current snapshot followed by at most one latest pending snapshot.
// Project configuration/examples share this tree but are not editor-owned.
interface SaveQueueEntry {
  inFlight: boolean;
  /** Most recently requested, not-yet-started snapshot (if any). */
  pending: {
    files: readonly WorkspaceFile[];
    waiters: Array<{ resolve: () => void; reject: (err: unknown) => void }>;
  } | null;
  /** Settles (success or failure) when the current in-flight write finishes. */
  runDone: Promise<void> | null;
}

const saveQueues = new Map<string, SaveQueueEntry>();

// Workspaces whose files have been deleted. A debounced/in-flight autosave
// queued before the delete (e.g. a keystroke handler that hasn't fired yet)
// must not resurrect the just-removed OPFS directory via the
// getDirectoryHandle(..., { create: true }) calls in saveWorkspaceFilesNow.
const deletedWorkspaceIds = new Set<string>();

// Per-workspace snapshot of the editor-tracked `.rosetta` paths this module
// itself last knew about (from `loadWorkspaceFiles` or the previous
// successful save) — issue #439, round 2. Deliberately NOT a live re-scan of
// the on-disk `files/` tree: a background git sync (fast-forward/merge) can
// write a collaborator's new file into that SAME directory independent of
// any save call, and the sync-status subscription never refreshes the
// editor's `files` state — diffing against live disk state would misread
// that freshly-synced file as user-deleted, unlink it, and the following
// stageAll would stage and push its deletion (silent remote data loss,
// exactly the failure mode the tracked-path baseline prevents).
// Diffing against this snapshot instead means a path the editor never knew
// about is simply never a pruning candidate, in either direction.
const folderPendingChanges = new Map<string, readonly ProjectChange[]>();
const folderRevisions = new Map<string, Map<string, string>>();
const lastKnownTrackedPaths = new Map<string, ReadonlySet<string>>();

export const saveWorkspaceFiles = withInstrumentation(
  function saveWorkspaceFiles(workspaceId: string, files: readonly WorkspaceFile[]): Promise<void> {
    if (deletedWorkspaceIds.has(workspaceId)) {
      return Promise.resolve();
    }

    const queue = saveQueues.get(workspaceId) ?? { inFlight: false, pending: null, runDone: null };
    saveQueues.set(workspaceId, queue);

    if (queue.inFlight) {
      return new Promise<void>((resolve, reject) => {
        if (queue.pending) {
          // A newer snapshot supersedes the previously-queued one — no need to
          // persist an intermediate state once a later one is already known.
          queue.pending.files = files;
          queue.pending.waiters.push({ resolve, reject });
        } else {
          queue.pending = { files, waiters: [{ resolve, reject }] };
        }
      });
    }

    return runQueuedSave(workspaceId, files, queue);
    // `files[].content` is raw model source — never captured; workspaceId +
    // count are safe.
  },
  {
    op: 'saveWorkspaceFiles',
    capture: Capture.Input,
    sanitize: (value, which) => {
      if (which !== 'input') return undefined;
      const [workspaceId, files] = value as [string, readonly WorkspaceFile[]];
      return { workspaceId, fileCount: files.length };
    }
  }
);

async function runQueuedSave(
  workspaceId: string,
  files: readonly WorkspaceFile[],
  queue: SaveQueueEntry
): Promise<void> {
  queue.inFlight = true;
  const run = saveWorkspaceFilesNow(workspaceId, files);
  queue.runDone = run.then(
    () => undefined,
    () => undefined
  );
  try {
    await run;
  } catch (error) {
    // A failed write must not strand anything queued behind it: reject those
    // waiters with the same error (rather than leaving them to hang forever)
    // and tear down the queue entry so the next call starts fresh instead of
    // later replaying this failure's stale, superseded snapshot.
    queue.inFlight = false;
    const stranded = queue.pending;
    queue.pending = null;
    saveQueues.delete(workspaceId);
    stranded?.waiters.forEach((w) => w.reject(error));
    throw error;
  }
  queue.inFlight = false;

  const next = queue.pending;
  queue.pending = null;
  if (next) {
    // Don't await — this call's promise settles once ITS OWN write is
    // done; the coalesced follow-up settles its own waiters independently.
    void runQueuedSave(workspaceId, next.files, queue).then(
      () => next.waiters.forEach((w) => w.resolve()),
      (err: unknown) => next.waiters.forEach((w) => w.reject(err))
    );
  } else {
    saveQueues.delete(workspaceId);
  }
}

async function saveWorkspaceFilesNow(workspaceId: string, files: readonly WorkspaceFile[]): Promise<void> {
  const folder = await deps.getFolderProjectAdapter?.(workspaceId);
  if (folder) {
    const controller = createProjectController({ workspaceId, adapter: folder, validateTarget: () => [] });
    try {
      const recovered = await controller.recover();
      const previous = folderRevisions.get(workspaceId) ?? new Map<string, string>();
      // Adopt only exact readback of this writer's interrupted attempt, never unrelated external edits.
      for (const change of folderPendingChanges.get(workspaceId) ?? []) {
        if ('remove' in change) {
          if (!recovered.files.has(change.path)) previous.delete(change.path);
        } else if (recovered.files.get(change.path) === change.text)
          previous.set(change.path, recovered.fileRevisions.get(change.path)!);
      }
      folderPendingChanges.delete(workspaceId);
      const stored = toStoredWorkspaceFiles(files),
        next = new Set(stored.map((file) => file.path));
      const changes: ProjectChange[] = [];
      for (const [path, expectedRevision] of previous)
        if (!next.has(path)) changes.push({ path, remove: true, expectedRevision });
      for (const file of stored) {
        if (recovered.files.get(file.path) === file.content) {
          previous.set(file.path, recovered.fileRevisions.get(file.path)!);
          continue;
        }
        changes.push({ path: file.path, text: file.content, expectedRevision: previous.get(file.path) ?? null });
      }
      folderRevisions.set(workspaceId, previous);
      if (!changes.length) return;
      folderPendingChanges.set(workspaceId, changes);
      const saved = await controller.save(changes);
      folderPendingChanges.delete(workspaceId);
      folderRevisions.set(workspaceId, new Map(stored.map((file) => [file.path, saved.fileRevisions.get(file.path)!])));
      lastKnownTrackedPaths.set(workspaceId, next);
    } finally {
      controller.dispose();
    }
    return;
  }
  const root = await deps.getOpfsRoot();

  const workspaceDir = await root.getDirectoryHandle(workspaceId, { create: true });

  await workspaceDir.getDirectoryHandle('files', { create: true });
  await workspaceDir.getDirectoryHandle('.studio', { create: true });

  const fs = new OpfsFs(root);
  const storedFiles = toStoredWorkspaceFiles(files);
  const nextPaths = new Set(storedFiles.map((file) => file.path));
  let changed = false;

  // Only remove paths this editor loaded or previously saved. Configuration,
  // examples, and files introduced by another writer must survive autosave.
  const previousPaths = lastKnownTrackedPaths.get(workspaceId) ?? new Set<string>();
  for (const previousPath of previousPaths) {
    if (!nextPaths.has(previousPath)) {
      try {
        await fs.unlink(`/${workspaceId}/files/${previousPath}`);
        changed = true;
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }
    }
  }

  for (const file of storedFiles) {
    const path = `/${workspaceId}/files/${file.path}`;
    try {
      if ((await fs.readFile(path, 'utf8')) === file.content) continue;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    await fs.writeFile(path, file.content);
    changed = true;
  }
  lastKnownTrackedPaths.set(workspaceId, nextPaths);
  if (changed) notifySyncOnSave(workspaceId);
}

export const loadWorkspaceFiles = withInstrumentation(
  async function loadWorkspaceFiles(workspaceId: string): Promise<WorkspaceFile[]> {
    const folder = await deps.getFolderProjectAdapter?.(workspaceId);
    if (folder) {
      const diagnostics = await recoverProjectSave(folder);
      if (diagnostics.length) throw new ProjectSnapshotError(diagnostics);
      const files: WorkspaceFile[] = [],
        revisions = new Map<string, string>();
      for (const path of await folder.list())
        if (path.endsWith('.rosetta')) {
          const file = await folder.read(path);
          if (!file) continue;
          files.push({ name: path.split('/').slice(-1)[0]!, path, content: file.text, dirty: false });
          revisions.set(path, file.revision);
        }
      folderPendingChanges.delete(workspaceId);
      folderRevisions.set(workspaceId, revisions);
      lastKnownTrackedPaths.set(workspaceId, new Set(revisions.keys()));
      return files;
    }
    const root = await deps.getOpfsRoot();
    const fs = new OpfsFs(root);
    const files: WorkspaceFile[] = [];

    await walkWorkspaceFiles(fs, `/${workspaceId}/files`, '', files);
    // Establish/refresh the pruning baseline (issue #439) from what's
    // actually on disk at load time — the moment the editor genuinely does
    // know about every currently-tracked path.
    lastKnownTrackedPaths.set(workspaceId, new Set(files.map((file) => file.path)));
    return files;
    // Output carries raw model source — never captured; only a count.
  },
  {
    op: 'loadWorkspaceFiles',
    capture: Capture.Input | Capture.Output,
    sanitize: (value, which) =>
      which === 'input' ? { workspaceId: (value as [string])[0] } : { fileCount: (value as WorkspaceFile[]).length }
  }
);

async function walkWorkspaceFiles(
  fs: OpfsFs,
  rootPath: string,
  relativePath: string,
  out: WorkspaceFile[]
): Promise<void> {
  const dirPath = relativePath ? `${rootPath}/${relativePath}` : rootPath;

  let entries: string[];
  try {
    entries = await fs.readdir(dirPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    const childRelativePath = relativePath ? `${relativePath}/${entry}` : entry;
    const childPath = `${rootPath}/${childRelativePath}`;

    let stat;
    try {
      stat = await fs.stat(childPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      await walkWorkspaceFiles(fs, rootPath, childRelativePath, out);
      continue;
    }

    if (!entry.endsWith('.rosetta')) {
      continue;
    }

    const content = (await fs.readFile(childPath, 'utf8')) as string;
    out.push({
      name: entry,
      path: childRelativePath,
      content,
      dirty: false
    });
  }
}

export const deleteWorkspaceFiles = withInstrumentation(
  async function deleteWorkspaceFiles(workspaceId: string): Promise<void> {
    // Mark deleted before anything else (synchronously, before any await) so
    // no save requested from this point on can slip past the queue drain
    // below and later recreate the directory we're about to remove.
    deletedWorkspaceIds.add(workspaceId);

    const queue = saveQueues.get(workspaceId);
    if (queue) {
      // A not-yet-started save would just resurrect the directory once it
      // runs — cancel it instead of letting it start.
      const pending = queue.pending;
      queue.pending = null;
      if (pending) {
        const err = new Error(`Workspace ${workspaceId} was deleted before its queued save could run`);
        pending.waiters.forEach((w) => w.reject(err));
      }
      // Wait for an already-running write to actually finish so the delete
      // below doesn't race its still-open OPFS mutations.
      if (queue.runDone) {
        await queue.runDone;
      }
    }

    try {
      const root = await deps.getOpfsRoot();
      await root.removeEntry(workspaceId, { recursive: true });
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }
      // The delete didn't actually happen — the caller (handleDeleteWorkspace)
      // surfaces this error and leaves the workspace active, so don't leave
      // it permanently unable to save: clear the tombstone before rethrowing.
      deletedWorkspaceIds.delete(workspaceId);
      throw error;
    }
  },
  {
    op: 'deleteWorkspaceFiles',
    capture: Capture.Input,
    sanitize: (value, which) => (which === 'input' ? { workspaceId: (value as [string])[0] } : undefined)
  }
);
