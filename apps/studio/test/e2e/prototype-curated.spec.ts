// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test, expect } from '@playwright/test';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
import { declarationDocuments } from '../helpers/curated-declaration-fixture.js';

for (const name of ['Double', 'External'])
  test(`prepares cold curated ${name} directly in Prototype`, async ({ page, context }, info) => {
    await context.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true } }));
    const documents = await declarationDocuments([
      ['terms', 'namespace example.terms\ntype Terms:\n amount number (1..1)\n'],
      [
        'functions',
        'namespace example.functions\nimport example.terms.*\nfunc Double:\n inputs: terms Terms (1..1)\n output: result number (1..1)\n set result: terms -> amount * 2\nfunc External:\n inputs: terms Terms (1..1)\n output: result number (1..1)\n'
      ]
    ]);
    const hydrated = documents.map((doc) => ({
      ...doc,
      artifactKey: JSON.stringify([
        'cdm',
        `https://www.daikonic.dev/curated/cdm/artifacts/2026-10-18-aaaaaaaaaaaa/ns/${doc.namespace}.json.gz`
      ])
    }));
    const requests: string[][] = [];
    await context.route('**/api/parse', async (route) => {
      const body = route.request().postDataJSON();
      requests.push(body.hydrateNamespaces ?? []);
      const required = body.hydrateNamespaces?.length ? hydrated : [];
      await route.fulfill({
        json: {
          ok: true,
          models: [],
          errors: {},
          deferredExports: documents.map((doc) => ({
            filePath: `cdm/${doc.namespace}`,
            namespace: doc.namespace,
            exports: doc.exports.map((entry) => ({ ...entry, name: entry.name.split('.').at(-1) }))
          })),
          hydrationState: {
            documents: required.filter((doc) => !(body.knownCuratedArtifacts ?? []).includes(doc.artifactKey))
          },
          requiredCuratedArtifacts: required.map((doc) => ({
            key: doc.artifactKey,
            bundleId: 'cdm',
            namespace: doc.namespace,
            documentCount: 1
          }))
        }
      });
    });
    await page.goto('./');
    await page.getByRole('button', { name: 'New blank workspace', exact: true }).click();
    await page.getByTestId('rail-workspaces').click();
    await page.getByTestId('model-loader').getByRole('button', { name: /CDM/ }).first().click();
    await page.getByTestId('rail-prototype').click();
    await page.getByRole('button', { name: 'Choose a function', exact: true }).click();
    await page.getByRole('option', { name: new RegExp(name) }).click();
    await expect(page.getByRole('spinbutton', { name: 'Amount', exact: true })).toBeVisible({ timeout: 20000 });
    await page.getByRole('spinbutton', { name: 'Amount', exact: true }).fill('12');
    await page.getByRole('spinbutton', { name: 'Amount', exact: true }).press('Tab');
    await expect(
      page.getByRole('button', { name: `Choose a function: ${name} — example.functions`, exact: true })
    ).toBeVisible();
    if (name === 'External') {
      await expect(page.getByRole('button', { name: /External: Checks passed/ })).toBeVisible();
      await dismissLocalTransportNotices(page);
      await expect(
        page.getByText('No Rune implementation is defined. External implementations cannot be executed in Studio.', {
          exact: true
        })
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeDisabled();
      await page.screenshot({ path: info.outputPath('external-implementation.png') });
      return;
    }
    await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByRole('region', { name: 'result output' })).toContainText('24');
    expect(requests.some((namespaces) => namespaces.includes('example.functions'))).toBe(true);
    await dismissLocalTransportNotices(page);
    await page.screenshot({ path: info.outputPath('cold-curated-function.png') });
  });
