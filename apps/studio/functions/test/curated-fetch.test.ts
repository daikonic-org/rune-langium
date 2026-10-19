// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, describe, it, expect, vi } from 'vitest';
import { gzip } from 'pako';
import {
  fetchCuratedManifest,
  fetchCuratedNamespace,
  CURATED_FETCH_TIMEOUT_MS,
  CuratedBundleUnavailableError,
  type CuratedFetcher
} from '../../src/services/curated-fetch.js';
import {
  configureInstrumentation,
  resetInstrumentationForTests,
  type TelemetryRecord
} from '../../src/services/instrumentation/core.js';

afterEach(() => resetInstrumentationForTests());

const MIRROR = 'https://www.daikonic.dev/curated';

/** Minimal valid v2 manifest with a namespaces map. */
const VALID_MANIFEST = {
  schemaVersion: 2,
  modelId: 'cdm',
  version: '2026-05-22',
  sha256: 'a'.repeat(64),
  sizeBytes: 1,
  generatedAt: '2026-05-22T00:00:00Z',
  upstreamCommit: 'abc123',
  upstreamRef: 'master',
  archiveUrl: 'https://www.daikonic.dev/curated/cdm/latest.tar.gz',
  history: [],
  namespaces: {
    'cdm.base': {
      deps: [],
      exports: [{ type: 'Data', name: 'Foo' }],
      artifact: 'artifacts/2026-05-22/ns/cdm.base.json.gz'
    }
  }
};

// ---------------------------------------------------------------------------
// fetchCuratedManifest
// ---------------------------------------------------------------------------

describe('fetchCuratedManifest', () => {
  it('fetches an immutable cohort manifest and rejects a different cohort', async () => {
    const cohort = `cohort-${'b'.repeat(64)}`;
    const stub: CuratedFetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...VALID_MANIFEST, cohort })))
      .mockResolvedValueOnce(new Response(JSON.stringify(VALID_MANIFEST)));
    expect((await fetchCuratedManifest('cdm', cohort, stub)).cohort).toBe(cohort);
    expect(stub).toHaveBeenCalledWith(
      `${MIRROR}/cdm/artifacts/${cohort}/manifest.json`,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    await expect(fetchCuratedManifest('cdm', `cohort-${'c'.repeat(64)}`, stub)).rejects.toThrow(
      CuratedBundleUnavailableError
    );
  });

  it('deduplicates concurrent and repeated immutable manifest reads', async () => {
    const cohort = `cohort-${'d'.repeat(64)}`;
    const stub = vi.fn<CuratedFetcher>(async () => new Response(JSON.stringify({ ...VALID_MANIFEST, cohort })));
    const [first, second] = await Promise.all([
      fetchCuratedManifest('cdm', cohort, stub),
      fetchCuratedManifest('cdm', cohort, stub)
    ]);
    expect(second).toEqual(first);
    expect(await fetchCuratedManifest('cdm', cohort, stub)).toEqual(first);
    expect(stub).toHaveBeenCalledOnce();
  });

  it('always refreshes floating pointers, including date versions routed to latest', async () => {
    const stub = vi.fn<CuratedFetcher>(async () => new Response(JSON.stringify(VALID_MANIFEST)));
    await fetchCuratedManifest('cdm', 'latest', stub);
    await fetchCuratedManifest('cdm', 'latest', stub);
    await fetchCuratedManifest('cdm', '2026-05-22', stub);
    await fetchCuratedManifest('cdm', '2026-05-22', stub);
    expect(stub).toHaveBeenCalledTimes(4);
  });

  it('isolates immutable manifests by bundle and cohort', async () => {
    const stub = vi.fn<CuratedFetcher>(async (url) => {
      const parts = url.split('/');
      return new Response(JSON.stringify({ ...VALID_MANIFEST, modelId: parts.at(-4), cohort: parts.at(-2) }));
    });
    const a = `cohort-${'5'.repeat(64)}`;
    const b = `cohort-${'6'.repeat(64)}`;
    expect((await fetchCuratedManifest('cdm', a, stub)).modelId).toBe('cdm');
    expect((await fetchCuratedManifest('fpml', a, stub)).modelId).toBe('fpml');
    expect((await fetchCuratedManifest('cdm', b, stub)).cohort).toBe(b);
    await fetchCuratedManifest('cdm', a, stub);
    expect(stub).toHaveBeenCalledTimes(3);
  });

  it('bounds a stalled immutable read and permits a later retry', async () => {
    vi.useFakeTimers();
    const cohort = `cohort-${'7'.repeat(64)}`;
    const response = new Response('{}');
    vi.spyOn(response, 'json').mockImplementation(() => new Promise(() => {}));
    const stub = vi
      .fn<CuratedFetcher>()
      .mockResolvedValueOnce(response)
      .mockImplementation(async () => new Response(JSON.stringify({ ...VALID_MANIFEST, cohort })));
    try {
      const rejected = expect(fetchCuratedManifest('cdm', cohort, stub)).rejects.toThrow(CuratedBundleUnavailableError);
      await vi.advanceTimersByTimeAsync(CURATED_FETCH_TIMEOUT_MS);
      await rejected;
      expect((await fetchCuratedManifest('cdm', cohort, stub)).cohort).toBe(cohort);
      expect(stub).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['http', 'schema', 'cohort', 'network'] as const)(
    'evicts failed immutable %s reads for retry',
    async (failure) => {
      const cohort = `cohort-${{ http: '1', schema: '2', cohort: '3', network: '4' }[failure].repeat(64)}`;
      const stub = vi
        .fn<CuratedFetcher>()
        .mockImplementationOnce(async () => {
          if (failure === 'network') throw new Error('unavailable');
          if (failure === 'http') return new Response('', { status: 503 });
          return new Response(JSON.stringify(failure === 'schema' ? {} : VALID_MANIFEST));
        })
        .mockImplementation(async () => new Response(JSON.stringify({ ...VALID_MANIFEST, cohort })));
      await expect(fetchCuratedManifest('cdm', cohort, stub)).rejects.toThrow(CuratedBundleUnavailableError);
      expect((await fetchCuratedManifest('cdm', cohort, stub)).cohort).toBe(cohort);
      await fetchCuratedManifest('cdm', cohort, stub);
      expect(stub).toHaveBeenCalledTimes(2);
    }
  );

  it('bounds immutable manifest retention while refreshing recently used cohorts', async () => {
    const cohorts = Array.from({ length: 25 }, (_, i) => `cohort-f${i.toString(16).padStart(63, '0')}`);
    const stub = vi.fn<CuratedFetcher>(async (url) => {
      const cohort = url.split('/').at(-2);
      return new Response(JSON.stringify({ ...VALID_MANIFEST, cohort }));
    });
    for (const cohort of cohorts.slice(0, 24)) await fetchCuratedManifest('cdm', cohort!, stub);
    await fetchCuratedManifest('cdm', cohorts[0]!, stub);
    await fetchCuratedManifest('cdm', cohorts[24]!, stub);
    await fetchCuratedManifest('cdm', cohorts[0]!, stub);
    expect(stub).toHaveBeenCalledTimes(25);
    await fetchCuratedManifest('cdm', cohorts[1]!, stub);
    expect(stub).toHaveBeenCalledTimes(26);
  });

  it('does not let an evicted older failure delete a replacement entry', async () => {
    const cohort = `cohort-${'8'.repeat(64)}`;
    let reject!: (error: Error) => void;
    const old = new Promise<Response>((_resolve, fail) => {
      reject = fail;
    });
    const stub = vi
      .fn<CuratedFetcher>()
      .mockReturnValueOnce(old)
      .mockImplementation(
        async (url) => new Response(JSON.stringify({ ...VALID_MANIFEST, cohort: url.split('/').at(-2) }))
      );
    const rejected = expect(fetchCuratedManifest('cdm', cohort, stub)).rejects.toThrow(CuratedBundleUnavailableError);
    for (let i = 0; i < 24; i++) await fetchCuratedManifest('cdm', `cohort-e${i.toString(16).padStart(63, '0')}`, stub);
    await fetchCuratedManifest('cdm', cohort, stub);
    reject(new Error('older fetch failed'));
    await rejected;
    await fetchCuratedManifest('cdm', cohort, stub);
    expect(stub).toHaveBeenCalledTimes(26);
  });

  it('happy path: fetches and returns valid manifest', async () => {
    const stub: CuratedFetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(VALID_MANIFEST), { status: 200 }));

    const manifest = await fetchCuratedManifest('cdm', '2026-05-22', stub);

    expect(stub).toHaveBeenCalledOnce();
    expect(stub).toHaveBeenCalledWith(
      `${MIRROR}/cdm/manifest.json`,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.modelId).toBe('cdm');
    expect(manifest.namespaces?.['cdm.base']?.artifact).toBe('artifacts/2026-05-22/ns/cdm.base.json.gz');
  });

  it('bounds a stalled manifest body read', async () => {
    vi.useFakeTimers();
    const response = new Response(JSON.stringify(VALID_MANIFEST));
    vi.spyOn(response, 'json').mockImplementation(() => new Promise<unknown>(() => {}));
    const stub: CuratedFetcher = vi.fn().mockResolvedValue(response);

    try {
      const pending = fetchCuratedManifest('cdm', '2026-05-22', stub);
      const rejected = expect(pending).rejects.toThrow(CuratedBundleUnavailableError);
      await vi.advanceTimersByTimeAsync(CURATED_FETCH_TIMEOUT_MS);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it('non-200 status: rejects with CuratedBundleUnavailableError (status 404)', async () => {
    const stub: CuratedFetcher = vi.fn().mockResolvedValue(new Response('', { status: 404 }));

    await expect(fetchCuratedManifest('cdm', '2026-05-22', stub)).rejects.toThrow(CuratedBundleUnavailableError);

    const err = await fetchCuratedManifest('cdm', '2026-05-22', stub).catch((e) => e);
    expect(err).toBeInstanceOf(CuratedBundleUnavailableError);
    expect(err.status).toBe(404);
    expect(err.bundleId).toBe('cdm');
  });

  it('schema mismatch: rejects with CuratedBundleUnavailableError when schema invalid', async () => {
    const badManifest = { schemaVersion: 99, modelId: 'cdm' }; // invalid
    const stub: CuratedFetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(badManifest), { status: 200 }));

    await expect(fetchCuratedManifest('cdm', '2026-05-22', stub)).rejects.toThrow(CuratedBundleUnavailableError);
  });

  it('network error: fetch throw wrapped as CuratedBundleUnavailableError', async () => {
    const stub: CuratedFetcher = vi.fn().mockRejectedValue(new Error('boom'));

    const err = await fetchCuratedManifest('cdm', '2026-05-22', stub).catch((e) => e);
    expect(err).toBeInstanceOf(CuratedBundleUnavailableError);
    expect(err.bundleId).toBe('cdm');
  });

  it('malformed JSON body: rejects with CuratedBundleUnavailableError', async () => {
    const stub: CuratedFetcher = vi.fn().mockResolvedValue(new Response('not json{', { status: 200 }));

    const err = await fetchCuratedManifest('cdm', '2026-05-22', stub).catch((e) => e);
    expect(err).toBeInstanceOf(CuratedBundleUnavailableError);
    expect(err.bundleId).toBe('cdm');
  });
});

// ---------------------------------------------------------------------------
// fetchCuratedNamespace
// ---------------------------------------------------------------------------

/** Build a per-ns artifact payload and gzip it. */
function makeNsArtifact(
  docs: Array<{ path: string; modelJson: string; exports?: Array<{ type: string; name: string; path: string }> }>
) {
  const payload = { documents: docs };
  return gzip(JSON.stringify(payload));
}

describe('fetchCuratedNamespace', () => {
  it('emits payload-free remote/decode stages only for cache misses', async () => {
    const records: TelemetryRecord[] = [];
    configureInstrumentation((record) => records.push(record), undefined, {
      level: 'trace',
      operations: ['fetchCuratedManifestRemote', 'downloadCuratedNamespace', 'decodeCuratedNamespace']
    });
    const cohort = `cohort-${'9'.repeat(64)}`;
    const manifest = vi.fn<CuratedFetcher>(async () => new Response(JSON.stringify({ ...VALID_MANIFEST, cohort })));
    const namespace = vi.fn<CuratedFetcher>(
      async () => new Response(makeNsArtifact([{ path: 'private.rosetta', modelJson: 'private-model-text' }]))
    );
    await fetchCuratedManifest('cdm', cohort, manifest);
    await fetchCuratedManifest('cdm', cohort, manifest);
    const artifact = `artifacts/${cohort}/ns/diagnostic.json.gz`;
    await fetchCuratedNamespace('cdm', cohort, artifact, namespace);
    await fetchCuratedNamespace('cdm', cohort, artifact, namespace);
    expect(records.map(({ op }) => op)).toEqual([
      'fetchCuratedManifestRemote',
      'downloadCuratedNamespace',
      'decodeCuratedNamespace'
    ]);
    for (const record of records) {
      expect(record.durationMs).toBeGreaterThanOrEqual(0);
      expect(record.captured).toBe(0);
      expect(record).not.toHaveProperty('input');
      expect(record).not.toHaveProperty('output');
    }
    expect(JSON.stringify(records)).not.toContain('private-model-text');
  });
  it('bounds stalled artifact fetches and evicts a timed-out cache entry', async () => {
    vi.useFakeTimers();
    const gzBytes = makeNsArtifact([{ path: 'recovered.rosetta', modelJson: '{"$type":"RosettaModel"}' }]);
    const stalledResponse = new Response(gzBytes, { status: 200 });
    vi.spyOn(stalledResponse, 'arrayBuffer').mockImplementation(() => new Promise<ArrayBuffer>(() => {}));
    const stub: CuratedFetcher = vi
      .fn()
      .mockResolvedValueOnce(stalledResponse)
      .mockResolvedValueOnce(stalledResponse)
      .mockResolvedValue(new Response(gzBytes, { status: 200 }));
    const artifactKey = 'artifacts/2026-05-22/ns/cdm.timeout-eviction.json.gz';

    try {
      const stalled = fetchCuratedNamespace('cdm', '2026-05-22', artifactKey, stub);
      const rejected = expect(stalled).rejects.toThrow(CuratedBundleUnavailableError);
      await vi.advanceTimersByTimeAsync(CURATED_FETCH_TIMEOUT_MS * 2);
      await rejected;

      const recovered = await fetchCuratedNamespace('cdm', '2026-05-22', artifactKey, stub);
      expect(recovered[0]?.uri).toBe('cdm/recovered.rosetta');
      expect(stub).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('happy path: inflates and maps documents to CuratedDocument[]', async () => {
    const modelJson = '{"$type":"RosettaModel","name":"cdm.base"}';
    const gzBytes = makeNsArtifact([{ path: 'a/b.rosetta', modelJson, exports: [] }]);

    const artifactKey = 'artifacts/2026-05-22/ns/cdm.base.json.gz';
    const stub: CuratedFetcher = vi.fn().mockResolvedValue(new Response(gzBytes, { status: 200 }));

    const docs = await fetchCuratedNamespace('cdm', '2026-05-22', artifactKey, stub);

    expect(stub).toHaveBeenCalledOnce();
    expect(stub).toHaveBeenCalledWith(
      `${MIRROR}/cdm/${artifactKey}`,
      expect.objectContaining({ headers: expect.objectContaining({ 'Accept-Encoding': 'identity' }) })
    );
    expect(docs).toHaveLength(1);
    expect(docs[0].uri).toBe('cdm/a/b.rosetta');
    expect(docs[0].serializedModel).toBe(modelJson);
    expect(docs[0].content).toBe('');
    expect(docs[0].exports).toEqual([]);
  });

  it('absolute artifact URL is fetched as-is (not prefixed with the mirror base)', async () => {
    const modelJson = '{"$type":"RosettaModel","name":"cdm.abs"}';
    const gzBytes = makeNsArtifact([{ path: 'a/abs.rosetta', modelJson, exports: [] }]);
    // The manifest now carries absolute artifact URLs; the fetcher must use them
    // verbatim, NOT `${MIRROR}/cdm/${absoluteUrl}` (which would double-prefix → 404).
    const artifactKey = `${MIRROR}/cdm/artifacts/2026-05-23/ns/cdm.abs.json.gz`;
    const stub: CuratedFetcher = vi.fn().mockResolvedValue(new Response(gzBytes, { status: 200 }));

    const docs = await fetchCuratedNamespace('cdm', '2026-05-23', artifactKey, stub);

    expect(stub).toHaveBeenCalledOnce();
    expect(stub).toHaveBeenCalledWith(
      artifactKey,
      expect.objectContaining({ headers: expect.objectContaining({ 'Accept-Encoding': 'identity' }) })
    );
    expect(docs).toHaveLength(1);
    expect(docs[0].uri).toBe('cdm/a/abs.rosetta');
  });

  it('rejects an off-mirror absolute artifact URL without fetching it (SSRF guard)', async () => {
    const stub: CuratedFetcher = vi.fn();
    const evil = 'https://evil.example.com/artifacts/2026-05-23/ns/cdm.pwn.json.gz';

    const err = await fetchCuratedNamespace('cdm', '2026-05-23', evil, stub).catch((e) => e);

    expect(err).toBeInstanceOf(CuratedBundleUnavailableError);
    expect(stub).not.toHaveBeenCalled(); // never fetched the foreign host
  });

  it('non-200 status: rejects with CuratedBundleUnavailableError', async () => {
    // Use a distinct key so the namespace cache from the happy path test doesn't interfere.
    const artifactKey = 'artifacts/2026-05-22/ns/cdm.error-case.json.gz';
    const stub: CuratedFetcher = vi.fn().mockResolvedValue(new Response('', { status: 503 }));

    const err = await fetchCuratedNamespace('cdm', '2026-05-22', artifactKey, stub).catch((e) => e);
    expect(err).toBeInstanceOf(CuratedBundleUnavailableError);
    expect(err.status).toBe(503);
  });

  it('caching: versioned artifactKey fetched only once on concurrent calls', async () => {
    const modelJson = '{"$type":"RosettaModel","name":"cdm.base"}';
    const gzBytes = makeNsArtifact([{ path: 'x.rosetta', modelJson }]);

    const artifactKey = 'artifacts/2026-05-22/ns/cdm.base-cache.json.gz';
    let callCount = 0;
    const stub: CuratedFetcher = vi.fn().mockImplementation(async () => {
      callCount++;
      return new Response(gzBytes, { status: 200 });
    });

    // Call twice — should dedupe to one fetch
    const [a, b] = await Promise.all([
      fetchCuratedNamespace('cdm', '2026-05-22', artifactKey, stub),
      fetchCuratedNamespace('cdm', '2026-05-22', artifactKey, stub)
    ]);

    expect(callCount).toBe(1);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('exports default to [] when absent from document', async () => {
    const modelJson = '{"$type":"RosettaModel","name":"cdm.base"}';
    // no `exports` field on the doc
    const gzBytes = makeNsArtifact([{ path: 'no-exports.rosetta', modelJson }]);

    const artifactKey = 'artifacts/2026-05-22/ns/cdm.no-exports.json.gz';
    const stub: CuratedFetcher = vi.fn().mockResolvedValue(new Response(gzBytes, { status: 200 }));

    const docs = await fetchCuratedNamespace('cdm', '2026-05-22', artifactKey, stub);
    expect(docs[0].exports).toEqual([]);
  });
});
