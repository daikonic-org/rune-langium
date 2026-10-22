// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const source = `namespace workflow
version "1.0.0"
type Money:
 amount number (1..1)
 currency string (1..1)
func AddMoney:
 inputs:
  value Money (1..1)
  other Money (1..1)
 output:
  result Money (1..1)
 condition SameCurrency:
  value -> currency = other -> currency
 set result:
  Money { amount: value -> amount + other -> amount, currency: value -> currency }
func ScaleAmount:
 inputs:
  value Money (1..1)
  factor number (1..1)
 output:
  result Money (1..1)
 set result:
  Money { amount: value -> amount * factor, currency: value -> currency }
func Amount:
 inputs:
  value Money (1..1)
 output:
  amount number (1..1)
 set amount: value -> amount
func EchoMoney:
 inputs:
  values Money (0..*)
 output:
  result Money (0..*)
 set result: values
func EchoNotes:
 inputs:
  notes string (0..*)
 output:
  result string (0..*)
 set result: notes`;

async function openWorkflow(page: Page) {
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'workflow.rosetta', buffer: Buffer.from(source), mimeType: 'text/plain' });
  await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('rail-prototype').click();
  await expect(page.getByRole('region', { name: 'Prototype workflow' })).toBeVisible();
  await dismissLocalTransportNotices(page);
}
async function choose(page: Page, name: string) {
  await page.getByRole('button', { name: /Choose a function/ }).click();
  await page.getByRole('option', { name: `${name} — workflow`, exact: true }).click();
}
async function money(page: Page, name: string, amount: string, currency = 'USD') {
  const fields = page.getByRole('region', { name: `${name} fields`, exact: true });
  await fields.getByRole('spinbutton', { name: 'Amount', exact: true }).fill(amount);
  await fields.getByRole('textbox', { name: 'Currency', exact: true }).fill(currency);
}
async function sum(page: Page) {
  await choose(page, 'AddMoney');
  await money(page, 'value', '1250');
  await money(page, 'other', '25');
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled({ timeout: 15000 });
}

test('validates each input and function preconditions before explicit execution', async ({ page }) => {
  await openWorkflow(page);
  await sum(page);
  await expect(page.getByTestId('instance-payload-output')).toHaveCount(0);
  await page.getByRole('region', { name: 'other fields' }).getByRole('textbox', { name: 'Currency' }).fill('EUR');
  await expect(page.getByRole('button', { name: /^value: Checks passed/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^other: Checks passed/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /^AddMoney: 1 issue/ }).click();
  await expect(page.getByText(/Diagnostic:.*SameCurrency/)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('region', { name: 'other fields' }).getByRole('textbox', { name: 'Currency' }).fill('USD');
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('1275');
  await page.getByRole('region', { name: 'value fields' }).getByRole('spinbutton', { name: 'Amount' }).fill('');
  await expect(
    page.getByRole('region', { name: 'value fields' }).getByRole('spinbutton', { name: 'Amount' })
  ).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('instance-payload-output')).toHaveCount(0);
  await page.getByRole('button', { name: /^value: .*issues?/ }).click();
  await page
    .getByRole('button', { name: /value.amount:/ })
    .first()
    .click();
  await expect(
    page.getByRole('region', { name: 'value fields' }).getByRole('spinbutton', { name: 'Amount' })
  ).toBeFocused();
});

test('toggles the payload graph without resetting workflow inputs or its result', async ({ page }) => {
  await openWorkflow(page);
  await sum(page);
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('1275');
  const graph = page.getByRole('region', { name: 'Payload graph', exact: true });
  const toggle = page.getByRole('button', { name: 'Payload graph', exact: true });
  await expect(graph).toHaveCount(0);
  for (let iteration = 0; iteration < 2; iteration++) {
    await toggle.click();
    await expect(graph).toBeVisible();
    await expect(page.getByTestId('instance-payload-output')).toContainText('1275');
    await toggle.click();
    await expect(graph).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'value fields' }).getByRole('spinbutton', { name: 'Amount' })
    ).toHaveValue('1250');
    await expect(page.getByTestId('instance-payload-output')).toContainText('1275');
  }
});

test('preserves compatible input drafts and supports primitive parameters, scalar output and bypass', async ({
  page
}) => {
  await openWorkflow(page);
  await sum(page);
  await choose(page, 'ScaleAmount');
  const factor = page.getByRole('region', { name: 'ScaleAmount fields' }).getByRole('spinbutton', { name: 'Factor' });
  await factor.fill('2');
  await expect(
    page.getByRole('region', { name: 'value fields' }).getByRole('spinbutton', { name: 'Amount' })
  ).toHaveValue('1250');
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('2500');
  await choose(page, 'Amount');
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('region', { name: 'amount output' })).toContainText('number');
  await expect(page.getByTestId('instance-payload-output')).toHaveText('1250');
  await expect(page.getByRole('button', { name: 'Save as instance…' })).toHaveCount(0);
  await page.getByRole('button', { name: /Choose a function/ }).click();
  await page.getByRole('option', { name: 'Clear selection', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'input fields' }).getByRole('spinbutton', { name: 'Amount' })
  ).toHaveValue('1250');
  await expect(page.getByTestId('instance-payload-output')).toContainText('1250');
});

test('imports objects to the grid without replacing the active workflow and binds either input', async ({ page }) => {
  await openWorkflow(page);
  await sum(page);
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('1275');
  await page.getByRole('button', { name: 'Import objects…', exact: true }).click();
  await page.getByRole('button', { name: 'Imported object type', exact: true }).click();
  await page.getByRole('option', { name: 'Money — workflow', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Import JSON data', exact: true })
    .fill('[{"amount":5,"currency":"USD"},{"amount":10,"currency":"USD"}]');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByTestId('prototype-grid').locator('tbody tr')).toHaveCount(2);
  await expect(page.getByTestId('instance-payload-output')).toContainText('1275');
  await page.getByTestId('prototype-grid').getByRole('row').filter({ hasText: 'Imported Money 1' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'other Money', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'other fields' }).getByRole('spinbutton', { name: 'Amount' })
  ).toHaveValue('5');
  await money(page, 'other', '7');
  await expect(
    page.getByTestId('prototype-grid').getByRole('row').filter({ hasText: 'Imported Money 1' })
  ).toContainText(/saved/i);
});

for (const width of [1440, 700, 390])
  test(`keeps validation, layout and fields usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openWorkflow(page);
    await sum(page);
    await page.getByRole('button', { name: /^value: Checks passed/ }).click();
    await expect(page.getByRole('heading', { name: 'value · validation' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'value: Edit layout', exact: true }).click();
    await expect(page.getByRole('button', { name: 'value: Finish editing layout', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'value fields' }).getByRole('spinbutton', { name: 'Amount' })
    ).toHaveValue('1250');
    const violations = (await new AxeBuilder({ page }).include('[aria-label="Prototype workflow"]').analyze())
      .violations;
    expect(violations).toEqual([]);
    await page.screenshot({ path: `../../dist/prototype-flow-${width}.png` });
  });

test('drags a function, resizes columns and retains the workflow across perspectives', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openWorkflow(page);
  await page.getByRole('button', { name: /Choose a function/ }).click();
  const option = await page.getByRole('option', { name: 'ScaleAmount — workflow', exact: true }).boundingBox();
  const target = await page.locator('.workflow-function').boundingBox();
  expect(option).toBeTruthy();
  expect(target).toBeTruthy();
  await page.mouse.move(option!.x + 70, option!.y + 12);
  await page.mouse.down();
  await page.mouse.move(target!.x + 100, target!.y + 22, { steps: 12 });
  await page.mouse.up();
  await money(page, 'value', '1250');
  await page.getByRole('region', { name: 'ScaleAmount fields' }).getByRole('spinbutton', { name: 'Factor' }).fill('2');
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('2500');
  const divider = page.getByRole('separator', { name: 'Resize inputs and function' });
  await divider.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '22');
  await divider.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '24');
  const bounds = await divider.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 30);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 80, bounds!.y + 30, { steps: 8 });
  await page.mouse.up();
  await expect(divider).not.toHaveAttribute('aria-valuenow', '24');
  const resized = await divider.getAttribute('aria-valuenow');
  await page.getByRole('button', { name: 'Object builder', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Object builder', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.getByTestId('rail-explore').click();
  await page.getByTestId('rail-prototype').click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('2500');
  await expect(page.getByRole('button', { name: 'Object builder', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(divider).toHaveAttribute('aria-valuenow', resized!);
});

test('imports a JSON object or array into an object-list parameter without losing cardinality', async ({ page }) => {
  await openWorkflow(page);
  await choose(page, 'EchoMoney');
  async function importValues(json: string, name = 'values') {
    await page.getByRole('button', { name: `${name} node actions`, exact: true }).click();
    await page.getByRole('button', { name: 'Import input…', exact: true }).click();
    await page.getByRole('textbox', { name: 'Import JSON data', exact: true }).fill(json);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.keyboard.press('Escape');
  }
  await importValues('[{"amount":2,"currency":"USD"},{"amount":3,"currency":"EUR"}]');
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('EUR');
  expect(JSON.parse(await page.getByTestId('instance-payload-output').innerText())).toEqual([
    { amount: 2, currency: 'USD' },
    { amount: 3, currency: 'EUR' }
  ]);
  await importValues('{"amount":4,"currency":"GBP"}');
  await expect(page.getByTestId('instance-payload-output')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('GBP');
  expect(JSON.parse(await page.getByTestId('instance-payload-output').innerText())).toEqual([
    { amount: 4, currency: 'GBP' }
  ]);
  await page.getByRole('button', { name: 'values node actions', exact: true }).click();
  await page.getByRole('button', { name: 'Import input…', exact: true }).click();
  await page.getByRole('textbox', { name: 'Import JSON data', exact: true }).fill('[7]');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Import an object or an array of objects' })).toBeVisible();
  await expect(page.getByTestId('instance-payload-output')).toContainText('GBP');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await importValues('[]');
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toHaveText('[]');
  await page.getByRole('button', { name: /Choose a function/ }).click();
  await page.getByRole('option', { name: 'Clear selection', exact: true }).click();
  await choose(page, 'EchoNotes');
  await importValues('["first","second"]', 'notes');
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('second');
  expect(JSON.parse(await page.getByTestId('instance-payload-output').innerText())).toEqual(['first', 'second']);
});
