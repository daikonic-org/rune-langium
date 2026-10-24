// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, type Page } from '@playwright/test';

/** Creates through the current toolbar and waits for the input form to mount. */
export async function createPrototypeExample(page: Page, type: string, name: string) {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create example', exact: true });
  await dialog.getByRole('button', { name: 'Example type', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search example type', exact: true }).fill(type);
  await page.getByRole('option', { name: new RegExp(`^${type} —`) }).click();
  await dialog.getByLabel('Example name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Create example', exact: true }).click();
  await expect(dialog).toBeHidden();
  const form = page.getByRole('region', { name: 'input fields', exact: true });
  await expect(form).toBeVisible();
  return form;
}
