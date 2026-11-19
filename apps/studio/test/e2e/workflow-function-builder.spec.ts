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

async function openComposition(page: Page, content: string, name?: string) {
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
  // Dockview descendants may explicitly restore visibility; the retained
  // Explore ancestor must suppress their paint while preserving its size.
  const retained = page.locator('[data-perspective-slot="explore"]');
  await expect(retained).toHaveAttribute('inert');
  await expect(retained).toHaveCSS('opacity', '0');
  expect((await retained.boundingBox())!.width).toBeGreaterThan(0);
  if (name) await composer.getByRole('button', { name: `Open ${name} workflow`, exact: true }).click();
  await dismissLocalTransportNotices(page);
  return composer;
}

test('resizes Compose side panels without editing source or replacing the canvas', async ({ page }, info) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const composed = source
    .replace('version "1.0.0"', 'version "1.0.0"\nimport rune.studio.*')
    .replace('func Double:', 'func Double:\n [composition]');
  const composer = await openComposition(page, composed, 'Double');
  const palette = composer.getByRole('complementary', { name: 'Composition palette', exact: true });
  const details = composer.getByRole('complementary', { name: 'Composition details', exact: true });
  const canvas = composer.getByRole('region', { name: 'Composition canvas', exact: true });
  const left = composer.getByRole('separator', { name: 'Resize composition palette', exact: true });
  const right = composer.getByRole('separator', { name: 'Resize composition details', exact: true });
  const width = (panel: Locator) => panel.evaluate((element) => element.getBoundingClientRect().width);
  const original = await projectBackingFiles(page);
  await canvas.evaluate((element) => {
    element.dataset.resizeWitness = 'retained';
  });

  const initialPalette = await width(palette);
  const leftBox = (await left.boundingBox())!;
  await page.mouse.move(leftBox.x + leftBox.width / 2, leftBox.y + leftBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(leftBox.x + 80, leftBox.y + leftBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => width(palette)).toBeGreaterThan(initialPalette + 60);
  const paletteWidth = await width(palette);
  const initialDetails = await width(details);
  await right.focus();
  await right.press('ArrowLeft');
  await expect.poll(() => width(details)).toBeGreaterThan(initialDetails + 5);
  const detailsWidth = await width(details);

  for (const panel of ['palette', 'details']) {
    await composer.getByRole('button', { name: `Hide ${panel}`, exact: true }).click();
    await composer.getByRole('button', { name: `Show ${panel}`, exact: true }).click();
  }
  await expect.poll(() => width(palette)).toBeCloseTo(paletteWidth, 0);
  await expect.poll(() => width(details)).toBeCloseTo(detailsWidth, 0);
  await expect(canvas).toHaveAttribute('data-resize-witness', 'retained');
  const views = composer.getByRole('toolbar', { name: 'Composition view', exact: true });
  await views.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(views.getByRole('button', { name: 'Canvas', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(views.getByRole('button', { name: 'Source', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(composer.getByRole('region', { name: 'Composition source', exact: true })).toBeVisible();
  await expect(canvas).toHaveAttribute('data-resize-witness', 'retained');
  await page.screenshot({ path: info.outputPath('compose-shared-view-chrome.png') });
  await views.getByRole('button', { name: 'Source', exact: true }).click();
  // The last selected center view stays open, just as it does in Explore.
  await views.getByRole('button', { name: 'Canvas', exact: true }).click();
  await expect(views.getByRole('button', { name: 'Canvas', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('rail-explore').click();
  await page.getByTestId('rail-compose').click();
  await expect(canvas).toHaveAttribute('data-resize-witness', 'retained');
  await expect.poll(() => width(palette)).toBeCloseTo(paletteWidth, 0);
  expect(await projectBackingFiles(page)).toEqual(original);
  await page.screenshot({ path: info.outputPath('compose-resized-hd.png') });

  await page.reload();
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await page.getByTestId('rail-compose').click();
  await expect.poll(() => width(palette)).toBeCloseTo(paletteWidth, 0);
  await expect.poll(() => width(details)).toBeCloseTo(detailsWidth, 0);
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(composer.locator('.function-composer__body')).toHaveAttribute('data-workbench-orientation', 'vertical');
  // Narrow entry hides the palette; explicitly opening it should keep every panel reachable.
  const showPalette = composer.getByRole('button', { name: 'Show palette', exact: true });
  if (await showPalette.isVisible()) await showPalette.click();
  const height = () => palette.evaluate((element) => element.getBoundingClientRect().height);
  const initialHeight = await height();
  await left.focus();
  await left.press('ArrowDown');
  await expect.poll(height).toBeGreaterThan(initialHeight + 5);
  await expect(canvas).toBeVisible();
  await expect(details).toBeVisible();
  expect(await composer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('compose-resized-narrow.png') });
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(() => width(palette)).toBeCloseTo(paletteWidth, 0);
  expect(await projectBackingFiles(page)).toEqual(original);
});

for (const mode of ['unavailable', 'malformed'] as const) {
  test(`resizing survives ${mode} personal layout preferences`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.addInitScript((mode) => {
      const get = Storage.prototype.getItem;
      const set = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key) {
        if (key.includes('rune:split-workbench:')) {
          if (mode === 'unavailable') throw new DOMException('Preferences unavailable', 'SecurityError');
          return get.call(this, key) ?? '{malformed';
        }
        return get.call(this, key);
      };
      Storage.prototype.setItem = function (key, value) {
        if (mode === 'unavailable' && key.includes('rune:split-workbench:'))
          throw new DOMException('Preferences unavailable', 'SecurityError');
        set.call(this, key, value);
      };
    }, mode);
    const composer = await openComposition(page, source, 'Double');
    const panel = composer.getByRole('complementary', { name: 'Composition palette', exact: true });
    const width = () => panel.evaluate((element) => element.getBoundingClientRect().width);
    const before = await width();
    const divider = composer.getByRole('separator', { name: 'Resize composition palette', exact: true });
    await divider.focus();
    await divider.press('ArrowRight');
    await expect.poll(width).toBeGreaterThan(before + 5);
    const resized = await width();
    await composer.getByRole('button', { name: 'Hide palette', exact: true }).click();
    await composer.getByRole('button', { name: 'Show palette', exact: true }).click();
    await expect.poll(width).toBeCloseTo(resized, 0);
    expect((await projectBackingFiles(page))['workflow.rosetta']).toBe(source);
  });
}

test('enters Compose before selecting a function and switches between ordinary function definitions', async ({
  page
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const composer = await openComposition(page, source);
  await expect(composer).toBeVisible();
  for (const name of ['Double', 'OptionalTotal', 'Double']) {
    await composer.getByRole('button', { name: `Open ${name} workflow`, exact: true }).click();
    await expect(composer.locator('.function-composer__header > strong')).toHaveText(name);
    await expect(composer.getByRole('heading', { name: 'Ordinary Rune function', exact: true })).toBeVisible();
    await composer.getByRole('button', { name: 'Signature & details', exact: true }).click();
    await expect(composer).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('browses a compact function namespace tree and searches beyond its virtual viewport at HD', async ({
  page
}, info) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 720 });
  const library =
    source +
    `
type PalettePayload:
 value number (1..1)
enum PaletteKind:
 A
` +
    Array.from(
      { length: 125 },
      (_, i) => `
func PaletteCall${i}:
 output: result number (1..1)
 set result: ${i}
`
    ).join('');
  const composer = await openComposition(page, library);
  const palette = composer.getByRole('complementary', { name: 'Composition palette' });
  const tree = palette.getByTestId('namespace-explorer');
  const search = palette.getByRole('textbox', { name: 'Search functions and primitives' });
  const heading = palette.getByRole('heading', { name: /functions 127/i });
  await expect(heading).toBeVisible();
  await expect(heading).toHaveCSS('text-transform', 'none');
  await expect(heading).toHaveCSS('font-weight', '400');
  const headingType = await heading.evaluate((element) => {
    const probe = document.createElement('span');
    probe.style.fontFamily = 'var(--font-body)';
    element.append(probe);
    const bodyFamily = getComputedStyle(probe).fontFamily;
    probe.remove();
    const style = getComputedStyle(element);
    return { family: style.fontFamily, bodyFamily, tracking: style.letterSpacing };
  });
  expect(headingType.family).toBe(headingType.bodyFamily);
  expect(headingType.tracking).toBe('normal');
  expect((await palette.locator('.function-composer__catalog').boundingBox())!.height).toBeLessThanOrEqual(288);
  await expect(tree.getByRole('button', { name: 'Open Double workflow', exact: true })).toBeVisible();
  await expect(tree.getByRole('button', { name: 'Open PaletteCall124 workflow', exact: true })).toHaveCount(0);
  await expect(tree.getByTestId('kind-filter-pills')).toHaveCount(0);
  const namespace = tree.getByTestId('ns-seg-workflow').getByRole('button', { name: 'workflow', exact: true });
  await namespace.focus();
  await namespace.press('Enter');
  await expect(tree.getByRole('button', { name: 'Open Double workflow', exact: true })).toHaveCount(0);
  await search.fill('palettecall124');
  const last = tree.getByRole('button', { name: 'Open PaletteCall124 workflow', exact: true });
  await expect(last).toBeVisible();
  await expect(last).toHaveCSS('text-transform', 'none');
  await expect(
    tree.getByTestId('ns-type-workflow.PaletteCall124#RosettaFunction').locator('[data-slot="list-card"]')
  ).toHaveAttribute('data-variant', 'compact');
  const spacing = await palette.locator('.function-composer__catalog').evaluate((catalog) => {
    const rows = catalog.querySelectorAll('[data-slot="list-card"]');
    const last = rows[rows.length - 1]!;
    return catalog.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom;
  });
  expect(spacing).toBeLessThan(16);
  const subtitle = await tree
    .getByTestId('ns-type-workflow.PaletteCall124#RosettaFunction')
    .locator('[data-slot="list-card-description"]')
    .boundingBox();
  expect(subtitle).not.toBeNull();
  await page.mouse.click(subtitle!.x + subtitle!.width / 2, subtitle!.y + subtitle!.height / 2);
  await expect(composer.locator('.function-composer__header > strong')).toHaveText('PaletteCall124');
  await last.focus();
  await last.press('Enter');
  await expect(composer.locator('.function-composer__header > strong')).toHaveText('PaletteCall124');
  await search.clear();
  await expect(tree.getByRole('button', { name: 'Open Double workflow', exact: true })).toHaveCount(0);
  await search.fill('workflow');
  await expect(tree.getByRole('button', { name: 'Open Double workflow', exact: true })).toBeVisible();
  await search.fill('PalettePayload');
  await expect(tree.getByRole('button', { name: /^Open / })).toHaveCount(0);
  await search.fill('PaletteKind');
  await expect(tree.getByRole('button', { name: /^Open / })).toHaveCount(0);
  await search.clear();
  await namespace.press('Enter');
  await info.attach('compose-function-palette-hd', {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png'
  });
});

for (const theme of ['daikonic', 'light'])
  test(`keeps long composition names and variable tags within the workbench (${theme})`, async ({ page }, info) => {
    const name = 'Accrual' + 'Schedule'.repeat(16);
    const variable = 'calculated' + 'Amount'.repeat(24);
    await page.addInitScript((theme) => localStorage.setItem('rune-studio:theme', theme), theme);
    const composer = await openComposition(
      page,
      source.replace('version "1.0.0"', 'version "1.0.0"\nimport rune.studio.*') +
        `\nfunc ${name}:\n [composition]\n inputs: value number (1..1)\n output: result number (1..1)\n alias ${variable}: Double(value)\n set result: ${variable}\n`,
      name
    );
    await composer
      .getByRole('combobox', { name: 'Selected composition step', exact: true })
      .selectOption(`alias:${variable}`);
    const node = composer.locator(`[data-composition-step="alias:${variable}"]`);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 720 });
      await expect(composer.locator('.function-composer__header > strong')).toHaveAttribute(
        'title',
        `workflow.${name}`
      );
      await expect
        .poll(() =>
          composer.locator('.function-composer__header').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
        )
        .toBe(true);
      await expect.poll(() => node.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      const tray = composer.getByRole('region', { name: 'Available variables', exact: true });
      await expect(tray.getByRole('button').filter({ hasText: variable })).toBeVisible();
      expect(await tray.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      if (width >= 1280)
        expect(
          await composer
            .getByRole('complementary', { name: 'Composition details', exact: true })
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
        ).toBe(true);
      await node.getByRole('group', { name: `Output variables of ${variable}`, exact: true }).focus();
      expect((await new AxeBuilder({ page }).include('.function-composer').analyze()).violations).toEqual([]);
      await page.screenshot({ path: info.outputPath(`compose-long-content-${width}.png`) });
    }
  });

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

test('retains the canvas camera across Source and nested function navigation', async ({ page }) => {
  const content =
    source.replace('version "1.0.0"', 'version "1.0.0"\nimport rune.studio.*') +
    `
func SavedCamera:
 [composition]
 inputs: value number (1..1)
 output: result number (1..1)
 alias scaled: Double(value)
 set result: scaled
`;
  const composer = await openComposition(page, content, 'SavedCamera');
  await expect(composer.locator('.composition-node')).toHaveCount(3);
  await composer.getByRole('combobox', { name: 'Selected composition step', exact: true }).selectOption('alias:scaled');
  const viewport = composer.locator('.react-flow__viewport');
  const settledCamera = async () => {
    let previous = '';
    let stable = 0;
    await expect
      .poll(
        async () => {
          const current = (await viewport.getAttribute('style')) ?? '';
          stable = current && current === previous ? stable + 1 : 0;
          previous = current;
          return stable;
        },
        { intervals: [100] }
      )
      .toBeGreaterThanOrEqual(3);
    return previous;
  };
  const initial = await settledCamera();
  await composer.getByRole('button', { name: 'Zoom Out', exact: true }).click();
  const saved = await settledCamera();
  expect(saved).not.toBe(initial);

  await composer.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(viewport).toHaveCount(1);
  await settledCamera();
  await composer.getByRole('button', { name: 'Zoom Out', exact: true }).click();
  const splitCamera = await settledCamera();
  await composer.getByRole('button', { name: 'Canvas', exact: true }).click();
  await expect(viewport).toHaveCount(0);
  await composer.getByRole('button', { name: 'Canvas', exact: true }).click();
  await expect(composer.locator('.composition-node')).toHaveCount(3);
  expect(await settledCamera()).toBe(splitCamera);

  await composer.getByRole('button', { name: 'Open Double definition', exact: true }).click();
  await expect(composer.getByRole('heading', { name: 'Ordinary Rune function', exact: true })).toBeVisible();
  await composer.getByRole('button', { name: 'Parent', exact: true }).click();
  await expect(composer.locator('.composition-node')).toHaveCount(3);
  expect(await settledCamera()).toBe(splitCamera);
  expect((await projectBackingFiles(page))['workflow.rosetta']).toBe(content);
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
  await output.getByRole('button', { name: 'Edit result expression', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit result expression', exact: true });
  const textToggle = dialog.getByRole('button', { name: 'Text', exact: true });
  if (await textToggle.isVisible()) await textToggle.click();
  await dialog.getByRole('textbox', { name: 'Rune source editor', exact: true }).fill('value + 2');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(expression).toHaveValue('value + 2');
  expect((await projectBackingFiles(page))['workflow.rosetta']).toBe(content);
  await save(content.replace('set result: Constant()', 'set result: value + 2'));
  await expression.fill('Constant()');
  await save(content);
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
  await expect
    .poll(async () => {
      const selected = await composer.locator('[data-composition-step="alias:consumed"]').boundingBox();
      const canvas = await composer.locator('.react-flow').boundingBox();
      return Boolean(
        selected &&
        canvas &&
        selected.x >= canvas.x - 1 &&
        selected.y >= canvas.y - 1 &&
        selected.x + selected.width <= canvas.x + canvas.width + 1 &&
        selected.y + selected.height <= canvas.y + canvas.height + 1
      );
    })
    .toBe(true);
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

test('creates in Compose, opens Prototype on its first visit and executes reusable functions', async ({
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
  await page.getByTestId('rail-compose').click();
  await expect(page.getByTestId('prototype-perspective')).toHaveCount(0);
  if (['127.0.0.1', 'localhost'].includes(new URL(page.url()).hostname)) await dismissLocalTransportNotices(page);
  await page
    .getByRole('region', { name: 'Composition canvas', exact: true })
    .getByRole('button', { name: 'New composition', exact: true })
    .click();
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

test('drags a draft freely and binds connectors through guarded node drafts and the shared expression editor', async ({
  page
}, testInfo) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1426, height: 985 });
  const content =
    source.replace('version "1.0.0"', 'version "1.0.0"\nimport rune.studio.*') +
    `
func Pair:
 inputs:
  left number (1..1)
  right number (1..1)
 output: result number (1..1)
 set result: left + right
func Wiring:
 [composition]
 inputs:
  values number (1..*)
  extra number (1..*)
  value number (1..1)
 output: result number (1..*)
 alias scaled: Pair(value, 1)
 alias consumed: Pair(scaled, 1)
 set result: values
`;
  const composer = await openComposition(page, content, 'Wiring');
  const node = (id: string) => composer.locator(`[data-composition-step="${id}"]`);
  const port = (id: string, handle: string) => node(id).locator(`[data-handleid="${handle}"]`);
  const connect = async (sourceId: string, targetId: string, handle: string) => {
    // Retained nodes are inert until the exact edited source has linked again.
    await expect(port(sourceId, 'output')).toHaveClass(/\bconnectable\b/);
    await expect(port(targetId, handle)).toHaveClass(/\bconnectable\b/);
    await composer.getByRole('button', { name: 'Fit View', exact: true }).click();
    // Selection and node measurements can legitimately fit the camera once.
    let previous = '';
    await expect
      .poll(async () => {
        const next = JSON.stringify([
          await port(sourceId, 'output').boundingBox(),
          await port(targetId, handle).boundingBox()
        ]);
        const stable = previous === next;
        previous = next;
        return stable;
      })
      .toBe(true);
    const from = await port(sourceId, 'output').boundingBox();
    const to = await port(targetId, handle).boundingBox();
    expect(from).not.toBeNull();
    expect(to).not.toBeNull();
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 });
    await page.mouse.up();
  };
  await composer.getByRole('button', { name: 'Sort', exact: true }).click();
  await composer.getByRole('button', { name: 'Signature & details', exact: true }).click();
  const draft = node('draft:new');
  await expect(draft).toBeVisible();
  const heading = (await draft.locator('.composition-node__heading').boundingBox())!;
  const before = (await draft.boundingBox())!;
  await page.mouse.move(heading.x + 65, heading.y + heading.height / 2);
  await page.mouse.down();
  await page.mouse.move(heading.x + 165, heading.y + heading.height / 2 + 55, { steps: 24 });
  const during = (await draft.boundingBox())!;
  expect(during.x - before.x).toBeGreaterThan(80);
  expect(during.y - before.y).toBeGreaterThan(40);
  await page.mouse.up();
  await expect.poll(async () => (await draft.boundingBox())?.x).toBeCloseTo(during.x, 0);
  expect((await projectBackingFiles(page))['workflow.rosetta']).toBe(content);

  await connect('input:extra', 'draft:new', 'input');
  await expect(draft.getByRole('textbox', { name: 'step1 expression', exact: true })).toHaveValue('extra sort');
  await connect('draft:new', 'return', 'input');
  await expect(draft.getByRole('combobox', { name: 'Bind output of step1', exact: true })).toHaveValue('return');
  await expect(composer.locator('.react-flow__edge')).toHaveCount(4);
  expect((await projectBackingFiles(page))['workflow.rosetta']).toBe(content);
  await draft.getByRole('button', { name: 'Apply', exact: true }).click();
  await composer.getByRole('button', { name: 'Save', exact: true }).click();
  const bound = content.replace('\n set result: values\n', '\n set result: extra sort\n');
  await expect.poll(async () => (await projectBackingFiles(page))['workflow.rosetta']).toBe(bound);

  await composer.getByRole('combobox', { name: 'Selected composition step', exact: true }).selectOption('alias:scaled');
  const scaled = node('alias:scaled');
  await connect('input:value', 'alias:scaled', 'argument:1');
  await expect(scaled.getByRole('combobox', { name: 'scaled argument right', exact: true })).toHaveValue('input:value');
  await scaled.getByRole('combobox', { name: 'scaled right binding mode', exact: true }).selectOption('value');
  await scaled.getByRole('button', { name: 'Edit scaled right expression', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit scaled right expression', exact: true });
  await expect(dialog.getByText('Changes stay in the node draft until you choose Apply.')).toBeVisible();
  // Text mode uses the same CodeMirror editor and captured argument scope as the builder.
  const textToggle = dialog.getByRole('button', { name: 'Text', exact: true });
  if (await textToggle.isVisible()) await textToggle.click();
  const editor = dialog.getByRole('textbox', { name: 'Rune source editor', exact: true });
  await editor.fill('value + 2');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(scaled.getByRole('textbox', { name: 'scaled argument right', exact: true })).toHaveValue('value + 2');
  expect((await projectBackingFiles(page))['workflow.rosetta']).toBe(bound);
  await scaled.getByRole('button', { name: 'Apply', exact: true }).click();
  await composer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => (await projectBackingFiles(page))['workflow.rosetta'])
    .toBe(bound.replace('Pair(value, 1)', 'Pair(value, value + 2)'));

  await connect('alias:consumed', 'alias:scaled', 'argument:0');
  await expect(composer.getByRole('alert')).toContainText('cycle');
  await expect(scaled.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('compose-wired-nodes.png') });
});
