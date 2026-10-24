// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect, vi } from 'vitest';
import type { DurableObjectStorage } from '@cloudflare/workers-types';
import { persistLspModels, replayLspModels, purgeLspModels } from '../src/model-storage.js';

function storage() {
  const data = new Map<string, unknown>();
  const api = {
    get: async (key: string) => data.get(key),
    put: vi.fn(async (key: string, value: unknown) => {
      data.set(key, value);
    }),
    delete: async (keys: string | string[]) => {
      for (const key of typeof keys === 'string' ? [keys] : keys) data.delete(key);
    },
    list: async ({ prefix, limit = 1000, startAfter }: { prefix: string; limit?: number; startAfter?: string }) =>
      new Map(
        [...data]
          .filter(([key]) => key.startsWith(prefix) && (!startAfter || key > startAfter))
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(0, limit)
      )
  };
  return { data, api, typed: api as unknown as DurableObjectStorage };
}

describe('LSP model persistence', () => {
  it('chunks large Unicode models below the storage value limit and replays exactly', async () => {
    const { data, typed } = storage();
    const modelJson = JSON.stringify({ name: '😀'.repeat(50_000) });
    await persistLspModels(typed, { document: { uri: 'file:///large.rosetta', modelJson } });
    const chunks = [...data].filter(([key]) => key.startsWith('models:')).map(([, value]) => value);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((value) => new TextEncoder().encode(value as string).length < 128 * 1024)).toBe(true);
    const sync = vi.fn().mockResolvedValue(undefined);
    await replayLspModels(typed, sync);
    expect(sync.mock.calls).toEqual([
      [{ document: { uri: 'file:///large.rosetta', modelJson } }],
      [{ retain: ['file:///large.rosetta'] }]
    ]);
  });
  it('keeps the previous complete model if a replacement chunk write fails', async () => {
    const { api, typed } = storage();
    await persistLspModels(typed, { document: { uri: 'file:///a.rosetta', modelJson: 'old' } });
    api.put.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(
      persistLspModels(typed, { document: { uri: 'file:///a.rosetta', modelJson: 'new' } })
    ).rejects.toThrow();
    const sync = vi.fn().mockResolvedValue(undefined);
    await replayLspModels(typed, sync);
    expect(sync).toHaveBeenNthCalledWith(1, { document: { uri: 'file:///a.rosetta', modelJson: 'old' } });
  });
  it('removes omitted models and purges beyond one storage page', async () => {
    const { data, typed } = storage();
    await persistLspModels(typed, { document: { uri: 'file:///a.rosetta', modelJson: '{}' } });
    await persistLspModels(typed, { retain: [] });
    expect(data.size).toBe(0);
    for (let i = 0; i < 1100; i++) data.set(`models:orphan:${i}`, 'x');
    await purgeLspModels(typed);
    expect(data.size).toBe(0);
  });
  it('replays and prunes every model across storage pages', async () => {
    const { data, typed } = storage();
    for (let i = 0; i < 1100; i++) {
      const uri = `file:///model-${String(i).padStart(4, '0')}.rosetta`;
      data.set(`model-meta:${uri}`, { generation: 'test', count: 1 });
      data.set(`models:${uri}:test:0`, '{}');
    }
    const sync = vi.fn().mockResolvedValue(undefined);
    await replayLspModels(typed, sync);
    expect(sync).toHaveBeenCalledTimes(1101);
    expect(sync.mock.lastCall?.[0].retain).toHaveLength(1100);
    await persistLspModels(typed, { retain: ['file:///model-1099.rosetta'] });
    expect(data.size).toBe(2);
    expect(data.has('model-meta:file:///model-1099.rosetta')).toBe(true);
  });
});

it('persists a chunked resolution context and replays it only with the final model barrier', async () => {
  const { data, typed } = storage();
  const receipt = { revision: 'a'.repeat(64), lockDigest: 'b'.repeat(64), overridesDigest: 'c'.repeat(64) };
  const resolution = {
    schemaVersion: 1 as const,
    receipt,
    models: { ['file:///' + '😀'.repeat(50_000)]: 'cdm' },
    lock: null,
    overrides: []
  };
  await persistLspModels(typed, { document: { uri: 'file:///a.rosetta', modelJson: '{}' } });
  await persistLspModels(typed, { retain: ['file:///a.rosetta'], resolution });
  expect(
    [...data.values()].every(
      (value) =>
        new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).byteLength < 128 * 1024
    )
  ).toBe(true);
  const sync = vi.fn().mockResolvedValue(undefined);
  await replayLspModels(typed, sync);
  expect(sync.mock.calls).toEqual([
    [{ document: { uri: 'file:///a.rosetta', modelJson: '{}' } }],
    [{ retain: ['file:///a.rosetta'], resolution }]
  ]);
  await purgeLspModels(typed);
  expect(data.size).toBe(0);
});
it('keeps the previous context on interrupted replacement and clears it explicitly for legacy workspaces', async () => {
  const { api, typed } = storage();
  const resolution = {
    schemaVersion: 1 as const,
    receipt: { revision: 'a'.repeat(64), lockDigest: 'b'.repeat(64), overridesDigest: 'c'.repeat(64) },
    models: {},
    lock: null,
    overrides: []
  };
  await persistLspModels(typed, { retain: [], resolution });
  api.put.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(
    persistLspModels(typed, {
      retain: [],
      resolution: { ...resolution, receipt: { ...resolution.receipt, revision: 'd'.repeat(64) } }
    })
  ).rejects.toThrow();
  const sync = vi.fn().mockResolvedValue(undefined);
  await replayLspModels(typed, sync);
  expect(sync).toHaveBeenLastCalledWith({ retain: [], resolution });
  await persistLspModels(typed, { retain: [], resolution: null });
  sync.mockClear();
  await replayLspModels(typed, sync);
  expect(sync).not.toHaveBeenCalled();
});
