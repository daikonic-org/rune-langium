// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect } from '@playwright/test';
import { test } from '../helpers/studio-test.js';
import AxeBuilder from '@axe-core/playwright';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
import { seedProjectBackingFiles } from '../helpers/project-backing.js';

const source = `namespace density
version "1.0.0"
type Product:
${Array.from({ length: 26 }, (_, i) => ` note${i} string (0..1)`).join('\n')}
 amount number (1..1)
type Context:
 rate number (1..1)
func Calculate:
 inputs:
  product Product (1..1)
  context Context (1..1)
 output:
  result number (1..1)
 set result: product -> amount + context -> rate
`;
const name = 'Cross-check illustrative SOFR daily and index compounding for one week';

test('shows inspectable collection results and keeps nested grids usable at enlarged text', async ({ page }, info) => {
  const source = `namespace summary
version "1.0.0"
type Origin:
 name string (1..1)
type AssetIdentifier:
 identifier string (1..1)
 identifierType string (1..1)
 description string (0..1)
 registry string (0..1)
 classification string (0..1)
 active boolean (0..1)
 rank number (0..1)
type Index:
 code string (1..1)
 origin Origin (0..1)
 observationDates date (0..*)
 identifier AssetIdentifier (0..*)
 taxonomy string (0..*)
 illustrative boolean (0..1)
 offset number (0..1)
type Series:
 index Index (1..1)
 observations number (1..*)
func Echo:
 inputs: series Series (1..*)
 output: result Series (1..*)
 set result: series
`;
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'summary.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await seedProjectBackingFiles(page, {
    'rune-config.yml': 'model: { name: Summaries }\n',
    'build-config.yml': 'schemaVersion: 1\nsources: ["**/*.rosetta"]\ntargets: {}\n',
    'studio-config.yml': 'schemaVersion: 1\n',
    'summary.rosetta': source,
    'workflows/summary.workflow.json': JSON.stringify({
      schemaVersion: 1,
      id: 'summary',
      name: 'Identify supplied rate series',
      function: { model: 'local', namespace: 'summary', name: 'Echo', kind: 'RosettaFunction' },
      inputs: {
        series: {
          kind: 'literal',
          value: [
            { index: { code: 'USD-SOFR' }, observations: [0.043, 0.044] },
            {
              index: {
                code: 'GBP-SONIA',
                origin: { name: 'UK' },
                observationDates: ['2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09', '2025-01-10'],
                identifier: [
                  {
                    identifier: 'GBP-SONIA-ID',
                    identifierType: 'Other',
                    registry: 'Clearing registry',
                    classification: 'Illustrative',
                    active: true,
                    rank: 1
                  }
                ],
                taxonomy: [],
                illustrative: false,
                offset: 0
              },
              observations: [0.046]
            }
          ]
        }
      },
      outputs: { result: { name: 'series' } }
    })
  });
  await page.getByTestId('rail-prototype').click();
  if (['127.0.0.1', 'localhost'].includes(new URL(page.url()).hostname)) await dismissLocalTransportNotices(page);
  await page.getByRole('combobox', { name: 'Saved workflow', exact: true }).click();
  await page.getByRole('option', { name: 'Identify supplied rate series', exact: true }).click();
  const grid = page.getByRole('table', { name: 'Series', exact: true });
  for (const [width, height] of [
    [1280, 720],
    [1920, 1080]
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(grid.getByText('Index: USD-SOFR · Observations: 2 items', { exact: true })).toBeVisible();
    await expect(grid.getByText('Index: GBP-SONIA · Observations: 1 item', { exact: true })).toBeVisible();
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expect(grid.getByText('Index: USD-SOFR · Observations: 2 items', { exact: true })).toBeVisible();
  await grid.getByRole('button', { name: 'Open Series 2 details', exact: true }).click();
  const inputDetails = page.getByRole('dialog');
  await expect(inputDetails.getByLabel('Code', { exact: true })).toHaveValue('GBP-SONIA');
  await expect(inputDetails.getByRole('button', { name: 'Add Taxonomy item', exact: true })).toBeVisible();
  const editableDates = inputDetails.getByRole('list', { name: 'Observation Dates', exact: true });
  await expect(editableDates.getByRole('listitem')).toHaveCount(5);
  await expect(editableDates.getByLabel('Observation Dates item 1', { exact: true })).toBeVisible();
  await expect(editableDates.getByText('Observation Dates item 1', { exact: true })).toHaveClass(/sr-only/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  const output = page.getByRole('region', { name: 'series output', exact: true });
  const resultGrid = output.getByRole('table', { name: 'Result', exact: true });
  const resultData = output.getByRole('button', { name: 'Result data', exact: true });
  const functionResult = output.getByRole('button', { name: 'Function result', exact: true });
  await expect(resultData).toHaveCSS('text-transform', 'uppercase');
  await expect(functionResult).toHaveCSS('text-transform', 'uppercase');
  const json = output.getByTestId('instance-payload-output');
  await expect(resultGrid.getByText('Index: GBP-SONIA · Observations: 1 item', { exact: true })).toBeVisible();
  await expect(functionResult).toHaveAttribute('aria-expanded', 'false');
  await resultGrid.getByRole('button', { name: 'Expand Result 2 in place', exact: true }).click();
  const drilled = resultGrid.getByRole('group', { name: 'Result 2 fields', exact: true });
  await expect(drilled.getByText('UK', { exact: true })).toBeVisible();
  await expect(drilled.locator('.preview-layout-grid').first()).toHaveCSS('--requested-columns', '3');
  await resultGrid.getByRole('button', { name: 'Collapse Result 2 in place', exact: true }).click();
  await expect(drilled).toBeHidden();
  await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
  await resultGrid.getByRole('button', { name: 'Open Result 2 details', exact: true }).click();
  const details = page.getByRole('dialog');
  await expect(details.getByText('GBP-SONIA', { exact: true })).toBeVisible();
  const index = details.getByRole('group', { name: 'Index', exact: true });
  const origin = index.getByRole('group', { name: 'Origin', exact: true });
  await expect(origin).toHaveAttribute('data-alternate-surface', 'true');
  await expect(origin.getByText('UK', { exact: true })).toBeVisible();
  await expect(index.getByText('Taxonomy', { exact: true })).toHaveCount(0);
  await expect(index.getByText('false', { exact: true })).toBeVisible();
  await expect(index.getByText('0', { exact: true })).toBeVisible();
  const dates = index.getByRole('list', { name: 'Observation Dates', exact: true });
  await expect(dates).toHaveCSS('display', 'grid');
  await expect(dates.getByRole('listitem')).toHaveCount(5);
  const columns = await dates.evaluate((list) => getComputedStyle(list).gridTemplateColumns.split(' '));
  expect(columns.filter((column) => parseFloat(column) > 0).length).toBeGreaterThan(1);
  const identifiers = index.getByRole('group', { name: 'Identifier', exact: true });
  await expect(identifiers.locator(':scope > .preview-section-heading')).toHaveCount(0);
  await expect(identifiers.getByRole('columnheader', { name: 'Identifier', exact: true })).toBeVisible();
  await expect(identifiers.getByRole('columnheader', { name: 'Identifier Type', exact: true })).toBeVisible();
  await expect(identifiers.getByRole('columnheader', { name: 'Description', exact: true })).toHaveCount(0);
  expect(await origin.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toEqual(
    await index.evaluate((node) => getComputedStyle(node).backgroundColor)
  );
  await expect(details.locator('.preview-layout-grid').first()).toHaveCSS('--requested-columns', '3');
  await expect(details.getByRole('button', { name: 'Edit layout', exact: true })).toBeEnabled();
  await expect(details.getByRole('textbox')).toHaveCount(0);
  await expect(details.getByRole('button', { name: /Add|Remove/ })).toHaveCount(0);
  await details.screenshot({ path: info.outputPath('workflow-result-details.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 900 });
  const gridViewport = identifiers.locator('.preview-object-grid');
  await expect(gridViewport).toHaveAttribute('data-columns-overflow', '');
  const columnWidth = (name: string) =>
    identifiers.getByRole('columnheader', { name, exact: true }).evaluate((header) => header.clientWidth);
  expect(await columnWidth('Rank')).toBeLessThan(await columnWidth('Registry'));
  await expect
    .poll(() =>
      gridViewport.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
        return Math.abs(element.scrollLeft);
      })
    )
    .toBeGreaterThan(0);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await details.getByRole('button', { name: 'Edit layout', exact: true }).click();
  await expect(details.getByRole('button', { name: 'Move Taxonomy', exact: true })).toBeVisible();
  await details.getByRole('button', { name: 'Done editing', exact: true }).click();
  await expect(index.getByText('Taxonomy', { exact: true })).toHaveCount(0);
  await details.getByRole('button', { name: 'Done', exact: true }).click();
  await functionResult.click();
  await expect(json).toBeVisible();
  await expect(json).toContainText('GBP-SONIA');
  await resultData.click();
  await expect(resultGrid).toBeHidden();
  await expect(json).toBeVisible();
  await resultData.click();
  await functionResult.click();
  await expect(resultGrid).toBeVisible();
  await expect(json).toBeHidden();
  const library = page.getByTestId('prototype-grid');
  await expect(library).toBeVisible();
  await page.getByRole('button', { name: 'Collapse example library', exact: true }).click();
  await expect(library).toBeHidden();
  await expect(resultGrid).toBeVisible();
  await page.getByRole('button', { name: 'Expand example library', exact: true }).click();
  await expect(library).toBeVisible();
  await page.screenshot({ path: info.outputPath('workflow-result-grid.png'), animations: 'disabled' });
  expect((await new AxeBuilder({ page }).include('[aria-label="Prototype workflow"]').analyze()).violations).toEqual(
    []
  );
});

for (const [width, height] of [
  [1280, 720],
  [1920, 1080],
  [390, 900]
] as const) {
  test(`keeps long workflow forms and actions usable at ${width}x${height}`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height });
    await page.goto('./');
    await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
      name: 'density.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from(source)
    });
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await page.getByTestId('rail-prototype').click();
    if (['127.0.0.1', 'localhost'].includes(new URL(page.url()).hostname)) {
      await dismissLocalTransportNotices(page);
    }
    await page.getByRole('button', { name: /Choose a function/ }).click();
    await page.getByRole('option', { name: 'Calculate — density', exact: true }).click();
    const product = page.getByRole('region', { name: 'product fields', exact: true });
    const scroller = page.getByRole('group', { name: 'Scroll product fields', exact: true });
    const execute = page.getByRole('button', { name: 'Execute', exact: true });
    await expect(execute).toBeInViewport();
    if (width >= 1280) {
      await expect(page.getByRole('heading', { name: 'context', exact: true })).toBeInViewport();
    }
    await expect(product.locator('[data-layout-field]').first()).toHaveAttribute('data-layout-field', 'amount');
    const grid = product.locator('.preview-layout-grid').first();
    await expect(grid).toHaveCSS('--requested-columns', '3');
    await expect(grid).toHaveCSS('--layout-columns', width === 1920 ? '3' : '1');
    await product.getByLabel('Amount', { exact: true }).fill('10');
    await scroller.focus();
    await scroller.press('PageDown');
    await expect.poll(() => scroller.evaluate((n) => n.scrollTop)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Expand product fields', exact: true }).click();
    await expect(scroller).toHaveCSS('max-height', 'none');
    await page.getByRole('button', { name: 'Restore product fields height', exact: true }).click();
    await expect(scroller).not.toHaveCSS('max-height', 'none');
    await product.getByLabel('Note25', { exact: true }).fill('retained after scroll');
    await page
      .getByRole('region', { name: 'context fields', exact: true })
      .getByLabel('Rate', { exact: true })
      .fill('5');
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(page.getByTestId('instance-payload-output')).toContainText('15');
    await expect(product.getByLabel('Note25', { exact: true })).toHaveValue('retained after scroll');
    await page.getByRole('button', { name: 'Save workflow…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Save workflow', exact: true });
    await dialog.getByLabel('Workflow name').fill(name);
    await dialog.getByRole('button', { name: 'Save workflow', exact: true }).click();
    await expect(dialog).toBeHidden();
    const picker = page.getByRole('combobox', { name: 'Saved workflow', exact: true });
    await expect(picker).toContainText(name);
    expect(await picker.locator('[data-slot="select-value"]').evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(
      true
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).include('[aria-label="Prototype workflow"]').analyze();
    expect(axe.violations).toEqual([]);
  });
}
