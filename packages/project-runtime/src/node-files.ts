// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { mkdir, open, readFile, readdir, realpath, stat, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  normalizeProjectPath,
  isIgnoredProjectEntry,
  PROJECT_SAVE_JOURNAL_PATH,
  ProjectFileConflict,
  projectBytesRevision,
  projectFileRevision,
  type ProjectFileAdapter
} from '@rune-langium/project-config';

const queues = new Map<string, Promise<unknown>>();
async function exclusive<T>(key: string, action: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(action);
  queues.set(key, next);
  try {
    return await next;
  } finally {
    if (queues.get(key) === next) queues.delete(key);
  }
}
function missing(failure: unknown): boolean {
  return (failure as NodeJS.ErrnoException).code === 'ENOENT';
}
function within(root: string, path: string): boolean {
  const diff = relative(root, path);
  return !isAbsolute(diff) && diff !== '..' && !diff.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'));
}
/** Resolve existing ancestors too, rejecting an output directory symlink escape. */
async function contained(root: string, path: string, writable = false): Promise<void> {
  let candidate = path;
  while (true) {
    try {
      const canonical = await realpath(candidate);
      if (!within(root, canonical)) throw new Error('Project path escapes its root: ' + path);
      if (writable && canonical !== candidate) throw new Error('Project writes cannot traverse a symlink: ' + path);
      return;
    } catch (failure) {
      if (!missing(failure)) throw failure;
      const parent = dirname(candidate);
      if (parent === candidate) throw failure;
      candidate = parent;
    }
  }
}

/** Node-only host. Journals remain in the user's cache, outside the Git tree. */
export async function createNodeProjectFileAdapter(
  directory: string,
  options: { privateRoot?: string } = {}
): Promise<ProjectFileAdapter> {
  const root = await realpath(directory);
  if (!(await stat(root)).isDirectory()) throw new Error('Project root must be a directory.');
  const privateRoot = resolve(
    options.privateRoot ??
      join(
        process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'),
        'rune-langium',
        'projects',
        await projectFileRevision(root)
      )
  );
  if (within(root, privateRoot)) throw new Error('Private project storage must be outside the working copy.');
  async function target(input: string) {
    const path = normalizeProjectPath(input);
    if (!path || /^\.git(\/|$)/i.test(path) || (/^\.studio(\/|$)/i.test(path) && path !== PROJECT_SAVE_JOURNAL_PATH))
      throw new Error('Invalid project path: ' + input);
    const isPrivate = path === PROJECT_SAVE_JOURNAL_PATH;
    const base = isPrivate ? privateRoot : root;
    if (isPrivate) {
      await mkdir(privateRoot, { recursive: true, mode: 0o700 });
      if (within(root, await realpath(privateRoot)))
        throw new Error('Private project storage resolves into the working copy.');
    }
    const canonicalBase = await realpath(base);
    const absolute = resolve(canonicalBase, isPrivate ? path.slice('.studio/'.length) : path);
    await contained(canonicalBase, absolute);
    return { absolute, base: canonicalBase };
  }
  async function read(path: string) {
    const { absolute } = await target(path);
    try {
      const bytes = await readFile(absolute);
      return { text: new TextDecoder().decode(bytes), revision: await projectBytesRevision(bytes) };
    } catch (failure) {
      if (missing(failure)) return undefined;
      throw failure;
    }
  }
  async function writeBytes(path: string, bytes: Uint8Array, expectedRevision: string | null) {
    return exclusive(root, async () => {
      const { absolute, base } = await target(path);
      if (((await read(path))?.revision ?? null) !== expectedRevision) throw new ProjectFileConflict(path);
      await contained(base, absolute, true);
      await mkdir(dirname(absolute), { recursive: true });
      await contained(base, absolute, true);
      const noFollow = constants.O_NOFOLLOW ?? 0;
      let handle;
      try {
        handle = await open(
          absolute,
          constants.O_RDWR | noFollow | (expectedRevision === null ? constants.O_CREAT | constants.O_EXCL : 0),
          0o600
        );
      } catch (failure) {
        if (missing(failure) || (failure as NodeJS.ErrnoException).code === 'EEXIST')
          throw new ProjectFileConflict(path);
        throw failure;
      }
      try {
        if (expectedRevision !== null && (await projectBytesRevision(await handle.readFile())) !== expectedRevision)
          throw new ProjectFileConflict(path);
        // readFile advances the descriptor; positional writes start at zero.
        let offset = 0;
        while (offset < bytes.length) {
          const result = await handle.write(bytes, offset, bytes.length - offset, offset);
          if (!result.bytesWritten) throw new Error('Project output write made no progress.');
          offset += result.bytesWritten;
        }
        await handle.truncate(bytes.length);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const revision = await projectBytesRevision(bytes);
      if ((await read(path))?.revision !== revision) throw new ProjectFileConflict(path);
      return revision;
    });
  }
  return {
    read,
    write: (path, text, revision) => writeBytes(path, new TextEncoder().encode(text), revision),
    writeBinary: writeBytes,
    remove: (path, revision) =>
      exclusive(root, async () => {
        const { absolute, base } = await target(path);
        await contained(base, absolute, true);
        if ((await read(path))?.revision !== revision) throw new ProjectFileConflict(path);
        await unlink(absolute);
      }),
    async list() {
      const files: string[] = [];
      const visited = new Set<string>();
      async function walk(path: string, prefix: string) {
        const canonical = await realpath(path);
        if (!within(root, canonical)) throw new Error('Project symlink escapes its root: ' + prefix);
        if (visited.has(canonical)) return;
        visited.add(canonical);
        for (const name of await readdir(path)) {
          if (isIgnoredProjectEntry(name)) continue;
          const child = join(path, name);
          await contained(root, child);
          const info = await stat(child);
          if (info.isDirectory()) await walk(child, prefix + name + '/');
          else if (info.isFile()) files.push(prefix + name);
        }
      }
      await walk(root, '');
      return files.sort();
    }
  };
}
