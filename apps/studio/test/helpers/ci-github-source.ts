// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/** Authenticate public CDM reads in Node, keeping the token out of browser traces. */
export async function fetchCiGitHubSource(
  request: { url: string; method: string; headers: Record<string, string> },
  token: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch
) {
  const url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== 'https://api.github.com' ||
    !/^\/repos\/finos\/common-domain-model(?:\/|$)/.test(url.pathname)
  )
    return undefined;
  return fetcher(url, {
    method: 'GET',
    redirect: 'error',
    signal,
    headers: { Accept: request.headers.accept ?? 'application/vnd.github+json', Authorization: `Bearer ${token}` }
  });
}
