// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PARSE_ROUTER_TIMEOUT_MS,
  parseWorkspaceViaRouter,
  parseWorkspaceFiles,
  resetCuratedDocumentCache,
  loadCuratedNamespaceSource
} from '../../src/services/workspace.js';
import type { WorkspaceFile } from '../../src/services/workspace.js';

describe('parseWorkspace routing', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    resetCuratedDocumentCache();
    vi.useRealTimers();
  });

  it('reuses a browser-held curated artifact while preserving the worker document set', async () => {
    const key = JSON.stringify(['cdm', 'cohort-1/cdm.base.math.json.gz']);
    const document = {
      uri: 'cdm/base/math.rosetta',
      content: 'namespace cdm.base.math\n',
      serializedModel: '{}',
      exports: [{ type: 'Data', name: 'Number', path: '/elements@0' }],
      bundleId: 'cdm',
      artifactKey: key,
      namespace: 'cdm.base.math'
    };
    const requiredCuratedArtifacts = [{ key, bundleId: 'cdm', namespace: 'cdm.base.math' }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            models: [],
            errors: {},
            dependencyGraph: {},
            deferredExports: [
              { filePath: document.uri, namespace: document.namespace, exports: [{ type: 'Data', name: 'Number' }] }
            ],
            hydrationState: { documents: [document] },
            requiredCuratedArtifacts,
            curatedBundleVersions: { cdm: 'cohort-1', 'rune-dsl': 'cohort-1' }
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            models: [],
            errors: {},
            dependencyGraph: {},
            deferredExports: [],
            hydrationState: { documents: [] },
            requiredCuratedArtifacts,
            curatedBundleVersions: { cdm: 'cohort-1', 'rune-dsl': 'cohort-1' }
          })
        )
      );
    global.fetch = fetchMock;
    const options = { curatedBundles: [{ id: 'cdm', version: 'cohort-1' }], hydrateNamespaces: ['cdm.base.math'] };

    await parseWorkspaceViaRouter([], options);
    const warm = await parseWorkspaceViaRouter([], options);

    const secondBody = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string) as {
      knownCuratedArtifacts: string[];
    };
    expect(secondBody.knownCuratedArtifacts).toContain(key);
    expect(warm.curatedRefOnlyFiles?.cdm?.[0]).toMatchObject({
      path: 'base/math.rosetta',
      content: document.content,
      namespace: document.namespace
    });
    expect(warm.deferredExports).toContainEqual({
      filePath: document.uri,
      namespace: document.namespace,
      exports: [{ type: 'Data', name: 'Number' }]
    });
    expect(warm.curatedBundleVersions).toEqual({ cdm: 'cohort-1', 'rune-dsl': 'cohort-1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends the full browser-held artifact list when a new namespace is selected', async () => {
    const firstKey = JSON.stringify(['cdm', 'artifacts/cohort-1/ns/cdm.first.json.gz']);
    const secondKey = JSON.stringify(['cdm', 'artifacts/cohort-1/ns/cdm.second.json.gz']);
    const first = { key: firstKey, bundleId: 'cdm', namespace: 'cdm.first' };
    const second = { key: secondKey, bundleId: 'cdm', namespace: 'cdm.second' };
    const doc = (artifact: typeof first, name: string) => ({
      uri: `cdm/${name}.rosetta`,
      content: '',
      sourceLoaded: false,
      serializedModel: '{}',
      exports: [],
      bundleId: 'cdm',
      artifactKey: artifact.key,
      namespace: artifact.namespace
    });
    const payload = (documents: unknown[], requiredCuratedArtifacts: unknown[]) =>
      new Response(
        JSON.stringify({
          ok: true,
          models: [],
          errors: {},
          deferredExports: [],
          dependencyGraph: {},
          hydrationState: { documents },
          requiredCuratedArtifacts
        })
      );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(payload([doc(first, 'first')], [first]))
      .mockResolvedValueOnce(payload([doc(second, 'second')], [second]))
      .mockResolvedValueOnce(payload([], [first, second]));
    global.fetch = fetchMock;
    const curatedBundles = [{ id: 'cdm', version: 'cohort-1' }];

    await parseWorkspaceViaRouter([], { curatedBundles, hydrateNamespaces: ['cdm.first'] });
    await parseWorkspaceViaRouter([], { curatedBundles, hydrateNamespaces: ['cdm.second'] });
    const combined = await parseWorkspaceViaRouter([], {
      curatedBundles,
      hydrateNamespaces: ['cdm.first', 'cdm.second']
    });

    const thirdBody = JSON.parse((fetchMock.mock.calls[2]![1] as RequestInit).body as string) as {
      knownCuratedArtifacts: string[];
    };
    expect(thirdBody.knownCuratedArtifacts).toEqual([firstKey, secondKey]);
    expect(combined.curatedRefOnlyFiles?.cdm?.map((file) => file.path)).toEqual(['first.rosetta', 'second.rosetta']);
  });

  it('remembers an intentionally empty artifact without retrying its JSON', async () => {
    const key = JSON.stringify(['cdm', 'artifacts/cohort-1/ns/cdm.empty.json.gz']);
    const response = new Response(
      JSON.stringify({
        ok: true,
        models: [],
        errors: {},
        deferredExports: [],
        dependencyGraph: {},
        hydrationState: { documents: [] },
        requiredCuratedArtifacts: [{ key, bundleId: 'cdm', namespace: 'cdm.empty', documentCount: 0 }]
      })
    );
    const fetchMock = vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(response.clone());
    global.fetch = fetchMock;
    const options = { curatedBundles: [{ id: 'cdm', version: 'cohort-1' }], hydrateNamespaces: ['cdm.empty'] };

    await parseWorkspaceViaRouter([], options);
    await parseWorkspaceViaRouter([], options);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string) as {
      knownCuratedArtifacts: string[];
    };
    expect(secondBody.knownCuratedArtifacts).toEqual([key]);
  });

  it('retries without browser receipts if the server requires an uncached artifact', async () => {
    const key = JSON.stringify(['cdm', 'cohort-2/cdm.base.math.json.gz']);
    const artifact = { key, bundleId: 'cdm', namespace: 'cdm.base.math', documentCount: 1 };
    const document = {
      uri: 'cdm/base/math.rosetta',
      content: 'namespace cdm.base.math\n',
      serializedModel: '{}',
      exports: [],
      bundleId: 'cdm',
      artifactKey: key,
      namespace: 'cdm.base.math'
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            models: [],
            errors: {},
            deferredExports: [],
            dependencyGraph: {},
            hydrationState: { documents: [] },
            requiredCuratedArtifacts: [artifact]
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            models: [],
            errors: {},
            deferredExports: [],
            dependencyGraph: {},
            hydrationState: { documents: [document] },
            requiredCuratedArtifacts: [artifact]
          })
        )
      );
    global.fetch = fetchMock;

    const result = await parseWorkspaceViaRouter([], {
      curatedBundles: [{ id: 'cdm', version: 'cohort-2' }],
      hydrateNamespaces: ['cdm.base.math']
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string) as {
      knownCuratedArtifacts: string[];
    };
    expect(retryBody.knownCuratedArtifacts).toEqual([]);
    expect(result.curatedRefOnlyFiles?.cdm?.[0]?.content).toBe(document.content);
  });

  it('loads selected source separately and reuses it with cached model JSON', async () => {
    const key = JSON.stringify(['cdm', 'artifacts/cohort-1/ns/cdm.base.math.json.gz']);
    const artifact = { key, bundleId: 'cdm', namespace: 'cdm.base.math' };
    const document = {
      uri: 'cdm/base/math.rosetta',
      content: '',
      sourceLoaded: false,
      serializedModel: '{}',
      exports: [],
      bundleId: 'cdm',
      artifactKey: key,
      namespace: 'cdm.base.math'
    };
    const source = 'namespace cdm.base.math\n';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            models: [],
            errors: {},
            deferredExports: [],
            dependencyGraph: {},
            hydrationState: { documents: [document] },
            requiredCuratedArtifacts: [artifact]
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            artifactKey: key,
            documents: [{ uri: document.uri, content: source }]
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            models: [],
            errors: {},
            deferredExports: [],
            dependencyGraph: {},
            hydrationState: { documents: [] },
            requiredCuratedArtifacts: [artifact]
          })
        )
      );
    global.fetch = fetchMock;
    const options = { curatedBundles: [{ id: 'cdm', version: 'latest' }], hydrateNamespaces: ['cdm.base.math'] };

    const first = await parseWorkspaceViaRouter([], options);
    expect(first.curatedRefOnlyFiles?.cdm?.[0]).toMatchObject({ content: '', sourceLoaded: false });
    expect(await loadCuratedNamespaceSource('cdm', 'latest', 'cdm.base.math', key)).toEqual({
      artifactKey: key,
      documents: [{ uri: document.uri, content: source }]
    });
    expect(await loadCuratedNamespaceSource('cdm', 'latest', 'cdm.base.math', key)).toEqual({
      artifactKey: key,
      documents: [{ uri: document.uri, content: source }]
    });
    const second = await parseWorkspaceViaRouter([], options);
    expect(second.curatedRefOnlyFiles?.cdm?.[0]).toMatchObject({ content: source, sourceLoaded: true });
    expect(fetchMock.mock.calls[1]![0] as string).toBe('/api/curated-source');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries a timed-out curated hydration request once', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
              once: true
            });
          })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, models: [], deferredExports: [], errors: {}, hydrationState: { documents: [] } })
        )
      );
    global.fetch = fetchMock;

    const parsed = parseWorkspaceViaRouter([], {
      hydrateNamespaces: ['cdm.base.math'],
      requireCuratedHydration: true
    });
    await vi.advanceTimersByTimeAsync(PARSE_ROUTER_TIMEOUT_MS);
    await expect(parsed).resolves.toMatchObject({ models: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a transient server error during curated hydration', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, models: [], deferredExports: [], errors: {}, hydrationState: { documents: [] } })
        )
      );
    global.fetch = fetchMock;

    await expect(
      parseWorkspaceViaRouter([], { hydrateNamespaces: ['cdm.base.math'], requireCuratedHydration: true })
    ).resolves.toMatchObject({ models: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('POSTs to /api/parse for parseWorkspace requests', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          models: [],
          deferredExports: [],
          errors: {},
          hydrationState: { documents: [] }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await parseWorkspaceViaRouter([{ name: 'x.rune', content: 'namespace x\ntype T:\n  a string (1..1)' }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/parse');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
  });

  it('includes curatedBundles in the POST body when provided', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          models: [],
          deferredExports: [],
          errors: {},
          hydrationState: { documents: [] }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await parseWorkspaceViaRouter([{ name: 'x.rune', content: 'namespace x\ntype T:\n  a string (1..1)' }], {
      curatedBundles: [{ id: 'cdm', version: '2026-04-25' }]
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as {
      curatedBundles: Array<{ id: string; version: string }>;
    };
    expect(body.curatedBundles).toEqual([{ id: 'cdm', version: '2026-04-25' }]);
  });

  it('throws on /api/parse 5xx so the caller can fall back with the FULL workspace', async () => {
    // Previously this called browserParseImpl(files) in place — but `files`
    // here only has user docs (curated entries are filtered out before this
    // call), so a transient 5xx silently dropped the corpus from the result.
    // The router now throws; parseWorkspaceFiles' outer catch handles the
    // fallback with the original WorkspaceFile[] (including curated).
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));

    await expect(
      parseWorkspaceViaRouter([{ name: 'x.rune', content: 'namespace x\ntype T:\n  a string (1..1)' }])
    ).rejects.toThrow(/api\/parse HTTP 503/);
  });

  it('throws when /api/parse fetch errors so the caller can fall back', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockRejectedValue(new TypeError('Network down'));

    await expect(
      parseWorkspaceViaRouter([{ name: 'x.rune', content: 'namespace x\ntype T:\n  a string (1..1)' }])
    ).rejects.toThrow(/Network down/);
  });

  it('deserializes hydration models so router result populates models[]', async () => {
    // Build a real serialized model using Langium's JsonSerializer so the
    // deserialization path in parseWorkspaceViaRouter has a valid fixture.
    // Use the .rosetta extension since that is the registered grammar extension.
    const { createRuneDslServices } = await import('@rune-langium/core');
    const { EmptyFileSystem, URI } = await import('langium');
    const services = createRuneDslServices(EmptyFileSystem).RuneDsl;
    const content = 'namespace x\ntype T:\n  a string (1..1)\n';
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse('file:///x.rosetta'));
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: false });
    const serializedModel = services.serializer.JsonSerializer.serialize(doc.parseResult.value);

    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          models: [],
          deferredExports: [],
          errors: {},
          hydrationState: {
            documents: [
              {
                uri: 'file:///x.rosetta',
                content,
                serializedModel,
                exports: [{ type: 'Data', name: 'T', path: 'x.T' }]
              }
            ]
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await parseWorkspaceViaRouter([{ name: 'x.rosetta', content }]);

    expect(result.models).toHaveLength(1);
    expect(result.parsedModels).toHaveLength(1);
    expect(result.parsedModels[0]!.filePath).toBe('x.rosetta');
  });
});

describe('parseWorkspaceFiles — curated bundle collection', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterEach(() => vi.restoreAllMocks());

  it('rejects failed curated hydration instead of accepting a user-only fallback', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('network unavailable'));
    const files: WorkspaceFile[] = [
      {
        name: 'user.rosetta',
        path: 'user.rosetta',
        content: 'namespace demo\ntype Foo:\n  bar string (1..1)',
        dirty: false
      }
    ];

    await expect(
      parseWorkspaceFiles(files, { hydrateNamespaces: ['cdm.base.math'], requireCuratedHydration: true })
    ).rejects.toThrow('network unavailable');
  });

  it('keeps browser fallback for edits that preserve hydrated namespaces', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 502 }));
    global.fetch = fetchMock;
    const files: WorkspaceFile[] = [
      {
        name: 'user.rosetta',
        path: 'user.rosetta',
        content: 'namespace demo\ntype Foo:\n  bar string (1..1)',
        dirty: true
      }
    ];

    const result = await parseWorkspaceFiles(files, { hydrateNamespaces: ['cdm.base.math'] });
    expect(result.parseMode).toBe('main-thread-fallback');
    expect(result.fallbackMessage).toContain('/api/parse HTTP 502');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends curatedBundles derived from bundleId/bundleVersion on WorkspaceFile', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          models: [],
          deferredExports: [],
          errors: {},
          hydrationState: { documents: [] }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    global.fetch = fetchMock;

    // Simulate a workspace with one user file + two curated corpus files (same bundle).
    const files: WorkspaceFile[] = [
      {
        name: 'user.rosetta',
        path: 'user.rosetta',
        content: 'namespace demo\ntype Foo:\n  bar string (1..1)',
        dirty: false
      },
      {
        name: 'Trade.rosetta',
        path: '[cdm]/types/Trade.rosetta',
        content: 'namespace cdm\ntype Trade:\n  id string (1..1)',
        dirty: false,
        readOnly: true,
        serializedModelJson: '{"$type":"RosettaModel","elements":[]}',
        bundleId: 'cdm',
        bundleVersion: '2026-04-25'
      },
      {
        name: 'Party.rosetta',
        path: '[cdm]/types/Party.rosetta',
        content: 'namespace cdm\ntype Party:\n  name string (1..1)',
        dirty: false,
        readOnly: true,
        serializedModelJson: '{"$type":"RosettaModel","elements":[]}',
        bundleId: 'cdm',
        bundleVersion: '2026-04-25'
      }
    ];

    const result = await parseWorkspaceFiles(files);

    // Router succeeded — parseMode should be 'router'.
    expect(result.parseMode).toBe('router');

    // fetch was called exactly once (the /api/parse POST).
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as {
      files: Array<{ name: string; content: string }>;
      curatedBundles: Array<{ id: string; version: string }>;
    };

    // Only the user file should be in `files` (corpus files are excluded).
    expect(body.files).toHaveLength(1);
    expect(body.files[0]!.name).toBe('user.rosetta');

    // Both corpus files share the same bundle — only one entry in curatedBundles.
    expect(body.curatedBundles).toHaveLength(1);
    expect(body.curatedBundles[0]).toEqual({ id: 'cdm', version: '2026-04-25' });
  });

  it('excludes list-only refOnly curated files (no serializedModelJson) from the POSTed user files', async () => {
    // Regression: the loaded-status fix registers list-only deferredExports
    // namespaces as refOnly files carrying bundleId but NO serializedModelJson.
    // The old `!serializedModelJson` filter let them through, POSTing bogus
    // files named `[cdm]/cdm.base.math` → /api/parse 500 ("no services for the
    // extension '.'"). They must be treated as bundle metadata, not user files.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, models: [], deferredExports: [], errors: {}, hydrationState: { documents: [] } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    global.fetch = fetchMock;

    const files: WorkspaceFile[] = [
      {
        name: 'user.rosetta',
        path: 'user.rosetta',
        content: 'namespace demo\ntype Foo:\n  bar string (1..1)',
        dirty: false
      },
      {
        name: '[cdm]/cdm.base.math',
        path: '[cdm]/cdm.base.math',
        content: '',
        dirty: false,
        refOnly: true,
        bundleId: 'cdm',
        bundleVersion: 'latest'
      }
    ];

    await parseWorkspaceFiles(files);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as {
      files: Array<{ name: string }>;
      curatedBundles: Array<{ id: string; version: string }>;
    };
    // The list-only file must NOT be sent as a user file…
    expect(body.files.map((f) => f.name)).toEqual(['user.rosetta']);
    // …but its bundle is still surfaced as metadata.
    expect(body.curatedBundles).toEqual([{ id: 'cdm', version: 'latest' }]);
  });

  it('sends an empty curatedBundles array when there are no curated files', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          models: [],
          deferredExports: [],
          errors: {},
          hydrationState: { documents: [] }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    global.fetch = fetchMock;

    const files: WorkspaceFile[] = [
      {
        name: 'solo.rosetta',
        path: 'solo.rosetta',
        content: 'namespace solo\ntype X:\n  a string (1..1)',
        dirty: false
      }
    ];

    await parseWorkspaceFiles(files);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as {
      curatedBundles: Array<{ id: string; version: string }>;
    };
    expect(body.curatedBundles).toEqual([]);
  });

  it('forwards hydrateNamespaces to /api/parse', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, models: [], errors: {}, hydrationState: { documents: [] }, deferredExports: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ) as Response
      );
    await parseWorkspaceFiles(
      [
        {
          name: 'app.rosetta',
          path: 'app.rosetta',
          content: 'namespace demo\ntype Foo:\n  bar string (1..1)',
          dirty: false
        }
      ] as Parameters<typeof parseWorkspaceFiles>[0],
      { hydrateNamespaces: ['cdm.base.math'] }
    );
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as {
      hydrateNamespaces: string[];
    };
    expect(body.hydrateNamespaces).toEqual(['cdm.base.math']);
  });

  it('falls back to main-thread when the router fetch fails', async () => {
    // Stub fetch to simulate a network failure. The router now throws on
    // fetch errors and parseWorkspaceFiles' outer catch routes to the
    // main-thread fallback with the full WorkspaceFile[].
    global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    const result = await parseWorkspaceFiles([
      {
        name: 'x.rosetta',
        path: 'x.rosetta',
        content: 'namespace x\ntype X:\n  a string (1..1)',
        dirty: false
      }
    ]);

    expect(result.parseMode).toBe('main-thread-fallback');
    expect(result.fallbackMessage).toContain('fetch failed');
  });
});
