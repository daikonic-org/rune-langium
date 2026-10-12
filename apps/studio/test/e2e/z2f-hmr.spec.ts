// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { test, expect } from '@playwright/test';
import { onRequestPost } from '../../functions/api/parse.js';

const studioRoot = fileURLToPath(new URL('../..', import.meta.url));
let server: ViteDevServer;
let directory: string;
let schemaPath: string;
let original: string;
let url: string;
let updateDelay = 0;

test.beforeAll(async () => {
  // Alias a disposable copy: never edit the user's generated schema or running server.
  directory = await mkdtemp(resolve(studioRoot, '../../packages/visual-editor/.z2f-hmr-'));
  schemaPath = resolve(directory, 'zod-schemas.ts');
  original = await readFile(resolve(studioRoot, '../../packages/visual-editor/src/generated/zod-schemas.ts'), 'utf8');
  await writeFile(schemaPath, original);
  const packagePaths = [
    ['package.json', ''],
    ['../../packages/visual-editor/package.json', '@rune-langium/visual-editor > '],
    ['../../packages/design-system/package.json', '@rune-langium/design-system > ']
  ];
  const dependencies = await Promise.all(
    packagePaths.map(async ([path, prefix]) =>
      Object.keys(JSON.parse(await readFile(resolve(studioRoot, path!), 'utf8')).dependencies ?? {})
        .filter((name) => !name.startsWith('@rune-langium/'))
        .map((name) => `${prefix}${name}`)
    )
  );
  server = await createServer({
    root: studioRoot,
    cacheDir: resolve(directory, 'vite-cache'),
    configFile: resolve(studioRoot, 'vite.config.ts'),
    optimizeDeps: { noDiscovery: false, include: [...new Set(dependencies.flat())] },
    plugins: [
      {
        name: 'isolated-inspector-schema',
        async transform(code, id) {
          if (id.split('?')[0] === schemaPath && code.includes('HMR name constraint probe') && updateDelay) {
            await new Promise((resolve) => setTimeout(resolve, updateDelay));
          }
        },
        enforce: 'pre',
        resolveId(id, importer) {
          if (
            importer?.startsWith(resolve(studioRoot, '../../packages/visual-editor')) &&
            id.endsWith('/generated/zod-schemas.js')
          )
            return schemaPath;
        }
      }
    ],
    server: { host: '127.0.0.1', port: 0 }
  });
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === 'string') throw new Error('Missing HMR test server address');
  url = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

for (const delay of [0, 1000]) {
  test(`canonical Inspector schema updates within two seconds without reloading (delay=${delay}ms)`, async ({
    page
  }) => {
    updateDelay = delay;
    await page.route('**/api/parse', async (route) => {
      const body = route.request().postDataJSON() as { files: unknown[] };
      const request = new Request(route.request().url(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: body.files })
      });
      const response = await onRequestPost({ request, env: {}, waitUntil() {} } as never);
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
    });
    await page.goto(url);
    await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
      name: 'hmr.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from('namespace hmr.test\nversion "1.0.0"\n\ntype Person:\n  name string (1..1)\n')
    });
    const inspector = page
      .getByRole('toolbar', { name: 'Center pane selector' })
      .getByRole('button', { name: 'Inspector' });
    if ((await inspector.getAttribute('aria-pressed')) !== 'true') await inspector.click();
    const name = page.getByLabel('Data type name', { exact: true });
    await expect(async () => {
      await page.getByRole('button', { name: 'Navigate to Person' }).click();
      await expect(name).toHaveValue('Person', { timeout: 500 });
    }).toPass({ timeout: 15000, intervals: [500] });
    const token = await page.evaluate(() => {
      const header = document.querySelector('[aria-label="Studio workspace header"]')!;
      const token = crypto.randomUUID();
      header.setAttribute('data-hmr-token', token);
      return token;
    });
    let navigations = 0;
    page.on('framenavigated', () => navigations++);
    const probe = 'HMR name constraint probe';
    const modified = original.replace(
      /export const DataSchema = z.looseObject\(\{\s*\$type: z.literal\('Data'\),\s*name: ValidIDSchema,/,
      (match) => match.replace('name: ValidIDSchema,', `name: z.string().min(30, '${probe}'),`)
    );
    expect(modified).not.toBe(original);
    await page.evaluate(async () => {
      const clientPath = '/@vite/client';
      const { createHotContext } = await import(clientPath);
      createHotContext('/inspector-hmr-observer').on('vite:afterUpdate', () => {
        document.documentElement.setAttribute('data-schema-hmr-complete', 'true');
      });
    });
    try {
      const started = performance.now();
      await writeFile(schemaPath, modified);
      await expect(page.locator('html')).toHaveAttribute('data-schema-hmr-complete', 'true', { timeout: 1800 });
      // React Refresh schedules the component update after Vite's module update.
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      );
      // Touch the existing field so the Inspector's afterTouched validation is observable.
      await name.press('End');
      await name.press('X');
      await expect(page.getByRole('alert').filter({ hasText: probe }).first()).toBeVisible({ timeout: 1800 });
      const elapsed = performance.now() - started;
      expect(elapsed).toBeLessThan(2000);
      console.log(`Inspector schema HMR: ${Math.round(elapsed)}ms, no document reload`);
      expect(await page.getByRole('banner', { name: 'Studio workspace header' }).getAttribute('data-hmr-token')).toBe(
        token
      );
      expect(navigations).toBe(0);
      await expect(page.getByText('hmr.rosetta', { exact: true }).first()).toBeVisible();
    } finally {
      await writeFile(schemaPath, original);
    }
  });
}
