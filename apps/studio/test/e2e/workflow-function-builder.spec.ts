// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test } from '../helpers/studio-test.js';
import { projectBackingFiles, seedProjectBackingFiles } from '../helpers/project-backing.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
import { COMPOSITION_MODEL_SOURCE } from '@rune-langium/core';

const source = `namespace workflow
version "1.0.0"
func Double:
 inputs: value number (1..1)
 output: result number (1..1)
 set result: value * 2
func OptionalTotal:
 inputs: values number (0..*)
 output: result number (1..1)
 set result: values sum
`;

test('edits the shared Rune body, retains nested drafts and separates graph layout from source', async ({
  page
}, testInfo) => {
  test.setTimeout(120000);
  const composition =
    source.replace('version "1.0.0"', 'version "1.0.0"\nimport rune.studio.*') +
    `
func DoubleTwice:
 [composition]
 inputs: value number (1..1)
 output: result number (1..1)
 // retain this authored comment
 alias scaled: Double(value)
 alias again: Double(scaled)
 condition Positive: value > 0
 set result: again
 post-condition Good: result > 0

func SourceOnly:
 [composition]
 inputs: value number (1..1)
 output: result number (1..1)
 set result: value
 set result: value * 2
`;
  const composer = await openComposition(page, composition, 'DoubleTwice');
  await expect(composer.locator('.composition-node')).toHaveCount(4);
  await dismissLocalTransportNotices(page);
  await composer.getByRole('combobox', { name: 'Selected composition step', exact: true }).selectOption('input:value');
  await composer.getByRole('button', { name: 'Find calls for value', exact: true }).click();
  await expect(composer.getByRole('button', { name: 'Signatures loaded', exact: true })).toBeVisible();
  await expect(composer.getByRole('button', { name: 'Open Double workflow', exact: true })).toHaveAttribute(
    'title',
    /value: number/
  );
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await composer
    .getByRole('button', { name: 'Add Double', exact: true })
    .dispatchEvent('dragstart', { dataTransfer: transfer });
  const canvas = composer.getByRole('region', { name: 'Composition canvas', exact: true });
  const drop = (await canvas.boundingBox())!;
  await canvas
    .locator('.react-flow')
    .dispatchEvent('drop', { dataTransfer: transfer, clientX: drop.x + 100, clientY: drop.y + 100 });
  const draftNode = composer.locator('[data-composition-step="draft:new"]');
  await expect(draftNode.getByRole('combobox', { name: 'step1 argument value', exact: true })).toHaveValue(
    'input:value'
  );
  await draftNode.getByRole('button', { name: 'Discard', exact: true }).click();
  await transfer.dispose();
  const before = await projectBackingFiles(page);
  const node = composer.locator('.react-flow__node').first();
  const bounds = (await node.boundingBox())!;
  await page.mouse.move(bounds.x + 15, bounds.y + 15);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 35, bounds.y + 35, { steps: 3 });
  await page.mouse.up();
  await composer.getByRole('button', { name: 'Hide palette', exact: true }).click();
  await composer.getByRole('button', { name: 'Hide details', exact: true }).click();
  await composer.getByRole('button', { name: 'Show palette', exact: true }).click();
  await composer.getByRole('button', { name: 'Show details', exact: true }).click();
  expect(await projectBackingFiles(page)).toEqual(before);
  await composer.getByRole('combobox', { name: 'Selected composition step', exact: true }).selectOption('alias:scaled');
  const scaled = composer.locator('[data-composition-step="alias:scaled"]');
  await expect(scaled.locator('.composition-node__argument-label').first()).toContainText('(1..1)');
  await expect(composer.getByRole('button', { name: 'Output', exact: true })).toBeVisible();
  await expect(composer.locator('[data-composition-step="return"] strong')).toHaveText('Output');
  await expect(composer.getByRole('region', { name: 'Available variables', exact: true })).toBeVisible();
  await scaled.getByRole('combobox', { name: 'scaled value binding mode', exact: true }).selectOption('value');
  await scaled.getByRole('textbox', { name: 'scaled argument value', exact: true }).fill('value + 1');
  expect((await projectBackingFiles(page))['workflow.rosetta']).toBe(composition);
  await composer.getByRole('button', { name: 'Open Double definition', exact: true }).click();
  await expect(composer.getByRole('heading', { name: 'Ordinary Rune function', exact: true })).toBeVisible();
  await composer.getByRole('button', { name: 'Parent', exact: true }).click();
  await expect(scaled.getByRole('textbox', { name: 'scaled argument value', exact: true })).toHaveValue('value + 1');
  await scaled.getByRole('button', { name: 'Apply', exact: true }).click();
  await composer.getByRole('button', { name: 'Save', exact: true }).click();
  let expected = composition.replace('alias scaled: Double(value)', 'alias scaled: Double(value + 1)');
  await expect.poll(async () => (await projectBackingFiles(page))['workflow.rosetta']).toBe(expected);
  await expect(composer.locator('.composition-node')).toHaveCount(4);
  await composer.getByRole('button', { name: 'Expression', exact: true }).click();
  await draftNode.getByRole('textbox', { name: 'Output variable name', exact: true }).fill('extra');
  await draftNode.getByRole('textbox', { name: 'extra expression', exact: true }).fill('scaled + 3');
  await draftNode.getByRole('button', { name: 'Apply', exact: true }).click();
  await composer.getByRole('button', { name: 'Save', exact: true }).click();
  expected = expected.replace(
    ' condition Positive: value > 0',
    ' alias extra: scaled + 3\n condition Positive: value > 0'
  );
  await expect.poll(async () => (await projectBackingFiles(page))['workflow.rosetta']).toBe(expected);
  await expect(composer.locator('.composition-node')).toHaveCount(5);
  await composer.getByRole('button', { name: 'Add OptionalTotal', exact: true }).click();
  await expect(draftNode.locator('.composition-node__argument-label').first()).toContainText('(0..*)');
  await expect(draftNode.getByLabel('step1 argument values', { exact: true })).toHaveAttribute(
    'aria-required',
    'false'
  );
  await draftNode.getByRole('button', { name: 'Discard', exact: true }).click();
  await composer.getByRole('combobox', { name: 'Selected composition step', exact: true }).selectOption('alias:extra');
  for (const [width, height] of [
    [1280, 720],
    [1920, 1080],
    [390, 900]
  ] as const) {
    await page.setViewportSize({ width, height });
    if (width < 900) await composer.getByRole('button', { name: 'Hide palette', exact: true }).click();
    await expect(composer.locator('.composition-node')).toHaveCount(5);
    const chosenNode = composer.locator('[data-composition-step="alias:extra"]');
    await expect(chosenNode).toBeVisible();
    await expect
      .poll(
        async () => {
          const graph = await canvas.locator('.function-composer__graph').boundingBox();
          const node = await chosenNode.boundingBox();
          return (
            !!graph &&
            !!node &&
            node.x >= graph.x - 1 &&
            node.y >= graph.y - 1 &&
            node.x + node.width <= graph.x + graph.width + 1 &&
            node.y + node.height <= graph.y + graph.height + 1
          );
        },
        { message: `Selected node stays inside the ${width}×${height} canvas` }
      )
      .toBe(true);
    await expect.poll(() => composer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`compose-canvas-${width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await composer.getByRole('button', { name: 'Show palette', exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('[data-perspective-slot="compose"]')
        .evaluate((element) =>
          element.getAnimations({ subtree: true }).every((animation) => animation.playState !== 'running')
        )
    )
    .toBe(true);
  expect((await new AxeBuilder({ page }).include('.function-composer').analyze()).violations).toEqual([]);
  await page.getByTestId('rail-settings').click();
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
  await page.getByTestId('rail-compose').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await expect
    .poll(() =>
      page
        .locator('[data-perspective-slot="compose"]')
        .evaluate((element) =>
          element.getAnimations({ subtree: true }).every((animation) => animation.playState !== 'running')
        )
    )
    .toBe(true);
  expect((await new AxeBuilder({ page }).include('.function-composer').analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('compose-canvas-light-hd.png') });
  await composer.getByRole('button', { name: 'Open SourceOnly workflow', exact: true }).click();
  await expect(composer.getByRole('heading', { name: 'Source-only composition', exact: true })).toBeVisible();
  await expect(composer.getByText(/one whole-output set/)).toBeVisible();
  expect((await projectBackingFiles(page))['workflow.rosetta']).toBe(expected);
});

async function openComposition(page: Page, content: string, name: string) {
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'workflow.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await seedProjectBackingFiles(page, {
    'rune-config.yml': 'model: { name: Composition }\n',
    'build-config.yml': 'schemaVersion: 1\nsources: ["**/*.rosetta"]\ntargets: {}\n',
    'studio-config.yml': 'schemaVersion: 1\n',
    'workflow.rosetta': content,
    'model/rune/studio/composition.rosetta': COMPOSITION_MODEL_SOURCE
  });
  await page.getByTestId('rail-compose').click();
  const composer = page.getByTestId('function-composer');
  await composer.getByRole('button', { name: `Open ${name} workflow`, exact: true }).click();
  await dismissLocalTransportNotices(page);
  return composer;
}

test('offers searchable primitive starters with matching canvas icons and preserves discarded drafts', async ({
  page
}, testInfo) => {
  test.setTimeout(120000);
  const content = `namespace workflow
import rune.studio.*
func Analyze:
 [composition]
 inputs: values number (0..*)
 output: result number (0..*)
 set result: values
`;
  const composer = await openComposition(page, content, 'Analyze');
  const palette = composer.getByRole('complementary', { name: 'Composition palette', exact: true });
  const search = palette.getByRole('textbox', { name: 'Search functions and primitives', exact: true });
  const draft = composer.locator('[data-composition-step="draft:new"]');
  for (const label of [
    'Expression',
    'Branch',
    'Fallback',
    'For each',
    'Filter',
    'Sort',
    'Distinct',
    'Flatten',
    'Reduce',
    'Count',
    'Sum'
  ]) {
    const button = palette.getByRole('button', { name: label, exact: true });
    await expect(button.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    await button.click();
    await expect(draft.locator('.composition-node__heading strong')).toHaveText(label);
    await expect(draft.locator('.composition-node__icon')).toHaveAttribute('aria-hidden', 'true');
    expect((await projectBackingFiles(page))['workflow.rosetta']).toBe(content);
    await draft.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(draft).toHaveCount(0);
  }
  await search.fill('duplicate');
  await expect(palette.getByRole('button', { name: 'Distinct', exact: true })).toBeVisible();
  await expect(palette.getByRole('button', { name: 'Filter', exact: true })).toHaveCount(0);
  await search.fill('no such primitive');
  await expect(palette.getByText('No matching primitives.', { exact: true })).toBeVisible();
  await search.fill('');
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await palette
    .getByRole('button', { name: 'Filter', exact: true })
    .dispatchEvent('dragstart', { dataTransfer: transfer });
  const canvas = composer.getByRole('region', { name: 'Composition canvas', exact: true });
  const bounds = (await canvas.boundingBox())!;
  await canvas.locator('.react-flow').dispatchEvent('drop', {
    dataTransfer: transfer,
    clientX: bounds.x + 100,
    clientY: bounds.y + 100
  });
  await transfer.dispose();
  await expect(draft.locator('.composition-node__heading strong')).toHaveText('Filter');
  await draft.getByRole('textbox', { name: 'Output variable name', exact: true }).fill('chosen');
  await draft.getByRole('textbox', { name: 'chosen expression', exact: true }).fill('values filter [item > 0]');
  await draft.getByRole('button', { name: 'Apply', exact: true }).click();
  const chosen = composer.locator('[data-composition-step="alias:chosen"]');
  await expect(chosen).toHaveAttribute('data-expression-type', 'FilterOperation');
  await expect(chosen.locator('.composition-node__heading strong')).toHaveText('Filter');
  await composer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => (await projectBackingFiles(page))['workflow.rosetta'])
    .toContain('alias chosen: values filter [item > 0]');
  await chosen.getByRole('textbox', { name: 'chosen expression', exact: true }).fill('values count');
  await chosen.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(chosen).toHaveAttribute('data-expression-type', 'RosettaCountOperation');
  await expect(chosen.locator('.composition-node__heading strong')).toHaveText('Count');
  await composer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => (await projectBackingFiles(page))['workflow.rosetta'])
    .toContain('alias chosen: values count');
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(palette.locator('.function-composer__primitive-grid').first()).toBeVisible();
  await expect.poll(() => palette.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('compose-primitives-hd.png') });
});

test('replaces zero-argument calls with entered expressions and variable bindings', async ({ page }) => {
  const content = `namespace workflow
import rune.studio.*
func Constant:
 output: result number (1..1)
 set result: 7
func ReplaceConstant:
 [composition]
 inputs: value number (1..1)
 output: result number (1..1)
 set result: Constant()
`;
  const composer = await openComposition(page, content, 'ReplaceConstant');
  const output = composer.locator('[data-composition-step="return"]');
  const expression = output.getByRole('textbox', { name: 'result expression', exact: true });
  const save = async (expected: string) => {
    await output.getByRole('button', { name: 'Apply', exact: true }).click();
    await composer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await projectBackingFiles(page))['workflow.rosetta']).toBe(expected);
  };
  await expression.fill('value + 1');
  await expect(expression).toHaveValue('value + 1');
  expect((await projectBackingFiles(page))['workflow.rosetta']).toBe(content);
  await save(content.replace('set result: Constant()', 'set result: value + 1'));
  await expression.fill('Constant()');
  await save(content);
  const tray = composer.getByRole('region', { name: 'Available variables', exact: true });
  await tray
    .locator('.composition-variable-tag')
    .filter({ has: page.locator('span', { hasText: /^value$/ }) })
    .click();
  await output.getByRole('button', { name: 'Bind selected variable to result value', exact: true }).click();
  await expect(expression).toHaveValue('value');
  await save(content.replace('set result: Constant()', 'set result: value'));
  await expect(composer.getByRole('button', { name: 'Open Constant definition', exact: true })).toHaveCount(0);
});

test('binds variables on nodes, replaces existing definitions once and rejects cycles before publishing', async ({
  page
}, testInfo) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const earlier = ' // earlier variable documentation\n alias earlier: Double(value)\n';
  const later = ' // later variable documentation\n alias later: Double(value + 1)\n';
  const composition =
    source.replace('version "1.0.0"', 'version "1.0.0"\nimport rune.studio.*') +
    `
func Bindings:
 [composition]
 inputs:
  value number (1..1)
  ^first number (1..1)
 output: result number (1..1)
${earlier}${later} alias consumed: Double(earlier)
 condition Positive: value > 0
 set result: consumed
 post-condition Good: result > 0
`;
  const composer = await openComposition(page, composition, 'Bindings');
  await expect(composer.locator('.composition-node')).toHaveCount(6);
  const select = composer.getByRole('combobox', { name: 'Selected composition step', exact: true });
  await select.selectOption('alias:later');
  const tray = composer.getByRole('region', { name: 'Available variables', exact: true });
  const laterNode = composer.locator('[data-composition-step="alias:later"]');
  const save = async (expected: string) => {
    await composer.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(async () => {
      expect((await projectBackingFiles(page))['workflow.rosetta']).toBe(expected);
    }).toPass({ timeout: 5000 });
  };
  const dragVariable = async (name: string, target: Locator) => {
    const data = await page.evaluateHandle(() => new DataTransfer());
    await tray
      .locator('.composition-variable-tag')
      .filter({ has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) })
      .dispatchEvent('dragstart', { dataTransfer: data });
    await target.dispatchEvent('drop', { dataTransfer: data });
    await data.dispose();
  };
  await tray.getByRole('textbox', { name: 'Filter variables', exact: true }).fill('earlier');
  await expect(tray.locator('.composition-variable-tag')).toHaveCount(1);
  await dragVariable('earlier', laterNode.locator('[data-port-direction="output"]'));
  await expect(laterNode.getByRole('status')).toContainText('Replaces earlier');
  expect((await projectBackingFiles(page))['workflow.rosetta']).toBe(composition);
  await laterNode.getByRole('button', { name: 'Apply', exact: true }).click();
  let expected = composition.replace(earlier + later, later + earlier.replace('Double(value)', 'later'));
  await save(expected);
  await expect(composer.locator('.composition-node')).toHaveCount(5);
  await expect(laterNode.locator('.composition-node__output-tags')).toContainText('earlier');
  await expect(laterNode.locator('.composition-node__output-tags')).toContainText('later');
  await tray.getByRole('textbox', { name: 'Filter variables', exact: true }).clear();
  await dragVariable('consumed', laterNode.locator('[data-argument-index="0"]'));
  await expect(composer.getByRole('alert')).toContainText('cycle');
  expect((await projectBackingFiles(page))['workflow.rosetta']).toBe(expected);
  await dragVariable('first', laterNode.locator('[data-argument-index="0"]'));
  await laterNode.getByRole('button', { name: 'Apply', exact: true }).click();
  expected = expected.replace('Double(value + 1)', 'Double(^first)');
  await save(expected);
  // Keyboard fallback has the same source semantics as drag/drop.
  const valueTag = tray
    .locator('.composition-variable-tag')
    .filter({ has: page.locator('span', { hasText: /^value$/ }) });
  await valueTag.focus();
  await page.keyboard.press('Space');
  await laterNode.getByRole('button', { name: 'Bind selected variable to later value', exact: true }).click();
  await laterNode.getByRole('button', { name: 'Apply', exact: true }).click();
  expected = expected.replace('Double(^first)', 'Double(value)');
  await save(expected);
  await laterNode.getByRole('textbox', { name: 'New output variable for later', exact: true }).fill('cached');
  await laterNode.getByRole('button', { name: 'Apply', exact: true }).click();
  expected = expected.replace(' condition Positive:', ' alias cached: later\n condition Positive:');
  await save(expected);
  await expect(laterNode.locator('.composition-node__output-tags')).toContainText('cached');
  await select.selectOption('return');
  const returned = composer.locator('[data-composition-step="return"]');
  await dragVariable('cached', returned.locator('[data-port-direction="input"]'));
  await returned.getByRole('button', { name: 'Apply', exact: true }).click();
  expected = expected.replace('set result: consumed', 'set result: cached');
  await save(expected);
  await composer.getByRole('button', { name: 'Add Double', exact: true }).click();
  const preview = composer.locator('[data-composition-step="draft:new"]');
  await expect(preview.getByRole('combobox', { name: 'step1 argument value', exact: true })).toHaveValue('input:value');
  await preview.getByRole('combobox', { name: 'Bind output of step1', exact: true }).selectOption('alias:consumed');
  await preview.getByRole('button', { name: 'Apply', exact: true }).click();
  expected = expected.replace('alias consumed: Double(earlier)', 'alias consumed: workflow.Double(value)');
  await save(expected);
  expect(expected).not.toContain('alias step1:');
  await expect(composer.locator('.composition-node')).toHaveCount(5);
  await expect(composer.locator('.function-composer__pending')).toHaveCount(0);
  await expect(
    composer
      .locator('[data-composition-step="alias:consumed"]')
      .getByRole('combobox', { name: 'consumed argument value', exact: true })
  ).toHaveValue('input:value');
  await page.screenshot({ path: testInfo.outputPath('compose-node-bindings-hd.png') });
});

async function callStep(dialog: Locator, index: number, name: string, argument: string) {
  await dialog.getByRole('combobox', { name: `Step ${index} kind`, exact: true }).click();
  await dialog.page().getByRole('option', { name: 'Function call', exact: true }).click();
  await dialog.getByRole('button', { name: `Step ${index} function`, exact: true }).click();
  // The shared searchable picker is portalled outside the builder dialog.
  const page = dialog.page();
  await page
    .getByRole('option', { name: `${name} — ${name === 'Double' ? 'workflow' : 'local.compositions'}`, exact: true })
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
  await page.getByRole('button', { name: 'Compose function', exact: true }).click();
  const builder = page.getByRole('region', { name: 'New composition', exact: true });
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
  await expect
    .poll(() =>
      page
        .locator('[data-perspective-slot="compose"]')
        .evaluate((element) =>
          element.getAnimations({ subtree: true }).every((animation) => animation.playState !== 'running')
        )
    )
    .toBe(true);
  expect((await new AxeBuilder({ page }).include('.function-composer').analyze()).violations).toEqual([]);
  await builder.getByRole('button', { name: 'Create function', exact: true }).click();
  await expect(builder).toBeHidden();
  await expect(
    page.getByRole('region', { name: 'Composition canvas', exact: true }).locator('.composition-node')
  ).toHaveCount(4);
  await page.getByRole('button', { name: 'Try in Prototype', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Saved workflow', exact: true })).toContainText('DoubleTwice');
  await page.getByTestId('prototype-perspective').getByLabel('Value', { exact: true }).fill('3');
  await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('12');

  await page.getByRole('button', { name: 'Compose function', exact: true }).click();
  await builder.getByLabel('Function name', { exact: true }).fill('Nested');
  await builder.getByLabel('Input 1 name', { exact: true }).fill('value');
  await callStep(builder, 1, 'DoubleTwice', 'value');
  await builder.getByRole('button', { name: 'Create function', exact: true }).click();
  await expect(builder).toBeHidden();
  await page.getByRole('button', { name: 'Try in Prototype', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Saved workflow', exact: true })).toContainText('Nested');
  await page.getByTestId('prototype-perspective').getByLabel('Value', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('16');
  await page.getByRole('button', { name: 'Save workflow…', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Save workflow', exact: true })
    .getByRole('button', { name: 'Save workflow', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  const files = await projectBackingFiles(page);
  expect(files['model/workflows/local/compositions/DoubleTwice.rosetta']).toContain('alias scaled:');
  expect(files['model/workflows/local/compositions/Nested.rosetta']).toContain('local.compositions.DoubleTwice(value)');
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
  await expect(page.getByTestId('prototype-perspective').getByLabel('Value', { exact: true })).toHaveValue('4');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('16');
});
