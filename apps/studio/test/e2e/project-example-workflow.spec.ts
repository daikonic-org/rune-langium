// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { CURATED_MIRROR_BASE } from '@rune-langium/curated-schema';
import { runeImplementationProject } from '../../../../test/helpers/rune-implementation-project.js';
import { projectBackingFiles } from '../helpers/project-backing.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
async function seed(page: Page, files: Record<string, string>) {
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'bootstrap.rosetta', mimeType: 'text/plain', buffer: Buffer.from('namespace bootstrap\n') });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await projectBackingFiles(page, files);
  await page.reload();
  await page.getByTestId('rail-prototype').click();
}
async function artifacts(context: BrowserContext, fixture: Awaited<ReturnType<typeof runeImplementationProject>>) {
  await context.route('**/curated/*/artifacts/**', async (route) => {
    const bytes = fixture.artifacts.get(route.request().url());
    await route.fulfill({
      status: bytes ? 200 : 404,
      body: bytes ? Buffer.from(bytes) : 'No fixture artifact',
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  });
}
test('executes a reference caller through Rune, saves both example objects and reopens the named workflow in a clone', async ({
  page,
  context,
  browser
}, info) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const fixture = await runeImplementationProject(CURATED_MIRROR_BASE);
  await artifacts(context, fixture);
  await seed(page, Object.fromEntries(fixture.files));
  const grid = page.getByTestId('prototype-grid');
  await expect(grid.getByRole('row').filter({ hasText: 'Input quote' })).toBeVisible();
  await grid.getByRole('row').filter({ hasText: 'Input quote' }).click();
  await page.getByRole('button', { name: /Choose a function/ }).click();
  await page.getByRole('option', { name: 'DoubleExample — example.local', exact: true }).click();
  const quote = page.getByRole('region', { name: 'quote fields', exact: true });
  await expect(quote.getByLabel('Amount', { exact: true })).toHaveValue('10');
  const execute = page.getByRole('button', { name: 'Execute', exact: true });
  await expect(execute).toBeEnabled();
  await execute.click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('20');
  await page.getByRole('button', { name: 'Save workflow…', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Save workflow', exact: true });
  await dialog.getByLabel('Workflow name', { exact: true }).fill('Double quote');
  await dialog.getByRole('button', { name: 'Save workflow', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'quote: Edit layout', exact: true }).click();
  await quote.getByRole('button', { name: 'Move Currency', exact: true }).press('ArrowUp');
  await quote.getByRole('button', { name: 'Format example.local.Amount', exact: true }).click();
  await page.getByRole('combobox', { name: 'Number format', exact: true }).click();
  await page.getByRole('option', { name: 'Currency', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Saved in repository', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(execute).toBeEnabled();
  await execute.click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('20');
  await page.getByRole('button', { name: 'Save as example…', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Create example', exact: true });
  await dialog.getByLabel('Example name', { exact: true }).fill('Doubled quote');
  await dialog.getByRole('button', { name: 'Create example', exact: true }).click();
  await expect(dialog).toBeHidden();
  let files: Record<string, string> = {};
  await expect
    .poll(async () => {
      files = await projectBackingFiles(page);
      return Object.keys(files).filter((path) => path.endsWith('.example.json')).length;
    })
    .toBe(2);
  const examples = Object.entries(files)
    .filter(([path]) => path.endsWith('.example.json'))
    .map(([, text]) => JSON.parse(text));
  const output = examples.find((entry) => entry.name === 'Doubled quote')!;
  expect(JSON.parse(files[output.payload]!)).toEqual({ amount: 20, currency: 'USD' });
  expect(JSON.parse(files['examples/input.json']!)).toEqual({ amount: 10, currency: 'USD' });
  const recipe = JSON.parse(Object.entries(files).find(([path]) => path.endsWith('.workflow.json'))![1]);
  expect(recipe.inputs.quote).toEqual({ kind: 'example', exampleId: 'quote-input' });
  expect(recipe).not.toHaveProperty('result');
  expect(Object.keys(files).some((path) => path.startsWith('.studio/'))).toBe(false);
  const clone = await browser.newContext({ viewport: { width: 1461, height: 988 } });
  try {
    await artifacts(clone, fixture);
    const cloned = await clone.newPage();
    await seed(cloned, files);
    await cloned.getByRole('combobox', { name: 'Saved workflow', exact: true }).click();
    await cloned.getByRole('option', { name: 'Double quote', exact: true }).click();
    await expect(cloned.getByRole('region', { name: 'quote fields', exact: true })).toBeVisible();
    await expect(cloned.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
    await cloned.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(cloned.getByTestId('instance-payload-output')).toContainText('20');
    const reopened = await projectBackingFiles(cloned);
    expect(reopened['examples/input.json']).toBe(files['examples/input.json']);
    expect(Object.keys(reopened).filter((path) => path.endsWith('.layout.json'))).toHaveLength(2);
    const layouts = Object.entries(reopened).filter(([path]) => path.endsWith('.layout.json'));
    for (const [path, text] of layouts) expect(text).toBe(files[path]);
    const amountLayout = layouts.map(([, text]) => JSON.parse(text)).find((layout) => layout.type.name === 'Amount');
    expect(amountLayout.type).toEqual({
      model: 'local',
      namespace: 'example.local',
      kind: 'RosettaTypeAlias',
      name: 'Amount'
    });
    expect(amountLayout.fields[''].format.kind).toBe('currency');
    await cloned.setViewportSize({ width: 390, height: 844 });
    await dismissLocalTransportNotices(cloned);
    expect(await cloned.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(
      (await new AxeBuilder({ page: cloned }).include('[data-testid="prototype-perspective"]').analyze()).violations
    ).toEqual([]);
    await cloned.screenshot({ path: info.outputPath('rune-first-workflow-clone.png') });
  } finally {
    await clone.close();
  }
});
