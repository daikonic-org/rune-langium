// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * T027 — curated-mirror read-side HTTP contract tests.
 * Validates the routes documented in contracts/curated-mirror-http.md
 * against the in-memory R2 mock from T026.
 */

import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { describe, it, expect, beforeEach } from 'vitest';
import { handleCuratedRead } from '../src/http.js';
import { createMockR2Bucket, type MockR2Bucket } from './setup/r2-mock.js';
import type { Env } from '../src/index.js';

let bucket: MockR2Bucket;
let env: Env;

beforeEach(async () => {
  bucket = createMockR2Bucket();
  env = {
    rune_curated_mirror: bucket as unknown as R2Bucket,
    CURATED_SOURCES: '[]',
    ALLOWED_ORIGIN: 'https://www.daikonic.dev',
    RETENTION: { ARCHIVES_PER_MODEL: '14' }
  };
});

async function get(path: string, headers?: HeadersInit): Promise<Response> {
  const req = new Request(`https://www.daikonic.dev${path}`, {
    method: 'GET',
    headers
  });
  return handleCuratedRead(req, env);
}

async function head(path: string): Promise<Response> {
  return handleCuratedRead(new Request(`https://www.daikonic.dev${path}`, { method: 'HEAD' }), env);
}

describe('handleCuratedRead — manifest.json (T027)', () => {
  it('returns 200 with the manifest body and Cache-Control', async () => {
    await bucket.put('curated/cdm/manifest.json', JSON.stringify({ schemaVersion: 1, modelId: 'cdm' }));
    const res = await get('/curated/cdm/manifest.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toMatch(/max-age=300/);
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://www.daikonic.dev');
    expect(res.headers.get('ETag')).toBeTruthy();
    const body = await res.json();
    expect((body as { modelId: string }).modelId).toBe('cdm');
  });

  it('returns 404 for an unknown modelId', async () => {
    const res = await get('/curated/notreal/manifest.json');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unknown_model_id');
  });

  it('returns 404 when modelId is known but the manifest is not in R2', async () => {
    const res = await get('/curated/cdm/manifest.json');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('archive_not_found');
  });
});

describe('handleCuratedRead — latest.tar.gz', () => {
  it('streams bytes with Content-Length and immutable cache headers', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await bucket.put('curated/cdm/latest.tar.gz', bytes);
    const res = await get('/curated/cdm/latest.tar.gz');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toMatch(/immutable/);
    expect(res.headers.get('Content-Type')).toMatch(/application\/gzip/);
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual([1, 2, 3, 4, 5]);
  });

  it('HEAD does not return a body but keeps Content-Type', async () => {
    await bucket.put('curated/cdm/latest.tar.gz', new Uint8Array(8));
    const res = await head('/curated/cdm/latest.tar.gz');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/application\/gzip/);
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBe(0);
  });
});

describe('handleCuratedRead — serialized workspace artifacts', () => {
  it('serves the latest serialized artifact with gzip content-type and short cache', async () => {
    const bytes = new Uint8Array([7, 8, 9]);
    await bucket.put('curated/cdm/latest.serialized.json.gz', bytes);
    const res = await get('/curated/cdm/latest.serialized.json.gz');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toMatch(/max-age=300/);
    expect(res.headers.get('Content-Type')).toMatch(/application\/gzip/);
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([7, 8, 9]);
  });

  it('serves a versioned serialized artifact with immutable cache headers', async () => {
    await bucket.put('curated/cdm/artifacts/2026-04-30.serialized.json.gz', new Uint8Array([1]));
    const res = await get('/curated/cdm/artifacts/2026-04-30.serialized.json.gz');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toMatch(/immutable/);
    expect(res.headers.get('Content-Type')).toMatch(/application\/gzip/);
  });

  it('serves a per-namespace artifact with immutable cache + gzip content-type', async () => {
    await bucket.put('curated/cdm/artifacts/2026-04-30/ns/cdm.base.json.gz', new Uint8Array([2]));
    const res = await get('/curated/cdm/artifacts/2026-04-30/ns/cdm.base.json.gz');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toMatch(/immutable/);
    expect(res.headers.get('Content-Type')).toMatch(/application\/gzip/);
  });
});

describe('handleCuratedRead — historical archives + method enforcement', () => {
  it('serves an archive at the date-stamped path', async () => {
    await bucket.put('curated/fpml/archives/2026-04-24.tar.gz', new Uint8Array([9]));
    const res = await get('/curated/fpml/archives/2026-04-24.tar.gz');
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(9);
  });

  it('rejects POST with 405', async () => {
    const res = await handleCuratedRead(
      new Request('https://www.daikonic.dev/curated/cdm/manifest.json', { method: 'POST' }),
      env
    );
    expect(res.status).toBe(405);
  });

  it('returns 404 for paths outside /curated/<model>/...', async () => {
    const res = await get('/curated/');
    expect(res.status).toBe(404);
  });
});

describe('CORS headers on every response', () => {
  it('attaches Access-Control-Allow-Origin to 404 archive_not_found', async () => {
    const res = await get('/curated/cdm/manifest.json');
    expect(res.status).toBe(404);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://www.daikonic.dev');
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('attaches Access-Control-Allow-Origin to 405 method_not_allowed', async () => {
    const res = await handleCuratedRead(
      new Request('https://www.daikonic.dev/curated/cdm/manifest.json', { method: 'POST' }),
      env
    );
    expect(res.status).toBe(405);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://www.daikonic.dev');
  });

  it('attaches Access-Control-Allow-Origin to 404 unknown_model_id', async () => {
    const res = await get('/curated/notreal/manifest.json');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://www.daikonic.dev');
  });
});

describe('configured Studio read origins', () => {
  beforeEach(() => {
    const config = readFileSync(new NodeURL('../wrangler.toml', import.meta.url), 'utf8');
    env.ALLOWED_ORIGIN = JSON.parse(config.match(/^ALLOWED_ORIGIN = (.+)$/m)![1]!);
  });

  it.each([
    'https://www.daikonic.dev',
    'https://daikonic-dev.pages.dev',
    'https://a123bc.daikonic-dev.pages.dev',
    'https://feature-review.daikonic-dev.pages.dev',
    'http://localhost:4321',
    'http://localhost:8788',
    ...Array.from({ length: 8 }, (_, i) => `http://localhost:${5173 + i}`)
  ])('allows %s for preflight, manifests, artifacts, and conditional responses', async (origin) => {
    await bucket.put('curated/cdm/manifest.json', '{}');
    await bucket.put('curated/cdm/artifacts/v1.serialized.json.gz', new Uint8Array([1]));
    for (const [method, path, headers] of [
      ['OPTIONS', '/curated/cdm/manifest.json', {}],
      ['GET', '/curated/cdm/manifest.json', {}],
      ['GET', '/curated/cdm/artifacts/v1.serialized.json.gz', {}],
      ['GET', '/curated/cdm/manifest.json', { 'If-None-Match': '*' }],
      ['GET', '/curated/cdm/artifacts/missing.serialized.json.gz', {}]
    ] as const) {
      const response = await handleCuratedRead(
        new Request(`https://www.daikonic.dev${path}`, {
          method,
          headers: { Origin: origin, ...headers }
        }),
        env
      );
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect(response.headers.get('Vary')).toBe('Origin');
    }
  });

  it.each([
    'https://unrelated.pages.dev',
    'https://attackerdaikonic-dev.pages.dev',
    'https://a.daikonic-dev.pages.dev.evil.example',
    'http://a.daikonic-dev.pages.dev',
    'http://localhost:5181'
  ])('does not grant %s read access', async (origin) => {
    const response = await get('/curated/cdm/manifest.json', { Origin: origin });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://www.daikonic.dev');
  });
});

describe('Conditional GET — If-None-Match → 304', () => {
  it('returns 304 with no body when the etag matches', async () => {
    await bucket.put('curated/cdm/manifest.json', JSON.stringify({ schemaVersion: 1, modelId: 'cdm' }));
    const first = await get('/curated/cdm/manifest.json');
    const etag = first.headers.get('ETag');
    expect(etag).toBeTruthy();

    const second = await get('/curated/cdm/manifest.json', { 'If-None-Match': etag! });
    expect(second.status).toBe(304);
    expect(second.headers.get('ETag')).toBe(etag);
    // 304 must include the Cache-Control header so caches can refresh staleness.
    expect(second.headers.get('Cache-Control')).toMatch(/max-age=300/);
    // No body on 304.
    const body = await second.arrayBuffer();
    expect(body.byteLength).toBe(0);
  });

  it('returns 200 with body when the If-None-Match etag differs', async () => {
    await bucket.put('curated/cdm/manifest.json', '{}');
    const res = await get('/curated/cdm/manifest.json', { 'If-None-Match': '"some-other-etag"' });
    expect(res.status).toBe(200);
  });

  it('respects If-None-Match: * as a wildcard', async () => {
    await bucket.put('curated/cdm/manifest.json', '{}');
    const res = await get('/curated/cdm/manifest.json', { 'If-None-Match': '*' });
    expect(res.status).toBe(304);
  });
});

describe('reference release catalogs', () => {
  it('serves a short-cached catalog independently of latest manifests', async () => {
    const catalog = { schemaVersion: 1, releases: [] };
    await bucket.put('releases/cdm.json', JSON.stringify(catalog));
    await bucket.put('curated/cdm/manifest.json', 'latest');
    const response = await get('/releases/cdm');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(catalog);
    expect(response.headers.get('Cache-Control')).toContain('max-age=300');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://www.daikonic.dev');
  });
  it('reports missing release catalogs without substituting latest', async () => {
    await bucket.put('curated/cdm/manifest.json', 'latest');
    const response = await get('/releases/cdm');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'release_catalog_unavailable' });
  });
});

it('preserves release catalog HEAD and conditional GET behavior', async () => {
  await bucket.put('releases/cdm.json', JSON.stringify({ schemaVersion: 1, releases: [] }));
  const response = await get('/releases/cdm');
  const etag = response.headers.get('ETag')!;
  const conditional = await get('/releases/cdm', { 'If-None-Match': etag });
  expect(conditional.status).toBe(304);
  expect(await conditional.text()).toBe('');
  const headers = await head('/releases/cdm');
  expect(headers.status).toBe(200);
  expect(await headers.text()).toBe('');
  expect(headers.headers.get('Content-Type')).toContain('application/json');
});
it('reports malformed release metadata as unavailable rather than streaming it', async () => {
  await bucket.put('releases/cdm.json', '{"schemaVersion":999}');
  const response = await get('/releases/cdm');
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: 'release_catalog_invalid' });
});
