// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test, expect } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { declarationDocuments } from '../helpers/curated-declaration-fixture.js';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { fullSourceEditor } from '../helpers/source-editor.js';

test('shows own fields before the closure arrives, then preserves inherited fields, previews, Source and reload reuse', async ({
  page,
  context
}) => {
  await context.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true } }));
  const fixtures = await declarationDocuments();
  const url = (namespace: string) =>
    `https://www.daikonic.dev/curated/cdm/artifacts/2026-10-18-aaaaaaaaaaaa/ns/${namespace}.json.gz`;
  const key = (namespace: string) => JSON.stringify(['cdm', url(namespace)]);
  const documents = fixtures.map((doc) => ({ ...doc, artifactKey: key(doc.namespace), sourceLoaded: false }));
  const selected = documents[1]!;
  let release!: () => void;
  const closure = new Promise<void>((resolve) => {
    release = resolve;
  });
  let downloads = 0;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/api/parse', async (route) => {
    const body = route.request().postDataJSON();
    const requested = body.hydrateNamespaces?.includes(selected.namespace);
    if (requested) await closure;
    const known = body.knownCuratedArtifacts ?? [];
    const required = requested
      ? documents
      : body.hydrateNamespaces?.includes(documents[0]!.namespace)
        ? [documents[0]!]
        : [];
    await route.fulfill({
      json: {
        ok: true,
        models: [],
        errors: {},
        deferredExports: documents.map((doc) => ({
          namespace: doc.namespace,
          filePath: doc.uri,
          exports: doc.exports.map((item) => ({ ...item, name: item.name.split('.').at(-1) }))
        })),
        hydrationState: { documents: required.filter((doc) => !known.includes(doc.artifactKey)) },
        requiredCuratedArtifacts: required.length
          ? required.map((doc) => ({
              key: doc.artifactKey,
              bundleId: 'cdm',
              namespace: doc.namespace,
              documentCount: 1
            }))
          : [],
        curatedCacheSeeds: [
          { key: selected.artifactKey, namespace: selected.namespace, bundleId: 'cdm', version: 'pinned' }
        ]
      }
    });
  });
  await context.route(url(selected.namespace), async (route) => {
    downloads++;
    await route.fulfill({
      contentType: 'application/gzip',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: gzipSync(
        JSON.stringify({
          documents: [
            {
              path: 'selected.rosetta',
              content: '',
              modelJson: selected.serializedModel,
              exports: selected.exports
            }
          ]
        })
      )
    });
  });
  await context.route('**/api/curated-source', (route) =>
    route.fulfill({
      json: {
        artifactKey: selected.artifactKey,
        documents: [
          {
            uri: selected.uri,
            content:
              'namespace example.selected\nimport example.base.*\n\ntype Selected extends Base:\n  own int (0..1)\n'
          }
        ]
      }
    })
  );
  await page.goto('./');
  await page.getByRole('button', { name: 'New blank workspace', exact: true }).click();
  await page.getByTestId('rail-workspaces').click();
  await page.getByTestId('model-loader').getByRole('button', { name: /CDM/ }).first().click();
  await page.getByTestId('rail-explore').click();
  await page.getByTestId('namespace-search').fill('Base');
  await typeNavigationButton(page, 'example.base.Base', 'Data').click();
  const inspectorToggle = page.getByRole('button', { name: 'Inspector', exact: true });
  if ((await inspectorToggle.getAttribute('aria-pressed')) !== 'true') await inspectorToggle.click();
  const inspector = page.locator('[data-pane="inspector"]');
  await expect(inspector.locator('[data-inspector-readiness="linked"]')).toBeVisible();
  await page.getByTestId('namespace-search').fill('Selected');
  await typeNavigationButton(page, 'example.selected.Selected', 'Data').click();
  await expect(inspector.locator('[data-inspector-readiness="declaration"]')).toBeVisible();
  await expect(inspector.locator('input[value="own"]')).toBeDisabled();
  await expect(inspector.getByRole('status')).toContainText('Loading dependencies');
  // Previously linked parents may already be inspected; no new partial nodes are published.
  await expect(inspector.getByText('inherited', { exact: true })).toBeVisible();
  await expect(page.getByTestId('panel-formPreview').getByRole('spinbutton', { name: 'Own', exact: true })).toHaveCount(
    0
  );
  await page.screenshot({ path: test.info().outputPath('declaration-first.png') });
  release();
  await expect(inspector.locator('[data-inspector-readiness="linked"]')).toBeVisible();
  await expect(inspector.getByText('inherited', { exact: true })).toBeVisible();
  await expect(
    page.getByTestId('panel-formPreview').getByRole('spinbutton', { name: 'Own', exact: true })
  ).toBeVisible();
  const source = page.getByRole('button', { name: 'Source', exact: true });
  if ((await source.getAttribute('aria-pressed')) !== 'true') await source.click();
  await expect(fullSourceEditor(page).locator('.cm-content')).toContainText('type Selected extends Base:');
  await page.screenshot({ path: test.info().outputPath('fully-linked.png') });
  await page.reload();
  await page.getByTestId('rail-explore').click();
  if ((await inspectorToggle.getAttribute('aria-pressed')) !== 'true') await inspectorToggle.click();
  await page.getByTestId('namespace-search').fill('Selected');
  await typeNavigationButton(page, 'example.selected.Selected', 'Data').click();
  await expect(inspector.locator('[data-inspector-readiness="linked"]')).toBeVisible();
  expect(downloads).toBe(1);
  expect(errors).toEqual([]);
});
