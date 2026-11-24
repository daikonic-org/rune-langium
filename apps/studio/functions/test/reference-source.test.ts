// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors
import { afterEach, expect, it, vi } from 'vitest';
import { onRequestGet } from '../api/reference-source.js';

const query = `repository=finos%2Fcommon-domain-model&object=commits&sha=${'a'.repeat(40)}`;
function context(search = query) {
  return {
    request: new Request('https://www.daikonic.dev/api/reference-source?' + search),
    env: {},
    waitUntil: vi.fn()
  };
}
afterEach(() => vi.unstubAllGlobals());
it('caches successful public immutable reads and serves hits without GitHub', async () => {
  const put = vi.fn().mockResolvedValue(undefined);
  const match = vi.fn<(key: Request) => Promise<Response | undefined>>().mockResolvedValue(undefined);
  vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue({ match, put }) });
  const fetcher = vi.fn().mockResolvedValue(Response.json({ sha: 'a'.repeat(40) }));
  vi.stubGlobal('fetch', fetcher);
  const ctx = context();
  const result = await onRequestGet(ctx as never);
  expect(result.status).toBe(200);
  expect(result.headers.get('Cache-Control')).toContain('immutable');
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBeUndefined();
  expect(fetcher.mock.calls[0][1].redirect).toBe('manual');
  await Promise.all(ctx.waitUntil.mock.calls.map(([promise]) => promise));
  expect(put).toHaveBeenCalledOnce();
  const canonicalUrl = ctx.request.url;
  expect(put).toHaveBeenCalledWith(expect.objectContaining({ url: canonicalUrl }), expect.any(Response));
  match.mockResolvedValue(Response.json({ sha: 'a'.repeat(40) }));
  const reordered = new URLSearchParams(query);
  reordered.sort();
  await onRequestGet(context(reordered.toString()) as never);
  expect(match.mock.calls.map(([key]) => key.url)).toEqual([canonicalUrl, canonicalUrl]);
  expect(fetcher).toHaveBeenCalledOnce();
});
it('treats an unsuccessful edge cache response as a miss', async () => {
  const match = vi.fn().mockResolvedValue(new Response('error code: 502', { status: 502 }));
  vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue({ match, put: vi.fn().mockResolvedValue(undefined) }) });
  const upstream = { sha: 'a'.repeat(40) };
  const fetcher = vi.fn().mockResolvedValue(Response.json(upstream));
  vi.stubGlobal('fetch', fetcher);
  const response = await onRequestGet(context() as never);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(upstream);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(String(fetcher.mock.calls[0]![0])).toBe(
    `https://api.github.com/repos/finos/common-domain-model/commits/${upstream.sha}`
  );
});
it('retains quota recovery headers without caching failures or echoing upstream bodies', async () => {
  const put = vi.fn();
  vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue({ match: vi.fn().mockResolvedValue(undefined), put }) });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response('upstream request metadata', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1794923185' }
      })
    )
  );
  const result = await onRequestGet(context() as never);
  expect(result.status).toBe(403);
  expect(result.headers.get('x-ratelimit-remaining')).toBe('0');
  expect(result.headers.get('Cache-Control')).toBe('no-store');
  expect(await result.text()).not.toContain('upstream request metadata');
  expect(put).not.toHaveBeenCalled();
});
it('rejects GitHub redirects without following or caching them', async () => {
  const put = vi.fn();
  vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue({ match: vi.fn().mockResolvedValue(undefined), put }) });
  const fetcher = vi.fn().mockResolvedValue(Response.redirect('https://example.com/metadata', 301));
  vi.stubGlobal('fetch', fetcher);
  const result = await onRequestGet(context() as never);
  expect(result.status).toBe(502);
  expect(result.headers.get('Location')).toBeNull();
  expect(result.headers.get('Cache-Control')).toBe('no-store');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: 'manual' }));
  expect(put).not.toHaveBeenCalled();
});
it('rejects arbitrary repositories, moving refs and extra parameters before fetching', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  for (const search of [
    query.replace('finos', 'other'),
    query.replace('a'.repeat(40), 'master'),
    query + '&url=https://example.com'
  ]) {
    expect((await onRequestGet(context(search) as never)).status).toBe(400);
  }
  expect(fetcher).not.toHaveBeenCalled();
});
it('continues without a cache and reports transient upstream failure without persisting it', async () => {
  vi.stubGlobal('caches', { open: vi.fn().mockRejectedValue(new Error('cache unavailable')) });
  const fetcher = vi.fn().mockResolvedValue(Response.json({ sha: 'a'.repeat(40) }));
  vi.stubGlobal('fetch', fetcher);
  expect((await onRequestGet(context() as never)).status).toBe(200);
  fetcher.mockRejectedValue(new Error('upstream connection unavailable'));
  const response = await onRequestGet(context() as never);
  expect(response.status).toBe(502);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});
