// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, test as base } from '@playwright/test';
import { fetchCiGitHubSource } from './ci-github-source.js';
import { serveReferenceSource } from '../../functions/api/reference-source.js';

/** Candidate runs substitute built static assets while retaining real hosted endpoints. */
export const test = base.extend<{ runtimeHealth: void }>({
  runtimeHealth: [
    async ({ page }, use, info) => {
      let crashed = false;
      const errors: string[] = [];
      const onCrash = () => {
        crashed = true;
      };
      const onError = (error: Error) => errors.push(error.name);
      page.on('crash', onCrash);
      page.on('pageerror', onError);
      try {
        await use();
        if (info.status === 'skipped') return;
        expect(crashed, 'Studio browser page crashed.').toBe(false);
        expect(errors, 'Unexpected Studio client exceptions; inspect the sanitized trace for details.').toEqual([]);
        if (!page.isClosed())
          await expect(
            page.getByRole('heading', { name: 'Studio couldn’t display this view', exact: true }),
            'Studio entered its render-error screen.'
          ).toHaveCount(0);
      } finally {
        page.off('crash', onCrash);
        page.off('pageerror', onError);
      }
    },
    { auto: true }
  ],
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
      // This new Pages route is not yet deployed. Exercise its candidate handler
      // against real upstream bytes; credentials remain in the Node transport.
      await context.route(`${deployed.origin}/api/reference-source?**`, async (route) => {
        const response = await serveReferenceSource({
          request: new Request(route.request().url()),
          waitUntil: () => {},
          fetcher: async (input, init) => {
            const authenticated = token
              ? await fetchCiGitHubSource(
                  {
                    url: String(input),
                    method: init?.method ?? 'GET',
                    headers: Object.fromEntries(new Headers(init?.headers))
                  },
                  token,
                  abort.signal
                )
              : undefined;
            return authenticated ?? fetch(input, { ...init, signal: abort.signal });
          }
        });
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer())
        });
      });
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
