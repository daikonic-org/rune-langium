// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { Page } from '@playwright/test';
import { checkout as test, expect, captureOpLogSnapshot, readOpLog } from '../fixtures.js';
import { loadCurrentCdm } from '../../helpers/workspace-launcher.js';
import { projectBackingFiles } from '../../helpers/project-backing.js';

const root = 'rosetta-source/src/main/resources/';
const gasName = 'com-ex12-physical-gas-europe-zbt-fixed-price';
const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
  expect((await readOpLog(page)).filter((entry) => entry.message.includes('example type is unavailable'))).toEqual([]);
});

async function openExample(page: Page, path: string) {
  await page.getByRole('button', { name: 'Reference examples…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import reference examples', exact: true });
  await dialog.getByRole('textbox', { name: 'Search reference examples', exact: true }).fill(path.split('/').at(-1)!);
  await dialog.getByRole('button', { name: path, exact: true }).click();
  await expect(dialog.getByLabel('Example payload', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Example object type', exact: true })).toHaveCount(0);
  return dialog;
}

async function importExample(page: Page, path: string) {
  const dialog = page.getByRole('dialog', { name: 'Import reference examples', exact: true });
  await dialog.getByRole('checkbox', { name: `Select ${path}`, exact: true }).check();
  await dialog.getByRole('button', { name: 'Import 1 into library', exact: true }).click();
  await expect(dialog.getByText(`${path}: imported.`, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  const row = page.getByTestId('prototype-grid').locator('tbody tr');
  await expect(row).toHaveCount(1);
  await expect(row.getByText('saved', { exact: true })).toBeVisible();
  return row;
}

async function savedExample(page: Page, sourcePath: string) {
  const files = await projectBackingFiles(page);
  const entry = Object.entries(files).find(
    ([path, text]) => path.endsWith('.example.json') && JSON.parse(text).provenance?.reference?.path === sourcePath
  );
  expect(entry, `Saved descriptor for ${sourcePath}`).toBeDefined();
  const descriptor = JSON.parse(entry![1]);
  expect(descriptor.provenance.reference).toMatchObject({
    release: '7.8.0',
    commit: '5b852ed61573467c8f8e6bb5cc02779a70df032d',
    path: sourcePath
  });
  expect(files[descriptor.payload]).toBeDefined();
  return { descriptor: entry![1], payload: files[descriptor.payload] };
}

for (const [version, theme] of [
  ['5-10', 'daikonic'],
  ['5-13', 'light']
] as const)
  test(
    `J29 gas ${version} example loads into Object builder and survives reload without a validator exception`,
    { annotation: { type: 'journey-subid', description: `gas-${version}` } },
    async ({ page, evidence }) => {
      test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'requires a deployed Studio');
      await loadCurrentCdm(page, '7.8.0');
      await page.getByTestId('rail-settings').click();
      await page.getByTestId('settings-perspective').getByLabel('Theme', { exact: true }).selectOption(theme);
      await page.getByTestId('rail-prototype').click();
      await page.getByRole('button', { name: 'Object builder', exact: true }).click();
      const path = `${root}ingest/output/fpml-confirmation-to-trade-state/fpml-${version}-incomplete-products-commodity-derivatives/${gasName}.json`;
      const dialog = await openExample(page, path);
      await expect(dialog.getByText('cdm.event.common.TradeState · Data', { exact: true })).toBeVisible();
      await evidence.checkpoint('gas-payload-preview');
      const row = await importExample(page, path);
      await expect(page.getByRole('region', { name: 'input fields', exact: true })).toHaveCount(0);
      const original = await savedExample(page, path);
      await row.click();
      await expect(page.getByRole('region', { name: 'input fields', exact: true })).toBeVisible();
      const validation = page.getByRole('button', { name: /^input: (Checks passed|\d+ issues?) · View validation$/ });
      await expect(validation).toBeVisible({ timeout: 15000 });
      await validation.click();
      await expect(page.getByRole('heading', { name: 'input · validation', exact: true })).toBeVisible();
      const issues = page.locator('.workflow-validation-popover');
      await expect(issues).not.toContainText(/_zod|is not defined|unavailable/i);
      const geometry = await issues.locator(':scope > ul > li').evaluateAll((rows) =>
        rows.map((row) => {
          const button = row.querySelector('button')!;
          const text = button.querySelector('span')!;
          const outer = button.getBoundingClientRect();
          const inner = text.getBoundingClientRect();
          return {
            contentFits: inner.top >= outer.top && inner.bottom <= outer.bottom && inner.right <= outer.right,
            noHorizontalOverflow: button.scrollWidth <= button.clientWidth,
            bottom: row.getBoundingClientRect().bottom,
            top: row.getBoundingClientRect().top
          };
        })
      );
      for (const [index, row] of geometry.entries()) {
        expect(row.contentFits).toBe(true);
        expect(row.noHorizontalOverflow).toBe(true);
        if (index > 0) expect(row.top).toBeGreaterThanOrEqual(geometry[index - 1]!.bottom);
      }
      await expect(issues.locator(':scope > ul > li')).toHaveCount(6);
      const alternatives = issues.locator(':scope > ul > li > details').filter({ hasText: 'Accepted forms' });
      expect(await alternatives.count()).toBeGreaterThan(0);
      await alternatives.first().locator(':scope > summary').click();
      await expect(alternatives.first().locator(':scope > ol')).toBeVisible();
      await expect(alternatives.first().locator(':scope > ol')).toContainText('Invalid input:');
      await evidence.checkpoint('gas-validated-in-object-builder');
      await page.keyboard.press('Escape');
      expect(await savedExample(page, path)).toEqual(original);
      expect((await readOpLog(page)).filter((entry) => entry.message.includes('example type is unavailable'))).toEqual(
        []
      );
      await captureOpLogSnapshot(page, evidence);
      await page.reload();
      evidence.markNavigation();
      await page.getByTestId('rail-prototype').click();
      await page.getByRole('button', { name: 'Object builder', exact: true }).click();
      await expect(row.getByText('saved', { exact: true })).toBeVisible();
      await row.click();
      await expect(validation).toBeVisible({ timeout: 15000 });
      expect(await savedExample(page, path)).toEqual(original);
      await evidence.checkpoint('gas-restored-with-source-preserved');
    }
  );

test(
  'J29 execution catalog supplies the function binding without changing the workflow during import',
  { annotation: { type: 'journey-subid', description: 'execution-catalog' } },
  async ({ page, evidence }) => {
    test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'requires a deployed Studio');
    await loadCurrentCdm(page, '7.8.0');
    await page.getByTestId('rail-prototype').click();
    const path = `${root}functions/repo-and-bond/bond-execution-func-input.json`;
    const dialog = await openExample(page, path);
    await expect(dialog.getByText('Bond Execution · Function inputs', { exact: true })).toBeVisible();
    await expect(
      dialog.getByText('cdm.event.common.Create_BusinessEvent · Function inputs', { exact: true })
    ).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Execution catalog', exact: true })).toHaveAttribute(
      'href',
      /\/5b852ed61573467c8f8e6bb5cc02779a70df032d\/.*repo-and-bond-execution-descriptor\.json$/
    );
    await evidence.checkpoint('catalog-function-binding-preview');
    const row = await importExample(page, path);
    const functionLink = page.getByRole('button', { name: 'View Create_BusinessEvent in Explore', exact: true });
    await expect(functionLink).toHaveCount(0);
    const original = await savedExample(page, path);
    await row.click();
    await expect(functionLink).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('region', { name: 'instruction fields', exact: true })).toContainText('1 item');
    await evidence.checkpoint('catalog-function-inputs-bound');
    await captureOpLogSnapshot(page, evidence);
    await page.reload();
    evidence.markNavigation();
    await page.getByTestId('rail-prototype').click();
    await expect(row.getByText('saved', { exact: true })).toBeVisible();
    await row.click();
    await expect(functionLink).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('region', { name: 'instruction fields', exact: true })).toContainText('1 item');
    expect(await savedExample(page, path)).toEqual(original);
    expect((await readOpLog(page)).filter((entry) => entry.message.includes('example type is unavailable'))).toEqual(
      []
    );
    await evidence.checkpoint('catalog-binding-restored');
  }
);
