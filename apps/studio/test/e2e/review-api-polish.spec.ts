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
type OutputFields:
 result boolean (1..1)
func ImplicitResult:
 inputs: values OutputFields (0..*)
 output: result boolean (0..*)
 set result: values extract [result]
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
    await page.getByRole('button', { name: 'Hide docs', exact: true }).click();
    await expect(editor.locator('.cm-foldPlaceholder').first()).toBeVisible();
    expect(await codeMirrorDocument(editor)).toBe(before);
    const initialFolds = await editor.locator('.cm-foldPlaceholder').count();
    const added =
      "\nfunc AddedDocumentation:\n output: result number (1..1)\n set result:\n  <\n   'Added documentation while hidden.'\n  >\n  1\n";
    const sourceInput = editor.getByRole('textbox', { name: 'Rune source editor' });
    await sourceInput.click();
    await sourceInput.press('ControlOrMeta+End');
    await page.keyboard.insertText(added);
    await expect(editor.locator('.cm-foldPlaceholder')).toHaveCount(initialFolds + 1);
    const edited = await codeMirrorDocument(editor);
    expect(edited).toBe(before.trimEnd() + added);
    await page.getByRole('button', { name: 'Show docs', exact: true }).click();
    await expect(editor.locator('.cm-foldPlaceholder')).toHaveCount(0);
    expect(await codeMirrorDocument(editor)).toBe(edited);
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

test('keeps member-name inputs aligned with compact Inspector controls', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await load(page);
  await select(page, 'CurrencyTest', 'RosettaFunction');
  await showPane(page, 'Inspector');
  const reference = page.getByRole('textbox', { name: 'Output name: result', exact: true });
  const geometry = (element: Element) => ({
    height: element.getBoundingClientRect().height,
    font: getComputedStyle(element).fontSize,
    padding: getComputedStyle(element).padding
  });
  const expected = await reference.evaluate(geometry);
  expect(expected.height).toBeGreaterThan(0);
  for (const [name, kind, label] of [
    ['CurrencyTest', 'RosettaFunction', 'Attribute name: currency'],
    ['Entry', 'Data', 'Attribute name: amount'],
    ['Currency', 'RosettaEnumeration', 'Value name for EUR']
  ] as const) {
    await select(page, name, kind);
    const input = page.getByRole('textbox', { name: label, exact: true });
    await expect(input).toBeVisible();
    expect(await input.evaluate(geometry)).toEqual(expected);
    await page.screenshot({ path: info.outputPath(`compact-${name}.png`) });
  }
});

test('edits a named output alongside inputs and synchronizes source', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await load(page);
  await select(page, 'CurrencyTest', 'RosettaFunction');
  await showPane(page, 'Inspector');
  await showPane(page, 'Source');
  await expect(page.getByRole('textbox', { name: 'New input parameter name', exact: true })).toHaveCount(0);
  const output = page.getByRole('group', { name: 'Output', exact: true });
  await expect(output.getByRole('textbox', { name: 'Output name: result', exact: true })).toBeVisible();
  await expect(output.locator('[data-slot="attribute-cardinality"]')).toContainText('1..1');
  const editor = fullSourceEditor(page);
  const name = output.locator('[data-slot="attribute-name"]');
  await name.fill('accepted');
  await name.blur();
  await expect.poll(() => codeMirrorDocument(editor)).toContain('accepted boolean (1..1)');
  await expect.poll(() => codeMirrorDocument(editor)).toContain('set accepted:');
  await expect(output.getByRole('textbox', { name: 'Output name: accepted', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('named-output.png') });
  await page.getByRole('button', { name: 'Add input', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /^Attribute name:\s*$/ })).toBeVisible();
});

test('renames output without changing implicit element field bindings', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await load(page);
  await select(page, 'ImplicitResult', 'RosettaFunction');
  await showPane(page, 'Inspector');
  await showPane(page, 'Source');
  const output = page.getByRole('group', { name: 'Output', exact: true });
  const name = output.locator('[data-slot="attribute-name"]');
  await name.fill('accepted');
  await name.blur();
  await expect(output.getByRole('textbox', { name: 'Output name: accepted', exact: true })).toBeEnabled();
  const editor = fullSourceEditor(page);
  await expect.poll(() => codeMirrorDocument(editor)).toContain('accepted boolean (0..*)');
  await expect.poll(() => codeMirrorDocument(editor)).toContain('values extract [result]');
  await expect(page.getByTestId('implementation-editor')).toContainText('values extract [result]');
  await expect(output.getByRole('textbox', { name: 'Output name: accepted', exact: true })).toBeEnabled();
  await expect(
    page.getByText('Signature editing waits for the current Rune draft to parse.', { exact: true })
  ).toBeHidden();
  await page.screenshot({ path: info.outputPath('implicit-field-preserved.png') });
});

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
