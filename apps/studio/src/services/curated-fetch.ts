// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Server-side curated bundle fetcher for the /api/parse Pages Function.
 *
 * Fetches the **pre-parsed** serialized workspace artifact published at
 * `${MIRROR}/{id}/latest.serialized.json.gz` and maps each entry to the
 * CuratedDocument shape consumed by /api/parse's response builder.
 *
 * History: the original implementation (PR #159) fetched the source
 * `archives/{version}.tar.gz` and re-parsed every file through Langium
 * services here in the Pages Function. That works for small bundles but
 * blows the 128 MiB per-invocation memory ceiling for CDM (53 MB
 * compressed → 500 MB+ uncompressed source → langium AST retention →
 * giant JSON.stringify of the response). The function would silently
 * return 502 with `Ok` in wrangler tail — the OOM happens after our
 * handler returns, during CF-side response serialization.
 *
 * The curated-mirror already produces a pre-parsed JSON artifact via the
 * `curated-artifacts.yml` CI workflow (the cron Worker can't build it
 * because IT also OOMs on CDM; CI runs with --max-old-space-size=4096).
 * The artifact is 4 MB compressed / 50 MB decompressed for CDM — well
 * inside the function memory budget — and contains per-document
 * `modelJson` strings + `exports` arrays. We just pass them through.
 *
 * apps/studio/src/services/curated-loader.ts already fetches the same
 * artifact for the in-browser path; this file is the server-side mirror
 * of that logic.
 */

import { inflate } from 'pako';
import { z } from 'zod';
import {
  CuratedSerializedWorkspaceArtifactSchema,
  CuratedSerializedDocumentSchema,
  CuratedCohortSchema,
  type CuratedSerializedDocument,
  type CuratedManifest,
  parseManifest
} from '@rune-langium/curated-schema';
import { withInstrumentation, Capture } from './instrumentation/core.js';
import { OperationTimeoutError, withAbortTimeout } from './with-abort-timeout.js';

const CURATED_MIRROR_BASE = 'https://www.daikonic.dev/curated';
export const CURATED_FETCH_TIMEOUT_MS = 12_000;

/**
 * Service-binding fetcher signature — `env.CURATED_MIRROR.fetch(...)` is
 * the exact `fetch`-compatible function CF provides for service bindings.
 * Production passes `env.CURATED_MIRROR.fetch.bind(env.CURATED_MIRROR)`;
 * tests / local dev can pass `globalThis.fetch` and the call hits the
 * curated-mirror via normal HTTP.
 */
export type CuratedFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface CuratedDocument {
  uri: string;
  content: string;
  serializedModel: string;
  exports: Array<{ type: string; name: string; path: string }>;
  /** Immutable manifest artifact identity, attached by the closure loader. */
  artifactKey?: string;
  namespace?: string;
}

export class CuratedBundleUnavailableError extends Error {
  constructor(
    public readonly bundleId: string,
    public readonly version: string,
    public readonly status?: number,
    public readonly cause?: unknown
  ) {
    super(`curated_bundle_unavailable: ${bundleId}@${version}${status ? ` (HTTP ${status})` : ''}`);
    this.name = 'CuratedBundleUnavailableError';
  }
}

/**
 * Per-isolate cache keyed by `${id}@${version}`. Cloudflare Pages Functions
 * reuse the same isolate across many requests; without a cache the
 * debounced editor reparse (every keystroke) would refetch + reinflate +
 * reparse the artifact, wasting CPU + bandwidth.
 *
 * We cache the Promise (not the resolved value) so concurrent requests
 * for the same bundle dedupe to a single fetch. On failure we evict the
 * entry so the next request retries.
 */
const bundleCache = new Map<string, Promise<CuratedDocument[]>>();

export const fetchCuratedBundle = withInstrumentation(
  async function fetchCuratedBundle(id: string, version: string, fetcher?: CuratedFetcher): Promise<CuratedDocument[]> {
    const cacheable = version !== 'latest';
    const cacheKey = `${id}@${version}`;
    if (cacheable) {
      const hit = bundleCache.get(cacheKey);
      if (hit) return hit;
    }

    // Default to globalThis.fetch for backwards compatibility with tests and
    // local dev. Production callers should pass env.CURATED_MIRROR.fetch to
    // bypass CF same-zone routing — a global fetch from a Pages Function to
    // its own zone (www.daikonic.dev/curated/...) gets a cf-worker header
    // that triggers loop prevention and returns 404 instead of reaching the
    // curated-mirror Worker.
    const fetchFn: CuratedFetcher = fetcher ?? ((url, init) => globalThis.fetch(url, init));

    const work = fetchSerializedArtifact(id, version, fetchFn);
    if (cacheable) {
      bundleCache.set(cacheKey, work);
      work.catch(() => {
        if (bundleCache.get(cacheKey) === work) bundleCache.delete(cacheKey);
      });
    }
    return work;
    // `id`/`version` are curated bundle identifiers (public, fixed vocabulary)
    // — safe. `fetcher` isn't capturable. Output documents carry raw
    // serializedModel AST text — only a count is captured.
  },
  {
    op: 'fetchCuratedBundle',
    capture: Capture.Input | Capture.Output,
    sanitize: (value, which) => {
      if (which === 'input') {
        const [id, version] = value as [string, string, unknown];
        return { id, version };
      }
      return { count: (value as unknown[]).length };
    }
  }
);

async function fetchSerializedArtifact(
  id: string,
  version: string,
  fetchFn: CuratedFetcher
): Promise<CuratedDocument[]> {
  // Only `latest.serialized.json.gz` is published; per-version artifacts
  // aren't generated by the CI workflow today. Versioned cache hits use
  // the same artifact (curated bundles are point-in-time-ish — the
  // version field on the request is informational, not authoritative).
  const url = `${CURATED_MIRROR_BASE}/${id}/latest.serialized.json.gz`;

  let res: Response;
  try {
    // Accept-Encoding: identity disables HTTP-level transport compression on
    // the subrequest. The artifact body is a gzip FILE (Content-Type:
    // application/gzip) that we inflate ourselves; if CF / the upstream
    // applied Content-Encoding: gzip on top of it, fetch() would
    // auto-decompress and our subsequent inflate() would fail on what
    // looks like JSON bytes. Pinning identity keeps the wire bytes raw.
    res = await fetchFn(url, { headers: { 'Accept-Encoding': 'identity' } });
  } catch (err) {
    // FETCH failed before getting a Response — typically network error,
    // CF same-zone loop detection, or a thrown TypeError. Surface to
    // wrangler tail with enough context to diagnose without a code change.
    console.error('curated-fetch fetch_failed', {
      bundleId: id,
      version,
      url,
      err: err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    });
    throw new CuratedBundleUnavailableError(id, version, undefined, err);
  }
  if (!res.ok) {
    console.error('curated-fetch non_ok_status', {
      bundleId: id,
      version,
      url,
      status: res.status,
      contentType: res.headers.get('content-type')
    });
    throw new CuratedBundleUnavailableError(id, version, res.status);
  }

  // Pull the body into a Uint8Array, inflate, decode, JSON.parse. Each
  // step's intermediate is dropped before the next allocation so peak
  // memory stays close to the largest single representation (~150 MB
  // for the parsed object tree on CDM — fits in the 128 MiB ceiling
  // because V8 doesn't reserve the entire heap upfront).
  const gzBuffer = new Uint8Array(await res.arrayBuffer());
  let jsonText: string;
  try {
    jsonText = new TextDecoder('utf-8').decode(inflate(gzBuffer));
  } catch (err) {
    console.error('curated-fetch inflate_failed', {
      bundleId: id,
      version,
      contentType: res.headers.get('content-type'),
      contentEncoding: res.headers.get('content-encoding'),
      bytesLength: gzBuffer.byteLength,
      firstBytes: Array.from(gzBuffer.slice(0, 8))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' '),
      err: err instanceof Error ? err.message : String(err)
    });
    throw new CuratedBundleUnavailableError(id, version, undefined, err);
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(jsonText);
  } catch (err) {
    console.error('curated-fetch json_parse_failed', {
      bundleId: id,
      version,
      jsonLength: jsonText.length,
      preview: jsonText.slice(0, 100),
      err: err instanceof Error ? err.message : String(err)
    });
    throw new CuratedBundleUnavailableError(id, version, undefined, err);
  }

  const parsed = CuratedSerializedWorkspaceArtifactSchema.safeParse(rawJson);
  if (!parsed.success) {
    console.error('curated-fetch schema_mismatch', {
      bundleId: id,
      version,
      error: parsed.error.message
    });
    throw new CuratedBundleUnavailableError(
      id,
      version,
      undefined,
      new Error(`artifact schema mismatch: ${parsed.error.message}`)
    );
  }

  return toDocuments(id, parsed.data);
}

function toDocuments(bundleId: string, artifact: { documents: CuratedSerializedDocument[] }): CuratedDocument[] {
  // Older artifacts may lack source text; preserve their hydration support.
  return artifact.documents.map((doc) => ({
    uri: `${bundleId}/${doc.path}`,
    content: doc.content ?? '',
    serializedModel: doc.modelJson,
    exports: doc.exports ?? []
  }));
}

// ---------------------------------------------------------------------------
// Per-namespace artifact schema — the per-ns file is `{ documents: [...] }`
// without the workspace-level wrapper fields (schemaVersion, kind, modelId…).
// ---------------------------------------------------------------------------
const NamespaceArtifactSchema = z.object({ documents: z.array(CuratedSerializedDocumentSchema) });

/**
 * Per-isolate cache for per-namespace artifacts, keyed by `${id}/${artifactKey}`.
 * Per-namespace artifact paths are versioned (e.g. `artifacts/2026-05-22/ns/cdm.base.json.gz`)
 * and therefore immutable — safe to cache for the isolate lifetime.
 * We cache the Promise (not the resolved value) so concurrent requests dedupe.
 * On failure we evict so the next request retries.
 */
const namespaceCache = new Map<string, Promise<CuratedDocument[]>>();

// Only exact cohort URLs are immutable. Bound retained manifests across releases;
// cache promises so concurrent parses share their fetch and validation too.
const manifestCache = new Map<string, Promise<CuratedManifest>>();
const MANIFEST_CACHE_LIMIT = 24;
const curatedStageTiming = {
  level: 'trace',
  capture: 0,
  sanitizeError: () => ({ signature: 'curated-stage-error' })
} as const;

export const fetchCuratedManifest = withInstrumentation(
  async function fetchCuratedManifest(id: string, version: string, fetcher?: CuratedFetcher): Promise<CuratedManifest> {
    const pinned = CuratedCohortSchema.safeParse(version).success;
    if (!pinned) return fetchManifestRemote(id, version, fetcher, pinned);
    const key = JSON.stringify([id, version]);
    const hit = manifestCache.get(key);
    if (hit) {
      manifestCache.delete(key);
      manifestCache.set(key, hit);
      return hit;
    }
    const work = fetchManifestRemote(id, version, fetcher, pinned);
    manifestCache.set(key, work);
    if (manifestCache.size > MANIFEST_CACHE_LIMIT) manifestCache.delete(manifestCache.keys().next().value!);
    work.catch(() => {
      if (manifestCache.get(key) === work) manifestCache.delete(key);
    });
    return work;
  },
  {
    op: 'fetchCuratedManifest',
    capture: Capture.Input | Capture.Output,
    sanitize: (value, which) => {
      if (which === 'input') {
        const [id, version] = value as [string, string, unknown];
        return { id, version };
      }
      return value;
    }
  }
);

const fetchManifestRemote = withInstrumentation(
  async function fetchManifestRemote(
    id: string,
    version: string,
    fetcher: CuratedFetcher | undefined,
    pinned: boolean
  ): Promise<CuratedManifest> {
    // Default to globalThis.fetch — same rationale as fetchCuratedBundle (CF
    // same-zone loop prevention; production callers pass env.CURATED_MIRROR.fetch).
    const fetchFn: CuratedFetcher = fetcher ?? ((url, init) => globalThis.fetch(url, init));
    const url = `${CURATED_MIRROR_BASE}/${id}/${pinned ? `artifacts/${version}/` : ''}manifest.json`;

    let res: Response;
    let data: unknown;
    try {
      ({ res, data } = await withAbortTimeout(async (signal) => {
        const response = await fetchFn(url, { signal });
        return { res: response, data: response.ok ? await response.json() : undefined };
      }, CURATED_FETCH_TIMEOUT_MS));
    } catch (err) {
      console.error(
        err instanceof SyntaxError ? 'curated-fetch manifest_json_parse_failed' : 'curated-fetch manifest_fetch_failed',
        {
          bundleId: id,
          version,
          url,
          err: err instanceof Error ? `${err.name}: ${err.message}` : String(err)
        }
      );
      throw new CuratedBundleUnavailableError(id, version, undefined, err);
    }
    if (!res.ok) {
      console.error('curated-fetch manifest_non_ok', {
        bundleId: id,
        version,
        url,
        status: res.status,
        contentType: res.headers.get('content-type')
      });
      throw new CuratedBundleUnavailableError(id, version, res.status);
    }

    const result = parseManifest(data);
    if (!result.ok) {
      console.error('curated-fetch manifest_schema_mismatch', {
        bundleId: id,
        version,
        reason: result.reason
      });
      throw new CuratedBundleUnavailableError(id, version, undefined, new Error(result.reason));
    }
    if (pinned && result.manifest.cohort !== version) {
      throw new CuratedBundleUnavailableError(id, version, undefined, new Error('Manifest cohort mismatch'));
    }
    return result.manifest;
  },
  { ...curatedStageTiming, op: 'fetchCuratedManifestRemote' }
);

export const fetchCuratedNamespace = withInstrumentation(
  async function fetchCuratedNamespace(
    id: string,
    version: string,
    artifactKey: string,
    fetcher?: CuratedFetcher,
    options: { retain?: boolean } = {}
  ): Promise<CuratedDocument[]> {
    const cacheable = options.retain !== false && !artifactKey.includes('latest');
    const cacheKey = `${id}/${artifactKey}`;
    if (cacheable) {
      const hit = namespaceCache.get(cacheKey);
      if (hit) return hit;
    }

    // Default to globalThis.fetch — same rationale as fetchCuratedBundle.
    const fetchFn: CuratedFetcher = fetcher ?? ((url, init) => globalThis.fetch(url, init));

    const work = fetchNamespaceArtifact(id, version, artifactKey, fetchFn);
    if (cacheable) {
      namespaceCache.set(cacheKey, work);
      work.catch(() => {
        if (namespaceCache.get(cacheKey) === work) namespaceCache.delete(cacheKey);
      });
    }
    return work;
    // Same rationale as fetchCuratedBundle above.
  },
  {
    op: 'fetchCuratedNamespace',
    capture: Capture.Input | Capture.Output,
    sanitize: (value, which) => {
      if (which === 'input') {
        const [id, version, artifactKey] = value as [string, string, string, unknown];
        return { id, version, artifactKey };
      }
      return { count: (value as unknown[]).length };
    }
  }
);

async function fetchNamespaceArtifact(
  id: string,
  version: string,
  artifactKey: string,
  fetchFn: CuratedFetcher
): Promise<CuratedDocument[]> {
  // The manifest's `namespaces[ns].artifact` is an absolute URL (consistent with
  // archiveUrl + serializedWorkspace.url). Use it as-is; fall back to prefixing the
  // mirror base for older v2 manifests that still carry a relative artifact path.
  //
  // SECURITY: an absolute URL must point at the trusted curated mirror. Without this
  // guard, a malformed/compromised manifest could make us fetch arbitrary hosts via
  // globalThis.fetch (local dev/tests). Reject any off-mirror absolute URL.
  let url: string;
  if (/^https?:\/\//.test(artifactKey)) {
    if (!artifactKey.startsWith(`${CURATED_MIRROR_BASE}/`)) {
      console.error('curated-fetch ns_artifact_off_mirror', { bundleId: id, version, artifactKey });
      throw new CuratedBundleUnavailableError(
        id,
        version,
        undefined,
        new Error(`artifact URL is not on the curated mirror: ${artifactKey}`)
      );
    }
    url = artifactKey;
  } else {
    url = `${CURATED_MIRROR_BASE}/${id}/${artifactKey}`;
  }

  let fetched: { res: Response; gzBuffer: Uint8Array } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fetched = await downloadCuratedNamespace(id, version, url, fetchFn);
      break;
    } catch (err) {
      if (err instanceof OperationTimeoutError && attempt === 0) continue;
      if (err instanceof CuratedBundleUnavailableError) throw err;
      console.error('curated-fetch fetch_failed', {
        bundleId: id,
        version,
        url,
        err: err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      });
      throw new CuratedBundleUnavailableError(id, version, undefined, err);
    }
  }
  if (!fetched) throw new CuratedBundleUnavailableError(id, version);
  return decodeCuratedNamespace(id, version, fetched.res, fetched.gzBuffer);
}

const downloadCuratedNamespace = withInstrumentation(
  async function downloadCuratedNamespace(id: string, version: string, url: string, fetchFn: CuratedFetcher) {
    return withAbortTimeout(async (signal) => {
      // Artifact bodies are gzip files; avoid a second transport encoding.
      const res = await fetchFn(url, { headers: { 'Accept-Encoding': 'identity' }, signal });
      if (!res.ok) {
        console.error('curated-fetch non_ok_status', {
          bundleId: id,
          version,
          url,
          status: res.status,
          contentType: res.headers.get('content-type')
        });
        throw new CuratedBundleUnavailableError(id, version, res.status);
      }
      return { res, gzBuffer: new Uint8Array(await res.arrayBuffer()) };
    }, CURATED_FETCH_TIMEOUT_MS);
  },
  { ...curatedStageTiming, op: 'downloadCuratedNamespace' }
);

const decodeCuratedNamespace = withInstrumentation(
  function decodeCuratedNamespace(id: string, version: string, res: Response, gzBuffer: Uint8Array): CuratedDocument[] {
    let jsonText: string;
    try {
      jsonText = new TextDecoder('utf-8').decode(inflate(gzBuffer));
    } catch (err) {
      console.error('curated-fetch inflate_failed', {
        bundleId: id,
        version,
        contentType: res.headers.get('content-type'),
        contentEncoding: res.headers.get('content-encoding'),
        bytesLength: gzBuffer.byteLength,
        firstBytes: Array.from(gzBuffer.slice(0, 8))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(' '),
        err: err instanceof Error ? err.message : String(err)
      });
      throw new CuratedBundleUnavailableError(id, version, undefined, err);
    }

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(jsonText);
    } catch (err) {
      console.error('curated-fetch json_parse_failed', {
        bundleId: id,
        version,
        jsonLength: jsonText.length,
        preview: jsonText.slice(0, 100),
        err: err instanceof Error ? err.message : String(err)
      });
      throw new CuratedBundleUnavailableError(id, version, undefined, err);
    }

    const parsed = NamespaceArtifactSchema.safeParse(rawJson);
    if (!parsed.success) {
      console.error('curated-fetch ns_schema_mismatch', {
        bundleId: id,
        version,
        error: parsed.error.message
      });
      throw new CuratedBundleUnavailableError(
        id,
        version,
        undefined,
        new Error(`namespace artifact schema mismatch: ${parsed.error.message}`)
      );
    }

    return toDocuments(id, parsed.data);
  },
  { ...curatedStageTiming, op: 'decodeCuratedNamespace' }
);
