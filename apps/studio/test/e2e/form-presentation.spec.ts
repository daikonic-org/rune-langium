// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
const source = `namespace presentation
typeAlias Amount: number
type Address:
 city string (1..1)
 postalCode string (0..1)
type Trade:
 reference string (1..1)
 amount Amount (1..1)
 fee Amount (1..1)
 quantity int (1..1)
 addresses Address (0..*)
`;
async function load(page: Page) {
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'presentation.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await page.getByTestId('ns-type-link-presentation.Trade#Data').click();
  await expect(page.getByTestId('panel-formPreview').getByLabel('Reference', { exact: true })).toBeVisible({
    timeout: 15000
  });
  await dismissLocalTransportNotices(page);
}
for (const width of [1440, 390])
  test(`form presentation drag, formatting and workspace persistence at ${width}px`, async ({ page }, info) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    await load(page);
    await page.getByRole('tab', { name: 'Form', exact: true }).dblclick();
    const form = page.getByTestId('panel-formPreview');
    await form.getByLabel('Amount', { exact: true }).fill('1234.56789');
    await form.getByLabel('Fee', { exact: true }).fill('12.3456');
    await form.getByLabel('Quantity', { exact: true }).fill('125');
    await form.getByRole('button', { name: 'Edit layout', exact: true }).click();
    const columns = form.getByRole('combobox', { name: 'Layout columns', exact: true });
    await columns.click();
    await page.getByRole('option', { name: '2 columns', exact: true }).click();
    const grid = form.locator('.preview-layout-grid').first();
    await expect(grid).toHaveCSS('--layout-columns', '1');
    const reference = form.getByRole('button', { name: 'Move Reference', exact: true });
    const start = (await reference.boundingBox())!;
    const end = (await form.locator('[data-layout-field="amount"]').boundingBox())!;
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height - 3, { steps: 12 });
    await page.mouse.up();
    await expect
      .poll(() =>
        grid
          .locator(':scope > [data-layout-field]')
          .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-layout-field')))
      )
      .toEqual(['amount', 'reference', 'fee', 'quantity', 'addresses']);
    await reference.press('ArrowDown');
    await reference.press('ArrowDown');
    await expect
      .poll(() =>
        grid
          .locator(':scope > [data-layout-field]')
          .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-layout-field')))
      )
      .toEqual(['amount', 'fee', 'quantity', 'reference', 'addresses']);
    await form.getByRole('button', { name: 'Format presentation.Amount', exact: true }).first().click();
    await page.getByRole('combobox', { name: 'Number format', exact: true }).click();
    await page.getByRole('option', { name: 'Currency', exact: true }).click();
    const format = page.locator('.preview-format-editor');
    await expect(form.getByLabel('Amount', { exact: true })).toHaveValue('$1,234.57');
    await expect(form.getByLabel('Fee', { exact: true })).toHaveValue('$12.35');
    await expect(form.getByLabel('Quantity', { exact: true })).toHaveValue('125');
    expect((await new AxeBuilder({ page }).include('.preview-format-editor').analyze()).violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(format).toBeHidden();
    await form.getByLabel('Amount', { exact: true }).focus();
    await expect(form.getByLabel('Amount', { exact: true })).toHaveValue('1234.56789');
    await form.getByLabel('Reference', { exact: true }).fill('TR-100');
    await expect(form.getByLabel('Amount', { exact: true })).toHaveValue('$1,234.57');
    await expect(form.getByTestId('sample-data-output')).toContainText('1234.56789');
    await expect(form.getByText('Valid sample', { exact: true })).toBeVisible();
    await expect(form.getByText('Saved in this workspace', { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).include('[data-testid="panel-formPreview"]').analyze()).violations).toEqual(
      []
    );
    await page.screenshot({ path: info.outputPath('layout-editing.png') });
    await form.getByRole('button', { name: 'Done editing', exact: true }).click();
    await page.reload();
    await page.getByTestId('ns-type-link-presentation.Trade#Data').click();
    await expect(form.getByLabel('Amount', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect
      .poll(() =>
        form
          .locator('.preview-layout-grid')
          .first()
          .locator(':scope > [data-layout-field]')
          .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-layout-field')))
      )
      .toEqual(['amount', 'fee', 'quantity', 'reference', 'addresses']);
    await form.getByLabel('Amount', { exact: true }).fill('1234.56789');
    await form.getByLabel('Reference', { exact: true }).click();
    await expect(form.getByLabel('Amount', { exact: true })).toHaveValue('$1,234.57');
    await page.getByTestId('rail-prototype').click();
    await page.getByRole('button', { name: 'Create example', exact: true }).click();
    await page.getByRole('button', { name: 'Example type', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search instance type' }).fill('Trade');
    await page.getByRole('option', { name: /Trade/ }).click();
    await page.getByLabel('Example name').fill('Formatted trade');
    await page.getByRole('button', { name: 'Create example', exact: true }).click();
    await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
    const prototype = page.getByTestId('prototype-perspective');
    const tab = prototype.getByRole('tab', { name: 'Inspector', exact: true });
    if (await tab.count()) await tab.click();
    const instance = prototype.getByTestId('panel-formPreview');
    await expect
      .poll(() =>
        instance
          .locator('.preview-layout-grid')
          .first()
          .locator(':scope > [data-layout-field]')
          .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-layout-field')))
      )
      .toEqual(['amount', 'fee', 'quantity', 'reference', 'addresses']);
    await expect
      .poll(() =>
        instance
          .locator('.preview-layout-grid')
          .first()
          .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
      )
      .toBe(width === 390 ? 1 : 2);
    await instance.getByLabel('Amount', { exact: true }).fill('1234.56789');
    await instance.getByLabel('Fee', { exact: true }).fill('12.3456');
    await instance.getByLabel('Quantity', { exact: true }).fill('125');
    await instance.getByLabel('Reference', { exact: true }).fill('TR-100');
    await instance.getByRole('button', { name: 'Add Addresses item', exact: true }).click();
    await instance.getByRole('button', { name: 'Open Addresses 1 details', exact: true }).click();
    const address = page.getByRole('dialog', { name: 'Addresses item 1', exact: true });
    await address.getByLabel('City', { exact: true }).fill('London');
    await address.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(instance.getByText('Valid sample', { exact: true })).toBeVisible();
    await expect(instance.getByLabel('Amount', { exact: true })).toHaveValue('$1,234.57');
    await expect(prototype.getByTestId('instance-payload-output')).toContainText('1234.56789');
    if (width === 1440) {
      await instance.getByRole('button', { name: 'Edit layout', exact: true }).click();
      await instance.getByRole('button', { name: 'Move Amount', exact: true }).scrollIntoViewIfNeeded();
      const grip = (await instance.getByRole('button', { name: 'Move Amount', exact: true }).boundingBox())!;
      const target = (await instance.getByRole('button', { name: 'Move Fee', exact: true }).boundingBox())!;
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
      await page.mouse.up();
      await expect
        .poll(() =>
          instance
            .locator('.preview-layout-grid')
            .first()
            .locator(':scope > [data-layout-field]')
            .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-layout-field')))
        )
        .toEqual(['fee', 'amount', 'quantity', 'reference', 'addresses']);
      await page.screenshot({ path: info.outputPath('prototype-layout-editing.png') });
      await instance.getByRole('button', { name: 'Done editing', exact: true }).click();
    }
    await instance.getByLabel('Amount', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('prototype-formatted.png') });
    expect(await instance.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });

test('touch handles reorder fields and root object layouts follow list items into detail views', async ({
  page
}, info) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 1000 });
  await load(page);
  const form = page.getByTestId('panel-formPreview');
  await form.getByRole('button', { name: 'Edit layout', exact: true }).click();
  const grip = (await form.getByRole('button', { name: 'Move Reference', exact: true }).boundingBox())!;
  const target = (await form.locator('[data-layout-field="amount"]').boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  const end = { x: target.x + target.width / 2, y: target.y + target.height - 3 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  for (let step = 1; step <= 8; step++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start.x + ((end.x - start.x) * step) / 8, y: start.y + ((end.y - start.y) * step) / 8 }]
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await expect
    .poll(() =>
      form
        .locator('.preview-layout-grid')
        .first()
        .locator(':scope > [data-layout-field]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-layout-field')))
    )
    .toEqual(['amount', 'reference', 'fee', 'quantity', 'addresses']);
  await page.getByTestId('ns-type-link-presentation.Address#Data').click();
  await expect(form.getByLabel('City', { exact: true })).toBeVisible();
  await expect(form.getByRole('button', { name: 'Done editing', exact: true })).toBeVisible();
  const postal = form.getByRole('button', { name: 'Move Postal Code', exact: true });
  await postal.press('ArrowUp');
  await expect(form.getByText('Saved in this workspace', { exact: true })).toBeVisible();
  await page.getByTestId('ns-type-link-presentation.Trade#Data').click();
  await expect(form.getByLabel('Reference', { exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Add Addresses item', exact: true }).click();
  await form.getByRole('button', { name: 'Open Addresses 1 details', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Addresses item 1', exact: true });
  await expect
    .poll(() =>
      dialog
        .locator('.preview-layout-grid')
        .first()
        .locator(':scope > [data-layout-field]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-layout-field')))
    )
    .toEqual(['postalCode', 'city']);
  await dialog.getByLabel('City', { exact: true }).fill('London');
  await dialog.getByLabel('Postal Code', { exact: true }).fill('E1');
  expect((await new AxeBuilder({ page }).include('.preview-detail-dialog').analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('nested-layout.png') });
  const scale = await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await expect
    .poll(() =>
      dialog.locator('.preview-detail-dialog__body').evaluate((element) => element.scrollWidth <= element.clientWidth)
    )
    .toBe(true);
  expect((await new AxeBuilder({ page }).include('.preview-detail-dialog').analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('nested-layout-large-text.png') });
  await scale.evaluate((element) => element.remove());
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(form.getByTestId('sample-data-output')).toContainText('London');
});
