// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect } from '@playwright/test';
import { checkNamedTargets } from '../helpers/project-targets.js';
import { projectBackingFiles } from '../helpers/project-backing.js';
import { fullSourceEditor } from '../helpers/source-editor.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

test('saves independent named SQL targets and builds their repository settings', async ({ page }, info) => {
  await checkNamedTargets(page, {
    checkpoint: async (name) => {
      await page.screenshot({ path: info.outputPath(`${name}.png`) });
    }
  });
});

test('keeps named-target controls reachable in a fresh compact workspace', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'demo.rosetta',
    buffer: Buffer.from('namespace demo\ntype Party:\n name string (1..1)'),
    mimeType: 'text/plain'
  });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await page.getByTestId('rail-export').click();
  await page.getByTestId('export-perspective').getByRole('tab', { name: 'Settings', exact: true }).click();
  const settings = page.getByTestId('export-settings-panel');
  await expect(settings.getByRole('tab', { name: 'One-off', exact: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Save target settings', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const action of ['Generate target', 'Generate all'])
  test(`builds freshly autosaved source with ${action}`, async ({ page }) => {
    const source = 'namespace demo\ntype Party:\n name string (1..1)\n';
    await page.goto('./');
    await page
      .locator('input[type="file"][accept=".rosetta"]')
      .setInputFiles({ name: 'demo.rosetta', buffer: Buffer.from(source), mimeType: 'text/plain' });
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await page.getByTestId('rail-export').click();
    const settings = page.getByTestId('export-settings-panel');
    await settings.getByLabel('Export target', { exact: true }).selectOption('sql');
    await settings.getByLabel('Target name', { exact: true }).fill('pg');
    await settings.getByRole('button', { name: 'Save target settings', exact: true }).click();
    await expect(settings.getByRole('tab', { name: 'pg', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('rail-explore').click();
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await dismissLocalTransportNotices(page);
    const content = fullSourceEditor(page).locator('.cm-content');
    await content.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(source + ' amount number (0..1)\n');
    await expect.poll(async () => (await projectBackingFiles(page))['demo.rosetta']).toContain('amount number');
    await page.getByTestId('rail-export').click();
    await settings.getByRole('button', { name: action, exact: true }).click();
    await expect
      .poll(async () =>
        Object.entries(await projectBackingFiles(page))
          .filter(([path]) => /^generated\/pg\/.*\.sql$/.test(path))
          .map(([, text]) => text)
          .join('\n')
      )
      .toMatch(/amount/i);
    await expect(page.getByRole('button', { name: 'Download export', exact: true })).toBeEnabled();
  });
