// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it, vi } from 'vitest';
import { fetchCiGitHubSource } from './ci-github-source.js';

describe('CI public GitHub source transport', () => {
  it.each([
    ['POST', 'https://api.github.com/repos/finos/common-domain-model/git/blobs/abc'],
    ['GET', 'http://api.github.com/repos/finos/common-domain-model/git/blobs/abc'],
    ['GET', 'https://api.github.com.example/repos/finos/common-domain-model/git/blobs/abc'],
    ['GET', 'https://api.github.com/repos/finos/another-repository/git/blobs/abc'],
    ['GET', 'https://api.github.com/repos/finos/common-domain-model-other/git/blobs/abc']
  ])('does not authenticate %s %s', async (method, url) => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      await fetchCiGitHubSource({ method, url, headers: {} }, 'test-only-token', new AbortController().signal, fetcher)
    ).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('preserves GitHub failure responses, media type and cancellation without forwarding browser headers', async () => {
    const response = new Response('upstream failure', { status: 403 });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    const signal = new AbortController().signal;
    const url = 'https://api.github.com/repos/finos/common-domain-model/git/blobs/abc';
    const result = await fetchCiGitHubSource(
      { method: 'GET', url, headers: { accept: 'application/vnd.github.raw+json', cookie: 'browser-only' } },
      'test-only-token',
      signal,
      fetcher
    );
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(new URL(url), {
      method: 'GET',
      redirect: 'error',
      signal,
      headers: { Accept: 'application/vnd.github.raw+json', Authorization: 'Bearer test-only-token' }
    });
    expect(result).toBe(response);
    expect(result?.status).toBe(403);
    expect(await result?.text()).toBe('upstream failure');
  });
});
