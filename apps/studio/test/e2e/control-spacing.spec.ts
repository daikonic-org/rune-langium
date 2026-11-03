// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test } from '../helpers/studio-test.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
import { waitForEntranceAnimations } from '../prod-ux/readiness.js';

for (const theme of ['light', 'daikonic'])
  for (const width of [1280, 800]) {
    test(`compact form rhythm and checkbox labels at ${width}px in ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`./?theme=${theme}`);
      await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
        name: 'spacing.rosetta',
        mimeType: 'text/plain',
        buffer: Buffer.from(
          'namespace spacing\nversion "1.0.0"\ntype Record:\n firstName string (0..1)\n lastName string (0..1)\n enabled boolean (0..1)\n'
        )
      });
      await page.getByTestId('ns-type-link-spacing.Record#Data').click();
      const preview = page.getByTestId('panel-formPreview');
      if (width === 800) {
        await page.getByRole('button', { name: 'Show Preview panel', exact: true }).click();
        await page.getByRole('tab', { name: 'Form', exact: true }).dblclick();
      }
      await expect(preview.getByLabel('First Name', { exact: true })).toBeVisible();
      await dismissLocalTransportNotices(page);
      const checkbox = preview.getByRole('checkbox', { name: 'Enabled', exact: true });
      await preview.getByText('Enabled', { exact: true }).click();
      await expect(checkbox).toBeChecked();
      const spacing = await checkbox.evaluate((control) => {
        const label = control.parentElement!.querySelector('label')!;
        return label.getBoundingClientRect().left - control.getBoundingClientRect().right;
      });
      expect(spacing).toBeGreaterThanOrEqual(8);
      await expect(preview.locator('.preview-layout-grid').first()).toHaveCSS('row-gap', '8px');
      await page.screenshot({ path: info.outputPath('preview.png'), fullPage: true });
      await page.getByRole('button', { name: 'Import Model', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Import Model', exact: true });
      await expect(dialog).toBeVisible();
      await waitForEntranceAnimations(page);
      const fields = dialog.locator('.z2f-field').filter({ has: page.getByRole('checkbox') });
      expect(await fields.count()).toBeGreaterThan(0);
      for (const field of await fields.all()) {
        const geometry = await field.evaluate((element) => {
          const input = element.querySelector('[role="checkbox"]')!;
          const label = element.querySelector('label')!;
          const c = input.getBoundingClientRect(),
            l = label.getBoundingClientRect();
          return { gap: l.left - c.right, width: c.width, fits: l.right <= element.getBoundingClientRect().right + 1 };
        });
        expect(geometry.gap).toBeGreaterThanOrEqual(8);
        expect(geometry.width).toBe(16);
        expect(geometry.fits).toBe(true);
      }
      expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
      await page.screenshot({ path: info.outputPath('import.png'), fullPage: true });
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const settings = page.getByTestId('settings-perspective');
      await expect(settings).toBeVisible();
      await expect(settings).toHaveCSS('padding-left', '12px');
      await expect(settings).toHaveCSS('padding-top', '8px');
      await waitForEntranceAnimations(page);
      await page.screenshot({ path: info.outputPath('settings.png'), fullPage: true });
    });
  }
