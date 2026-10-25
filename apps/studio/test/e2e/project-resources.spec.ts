// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { projectBackingFiles } from '../helpers/project-backing.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const content = `namespace quote
typeAlias Currency: string
func EchoCurrency:
 inputs: currency Currency (1..1)
 output: result Currency (1..1)
 set result: currency`;
async function reloadProject(page: Page) {
  await page.getByTestId('rail-export').click();
  await page.getByRole('button', { name: 'Reload project files', exact: true }).click();
  await page.getByTestId('rail-prototype').click();
}
test('uses saved project code lists for real form choices, execution and unavailable recovery', async ({
  page
}, info) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1461, height: 988 });
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'quote.rosetta', buffer: Buffer.from(content), mimeType: 'text/plain' });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await projectBackingFiles(page, {
    'rune-config.yml': 'model: {name: Quote}',
    'build-config.yml': JSON.stringify({
      schemaVersion: 1,
      sources: ['**/*.rosetta'],
      overrides: [
        {
          kind: 'resource',
          source: { model: 'local', id: 'quote.Currency#RosettaTypeAlias' },
          path: 'resources/currency.json'
        }
      ]
    }),
    'resources/currency.json': '[{"value":"EUR","label":"Euro"}]'
  });
  await page.reload();
  await page.getByTestId('rail-prototype').click();
  await page.getByRole('button', { name: /^Choose a function/ }).click();
  await page.getByRole('option', { name: /EchoCurrency.*quote/ }).click();
  const currency = page.getByRole('combobox', { name: 'Currency', exact: true });
  await expect(currency).toBeVisible({ timeout: 20000 });
  await currency.click();
  await expect(page.getByRole('option', { name: 'Euro', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: /Dollar|GBP/ })).toHaveCount(0);
  await page.getByRole('option', { name: 'Euro', exact: true }).click();
  const execute = page.getByRole('button', { name: 'Execute', exact: true });
  await expect(execute).toBeEnabled({ timeout: 20000 });
  await execute.click();
  await expect(page.getByRole('region', { name: 'result output' })).toContainText('EUR');
  await projectBackingFiles(page, { 'resources/currency.json': '{broken' });
  await reloadProject(page);
  await expect(execute).toBeDisabled({ timeout: 20000 });
  await expect(page.getByText(/JSON|decod|Expected property|unsupported/i).first()).toBeVisible();
  await projectBackingFiles(page, { 'resources/currency.json': '[{"value":"GBP","label":"Pound sterling"}]' });
  await reloadProject(page);
  await expect(currency).toBeVisible({ timeout: 20000 });
  await currency.click();
  await page.getByRole('option', { name: 'Pound sterling', exact: true }).click();
  await expect(execute).toBeEnabled({ timeout: 20000 });
  await execute.click();
  await expect(page.getByRole('region', { name: 'result output' })).toContainText('GBP');
  await dismissLocalTransportNotices(page);
  const a11y = await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze();
  expect(a11y.violations).toEqual([]);
  await info.attach('project-code-list-recovery', {
    body: await page.screenshot({ path: info.outputPath('project-code-list.png') }),
    contentType: 'image/png'
  });
});
