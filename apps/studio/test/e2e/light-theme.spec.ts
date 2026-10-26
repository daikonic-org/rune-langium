// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
import { fullSourceEditor, codeMirrorDocument } from '../helpers/source-editor.js';

for (const width of [1440, 390]) {
  test(`light theme surfaces and persistent transitions at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('./?theme=light');
    await expect(page.getByTestId('workspaces-perspective')).toBeVisible();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
    const launcher = page.getByTestId('workspaces-perspective');
    await launcher.getByRole('button', { name: 'New workspace', exact: true }).focus();
    await expect(launcher.getByRole('button', { name: 'New workspace', exact: true })).toHaveCSS(
      'outline-color',
      'rgb(113, 96, 181)'
    );
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="workspaces-perspective"]').analyze()).violations
    ).toEqual([]);
    await dismissLocalTransportNotices(page);
    await page.screenshot({ path: info.outputPath('light-launcher.png') });
    await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
      name: 'theme.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'namespace theme.review\n\n// Readable comments\ntype Contract:\n    label string (1..1)\n\nenum Direction:\n    Buy\n    Sell\n'
      )
    });
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await dismissLocalTransportNotices(page);
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await expect.poll(() => codeMirrorDocument(fullSourceEditor(page))).toContain('// Readable comments');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const theme = page.getByRole('combobox', { name: 'Theme', exact: true });
    await expect(theme).toHaveValue('light');
    await theme.selectOption('daikonic');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.screenshot({ path: info.outputPath('dark-settings.png') });
    await theme.selectOption('light');
    await page.goto('./');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });
}

test('theme startup tolerates disabled storage and preserves valid preferences on unsupported URLs', async ({
  browser,
  page
}) => {
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'rune-studio:theme') throw new DOMException('Blocked', 'SecurityError');
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'rune-studio:theme') throw new DOMException('Blocked', 'SecurityError');
      return setItem.call(this, key, value);
    };
  });
  await page.goto('./?theme=light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByTestId('workspaces-perspective')).toBeVisible();

  const validContext = await browser.newContext();
  try {
    const validPage = await validContext.newPage();
    await validPage.addInitScript(() => window.localStorage.setItem('rune-studio:theme', 'daikonic'));
    await validPage.goto(new URL('./?theme=unsupported', page.url()).toString());
    await expect(validPage.locator('html')).toHaveAttribute('data-theme', 'daikonic');
    expect(await validPage.evaluate(() => window.localStorage.getItem('rune-studio:theme'))).toBe('daikonic');
  } finally {
    await validContext.close();
  }
});
