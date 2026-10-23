// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import {
  normalizeProjectPath,
  PROJECT_SAVE_JOURNAL_PATH,
  ProjectFileConflict,
  projectFileRevision,
  type ProjectFileAdapter
} from '@rune-langium/project-config';

import { withInstrumentation } from '../services/instrumentation/core.js';

interface ProjectFileAdapterOptions {
  workspaceId: string;
  /** The working-copy root, never the parent containing credentials. */
  root: FileSystemDirectoryHandle;
  /** Backing-private directory outside the repository working copy. */
  privateRoot: FileSystemDirectoryHandle;
  isWritable: () => boolean;
}

const queues = new Map<string, Promise<unknown>>();

async function exclusive<T>(workspaceId: string, action: () => Promise<T>): Promise<T> {
  const name = 'studio-project-files:' + workspaceId;
  if (navigator.locks) return navigator.locks.request(name, action);
  const previous = queues.get(name) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(action);
  queues.set(name, next);
  try {
    return await next;
  } finally {
    if (queues.get(name) === next) queues.delete(name);
  }
}

function checkedPath(input: string): string[] {
  const path = normalizeProjectPath(input);
  if (!path || /^\.git(\/|$)/i.test(path) || (/^\.studio(\/|$)/i.test(path) && path !== PROJECT_SAVE_JOURNAL_PATH))
    throw new Error('Invalid project path');
  return path.split('/');
}

/** A bound root and live ownership check prevent writes leaking to another workspace. */
export const createProjectFileAdapter = withInstrumentation(
  function createProjectFileAdapter(options: ProjectFileAdapterOptions): ProjectFileAdapter {
    const { root, privateRoot, workspaceId, isWritable } = options;
    async function parent(path: string, create = false) {
      const parts = checkedPath(path);
      const name = parts.pop()!;
      let dir = root;
      if (parts[0] === '.studio') {
        parts.shift();
        dir = privateRoot;
      }
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
      return { dir, name };
    }
    async function read(path: string) {
      try {
        const { dir, name } = await parent(path);
        const handle = await dir.getFileHandle(name);
        const text = await (await handle.getFile()).text();
        return { text, revision: await projectFileRevision(text) };
      } catch (error) {
        if (error instanceof Error && error.name === 'NotFoundError') return undefined;
        throw error;
      }
    }
    function requireWritable() {
      if (!isWritable()) throw new Error('Workspace is not writable by this tab');
    }
    return {
      read,
      write: (path, text, expectedRevision) =>
        exclusive(workspaceId, async () => {
          requireWritable();
          if (((await read(path))?.revision ?? null) !== expectedRevision) throw new ProjectFileConflict(path);
          const { dir, name } = await parent(path, true);
          requireWritable();
          const handle = await dir.getFileHandle(name, { create: true });
          const stream = await handle.createWritable();
          try {
            await stream.write(text);
            requireWritable();
            await stream.close();
          } catch (error) {
            await stream.abort().catch(() => undefined);
            throw error;
          }
          const revision = await projectFileRevision(text);
          if ((await read(path))?.revision !== revision) throw new ProjectFileConflict(path);
          return revision;
        }),
      remove: (path, expectedRevision) =>
        exclusive(workspaceId, async () => {
          requireWritable();
          if ((await read(path))?.revision !== expectedRevision) throw new ProjectFileConflict(path);
          const { dir, name } = await parent(path);
          requireWritable();
          await dir.removeEntry(name);
        }),
      async list() {
        const files: string[] = [];
        async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
          for await (const [name, handle] of dir.entries()) {
            if (/^\.(git|studio)$/i.test(name)) continue;
            const path = prefix + name;
            if (handle.kind === 'directory') await walk(handle, path + '/');
            else files.push(path);
          }
        }
        await walk(root, '');
        return files.sort();
      }
    };
  },
  { op: 'createProjectFileAdapter' }
);
