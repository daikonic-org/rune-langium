// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors
import { expect, it, vi } from 'vitest';
import { createReferenceSourceFetch, referenceSourceObject } from '../../src/services/reference-source.js';

const commit = `https://api.github.com/repos/finos/common-domain-model/commits/${'a'.repeat(40)}`;
it('shares public immutable metadata and leaves payloads outside the proxy', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
  const fetcher = createReferenceSourceFetch(null, transport);
  const signal = new AbortController().signal;
  await fetcher(commit, { signal });
  expect(transport).toHaveBeenLastCalledWith(
    `/api/reference-source?repository=finos%2Fcommon-domain-model&object=commits&sha=${'a'.repeat(40)}`,
    { signal }
  );
  const raw = 'https://raw.githubusercontent.com/finos/common-domain-model/a/example.json';
  await fetcher(raw);
  expect(transport).toHaveBeenLastCalledWith(raw, undefined);
});
it('uses workspace authorization only for admitted GitHub objects', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
  const fetcher = createReferenceSourceFetch('test-credential', transport);
  await fetcher(commit, { headers: { Accept: 'application/json' } });
  const [, init] = transport.mock.calls[0]!;
  expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-credential');
  expect(new Headers(init?.headers).get('Accept')).toBe('application/json');
  await fetcher('https://example.com/file');
  expect(transport).toHaveBeenLastCalledWith('https://example.com/file', undefined);
});
it('refuses moving refs, unknown repositories, redirects and injected queries', () => {
  for (const url of [
    commit.replace('a'.repeat(40), 'master'),
    commit.replace('finos/', 'other/'),
    commit + '?x=1',
    commit + '#fragment',
    commit.replace('api.github.com', 'api.github.com.example')
  ])
    expect(referenceSourceObject(new URL(url))).toBeUndefined();
  expect(referenceSourceObject(new URL(commit.replace('/commits/', '/git/trees/') + '?recursive=1'))?.object).toBe(
    'git/trees'
  );
});
