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
