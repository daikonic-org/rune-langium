// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const source = `namespace workbench
version "1.0.0"
enum Status:
  Draft
  Confirmed
type Address:
  city string (1..1)
  postalCode string (0..1)
type Cash:
  currency string (1..1)
  amount number (1..1)
type Security:
  identifier string (1..1)
  quantity number (1..1)
choice Payment:
  Cash
  Security
type Party:
  name string (1..1)
  role string (0..1)
  active boolean (0..1)
  address Address (0..1)
type Agreement:
  tradeId string (1..1)
  status Status (1..1)
  effectiveDate date (0..1)
  cutoffTime time (0..1)
  observedAt zonedDateTime (0..1)
  payment Payment (1..1)
  parties Party (0..*)
  notes string (0..*)
`;
async function load(page: Page) {
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'workbench.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await page.getByTestId('ns-type-link-workbench.Agreement#Data').click();
  await expect(page.getByTestId('panel-formPreview').getByLabel('Trade Id')).toBeVisible({ timeout: 15000 });
  await dismissLocalTransportNotices(page);
}
async function exercise(page: Page, width: number) {
  const form = page.getByTestId('panel-formPreview');
  await form.getByLabel('Trade Id', { exact: true }).fill('AGR-2026-1042');
  const choice = form.getByRole('combobox', { name: 'Choose one option' });
  await choice.click();
  await page.getByRole('option', { name: 'Security', exact: true }).click();
  await form.getByLabel('Identifier', { exact: true }).fill('US0378331005');
  await form.getByLabel('Quantity', { exact: true }).fill('125');
  await form.getByLabel('Observed At', { exact: true }).fill('2026-10-11T14:30:12.123456780+05:30[Asia/Kolkata]');
  await form.getByRole('button', { name: 'Open Observed At picker' }).click();
  const timePicker = page.getByRole('dialog', { name: 'Observed At picker' });
  await timePicker.getByLabel('Observed At hour', { exact: true }).fill('15');
  await timePicker.getByRole('button', { name: 'Set time' }).click();
  await expect(form.getByLabel('Observed At', { exact: true })).toHaveValue(
    '2026-10-11T15:30:12.123456780+05:30[Asia/Kolkata]'
  );
  await expect(form.getByRole('alert').first()).toContainText('Invalid sample');
  await form.getByRole('button', { name: 'Add Parties item' }).click();
  const opener = form.getByRole('button', { name: 'Open Parties 1 details' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Parties item 1', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill('Acme Asset Management');
  await dialog.getByLabel('Role', { exact: true }).fill('Investment manager');
  await dialog.getByText('Active', { exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: 'Active', exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'Add Address', exact: true }).click();
  await dialog.getByLabel('City', { exact: true }).fill('London');
  await page.screenshot({ path: `../../dist/form-workbench-detail-${width}.png` });
  const violations = await new AxeBuilder({ page }).include('.preview-detail-dialog').analyze();
  expect(violations.violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(opener).toBeFocused();
  await expect(form.getByRole('table', { name: 'Parties' })).toContainText('Acme Asset Management');
  await form.getByRole('button', { name: 'Open Effective Date picker' }).click();
  const calendar = page.getByRole('dialog', { name: 'Effective Date picker' });
  await expect(calendar.getByRole('grid')).toBeVisible();
  const pickerViolations = await new AxeBuilder({ page }).include('[data-slot="popover-content"]').analyze();
  await page.screenshot({ path: `../../dist/form-workbench-calendar-${width}.png` });
  expect(pickerViolations.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await form.getByRole('button', { name: 'Open Cutoff Time picker' }).click();
  const clock = page.getByRole('dialog', { name: 'Cutoff Time picker' });
  await clock.getByLabel('Cutoff Time hour', { exact: true }).fill('16');
  await clock.getByLabel('Cutoff Time minute', { exact: true }).fill('45');
  await clock.getByRole('button', { name: 'Set time' }).click();
  await expect(form.getByLabel('Cutoff Time', { exact: true })).toHaveValue('16:45:00');
  await form.getByRole('button', { name: 'Add Notes item' }).click();
  await form.getByLabel('Notes item 1', { exact: true }).fill('Confirm settlement details with the counterparty.');
  await page.screenshot({ path: `../../dist/form-workbench-overview-${width}.png` });
  await form.getByLabel('Trade Id', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `../../dist/form-workbench-resting-${width}.png` });
}
for (const width of [1280, 700, 390]) {
  test(`shared form collection details and calendar at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 });
    await load(page);
    if (width < 768) {
      // Preview is a docked panel; maximize its existing group for a usable compact workbench.
      await page.getByRole('tab', { name: 'Form', exact: true }).dblclick();
    }
    await exercise(page, width);
  });
}

for (const width of [1440, 390]) {
  test(`Prototype collection details preserve the instance payload at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await load(page);
    const densityOverride =
      width === 1440
        ? await page.addStyleTag({ content: ':root { --panel-padding-inline: 16px; --panel-padding-block: 12px; }' })
        : undefined;
    if (densityOverride) {
      const previewHeader = page.getByTestId('panel-formPreview').locator(':scope > header');
      await expect(previewHeader).toHaveCSS('padding-top', '12px');
      await expect(previewHeader).toHaveCSS('padding-left', '16px');
    }
    await page.getByTestId('rail-prototype').click();
    await page.getByRole('button', { name: 'New instance', exact: true }).click();
    await page.getByRole('button', { name: 'Instance type', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search instance type' }).fill('Agreement');
    await page.getByRole('option', { name: /Agreement/ }).click();
    await page.getByLabel('Instance name').fill('Quarterly settlement');
    await page.getByRole('button', { name: 'Create instance', exact: true }).click();
    const perspective = page.getByTestId('prototype-perspective');
    const inspectorTab = perspective.getByRole('tab', { name: 'Inspector', exact: true });
    if (await inspectorTab.count()) await inspectorTab.click();
    if (densityOverride) {
      const details = perspective.getByRole('complementary', { name: 'Instance details' });
      const validation = details.getByRole('region', { name: 'Instance validation' });
      const provenance = details.getByRole('heading', { name: 'Provenance', exact: true }).locator('..');
      const payload = details.getByRole('region', { name: 'Instance payload' });
      for (const section of [validation, provenance, payload]) {
        await expect(section).toHaveCSS('padding-top', '12px');
        await expect(section).toHaveCSS('padding-bottom', '12px');
        await expect(section).toHaveCSS('padding-left', '16px');
      }
      await densityOverride.evaluate((el) => el.remove());
      for (const section of [validation, provenance, payload]) {
        await expect(section).toHaveCSS('padding-bottom', '8px');
        await expect(section).toHaveCSS('padding-left', '12px');
      }
    }
    const form = perspective.getByTestId('panel-formPreview');
    await expect(form.getByLabel('Trade Id', { exact: true })).toBeVisible();
    await form.getByRole('button', { name: 'Add Parties item' }).click();
    await form.getByRole('button', { name: 'Open Parties 1 details' }).click();
    await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Acme Asset Management');
    await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByTestId('prototype-perspective').getByTestId('instance-payload-output')).toContainText(
      'Acme Asset Management'
    );
    await page.screenshot({ path: `../../dist/form-workbench-prototype-${width}.png` });
    await form.getByLabel('Trade Id', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `../../dist/form-workbench-prototype-resting-${width}.png` });
  });
}

test('Choice Inspector shares compact gutters, chips and flat documentation', async ({ page }, info) => {
  await page.setViewportSize({ width: 1461, height: 988 });
  await load(page);
  await page.getByTestId('ns-type-link-workbench.Payment#Choice').click();
  const toggle = page.getByRole('button', { name: 'Inspector', exact: true });
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  const inspector = page.locator('[data-slot="choice-form"]');
  await expect(inspector).toBeVisible();
  const header = inspector.locator('[data-slot="type-header"]');
  const tabs = inspector.getByRole('tablist');
  const options = inspector.locator('[data-slot="choice-option-row"]');
  for (const edge of [header, tabs, options.first()]) {
    await expect.poll(async () => (await edge.boundingBox())!.x - (await inspector.boundingBox())!.x).toBe(8);
  }
  await expect(header).toHaveCSS('padding-left', '0px');
  await expect(options.first().locator('[data-slot="type-link"]')).toHaveAttribute('data-kind', 'Data');
  await expect(inspector.locator('[data-slot="type-selector"]')).toHaveCSS('height', '24px');
  await options.first().click();
  const details = inspector.getByRole('region', { name: 'Details: Cash', exact: true });
  await expect(details.getByLabel('Definition', { exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Metadata', exact: true })).toHaveCount(0);
  const annotations = details.getByText('Annotations', { exact: true });
  const documentation = details.getByText('Documentation', { exact: true });
  expect((await annotations.boundingBox())!.x).toBe((await documentation.boundingBox())!.x);
  const previewField = page.getByTestId('panel-formPreview').locator('.preview-field').first();
  await expect(previewField).toHaveCSS('row-gap', '4px');
  await page.screenshot({ path: info.outputPath('choice-inspector-polish.png') });
  expect((await new AxeBuilder({ page }).include('[data-slot="choice-form"]').analyze()).violations).toEqual([]);
});

for (const action of ['disclosure', 'ISO mode'] as const) {
  test(`a ${action} click validates an initially unchecked sample without losing the click`, async ({ page }) => {
    await page.goto('./');
    await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
      name: 'blur.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'namespace blur\ntype Child:\n note string (0..1)\ntype Probe:\n quantity int (1..1)\n child Child (1..1)\n clock time (0..1)\n'
      )
    });
    await page.getByTestId('ns-type-link-blur.Probe#Data').click();
    const form = page.getByTestId('panel-formPreview');
    const quantity = form.getByLabel('Quantity', { exact: true });
    await expect(quantity).toBeVisible();
    await dismissLocalTransportNotices(page);
    await quantity.fill('1.5');
    await expect(form.getByText('Ready to validate sample', { exact: true })).toBeVisible();
    const button = form.getByRole('button', {
      name: action === 'disclosure' ? 'Child' : 'Edit ISO value',
      exact: true
    });
    await button.click();
    if (action === 'disclosure') await expect(button).toHaveAttribute('aria-expanded', 'false');
    else await expect(form.getByRole('button', { name: 'Use picker', exact: true })).toBeVisible();
    await expect(form.getByText('Ready to validate sample', { exact: true })).toHaveCount(0);
    await expect(form.getByRole('alert').first()).toContainText('Invalid sample');
  });
}
