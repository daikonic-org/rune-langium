// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, type Page } from '@playwright/test';
import { typeNavigationButton } from './type-navigation.js';

/** Editable projects and reference dependencies use distinct launcher sections. */
export async function openReferenceModels(page: Page) {
  const launcher = page.getByTestId('workspaces-perspective');
  if (!(await launcher.isVisible())) await page.getByTestId('rail-workspaces').click();
  await expect(launcher).toBeVisible();
  await launcher.getByRole('button', { name: 'Reference models', exact: true }).click();
  return page.getByTestId('reference-model-picker');
}

/** Load a published reference closure through the same review/Save transaction as a user. */
export async function loadCurrentCdm(page: Page, release = 'Nightly'): Promise<void> {
  await page.goto('./');
  await expect(page.getByTestId('workspaces-perspective')).toBeVisible({ timeout: 20000 });
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'starter.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from('namespace example\n')
  });
  await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });
  const picker = await openReferenceModels(page);
  await picker.getByRole('button', { name: /CDM \(Common Domain Model\)/ }).click();
  await picker.getByRole('combobox', { name: 'Release', exact: true }).click();
  await page.getByRole('option', { name: release, exact: true }).click();
  await picker.getByRole('button', { name: /^(Add|Update) reference$/, exact: true }).click();
  await expect(picker.getByRole('heading', { name: 'Review reference change' })).toBeVisible({ timeout: 90000 });
  await picker.getByRole('button', { name: 'Save reference change', exact: true }).click();
  await expect(picker.getByRole('heading', { name: 'Review reference change' })).toHaveCount(0, { timeout: 90000 });
  await expect(picker.getByRole('button', { name: /CDM \(Common Domain Model\)/ })).toContainText(release);
  await page.getByTestId('rail-explore').click();
  await page.getByTestId('namespace-search').fill('BusinessCenters');
  await expect(typeNavigationButton(page, 'cdm.base.datetime.BusinessCenters', 'Data')).toBeVisible({ timeout: 90000 });
}
