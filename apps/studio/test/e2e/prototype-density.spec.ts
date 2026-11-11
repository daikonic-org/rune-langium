// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect } from '@playwright/test';
import { test } from '../helpers/studio-test.js';
import AxeBuilder from '@axe-core/playwright';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

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
