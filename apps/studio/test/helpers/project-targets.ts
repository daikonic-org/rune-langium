// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { projectBackingFiles } from './project-backing.js';
import { dismissLocalTransportNotices } from './expression-workspace.js';

import { reloadJourney, type JourneyObserver } from './journey-observer.js';

export async function checkNamedTargets(page: Page, observer: JourneyObserver = {}): Promise<void> {
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
  const openSettings = () =>
    page.getByTestId('export-perspective').getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(settings.getByRole('tab', { name: 'One-off', exact: true })).toHaveAttribute('aria-selected', 'true');
  await settings.getByLabel('Export target', { exact: true }).selectOption('sql');
  await settings.getByLabel('Dialect', { exact: true }).selectOption('postgres');
  await settings.getByLabel('Target name', { exact: true }).fill('pg');
  await settings.getByRole('button', { name: 'Save target settings', exact: true }).click();
  await expect(settings.getByRole('tab', { name: 'pg', exact: true })).toHaveAttribute('aria-selected', 'true');
  await settings.getByRole('button', { name: 'Add target', exact: true }).click();
  await expect(settings.getByLabel('Target name', { exact: true })).toBeFocused();
  await settings.getByLabel('Dialect', { exact: true }).selectOption('sqlserver');
  await settings.getByLabel('Target name', { exact: true }).fill('ss');
  await settings.getByRole('button', { name: 'Save target settings', exact: true }).click();
  await settings.getByRole('tab', { name: 'pg', exact: true }).click();
  await expect(settings.getByLabel('Dialect', { exact: true })).toHaveValue('postgres');
  await expect(settings.getByRole('button', { name: 'Generate target', exact: true })).toBeEnabled();
  await settings.getByRole('button', { name: 'Generate target', exact: true }).click();
  await expect(page.getByTestId('export-artifact-preview')).toBeVisible();
  await openSettings();
  await settings.getByRole('button', { name: 'Generate all', exact: true }).click();
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
  await openSettings();
  await settings.getByRole('heading', { name: 'Export settings', exact: true }).scrollIntoViewIfNeeded();
  const a11y = await new AxeBuilder({ page }).include('[data-testid="export-settings-panel"]').analyze();
  expect(a11y.violations).toEqual([]);
  await dismissLocalTransportNotices(page);
  await expect(page.locator('[data-slot=toast-close]')).toHaveCount(0);
  await observer.checkpoint?.('named-targets');
  const before = generated['build-config.yml']!;
  const changed = before.replace('dialect: postgres', 'dialect: sqlserver');
  expect(changed).not.toBe(before);
  const edited = await projectBackingFiles(page, { 'build-config.yml': changed });
  expect(edited[pgPath]).toBe(generated[pgPath]);
  await settings.getByRole('button', { name: 'Reload project files', exact: true }).click();
  await expect(settings.getByLabel('Dialect', { exact: true })).toHaveValue('sqlserver');
  await page.getByTestId('export-perspective').getByRole('tab', { name: 'Generated output', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download export', exact: true })).toBeDisabled();
  await openSettings();
  await reloadJourney(page, observer);
  await page.getByTestId('rail-export').click();
  await expect(settings.getByRole('tab', { name: 'pg', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(settings.getByLabel('Dialect', { exact: true })).toHaveValue('sqlserver');
  await settings.getByRole('tab', { name: 'ss', exact: true }).click();
  await settings.getByRole('tab', { name: 'pg', exact: true }).click();
  await settings.getByLabel('Dialect', { exact: true }).selectOption('postgres');
  await settings.getByRole('tab', { name: 'ss', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Generate all', exact: true })).toBeDisabled();
  const { parseBuildConfig, updateBuildConfig } = await import('@rune-langium/project-config');
  const filesBeforeRemoval = await projectBackingFiles(page);
  const document = { path: 'build-config.yml', text: filesBeforeRemoval['build-config.yml']! };
  const build = parseBuildConfig(document).value!;
  delete build.targets.pg;
  await projectBackingFiles(page, { 'build-config.yml': updateBuildConfig(document, build) });
  await settings.getByRole('button', { name: 'Reload project files', exact: true }).click();
  await expect(settings.getByRole('tab', { name: /^pg/ })).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Generate all', exact: true })).toBeEnabled();
  await settings.getByRole('button', { name: 'Generate all', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download export', exact: true })).toBeEnabled();
  await openSettings();
  await settings.getByRole('button', { name: 'Remove ss target', exact: true }).click();
  await expect(settings.getByRole('tab', { name: 'ss', exact: true })).toHaveCount(0);
  const afterRemove = await projectBackingFiles(page);
  expect(afterRemove[ssPath]).toBe(generated[ssPath]);
  await observer.checkpoint?.('removed-target-output-preserved');
}
