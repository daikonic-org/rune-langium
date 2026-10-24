// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { openReferenceModels } from '../helpers/workspace-launcher.js';
import { test, expect } from '@playwright/test';
import { declarationDocuments } from '../helpers/curated-declaration-fixture.js';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

test('expanding curated children hydrates their inherited details without navigation', async ({ page, context }) => {
  await context.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true } }));
  const documents = await declarationDocuments([
    [
      'parent',
      'namespace demo.parent\nimport demo.schedule.*\n\ntype CashflowRepresentation:\n cashflowsMatchParameters boolean (1..1)\n paymentCalculationPeriod PaymentCalculationPeriod (0..*)\n'
    ],
    [
      'period',
      'namespace demo.schedule\nimport demo.asset.*\n\nfunc CalculationPeriod:\n output:\n  result boolean (1..1)\n set result: true\n\ntype CalculationPeriod:\n unadjustedDate date (0..1)\n\ntype PaymentCalculationPeriod:\n calculationPeriod CalculationPeriod (1..*)\n fixedPaymentAmount Money (0..1)\n'
    ],
    ['money', 'namespace demo.asset\nimport demo.math.*\n\ntype Money extends Quantity:\n'],
    ['quantity', 'namespace demo.math\n\ntype Quantity:\n value number (1..1)\n']
  ]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const hydrationRequests: string[][] = [];
  await context.route('**/api/parse', async (route) => {
    const body = route.request().postDataJSON();
    const namespaces: string[] = body.hydrateNamespaces ?? [];
    hydrationRequests.push(namespaces);
    if (namespaces.includes('demo.asset')) await gate;
    const required = documents.filter((doc) => namespaces.includes(doc.namespace));
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
        hydrationState: { documents: required },
        curatedCacheSeeds: []
      }
    });
  });
  await page.setViewportSize({ width: 1461, height: 988 });
  await page.goto('./');
  await page.getByRole('button', { name: 'New workspace', exact: true }).click();
  await openReferenceModels(page);
  await page.getByTestId('model-loader').getByRole('button', { name: /CDM/ }).first().click();
  await page.getByTestId('rail-explore').click();
  await page.getByTestId('namespace-search').fill('CashflowRepresentation');
  await typeNavigationButton(page, 'demo.parent.CashflowRepresentation', 'Data').click();
  const structure = page.getByTestId('structure-view-flow');
  await expect(structure.getByRole('button', { name: 'Expand paymentCalculationPeriod', exact: true })).toBeVisible();
  await structure.getByRole('button', { name: 'Expand paymentCalculationPeriod', exact: true }).click();
  await expect(structure.getByRole('button', { name: 'Expand fixedPaymentAmount', exact: true })).toBeVisible();
  await structure.getByRole('button', { name: 'Expand fixedPaymentAmount', exact: true }).click();
  await expect(structure.getByText('Loading Money details…')).toBeVisible();
  await dismissLocalTransportNotices(page);
  await page.screenshot({ path: test.info().outputPath('curated-loading.png') });
  release();
  const money = structure.getByRole('region', { name: 'Money', exact: true });
  await expect(money.getByText('No additional attributes')).toBeVisible();
  await expect(
    structure.getByRole('region', { name: 'Quantity', exact: true }).getByText('value', { exact: true })
  ).toBeVisible();
  await expect(structure).toHaveAttribute('data-canonical-id', 'demo.parent.CashflowRepresentation#Data');
  expect(hydrationRequests.some((names) => names.includes('demo.math'))).toBe(true);
  const row = structure.locator('[data-attr="paymentCalculationPeriod"]');
  await expect(row.getByRole('button', { name: 'Navigate to PaymentCalculationPeriod', exact: true })).toHaveCount(0);
  expect(await row.locator('[data-slot="type-chip"]').evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('nowrap');
  await page.screenshot({ path: test.info().outputPath('curated-hydrated.png') });
  const inspector = page.getByRole('button', { name: 'Inspector', exact: true });
  if ((await inspector.getAttribute('aria-pressed')) !== 'true') await inspector.click();
  await structure
    .getByRole('group', { name: 'PaymentCalculationPeriod type actions', exact: true })
    .getByRole('button', { name: 'Navigate to PaymentCalculationPeriod', exact: true })
    .click();
  const periodRow = page
    .locator('[data-pane="inspector"] [data-slot="attribute-row"]')
    .filter({ has: page.getByRole('textbox', { name: 'Attribute name: calculationPeriod', exact: true }) });
  await expect(periodRow.locator('[data-slot="type-picker-trigger"]')).toHaveAttribute('data-kind', 'Data');
  await periodRow.getByRole('button', { name: 'Go to CalculationPeriod', exact: true }).click();
  await expect(structure).toHaveAttribute('data-canonical-id', 'demo.schedule.CalculationPeriod#Data');
});
