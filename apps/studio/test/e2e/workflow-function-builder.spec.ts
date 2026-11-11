// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test } from '../helpers/studio-test.js';
import { projectBackingFiles, seedProjectBackingFiles } from '../helpers/project-backing.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const source = `namespace workflow
version "1.0.0"
func Double:
 inputs: value number (1..1)
 output: result number (1..1)
 set result: value * 2
`;

async function callStep(dialog: Locator, index: number, name: string, argument: string) {
  await dialog.getByRole('combobox', { name: `Step ${index} kind`, exact: true }).click();
  await dialog.page().getByRole('option', { name: 'Function call', exact: true }).click();
  await dialog.getByRole('button', { name: `Step ${index} function`, exact: true }).click();
  // The shared searchable picker is portalled outside the builder dialog.
  const page = dialog.page();
  await page
    .getByRole('option', { name: `${name} — ${name === 'Double' ? 'workflow' : 'local.workflow'}`, exact: true })
    .click();
  await dialog.getByLabel(`Step ${index} argument value`, { exact: true }).fill(argument);
}

test('creates, executes and reuses a composed workflow function with portable source and recipes', async ({
  page
}, testInfo) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'workflow.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await seedProjectBackingFiles(page, {
    'rune-config.yml': 'model: { name: Composition }\n',
    'build-config.yml': 'schemaVersion: 1\nsources: ["**/*.rosetta"]\ntargets: {}\n',
    'studio-config.yml': 'schemaVersion: 1\n',
    'workflow.rosetta': source
  });
  await page.getByTestId('rail-prototype').click();
  if (['127.0.0.1', 'localhost'].includes(new URL(page.url()).hostname)) await dismissLocalTransportNotices(page);
  await page.getByRole('button', { name: 'Workflow builder', exact: true }).click();
  const builder = page.getByRole('dialog', { name: 'Workflow builder', exact: true });
  await builder.getByLabel('Function name', { exact: true }).fill('DoubleTwice');
  await builder.getByLabel('Input 1 name', { exact: true }).fill('value');
  await expect(builder.getByRole('button', { name: 'Input 1 type: number', exact: true })).toBeVisible();
  await builder.getByLabel('Step 1 name', { exact: true }).fill('scaled');
  await callStep(builder, 1, 'Double', 'value');
  await builder.getByRole('button', { name: 'Add step', exact: true }).click();
  await callStep(builder, 2, 'Double', 'scaled');
  await expect(builder.getByRole('region', { name: 'Rune source preview', exact: true })).toContainText(
    'workflow.Double(scaled)'
  );
  for (const [width, height] of [
    [1280, 720],
    [1920, 1080],
    [390, 900]
  ] as const) {
    await page.setViewportSize({ width, height });
    const create = builder.getByRole('button', { name: 'Create function', exact: true });
    await expect(create).toBeVisible();
    await expect(create).toBeEnabled();
    expect(await builder.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect
      .poll(() =>
        builder.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
        })
      )
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`workflow-builder-${width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
  await builder.getByRole('button', { name: 'Create function', exact: true }).click();
  await expect(builder).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Saved workflow', exact: true })).toContainText('DoubleTwice');
  await page.getByLabel('Value', { exact: true }).fill('3');
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('12');

  await page.getByRole('button', { name: 'Workflow builder', exact: true }).click();
  await builder.getByLabel('Function name', { exact: true }).fill('Nested');
  await builder.getByLabel('Input 1 name', { exact: true }).fill('value');
  await callStep(builder, 1, 'DoubleTwice', 'value');
  await builder.getByRole('button', { name: 'Create function', exact: true }).click();
  await expect(builder).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Saved workflow', exact: true })).toContainText('Nested');
  await page.getByLabel('Value', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('16');
  await page.getByRole('button', { name: 'Save workflow…', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Save workflow', exact: true })
    .getByRole('button', { name: 'Save workflow', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  const files = await projectBackingFiles(page);
  expect(files['model/workflows/local/workflow/DoubleTwice.rosetta']).toContain('alias scaled:');
  expect(files['model/workflows/local/workflow/Nested.rosetta']).toContain('local.workflow.DoubleTwice(value)');
  const recipes = Object.entries(files)
    .filter(([path]) => path.endsWith('.workflow.json'))
    .map(([, text]) => JSON.parse(text));
  expect(recipes).toHaveLength(2);
  expect(recipes.every((recipe) => recipe.steps === undefined && recipe.function.kind === 'RosettaFunction')).toBe(
    true
  );
  await page.reload();
  await page.getByTestId('rail-prototype').click();
  await page.getByRole('combobox', { name: 'Saved workflow', exact: true }).click();
  await page.getByRole('option', { name: 'Nested', exact: true }).click();
  await expect(page.getByLabel('Value', { exact: true })).toHaveValue('4');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('16');
});
