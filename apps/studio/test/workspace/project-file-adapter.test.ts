// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { describe, expect, it } from 'vitest';
import { createOpfsRoot, writeBytes, readBytes } from '../setup/opfs-mock.js';
import { createProjectFileAdapter } from '../../src/workspace/project-file-adapter.js';

const decode = (data: Uint8Array) => new TextDecoder().decode(data);
describe('workspace-bound project file adapter', () => {
  it('preserves binary output bytes and checks their raw revision', async () => {
    const root = createOpfsRoot();
    const adapter = createProjectFileAdapter({
      workspaceId: 'binary',
      root: root as unknown as FileSystemDirectoryHandle,
      privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
      isWritable: () => true
    });
    const bytes = new Uint8Array([0, 255, 128, 1]);
    const revision = await adapter.writeBinary!('generated/book.xlsx', bytes, null);
    expect(await readBytes(root, 'generated', 'book.xlsx')).toEqual(bytes);
    expect((await adapter.read('generated/book.xlsx'))?.revision).toBe(revision);
    await expect(adapter.writeBinary!('generated/book.xlsx', bytes, null)).rejects.toThrow();
  });
  it('writes repository files with revision checks and hides private paths from listing', async () => {
    const root = createOpfsRoot();
    await writeBytes(root, new TextEncoder().encode('secret'), 'token');
    const files = await root.getDirectoryHandle('files', { create: true });
    const privateRoot = createOpfsRoot();
    const adapter = createProjectFileAdapter({
      workspaceId: 'one',
      privateRoot: privateRoot as unknown as FileSystemDirectoryHandle,
      root: files as unknown as FileSystemDirectoryHandle,
      isWritable: () => true
    });
    const rev = await adapter.write('build-config.yml', 'schemaVersion: 1', null);
    expect((await adapter.read('build-config.yml'))?.revision).toBe(rev);
    await expect(adapter.write('build-config.yml', 'overwrite', null)).rejects.toThrow();
    await adapter.write('.studio/project-save/journal.json', '{}', null);
    expect(await adapter.list()).toEqual(['build-config.yml']);
    await expect(files.getDirectoryHandle('.studio')).rejects.toThrow();
    expect(decode(await readBytes(privateRoot, 'project-save', 'journal.json'))).toBe('{}');
    expect(decode(await readBytes(root, 'token'))).toBe('secret');
    await adapter.remove('build-config.yml', rev);
    expect(await adapter.read('build-config.yml')).toBeUndefined();
  });
  it('refuses stale writes after an external file edit', async () => {
    const root = createOpfsRoot();
    const adapter = createProjectFileAdapter({
      workspaceId: 'two',
      root: root as unknown as FileSystemDirectoryHandle,
      privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
      isWritable: () => true
    });
    const rev = await adapter.write('a', 'first', null);
    await writeBytes(root, new TextEncoder().encode('external'), 'a');
    await expect(adapter.write('a', 'lost', rev)).rejects.toThrow();
    expect(decode(await readBytes(root, 'a'))).toBe('external');
  });
  it('honors lost ownership and permission without touching data', async () => {
    const root = createOpfsRoot();
    let writable = true;
    const adapter = createProjectFileAdapter({
      workspaceId: 'bound',
      root: root as unknown as FileSystemDirectoryHandle,
      privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
      isWritable: () => writable
    });
    const rev = await adapter.write('a', 'original', null);
    writable = false;
    await expect(adapter.write('a', 'no', rev)).rejects.toThrow();
    await expect(adapter.remove('a', rev)).rejects.toThrow();
    expect(decode(await readBytes(root, 'a'))).toBe('original');
  });
  it.each(['../token', '/private', 'C:\\private', '.git/config', '.studio/token'])(
    'rejects escaping project path %s',
    async (path) => {
      const root = createOpfsRoot();
      const adapter = createProjectFileAdapter({
        workspaceId: 'guard',
        root: root as unknown as FileSystemDirectoryHandle,
        privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
        isWritable: () => true
      });
      await expect(adapter.write(path, 'no', null)).rejects.toThrow();
      expect(await adapter.list()).toEqual([]);
    }
  );
  it('serializes competing adapters for the same workspace before checking revision', async () => {
    const root = createOpfsRoot();
    const input = {
      workspaceId: 'shared',
      root: root as unknown as FileSystemDirectoryHandle,
      privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
      isWritable: () => true
    };
    const one = createProjectFileAdapter(input),
      two = createProjectFileAdapter(input);
    const results = await Promise.allSettled([one.write('a', 'one', null), two.write('a', 'two', null)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(['one', 'two']).toContain(decode(await readBytes(root, 'a')));
  });
});

describe('folder access errors', () => {
  it('propagates denied reads instead of treating permission loss as a missing file', async () => {
    const root = createOpfsRoot();
    root.getFileHandle = async () => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    };
    const adapter = createProjectFileAdapter({
      workspaceId: 'denied',
      root: root as unknown as FileSystemDirectoryHandle,
      privateRoot: createOpfsRoot() as unknown as FileSystemDirectoryHandle,
      isWritable: () => true
    });
    await expect(adapter.write('a', 'no', null)).rejects.toThrow('denied');
    expect(await adapter.list()).toEqual([]);
  });
});
