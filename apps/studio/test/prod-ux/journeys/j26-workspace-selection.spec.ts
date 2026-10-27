// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { checkout as test, expect, captureOpLogSnapshot } from '../fixtures.js';

test('J26 renamed workspace selection restores only its own settings and export targets', async ({
  page,
  evidence
}) => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'requires a deployed Studio');
  await page.goto('./');
  const launcher = page.getByTestId('workspaces-perspective');
  async function create(name: string) {
    await launcher.getByRole('button', { name: 'New workspace', exact: true }).click();
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await page.getByTestId('rail-workspaces').click();
    const row = launcher.getByTestId('workspace-row').first();
    await row.getByRole('button', { name: /^Rename / }).click();
    await row.getByRole('textbox', { name: 'Workspace name' }).fill(name);
    await row.getByRole('textbox', { name: 'Workspace name' }).press('Enter');
    await expect(launcher.getByRole('button', { name: `Open ${name}`, exact: true })).toBeVisible();
  }
  async function saveDirectory(value: string) {
    await page.getByTestId('rail-settings').click();
    const settings = page.getByTestId('settings-perspective');
    await settings.getByLabel('Examples', { exact: true }).fill(value);
    await settings.getByRole('button', { name: 'Save workspace settings', exact: true }).click();
    await expect(settings.getByText('Workspace settings saved.', { exact: true })).toBeVisible();
  }
  await create('Alpha checkout');
  await saveDirectory('alpha-examples');
  await page.getByTestId('rail-export').click();
  const targets = page.getByTestId('export-settings-panel');
  await targets.getByLabel('Target name', { exact: true }).fill('alpha');
  await targets.getByRole('button', { name: 'Save target settings', exact: true }).click();
  await expect(targets.getByRole('tab', { name: 'alpha', exact: true })).toBeVisible();
  await page.getByTestId('rail-workspaces').click();
  await create('Beta checkout');
  await saveDirectory('beta-examples');
  await page.getByTestId('rail-export').click();
  await expect(targets.getByRole('tab', { name: 'alpha', exact: true })).toHaveCount(0);
  await evidence.checkpoint('beta-has-no-alpha-target');
  for (const [name, directory, hasAlpha] of [
    ['Alpha checkout', 'alpha-examples', true],
    ['Beta checkout', 'beta-examples', false]
  ] as const) {
    await page.getByTestId('rail-workspaces').click();
    await launcher.getByRole('button', { name: `Open ${name}`, exact: true }).click();
    await expect(page.getByTestId('app-header')).toContainText(name);
    await page.getByTestId('rail-settings').click();
    await expect(page.getByTestId('settings-perspective').getByLabel('Examples', { exact: true })).toHaveValue(
      directory
    );
    await page.getByTestId('rail-export').click();
    await expect(targets.getByRole('tab', { name: 'alpha', exact: true })).toHaveCount(hasAlpha ? 1 : 0);
    await evidence.checkpoint(name.startsWith('Alpha') ? 'alpha-restored' : 'beta-restored');
  }
  await captureOpLogSnapshot(page, evidence);
  await page.reload();
  evidence.markNavigation();
  await expect(page.getByTestId('app-header')).toContainText('Beta checkout');
  await page.getByTestId('rail-settings').click();
  await expect(page.getByTestId('settings-perspective').getByLabel('Examples', { exact: true })).toHaveValue(
    'beta-examples'
  );
  await evidence.checkpoint('selected-workspace-reopened');
});
