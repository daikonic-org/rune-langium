// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect, vi, afterEach } from 'vitest';
import { onRequestPost } from '../api/parse.js';

function makeRequest(body: unknown): Request {
  return new Request('http://example.com/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

const SIMPLE_RUNE = 'namespace x\ntype T:\n  a string (1..1)\n';

// Restore ALL spies after each test so the fetchCuratedManifest / fetchCuratedBundle
// spies (and any globalThis.fetch overrides) don't leak across tests.
afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/parse', () => {
  it('returns 400 for malformed JSON', async () => {
    const req = new Request('http://example.com/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json'
    });
    const res = await onRequestPost({ request: req } as never);
    expect(res.status).toBe(400);
  });

  it('returns 400 when files is not an array', async () => {
    const res = await onRequestPost({ request: makeRequest({}) } as never);
    expect(res.status).toBe(400);
  });

  it('returns 200 with empty hydrationState when files [] + no curatedBundles', async () => {
    // The studio calls /api/parse on every debounced edit, including before
    // any user file exists in a freshly-opened workspace. Returning 400 here
    // forces the client to special-case empty input; 200-with-empty-state
    // keeps the parse pipeline uniform.
    const res = await onRequestPost({ request: makeRequest({ files: [] }) } as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; hydrationState: { documents: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.hydrationState.documents).toEqual([]);
  });

  it('returns 200 with ParseResponse shape on success', async () => {
    const res = await onRequestPost({
      request: makeRequest({ files: [{ name: 'x.rune', content: SIMPLE_RUNE }] })
    } as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      models: unknown[];
      // parsedModels is intentionally absent from the server response —
      // Langium ASTs have circular $container refs and cannot be JSON-serialized.
      // Task 0.5 rebuilds any model list client-side from hydrationState.documents.
      parsedModels?: undefined;
      deferredExports: unknown[];
      errors: Record<string, string[]>;
      hydrationState: {
        documents: Array<{
          uri: string;
          content: string;
          serializedModel: string;
          exports: Array<{ type: string; name: string; path: string }>;
        }>;
      };
    };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.parsedModels).toBeUndefined();
    expect(body.hydrationState).toBeDefined();
    expect(Array.isArray(body.hydrationState.documents)).toBe(true);
    expect(body.hydrationState.documents.length).toBeGreaterThan(0);
  });

  it('embeds exports inside each hydration document', async () => {
    const res = await onRequestPost({
      request: makeRequest({ files: [{ name: 'x.rune', content: SIMPLE_RUNE }] })
    } as never);
    const body = (await res.json()) as {
      hydrationState: { documents: Array<{ exports: Array<{ name: string; path: string }> }> };
    };
    const allExports = body.hydrationState.documents.flatMap((d) => d.exports);
    expect(allExports.some((e) => e.name === 'T')).toBe(true);
    expect(allExports.some((e) => e.path === 'x.T')).toBe(true);
  });

  it('stamps $namespace on each element in serializedModel for user files', async () => {
    const res = await onRequestPost({
      request: makeRequest({ files: [{ name: 'x.rune', content: SIMPLE_RUNE }] })
    } as never);
    const body = (await res.json()) as {
      hydrationState: { documents: Array<{ uri: string; serializedModel: string }> };
    };
    const doc = body.hydrationState.documents.find((d) => d.uri === 'x.rune');
    expect(doc).toBeDefined();
    const model = JSON.parse(doc!.serializedModel) as { elements?: Array<{ $namespace?: string }> };
    expect(Array.isArray(model.elements)).toBe(true);
    expect(model.elements!.every((el) => el.$namespace === 'x')).toBe(true);
  });

  it('returns errors field per filePath for parse failures', async () => {
    // 'namespace x\ntype Broken:' has a type declaration with no body.
    // Whether this produces a parser error depends on the Rune grammar; if the
    // empty-body case is accepted, fabricate a definitely-broken source instead.
    const broken = 'namespace x\ntype broken because (totally invalid syntax<<<';
    const res = await onRequestPost({
      request: makeRequest({ files: [{ name: 'broken.rune', content: broken }] })
    } as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { errors: Record<string, string[]> };
    expect(body.errors['broken.rune']).toBeDefined();
    expect(body.errors['broken.rune'].length).toBeGreaterThan(0);
  });
});

describe('POST /api/parse — curatedBundles', () => {
  it('advertises cohort-pinned background artifacts without loading their documents or user files', async () => {
    const module = await import('../../src/services/curated-fetch.js');
    const cohort = 'b'.repeat(64);
    const artifact = 'artifacts/2026-10-18-aaaaaaaaaaaa/ns/cdm.example.json.gz';
    vi.spyOn(module, 'fetchCuratedManifest').mockResolvedValue({
      modelId: 'cdm',
      version: '2026-10-18',
      cohort,
      namespaces: { 'cdm.example': { artifact, deps: [], exports: [{ name: 'Example', type: 'Data' }] } }
    } as never);
    const fetchNamespace = vi.spyOn(module, 'fetchCuratedNamespace');
    const response = await onRequestPost({
      request: makeRequest({ files: [], curatedBundles: [{ id: 'cdm', version: cohort }] })
    } as never);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      curatedCacheSeeds: unknown[];
      hydrationState: { documents: unknown[] };
      requiredCuratedArtifacts: unknown[];
    };
    expect(body.curatedCacheSeeds).toEqual([
      { key: JSON.stringify(['cdm', artifact]), bundleId: 'cdm', version: cohort, namespace: 'cdm.example' }
    ]);
    expect(body.hydrationState.documents).toEqual([]);
    expect(body.requiredCuratedArtifacts).toEqual([]);
    expect(fetchNamespace).not.toHaveBeenCalled();
  });

  it('accepts an empty curatedBundles array', async () => {
    const res = await onRequestPost({
      request: makeRequest({
        files: [{ name: 'x.rune', content: SIMPLE_RUNE }],
        curatedBundles: []
      })
    } as never);
    expect(res.status).toBe(200);
  });

  it('returns 502 with structured error when a curated bundle is unavailable', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
    try {
      const res = await onRequestPost({
        request: makeRequest({
          files: [{ name: 'x.rune', content: SIMPLE_RUNE }],
          curatedBundles: [{ id: 'cdm', version: 'latest' }]
        })
      } as never);
      expect(res.status).toBe(502);
      const body = (await res.json()) as { ok: boolean; error: string; bundleId?: string };
      expect(body.ok).toBe(false);
      expect(body.error).toMatch(/curated_bundle_unavailable/);
      expect(body.bundleId).toBe('cdm');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('merges curated bundle documents into hydrationState on success', async () => {
    // User file imports cdm.base.math → closure = {cdm.base.math}. Only that
    // namespace's artifact is fetched (manifest fast-path). No whole-bundle fetch.
    const curatedFetchModule = await import('../../src/services/curated-fetch.js');
    vi.spyOn(curatedFetchModule, 'fetchCuratedManifest').mockResolvedValue({
      schemaVersion: 2,
      modelId: 'cdm',
      version: '2026-05-01',
      sha256: 'a'.repeat(64),
      sizeBytes: 1,
      generatedAt: 'x',
      upstreamCommit: '',
      upstreamRef: 'master',
      archiveUrl: 'https://www.daikonic.dev/curated/cdm/latest.tar.gz',
      history: [],
      namespaces: {
        'cdm.base.math': {
          deps: [],
          exports: [{ type: 'Data', name: 'Quantity' }],
          artifact: 'artifacts/ns/cdm.base.math.json.gz'
        }
      }
    } as never);
    vi.spyOn(curatedFetchModule, 'fetchCuratedNamespace').mockResolvedValue([
      {
        uri: 'cdm/base/math.rosetta',
        content: '',
        serializedModel: JSON.stringify({
          $type: 'RosettaModel',
          name: 'cdm.base.math',
          elements: [{ $type: 'Data', name: 'Quantity' }]
        }),
        exports: [{ type: 'Data', name: 'Quantity', path: 'cdm.base.math.Quantity' }]
      }
    ]);
    const res = await onRequestPost({
      request: makeRequest({
        files: [{ name: 'x.rune', content: 'namespace x\nimport cdm.base.math\ntype T:\n  a string (1..1)\n' }],
        curatedBundles: [{ id: 'cdm', version: 'latest' }]
      })
    } as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      deferredExports: Array<{ filePath: string; namespace: string; exports: Array<{ name: string }> }>;
      hydrationState: { documents: Array<{ uri: string; exports: Array<{ name: string }> }> };
    };
    // hydrationState carries the documents themselves.
    const uris = body.hydrationState.documents.map((d) => d.uri);
    expect(uris).toContain('x.rune');
    expect(uris).toContain('cdm/base/math.rosetta');
    const corpusDoc = body.hydrationState.documents.find((d) => d.uri === 'cdm/base/math.rosetta');
    expect(corpusDoc?.exports.some((e) => e.name === 'Quantity')).toBe(true);

    // deferredExports must include the curated namespace too (Codex P2):
    // the namespace explorer / graph view reads from this response and
    // would otherwise miss curated entries.
    const namespaces = body.deferredExports.map((d) => d.namespace);
    expect(namespaces).toContain('cdm.base.math');
    const cdmEntry = body.deferredExports.find((d) => d.namespace === 'cdm.base.math');
    expect(cdmEntry?.filePath).toBe('cdm/base/math.rosetta');
    expect(cdmEntry?.exports.some((e) => e.name === 'Quantity')).toBe(true);
  });

  it('passes through $namespace baked into curated artifact elements', async () => {
    // $namespace is stamped at build time (scripts/build-serialized-artifacts.mjs),
    // not at runtime — the worker passes it through unchanged from the artifact.
    const curatedFetchModule = await import('../../src/services/curated-fetch.js');
    vi.spyOn(curatedFetchModule, 'fetchCuratedManifest').mockResolvedValue({
      schemaVersion: 2,
      modelId: 'cdm',
      version: '2026-05-01',
      sha256: 'a'.repeat(64),
      sizeBytes: 1,
      generatedAt: 'x',
      upstreamCommit: '',
      upstreamRef: 'master',
      archiveUrl: 'https://www.daikonic.dev/curated/cdm/latest.tar.gz',
      history: [],
      namespaces: {
        'cdm.base.math': {
          deps: [],
          exports: [{ type: 'Data', name: 'Quantity' }],
          artifact: 'artifacts/ns/cdm.base.math.json.gz'
        }
      }
    } as never);
    vi.spyOn(curatedFetchModule, 'fetchCuratedNamespace').mockResolvedValue([
      {
        uri: 'cdm/base/math.rosetta',
        content: '',
        serializedModel: JSON.stringify({
          $type: 'RosettaModel',
          name: 'cdm.base.math',
          elements: [{ $type: 'Data', name: 'Quantity', $namespace: 'cdm.base.math' }]
        }),
        exports: [{ type: 'Data', name: 'Quantity', path: 'cdm.base.math.Quantity' }]
      }
    ]);
    const res = await onRequestPost({
      request: makeRequest({
        files: [{ name: 'x.rune', content: 'namespace x\nimport cdm.base.math\ntype T:\n  a string (1..1)\n' }],
        curatedBundles: [{ id: 'cdm', version: 'latest' }]
      })
    } as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      hydrationState: { documents: Array<{ uri: string; serializedModel: string }> };
    };
    const doc = body.hydrationState.documents.find((d) => d.uri === 'cdm/base/math.rosetta');
    expect(doc).toBeDefined();
    const model = JSON.parse(doc!.serializedModel) as { elements?: Array<{ $namespace?: string }> };
    expect(Array.isArray(model.elements)).toBe(true);
    expect(model.elements!.every((el) => el.$namespace === 'cdm.base.math')).toBe(true);
  });

  it('emits one deferredExports entry per file when a namespace spans multiple files', async () => {
    // Regression for the "curated nodes show empty in Structure/Inspector" bug
    // (real-corpus repro on CDM): multiple .rosetta files can declare elements
    // in the same namespace (e.g. cdm.base.datetime is split across
    // -type.rosetta / -enum.rosetta / -func.rosetta). The original
    // mergeCuratedDocIntoDeferredExports collapsed per-namespace, so every
    // exported name in that namespace mapped to whichever file was iterated
    // first — and the studio's nodeIdToFilePath then called linkDocument with
    // the wrong file's URI, never materializing the right deferred AST.
    //
    // Contract: ONE deferredExports entry per FILE (matches the in-browser
    // parser-worker.handleParseWorkspace contract).
    const curatedFetchModule = await import('../../src/services/curated-fetch.js');
    vi.spyOn(curatedFetchModule, 'fetchCuratedManifest').mockResolvedValue({
      schemaVersion: 2,
      modelId: 'cdm',
      version: '2026-05-01',
      sha256: 'a'.repeat(64),
      sizeBytes: 1,
      generatedAt: 'x',
      upstreamCommit: '',
      upstreamRef: 'master',
      archiveUrl: 'https://www.daikonic.dev/curated/cdm/latest.tar.gz',
      history: [],
      namespaces: {
        'cdm.base.datetime': {
          deps: [],
          exports: [
            { type: 'Data', name: 'AdjustableDate' },
            { type: 'RosettaEnumeration', name: 'PeriodEnum' },
            { type: 'RosettaFunction', name: 'AddDays' }
          ],
          artifact: 'artifacts/ns/cdm.base.datetime.json.gz'
        }
      }
    } as never);
    // fetchCuratedNamespace returns the three files for the namespace artifact.
    vi.spyOn(curatedFetchModule, 'fetchCuratedNamespace').mockResolvedValue([
      {
        uri: 'cdm/base/datetime-type.rosetta',
        content: '',
        serializedModel: JSON.stringify({
          $type: 'RosettaModel',
          name: 'cdm.base.datetime',
          elements: [{ $type: 'Data', name: 'AdjustableDate' }]
        }),
        exports: [{ type: 'Data', name: 'AdjustableDate', path: 'cdm.base.datetime.AdjustableDate' }]
      },
      {
        uri: 'cdm/base/datetime-enum.rosetta',
        content: '',
        serializedModel: JSON.stringify({
          $type: 'RosettaModel',
          name: 'cdm.base.datetime',
          elements: [{ $type: 'RosettaEnumeration', name: 'PeriodEnum' }]
        }),
        exports: [{ type: 'RosettaEnumeration', name: 'PeriodEnum', path: 'cdm.base.datetime.PeriodEnum' }]
      },
      {
        uri: 'cdm/base/datetime-func.rosetta',
        content: '',
        serializedModel: JSON.stringify({
          $type: 'RosettaModel',
          name: 'cdm.base.datetime',
          elements: [{ $type: 'RosettaFunction', name: 'AddDays' }]
        }),
        exports: [{ type: 'RosettaFunction', name: 'AddDays', path: 'cdm.base.datetime.AddDays' }]
      }
    ]);
    // hydrateNamespaces forces cdm.base.datetime into the closure (no user imports).
    const res = await onRequestPost({
      request: makeRequest({
        files: [],
        curatedBundles: [{ id: 'cdm', version: 'latest' }],
        hydrateNamespaces: ['cdm.base.datetime']
      })
    } as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      deferredExports: Array<{ filePath: string; namespace: string; exports: Array<{ name: string }> }>;
    };

    // All three files must surface — namespace collapse would only yield 1.
    const datetimeEntries = body.deferredExports.filter((d) => d.namespace === 'cdm.base.datetime');
    expect(datetimeEntries).toHaveLength(3);

    // Each name must map to the file that DECLARES it. Critical: the
    // studio's nodeIdToFilePath uses these to drive linkDocument.
    const byName = new Map<string, string>();
    for (const entry of datetimeEntries) {
      for (const exp of entry.exports) byName.set(exp.name, entry.filePath);
    }
    expect(byName.get('AdjustableDate')).toBe('cdm/base/datetime-type.rosetta');
    expect(byName.get('PeriodEnum')).toBe('cdm/base/datetime-enum.rosetta');
    expect(byName.get('AddDays')).toBe('cdm/base/datetime-func.rosetta');
  });
});

describe('POST /api/parse — dependencyGraph (spec 2026-05-14 §5.2)', () => {
  it('returns an empty object on empty-workspace requests', async () => {
    const res = await onRequestPost({ request: makeRequest({ files: [] }) } as never);
    const body = (await res.json()) as { dependencyGraph: Record<string, string[]> };
    expect(body.dependencyGraph).toEqual({});
  });

  it('returns each namespace with at minimum itself in its closure', async () => {
    // Two user files in distinct namespaces with NO cross-namespace refs.
    // Each namespace's closure is just `[<self>]` — the walker still emits
    // a key per namespace so the modal can render them.
    const res = await onRequestPost({
      request: makeRequest({
        files: [
          { name: 'a.rune', content: 'namespace a\ntype A:\n  x string (1..1)\n' },
          { name: 'b.rune', content: 'namespace b\ntype B:\n  y int (1..1)\n' }
        ]
      })
    } as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dependencyGraph: Record<string, string[]> };
    expect(body.dependencyGraph.a).toEqual(['a']);
    expect(body.dependencyGraph.b).toEqual(['b']);
  });

  it('captures a cross-namespace attribute reference in the transitive closure', async () => {
    // namespace `app` declares Trade whose `quantity` attribute references
    // `cdm.Quantity` (cross-namespace). cdm has no further deps. Expected
    // closure: app → [app, cdm]; cdm → [cdm].
    const res = await onRequestPost({
      request: makeRequest({
        files: [
          { name: 'cdm.rune', content: 'namespace cdm\ntype Quantity:\n  value number (1..1)\n' },
          {
            name: 'app.rune',
            content: 'namespace app\nimport cdm.*\n\ntype Trade:\n  quantity Quantity (1..1)\n'
          }
        ]
      })
    } as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dependencyGraph: Record<string, string[]> };
    expect(body.dependencyGraph.app).toEqual(['app', 'cdm']);
    expect(body.dependencyGraph.cdm).toEqual(['cdm']);
  });

  it('user namespace surfaces in dep graph even when no curated seeds match', async () => {
    // User file with no imports → seeds set is empty → curated closure is
    // empty → fetchCuratedNamespace is never called. The manifest fast-path
    // still returns 200 and the user namespace appears in dependencyGraph.
    const curatedFetchModule = await import('../../src/services/curated-fetch.js');
    vi.spyOn(curatedFetchModule, 'fetchCuratedManifest').mockResolvedValue({
      schemaVersion: 2,
      modelId: 'cdm',
      version: '2026-05-01',
      sha256: 'a'.repeat(64),
      sizeBytes: 1,
      generatedAt: 'x',
      upstreamCommit: '',
      upstreamRef: 'master',
      archiveUrl: 'https://www.daikonic.dev/curated/cdm/latest.tar.gz',
      history: [],
      namespaces: {
        'cdm.math': {
          deps: [],
          exports: [{ type: 'Data', name: 'Quantity' }],
          artifact: 'artifacts/ns/cdm.math.json.gz'
        }
      }
    } as never);
    vi.spyOn(curatedFetchModule, 'fetchCuratedNamespace').mockResolvedValue([]);
    const res = await onRequestPost({
      request: makeRequest({
        files: [{ name: 'x.rune', content: 'namespace x\ntype T:\n  a string (1..1)\n' }],
        curatedBundles: [{ id: 'cdm', version: 'latest' }]
      })
    } as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dependencyGraph: Record<string, string[]> };
    // User namespace still surfaces; no curated closure → only 'x' in graph.
    expect(body.dependencyGraph.x).toEqual(['x']);
  });

  it('captures a user→user edge from a qualified ref with NO import declaration (Codex P2)', async () => {
    // `app` extends `lib.Base` by fully-qualified name and declares NO import.
    // The DSL resolves the ref via global scope, so the dep is real — but
    // import declarations alone would miss it. The dep graph must still pull
    // `lib` into `app`'s closure (else the Download modal would let codegen
    // emit `app` while excluding the required `lib` namespace → broken emit).
    const lib = 'namespace lib\ntype Base:\n  a string (1..1)\n';
    const app = 'namespace app\ntype Derived extends lib.Base:\n  b string (1..1)\n';
    const res = await onRequestPost({
      request: makeRequest({
        files: [
          { name: 'lib.rune', content: lib },
          { name: 'app.rune', content: app }
        ]
      })
    } as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dependencyGraph: Record<string, string[]> };
    expect(body.dependencyGraph.app).toEqual(['app', 'lib']);
    expect(body.dependencyGraph.lib).toEqual(['lib']);
  });
});
