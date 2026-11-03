// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test as base } from '@playwright/test';
import { fetchCiGitHubSource } from './ci-github-source.js';

/** Candidate runs substitute built static assets while retaining real hosted endpoints. */
export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    const assetOrigin = process.env.PROD_UX_ASSET_ORIGIN;
    const abort = new AbortController();
    if (assetOrigin) {
      const candidate = new URL(assetOrigin);
      if (!['127.0.0.1', 'localhost'].includes(candidate.hostname))
        throw new Error('Candidate assets must be served locally');
      const deployed = new URL(baseURL ?? 'https://www.daikonic.dev/rune-studio/studio/');
      await context.route(
        (url) =>
          url.origin === deployed.origin &&
          (url.pathname.startsWith(deployed.pathname) || url.pathname.startsWith('/assets/')),
        async (route) => {
          const url = new URL(route.request().url());
          const path = url.pathname.startsWith(deployed.pathname)
            ? '/' + url.pathname.slice(deployed.pathname.length)
            : url.pathname;
          const response = await route.fetch({ url: new URL(path + url.search, candidate).href });
          if (response.headers()['content-type']?.includes('text/html')) {
            const body = (await response.text()).replaceAll('="/assets/', `="${deployed.pathname}assets/`);
            await route.fulfill({ response, body });
          } else await route.fulfill({ response });
        }
      );
      const token = process.env.STUDIO_TEST_GITHUB_TOKEN;
      if (token)
        await context.route('https://api.github.com/repos/finos/common-domain-model{,/**}', async (route) => {
          const request = route.request();
          try {
            const response = await fetchCiGitHubSource(
              { url: request.url(), method: request.method(), headers: request.headers() },
              token,
              abort.signal
            );
            if (!response) return route.continue();
            const headers = Object.fromEntries(response.headers);
            // Node fetch decodes transfer compression; don't describe decoded bytes as compressed.
            delete headers['content-encoding'];
            delete headers['content-length'];
            delete headers['transfer-encoding'];
            await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
          } catch (error) {
            if (!abort.signal.aborted) throw error;
          }
        });
    }
    try {
      await use(context);
    } finally {
      abort.abort();
    }
  }
});
