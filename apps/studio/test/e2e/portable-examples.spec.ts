// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { projectBackingFiles } from '../helpers/project-backing.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const source = 'namespace example\ntype Trade:\n amount number (1..1)\n';
async function seed(page: import('@playwright/test').Page, url = './') {
  await page.goto(url);
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'trade.rosetta', buffer: Buffer.from(source), mimeType: 'text/plain' });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await page.getByTestId('rail-prototype').click();
}
test('saves distinct examples to repository files and restores a clone without browser instance storage', async ({
  page,
  browser
}, info) => {
  test.setTimeout(90000);
  await seed(page);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create example', exact: true });
  await dialog.getByRole('button', { name: 'Example type', exact: true }).click();
  await page.getByRole('option', { name: /Trade.*example/ }).click();
  await dialog.getByLabel('Example name', { exact: true }).fill('Portable trade');
  await dialog.getByRole('button', { name: 'Create example', exact: true }).click();
  const grid = page.getByTestId('prototype-grid');
  await grid.getByRole('button', { name: 'Import examples…', exact: true }).click();
  await page.getByRole('button', { name: 'Imported object type', exact: true }).click();
  await page.getByRole('option', { name: /Trade.*example/ }).click();
  await page.getByLabel('Import JSON data', { exact: true }).fill('[{"amount":10.123456789},{"amount":20}]');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(grid.locator('tbody tr')).toHaveCount(3);
  await expect(grid.locator('tbody tr').last()).toContainText('saved');
  let files: Record<string, string> = {};
  await expect
    .poll(async () => {
      files = await projectBackingFiles(page);
      return Object.keys(files).filter((path) => path.endsWith('.example.json')).length;
    })
    .toBe(3);
  const descriptors = Object.entries(files)
    .filter(([path]) => path.endsWith('.example.json'))
    .map(([, text]) => JSON.parse(text));
  expect(new Set(descriptors.map((entry) => entry.id)).size).toBe(3);
  for (const entry of descriptors) {
    expect(entry.type).toEqual({ model: 'local', namespace: 'example', kind: 'Data', name: 'Trade' });
    expect(JSON.parse(files[entry.payload]!)).toEqual(
      entry.name === 'Portable trade' ? {} : entry.name.endsWith('1') ? { amount: 10.123456789 } : { amount: 20 }
    );
  }
  expect(Object.keys(files).some((path) => path.startsWith('.studio/'))).toBe(false);
  await page.reload();
  await page.getByTestId('rail-prototype').click();
  await expect(page.getByTestId('prototype-grid').locator('tbody tr')).toHaveCount(3);
  const clone = await browser.newContext({ viewport: { width: 1461, height: 988 } });
  try {
    const cloned = await clone.newPage();
    await seed(cloned, page.url());
    await projectBackingFiles(cloned, files);
    await cloned.reload();
    await cloned.getByTestId('rail-prototype').click();
    await expect(cloned.getByTestId('prototype-grid').locator('tbody tr')).toHaveCount(3);
    await cloned.getByTestId('prototype-grid').getByRole('row').filter({ hasText: 'Imported Trade 1' }).first().click();
    await expect(cloned.getByLabel('Amount', { exact: true })).toHaveValue('10.123456789');
    await cloned.setViewportSize({ width: 700, height: 988 });
    await dismissLocalTransportNotices(cloned);
    expect(await cloned.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page: cloned }).include('[data-testid="prototype-perspective"]').analyze();
    expect(axe.violations).toEqual([]);
    await info.attach('portable-examples-clone', {
      body: await cloned.screenshot({ path: info.outputPath('portable-examples-clone.png') }),
      contentType: 'image/png'
    });
    const clonedFiles = await projectBackingFiles(cloned);
    expect(Object.keys(clonedFiles).filter((path) => path.endsWith('.example.json'))).toHaveLength(3);
    for (const entry of descriptors) expect(clonedFiles[entry.payload]).toBe(files[entry.payload]);
  } finally {
    await clone.close();
  }
});
