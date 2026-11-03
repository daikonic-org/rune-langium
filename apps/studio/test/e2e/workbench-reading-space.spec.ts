// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

async function quote(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'reading.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from('namespace review\ntype Quote:\n amount number (1..1)\n')
  });
  await page.getByTestId('namespace-search').fill('Quote');
  await page.getByRole('button', { name: 'Navigate to Quote', exact: true }).click();
  await dismissLocalTransportNotices(page);
}

for (const theme of ['light', 'daikonic'])
  test(`preview yields space and respects explicit controls in ${theme}`, async ({ page }, info) => {
    await quote(page);
    await page.getByTestId('rail-settings').click();
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    await page.getByTestId('rail-explore').click();
    await expect(page.getByRole('button', { name: 'Hide Preview panel', exact: true })).toBeVisible();
    const placeholder = await page
      .getByTestId('namespace-search')
      .evaluate((el) => getComputedStyle(el, '::placeholder').color);
    const muted = await page
      .getByTestId('namespace-explorer')
      .locator('p')
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    expect(placeholder).toBe(muted);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[aria-label="Filter types by kind"]')
          .withRules(['color-contrast'])
          .analyze()
      ).violations
    ).toEqual([]);
    expect(
      (
        await new AxeBuilder({ page })
          .include('[data-testid="namespace-explorer"] .rune-kind-glyph')
          .withRules(['color-contrast'])
          .analyze()
      ).violations
    ).toEqual([]);
    const glyphContrast = await page
      .getByTestId('namespace-explorer')
      .locator('.rune-kind-glyph')
      .first()
      .evaluate((el) => {
        // Read actual browser color conversion and composite every translucent ancestor.
        // Axe can miss an OKLCH foreground; this assertion covers that measurement gap.
        const ctx = new OffscreenCanvas(1, 1).getContext('2d')!;
        const rgba = (color: string) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          return Array.from(ctx.getImageData(0, 0, 1, 1).data).map((value) => value / 255);
        };
        const layers: number[][] = [];
        for (let node: Element | null = el; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.backgroundImage !== 'none' || style.opacity !== '1')
            throw new Error('Glyph contrast needs a painted-background measurement');
          const background = rgba(style.backgroundColor);
          layers.push(background);
          if (background[3] === 1) break;
        }
        const background = layers
          .reverse()
          .reduce(
            (under, over) => over.slice(0, 3).map((value, i) => value * over[3]! + under[i]! * (1 - over[3]!)),
            [1, 1, 1]
          );
        const foreground = rgba(getComputedStyle(el).color);
        const luminance = (values: number[]) =>
          values
            .slice(0, 3)
            .reduce(
              (sum, value, i) =>
                sum +
                [0.2126, 0.7152, 0.0722][i]! * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4),
              0
            );
        const a = luminance(foreground),
          b = luminance(background);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
    expect(glyphContrast).toBeGreaterThanOrEqual(4.5);
    const form = page.getByTestId('panel-formPreview');
    const field = form.getByRole('spinbutton', { name: 'Amount', exact: true });
    await field.fill('123');
    const node = await field.elementHandle();
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await page.getByRole('button', { name: 'Inspector', exact: true }).click();
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(page.getByRole('button', { name: 'Show Preview panel', exact: true })).toBeVisible();
    const center = page.getByTestId('center-stack');
    expect((await center.boundingBox())!.width).toBeGreaterThan(650);
    await page.getByRole('button', { name: 'Focus Source', exact: true }).click();
    await expect(center).toHaveAttribute('data-focused-pane', 'source');
    await expect
      .poll(
        async () =>
          (await center.locator('[data-pane="source"]').boundingBox())!.width - (await center.boundingBox())!.width
      )
      .toBeGreaterThan(-2);
    await page.screenshot({ path: info.outputPath(`focused-source-${theme}.png`) });
    await expect(center.locator('[data-pane="inspector"]')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(center).not.toHaveAttribute('data-focused-pane');
    await expect(center.locator('[data-pane="inspector"]')).toBeVisible();
    await page.getByRole('button', { name: 'Show Preview panel', exact: true }).click();
    await expect(field).toHaveValue('123');
    expect(await node!.evaluate((el) => el.isConnected)).toBe(true);
    // Explicit show stays open under the same pressure, even after focus leaves it.
    await page.getByTestId('namespace-search').focus();
    await expect(page.getByRole('button', { name: 'Hide Preview panel', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Code', exact: true }).click();
    await page.getByTestId('codegen-targets-table__view-typescript').click();
    await expect(page.getByTestId('code-preview-editor')).toContainText('Quote');
    const code = await page.getByTestId('code-preview-editor').elementHandle();
    await page.getByRole('button', { name: 'Focus preview', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Restore preview layout', exact: true })).toBeVisible();
    expect((await page.getByTestId('code-preview-editor').boundingBox())!.width).toBeGreaterThan(900);
    await page.screenshot({ path: info.outputPath(`focused-code-${theme}.png`) });
    await page.getByRole('button', { name: 'Restore preview layout', exact: true }).click();
    expect(await code!.evaluate((el) => el.isConnected)).toBe(true);
    await page.getByRole('button', { name: 'Focus preview', exact: true }).click();
    await page.getByRole('button', { name: 'Hide Preview panel', exact: true }).click();
    await expect(center).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show Preview panel', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1920, height: 1000 });
    await expect(page.getByRole('button', { name: 'Show Preview panel', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show Preview panel', exact: true }).click();
    await page.setViewportSize({ width: 800, height: 800 });
    await page.getByTestId('namespace-search').focus();
    await expect(page.getByRole('button', { name: 'Show Preview panel', exact: true })).toBeVisible();
    await page.reload();
    await page.setViewportSize({ width: 1920, height: 1000 });
    await expect(page.getByRole('button', { name: 'Hide Preview panel', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`restored-layout-${theme}.png`) });
  });

test('help and importer guidance are accessible without changing the active draft', async ({ page }, info) => {
  await quote(page);
  const help = page.getByRole('button', { name: 'Studio help', exact: true });
  await help.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Studio help' })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('[data-slot="popover-content"]').analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('help.png') });
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  const legend = page.locator('[data-slot="graph-legend"]');
  await expect(legend).not.toHaveAttribute('open');
  await legend.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(legend).toHaveAttribute('open', '');
  await expect(legend.getByText('Extends / contains', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(legend).not.toHaveAttribute('open');
  await page.getByRole('button', { name: 'Import Model', exact: true }).click();
  await page.getByText('How to import a model', { exact: true }).click();
  const example = page.getByLabel('JSON Schema import example');
  await expect(example).toBeVisible();
  await page.getByRole('textbox', { name: 'Import source', exact: true }).fill(await example.innerText());
  await page.getByTestId('import-dialog__namespace').fill('example.quote');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByTestId('import-dialog__preview')).toContainText('type Quote');
  await expect(page.getByTestId('import-dialog__summary')).toContainText('1 type(s)');
  await expect(page.getByTestId('import-dialog__confirm')).toBeEnabled();
  await page.getByRole('textbox', { name: 'Import source', exact: true }).fill('{broken');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const error = page.getByTestId('import-dialog__error');
  await expect(error).toContainText('Could not preview model');
  await expect(error).not.toContainText('rune-codegen');
  await expect(page.getByRole('textbox', { name: 'Import source', exact: true })).toHaveValue('{broken');
  const errorBounds = (await error.boundingBox())!;
  const footerBounds = (await page.getByTestId('import-dialog__confirm').boundingBox())!;
  expect(errorBounds.y + errorBounds.height).toBeLessThanOrEqual(footerBounds.y);
  await expect(
    error.getByText('Correct the source and select Preview again. Your workspace has not changed.', { exact: true })
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('import-recovery.png') });
});

test('explicit Inspect and file navigation reveal their destination while a peer is focused', async ({ page }) => {
  await quote(page);
  const center = page.getByTestId('center-stack');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Focus Structure', exact: true }).click();
  await expect(center.locator('[data-pane="inspector"]')).toBeHidden();
  await page.getByRole('group', { name: 'Quote type actions', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Inspect type', exact: true }).click();
  await expect(center.locator('[data-pane="inspector"]')).toBeVisible();
  await page.getByRole('button', { name: 'Focus Structure', exact: true }).click();
  await expect(center.locator('[data-pane="source"]')).toBeHidden();
  await page.getByRole('button', { name: 'Search types, text & files… ⌘K', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search types, files and commands', exact: true }).fill('reading.rosetta');
  await page.getByRole('option', { name: 'reading.rosetta', exact: true }).click();
  await expect(center.locator('[data-pane="source"]')).toBeVisible();
  await expect(center).not.toHaveAttribute('data-focused-pane');
  await page.getByRole('button', { name: 'Focus Source', exact: true }).click();
  await page
    .getByRole('toolbar', { name: 'Studio layout presets', exact: true })
    .getByRole('button', { name: 'Reset layout', exact: true })
    .click();
  await expect(page.getByTestId('center-stack')).not.toHaveAttribute('data-focused-pane');
});

test('file tabs and new files reveal Source while another center pane is focused', async ({ page }) => {
  await quote(page);
  const center = page.getByTestId('center-stack');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Focus Structure', exact: true }).click();
  await page
    .getByRole('group', { name: 'Open files', exact: true })
    .getByRole('button', { name: /^reading\.rosetta / })
    .click();
  await expect(center.locator('[data-pane="source"]')).toBeVisible();
  await expect(center).not.toHaveAttribute('data-focused-pane');
  await page.getByRole('button', { name: 'Focus Inspector', exact: true }).click();
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  await expect(center.locator('[data-pane="source"]')).toBeVisible();
  await expect(center).not.toHaveAttribute('data-focused-pane');
  await expect(
    page.getByRole('group', { name: 'Open files', exact: true }).locator('button[aria-pressed="true"]')
  ).not.toContainText('reading.rosetta');
});

test('global file search reveals Source from a maximized Code preview', async ({ page }, info) => {
  await quote(page);
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.getByTestId('codegen-targets-table__view-typescript').click();
  await expect(page.getByTestId('code-preview-editor')).toContainText('Quote');
  const code = await page.getByTestId('code-preview-editor').elementHandle();
  await page.getByRole('button', { name: 'Focus preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore preview layout', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Search types, text & files… ⌘K', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search types, files and commands', exact: true }).fill('reading.rosetta');
  await page.getByRole('option', { name: 'reading.rosetta', exact: true }).click();
  await expect(page.getByTestId('center-stack').locator('[data-pane="source"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore preview layout', exact: true })).toHaveCount(0);
  expect(await code!.evaluate((el) => el.isConnected)).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Search Studio', exact: true })).toBeHidden();
  await page.screenshot({ path: info.outputPath('revealed-source-after-preview-focus.png') });
});
