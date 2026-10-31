// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test, expect } from '@playwright/test';
import { declarationNodeId, typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
import { expressionReferenceFiles } from '../../../../packages/codegen/test/helpers/cdm-reference.js';
import { expectWorkspaceHeaderBounds } from '../helpers/app-header.js';
import { captureResizeObserverErrors, expectNoResizeObserverErrors } from '../helpers/graph.js';

const source = `namespace polish
annotation marking:
 scheme string (1..1)
type Cash:
 value string (1..1)
type Security:
 value string (1..1)
choice Asset:
 Cash
 Security
enum AssetClass:
 Security
 Cash
type Payout:
 assetType AssetClass (1..1)
 underlier Asset (1..1) [marking scheme "scheme"="ISIN"]
 condition NotCash: if assetType <> AssetClass -> Security then underlier as Cash is absent
type Schedule:
 durationInYears number (0..1)
type Money:
 value number (1..1)
func Rate:
 inputs: durationInYears number (1..1)
 output: result number (1..1)
 set result: durationInYears
func Margin:
 inputs: schedule Schedule (1..1)
 output: result Money (0..1)
 alias rate: Rate(schedule -> durationInYears)
 set result -> value: rate
`;

test('long workspace names stay within the compact header at large font sizes', async ({ page }, info) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await page.goto('./');
  const name = 'cdm.base.datetime-model-authoring-base-datetime-enum-with-a-long-workspace-name';
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: `${name}.rosetta`,
    mimeType: 'text/plain',
    buffer: Buffer.from(source)
  });
  const font = page.getByRole('button', { name: /Pane font size:/ }).first();
  while ((await font.getAttribute('data-font-scale-current')) !== 'lg') await font.click();
  await dismissLocalTransportNotices(page);
  for (const width of [800, 1100, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await expectWorkspaceHeaderBounds(page);
    await expect(page.getByRole('button', { name: /^Workspace menu/ })).toHaveAccessibleName(new RegExp(name));
    await page.screenshot({ path: info.outputPath(`long-workspace-header-${width}.png`) });
  }
});

test('selected objects, compact guards, details and regenerated code remain connected', async ({ page }, info) => {
  await page.setViewportSize({ width: 1646, height: 988 });
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'polish.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await page.getByTestId('namespace-search').fill('Payout');
  await typeNavigationButton(page, 'polish.Payout').click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await page.getByRole('tab', { name: 'Conditions', exact: true }).click();
  await page
    .getByRole('region', { name: 'Condition expression' })
    .getByRole('button', { name: 'TypeScript', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: 'Generated typescript' })).toContainText('!exists(underlier as Cash)');
  await expect(page.getByRole('textbox', { name: 'Generated typescript' })).not.toContainText('typeof');
  await expect(page.getByRole('textbox', { name: 'Generated typescript' })).toContainText('AssetClass.Security');
  await page.screenshot({ path: info.outputPath('enum-member-condition.png') });
  await page.getByRole('tab', { name: 'Members', exact: true }).click();
  await page
    .locator('[data-slot="attribute-row"]')
    .nth(1)
    .getByRole('textbox', { name: /Attribute name/ })
    .focus();
  const details = page.getByRole('region', { name: 'Details: underlier', exact: true });
  await expect(details.getByRole('button', { name: 'Edit marking annotation' })).toBeVisible();
  await expect(details.getByLabel('Definition')).toHaveCSS('resize', 'vertical');
  await page.getByRole('tab', { name: 'Details', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Doc', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Meta', exact: true })).toHaveCount(0);

  await page.getByTestId('namespace-search').fill('Margin');
  await typeNavigationButton(page, 'polish.Margin', 'RosettaFunction').click();
  const implementation = page.getByRole('region', { name: 'Function implementation' });
  await expect(implementation.getByText('Implementation', { exact: true })).toHaveCount(0);
  const rune = implementation.getByTestId('implementation-editor');
  await expect(rune).toContainText('set result');
  expect((await rune.boundingBox())!.height).toBeLessThan(160);
  await implementation.getByRole('button', { name: 'TypeScript', exact: true }).click();
  const projection = implementation.getByRole('textbox', { name: 'Generated typescript' });
  await expect(projection).toContainText('Rate(schedule.durationInYears)');
  await expect(projection).not.toContainText('RuneFuncData');
  await expect(projection).not.toContainText('Argument');
  await dismissLocalTransportNotices(page);
  await page.screenshot({ path: info.outputPath('compact-typed-body.png') });

  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.getByTestId('codegen-targets-table__view-typescript').click();
  await expect(page.getByTestId('codegen-status')).toContainText('Generated');
  await expect(page.getByTestId('code-preview-editor')).toContainText('function Margin(');
  await page.getByRole('button', { name: 'Regenerate TypeScript preview' }).click();
  await expect(page.getByTestId('codegen-status')).toContainText('Generated');
  await expect(page.getByTestId('code-preview-editor')).toContainText('function Margin(');
  await expect(page.getByTestId('code-preview-editor')).toBeVisible();
  await page.screenshot({ path: info.outputPath('selected-code-regenerated.png') });
});

test('Code preview follows model and Choice types alongside their public factories across namespace files', async ({
  page
}, info) => {
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles([
    {
      name: 'other.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from('namespace aaa\ntype Party:\n name string (1..1)\n')
    },
    {
      name: 'model.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from('namespace model\ntype Party:\n name string (1..1)\nchoice Selected:\n Party\n')
    }
  ]);
  await page.getByTestId('namespace-search').fill('Party');
  await typeNavigationButton(page, 'model.Party', 'Data').click();
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.getByTestId('codegen-targets-table__view-typescript').click();
  const preview = page.getByTestId('code-preview-editor');
  await expect(page.getByTestId('codegen-relative-path')).toHaveText('model.ts');
  await expect(preview).toContainText('export type Party =');
  await page.getByRole('button', { name: 'Regenerate TypeScript preview', exact: true }).click();
  await expect(page.getByTestId('codegen-status')).toContainText('Generated');
  await expect(page.getByTestId('codegen-relative-path')).toHaveText('model.ts');
  await page.getByTestId('namespace-search').fill('Party');
  await typeNavigationButton(page, 'aaa.Party', 'Data').click();
  await expect(page.getByTestId('codegen-relative-path')).toHaveText('aaa.ts');
  await page.getByTestId('namespace-search').fill('Selected');
  await typeNavigationButton(page, 'model.Selected', 'Choice').click();
  await expect(page.getByTestId('codegen-relative-path')).toHaveText('model.ts');
  await expect(preview).toContainText('export type Selected =');
  await typeNavigationButton(page, 'model.Selected', 'Choice').click();
  await expect(preview.locator('.cm-source-reveal-line')).toContainText('export type Selected =');
  await page.screenshot({ path: info.outputPath('public-type-navigation.png') });
});

test('graph measurement and semantic zoom settle while center panes resize', async ({ page }, info) => {
  await captureResizeObserverErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles(
    expressionReferenceFiles().map(({ uri, content }) => ({
      name: uri.split('/').at(-1)!,
      mimeType: 'text/plain',
      buffer: Buffer.from(content)
    }))
  );
  await page.getByTestId('namespace-search').fill('BusinessCenters');
  await typeNavigationButton(page, 'cdm.base.datetime.BusinessCenters', 'Data').click();
  for (const name of ['Graph', 'Source', 'Inspector']) {
    const button = page.getByRole('button', { name, exact: true });
    if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  }
  const structure = page.getByRole('button', { name: 'Structure', exact: true });
  if ((await structure.getAttribute('aria-pressed')) === 'true') await structure.click();
  const stack = page.getByTestId('center-stack');
  await expect(stack).toHaveAttribute('data-count', '3');
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  for (const width of [1440, 1000, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    await stack.locator('[data-pane="inspector"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`graph-resize-${width}.png`) });
  }
  await expectNoResizeObserverErrors(page);
});

test('semantic zoom hides detail without changing measured node geometry', async ({ page }, info) => {
  await captureResizeObserverErrors(page);
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'polish.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from(source)
  });
  await typeNavigationButton(page, 'polish.Payout').click();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  const graph = page.locator('.rune-type-graph');
  const node = graph.locator(`.react-flow__node[data-id="${declarationNodeId('polish.Payout')}"]`);
  await expect(node).toBeInViewport();
  await expect(node.locator('.rune-node-body')).toBeVisible();
  const dimensions = () =>
    node.evaluate((el) => ({ width: (el as HTMLElement).offsetWidth, height: (el as HTMLElement).offsetHeight }));
  const fullSize = await dimensions();
  for (let i = 0; i < 6; i++) await graph.getByRole('button', { name: 'Zoom Out', exact: true }).click();
  await expect(graph).toHaveClass(/rune-type-graph--zoom-low/);
  await expect(node).toBeInViewport();
  await expect(node.locator('.rune-node-body')).toBeHidden();
  await expect(node.locator('.rune-node-summary')).toBeVisible();
  await expect.poll(dimensions).toEqual(fullSize);
  await page.screenshot({ path: info.outputPath('stable-low-zoom.png') });
  for (let i = 0; i < 6; i++) await graph.getByRole('button', { name: 'Zoom In', exact: true }).click();
  await expect(node.locator('.rune-node-body')).toBeVisible();
  await expect.poll(dimensions).toEqual(fullSize);
  await expectNoResizeObserverErrors(page);
});

test('graph selection stays readable when opening and resizing its companion pane', async ({ page }, info) => {
  await captureResizeObserverErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('./');
  const dense = `namespace graph.fit\ntype Counterparty:\n role string (1..1)\n${Array.from({ length: 60 }, (_, index) => `type Peer${index}:\n party Counterparty (1..1)\n`).join('')}`;
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'parties.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from(dense)
  });
  await page.getByTestId('namespace-search').fill('Counterparty');
  await typeNavigationButton(page, 'graph.fit.Counterparty').click();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  const node = page.locator(`.react-flow__node[data-id="${declarationNodeId('graph.fit.Counterparty')}"]`);
  for (const width of [1280, 1000, 1440]) {
    await page.setViewportSize({ width, height: 720 });
    await expect(node).toBeInViewport();
    await expect.poll(async () => (await node.boundingBox())?.width ?? 0).toBeGreaterThan(100);
    await page.screenshot({ path: info.outputPath(`selected-party-${width}.png`) });
  }
  await expectNoResizeObserverErrors(page);
});
