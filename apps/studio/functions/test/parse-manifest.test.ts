// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Integration test: manifest fast-path (v2) — manifest required, no v1 fallback.
 *
 * Regression lock for the prod CF CPU-error 1102 fix AND the 128 MB-OOM 503
 * fix: /api/parse fetches ONLY the user's closure (never the whole bundle) and
 * derives the dependency graph from the precomputed manifest `deps` without
 * deserializing/linking any curated document. The v1 whole-bundle fallback is
 * removed: a missing or empty manifest returns 502 (no fall-through to a link).
 *
 * What this file proves:
 *   1. Manifest fast-path: fetchCuratedBundle is NEVER called; only closure
 *      namespace artifacts are fetched.
 *   2. Manifest required: an empty `namespaces` map or a manifest-fetch failure
 *      returns 502 (curated_manifest_missing / curated_bundle_unavailable).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequestPost } from '../api/parse.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): Request {
  return new Request('http://example.com/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

/**
 * Serialized RosettaModel string — same shape as parse-lazy-link.test.ts.
 */
function makeSM(name: string, importNs: string[] = []): string {
  return JSON.stringify({
    $type: 'RosettaModel',
    name,
    imports: importNs.map((ns) => ({ importedNamespace: ns })),
    elements: []
  });
}

// ---------------------------------------------------------------------------
// Manifest fixture (v2 with namespaces)
// ---------------------------------------------------------------------------

const VERSION = '2026-05-22';
const MANIFEST = {
  schemaVersion: 2,
  modelId: 'cdm',
  version: VERSION,
  sha256: 'a'.repeat(64),
  sizeBytes: 1,
  generatedAt: 'now',
  upstreamCommit: 'c',
  upstreamRef: 'r',
  archiveUrl: 'https://www.daikonic.dev/curated/cdm/latest.tar.gz',
  history: [],
  namespaces: {
    'cdm.trade': {
      deps: ['cdm.base.datetime'],
      exports: [{ type: 'Data', name: 'Trade' }],
      artifact: `artifacts/${VERSION}/ns/cdm.trade.json.gz`
    },
    'cdm.base.datetime': {
      deps: ['cdm.base.math'],
      exports: [{ type: 'Data', name: 'DateTime' }],
      artifact: `artifacts/${VERSION}/ns/cdm.base.datetime.json.gz`
    },
    'cdm.base.math': {
      deps: [],
      exports: [{ type: 'Data', name: 'Quantity' }],
      artifact: `artifacts/${VERSION}/ns/cdm.base.math.json.gz`
    },
    'cdm.other': {
      deps: [],
      exports: [{ type: 'Data', name: 'Unrelated' }],
      artifact: `artifacts/${VERSION}/ns/cdm.other.json.gz`
    }
  }
};

// ---------------------------------------------------------------------------
// Per-namespace document fixture — mirrors CURATED_DOCS from parse-lazy-link
// ---------------------------------------------------------------------------

const NS_DOCS: Record<
  string,
  Array<{
    uri: string;
    content: string;
    serializedModel: string;
    exports: Array<{ type: string; name: string; path: string }>;
  }>
> = {
  'cdm.trade': [
    {
      uri: 'cdm/trade/trade.rosetta',
      content: 'namespace cdm.trade\n',
      serializedModel: makeSM('cdm.trade', ['cdm.base.datetime']),
      exports: [{ type: 'Data', name: 'Trade', path: 'cdm.trade.Trade' }]
    }
  ],
  'cdm.base.datetime': [
    {
      uri: 'cdm/base/datetime.rosetta',
      content: '',
      serializedModel: makeSM('cdm.base.datetime', ['cdm.base.math']),
      exports: [{ type: 'Data', name: 'DateTime', path: 'cdm.base.datetime.DateTime' }]
    }
  ],
  'cdm.base.math': [
    {
      uri: 'cdm/base/math.rosetta',
      content: '',
      serializedModel: makeSM('cdm.base.math'),
      exports: [{ type: 'Data', name: 'Quantity', path: 'cdm.base.math.Quantity' }]
    }
  ],
  'cdm.other': [
    {
      uri: 'cdm/other/other.rosetta',
      content: '',
      serializedModel: makeSM('cdm.other'),
      exports: [{ type: 'Data', name: 'Unrelated', path: 'cdm.other.Unrelated' }]
    }
  ]
};

// ---------------------------------------------------------------------------
// Response type helpers
// ---------------------------------------------------------------------------

type ParseResponse = {
  ok: boolean;
  deferredExports: Array<{ filePath: string; namespace: string; exports: Array<{ name: string }> }>;
  hydrationState: {
    documents: Array<{
      uri: string;
      content: string;
      sourceLoaded?: boolean;
      serializedModel: string;
      exports: Array<{ name: string }>;
      artifactKey?: string;
    }>;
  };
  requiredCuratedArtifacts?: Array<{ key: string; bundleId: string; namespace: string }>;
  curatedBundleVersions?: Record<string, string>;
  dependencyGraph: Record<string, string[]>;
  errors: Record<string, string[]>;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/parse — manifest fast-path (v2), manifest required (no v1 fallback)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the immutable identities of implicit built-in dependencies', async () => {
    const cohort = `cohort-${'a'.repeat(64)}`;
    const mod = await import('../../src/services/curated-fetch.js');
    const cdm = {
      ...MANIFEST,
      cohort,
      dependencies: { 'rune-dsl': cohort },
      namespaces: {
        ...MANIFEST.namespaces,
        'cdm.base.math': { ...MANIFEST.namespaces['cdm.base.math'], deps: ['com.rosetta.model'] }
      }
    };
    const rune = {
      ...MANIFEST,
      modelId: 'rune-dsl',
      cohort,
      namespaces: {
        'com.rosetta.model': {
          deps: [],
          exports: [{ type: 'RosettaBasicType', name: 'string' }],
          artifact: `artifacts/${cohort}/ns/com.rosetta.model.json.gz`
        }
      }
    };
    vi.spyOn(mod, 'fetchCuratedManifest').mockImplementation(async (id) => (id === 'cdm' ? cdm : rune) as never);
    vi.spyOn(mod, 'fetchCuratedNamespace').mockImplementation(async (id) =>
      id === 'cdm'
        ? NS_DOCS['cdm.base.math']!
        : [
            {
              uri: 'rune-dsl/basictypes.rosetta',
              content: '',
              serializedModel: makeSM('com.rosetta.model'),
              exports: []
            }
          ]
    );
    const response = await onRequestPost({
      request: makeRequest({
        files: [],
        curatedBundles: [{ id: 'cdm', version: cohort }],
        hydrateNamespaces: ['cdm.base.math']
      })
    } as never);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ParseResponse;
    expect(body.curatedBundleVersions).toEqual({ cdm: cohort, 'rune-dsl': cohort });
    expect(body.hydrationState.documents.map((doc) => doc.uri)).toContain('rune-dsl/basictypes.rosetta');
  });

  it('Test 1 — manifest fast-path: only closure namespaces fetched; whole-bundle path never taken', async () => {
    const mod = await import('../../src/services/curated-fetch.js');

    vi.spyOn(mod, 'fetchCuratedManifest').mockResolvedValue(MANIFEST as never);

    vi.spyOn(mod, 'fetchCuratedNamespace').mockImplementation(async (_id, _v, artifactKey) => {
      const ns = Object.keys(NS_DOCS).find((n) => artifactKey.includes(`/ns/${n}.json.gz`));
      return ns ? NS_DOCS[ns] : [];
    });

    // DO NOT give bundleSpy a mock impl — we assert it is never called
    const bundleSpy = vi.spyOn(mod, 'fetchCuratedBundle');

    // User file imports cdm.trade → closure = {cdm.trade, cdm.base.datetime, cdm.base.math}
    const userContent = 'namespace app\nimport cdm.trade\n';
    const res = await onRequestPost({
      request: makeRequest({
        files: [{ name: 'app.rune', content: userContent }],
        curatedBundles: [{ id: 'cdm', version: 'latest' }]
      })
    } as never);

    expect(res.status).toBe(200);
    const body = (await res.json()) as ParseResponse;
    expect(body.ok).toBe(true);

    // ── CPU-fix lock: the whole-bundle path is NEVER taken ────────────────
    expect(bundleSpy).not.toHaveBeenCalled();

    // ── fetchCuratedNamespace called for closure namespaces only ─────────
    const nsCalls = (mod.fetchCuratedNamespace as ReturnType<typeof vi.spyOn>).mock.calls;
    const fetchedArtifacts = nsCalls.map((c: unknown[]) => c[2] as string);
    // These three MUST be fetched:
    expect(fetchedArtifacts.some((a: string) => a.includes('/ns/cdm.trade.json.gz'))).toBe(true);
    expect(fetchedArtifacts.some((a: string) => a.includes('/ns/cdm.base.datetime.json.gz'))).toBe(true);
    expect(fetchedArtifacts.some((a: string) => a.includes('/ns/cdm.base.math.json.gz'))).toBe(true);
    // cdm.other MUST NOT be fetched:
    expect(fetchedArtifacts.some((a: string) => a.includes('/ns/cdm.other.json.gz'))).toBe(false);

    // ── hydrationState: closure docs present; cdm.other absent ──────────
    const hydratedUris = body.hydrationState.documents.map((d) => d.uri);
    expect(hydratedUris).toContain('cdm/trade/trade.rosetta');
    expect(hydratedUris).toContain('cdm/base/datetime.rosetta');
    expect(hydratedUris).toContain('cdm/base/math.rosetta');
    expect(hydratedUris).not.toContain('cdm/other/other.rosetta');
    expect(body.hydrationState.documents.find((doc) => doc.uri === 'cdm/trade/trade.rosetta')).toMatchObject({
      content: '',
      sourceLoaded: false
    });

    // ── deferredExports: ALL four namespaces present (list-only for cdm.other) ──
    const deferredNs = body.deferredExports.map((d) => d.namespace);
    expect(deferredNs).toContain('cdm.trade');
    expect(deferredNs).toContain('cdm.base.datetime');
    expect(deferredNs).toContain('cdm.base.math');
    expect(deferredNs).toContain('cdm.other'); // list-only entry still present

    // ── dependencyGraph: transitive closures, manifest-derived (no link) ──
    expect(body.dependencyGraph['cdm.base.math']).toEqual(['cdm.base.math']);
    expect(body.dependencyGraph['cdm.base.datetime']).toEqual(['cdm.base.datetime', 'cdm.base.math'].sort());
    expect(body.dependencyGraph['cdm.trade']).toEqual(['cdm.base.datetime', 'cdm.base.math', 'cdm.trade'].sort());
    // app imports cdm.trade → its closure pulls the whole chain (import-based).
    expect(body.dependencyGraph['app']).toEqual(['app', 'cdm.base.datetime', 'cdm.base.math', 'cdm.trade'].sort());
    expect(body.dependencyGraph).not.toHaveProperty('cdm.other');
  });

  it('Test 1b — non-closure deferredExports filePath starts with bundle id, not "artifacts/"', async () => {
    const mod = await import('../../src/services/curated-fetch.js');

    vi.spyOn(mod, 'fetchCuratedManifest').mockResolvedValue(MANIFEST as never);

    vi.spyOn(mod, 'fetchCuratedNamespace').mockImplementation(async (_id, _v, artifactKey) => {
      const ns = Object.keys(NS_DOCS).find((n) => artifactKey.includes(`/ns/${n}.json.gz`));
      return ns ? NS_DOCS[ns] : [];
    });
    vi.spyOn(mod, 'fetchCuratedBundle');

    const userContent = 'namespace app\nimport cdm.trade\n';
    const res = await onRequestPost({
      request: makeRequest({
        files: [{ name: 'app.rune', content: userContent }],
        curatedBundles: [{ id: 'cdm', version: 'latest' }]
      })
    } as never);

    const body = (await res.json()) as ParseResponse;
    expect(body.ok).toBe(true);

    // cdm.other is the list-only (non-closure) namespace
    const otherEntry = body.deferredExports.find((d) => d.namespace === 'cdm.other');
    expect(otherEntry).toBeDefined();
    // Must start with bundle id "cdm/", NOT with "artifacts/"
    expect(otherEntry!.filePath.startsWith('cdm/')).toBe(true);
    expect(otherEntry!.filePath).toBe('cdm/cdm.other');
    expect(otherEntry!.filePath.startsWith('artifacts/')).toBe(false);
  });

  it('Test 3 — empty namespaces map returns 502 (manifest required, no v1 fallback)', async () => {
    const mod = await import('../../src/services/curated-fetch.js');
    vi.spyOn(mod, 'fetchCuratedManifest').mockResolvedValue({ ...MANIFEST, namespaces: {} } as never);
    const nsSpy = vi.spyOn(mod, 'fetchCuratedNamespace');

    const res = await onRequestPost({
      request: makeRequest({
        files: [{ name: 'app.rune', content: 'namespace app\nimport cdm.trade\n' }],
        curatedBundles: [{ id: 'cdm', version: 'latest' }]
      })
    } as never);

    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('curated_manifest_missing');
    expect(nsSpy).not.toHaveBeenCalled();
  });

  it('Test 3b — manifest fetch failure returns 502 (no whole-bundle fallback)', async () => {
    const mod = await import('../../src/services/curated-fetch.js');
    vi.spyOn(mod, 'fetchCuratedManifest').mockRejectedValue(
      new mod.CuratedBundleUnavailableError('cdm', 'latest', 503)
    );

    const res = await onRequestPost({
      request: makeRequest({
        files: [{ name: 'app.rune', content: 'namespace app\nimport cdm.trade\n' }],
        curatedBundles: [{ id: 'cdm', version: 'latest' }]
      })
    } as never);

    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('curated_bundle_unavailable');
  });

  it('Test 4a — non-array hydrateNamespaces (e.g. a string) does NOT 500 and is ignored', async () => {
    const mod = await import('../../src/services/curated-fetch.js');

    vi.spyOn(mod, 'fetchCuratedManifest').mockResolvedValue(MANIFEST as never);
    vi.spyOn(mod, 'fetchCuratedNamespace').mockResolvedValue([]);
    vi.spyOn(mod, 'fetchCuratedBundle');

    // Send hydrateNamespaces as a plain string instead of an array — the server
    // must not 500 and must not hydrate any extra namespaces.
    const res = await onRequestPost({
      request: makeRequest({
        files: [],
        curatedBundles: [{ id: 'cdm', version: VERSION }],
        hydrateNamespaces: 'cdm.base.math' as unknown as string[]
      })
    } as never);

    expect(res.status).toBe(200);
    const body = (await res.json()) as ParseResponse;
    expect(body.ok).toBe(true);
    // No namespaces should have been hydrated — the non-array value is ignored
    expect(body.hydrationState.documents).toHaveLength(0);
  });

  it('Test 4 — hydrateNamespaces unions on-demand namespaces into closure seeds', async () => {
    // cdm.other has no transitive deps and would NOT enter the closure via user
    // imports (there are none). Sending hydrateNamespaces: ['cdm.other'] is the
    // ONLY reason it should appear in hydrationState.documents.
    const mod = await import('../../src/services/curated-fetch.js');

    vi.spyOn(mod, 'fetchCuratedManifest').mockResolvedValue(MANIFEST as never);

    vi.spyOn(mod, 'fetchCuratedNamespace').mockImplementation(async (_id, _v, artifactKey) => {
      const ns = Object.keys(NS_DOCS).find((n) => artifactKey.includes(`/ns/${n}.json.gz`));
      return ns ? NS_DOCS[ns] : [];
    });

    // fetchCuratedBundle must never be called (v2 manifest fast-path)
    vi.spyOn(mod, 'fetchCuratedBundle');

    // No user files → no import-derived seeds. hydrateNamespaces is the only
    // reason cdm.other enters the closure.
    const res = await onRequestPost({
      request: makeRequest({
        files: [],
        curatedBundles: [{ id: 'cdm', version: VERSION }],
        hydrateNamespaces: ['cdm.other']
      })
    } as never);

    expect(res.status).toBe(200);
    const body = (await res.json()) as ParseResponse;
    expect(body.ok).toBe(true);

    // cdm.other's document must be hydrated (the on-demand namespace is present)
    const hydratedUris = body.hydrationState.documents.map((d) => d.uri);
    expect(hydratedUris).toContain('cdm/other/other.rosetta');

    // The other three namespaces must NOT be hydrated (not in hydrateNamespaces
    // and not reachable via cdm.other's deps — it has none)
    expect(hydratedUris).not.toContain('cdm/trade/trade.rosetta');
    expect(hydratedUris).not.toContain('cdm/base/datetime.rosetta');
    expect(hydratedUris).not.toContain('cdm/base/math.rosetta');
  });

  it('returns only unseen artifact JSON when the next namespace extends the closure', async () => {
    const mod = await import('../../src/services/curated-fetch.js');
    vi.spyOn(mod, 'fetchCuratedManifest').mockResolvedValue(MANIFEST as never);
    const namespaces = vi.spyOn(mod, 'fetchCuratedNamespace').mockImplementation(async (_id, _version, artifactKey) => {
      const ns = Object.keys(NS_DOCS).find((name) => artifactKey.includes(`/ns/${name}.json.gz`));
      return ns ? NS_DOCS[ns] : [];
    });
    const request = (hydrateNamespaces: string[], knownCuratedArtifacts: string[] = []) =>
      onRequestPost({
        request: makeRequest({
          files: [],
          curatedBundles: [{ id: 'cdm', version: VERSION }],
          hydrateNamespaces,
          knownCuratedArtifacts
        })
      } as never);

    const first = (await (await request(['cdm.base.math'])).json()) as ParseResponse;
    expect(first.curatedBundleVersions).toEqual({ cdm: VERSION });
    const mathKey = first.requiredCuratedArtifacts?.[0]?.key;
    expect(mathKey).toBe(JSON.stringify(['cdm', MANIFEST.namespaces['cdm.base.math'].artifact]));
    expect(first.hydrationState.documents.map(({ uri }) => uri)).toEqual(['cdm/base/math.rosetta']);

    namespaces.mockClear();
    const second = (await (await request(['cdm.base.math', 'cdm.trade'], [mathKey!])).json()) as ParseResponse;
    expect(namespaces.mock.calls.map(([, , artifact]) => artifact)).toEqual([
      MANIFEST.namespaces['cdm.trade'].artifact,
      MANIFEST.namespaces['cdm.base.datetime'].artifact
    ]);
    expect(second.hydrationState.documents.map(({ uri }) => uri)).toEqual([
      'cdm/trade/trade.rosetta',
      'cdm/base/datetime.rosetta'
    ]);
    expect(second.requiredCuratedArtifacts?.map(({ namespace }) => namespace)).toEqual([
      'cdm.base.math',
      'cdm.trade',
      'cdm.base.datetime'
    ]);
  });
});
