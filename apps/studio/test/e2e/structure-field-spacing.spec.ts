// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, test } from '@playwright/test';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

for (const width of [1323, 800]) {
  test(`Structure field controls stay inside their frame at ${width}px and canvas zoom`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 988 });
    await page.goto('./');
    await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
      name: 'party.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from('namespace spacing\ntype Party:\n name string (1..1)\n')
    });
    await page.getByTestId('namespace-search').fill('Party');
    await page.getByRole('button', { name: 'Navigate to Party', exact: true }).click();
    await dismissLocalTransportNotices(page);
    const canvas = page.getByTestId('structure-view-flow');
    const row = canvas.locator('.rune-node-row[data-attr="name"]');
    await expect(row).toBeVisible();
    for (const [index, delta] of [0, 350, 350].entries()) {
      if (delta) {
        const viewport = canvas.locator('.react-flow__viewport');
        const previousZoom = await viewport.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
        const bounds = (await canvas.boundingBox())!;
        await page.mouse.move(bounds.x + 20, bounds.y + 20);
        await page.mouse.wheel(0, delta);
        await expect
          .poll(() => viewport.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a))
          .toBeLessThan(previousZoom - 0.1);
      }
      await expect
        .poll(async () =>
          row.evaluate((el) => {
            const rect = el.getBoundingClientRect();
            const scale = rect.width / el.offsetWidth;
            const control = el.querySelector('[data-slot="cardinality-picker"]')!.getBoundingClientRect();
            return (rect.right - control.right) / scale;
          })
        )
        .toBeGreaterThanOrEqual(3);
      const geometry = await row.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const scale = rect.width / el.offsetWidth;
        const textLeft = (selector: string) => {
          const range = document.createRange();
          range.selectNodeContents(el.querySelector(selector)!);
          return range.getBoundingClientRect().left;
        };
        const control = el.querySelector('[data-slot="cardinality-picker"]')!.getBoundingClientRect();
        return {
          textOffset: Math.abs(textLeft('.rune-cell-name') - textLeft('.rune-cell-type-chip')) / scale,
          top: (control.top - rect.top) / scale,
          bottom: (rect.bottom - control.bottom) / scale
        };
      });
      expect(geometry.textOffset).toBeLessThanOrEqual(1);
      expect(geometry.top).toBeGreaterThanOrEqual(2);
      expect(geometry.bottom).toBeGreaterThanOrEqual(2);
      await canvas.screenshot({ path: info.outputPath(`field-${width}-${index}.png`) });
    }
    const trigger = row.getByRole('button', { name: 'Cardinality 1..1', exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox', { name: 'Cardinality presets' })).toBeVisible();
    await page.getByRole('option', { name: '0..1', exact: true }).click();
    await expect(row.getByRole('button', { name: 'Cardinality 0..1', exact: true })).toBeVisible();
  });
}
