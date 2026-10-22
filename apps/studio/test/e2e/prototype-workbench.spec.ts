// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import AxeBuilder from '@axe-core/playwright';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
import { expect, test } from '@playwright/test';

const source = `namespace demo
type Party:
  name string (1..1)`;

async function createPrototype(page: Parameters<typeof test>[0]['page'], modelSource = source) {
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'demo.rosetta',
    buffer: Buffer.from(modelSource),
    mimeType: 'text/plain'
  });

  await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('rail-prototype').click();
  await expect(page.getByTestId('prototype-perspective')).toBeVisible();
  await page.getByRole('button', { name: 'New instance' }).click();
  await expect(page.getByRole('heading', { name: 'New instance' })).toBeVisible();
  await page.getByRole('button', { name: 'Instance type' }).click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Instance type' })).toContainText('Party');
  await page.getByLabel('Instance name').fill('Acme');
  await page.getByRole('button', { name: 'Create instance' }).click();

  await expect(page.getByTestId('prototype-grid').locator('tbody tr')).toHaveCount(1);
  const inspectorTab = page.getByRole('tab', { name: 'Inspector', exact: true });
  if (await inspectorTab.count()) await inspectorTab.click();
}

test('creates a prototype from the shared workspace type picker', async ({ page }) => {
  await createPrototype(page);

  const inspector = page.getByTestId('prototype-perspective');
  await expect(inspector.getByTestId('prototype-grid')).toBeVisible();
  await expect(inspector.getByRole('heading', { name: 'Acme' })).toBeVisible();
  await expect(inspector.getByLabel('Instance payload')).toContainText('{}');
});

for (const width of [1280, 700]) {
  test(`keeps fields usable with many validation errors at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await createPrototype(
      page,
      `${source}\n${Array.from({ length: 24 }, (_, index) => `  requiredField${index} string (1..1)`).join('\n')}`
    );

    const perspective = page.getByTestId('prototype-perspective');
    const form = perspective.getByRole('region', { name: 'Form preview' });
    const name = form.getByRole('textbox', { name: 'Name', exact: true });
    await expect(name).toBeInViewport();
    const formBounds = await form.boundingBox();
    const detailsBounds = await perspective.getByRole('complementary', { name: 'Instance details' }).boundingBox();
    expect(formBounds).not.toBeNull();
    expect(detailsBounds).not.toBeNull();
    if (width >= 768) expect(detailsBounds!.x).toBeGreaterThan(formBounds!.x + formBounds!.width - 1);
    else expect(detailsBounds!.y).toBeGreaterThan(formBounds!.y);
    await name.fill('Acme');
    await expect(name).toHaveValue('Acme');
    await name.click({ trial: true });
    await page.screenshot({ path: `../../dist/prototype-layout-initial-${width}.png` });

    const validation = perspective.getByRole('region', { name: 'Instance validation' });
    await expect(validation).toContainText(/24 issues/);
    const details = validation.getByText('24 issues', { exact: true });
    await details.click();
    await expect(validation.getByRole('list')).toBeVisible();
    await name.scrollIntoViewIfNeeded();
    await name.fill('Updated');
    await expect(name).toHaveValue('Updated');

    await perspective.getByRole('button', { name: 'Choose a function' }).scrollIntoViewIfNeeded();
    await expect(perspective.getByRole('button', { name: 'Choose a function' })).toBeInViewport();
    await page.screenshot({ path: `../../dist/prototype-layout-functions-${width}.png` });
    await name.scrollIntoViewIfNeeded();
    await expect(name).toHaveValue('Updated');
    await page.screenshot({ path: `../../dist/prototype-layout-form-${width}.png` });

    const lastField = form.getByRole('textbox', { name: 'Required Field23', exact: true });
    await lastField.scrollIntoViewIfNeeded();
    await lastField.fill('Reachable');
    await expect(lastField).toHaveValue('Reachable');
    await expect(validation).toContainText('23 issues');
  });
}

test('keeps the Inspector, instance grid, and payload graph reachable at a constrained width', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await createPrototype(page);

  const perspective = page.getByTestId('prototype-perspective');
  const inspectorTab = perspective.getByRole('tab', { name: 'Inspector', exact: true });
  const instancesTab = perspective.getByRole('tab', { name: 'Instances', exact: true });
  await expect(inspectorTab).toBeVisible();
  await expect(perspective.getByRole('heading', { name: 'Acme' })).toBeVisible();

  await instancesTab.click();
  await expect(perspective.getByTestId('prototype-grid')).toBeVisible();
  await perspective
    .getByTestId('prototype-grid')
    .getByRole('row', { name: /Acme.*demo\.Party/ })
    .click();
  await inspectorTab.click();
  await expect(perspective.getByRole('heading', { name: 'Acme' })).toBeVisible();

  await perspective.getByRole('button', { name: 'Payload graph', exact: true }).click();
  await perspective.getByRole('tab', { name: 'Payload graph', exact: true }).click();
  await expect(perspective.getByTestId('prototype-payload-graph')).toBeVisible();
});

for (const width of [1440, 390]) {
  test(`applies functions to the visible instance with optional parameters at ${width}px`, async ({ page }, info) => {
    test.setTimeout(90000);
    page.setDefaultTimeout(10000);
    await page.setViewportSize({ width, height: 1000 });
    await createPrototype(
      page,
      `${source}
  quantity int (1..1)
func Identity:
 inputs: party Party (1..1)
 output: result Party (1..1)
 set result: party
func Scale:
 inputs:
  party Party (1..1)
  multiplier int (1..1)
 output: result int (1..1)
 set result: party -> quantity * multiplier
`
    );
    await dismissLocalTransportNotices(page);
    const perspective = page.getByTestId('prototype-perspective');
    const form = perspective.getByRole('region', { name: 'Instance form', exact: true });
    const functions = perspective.getByRole('region', { name: 'Instance functions', exact: true });
    const details = perspective.getByRole('complementary', { name: 'Instance details' });
    await form.getByLabel('Name', { exact: true }).fill('Acme');
    await form.getByLabel('Quantity', { exact: true }).fill('5');
    const newAction = form.getByRole('button', { name: 'New…', exact: true });
    const edit = form.getByRole('button', { name: 'Edit layout', exact: true });
    const newBounds = (await newAction.boundingBox())!;
    const editBounds = (await edit.boundingBox())!;
    expect(Math.abs(newBounds.y - editBounds.y)).toBeLessThan(2);
    await functions.getByRole('button', { name: 'Choose a function' }).click();
    await page.getByRole('option', { name: /Identity/ }).click();
    await expect(functions.getByText('Using Acme as Party.')).toBeVisible({ timeout: 15000 });
    await functions.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(details.getByRole('heading', { name: 'Function result' })).toBeVisible();
    await expect(details.getByTestId('instance-payload-output')).toContainText('Acme');
    await expect(functions.getByRole('button', { name: 'Save result as instance…' })).toBeVisible();
    await functions.getByRole('button', { name: /^Choose a function/ }).click();
    await page.getByRole('option', { name: /Scale/ }).click();
    await expect(details.getByRole('heading', { name: 'Payload', exact: true })).toBeVisible();
    const extra = functions.getByRole('button', { name: 'Additional parameters' });
    await expect(extra).toHaveAttribute('aria-expanded', 'false');
    await expect(functions.getByLabel('Multiplier', { exact: true })).toHaveCount(0);
    await extra.click();
    await functions.getByLabel('Multiplier', { exact: true }).fill('3');
    await functions.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(details.getByTestId('instance-payload-output')).toHaveText('15');
    await form.getByLabel('Quantity', { exact: true }).fill('7');
    await expect(details.getByRole('heading', { name: 'Payload', exact: true })).toBeVisible();
    await functions.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(details.getByTestId('instance-payload-output')).toHaveText('21');
    await expect(form.getByLabel('Quantity', { exact: true })).toHaveValue('7');
    const dataBox = (await form.boundingBox())!;
    const functionsBox = (await functions.boundingBox())!;
    const detailsBox = (await details.boundingBox())!;
    if (width === 1440) {
      expect(functionsBox.x).toBeGreaterThanOrEqual(dataBox.x + dataBox.width - 1);
      expect(detailsBox.x).toBeGreaterThanOrEqual(functionsBox.x + functionsBox.width - 1);
    } else {
      expect(functionsBox.y).toBeGreaterThanOrEqual(dataBox.y + dataBox.height - 1);
      expect(detailsBox.y).toBeGreaterThanOrEqual(functionsBox.y + functionsBox.height - 1);
    }
    expect(await perspective.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze()).violations
    ).toEqual([]);
    await form.getByLabel('Name', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`apply-function-${width}.png`) });
    await newAction.click();
    await expect(page.getByRole('heading', { name: 'New instance', exact: true })).toBeVisible();
  });
}
