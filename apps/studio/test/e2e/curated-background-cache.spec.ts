// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test, expect, type Page } from '@playwright/test';
import { gzipSync } from 'node:zlib';

const namespace = 'seeded.example';
const artifact = `artifacts/2026-10-18-aaaaaaaaaaaa/ns/${namespace}.json.gz`;
const url = `https://www.daikonic.dev/curated/cdm/${artifact}`;
const key = JSON.stringify(['cdm', url]);
const source = 'namespace seeded.example\ntype Example:\n  value string (0..1)\n';

async function startSeeding(page: Page) {
  await page.evaluate(async () => {
    const path = '/src/services/workspace.ts';
    const { parseWorkspaceViaRouter } = await import(path);
    await parseWorkspaceViaRouter([], { curatedBundles: [{ id: 'cdm', version: 'latest' }] });
  });
}

async function cached(page: Page) {
  return page.evaluate(async (key) => {
    const path = '/src/services/curated-artifact-cache.ts';
    const { curatedArtifactCache } = await import(path);
    return curatedArtifactCache.documents(key);
  }, key);
}

for (const dedicated of [false, true]) {
  test(`background ${dedicated ? 'dedicated fallback' : 'shared worker'} seeds reusable artifacts without workspace hydration`, async ({
    page,
    context,
    browser
  }) => {
    if (dedicated)
      await context.addInitScript(() => {
        Object.defineProperty(window, 'SharedWorker', { value: undefined });
      });
    let downloads = 0;
    const requests: Array<{ known: string[]; returned: number }> = [];
    await context.route('**/api/parse', async (route) => {
      const body = route.request().postDataJSON();
      const needed = body.hydrateNamespaces?.includes(namespace);
      const known: string[] = body.knownCuratedArtifacts ?? [];
      const documents =
        needed && !known.includes(key)
          ? [
              {
                uri: 'cdm/seeded.rosetta',
                content: '',
                serializedModel: '{"$type":"RosettaModel","name":"seeded.example","elements":[]}',
                exports: [],
                bundleId: 'cdm',
                namespace,
                artifactKey: key
              }
            ]
          : [];
      if (needed) requests.push({ known, returned: documents.length });
      await route.fulfill({
        json: {
          ok: true,
          models: [],
          errors: {},
          deferredExports: [],
          hydrationState: { documents },
          requiredCuratedArtifacts: needed ? [{ key, bundleId: 'cdm', namespace, documentCount: 1 }] : [],
          curatedCacheSeeds: [{ key, namespace, bundleId: 'cdm', version: 'b'.repeat(64) }]
        }
      });
    });
    const bytes = gzipSync(
      JSON.stringify({
        documents: [
          {
            path: 'seeded.rosetta',
            content: source,
            modelJson: '{"$type":"RosettaModel","name":"seeded.example","elements":[]}',
            exports: []
          }
        ]
      })
    );
    await context.route(url, async (route) => {
      downloads++;
      await route.fulfill({
        contentType: 'application/gzip',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: bytes
      });
    });
    // Playwright's page routing does not own SharedWorker network requests.
    // Intercept only this public fixture at the actual Chromium worker target.
    const cdp = await browser.newBrowserCDPSession();
    let commandId = 0;
    const send = (sessionId: string, method: string, params: object = {}) =>
      cdp.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({ id: ++commandId, method, params })
      });
    cdp.on('Target.targetCreated', async ({ targetInfo }) => {
      if (targetInfo.type !== 'shared_worker') return;
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: targetInfo.targetId, flatten: false });
      await send(sessionId, 'Fetch.enable', { patterns: [{ urlPattern: url }] });
    });
    cdp.on('Target.receivedMessageFromTarget', async ({ sessionId, message }) => {
      const event = JSON.parse(message);
      if (event.method !== 'Fetch.requestPaused') return;
      downloads++;
      await send(sessionId, 'Fetch.fulfillRequest', {
        requestId: event.params.requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'application/gzip' },
          { name: 'Access-Control-Allow-Origin', value: '*' }
        ],
        body: bytes.toString('base64')
      });
    });
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    try {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('./');
      await expect(page.getByTestId('model-loader')).toBeVisible();
      await startSeeding(page);
      const other = await context.newPage();
      await other.goto('./');
      await expect(other.getByTestId('model-loader')).toBeVisible();
      await startSeeding(other);
      await expect.poll(async () => (await cached(page))?.length, { timeout: 20_000 }).toBe(1);
      expect(await cached(other)).toEqual(await cached(page));
      expect((await cached(page))![0]).toMatchObject({
        content: '',
        sourceLoaded: false,
        bundleId: 'cdm',
        namespace,
        artifactKey: key
      });
      if (!dedicated) expect(downloads).toBe(1);
      // Seeding must not load or edit a workspace on either tab.
      await expect(page.getByTestId('model-loader')).toBeVisible();
      await expect(other.getByTestId('model-loader')).toBeVisible();
      // The normal foreground path restores preseeded JSON without downloading it.
      await page.evaluate(async (namespace) => {
        const path = '/src/services/workspace.ts';
        const { parseWorkspaceViaRouter } = await import(path);
        await parseWorkspaceViaRouter([], {
          curatedBundles: [{ id: 'cdm', version: 'latest' }],
          hydrateNamespaces: [namespace]
        });
      }, namespace);
      expect(requests).toEqual([{ known: [key], returned: 0 }]);
      await page.reload();
      await startSeeding(page);
      expect((await cached(page))?.length).toBe(1);
      expect(errors).toEqual([]);
      await other.close();
    } finally {
      await cdp.detach();
    }
  });
}
