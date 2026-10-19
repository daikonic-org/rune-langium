// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';
import { createCuratedCacheSeeder } from '../../src/services/curated-cache-seeder.js';
import { parseCuratedCacheSeeds } from '../../src/services/curated-cache-seeds.js';
import type { fetchCuratedNamespace } from '../../src/services/curated-fetch.js';

const seed = (namespace = 'example', digest = 'a'.repeat(12)) => ({
  key: JSON.stringify(['cdm', `artifacts/2026-10-18-${digest}/ns/${namespace}.json.gz`]),
  bundleId: 'cdm' as const,
  version: 'b'.repeat(64),
  namespace
});
const cleanups: Array<() => void> = [];
function setup(delayMs = 1) {
  vi.useFakeTimers();
  const cache = { documentKeys: vi.fn(async () => [] as string[]), seedDocuments: vi.fn(async () => true) };
  const fetchNamespace = vi.fn<typeof fetchCuratedNamespace>(async () => [
    { uri: 'cdm/example.rosetta', content: 'public source', serializedModel: '{}', exports: [] }
  ]);
  const seeder = createCuratedCacheSeeder({ cache, fetchNamespace, delayMs });
  cleanups.push(() => seeder.close());
  return { cache, fetchNamespace, seeder };
}
afterEach(() => {
  cleanups.splice(0).forEach((close) => close());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('deduplicates two tabs and uses the canonical transport without retaining a second corpus cache', async () => {
  const { seeder, cache, fetchNamespace } = setup();
  seeder.seed(1, [seed()]);
  seeder.seed(2, [seed()]);
  await vi.runAllTimersAsync();
  expect(fetchNamespace).toHaveBeenCalledTimes(1);
  expect(fetchNamespace).toHaveBeenCalledWith('cdm', seed().version, JSON.parse(seed().key)[1], expect.any(Function), {
    retain: false
  });
  expect(cache.seedDocuments).toHaveBeenCalledWith(seed().key, [
    {
      uri: 'cdm/example.rosetta',
      content: '',
      sourceLoaded: false,
      serializedModel: '{}',
      exports: [],
      bundleId: 'cdm',
      namespace: 'example',
      artifactKey: seed().key
    }
  ]);
});

it('skips persisted receipts and treats a new cohort as a different job', async () => {
  const { seeder, cache, fetchNamespace } = setup();
  cache.documentKeys.mockResolvedValue([seed().key]);
  seeder.seed(1, [seed()]);
  await vi.runAllTimersAsync();
  expect(fetchNamespace).not.toHaveBeenCalled();
  seeder.seed(1, [seed('example', 'c'.repeat(12))]);
  await vi.runAllTimersAsync();
  expect(fetchNamespace).toHaveBeenCalledTimes(1);
});

it('skips a batch of persisted artifacts in one pass before downloading a missing artifact', async () => {
  const { seeder, cache, fetchNamespace } = setup();
  const cached = Array.from({ length: 44 }, (_, i) => seed(`cached${i}`));
  cache.documentKeys.mockResolvedValue(cached.map((item) => item.key));
  seeder.seed(1, [...cached, seed('missing')]);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetchNamespace).toHaveBeenCalledTimes(1);
  expect(fetchNamespace.mock.calls[0]![2]).toContain('/missing.json.gz');
  expect(cache.documentKeys).toHaveBeenCalledTimes(1);
});

it('waits for foreground work across tabs and automatically expires abandoned holds', async () => {
  const { seeder, fetchNamespace } = setup(1000);
  seeder.seed(1, [seed()]);
  seeder.foreground(2, true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(fetchNamespace).not.toHaveBeenCalled();
  seeder.foreground(2, true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(fetchNamespace).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(9999);
  expect(fetchNamespace).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(fetchNamespace).toHaveBeenCalledTimes(1);
});

it('aborts an active download for foreground work and retries it after release', async () => {
  const { seeder, cache, fetchNamespace } = setup();
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          signal = init.signal;
          signal!.addEventListener('abort', () => reject(signal!.reason));
        })
    )
  );
  fetchNamespace.mockImplementationOnce(async (_id, _version, _artifact, fetcher) => {
    await fetcher!('https://www.daikonic.dev/curated/cdm/test');
    return [];
  });
  seeder.seed(1, [seed()]);
  await vi.advanceTimersByTimeAsync(1);
  expect(signal?.aborted).toBe(false);
  seeder.foreground(2, true);
  await vi.advanceTimersByTimeAsync(1);
  expect(signal?.aborted).toBe(true);
  expect(cache.seedDocuments).not.toHaveBeenCalled();
  seeder.foreground(2, false);
  await vi.runAllTimersAsync();
  expect(fetchNamespace).toHaveBeenCalledTimes(2);
  expect(cache.seedDocuments).toHaveBeenCalledTimes(1);
});

it('stops speculative downloads when storage cannot accept an artifact', async () => {
  const { seeder, cache, fetchNamespace } = setup();
  cache.seedDocuments.mockResolvedValue(false);
  seeder.seed(1, [seed('first'), seed('second')]);
  await vi.runAllTimersAsync();
  expect(fetchNamespace).toHaveBeenCalledTimes(1);
});

it('drops superseded jobs and continues past a failed artifact without retry loops', async () => {
  const { seeder, fetchNamespace } = setup();
  seeder.seed(1, [seed('old')]);
  seeder.seed(1, [seed('new'), seed('next')]);
  fetchNamespace.mockRejectedValueOnce(new Error('unavailable'));
  await vi.runAllTimersAsync();
  expect(fetchNamespace).toHaveBeenCalledTimes(2);
  expect(fetchNamespace.mock.calls.map((call) => call[2])).not.toContain(JSON.parse(seed('old').key)[1]);
});

it('preserves publisher-provided namespace mappings, including sanitized artifact filenames', async () => {
  const fpml = {
    ...seed(),
    bundleId: 'fpml' as const,
    namespace: 'fpml.consolidated.',
    key: JSON.stringify(['fpml', 'artifacts/2026-10-18-aaaaaaaaaaaa/ns/fpml.consolidated.aa680f2a.json.gz'])
  };
  const batch = [seed(), fpml];
  expect(parseCuratedCacheSeeds(batch)).toEqual(batch);

  const { seeder, fetchNamespace, cache } = setup();
  seeder.seed(1, batch);
  await vi.runAllTimersAsync();
  expect(fetchNamespace).toHaveBeenCalledTimes(2);
  expect(fetchNamespace).toHaveBeenLastCalledWith('fpml', fpml.version, JSON.parse(fpml.key)[1], expect.any(Function), {
    retain: false
  });
  expect(cache.seedDocuments).toHaveBeenLastCalledWith(fpml.key, [
    expect.objectContaining({ bundleId: 'fpml', namespace: fpml.namespace, artifactKey: fpml.key })
  ]);
});

it('accepts only bounded immutable metadata with matching bundle identities', () => {
  expect(parseCuratedCacheSeeds([{ ...seed(), privateSource: 'must not cross the worker boundary' }])).toEqual([
    seed()
  ]);
  for (const bad of [
    { ...seed(), key: 'latest' },
    { ...seed(), bundleId: 'fpml' },
    { ...seed(), namespace: '' },
    {
      ...seed(),
      key: JSON.stringify(['cdm', 'https://evil.example/artifacts/2026-10-18-aaaaaaaaaaaa/ns/example.json.gz'])
    },
    { ...seed(), key: JSON.stringify(['cdm', 'artifacts/2026-10-18-aaaaaaaaaaaa/ns/../example.json.gz']) }
  ]) {
    expect(parseCuratedCacheSeeds([bad])).toEqual([]);
  }
  expect(parseCuratedCacheSeeds(Array.from({ length: 513 }, () => seed()))).toEqual([]);
});
