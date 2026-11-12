// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect } from '@playwright/test';
import { test } from '../helpers/studio-test.js';
import AxeBuilder from '@axe-core/playwright';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
import { seedProjectBackingFiles } from '../helpers/project-backing.js';

const source = `namespace density
version "1.0.0"
type Product:
${Array.from({ length: 14 }, (_, i) => ` note${i} string (0..1)`).join('\n')}
 amount number (1..1)
type Context:
 rate number (1..1)
func Calculate:
 inputs:
  product Product (1..1)
  context Context (1..1)
 output:
  result number (1..1)
 set result: product -> amount + context -> rate
`;
const name = 'Cross-check illustrative SOFR daily and index compounding for one week';

test('shows descriptive nested row summaries at desktop sizes and enlarged text', async ({ page }) => {
  const source = `namespace summary
version "1.0.0"
type Index:
 code string (1..1)
type Series:
 index Index (1..1)
 observations number (1..*)
func Echo:
 inputs: series Series (1..*)
 output: result Series (1..*)
 set result: series
`;
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'summary.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await seedProjectBackingFiles(page, {
    'rune-config.yml': 'model: { name: Summaries }\n',
    'build-config.yml': 'schemaVersion: 1\nsources: ["**/*.rosetta"]\ntargets: {}\n',
    'studio-config.yml': 'schemaVersion: 1\n',
    'summary.rosetta': source,
    'workflows/summary.workflow.json': JSON.stringify({
      schemaVersion: 1,
      id: 'summary',
      name: 'Identify supplied rate series',
      function: { model: 'local', namespace: 'summary', name: 'Echo', kind: 'RosettaFunction' },
      inputs: {
        series: {
          kind: 'literal',
          value: [
            { index: { code: 'USD-SOFR' }, observations: [0.043, 0.044] },
            { index: { code: 'GBP-SONIA' }, observations: [0.046] }
          ]
        }
      },
      outputs: { result: { name: 'series' } }
    })
  });
  await page.getByTestId('rail-prototype').click();
  if (['127.0.0.1', 'localhost'].includes(new URL(page.url()).hostname)) await dismissLocalTransportNotices(page);
  await page.getByRole('combobox', { name: 'Saved workflow', exact: true }).click();
  await page.getByRole('option', { name: 'Identify supplied rate series', exact: true }).click();
  const grid = page.getByRole('table', { name: 'Series', exact: true });
  for (const [width, height] of [
    [1280, 720],
    [1920, 1080]
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(grid.getByText('Index: USD-SOFR · Observations: 2 items', { exact: true })).toBeVisible();
    await expect(grid.getByText('Index: GBP-SONIA · Observations: 1 item', { exact: true })).toBeVisible();
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expect(grid.getByText('Index: USD-SOFR · Observations: 2 items', { exact: true })).toBeVisible();
  await grid.getByRole('button', { name: 'Open Series 2 details', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Code', { exact: true })).toHaveValue('GBP-SONIA');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('GBP-SONIA');
  expect((await new AxeBuilder({ page }).include('[aria-label="Prototype workflow"]').analyze()).violations).toEqual(
    []
  );
});

for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
  [390, 900]
] as const) {
  test(`keeps long workflow forms and actions usable at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height });
    await page.goto('./');
    await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
      name: 'density.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from(source)
    });
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await page.getByTestId('rail-prototype').click();
    if (['127.0.0.1', 'localhost'].includes(new URL(page.url()).hostname)) {
      await dismissLocalTransportNotices(page);
    }
    await page.getByRole('button', { name: /Choose a function/ }).click();
    await page.getByRole('option', { name: 'Calculate — density', exact: true }).click();
    const product = page.getByRole('region', { name: 'product fields', exact: true });
    const scroller = page.getByRole('group', { name: 'Scroll product fields', exact: true });
    const execute = page.getByRole('button', { name: 'Execute', exact: true });
    await expect(execute).toBeInViewport();
    if (width >= 1280) {
      await expect(page.getByRole('heading', { name: 'context', exact: true })).toBeInViewport();
    }
    await expect(product.locator('[data-layout-field]').first()).toHaveAttribute('data-layout-field', 'amount');
    await product.getByLabel('Amount', { exact: true }).fill('10');
    await scroller.focus();
    await scroller.press('PageDown');
    await expect.poll(() => scroller.evaluate((n) => n.scrollTop)).toBeGreaterThan(0);
    await product.getByLabel('Note13', { exact: true }).fill('retained after scroll');
    await page
      .getByRole('region', { name: 'context fields', exact: true })
      .getByLabel('Rate', { exact: true })
      .fill('5');
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(page.getByTestId('instance-payload-output')).toContainText('15');
    await expect(product.getByLabel('Note13', { exact: true })).toHaveValue('retained after scroll');
    await page.getByRole('button', { name: 'Save workflow…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Save workflow', exact: true });
    await dialog.getByLabel('Workflow name').fill(name);
    await dialog.getByRole('button', { name: 'Save workflow', exact: true }).click();
    await expect(dialog).toBeHidden();
    const picker = page.getByRole('combobox', { name: 'Saved workflow', exact: true });
    await expect(picker).toContainText(name);
    expect(await picker.locator('[data-slot="select-value"]').evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(
      true
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).include('[aria-label="Prototype workflow"]').analyze();
    expect(axe.violations).toEqual([]);
  });
}
