// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { stat } from 'node:fs/promises';
import { checkout as test, expect, loadCdm } from '../fixtures.js';
import { ANCHOR_DATA } from '../anchors.js';
import { typeSelectionCheckbox } from '../../helpers/type-navigation.js';
import type { Page } from '@playwright/test';

async function selectExportRoot(page: Page): Promise<void> {
  await page.getByTestId('rail-export').click();
  const perspective = page.getByTestId('export-perspective');
  await expect(perspective).toBeVisible({ timeout: 20000 });
  await expect(perspective.getByTestId('export-selection').first()).toBeVisible();
  await perspective.getByTestId('namespace-search').fill('BusinessCenters');
  await typeSelectionCheckbox(perspective, ANCHOR_DATA).click();
  await expect(perspective.getByTestId('export-selection-summary')).toContainText('1 root selected');
}

test.describe('J13 — Export perspective', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');

  test(
    'J13 Export selection and settings remain editable',
    { annotation: { type: 'journey-subid', description: 'render' } },
    async ({ page, evidence }) => {
      await loadCdm(page, evidence);
      await selectExportRoot(page);
      const settings = page.getByTestId('export-settings-panel');
      await expect(settings).toBeVisible();
      await expect(page.getByTestId('export-artifact-status')).toContainText('No export artifact yet');
      await expect
        .poll(
          async () =>
            (await page.getByTestId('export-selection').getByTestId('namespace-tree').boundingBox())?.height ?? 0
        )
        .toBeGreaterThan(120);
      await settings.getByLabel('Export target', { exact: true }).selectOption('zod');
      await settings.getByLabel('Export layout').selectOption('per-namespace');
      await expect(settings.getByLabel('Export layout')).toHaveValue('per-namespace');
      await expect(settings.getByRole('button', { name: 'Generate 1 selected' })).toBeEnabled();
      await evidence.checkpoint('export-selection-settings');
    }
  );

  test(
    'J13 Export generate captures an artifact and offers a download',
    { annotation: { type: 'journey-subid', description: 'generate' } },
    async ({ page, evidence }) => {
      await loadCdm(page, evidence);
      await selectExportRoot(page);
      await page.getByTestId('export-settings-panel').getByLabel('Export target', { exact: true }).selectOption('zod');
      await page.getByRole('button', { name: 'Generate 1 selected' }).click();
      const preview = page.getByTestId('export-artifact-preview');
      const failure = page.getByTestId('export-artifact-status');
      await expect(
        preview.or(failure.filter({ hasNotText: /Generating export|No export artifact/ })).first()
      ).toBeVisible({
        timeout: 60000
      });
      if (!(await preview.isVisible())) {
        evidence.softFinding('KI-codegen-503', `Export generation failed: ${await failure.textContent()}`);
        return;
      }

      await expect(preview.getByLabel('Generated export code')).not.toBeEmpty();
      await expect(page.getByTestId('export-selection-summary')).toContainText('declarations included');
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 20000 }),
        preview.getByRole('button', { name: 'Download export' }).click()
      ]);
      const path = await download.path();
      expect(path).toBeTruthy();
      expect((await stat(path!)).size).toBeGreaterThan(0);
      await evidence.checkpoint('export-artifact-downloaded');
    }
  );
});
