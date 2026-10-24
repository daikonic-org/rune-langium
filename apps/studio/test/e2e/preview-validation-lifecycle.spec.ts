// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect } from '@playwright/test';

test('validates standalone samples after importing a new workspace', async ({ page }) => {
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'preview-validation.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from('namespace validation\ntype Trade:\n name string (1..1)\n')
  });
  await page.getByTestId('ns-type-link-validation.Trade#Data').click();
  const form = page.getByTestId('panel-formPreview');
  await form.getByLabel('Name', { exact: true }).fill('Trade');
  await form.getByLabel('Name', { exact: true }).press('Tab');
  await expect(form.getByText('Valid sample', { exact: true })).toBeVisible();
});
