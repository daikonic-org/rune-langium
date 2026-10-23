// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import JSZip from 'jszip';

test('saves independent named SQL targets and builds their repository settings', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1461, height: 988 });
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/codegen', async (route) => {
    const request = route.request().postDataJSON();
    requests.push(request);
    const zip = new JSZip();
    zip.file('schema.sql', 'CREATE TABLE party;');
    zip.file(
      '.rune/export.json',
      JSON.stringify({
        version: 1,
        target: 'sql',
        files: [{ path: 'schema.sql', kind: 'text', bytes: 19 }],
        diagnostics: []
      })
    );
    await route.fulfill({
      status: 200,
      body: await zip.generateAsync({ type: 'nodebuffer' }),
      contentType: 'application/zip'
    });
  });
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'demo.rosetta',
    buffer: Buffer.from('namespace demo\ntype Party:\n  name string (1..1)'),
    mimeType: 'text/plain'
  });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await page.getByTestId('rail-export').click();
  const settings = page.getByTestId('export-settings-panel');
  await expect(settings.getByLabel('Saved target', { exact: true })).toHaveValue('');
  await settings.getByLabel('Export target', { exact: true }).selectOption('sql');
  await settings.getByLabel('Dialect', { exact: true }).selectOption('postgres');
  await settings.getByLabel('Target name', { exact: true }).fill('pg');
  await settings.getByRole('button', { name: 'Save target settings', exact: true }).click();
  await expect(settings.getByLabel('Saved target', { exact: true })).toHaveValue('pg');
  await settings.getByLabel('Dialect', { exact: true }).selectOption('sqlserver');
  await settings.getByLabel('Target name', { exact: true }).fill('ss');
  await settings.getByRole('button', { name: 'Save target settings', exact: true }).click();
  await settings.getByLabel('Saved target', { exact: true }).selectOption('pg');
  await expect(settings.getByLabel('Dialect', { exact: true })).toHaveValue('postgres');
  await expect(settings.getByRole('button', { name: 'Build selected', exact: true })).toBeDisabled();
  await settings.getByRole('checkbox', { name: 'pg', exact: true }).check();
  await settings.getByRole('button', { name: 'Build selected', exact: true }).click();
  await expect(page.getByTestId('export-artifact-preview')).toBeVisible();
  await settings.getByRole('button', { name: 'Build all', exact: true }).click();
  await expect(page.getByTestId('export-artifact-preview')).toBeVisible();
  await expect.poll(() => requests.length).toBe(3);
  await expect(page.getByRole('button', { name: 'Download export', exact: true })).toBeEnabled();
  expect(requests.map((request) => request.options)).toEqual([
    { sql: { dialect: 'postgres' } },
    { sql: { dialect: 'postgres' } },
    { sql: { dialect: 'sqlserver' } }
  ]);
  await expect(page.getByRole('combobox', { name: 'Generated export file' })).toHaveValue('generated/pg/schema.sql');
  for (const close of await page.getByRole('button', { name: 'Dismiss notification', exact: true }).all())
    await close.click();
  await settings.getByRole('heading', { name: 'Export settings', exact: true }).scrollIntoViewIfNeeded();
  const a11y = await new AxeBuilder({ page }).include('[data-testid="export-settings-panel"]').analyze();
  expect(a11y.violations).toEqual([]);
  for (const close of await page.locator('[data-slot=toast-close]').all()) await close.click();
  await expect(page.locator('[data-slot=toast-close]')).toHaveCount(0);
  await testInfo.attach('named-targets', {
    body: await page.screenshot({ path: testInfo.outputPath('named-targets.png') }),
    contentType: 'image/png'
  });
  const edited = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    for await (const [, dir] of root.entries())
      if (dir.kind === 'directory') {
        try {
          const files = await dir.getDirectoryHandle('files');
          const handle = await files.getFileHandle('build-config.yml');
          const before = await (await handle.getFile()).text();
          const stream = await handle.createWritable();
          await stream.write(before.replace('dialect: postgres', 'dialect: sqlserver'));
          await stream.close();
          const generated = await files.getDirectoryHandle('generated');
          const pg = await generated.getDirectoryHandle('pg');
          return (await (await pg.getFileHandle('schema.sql')).getFile()).text();
        } catch {
          /* Another backing-private directory. */
        }
      }
    throw new Error('Saved project not found');
  });
  expect(edited).toBe('CREATE TABLE party;');
  await settings.getByRole('button', { name: 'Reload project files', exact: true }).click();
  await expect(settings.getByLabel('Dialect', { exact: true })).toHaveValue('sqlserver');
  await expect(page.getByRole('button', { name: 'Download export', exact: true })).toBeDisabled();
  await page.reload();
  await page.getByTestId('rail-export').click();
  await expect(settings.getByLabel('Saved target', { exact: true })).toHaveValue('pg');
  await expect(settings.getByLabel('Dialect', { exact: true })).toHaveValue('sqlserver');
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
  await expect(settings.getByLabel('Saved target', { exact: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Save target settings', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
