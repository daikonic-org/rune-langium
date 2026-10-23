// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * T018 — workspace lifecycle (create/open/close/delete) tests.
 * Integration: persistence (T015) + opfs-fs (T011) + broadcast (T017).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { createOpfsRoot, type OpfsRoot } from '../setup/opfs-mock.js';
import { _resetForTests, loadWorkspace } from '../../src/workspace/persistence.js';
import { WorkspaceManager } from '../../src/workspace/workspace-manager.js';

class FakeBroadcastChannel extends EventTarget {
  static channels = new Map<string, Set<FakeBroadcastChannel>>();
  constructor(public name: string) {
    super();
    if (!FakeBroadcastChannel.channels.has(name)) {
      FakeBroadcastChannel.channels.set(name, new Set());
    }
    FakeBroadcastChannel.channels.get(name)!.add(this);
  }
  postMessage(data: unknown) {
    queueMicrotask(() => {
      const peers = FakeBroadcastChannel.channels.get(this.name);
      if (!peers) return;
      for (const peer of peers) {
        if (peer === this) continue;
        peer.dispatchEvent(new MessageEvent('message', { data }));
      }
    });
  }
  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}

let opfsRoot: OpfsRoot;

beforeEach(async () => {
  FakeBroadcastChannel.channels.clear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).BroadcastChannel = FakeBroadcastChannel;
  await _resetForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('rune-studio');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
  opfsRoot = createOpfsRoot();
});

afterEach(() => {
  FakeBroadcastChannel.channels.clear();
});

function makeManager(tabId = 'tab-a') {
  return new WorkspaceManager({
    opfsRoot: opfsRoot as unknown as FileSystemDirectoryHandle,
    tabId,
    studioVersion: '0.1.0'
  });
}

describe('WorkspaceManager — lifecycle (T018)', () => {
  it('create returns a workspace with a stable id and lastOpenedAt', async () => {
    const m = makeManager();
    const ws = await m.create('My Project');
    expect(ws.id).toMatch(/^[0-9A-Z]{20,}$/i); // ULID-shape
    expect(ws.name).toBe('My Project');
    expect(ws.kind).toBe('browser-only');
  });

  it('open() restores a previously created workspace and bumps lastOpenedAt', async () => {
    const m = makeManager();
    const created = await m.create('First');
    const before = created.lastOpenedAt;
    // Wait a tick so the timestamp changes.
    await new Promise((r) => setTimeout(r, 5));
    const reopened = await m.open(created.id);
    expect(reopened?.id).toBe(created.id);
    expect(reopened!.lastOpenedAt > before).toBe(true);
  });

  it('list returns workspaces sorted by lastOpenedAt desc', async () => {
    const m = makeManager();
    const a = await m.create('A');
    await new Promise((r) => setTimeout(r, 5));
    const b = await m.create('B');
    const list = await m.listRecents();
    expect(list.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it('delete removes the workspace and its OPFS directory', async () => {
    const m = makeManager();
    const ws = await m.create('Throwaway');
    await m.delete(ws.id);
    expect(await m.open(ws.id)).toBeUndefined();
    // The OPFS dir for the workspace is gone.
    const root = opfsRoot as unknown as { entries(): AsyncIterableIterator<[string, unknown]> };
    const names: string[] = [];
    for await (const [n] of root.entries()) names.push(n);
    expect(names).not.toContain(ws.id);
  });

  it('delete recursively removes nested OPFS subtrees', async () => {
    const m = makeManager();
    const ws = await m.create('Deep');
    // Write a deeply nested file under the workspace's files/ tree.
    const fs = new (await import('../../src/opfs/opfs-fs.js')).OpfsFs(opfsRoot as unknown as FileSystemDirectoryHandle);
    await fs.writeFile(`/${ws.id}/files/a/b/c.txt`, 'deep');
    await m.delete(ws.id);
    const root = opfsRoot as unknown as { entries(): AsyncIterableIterator<[string, unknown]> };
    const names: string[] = [];
    for await (const [n] of root.entries()) names.push(n);
    expect(names).not.toContain(ws.id);
  });
});

describe('WorkspaceManager — multi-tab ownership integration', () => {
  it('second tab opening the same workspace is read-only', async () => {
    const a = makeManager('tab-a');
    const b = makeManager('tab-b');
    const ws = await a.create('Shared');
    const aOpen = await a.open(ws.id);
    expect(a.isOwner(aOpen!.id)).toBe(true);

    const bOpen = await b.open(ws.id, { claimTimeoutMs: 50 });
    expect(bOpen).toBeDefined();
    expect(b.isOwner(bOpen!.id)).toBe(false);
    expect(b.isReadOnly(bOpen!.id)).toBe(true);
  });
});

describe('workspace-bound project files', () => {
  it('keeps roots independent and revokes an existing adapter when ownership is released', async () => {
    const manager = makeManager();
    const first = await manager.create('First');
    const second = await manager.create('Second');
    const one = await manager.getProjectFileAdapter(first.id);
    const two = await manager.getProjectFileAdapter(second.id);
    await one.write('build-config.yml', 'first config', null);
    expect(await two.read('build-config.yml')).toBeUndefined();
    await manager.close(first.id);
    await expect(one.write('other.yml', 'no', null)).rejects.toThrow(/writable/);
    expect((await one.read('build-config.yml'))?.text).toBe('first config');
  });
  it('refuses an unknown workspace instead of creating a new root', async () => {
    await expect(makeManager().getProjectFileAdapter('missing')).rejects.toThrow(/not found/);
  });
});

it('claims project access without rewriting workspace metadata from a stale record', async () => {
  const manager = makeManager();
  const workspace = await manager.create('Metadata');
  await expect(manager.claimProjectAccess(workspace.id)).resolves.toBe(true);
  expect((await loadWorkspace(workspace.id))?.lastOpenedAt).toBe(workspace.lastOpenedAt);
});
