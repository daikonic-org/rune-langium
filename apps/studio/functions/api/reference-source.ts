// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors
import { referenceSourceObject } from '../../src/services/reference-source.js';
import { withEdgeInstrumentation } from '../lib/instrumentation-sink.js';
import { withInstrumentation } from '../../src/services/instrumentation/core.js';

/** Cache public commit/tree reads without consuming each visitor's GitHub quota. */
export const serveReferenceSource = withInstrumentation(
  async function serveReferenceSource({
    request,
    waitUntil,
    cache,
    fetcher = fetch
  }: {
    request: Request;
    waitUntil(promise: Promise<unknown>): void;
    cache?: Cache;
    fetcher?: typeof fetch;
  }): Promise<Response> {
    if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
    const params = new URL(request.url).searchParams;
    const repository = params.get('repository');
    const object = params.get('object');
    const sha = params.get('sha');
    const url = new URL(`https://api.github.com/repos/${repository}/${object}/${sha}`);
    if (object === 'git/trees') url.search = '?recursive=1';
    if (!referenceSourceObject(url) || [...params.keys()].some((key) => !['repository', 'object', 'sha'].includes(key)))
      return Response.json({ error: 'Invalid public reference source object.' }, { status: 400 });
    const key = new Request(url);
    const cached = await cache?.match(key).catch(() => undefined);
    if (cached) return cached;
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Rune-Studio' },
        redirect: 'error',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)])
      });
    } catch (error) {
      if (request.signal.aborted) throw error;
      return Response.json(
        { error: 'Public reference metadata could not be loaded. Try again.' },
        { status: 502, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    for (const name of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after']) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!response.ok)
      return Response.json({ error: 'Public reference metadata unavailable.' }, { status: response.status, headers });
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    const result = new Response(response.body, { status: response.status, headers });
    if (cache) waitUntil(cache.put(key, result.clone()).catch(() => undefined));
    return result;
  },
  { op: 'serveReferenceSource', capture: 0 }
);

export const onRequestGet: PagesFunction = withEdgeInstrumentation(async ({ request, waitUntil }) => {
  const cache =
    typeof caches === 'undefined' ? undefined : await caches.open('rune-reference-source-v1').catch(() => undefined);
  return serveReferenceSource({ request, waitUntil, cache });
});
