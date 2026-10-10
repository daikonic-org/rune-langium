// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expressionReferenceFiles } from '../../../../packages/codegen/test/helpers/cdm-reference.js';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import {
  loadPinnedFunction,
  openBuilder,
  expectCenterPaneBounds,
  enlargeDialogText
} from '../helpers/expression-workspace.js';

function captureLsp(page: Page) {
  const sent: Array<{ method?: string; params?: { textDocument?: { uri?: string } } }> = [];
  const errors: Array<{ code: number; message: string }> = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', (frame) => {
      try {
        sent.push(JSON.parse(frame.payload.toString()));
      } catch {
        /* non-JSON control frame */
      }
    });
    socket.on('framereceived', (frame) => {
      try {
        const response = JSON.parse(frame.payload.toString());
        if (response.error) errors.push(response.error);
      } catch {
        /* non-JSON control frame */
      }
    });
  });
  return { sent, errors };
}

test('lean function projections retain schema validation and shared editor spacing', async ({ page }, testInfo) => {
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'compact.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from(`namespace compact
func Run:
 inputs: amount int (1..1)
 output: result int (1..1)
 set result: 42
`)
  });
  await page.getByTestId('namespace-search').fill('Run');
  await typeNavigationButton(page, 'compact.Run', 'RosettaFunction').click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  const implementation = page.getByRole('region', { name: 'Function implementation' });
  const editor = implementation.getByTestId('implementation-editor');
  const spacing = await editor.evaluate((element) => ({
    content: getComputedStyle(element.querySelector('.cm-content')!).paddingTop,
    line: getComputedStyle(element.querySelector('.cm-line')!).paddingLeft,
    gutter: element.querySelector('.cm-gutters')?.getBoundingClientRect().width ?? 0
  }));
  expect(spacing.content).toBe('8px');
  expect(spacing.line).toBe('8px');
  expect(spacing.gutter).toBe(0);
  const initialHeight = (await editor.boundingBox())!.height;
  await implementation.getByRole('button', { name: 'Expand editor', exact: true }).click();
  await expect.poll(async () => (await editor.boundingBox())!.height).toBeGreaterThan(initialHeight);
  await implementation.getByRole('button', { name: 'Collapse editor', exact: true }).click();
  await expect.poll(async () => (await editor.boundingBox())!.height).toBe(initialHeight);
  await page.getByTestId('panel-formPreview').getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.execution-error')).toContainText('amount:');
  await page.getByLabel('Amount', { exact: true }).fill('2');
  await page.getByTestId('panel-formPreview').getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.execution-result')).toContainText('42');
  await implementation.getByRole('button', { name: 'TypeScript', exact: true }).click();
  const projection = implementation.getByRole('textbox', { name: 'Generated typescript' });
  await expect(projection).toContainText('return 42;');
  await expect(projection).not.toContainText('input =');
  await expect(projection).not.toContainText('rune.single');
  await expect(projection).not.toContainText('export function');
  await expect(implementation.locator('.cm-gutters')).toHaveCount(0);
  await testInfo.attach('body-only-projection', { body: await page.screenshot(), contentType: 'image/png' });
  await implementation.getByRole('button', { name: 'Rune', exact: true }).click();
  await implementation.getByRole('button', { name: 'Open in Source', exact: true }).click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  const source = page.getByTestId('source-editor').filter({ visible: true });
  await expect(source.locator('.cm-content')).toContainText('namespace compact');
  await testInfo.attach('compact-editor', { body: await page.screenshot(), contentType: 'image/png' });
});

test('calendar forms adapt ISO dates to native Temporal function bodies', async ({ page }, testInfo) => {
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'calendar.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from(`namespace compact
func Days:
 inputs: left date (1..1) right date (1..1)
 output: result int (1..1)
 set result: left - right
`)
  });
  await page.getByTestId('namespace-search').fill('Days');
  await typeNavigationButton(page, 'compact.Days', 'RosettaFunction').click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  const form = page.getByTestId('panel-formPreview');
  await expect(form.getByLabel('Left', { exact: true })).toHaveAttribute('type', 'date');
  await form.getByLabel('Left', { exact: true }).fill('2026-10-10');
  await form.getByLabel('Right', { exact: true }).fill('2026-10-01');
  await form.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.execution-result')).toContainText('9');
  const implementation = page.getByRole('region', { name: 'Function implementation' });
  await implementation.getByRole('button', { name: 'TypeScript', exact: true }).click();
  const projection = implementation.getByRole('textbox', { name: 'Generated typescript' });
  await expect(projection).toContainText('input.right.until(input.left).days');
  await expect(projection).not.toContainText('rune.');
  await expect(projection).not.toContainText('.from(');
  await expect(projection).not.toContainText('export function');
  await testInfo.attach('calendar-body', { body: await page.screenshot(), contentType: 'image/png' });
});

for (const baseFirst of [false, true]) {
  test(`split-file dispatch edits and projects the base with base first=${baseFirst}`, async ({ page }, testInfo) => {
    const lsp = captureLsp(page);
    await page.goto('./');
    const base = {
      name: 'base.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from(`namespace test.dispatch
enum Kind:
 Cash
func Compute:
 inputs: kind Kind (1..1)
          amount int (1..1)
 output: result int (1..1)
 set result: amount
`)
    };
    const variant = {
      name: 'variant.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from(`namespace test.dispatch
func Compute(kind: Kind -> Cash):
 set result: amount + 1
`)
    };
    await page
      .locator('input[type="file"][accept=".rosetta"]')
      .setInputFiles(baseFirst ? [base, variant] : [variant, base]);
    await page.getByTestId('namespace-search').fill('Compute');
    await typeNavigationButton(page, 'test.dispatch.Compute', 'RosettaFunction').click();
    await page.getByRole('button', { name: 'Inspector', exact: true }).click();
    const implementation = page.getByRole('region', { name: 'Function implementation' });
    const editor = implementation.getByTestId('implementation-editor').locator('.cm-content');
    await expect(editor).toContainText('set result: amount');
    await expect(editor).not.toContainText('amount + 1');
    await editor.press('ControlOrMeta+a');
    await page.keyboard.insertText(' set result: amount + 10');
    await expect(editor).toContainText('amount + 10');
    for (const language of ['TypeScript', 'Python']) {
      await implementation.getByRole('button', { name: language, exact: true }).click();
      const projection = implementation.getByRole('textbox', { name: `Generated ${language.toLowerCase()}` });
      await projection.press(language === 'TypeScript' || !baseFirst ? 'ControlOrMeta+End' : 'ControlOrMeta+Home');
      if (language === 'Python' && baseFirst) await projection.press('PageDown');
      await expect(projection).toContainText('10');
      await expect(implementation.getByRole('alert')).toHaveCount(0);
    }
    await implementation.getByRole('button', { name: 'Rune', exact: true }).click();
    const dialog = await openBuilder(page);
    await dialog.getByTestId('tab-text').click();
    await expect(dialog.getByTestId('text-editor')).toContainText('amount + 10');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await implementation.getByRole('button', { name: 'Open in Source', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Source', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Inspector', exact: true }).click();
    const source = page.getByTestId('source-editor').filter({ visible: true }).locator('.cm-content');
    await source.press('ControlOrMeta+Home');
    await expect(source).toContainText('func Compute:');
    await expect(source).toContainText('amount + 10');
    await expect(source).not.toContainText('Compute(kind:');
    if (process.env.PLAYWRIGHT_EXPRESSION_LSP === '1') {
      await expect
        .poll(() =>
          lsp.sent.some(
            (entry) =>
              entry.method === 'textDocument/didOpen' && entry.params?.textDocument?.uri?.endsWith('/base.rosetta')
          )
        )
        .toBe(true);
      expect(lsp.errors.filter((error) => error.code === -32802)).toEqual([]);
    }
    await testInfo.attach('split-file-lsp', { body: JSON.stringify(lsp), contentType: 'application/json' });
  });
}

test('ten-operation CDM function stays one editable implementation with complete projections', async ({ page }) => {
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles(
    expressionReferenceFiles().map(({ uri, content }) => ({
      name: uri.split('/').at(-1)!,
      mimeType: 'text/plain',
      buffer: Buffer.from(content)
    }))
  );
  await page.getByTestId('namespace-search').fill('ConvertToAdjustableOrRelativeDate');
  await typeNavigationButton(page, 'cdm.base.datetime.ConvertToAdjustableOrRelativeDate', 'RosettaFunction').click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  const implementation = page.getByRole('region', { name: 'Function implementation' });
  const editor = page.getByTestId('implementation-editor').locator('.cm-content');
  await expect(editor).toHaveCount(1);
  await editor.press('ControlOrMeta+a');
  const source = expressionReferenceFiles().find((f) => f.uri.endsWith('/base-datetime-func.rosetta'))!.content;
  const body = source.slice(source.indexOf('    alias relativeDate:')).trimEnd();
  const draft =
    body
      .replace('alias relativeDate:', 'alias selectedDate:')
      .replaceAll('if relativeDate exists', 'if selectedDate exists')
      .replaceAll('then relativeDate ->', 'then selectedDate ->')
      .replace('\n    set ', '\n    condition InputPresent:\n        selectedDate exists\n\n    set ')
      .replace('then selectedDate -> periodMultiplier', 'then selectedDate -> periodMultiplier + 0') +
    '\n\n    post-condition OutputPresent:\n        adjustableOrRelativeDate exists';
  await page.keyboard.insertText(draft);
  await expect(editor).toContainText('alias selectedDate:');
  await editor.press('ControlOrMeta+End');
  await expect(editor).toContainText('post-condition OutputPresent:');
  for (const language of ['TypeScript', 'Python']) {
    await implementation.getByRole('button', { name: language, exact: true }).click();
    const projected = page.getByRole('textbox', { name: `Generated ${language.toLowerCase()}` });
    await expect(projected).not.toContainText(
      language === 'TypeScript' ? 'export function' : 'def ConvertToAdjustableOrRelativeDate'
    );
    await projected.press('ControlOrMeta+End');
    await expect(projected).toContainText('periodMultiplier');
    await expect(implementation.getByRole('alert')).toHaveCount(0);
  }
  await implementation.getByRole('button', { name: 'Rune', exact: true }).click();
  await editor.press('ControlOrMeta+z');
  await editor.press('ControlOrMeta+Home');
  await expect(editor).toContainText('alias relativeDate:');
});

test('Data conditions have independent active editors and typed projections', async ({ page }) => {
  await loadPinnedFunction(page);
  await page.getByTestId('namespace-search').fill('Frequency');
  await typeNavigationButton(page, 'cdm.base.datetime.Frequency', 'Data').click();
  await page.getByRole('tab', { name: 'Conditions', exact: true }).click();
  await page.getByRole('tab', { name: 'PositivePeriodMultiplier', exact: true }).click();
  const condition = page.getByRole('region', { name: 'Condition expression' });
  await expect(condition.getByTestId('implementation-editor')).toHaveCount(1);
  await expect(condition).toContainText('periodMultiplier > 0');
  await condition.getByRole('button', { name: 'Python', exact: true }).click();
  await expect(condition.getByRole('textbox', { name: 'Generated python' })).toContainText('periodMultiplier');
  await expect(condition.getByRole('textbox', { name: 'Generated python' })).not.toContainText('def ');
  await condition.getByRole('button', { name: 'TypeScript', exact: true }).click();
  await expect(condition.getByRole('textbox', { name: 'Generated typescript' })).not.toContainText('errors.push');
  await page.getByRole('tab', { name: 'TermPeriod', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Condition expression' })).toContainText('PeriodExtendedEnum');
});

test('an invalid implementation can be reopened and repaired after changing declarations', async ({ page }) => {
  await loadPinnedFunction(page);
  const editor = page.getByTestId('implementation-editor').locator('.cm-content');
  const original = await editor.innerText();
  await editor.press('ControlOrMeta+a');
  await page.keyboard.insertText('    set result: if (');
  await page.getByTestId('namespace-search').fill('Frequency');
  await typeNavigationButton(page, 'cdm.base.datetime.Frequency', 'Data').click();
  await page.getByTestId('namespace-search').fill('Abs');
  await typeNavigationButton(page, 'cdm.base.math.Abs', 'RosettaFunction').click();
  await expect(editor).toContainText('set result: if (');
  await editor.press('ControlOrMeta+a');
  await page.keyboard.insertText(original);
  await expect(editor).toContainText(original.split('\n').at(-1)!);
  const implementation = page.getByRole('region', { name: 'Function implementation' });
  await implementation.getByRole('button', { name: 'Python', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Generated python' })).toContainText('return');
  await expect(implementation.getByRole('alert')).toHaveCount(0);
});

test('Source and Inspector send each edit once through the real network LSP', async ({ page }, testInfo) => {
  test.skip(process.env.PLAYWRIGHT_EXPRESSION_LSP !== '1', 'requires the isolated local LSP Worker');
  const { sent, errors } = captureLsp(page);
  await loadPinnedFunction(page);
  const isMath = (entry: (typeof sent)[number]) =>
    entry.params?.textDocument?.uri?.endsWith('cdm.base.math--base-math-func.rosetta');
  const changes = () => sent.filter((entry) => entry.method === 'textDocument/didChange' && isMath(entry));
  await expect
    .poll(() => sent.filter((entry) => entry.method === 'textDocument/didOpen' && isMath(entry)).length)
    .toBe(1);
  const implementation = page.getByRole('region', { name: 'Function implementation' });
  const editor = page.getByTestId('implementation-editor').locator('.cm-content');
  let before = changes().length;
  await editor.press('ControlOrMeta+End');
  await editor.press('Space');
  await expect.poll(() => changes().length).toBe(before + 1);
  await implementation.getByRole('button', { name: 'Open in Source', exact: true }).click();
  const source = page
    .getByTestId('center-stack')
    .locator('[data-pane="source"]')
    .getByTestId('source-editor')
    .locator('.cm-content');
  await expect(source).toBeVisible();
  before = changes().length;
  await source.press('ControlOrMeta+End');
  await source.press('Space');
  await expect.poll(() => changes().length).toBe(before + 1);
  before = changes().length;
  await editor.press('ControlOrMeta+End');
  await editor.press('Space');
  await expect.poll(() => changes().length).toBe(before + 1);
  expect(sent.filter((entry) => entry.method === 'textDocument/didOpen' && isMath(entry))).toHaveLength(1);
  expect(errors.filter((error) => error.code === -32802)).toEqual([]);
  await testInfo.attach('lsp-document-ownership', {
    body: JSON.stringify({ opens: 1, edits: changes().length }),
    contentType: 'application/json'
  });
});

test('pinned function display, private builder draft, Apply and one undo stay connected', async ({ page }) => {
  await loadPinnedFunction(page);
  const implementation = page.getByRole('region', { name: 'Function implementation' });
  const rune = page.getByTestId('implementation-editor');
  await expect(rune).toHaveCount(1);
  await expect(rune).toContainText('set result: if arg < 0 then -1 * arg else arg');
  for (const language of ['TypeScript', 'Python']) {
    await implementation.getByRole('button', { name: language, exact: true }).click();
    const generated = page.getByRole('textbox', { name: `Generated ${language.toLowerCase()}` });
    await expect(generated).toContainText('return');
    await expect(generated).not.toContainText(language === 'Python' ? 'def Abs(' : 'export function');
    await expect(generated).not.toContainText('rune.compare');
    await expect(generated).not.toContainText('rune.binary');
    await expect(generated).not.toContainText('rune.normalize');
    await expect(generated).toHaveAttribute('contenteditable', 'false');
    await expect(implementation.getByText(/can't be shown|not renderable/i)).toHaveCount(0);
  }
  await implementation.getByRole('button', { name: 'Rune', exact: true }).click();
  let dialog = await openBuilder(page);
  await dialog.getByRole('button', { name: 'Text', exact: true }).click();
  await dialog.getByRole('textbox').fill('if arg < 0 then -2 * arg else arg');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(rune).toContainText('-1 * arg');
  dialog = await openBuilder(page);
  await dialog.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(dialog.getByRole('textbox')).toContainText('-1 * arg');
  await dialog.getByRole('textbox').fill('if arg < 0 then -2 * arg else arg');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(rune).toContainText('-2 * arg');
  await rune.locator('.cm-content').press('ControlOrMeta+z');
  await expect(rune).toContainText('-1 * arg');
  await implementation.getByRole('button', { name: 'Open in Source', exact: true }).click();
  await expect(
    page.getByTestId('center-stack').locator('[data-pane="source"]').getByTestId('source-editor')
  ).toBeVisible();
});

for (const width of [1280, 800]) {
  test(`compact toolbar and builder remain usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await loadPinnedFunction(page);
    const fontScale = page.getByRole('button', { name: /Pane font size:/ }).first();
    while ((await fontScale.getAttribute('data-font-scale-current')) !== 'lg') await fontScale.click();
    await expect(fontScale).toHaveAttribute('data-font-scale-current', 'lg');
    const implementation = page.getByRole('region', { name: 'Function implementation' });
    await implementation.getByRole('button', { name: 'Builder', exact: true }).scrollIntoViewIfNeeded();
    await expect(implementation.getByRole('button', { name: 'Builder', exact: true })).toBeInViewport();
    await expectCenterPaneBounds(page);
    await page.screenshot({ path: testInfo.outputPath(`inspector-${width}.png`) });
    const dialog = await openBuilder(page);
    await enlargeDialogText(page, dialog);
    const issues = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(issues.violations).toEqual([]);
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`builder-${width}.png`) });
    await dialog.getByRole('button', { name: 'Text', exact: true }).click();
    const textIssues = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(textIssues.violations).toEqual([]);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId('implementation-editor').locator('.cm-content')).toBeFocused();
    expect(errors.filter((message) => /ResizeObserver|Expression|CodeMirror/.test(message))).toEqual([]);
  });
}
