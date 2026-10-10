// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import 'fake-indexeddb/auto';
import { deleteDB, openDB } from 'idb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { curatedArtifactCache } from '../../src/services/curated-artifact-cache.js';
import {
  loadCuratedNamespaceSource,
  linkDocument,
  parseWorkspaceViaRouter,
  resetCuratedDocumentCache,
  invalidateCuratedCacheRecovery,
  subscribeCuratedCacheRecovery,
  _resetParserWorkerForTests
} from '../../src/services/workspace.js';
import { deferredCuratedWorker } from '../setup/deferred-curated-worker.js';

const keyFor = (digest = 'a'.repeat(12), namespace = 'cached.example') =>
  JSON.stringify([
    'cdm',
    `https://www.daikonic.dev/curated/cdm/artifacts/2026-10-10-${digest}/ns/${namespace}.json.gz`
  ]);
const document = (key: string) => ({
  uri: 'cdm/example.rosetta',
  namespace: 'cached.example',
  bundleId: 'cdm',
  artifactKey: key,
  content: '',
  sourceLoaded: false,
  serializedModel: '{"$type":"RosettaModel"}',
  exports: []
});
const response = (key: string, documents: unknown[] = [], documentCount?: number) =>
  Response.json({
    ok: true,
    models: [],
    errors: {},
    deferredExports: [],
    hydrationState: { documents },
    requiredCuratedArtifacts: [{ key, bundleId: 'cdm', namespace: 'cached.example', documentCount }]
  });
const options = { curatedBundles: [{ id: 'cdm', version: 'latest' }], hydrateNamespaces: ['cached.example'] };
const knownKeys = (mock: ReturnType<typeof vi.fn>, call = 0): string[] =>
  JSON.parse(mock.mock.calls[call]![1].body).knownCuratedArtifacts;

beforeEach(async () => {
  _resetParserWorkerForTests();
  await curatedArtifactCache.close();
  await deleteDB('rune-curated-artifacts');
  resetCuratedDocumentCache();
});

afterEach(async () => {
  _resetParserWorkerForTests();
  resetCuratedDocumentCache();
  await curatedArtifactCache.close();
  vi.unstubAllGlobals();
});

it('coalesces concurrent deferred-link failures into one refetch and publishes the repaired workspace', async () => {
  const key = keyFor();
  await curatedArtifactCache.putDocuments(key, [{ ...document(key), serializedModel: '{broken' }]);
  const received = deferredCuratedWorker();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(key))
    .mockResolvedValueOnce(response(key, [document(key)]));
  vi.stubGlobal('fetch', fetch);
  const recovered = vi.fn();
  const unsubscribe = subscribeCuratedCacheRecovery(recovered);
  try {
    await parseWorkspaceViaRouter([], options);
    const links = await Promise.all([linkDocument(document(key).uri), linkDocument(document(key).uri)]);
    expect(links.every((result) => result.linked)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(knownKeys(fetch, 1)).toEqual([]);
    expect(received.filter((request) => request.type === 'hydrate')).toHaveLength(2);
    expect(recovered).toHaveBeenCalledTimes(1);
    expect(recovered.mock.calls[0]![0].curatedRefOnlyFiles.cdm[0].serializedModelJson).toBe(
      document(key).serializedModel
    );
    expect(await curatedArtifactCache.documents(key)).toEqual([document(key)]);
  } finally {
    unsubscribe();
  }
});

it('does not hydrate or publish an old workspace when it changes during a cache-recovery fetch', async () => {
  const key = keyFor();
  await curatedArtifactCache.putDocuments(key, [{ ...document(key), serializedModel: '{broken' }]);
  const received = deferredCuratedWorker();
  const pending = Promise.withResolvers<Response>();
  const fetch = vi.fn().mockResolvedValueOnce(response(key)).mockReturnValueOnce(pending.promise);
  vi.stubGlobal('fetch', fetch);
  const recovered = vi.fn();
  const unsubscribe = subscribeCuratedCacheRecovery(recovered);
  try {
    await parseWorkspaceViaRouter([], options);
    const linking = linkDocument(document(key).uri);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    resetCuratedDocumentCache();
    pending.resolve(response(key, [document(key)]));
    expect((await linking).linked).toBe(false);
    expect(received.filter((request) => request.type === 'hydrate')).toHaveLength(1);
    expect(recovered).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
  }
});

it('retains session artifacts and selected source when workspace recovery is invalidated', async () => {
  const key = keyFor();
  deferredCuratedWorker();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(key, [document(key)]))
    .mockResolvedValueOnce(
      Response.json({ artifactKey: key, documents: [{ uri: document(key).uri, content: 'original' }] })
    )
    .mockResolvedValueOnce(response(key));
  vi.stubGlobal('fetch', fetch);
  await parseWorkspaceViaRouter([], options);
  await loadCuratedNamespaceSource('cdm', 'latest', 'cached.example', key);
  const read = vi.spyOn(curatedArtifactCache, 'documents');
  try {
    invalidateCuratedCacheRecovery();
    const restored = await parseWorkspaceViaRouter([], options);
    expect(knownKeys(fetch, 2)).toEqual([key]);
    expect(read).not.toHaveBeenCalled();
    expect(restored.curatedRefOnlyFiles?.cdm?.[0]).toMatchObject({ content: 'original', sourceLoaded: true });
    expect((await linkDocument(document(key).uri)).linked).toBe(true);
  } finally {
    read.mockRestore();
  }
});

it('does not retry a deferred failure from freshly downloaded models as a cache failure', async () => {
  deferredCuratedWorker();
  const key = keyFor();
  const fetch = vi.fn().mockResolvedValue(response(key, [{ ...document(key), serializedModel: '{broken' }]));
  vi.stubGlobal('fetch', fetch);
  await parseWorkspaceViaRouter([], options);
  expect((await linkDocument(document(key).uri)).linked).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('advertises stored receipts after a tab-memory reset and reconstructs the required document set', async () => {
  const key = keyFor();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(key, [document(key)]))
    .mockResolvedValueOnce(response(key));
  vi.stubGlobal('fetch', fetch);
  await parseWorkspaceViaRouter([], options);
  resetCuratedDocumentCache();
  await curatedArtifactCache.close();

  const restored = await parseWorkspaceViaRouter([], options);

  expect(knownKeys(fetch, 0)).toEqual([]);
  expect(knownKeys(fetch, 1)).toEqual([key]);
  expect(restored.curatedRefOnlyFiles?.cdm?.[0]).toMatchObject({
    path: 'example.rosetta',
    namespace: 'cached.example',
    serializedModelJson: document(key).serializedModel
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('reads only the closure required by the current response and retains unrelated receipts', async () => {
  const key = keyFor();
  const unrelated = keyFor('b'.repeat(12), 'unrelated');
  await curatedArtifactCache.putDocuments(unrelated, [{ ...document(unrelated), uri: 'cdm/unrelated.rosetta' }]);
  await curatedArtifactCache.putDocuments(key, [document(key)]);
  const read = vi.spyOn(curatedArtifactCache, 'documents');
  const fetch = vi.fn().mockResolvedValue(response(key));
  vi.stubGlobal('fetch', fetch);
  await parseWorkspaceViaRouter([], options);
  expect(knownKeys(fetch)).toEqual([key, unrelated].sort());
  expect(read.mock.calls).toEqual([[key]]);
  read.mockRestore();
});

it('uses new manifest artifact identities without mixing an older namespace generation', async () => {
  const oldKey = keyFor();
  const currentKey = keyFor('b'.repeat(12));
  await curatedArtifactCache.putDocuments(oldKey, [{ ...document(oldKey), uri: 'cdm/old.rosetta' }]);
  const fetch = vi.fn().mockResolvedValue(response(currentKey, [document(currentKey)]));
  vi.stubGlobal('fetch', fetch);
  const result = await parseWorkspaceViaRouter([], options);
  expect(knownKeys(fetch)).toEqual([oldKey]);
  expect(result.curatedRefOnlyFiles?.cdm?.map((file) => file.path)).toEqual(['example.rosetta']);
  expect(await curatedArtifactCache.documentKeys()).toEqual([oldKey, currentKey].sort());
});

it('does not populate a blank workspace from previously cached namespaces', async () => {
  const key = keyFor();
  await curatedArtifactCache.putDocuments(key, [document(key)]);
  const readIndex = vi.spyOn(curatedArtifactCache, 'documentKeys');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() =>
      Promise.resolve(
        Response.json({
          ok: true,
          models: [],
          errors: {},
          deferredExports: [],
          hydrationState: { documents: [] },
          requiredCuratedArtifacts: []
        })
      )
    )
  );
  const result = await parseWorkspaceViaRouter([]);
  expect(result.models).toEqual([]);
  expect(result.curatedRefOnlyFiles).toEqual({});
  expect(readIndex).not.toHaveBeenCalled();
  readIndex.mockRestore();
});

it('fetches the full response when an advertised payload was evicted or corrupted', async () => {
  const key = keyFor();
  await curatedArtifactCache.putDocuments(key, [document(key)]);
  const db = await openDB('rune-curated-artifacts', 1);
  await db.delete('payloads', JSON.stringify(['documents', key]));
  db.close();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(key))
    .mockResolvedValueOnce(response(key, [document(key)]));
  vi.stubGlobal('fetch', fetch);
  const result = await parseWorkspaceViaRouter([], options);
  expect(knownKeys(fetch, 0)).toEqual([key]);
  expect(knownKeys(fetch, 1)).toEqual([]);
  expect(result.curatedRefOnlyFiles?.cdm?.[0]?.path).toBe('example.rosetta');
});

it('persists intentionally empty artifacts across memory resets', async () => {
  const key = keyFor();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(key, [], 0))
    .mockResolvedValueOnce(response(key, [], 0));
  vi.stubGlobal('fetch', fetch);
  await parseWorkspaceViaRouter([], options);
  resetCuratedDocumentCache();
  await parseWorkspaceViaRouter([], options);
  expect(knownKeys(fetch, 1)).toEqual([key]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('restores source only when its exact artifact is selected, without another source request', async () => {
  const key = keyFor();
  const sources = [{ uri: document(key).uri, content: '// retained\nnamespace cached.example\n' }];
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ artifactKey: key, documents: sources }));
  vi.stubGlobal('fetch', fetch);
  await loadCuratedNamespaceSource('cdm', 'latest', 'cached.example', key);
  resetCuratedDocumentCache();
  expect(await loadCuratedNamespaceSource('cdm', 'latest', 'cached.example', key)).toEqual({
    artifactKey: key,
    documents: sources
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps restored source visible when cached models are reparsed', async () => {
  const key = keyFor();
  const sources = [{ uri: document(key).uri, content: '// retained source\n' }];
  await curatedArtifactCache.putDocuments(key, [document(key)]);
  await curatedArtifactCache.putSource(key, sources);
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(response(key)));
  vi.stubGlobal('fetch', fetch);
  const initial = await parseWorkspaceViaRouter([], options);
  expect(initial.curatedRefOnlyFiles?.cdm?.[0]).toMatchObject({ content: '', sourceLoaded: false });
  await loadCuratedNamespaceSource('cdm', 'latest', 'cached.example', key);
  const reparse = await parseWorkspaceViaRouter([], options);
  expect(reparse.curatedRefOnlyFiles?.cdm?.[0]).toMatchObject({ content: sources[0]!.content, sourceLoaded: true });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('evicts restored models rejected by the worker and retries once through the normal server path', async () => {
  const key = keyFor();
  await curatedArtifactCache.putDocuments(key, [{ ...document(key), serializedModel: 'poisoned model' }]);
  const received: HydrateRequest[] = [];
  class HydrationWorker extends EventTarget {
    postMessage(request: HydrateRequest) {
      received.push(request);
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'hydrateResult',
              id: request.id,
              ok: request.documents.every((doc) => doc.serializedModel !== 'poisoned model'),
              error: 'invalid cached model'
            }
          })
        )
      );
    }
    terminate() {}
  }
  vi.stubGlobal('Worker', HydrationWorker);
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(key))
    .mockResolvedValueOnce(response(key, [document(key)]));
  vi.stubGlobal('fetch', fetch);
  expect((await parseWorkspaceViaRouter([], options)).curatedRefOnlyFiles?.cdm?.[0]?.path).toBe('example.rosetta');
  expect(knownKeys(fetch, 1)).toEqual([]);
  expect(received).toHaveLength(2);
  expect(await curatedArtifactCache.documents(key)).toEqual([document(key)]);
});
