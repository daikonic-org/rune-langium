// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors
import { CURATED_MODEL_REPOSITORIES } from '@rune-langium/curated-schema';
import { withInstrumentation } from './instrumentation/core.js';

/** Public immutable metadata only; never a general GitHub proxy. */
export const referenceSourceObject = withInstrumentation(
  function referenceSourceObject(url: URL): { repository: string; object: string; sha: string } | undefined {
    if (url.origin !== 'https://api.github.com' || url.username || url.password || url.hash) return;
    const match = /^\/repos\/([\w.-]+\/[\w.-]+)\/(commits|git\/trees)\/([a-f0-9]{40})$/.exec(url.pathname);
    if (!match) return;
    const [, repository, object, sha] = match;
    if (!repository || !object || !sha) return;
    if (!Object.values(CURATED_MODEL_REPOSITORIES).some((source) => source === `https://github.com/${repository}`))
      return;
    if (url.search !== (object === 'git/trees' ? '?recursive=1' : '')) return;
    return { repository, object, sha };
  },
  { op: 'referenceSourceObject', capture: 0 }
);

/** Reuse workspace authorization; anonymous metadata shares an immutable edge cache. */
export const createReferenceSourceFetch = withInstrumentation(
  function createReferenceSourceFetch(token: string | null, fetcher: typeof fetch = fetch): typeof fetch {
    return (input, init) => {
      if (typeof input !== 'string' || (init?.method && init.method !== 'GET')) return fetcher(input, init);
      let url: URL;
      try {
        url = new URL(input);
      } catch {
        return fetcher(input, init);
      }
      const object = referenceSourceObject(url);
      if (!object) return fetcher(input, init);
      if (token) {
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer ${token}`);
        return fetcher(input, { ...init, headers });
      }
      return fetcher(`/api/reference-source?${new URLSearchParams(object)}`, init);
    };
  },
  { op: 'createReferenceSourceFetch', capture: 0 }
);
