// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, type Page } from '@playwright/test';
import { test } from '../helpers/studio-test.js';
import { typeNavigationButton, declarationNodeId } from '../helpers/type-navigation.js';
import { codeMirrorDocument, fullSourceEditor } from '../helpers/source-editor.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const source = `namespace review.polish
annotation metadata:
 key string (0..1)
enum BaseCurrency:
 USD
enum Currency extends BaseCurrency:
 EUR
type Entry: <"A required dated amount.">
 [metadata key]
 date date (1..1)
 amount number (1..1) <"The amount for this date.">
type Schedule: <"A collection of dated amounts.">
 entries Entry (0..*)
func CurrencyTest:
 inputs: currency string (1..1)
 output: result boolean (1..1)
 set result: currency exists
`;

async function load(page: Page) {
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'review-polish.rosetta',
    buffer: Buffer.from(source),
    mimeType: 'text/plain'
  });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await dismissLocalTransportNotices(page);
}
async function select(page: Page, name: string, kind = 'Data') {
  await page.getByTestId('namespace-search').fill(name);
  await typeNavigationButton(page, `review.polish.${name}`, kind).click();
}

async function showPane(page: Page, name: 'Source' | 'Inspector') {
  const toggle = page.getByRole('button', { name, exact: true });
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
}

test.use({ screenshot: 'only-on-failure' });

for (const theme of ['dark', 'light'] as const) {
  test(`documentation and required scalar cells remain editable in ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(
      (theme) => localStorage.setItem('rune-studio:theme', theme === 'dark' ? 'daikonic' : 'light'),
      theme
    );
    await load(page);
    await select(page, 'Schedule');
    await showPane(page, 'Source');
    const editor = fullSourceEditor(page);
    const before = await codeMirrorDocument(editor);
    await page.getByRole('button', { name: 'Hide source documentation', exact: true }).click();
    await expect(editor.locator('.cm-foldPlaceholder').first()).toBeVisible();
    expect(await codeMirrorDocument(editor)).toBe(before);
    await page.getByRole('button', { name: 'Show source documentation', exact: true }).click();
    await expect(editor.locator('.cm-foldPlaceholder')).toHaveCount(0);
    expect(await codeMirrorDocument(editor)).toBe(before);
    const preview = page.getByTestId('panel-formPreview');
    await preview.getByRole('button', { name: 'Add Entries item', exact: true }).click();
    const grid = preview.getByRole('table', { name: 'Entries', exact: true });
    await expect(grid.getByRole('columnheader', { name: 'Item', exact: true })).toHaveCount(0);
    const amount = grid.getByLabel('Entries 1 Amount', { exact: true });
    const date = grid.getByRole('textbox', { name: 'Entries 1 Date', exact: true });
    await date.fill('2026-01-01');
    await date.blur();
    await amount.fill('1250');
    await amount.blur();
    await expect(preview.getByTestId('sample-data-output')).toContainText('1250');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`inline-grid-${theme}.png`) });
    await select(page, 'Entry');
    await showPane(page, 'Inspector');
    await expect(page.getByRole('group', { name: 'Metadata semantics' })).toContainText('metadata key');
    await page.setViewportSize({ width: 1280, height: 900 });
    const sourcePane = page.getByTestId('center-stack').locator('[data-pane="source"]');
    await expect.poll(() => sourcePane.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`metadata-source-${theme}.png`) });
  });
}

test('drops a type onto the input name and shows inherited enum values', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await load(page);
  await select(page, 'CurrencyTest', 'RosettaFunction');
  await showPane(page, 'Inspector');
  await page.getByTestId('namespace-search').fill('Currency');
  const enumRow = page.getByTestId(`ns-type-${declarationNodeId('review.polish.Currency', 'RosettaEnumeration')}`);
  const input = page.getByRole('textbox', { name: 'Attribute name: currency', exact: true });
  await enumRow.dragTo(input);
  const currency = page.getByTestId('panel-formPreview').getByRole('combobox', { name: 'Currency', exact: true });
  await currency.click();
  await expect(page.getByRole('option', { name: 'USD', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'EUR', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'USD', exact: true }).click();
  await expect(page.getByTestId('sample-data-output')).toContainText('USD');
  await page.keyboard.press('Escape');
  await showPane(page, 'Source');
  await expect
    .poll(() => codeMirrorDocument(fullSourceEditor(page)))
    .toMatch(/currency\s+(?:review\.polish\.)?Currency\s*\(1\.\.1\)/);
  await page.screenshot({ path: info.outputPath('row-drop-inherited-enum.png') });
});

test('keeps generated output below settings with a keyboard-resizable divider', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await load(page);
  await page.getByTestId('rail-export').click();
  const settings = page.getByRole('region', { name: 'Export settings', exact: true });
  const output = page.getByRole('region', { name: 'Generated output', exact: true });
  await expect(settings).toBeVisible();
  await expect(output).toBeVisible();
  const before = await settings.boundingBox();
  const box = await output.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(before!.y + before!.height);
  const divider = page.getByRole('separator', { name: 'Resize export settings and output' });
  await divider.focus();
  await divider.press('ArrowDown');
  await expect.poll(async () => (await settings.boundingBox())!.height).toBeGreaterThan(before!.height);
  await expect(output).toBeVisible();
  await page.screenshot({ path: info.outputPath('export-settings-above-output.png') });
});
