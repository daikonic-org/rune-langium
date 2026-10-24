// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect } from '@playwright/test';
import { projectBackingFiles } from '../helpers/project-backing.js';
const source = `namespace workflow
version "1.0.0"
typeAlias Amount: number
type Money:
 amount Amount (1..1)
 currency string (1..1)
func Scale:
 inputs:
  value Money (1..1)
  factor number (1..1)
 output:
  result Money (1..1)
 set result: Money { amount: value -> amount * factor, currency: value -> currency }
`;
test('explicitly saves a named recipe, restores its inputs and clones its shared monetary presentation', async ({
  page,
  browser
}) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'workflow.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await page.getByTestId('rail-prototype').click();
  await page.getByRole('button', { name: /Choose a function/ }).click();
  await page.getByRole('option', { name: 'Scale — workflow', exact: true }).click();
  const value = page.getByRole('region', { name: 'value fields', exact: true });
  await value.getByLabel('Amount', { exact: true }).fill('1250.12345');
  await value.getByLabel('Currency', { exact: true }).fill('USD');
  await page.getByLabel('Factor', { exact: true }).fill('2');
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('2500.2469');
  await page.getByRole('button', { name: 'Save workflow…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save workflow', exact: true });
  await dialog.getByLabel('Workflow name', { exact: true }).fill('Payment scenario');
  await dialog.getByRole('button', { name: 'Save workflow', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'value: Edit layout', exact: true }).click();
  await value.getByRole('button', { name: 'Move Currency', exact: true }).press('ArrowUp');
  await value.getByRole('button', { name: 'Format workflow.Amount', exact: true }).click();
  await page.getByRole('combobox', { name: 'Number format', exact: true }).click();
  await page.getByRole('option', { name: 'Currency', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  let files: Record<string, string> = {};
  await expect
    .poll(async () => {
      files = await projectBackingFiles(page);
      return Object.keys(files).filter((path) => path.endsWith('.layout.json')).length;
    })
    .toBe(2);
  const workflow = JSON.parse(Object.entries(files).find(([path]) => path.endsWith('.workflow.json'))![1]);
  expect(workflow.function).toEqual({ model: 'local', namespace: 'workflow', kind: 'RosettaFunction', name: 'Scale' });
  expect(workflow.inputs.value.value.amount).toBe(1250.12345);
  expect(workflow).not.toHaveProperty('result');
  expect(JSON.stringify(files)).not.toContain('2500.2469');
  const clone = await browser.newContext({ viewport: { width: 1461, height: 988 } });
  try {
    const copied = await clone.newPage();
    await copied.goto(page.url());
    await copied
      .locator('input[type="file"][accept=".rosetta"]')
      .setInputFiles({ name: 'workflow.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source) });
    await expect(copied.getByTestId('explore-workbench')).toBeVisible();
    await projectBackingFiles(copied, files);
    await copied.reload();
    await copied.getByTestId('rail-prototype').click();
    await copied.getByRole('combobox', { name: 'Saved workflow', exact: true }).click();
    await copied.getByRole('option', { name: 'Payment scenario', exact: true }).click();
    const restored = copied.getByRole('region', { name: 'value fields', exact: true });
    await expect(restored.getByLabel('Amount', { exact: true })).toHaveValue('$1,250.12');
    await restored.getByLabel('Amount', { exact: true }).focus();
    await expect(restored.getByLabel('Amount', { exact: true })).toHaveValue('1250.12345');
    await restored.getByLabel('Currency', { exact: true }).focus();
    await expect(copied.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
    await copied.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(copied.getByTestId('instance-payload-output')).toContainText('2500.2469');
  } finally {
    await clone.close();
  }
});

test('reviews browser presentation before creating shared files and keeps the original private preference', async ({
  page
}) => {
  test.setTimeout(90000);
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'workflow.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  const legacy = {
    layouts: { 'data:workflow.Money': { columns: 2, order: ['currency', 'amount'], spans: { amount: 1 } } },
    formats: { 'typeAlias:workflow.Amount': { style: 'currency', currency: 'EUR', grouping: true, fractionDigits: 3 } }
  };
  const key = await page.evaluate(async (legacy) => {
    const path = '/src/workspace/persistence.ts',
      settingsPath = '/src/shell/workbench-settings.ts';
    const storage = await import(path),
      settings = await import(settingsPath);
    const [workspace] = await storage.listRecents();
    const key = settings.workbenchSettingsKey(workspace.id, 'form-presentation');
    await storage.saveSetting(key, legacy);
    return key;
  }, legacy);
  await page.reload();
  await page.getByTestId('rail-prototype').click();
  await page.getByRole('button', { name: /Choose a function/ }).click();
  await page.getByRole('option', { name: 'Scale — workflow', exact: true }).click();
  const value = page.getByRole('region', { name: 'value fields', exact: true });
  await value.getByLabel('Amount', { exact: true }).fill('1250.12345');
  await value.getByLabel('Currency', { exact: true }).fill('EUR');
  await page.getByRole('button', { name: 'value: Edit layout', exact: true }).click();
  await page.getByRole('button', { name: 'Review browser presentation…', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Browser presentation migration', exact: true });
  await expect(preview).toContainText('Money');
  await expect(preview).toContainText('EUR');
  expect(Object.keys(await projectBackingFiles(page)).filter((path) => path.endsWith('.layout.json'))).toHaveLength(0);
  await preview.getByRole('button', { name: 'Save in repository', exact: true }).click();
  await expect
    .poll(
      async () => Object.keys(await projectBackingFiles(page)).filter((path) => path.endsWith('.layout.json')).length
    )
    .toBe(2);
  await value.getByLabel('Amount', { exact: true }).focus();
  await expect(value.getByLabel('Amount', { exact: true })).toHaveValue('1250.12345');
  const retained = await page.evaluate(async (key) => {
    const path = '/src/workspace/persistence.ts';
    return (await import(path)).loadSetting(key);
  }, key);
  expect(retained).toEqual(legacy);
});

test('opens bypass and peer example bindings without turning execution results into repository data', async ({
  page
}) => {
  test.setTimeout(90000);
  const add = `\nfunc AddMoney:\n inputs:\n  value Money (1..1)\n  other Money (1..1)\n output:\n  result Money (1..1)\n set result: Money { amount: value -> amount + other -> amount, currency: value -> currency }\n`;
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'workflow.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source + add) });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await page.getByTestId('rail-prototype').click();
  await page.getByRole('button', { name: 'Import examples…', exact: true }).click();
  await page.getByRole('button', { name: 'Imported object type', exact: true }).click();
  await page.getByRole('option', { name: 'Money — workflow', exact: true }).click();
  await page
    .getByLabel('Import JSON data', { exact: true })
    .fill('[{"amount":10.12345,"currency":"USD"},{"amount":20,"currency":"USD"}]');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  let files: Record<string, string> = {};
  await expect
    .poll(async () => {
      files = await projectBackingFiles(page);
      return Object.keys(files).filter((path) => path.endsWith('.example.json')).length;
    })
    .toBe(2);
  const examples = Object.entries(files)
    .filter(([path]) => path.endsWith('.example.json'))
    .map(([, text]) => JSON.parse(text))
    .sort((a, b) => a.name.localeCompare(b.name));
  const type = { model: 'local', namespace: 'workflow', kind: 'Data', name: 'Money' };
  const bypass = {
    schemaVersion: 1,
    id: 'bypass',
    name: 'Direct payload',
    inputs: { input: { kind: 'example', exampleId: examples[0].id } },
    outputs: { output: { name: 'payment', type } }
  };
  const peer = {
    schemaVersion: 1,
    id: 'peers',
    name: 'Two inputs',
    function: { ...type, kind: 'RosettaFunction', name: 'AddMoney' },
    inputs: {
      value: { kind: 'example', exampleId: examples[0].id },
      other: { kind: 'example', exampleId: examples[1].id }
    },
    outputs: { result: { name: 'payment', type } }
  };
  await projectBackingFiles(page, {
    'workflows/bypass.workflow.json': JSON.stringify(bypass),
    'workflows/peers.workflow.json': JSON.stringify(peer)
  });
  await page.reload();
  await page.getByTestId('rail-prototype').click();
  await page.getByRole('combobox', { name: 'Saved workflow', exact: true }).click();
  await page.getByRole('option', { name: 'Direct payload', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('10.12345');
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Saved workflow', exact: true }).click();
  await page.getByRole('option', { name: 'Two inputs', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'value fields', exact: true }).getByLabel('Amount', { exact: true })
  ).toHaveValue('10.12345');
  await expect(
    page.getByRole('region', { name: 'other fields', exact: true }).getByLabel('Amount', { exact: true })
  ).toHaveValue('20');
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('30.12345');
  expect((await projectBackingFiles(page))['workflows/peers.workflow.json']).toBe(JSON.stringify(peer));
});
