// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const source = `namespace spacing
type Address:
 city string (1..1)
 postalCode string (0..1)
type Base:
 identifier string (1..1)
type Party extends Base:
 name string (1..1)
 address Address (0..1)
type Trade:
 buyer Party (1..1)
 seller Party (1..1)
 amendments Trade (0..*)
`;

for (const width of [1323, 900, 390]) {
  test(`Structure document keeps nested fields usable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1323, height: 988 });
    await page.goto('./');
    await page
      .locator('input[type="file"][accept=".rosetta"]')
      .setInputFiles({ name: 'structure.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source) });
    await page.getByTestId('namespace-search').fill('Trade');
    await page.getByRole('button', { name: 'Navigate to Trade', exact: true }).click();
    await dismissLocalTransportNotices(page);
    if (width === 390) {
      await page.getByRole('button', { name: 'Hide Type explorer', exact: true }).click();
      await page.getByRole('button', { name: 'Hide Preview panel', exact: true }).click();
    }
    await page.setViewportSize({ width, height: 988 });
    const document = page.getByTestId('structure-view-flow');
    await document.getByRole('button', { name: 'Expand buyer', exact: true }).click();
    await document.getByRole('button', { name: 'Expand address', exact: true }).click();
    await expect(document.getByRole('region', { name: 'Address', exact: true })).toBeVisible();
    await expect
      .poll(() =>
        document.evaluate(async (element) => {
          const root = element.querySelector('.rune-structure-stage > section')!;
          const bounds = new Set<string>();
          for (let frame = 0; frame < 8; frame++) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            const box = root.getBoundingClientRect();
            bounds.add([box.x, box.y, box.width, box.height].join(','));
          }
          return bounds.size;
        })
      )
      .toBe(1);
    await expect(document.getByRole('button', { name: 'Expand seller', exact: true })).toBeVisible();
    await expect(document.locator('.react-flow')).toHaveCount(0);
    const naturalLayout = await document.evaluate((el) => ({
      overflow: el.scrollWidth - el.clientWidth,
      transform: getComputedStyle(el).transform
    }));
    expect(naturalLayout.overflow).toBeLessThanOrEqual(1);
    expect(naturalLayout.transform).toBe('none');
    const trigger = document.getByRole('button', { name: 'Cardinality 1..1', exact: true }).first();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox', { name: 'Cardinality presets' })).toBeVisible();
    await page.getByRole('option', { name: '0..1', exact: true }).click();
    await expect(document.getByRole('button', { name: 'Cardinality 0..1', exact: true }).first()).toBeVisible();
    const base = document.getByRole('button', { name: 'Base', exact: true });
    await base.focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menuitem', { name: 'Inspect type', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(base).toBeFocused();
    await expect(document.getByRole('region', { name: 'Trade', exact: true })).toBeVisible();
    const stage = document.locator('.rune-structure-stage > .rune-structure-card');
    await expect(document.locator('.rune-structure-card').first()).toHaveCSS('font-size', '13px');
    const mover = document.getByRole('group', { name: 'Trade type actions', exact: true });
    await mover.focus();
    await page.keyboard.press('ArrowRight');
    await expect(stage).toHaveCSS('translate', '8px');
    await document.getByRole('button', { name: 'Reset layout', exact: true }).click();
    await expect(stage).toHaveCSS('translate', '0px');
    if (width === 1323) {
      const bounds = (await mover.boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width - 20, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width - 20 + 24, bounds.y + bounds.height / 2 + 16, { steps: 3 });
      await page.mouse.up();
      await expect(stage).toHaveCSS('translate', '24px 16px');
      await document.getByRole('button', { name: 'Reset layout', exact: true }).click();
    }
    const address = document.getByRole('region', { name: 'Address', exact: true });
    const contentSize = await address.evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      available: (el.closest('.rune-structure-member__child')?.parentElement?.parentElement?.clientWidth ?? 136) - 16,
      overflow: el.scrollWidth - el.clientWidth
    }));
    expect(contentSize.width).toBeGreaterThanOrEqual(Math.min(120, contentSize.available));
    expect(contentSize.overflow).toBeLessThanOrEqual(1);
    const addressHeader = address.getByRole('group', { name: 'Address type actions', exact: true });
    await addressHeader.focus();
    await expect(addressHeader).toBeFocused();
    await expect(document.getByRole('button', { name: /^Resize / })).toHaveCount(0);
    await expect(address).toHaveCSS('min-height', '0px');
    const resizer = document.getByRole('separator', { name: 'Resize buyer branch', exact: true });
    if (await resizer.isVisible()) {
      const branch = resizer.locator('..');
      const row = branch.locator('..').locator(':scope > .rune-structure-member__row');
      const beforeChild = (await branch.boundingBox())!;
      const beforeRow = (await row.boundingBox())!;
      await resizer.focus();
      await page.keyboard.press('ArrowLeft');
      expect((await branch.boundingBox())!.width).toBeGreaterThan(beforeChild.width);
      const height = (await branch.boundingBox())!.height;
      await page.keyboard.press('ArrowDown');
      expect((await branch.boundingBox())!.height).toBe(height);
      await resizer.press('Home');
      const handle = (await resizer.boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + 24);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2 - 32, handle.y + 48, { steps: 3 });
      await page.mouse.up();
      const afterChild = (await branch.boundingBox())!;
      const afterRow = (await row.boundingBox())!;
      expect(afterChild.width - beforeChild.width).toBeCloseTo(32, 0);
      expect(afterRow.width).toBeCloseTo(beforeRow.width, 0);
      expect(afterChild.x).toBeCloseTo(beforeChild.x - 32, 0);
      expect(Math.abs((await resizer.boundingBox())!.x + handle.width / 2 - afterChild.x)).toBeLessThanOrEqual(1);
      const savedSplit = await resizer.getAttribute('aria-valuenow');
      await document.getByRole('button', { name: 'Collapse buyer', exact: true }).click();
      await document.getByRole('button', { name: 'Expand buyer', exact: true }).click();
      await expect(resizer).toHaveAttribute('aria-valuenow', savedSplit!);
      await resizer.press('Home');
      const childHeader = branch.locator(':scope > .rune-structure-card > header');
      const beforeMove = (await branch.boundingBox())!;
      const siblingRow = document.getByRole('button', { name: 'Expand seller', exact: true }).locator('..');
      const siblingBox = (await siblingRow.boundingBox())!;
      await childHeader.focus();
      await childHeader.press('ArrowLeft');
      await childHeader.press('ArrowDown');
      await expect.poll(async () => Math.round((await branch.boundingBox())!.x - beforeMove.x)).toBe(-8);
      expect((await branch.boundingBox())!.y - beforeMove.y).toBeCloseTo(8, 0);
      expect((await branch.boundingBox())!.width).toBeCloseTo(beforeMove.width, 0);
      expect((await siblingRow.boundingBox())!.y).toBeCloseTo(siblingBox.y, 0);
      const connector = branch.locator('..').locator(':scope > .rune-structure-connector path');
      await expect(connector).toHaveAttribute('d', /^M .+ C .+, .+, .+/);
      const handleBox = (await childHeader.boundingBox())!;
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox.x + handleBox.width / 2 - 24, handleBox.y + handleBox.height / 2 + 24, {
        steps: 3
      });
      await page.mouse.up();
      expect((await branch.boundingBox())!.x - beforeMove.x).toBeCloseTo(-32, 0);
      expect((await branch.boundingBox())!.y - beforeMove.y).toBeCloseTo(32, 0);
      const parentCanvas = branch.locator('..').locator('..');
      const parentBox = (await parentCanvas.boundingBox())!;
      const moved = (await branch.boundingBox())!;
      expect(moved.x).toBeGreaterThanOrEqual(parentBox.x);
      expect(moved.x + moved.width).toBeLessThanOrEqual(parentBox.x + parentBox.width + 1);
      expect(moved.y + moved.height).toBeLessThanOrEqual(parentBox.y + parentBox.height);
      await childHeader.press('Home');
      await document.getByRole('button', { name: 'Expand seller', exact: true }).click();
      const seller = document
        .getByRole('button', { name: 'Collapse seller', exact: true })
        .locator('..')
        .locator('..')
        .locator(':scope > .rune-structure-member__child');
      const peer = (await seller.boundingBox())!;
      await childHeader.press('ArrowDown');
      expect((await seller.boundingBox())!.y).toBeCloseTo(peer.y, 0);
      const moving = (await branch.boundingBox())!;
      const headerBounds = (await childHeader.boundingBox())!;
      await page.mouse.move(headerBounds.x + headerBounds.width / 2, headerBounds.y + headerBounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        headerBounds.x + headerBounds.width / 2,
        headerBounds.y + headerBounds.height / 2 + peer.y - moving.y,
        { steps: 6 }
      );
      await page.mouse.up();
      const placed = (await branch.boundingBox())!;
      expect(
        placed.x + placed.width + 15 <= peer.x ||
          peer.x + peer.width + 15 <= placed.x ||
          placed.y + placed.height + 15 <= peer.y ||
          peer.y + peer.height + 15 <= placed.y
      ).toBe(true);
      await document.getByRole('button', { name: 'Collapse seller', exact: true }).click();
      await childHeader.press('Shift+ArrowDown');
      await document.getByRole('button', { name: 'Expand seller', exact: true }).click();
      const reopened = (await seller.boundingBox())!;
      const kept = (await branch.boundingBox())!;
      expect(
        kept.x + kept.width + 15 <= reopened.x ||
          reopened.x + reopened.width + 15 <= kept.x ||
          kept.y + kept.height + 15 <= reopened.y ||
          reopened.y + reopened.height + 15 <= kept.y
      ).toBe(true);
      await document.getByRole('button', { name: 'Reset layout', exact: true }).click();
    } else {
      // A stacked narrow branch has no horizontal split to resize.
      await expect(resizer).toBeHidden();
    }
    await addressHeader.press('Home');
    await expect(document.getByRole('button', { name: 'Collapse buyer' })).toHaveAttribute('aria-expanded', 'true');
    const axe = await new AxeBuilder({ page }).include('.rune-structure-document').analyze();
    expect(axe.violations).toEqual([]);
    await document.screenshot({ path: info.outputPath(`structure-dom-${width}.png`) });
  });
}
