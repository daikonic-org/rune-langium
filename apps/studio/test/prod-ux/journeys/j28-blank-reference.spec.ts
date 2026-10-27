// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { checkout as test, expect, captureOpLogSnapshot } from '../fixtures.js';
import { openReferenceModels } from '../../helpers/workspace-launcher.js';
import { typeNavigationButton } from '../../helpers/type-navigation.js';

for (const release of ['Nightly', '7.8.0'])
  test(
    `J28 ${release} reference added to a blank workspace restores a saved Explore layout`,
    { annotation: { type: 'journey-subid', description: release } },
    async ({ page, evidence }) => {
      test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'requires a deployed Studio');
      const crashes: string[] = [];
      page.on('pageerror', (error) => crashes.push(error.message));
      await page.goto('./');
      await page.getByRole('button', { name: 'New workspace', exact: true }).click();
      await expect(page.getByTestId('explore-workbench')).toBeVisible();
      await page.getByRole('button', { name: 'Source', exact: true }).click();
      await page.getByRole('button', { name: 'Inspector', exact: true }).click();
      await page.getByTestId('toggle-utilities').click();
      await evidence.checkpoint('blank-workspace-created');
      const picker = await openReferenceModels(page);
      await picker.getByRole('button', { name: /CDM \(Common/ }).click();
      await picker.getByRole('combobox', { name: 'Release', exact: true }).click();
      await page.getByRole('option', { name: release, exact: true }).click();
      await picker.getByRole('button', { name: /^(Add|Update) reference$/, exact: true }).click();
      await expect(picker.getByRole('heading', { name: 'Review reference change' })).toBeVisible({ timeout: 90000 });
      await evidence.checkpoint('reference-reviewed');
      await picker.getByRole('button', { name: 'Save reference change', exact: true }).click();
      await expect(picker.getByRole('heading', { name: 'Review reference change' })).toHaveCount(0, { timeout: 90000 });
      await evidence.checkpoint('reference-saved-before-explore');
      await page.getByTestId('rail-explore').click();
      await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });
      await page.getByTestId('namespace-search').fill('BusinessCenters');
      await typeNavigationButton(page, 'cdm.base.datetime.BusinessCenters', 'Data').click();
      await expect(page.getByTestId('center-stack')).toContainText('BusinessCenters');
      expect(crashes).toEqual([]);
      await expect(page.getByRole('button', { name: 'Inspector', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      await evidence.checkpoint('blank-workspace-reference-explored');
      await captureOpLogSnapshot(page, evidence);
      await page.reload();
      evidence.markNavigation();
      await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });
      await page.getByTestId('namespace-search').fill('BusinessCenters');
      await expect(typeNavigationButton(page, 'cdm.base.datetime.BusinessCenters', 'Data')).toBeVisible();
      expect(crashes).toEqual([]);
      await evidence.checkpoint('blank-reference-restored');
    }
  );
