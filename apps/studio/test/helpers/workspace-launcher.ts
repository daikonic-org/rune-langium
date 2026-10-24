// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, type Page } from '@playwright/test';

/** Editable projects and reference dependencies use distinct launcher sections. */
export async function openReferenceModels(page: Page) {
  const launcher = page.getByTestId('workspaces-perspective');
  if (!(await launcher.isVisible())) await page.getByTestId('rail-workspaces').click();
  await expect(launcher).toBeVisible();
  await launcher.getByRole('button', { name: 'Reference models', exact: true }).click();
  return page.getByTestId('model-loader');
}
