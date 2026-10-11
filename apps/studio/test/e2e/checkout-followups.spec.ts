// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test, expect } from '@playwright/test';
import { checkPrimitivePreviews } from '../helpers/primitive-preview.js';
import { loadPinnedFunction } from '../helpers/expression-workspace.js';
import { expectEditorExpansion } from '../helpers/body-projection.js';
import { waitForEntranceAnimations } from '../prod-ux/readiness.js';
import { typeNavigationButton } from '../helpers/type-navigation.js';

test('temporal and enum preview inputs keep their validated values', async ({ page }, testInfo) => {
  await checkPrimitivePreviews(page, async (name) => {
    await testInfo.attach(name, {
      body: await page.screenshot({ path: testInfo.outputPath(`${name}.png`) }),
      contentType: 'image/png'
    });
  });
});

test('compact conditions prioritize the expression without losing metadata controls', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await loadPinnedFunction(page);
  await page.getByTestId('namespace-search').fill('Frequency');
  await typeNavigationButton(page, 'cdm.base.datetime.Frequency', 'Data').click();
  await page.getByRole('tab', { name: 'Conditions', exact: true }).click();
  await page.getByRole('tab', { name: 'PositivePeriodMultiplier', exact: true }).click();
  const expression = page.getByRole('region', { name: 'Condition expression' });
  await expect(expression).toContainText('periodMultiplier > 0');
  const details = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Condition details' }) });
  await expect(page.getByLabel('Condition name', { exact: true })).toBeHidden();
  await expectEditorExpansion(expression);
  while (await page.getByRole('button', { name: 'Dismiss notification', exact: true }).count())
    await page.getByRole('button', { name: 'Dismiss notification', exact: true }).first().click();
  await waitForEntranceAnimations(page);
  await testInfo.attach('compact-condition', {
    body: await page.screenshot({ path: testInfo.outputPath('compact-condition.png') }),
    contentType: 'image/png'
  });
  await details.locator('summary').click();
  await page.getByLabel('Condition description', { exact: true }).fill('A positive multiplier');
  await expect(page.getByLabel('Condition description', { exact: true })).toHaveValue('A positive multiplier');
});
