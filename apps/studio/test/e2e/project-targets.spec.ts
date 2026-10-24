// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { projectBackingFiles } from '../helpers/project-backing.js';

test('saves independent named SQL targets and builds their repository settings', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1461, height: 988 });
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
  await expect
    .poll(async () =>
      Object.keys(await projectBackingFiles(page)).some((path) => /^generated\/ss\/.*\.sql$/.test(path))
    )
    .toBe(true);
  await expect(page.getByRole('button', { name: 'Download export', exact: true })).toBeEnabled();
  const generated = await projectBackingFiles(page);
  const pgPath = Object.keys(generated).find((path) => /^generated\/pg\/.*\.sql$/.test(path))!;
  const ssPath = Object.keys(generated).find((path) => /^generated\/ss\/.*\.sql$/.test(path))!;
  expect(generated[pgPath]).toMatch(/CREATE TABLE/i);
  expect(generated[ssPath]).toMatch(/CREATE TABLE/i);
  expect(generated[pgPath]).not.toBe(generated[ssPath]);
  await expect(page.getByRole('combobox', { name: 'Generated export file' })).toHaveValue(pgPath);
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
  const before = generated['build-config.yml']!;
  const changed = before.replace('dialect: postgres', 'dialect: sqlserver');
  expect(changed).not.toBe(before);
  const edited = await projectBackingFiles(page, { 'build-config.yml': changed });
  expect(edited[pgPath]).toBe(generated[pgPath]);
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
