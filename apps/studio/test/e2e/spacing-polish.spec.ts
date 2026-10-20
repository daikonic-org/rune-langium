// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, test, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

async function expectTypeFieldAligned(field: Locator) {
  const label = field.locator('span[id]').first();
  const reference = field.locator('[data-slot="type-reference"]');
  const left = (await label.boundingBox())!;
  const right = (await reference.boundingBox())!;
  expect(Math.abs(left.y + left.height / 2 - right.y - right.height / 2)).toBeLessThan(1);
  expect(left.x + left.width).toBeLessThanOrEqual(right.x);
}

for (const width of [1280, 800]) {
  test(`panel headers, Inspector fields and export controls share spacing at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 988 });
    await page.goto('./');
    await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
      name: 'spacing.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'namespace spacing\nfunc Run:\n inputs: amount int (1..1)\n output: result int (1..1)\n set result: amount\n'
      )
    });
    const explorer = page.getByTestId('namespace-explorer');
    const search = explorer.getByTestId('namespace-search');
    await search.fill('suppressWarnings');
    await page.getByRole('button', { name: 'Navigate to suppressWarnings', exact: true }).click();
    await page.getByRole('button', { name: 'Inspector', exact: true }).click();
    if (width === 800) await page.getByRole('button', { name: 'Hide Preview panel', exact: true }).click();
    await dismissLocalTransportNotices(page);
    const toolbar = page.getByRole('toolbar', { name: 'Center pane selector' });
    const center = (await toolbar.boundingBox())!;
    const headers = await page.locator('.dv-tabs-and-actions-container').evaluateAll((elements) =>
      elements
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > r.height && r.height > 0)
        .map((r) => ({ y: r.y, height: r.height }))
    );
    for (const header of headers.filter((r) => Math.abs(r.y - center.y) < 1)) expect(header.height).toBe(center.height);
    await expect(explorer.getByTestId('expand-all')).toHaveCount(0);
    await expect(explorer.getByTestId('collapse-all')).toHaveCount(0);
    const footer = explorer.locator('footer');
    await expect(footer.getByTestId('namespace-explorer-count')).toContainText('available');
    expect((await footer.boundingBox())!.y).toBeGreaterThan((await search.boundingBox())!.y);
    const row = page.getByRole('listitem', { name: 'Inspect capitalisation', exact: true });
    await expect(row).toBeVisible();
    const rowBox = (await row.boundingBox())!;
    const nameBox = (await row.getByText('capitalisation', { exact: true }).boundingBox())!;
    expect(rowBox.height).toBeGreaterThanOrEqual(36);
    const namePadding = await row
      .getByText('capitalisation', { exact: true })
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
    expect(nameBox.x + namePadding - rowBox.x).toBeGreaterThanOrEqual(12);
    await page.screenshot({ path: info.outputPath(`annotation-${width}.png`) });

    await search.fill('productType');
    await page.getByRole('button', { name: 'Navigate to productType', exact: true }).click();
    await expectTypeFieldAligned(page.getByRole('group', { name: 'Wrapped type', exact: true }));
    await page.screenshot({ path: info.outputPath(`wrapped-type-${width}.png`) });
    await search.fill('Run');
    await page.getByRole('button', { name: 'Navigate to Run', exact: true }).click();
    const output = page.getByRole('group', { name: 'Output Type', exact: true });
    await expectTypeFieldAligned(output);
    await expectTypeFieldAligned(page.getByRole('group', { name: 'Extends', exact: true }));
    await page.screenshot({ path: info.outputPath(`function-fields-${width}.png`) });
    const audit = await new AxeBuilder({ page }).include('[data-slot="editor-form-panel"]').analyze();
    expect(audit.violations).toEqual([]);

    await page.getByRole('button', { name: 'Export / Packaging', exact: true }).click();
    const settings = page.getByTestId('export-settings-panel');
    for (const label of ['Export target', 'Export layout']) {
      const select = settings.getByLabel(label, { exact: true });
      const control = select.locator('..');
      // Read both rectangles in one frame while the perspective entry animation runs.
      await expect
        .poll(() =>
          control.evaluate((el) => {
            const box = el.querySelector('select')!.getBoundingClientRect();
            const arrow = el.querySelector('svg')!.getBoundingClientRect();
            return Math.abs(arrow.y + arrow.height / 2 - box.y - box.height / 2);
          })
        )
        .toBeLessThan(1);
      const rightInset = await control.evaluate((el) => {
        const box = el.querySelector('select')!.getBoundingClientRect();
        const arrow = el.querySelector('svg')!.getBoundingClientRect();
        return box.right - arrow.right;
      });
      expect(rightInset).toBeGreaterThanOrEqual(8);
    }
    await settings.getByLabel('Export layout', { exact: true }).selectOption('single-file');
    await expect(settings.getByLabel('Export layout', { exact: true })).toHaveValue('single-file');
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="export-settings-panel"]').analyze()).violations
    ).toEqual([]);
    await page.screenshot({ path: info.outputPath(`export-${width}.png`) });
  });
}
