// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test, expect } from '@playwright/test';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
import { expressionReferenceFiles } from '../../../../packages/codegen/test/helpers/cdm-reference.js';

for (const width of [1280, 800]) {
  for (const mode of ['Structure', 'Graph'] as const) {
    test(`long enums stay readable in ${mode} at ${width}px and disclose all members in Inspector`, async ({
      page
    }, info) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto('./');
      await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
        name: 'enum.rosetta',
        mimeType: 'text/plain',
        buffer: Buffer.from(
          `namespace enumtest\nenum Status:\n${Array.from({ length: 201 }, (_, i) => ` Value${i}`).join('\n')}\n`
        )
      });
      await page.getByTestId('namespace-search').fill('Status');
      await typeNavigationButton(page, 'enumtest.Status', 'RosettaEnumeration').click();
      if (width === 800) {
        await page.getByRole('button', { name: 'Hide Type explorer', exact: true }).click();
        await page.getByRole('button', { name: 'Hide Preview panel', exact: true }).click();
      }
      const toggle = page.getByRole('button', { name: mode, exact: true });
      if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
      await dismissLocalTransportNotices(page);
      const card = page
        .locator(mode === 'Structure' ? '.rune-structure-card[data-kind="enum"]' : '.rune-node-enum')
        .first();
      await expect(card.getByRole('button', { name: 'View all 201 values' })).toBeVisible();
      await expect(card.getByText('Value8', { exact: true })).toHaveCount(0);
      await expect.poll(async () => (await card.boundingBox())!.height).toBeLessThan(500);
      await page.screenshot({ path: info.outputPath(`${mode}-summary.png`) });
      const disclosure = card.getByRole('button', { name: 'View all 201 values' });
      if (mode === 'Structure') {
        await disclosure.focus();
        await disclosure.press('Enter');
      } else await disclosure.click();
      const inspector = page.locator('[data-pane="inspector"]');
      await expect(inspector).toBeVisible();
      for (let i = 0; i < 4; i++) await inspector.getByRole('button', { name: /^Show more/ }).click();
      await expect(inspector.getByRole('textbox', { name: 'Value name for Value200', exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${mode}-complete-inspector.png`) });
      // A disclosure returns an already-open Inspector from Details to Values.
      await inspector.getByRole('tab', { name: 'Details', exact: true }).click();
      await expect(inspector.getByRole('tab', { name: 'Details', exact: true })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      await card.getByRole('button', { name: 'View all 201 values' }).click();
      await expect(inspector).toBeVisible();
      await expect(inspector.getByRole('tab', { name: 'Values', exact: true })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      // Paging and the visited editor remain mounted across section changes.
      await expect(inspector.getByRole('textbox', { name: 'Value name for Value200', exact: true })).toBeVisible();
    });
  }
}

test('the pinned CDM CommodityBusinessCalendarEnum fits as a readable summary', async ({ page }, info) => {
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles(
    expressionReferenceFiles().map(({ uri, content }) => ({
      name: uri.split('/').at(-1)!,
      mimeType: 'text/plain',
      buffer: Buffer.from(content)
    }))
  );
  await page.getByTestId('namespace-search').fill('CommodityBusinessCalendarEnum');
  await typeNavigationButton(page, 'cdm.base.datetime.CommodityBusinessCalendarEnum', 'RosettaEnumeration').click();
  await dismissLocalTransportNotices(page);
  const card = page.locator('.rune-structure-card[data-kind="enum"]');
  await expect(card.getByText('ADSM', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: /^View all \d+ values$/ })).toBeVisible();
  await expect.poll(async () => (await card.boundingBox())!.height).toBeLessThan(500);
  await page.screenshot({ path: info.outputPath('cdm-calendar-summary.png') });
});
