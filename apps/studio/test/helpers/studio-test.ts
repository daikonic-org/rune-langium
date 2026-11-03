// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test as base } from '@playwright/test';

/** Candidate runs substitute built static assets while retaining real hosted endpoints. */
export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    const assetOrigin = process.env.PROD_UX_ASSET_ORIGIN;
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
    }
    await use(context);
  }
});
