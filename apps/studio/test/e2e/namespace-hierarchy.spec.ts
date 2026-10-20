// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const declarations = [
  ['cdm.base.math', 'Unit'],
  ['cdm.base.datetime', 'Date'],
  ['cdm.product.common.schedule', 'PaymentDate'],
  ['cdm.event.common.schedule', 'PaymentDate'],
  ['fpml.shared', 'PaymentDate']
];

for (const width of [1280, 800]) {
  test(`namespace hierarchy, collision labels and selection remain usable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./');
    await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles(
      declarations.map(([namespace, name], i) => ({
        name: `hierarchy${i}.rosetta`,
        mimeType: 'text/plain',
        buffer: Buffer.from(`namespace ${namespace}\ntype ${name}:\n value string (0..1)\n`)
      }))
    );
    const explorer = page.getByTestId('namespace-explorer');
    await expect(explorer).toBeVisible();
    await dismissLocalTransportNotices(page);
    const location = explorer.getByRole('navigation', { name: 'Namespace location' });
    const focus = explorer.getByRole('button', { name: 'Focus namespace cdm.product.common.schedule', exact: true });
    await focus.focus();
    await page.keyboard.press('Enter');
    await expect(location.getByRole('button', { name: 'cdm.product.common.schedule', exact: true })).toHaveAttribute(
      'aria-current',
      'location'
    );
    await expect(explorer.getByTestId('ns-seg-fpml.shared')).toHaveCount(0);
    await typeNavigationButton(page, 'cdm.product.common.schedule.PaymentDate').click();
    const selected = explorer.locator('.studio-type-row[aria-current="true"]');
    await expect(selected).toHaveCount(1);
    await expect(selected).toContainText('PaymentDate');
    expect(await selected.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
    await location.getByRole('button', { name: 'cdm.product', exact: true }).click();
    await expect(explorer.getByTestId('ns-seg-cdm.product.common.schedule')).toContainText('common.schedule');
    await location.getByRole('button', { name: 'All', exact: true }).click();
    await expect(explorer.getByTestId('ns-seg-fpml.shared')).toBeVisible();
    await explorer.getByTestId('namespace-search').fill('PaymentDate');
    for (const qualifier of ['product.common.schedule', 'event.common.schedule', 'shared']) {
      await expect(explorer.getByRole('button', { name: `PaymentDate ${qualifier}`, exact: true })).toBeVisible();
    }
    const event = explorer.getByRole('button', { name: 'PaymentDate event.common.schedule', exact: true });
    await event.focus();
    await page.keyboard.press('Enter');
    await expect(explorer.locator('.studio-type-row[aria-current="true"]')).toContainText('event.common.schedule');
    const audit = await new AxeBuilder({ page }).include('[data-testid="namespace-explorer"]').analyze();
    expect(audit.violations).toEqual([]);
    const box = (await explorer.boundingBox())!;
    for (const button of await explorer.getByRole('button', { name: /PaymentDate / }).all()) {
      const child = (await button.boundingBox())!;
      expect(child.x).toBeGreaterThanOrEqual(box.x);
      expect(child.x + child.width).toBeLessThanOrEqual(box.x + box.width + 1);
    }
    await expect
      .poll(() => page.evaluate(() => document.getAnimations().every((a) => a.playState !== 'running')))
      .toBe(true);
    await page.screenshot({ path: info.outputPath(`namespace-${width}.png`) });
  });
}
