// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';
import { loadCuratedDeclaration } from '../../src/services/curated-declaration.js';
import { declarationDocuments } from '../helpers/curated-declaration-fixture.js';

const mocks = vi.hoisted(() => ({
  documents: vi.fn(),
  seed: vi.fn(async () => true),
  fetch: vi.fn(),
  release: vi.fn()
}));
vi.mock('../../src/services/curated-artifact-cache.js', () => ({
  curatedArtifactCache: { documents: mocks.documents, seedDocuments: mocks.seed }
}));
vi.mock('../../src/services/curated-fetch.js', () => ({ fetchCuratedNamespace: mocks.fetch }));
vi.mock('../../src/services/curated-cache-client.js', () => ({
  curatedCacheClient: { foreground: () => mocks.release }
}));
vi.mock('../../src/services/workspace.js', () => ({
  inspectCuratedNamespace: async (documents: Array<{ uri: string; serializedModel: string }>) => {
    const { dispatchWorkerRequest } = await import('../../src/workers/parser-worker.js');
    const result = await dispatchWorkerRequest({ type: 'inspectNamespace', id: 'inspect', documents });
    if (result.type !== 'inspectNamespaceResult') throw new Error('Wrong response');
    if (result.error) throw new Error(result.error);
    return result.models;
  }
}));
const seed = {
  key: JSON.stringify(['cdm', 'artifacts/2026-10-18-aaaaaaaaaaaa/ns/example.selected.json.gz']),
  bundleId: 'cdm' as const,
  version: 'pinned',
  namespace: 'example.selected'
};
const id = 'example.selected.Selected#Data';
afterEach(() => vi.resetAllMocks());

it('uses the exact cached namespace and canonical adapter without a network request', async () => {
  const selected = (await declarationDocuments())[1]!;
  mocks.documents.mockResolvedValue([{ ...selected, artifactKey: seed.key }]);
  const node = await loadCuratedDeclaration(seed, id, new AbortController().signal);
  expect(node?.data).toMatchObject({ name: 'Selected', attributes: [{ name: 'own' }] });
  expect(mocks.documents).toHaveBeenCalledWith(seed.key);
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledOnce();
});

it.each(['missing', 'corrupt', 'wrong namespace'])(
  'refetches a %s receipt without claiming full hydration',
  async (state) => {
    const selected = (await declarationDocuments())[1]!;
    mocks.documents.mockResolvedValue(
      state === 'missing'
        ? undefined
        : [
            {
              ...selected,
              artifactKey: seed.key,
              ...(state === 'corrupt' ? { serializedModel: '{bad' } : { namespace: 'wrong.namespace' })
            }
          ]
    );
    mocks.fetch.mockResolvedValue([selected]);
    const node = await loadCuratedDeclaration(seed, id, new AbortController().signal);
    expect(node?.data).toMatchObject({ name: 'Selected', attributes: [{ name: 'own' }] });
    expect(mocks.fetch).toHaveBeenCalledWith(
      'cdm',
      'pinned',
      expect.stringContaining('aaaaaaaaaaaa/ns/'),
      expect.any(Function),
      { retain: false }
    );
    expect(mocks.seed).toHaveBeenCalledWith(seed.key, [
      expect.objectContaining({ artifactKey: seed.key, content: '', sourceLoaded: false })
    ]);
  }
);

it('does not fetch or write after cancellation during a cache read', async () => {
  const abort = new AbortController();
  mocks.documents.mockImplementation(async () => {
    abort.abort();
    return undefined;
  });
  await expect(loadCuratedDeclaration(seed, id, abort.signal)).rejects.toThrow();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.seed).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledOnce();
});

it('rejects mutable or off-mirror identities and does not publish a mismatched declaration', async () => {
  expect(
    await loadCuratedDeclaration({ ...seed, key: '["cdm","latest"]' }, id, new AbortController().signal)
  ).toBeUndefined();
  expect(mocks.documents).not.toHaveBeenCalled();
  mocks.documents.mockResolvedValue(undefined);
  mocks.fetch.mockResolvedValue([(await declarationDocuments())[0]!]);
  expect(await loadCuratedDeclaration(seed, id, new AbortController().signal)).toBeUndefined();
  expect(mocks.seed).not.toHaveBeenCalled();
});
