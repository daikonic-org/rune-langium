// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, expect, it, vi } from 'vitest';
import { createCuratedArtifactCache } from '../../src/services/curated-artifact-cache.js';

const artifactKey = (namespace: string, digest = 'a'.repeat(12)) =>
  JSON.stringify([
    'cdm',
    `https://www.daikonic.dev/curated/cdm/artifacts/2026-10-10-${digest}/ns/${namespace}.json.gz`
  ]);
const document = (key: string, namespace = 'test') => ({
  uri: `cdm/${namespace}.rosetta`,
  content: '',
  serializedModel: '{"$type":"RosettaModel"}',
  exports: [{ type: 'Data', name: 'Example', path: '/elements@0' }],
  bundleId: 'cdm',
  namespace,
  artifactKey: key,
  sourceLoaded: false
});
let sequence = 0;
const caches: ReturnType<typeof createCuratedArtifactCache>[] = [];

function cache(options: Parameters<typeof createCuratedArtifactCache>[0] = {}) {
  const databaseName = `curated-cache-test-${sequence++}`;
  const value = createCuratedArtifactCache({ databaseName, ...options });
  caches.push(value);
  return { value, databaseName };
}

afterEach(async () => {
  await Promise.all(caches.splice(0).map((value) => value.close()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('reopens model JSON and independently loaded source without downloading either', async () => {
  const { value, databaseName } = cache();
  const key = artifactKey('test');
  const docs = [document(key)];
  const sources = [{ uri: docs[0]!.uri, content: '// original source\nnamespace test\n' }];
  await value.putDocuments(key, docs);
  await value.putSource(key, sources);
  await value.close();
  const reopened = cache({ databaseName }).value;

  expect(await reopened.documentKeys()).toEqual([key]);
  expect(await reopened.documents(key)).toEqual(docs);
  expect(await reopened.source(key)).toEqual(sources);
  expect(await reopened.source(artifactKey('missing'))).toBeUndefined();
});

it('does not reuse a namespace from a different artifact digest or mutable pointer', async () => {
  const { value } = cache();
  const oldKey = artifactKey('test');
  await value.putDocuments(oldKey, [document(oldKey)]);
  for (const path of [
    'latest/ns/test.json.gz',
    'artifacts/2026-10-10/ns/test.json.gz',
    'artifacts/cohort-1/ns/test.json.gz'
  ]) {
    const key = JSON.stringify(['cdm', path]);
    await value.putDocuments(key, [document(key)]);
    await value.putSource(key, [{ uri: 'cdm/test.rosetta', content: 'source' }]);
    expect(await value.documents(key)).toBeUndefined();
    expect(await value.source(key)).toBeUndefined();
  }
  expect(await value.documentKeys()).toEqual([oldKey]);
  expect(await value.documents(artifactKey('test', 'b'.repeat(12)))).toBeUndefined();
});

it('keeps intentionally empty artifacts and strips source from JSON records', async () => {
  const { value } = cache();
  const emptyKey = artifactKey('empty');
  const key = artifactKey('test');
  await value.putDocuments(emptyKey, []);
  await value.putDocuments(key, [{ ...document(key), content: 'source is cached separately', sourceLoaded: true }]);
  expect(await value.documents(emptyKey)).toEqual([]);
  expect(await value.documents(key)).toEqual([document(key)]);
  expect(await value.source(key)).toBeUndefined();
});

it('background seeding does not evict foreground records, including across connections', async () => {
  const { value, databaseName } = cache({ maxEntries: 1 });
  const background = cache({ databaseName, maxEntries: 1 }).value;
  const first = artifactKey('first');
  const second = artifactKey('second');
  await value.putDocuments(first, [document(first, 'first')]);
  expect(await background.seedDocuments(second, [document(second, 'second')])).toBe(false);
  expect(await value.documentKeys()).toEqual([first]);
  await value.discardDocuments([first]);
  expect(await background.seedDocuments(second, [document(second, 'second')])).toBe(true);
  expect(await value.documents(second)).toEqual([document(second, 'second')]);
});

it('background fills retain the shared byte budget and reject invalid artifact identities', async () => {
  const { value } = cache({ maxBytes: 1024 });
  const first = artifactKey('first');
  const second = artifactKey('second');
  await value.putDocuments(first, [document(first, 'first')]);
  expect(
    await value.seedDocuments(second, [{ ...document(second, 'second'), serializedModel: 'x'.repeat(1024) }])
  ).toBe(false);
  expect(await value.seedDocuments('latest', [document(first, 'first')])).toBe(false);
  expect(await value.documents(first)).toHaveLength(1);
});

it('enforces non-evicting capacity atomically when fallback workers race', async () => {
  const { value, databaseName } = cache({ maxEntries: 1 });
  const other = cache({ databaseName, maxEntries: 1 }).value;
  const first = artifactKey('first');
  const second = artifactKey('second');
  const accepted = await Promise.all([
    value.seedDocuments(first, [document(first, 'first')]),
    other.seedDocuments(second, [document(second, 'second')])
  ]);
  expect(accepted.sort()).toEqual([false, true]);
  expect(await value.documentKeys()).toHaveLength(1);
});

it('evicts the least recently read record across model and source entries', async () => {
  const { value } = cache({ maxEntries: 2 });
  const key = artifactKey('test');
  const next = artifactKey('next');
  const now = vi.spyOn(Date, 'now').mockReturnValue(1);
  await value.putDocuments(key, [document(key)]);
  now.mockReturnValue(2);
  await value.putSource(key, [{ uri: 'cdm/test.rosetta', content: 'source' }]);
  now.mockReturnValue(3);
  await value.documents(key);
  now.mockReturnValue(4);
  await value.putDocuments(next, [document(next, 'next')]);
  expect(await value.documentKeys()).toEqual([next, key].sort());
  expect(await value.source(key)).toBeUndefined();
  expect(await value.documents(key)).toHaveLength(1);
});

it('bounds serialized payload bytes and rejects a single oversized payload', async () => {
  const { value } = cache({ maxBytes: 130 });
  const keys = [artifactKey('first'), artifactKey('second'), artifactKey('large')];
  await value.putSource(keys[0]!, [{ uri: 'cdm/first', content: 'a'.repeat(10) }]);
  await value.putSource(keys[1]!, [{ uri: 'cdm/second', content: 'b'.repeat(10) }]);
  expect(await value.source(keys[0]!)).toBeUndefined();
  expect(await value.source(keys[1]!)).toHaveLength(1);
  await value.putSource(keys[2]!, [{ uri: 'cdm/large', content: 'c'.repeat(100) }]);
  expect(await value.source(keys[2]!)).toBeUndefined();
  expect(await value.source(keys[1]!)).toHaveLength(1);
});

it.each(['format', 'json', 'identity', 'missing'])('drops an unusable %s entry', async (corruption) => {
  const { value, databaseName } = cache();
  const key = artifactKey('test');
  await value.putDocuments(key, [document(key)]);
  const db = await openDB(databaseName, 1);
  const id = JSON.stringify(['documents', key]);
  if (corruption === 'format') {
    const entry = await db.get('entries', id);
    await db.put('entries', { ...entry, formatVersion: 0 });
  } else if (corruption === 'missing') {
    await db.delete('payloads', id);
  } else {
    const payload =
      corruption === 'json' ? '[broken' : JSON.stringify([{ ...document(key), artifactKey: artifactKey('other') }]);
    const entry = await db.get('entries', id);
    await db.put('payloads', payload, id);
    await db.put('entries', { ...entry, sizeBytes: payload.length * 2 });
  }
  db.close();
  expect(await value.documents(key)).toBeUndefined();
  expect(await value.documentKeys()).toEqual([]);
});

it('treats unavailable and denied storage as misses', async () => {
  vi.stubGlobal('indexedDB', undefined);
  const first = cache().value;
  const key = artifactKey('test');
  await expect(first.putDocuments(key, [document(key)])).resolves.toBeUndefined();
  expect(await first.documentKeys()).toEqual([]);
  expect(await first.documents(key)).toBeUndefined();

  vi.stubGlobal('indexedDB', {
    open: () => {
      throw new DOMException('Denied', 'SecurityError');
    }
  });
  const second = cache().value;
  await expect(second.putSource(key, [{ uri: 'cdm/test', content: 'source' }])).resolves.toBeUndefined();
  expect(await second.documentKeys()).toEqual([]);
  expect(await second.source(key)).toBeUndefined();
});

it('ignores a quota failure without losing a usable previous record', async () => {
  const { value } = cache({ maxEntries: 1 });
  const key = artifactKey('test');
  await value.putDocuments(key, [document(key)]);
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
    throw new DOMException('Full', 'QuotaExceededError');
  });
  await expect(value.putSource(key, [{ uri: 'cdm/test', content: 'source' }])).resolves.toBeUndefined();
  expect(await value.documents(key)).toHaveLength(1);
});

it('shares its capacity and persistence with checksum-addressed reference bytes', async () => {
  const { projectBytesRevision } = await import('@rune-langium/project-config');
  const { value, databaseName } = cache({ maxBytes: 16, maxEntries: 1 });
  const bytes = new Uint8Array([0, 255, 1]);
  const key = await projectBytesRevision(bytes);
  await value.putReferenceBytes(key, bytes);
  await value.close();
  const reopened = cache({ databaseName, maxBytes: 16, maxEntries: 1 }).value;
  expect(await reopened.referenceBytes(key)).toEqual(bytes);
  expect(await reopened.documentKeys()).toEqual([]);
  await reopened.putReferenceBytes('a'.repeat(64), bytes);
  expect(await reopened.referenceBytes('a'.repeat(64))).toBeUndefined();
});
