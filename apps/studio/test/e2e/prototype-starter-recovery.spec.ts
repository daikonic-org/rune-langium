// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { projectBackingFiles } from '../helpers/project-backing.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
const source = `namespace starter
version "1.0.0"
type DatedValue:
 value number (1..1)
type Schedule:
 value number (0..1)
 datedValue DatedValue (0..*)
 condition ValueOrDatedValue:
  value exists or datedValue exists
type Money:
 amount number (1..1)
func IncreaseCash:
 inputs:
  cash Schedule (1..1)
  change number (1..1)
 output:
  result Money (1..1)
 condition SingleCashValue: <"Supply a single cash value without dated values.">
  cash -> value exists and cash -> datedValue is absent
 set result: Money { amount: cash -> value + change }
func OtherInput:
 inputs:
  payment Money (1..1)
 output:
  result Money (1..1)
 set result: payment
`;
const identity = (name: string, kind = 'Data') => ({ model: 'local', namespace: 'starter', kind, name });
const width = 1440;
test(`starter validation, fresh workflows and object-only builder at ${width}px`, async ({ page }, info) => {
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width, height: 988 });
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'cash.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  const files: Record<string, string> = {
    'rune-config.yml': 'model: { name: Starter }\n',
    'build-config.yml': 'schemaVersion: 1\nsources: ["**/*.rosetta"]\ntargets: {}\n',
    'studio-config.yml': 'schemaVersion: 1\n',
    'cash.rosetta': source,
    'examples/cash.json': JSON.stringify({ value: 1000 }),
    'examples/cash.example.json': JSON.stringify({
      schemaVersion: 1,
      id: 'cash-input',
      name: 'Single cash amount',
      codec: 'JSON',
      type: identity('Schedule'),
      payload: 'examples/cash.json'
    }),
    'layouts/cash.layout.json': JSON.stringify({
      schemaVersion: 1,
      type: identity('Schedule'),
      columns: 1,
      fields: { value: { order: 0 } }
    }),
    'workflows/cash.workflow.json': JSON.stringify({
      schemaVersion: 1,
      id: 'cash',
      name: 'Increase cash',
      function: identity('IncreaseCash', 'RosettaFunction'),
      inputs: { cash: { kind: 'example', exampleId: 'cash-input' }, change: { kind: 'literal', value: 250 } },
      outputs: { result: { name: 'increasedCash', type: identity('Money') } }
    })
  };
  files['workflows/other.workflow.json'] = JSON.stringify({
    ...JSON.parse(files['workflows/cash.workflow.json']!),
    id: 'other',
    name: 'Other cash'
  });
  for (const [id, name, amount] of [
    ['bypass-a', 'Bypass A', 11],
    ['bypass-b', 'Bypass B', 22]
  ] as const)
    files[`workflows/${id}.workflow.json`] = JSON.stringify({
      schemaVersion: 1,
      id,
      name,
      inputs: { input: { kind: 'literal', value: { amount } } },
      outputs: { output: { name: 'money', type: identity('Money') } }
    });
  await projectBackingFiles(page, files);
  await page.reload();
  await page.getByTestId('rail-prototype').click();
  await dismissLocalTransportNotices(page);
  await page.getByRole('combobox', { name: 'Saved workflow', exact: true }).click();
  await page.getByRole('option', { name: 'Increase cash', exact: true }).click();
  const cash = page.getByRole('region', { name: 'cash fields', exact: true });
  await expect(cash.getByLabel('Value', { exact: true })).toHaveValue('1000');
  const execute = page.getByRole('button', { name: 'Execute', exact: true });
  await expect(execute).toBeEnabled();
  await expect(page.getByText(/presentation.*unavailable/i)).toHaveCount(0);
  await execute.click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('1250');
  await cash.getByRole('button', { name: 'Add Dated Value item', exact: true }).click();
  await cash.getByRole('button', { name: 'Open Dated Value 1 details', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Value', { exact: true }).fill('10000');
  await editor.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(execute).toBeDisabled();
  await expect(page.getByText('Supply a single cash value without dated values.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'IncreaseCash: Error details', exact: true }).click();
  await expect(page.getByLabel('SingleCashValue Rune source', { exact: true })).toContainText(
    'cash -> datedValue is absent'
  );
  await page.screenshot({ path: info.outputPath('condition-details.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'cash node actions', exact: true }).click();
  await page.getByRole('button', { name: 'Clear input', exact: true }).click();
  await page.keyboard.press('Escape');
  await page
    .getByRole('region', { name: 'IncreaseCash fields', exact: true })
    .getByLabel('Change', { exact: true })
    .fill('300');
  await page.getByRole('button', { name: 'Undo clear', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'IncreaseCash fields', exact: true }).getByLabel('Change', { exact: true })
  ).toHaveValue('300');
  await expect(cash.getByLabel('Value', { exact: true })).toHaveValue('1000');
  await page.getByRole('combobox', { name: 'Saved workflow', exact: true }).click();
  await page.getByRole('option', { name: 'Other cash', exact: true }).click();
  await page
    .getByRole('region', { name: 'IncreaseCash fields', exact: true })
    .getByLabel('Change', { exact: true })
    .fill('700');
  await page.getByRole('button', { name: 'Object builder', exact: true }).click();
  await expect(page.getByRole('button', { name: /Choose a function/ })).toHaveCount(0);
  await expect(execute).toHaveCount(0);
  await page.getByRole('button', { name: 'Choose an object type', exact: true }).click();
  await page.getByRole('option', { name: 'Money — starter', exact: true }).click();
  await page
    .getByRole('region', { name: 'input fields', exact: true })
    .getByLabel('Amount', { exact: true })
    .fill('45');
  await expect(page.getByTestId('instance-payload-output')).toContainText('45');
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Saved workflow', exact: true })).toHaveText('Other cash');
  await expect(
    page.getByRole('region', { name: 'IncreaseCash fields', exact: true }).getByLabel('Change', { exact: true })
  ).toHaveValue('700');
  await page.getByRole('combobox', { name: 'Saved workflow', exact: true }).click();
  await page.getByRole('option', { name: 'Increase cash', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'IncreaseCash fields', exact: true }).getByLabel('Change', { exact: true })
  ).toHaveValue('300');

  await expect(cash.getByLabel('Value', { exact: true })).toHaveValue('1000');
  await page.getByRole('button', { name: 'Object builder', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'input fields', exact: true }).getByLabel('Amount', { exact: true })
  ).toHaveValue('45');
  await page.screenshot({ path: info.outputPath('object-builder.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();
  await page.getByRole('button', { name: 'New workflow', exact: true }).click();
  await expect(cash).toHaveCount(0);
  await page.getByRole('button', { name: /Choose a function/ }).click();
  await expect(page.getByRole('option', { name: 'OtherInput — starter', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Choose a function/ }).click();
  await page.getByRole('option', { name: 'IncreaseCash — starter', exact: true }).click();
  await cash.getByLabel('Value', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'cash node actions', exact: true }).click();
  await page.getByRole('button', { name: 'Clear input', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Undo clear', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'cash node actions', exact: true }).click();
  await page.getByRole('button', { name: 'Import input…', exact: true }).click();
  await page.getByRole('textbox', { name: 'Import JSON data', exact: true }).fill('{"value":75}');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Undo clear', exact: true })).toHaveCount(0);
  await expect(cash.getByLabel('Value', { exact: true })).toHaveValue('75');
  // Identical source/type can still represent independent drafts in the two surfaces.
  await page.getByRole('button', { name: 'New workflow', exact: true }).click();
  await page.getByRole('cell', { name: 'Single cash amount', exact: true }).click();
  const standalone = page.getByRole('region', { name: 'input fields', exact: true });
  await expect(standalone.getByLabel('Value', { exact: true })).toHaveValue('1000');
  await page.getByRole('button', { name: 'Object builder', exact: true }).click();
  await page.getByRole('cell', { name: 'Single cash amount', exact: true }).click();
  await standalone.getByLabel('Value', { exact: true }).fill('88');
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();
  // The grid's new binding request offers to replace the retained Workflow draft.
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(standalone.getByLabel('Value', { exact: true })).toHaveValue('1000');
  await page.getByRole('button', { name: 'input node actions', exact: true }).click();
  await page.getByRole('button', { name: 'Clear input', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Undo clear', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Object builder', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo clear', exact: true })).toHaveCount(0);
  await expect(standalone.getByLabel('Value', { exact: true })).toHaveValue('88');
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();
  await expect(standalone.getByLabel('Value', { exact: true })).toHaveValue('');
  await page.getByRole('combobox', { name: 'Saved workflow', exact: true }).click();
  await page.getByRole('option', { name: 'Bypass A', exact: true }).click();
  await expect(standalone.getByLabel('Amount', { exact: true })).toHaveValue('11');
  await page.getByRole('button', { name: 'input node actions', exact: true }).click();
  await page.getByRole('button', { name: 'Clear input', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Undo clear', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Saved workflow', exact: true }).click();
  await page.getByRole('option', { name: 'Bypass B', exact: true }).click();
  await expect(standalone.getByLabel('Amount', { exact: true })).toHaveValue('22');
  await expect(page.getByRole('button', { name: 'Undo clear', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Saved workflow', exact: true }).click();
  await page.getByRole('option', { name: 'Bypass A', exact: true }).click();
  await expect(standalone.getByLabel('Amount', { exact: true })).toHaveValue('');
  await page.getByRole('combobox', { name: 'Saved workflow', exact: true }).click();
  await page.getByRole('option', { name: 'Increase cash', exact: true }).click();
  await page.getByRole('button', { name: 'cash node actions', exact: true }).click();
  await page.getByRole('button', { name: 'Clear input', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Undo clear', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Saved workflow', exact: true }).click();
  await page.getByRole('option', { name: 'Other cash', exact: true }).click();
  await expect(cash.getByLabel('Value', { exact: true })).toHaveValue('1000');
  await expect(page.getByRole('button', { name: 'Undo clear', exact: true })).toHaveCount(0);
  const saved = await projectBackingFiles(page);
  expect(saved['examples/cash.json']).toBe(files['examples/cash.json']);
  expect(saved['workflows/cash.workflow.json']).toBe(files['workflows/cash.workflow.json']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    (await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze()).violations
  ).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('fresh-workflow.png'), animations: 'disabled' });
});
