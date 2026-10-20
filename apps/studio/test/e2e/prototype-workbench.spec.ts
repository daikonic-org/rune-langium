// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

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

    await perspective.getByRole('tab', { name: 'Functions', exact: true }).click();
    await expect(perspective.getByRole('button', { name: 'Choose a function' })).toBeInViewport();
    await page.screenshot({ path: `../../dist/prototype-layout-functions-${width}.png` });
    await perspective.getByRole('tab', { name: 'Form', exact: true }).click();
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
