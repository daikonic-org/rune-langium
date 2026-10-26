// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect } from '@playwright/test';
import { fullSourceEditor, codeMirrorDocument } from '../helpers/source-editor.js';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const model = `namespace highlight
version "1.0.0"
body Authority ISDA
corpus Contract ISDA MasterAgreement
synonym source FpML

type Trade:
  [docReference ISDA MasterAgreement rationale "Documentation [metadata] and // text"]
  amount number (1..1)
    [metadata scheme]
    [synonym FpML value "amount" path "/trade/amount"]
  // Supporting comment remains readable and editable
`;

test('Rune roles share theme categories with generated code at desktop width', async ({ page }, info) => {
  const source = `namespace roles
version "1.0.0"
type money:
  amount number (1..1)
enum direction:
  increase
func IncreaseCash:
  inputs:
    cash money (1..1)
  output:
    result number (1..1)
  set result: cash -> amount
`;
  await page.setViewportSize({ width: 1440, height: 988 });
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'roles.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from(source)
  });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await typeNavigationButton(page, 'roles.IncreaseCash', 'RosettaFunction').click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await dismissLocalTransportNotices(page);
  const editor = fullSourceEditor(page);
  const token = (text: string) =>
    editor
      .locator('.cm-line span')
      .filter({ hasText: new RegExp(`^${text}$`) })
      .first();
  await expect(token('IncreaseCash')).toBeVisible();
  await expect(token('increase')).toBeVisible();
  const color = (text: string) => token(text).evaluate((el) => getComputedStyle(el).color);
  expect(await color('money')).not.toBe(await color('amount'));
  expect(await color('increase')).not.toBe(await color('money'));
  await page.screenshot({ path: info.outputPath('rune-syntax-roles.png') });
  await page.evaluate(() => {
    for (const [role, color] of Object.entries({
      type: 'rgb(41, 85, 138)',
      function: 'rgb(51, 95, 148)',
      attribute: 'rgb(61, 105, 158)',
      constant: 'rgb(71, 115, 168)'
    }))
      document.documentElement.style.setProperty(`--syntax-${role}`, color);
  });
  for (const [text, color] of [
    ['money', 'rgb(41, 85, 138)'],
    ['IncreaseCash', 'rgb(51, 95, 148)'],
    ['amount', 'rgb(61, 105, 158)'],
    ['increase', 'rgb(71, 115, 168)']
  ] as const)
    await expect(token(text)).toHaveCSS('color', color);
  expect(await codeMirrorDocument(editor)).toBe(source);
});

for (const width of [1440, 390])
  test(`annotation emphasis and theme-aware syntax preserve source at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('./');
    await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
      name: 'highlight.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from(model)
    });
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await typeNavigationButton(page, 'highlight.Trade', 'Data').click();
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    const editor = fullSourceEditor(page);
    await expect(editor).toBeVisible();
    await dismissLocalTransportNotices(page);
    const token = (text: string) =>
      editor
        .locator('.cm-line span')
        .filter({ hasText: new RegExp(`^${text}$`) })
        .first();
    for (const head of ['docReference', 'metadata', 'synonym']) await expect(token(head)).toBeVisible();
    const color = (text: string) => token(text).evaluate((el) => getComputedStyle(el).color);
    expect(await color('metadata')).toBe(await color('docReference'));
    expect(await color('scheme')).not.toBe(await color('metadata'));
    const comment = editor
      .locator('.cm-line span')
      .filter({ hasText: /^\/\/ Supporting comment/ })
      .first();
    await expect(comment).toHaveCSS('font-style', 'italic');
    expect(await comment.evaluate((el) => getComputedStyle(el).color)).not.toBe(await color('metadata'));
    expect(await codeMirrorDocument(editor)).toBe(model);
    await page.screenshot({ path: info.outputPath('annotation-highlighting.png') });
    // Changing the shared palette must update a mounted editor without reparsing its source.
    await page.evaluate(() => document.documentElement.style.setProperty('--syntax-type', 'rgb(41, 85, 138)'));
    await expect(token('metadata')).toHaveCSS('color', 'rgb(41, 85, 138)');
    expect(await codeMirrorDocument(editor)).toBe(model);
  });
