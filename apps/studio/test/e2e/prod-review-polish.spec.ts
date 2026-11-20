// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect } from '@playwright/test';
import { fullSourceEditor } from '../helpers/source-editor.js';
import { test } from '../helpers/studio-test.js';
import AxeBuilder from '@axe-core/playwright';
import { waitForEntranceAnimations } from '../prod-ux/readiness.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

test('Source uses Transit Code Book and enables contextual shaping', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'typeface.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from('namespace typography\n\ntype Sample:\n  value string (1..1)\n')
  });
  await page.getByTestId('ns-type-link-typography.Sample#Data').click();
  const source = page.getByRole('toolbar', { name: 'Center pane selector' }).getByRole('button', {
    name: 'Source',
    exact: true
  });
  if ((await source.getAttribute('aria-pressed')) !== 'true') await source.click();

  const editor = fullSourceEditor(page);
  const content = editor.locator('.cm-content');
  await expect(page.locator('body')).toHaveCSS('letter-spacing', 'normal');
  const fileTab = page.getByRole('group', { name: 'Open files' }).getByRole('button', { name: /^typeface\.rosetta/ });
  await expect(fileTab).toHaveCSS('letter-spacing', 'normal');
  for (const label of [
    page.locator('.studio-brand__name'),
    page.getByRole('heading', { name: 'Explore', exact: true }).locator('.perspective-heading')
  ]) {
    expect(
      await label.evaluate((element) => Number.parseFloat(getComputedStyle(element).letterSpacing))
    ).toBeGreaterThan(0);
  }
  for (const text of [content, editor.locator('.cm-gutters')]) {
    await expect(text).toHaveCSS('font-family', /Daikonic Transit Code/);
    await expect(text).toHaveCSS('font-weight', '350');
    await expect(text).toHaveCSS('font-size', '12px');
    await expect(text).toHaveCSS('letter-spacing', 'normal');
    await expect(text).toHaveCSS('font-variant-ligatures', 'common-ligatures contextual');
  }

  const metrics = await content.evaluate(async (el) => {
    const style = getComputedStyle(el);
    const face = `${style.fontWeight} ${style.fontSize} "Daikonic Transit Code"`;
    const [upright, italic] = await Promise.all([
      document.fonts.load(face, '::'),
      document.fonts.load(`italic ${face}`, 'ff')
    ]);
    const sample = document.createElement('span');
    sample.style.cssText = 'position: absolute; visibility: hidden; white-space: pre';
    sample.style.font = face;
    sample.style.fontVariantLigatures = style.fontVariantLigatures;
    sample.textContent = '::';
    document.body.append(sample);
    try {
      const shaped = sample.getBoundingClientRect().width;
      sample.style.fontVariantLigatures = 'none';
      return {
        upright: upright.some((font) => font.style === 'normal' && font.status === 'loaded'),
        italic: italic.some((font) => font.style === 'italic' && font.status === 'loaded'),
        shaped,
        unshaped: sample.getBoundingClientRect().width
      };
    } finally {
      sample.remove();
    }
  });
  expect(metrics.upright).toBe(true);
  expect(metrics.italic).toBe(true);
  // This release renders contextual scope punctuation in one cell.
  expect(metrics.shaped).toBeCloseTo(metrics.unshaped / 2, 1);
});

for (const width of [1024, 800])
  test(`recent workspace names stay readable at ${width}px with larger text`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./');
    const launcher = page.getByTestId('workspaces-perspective');
    const header = launcher.getByTestId('perspective-header-row');
    await expect(header.getByRole('navigation', { name: 'Project launcher' })).toBeVisible();
    await expect(launcher.getByText('Open your work or start with an example project.')).toHaveCSS(
      'font-style',
      'italic'
    );
    for (const name of ['Collateral agreement — desk examples', 'Clearing agreement — desk examples']) {
      await page.getByRole('button', { name: 'New workspace', exact: true }).click();
      await expect(page.getByTestId('explore-workbench')).toBeVisible();
      await page.getByTestId('rail-workspaces').click();
      const row = page.getByTestId('workspace-row').first();
      await row.getByRole('button', { name: /^Rename / }).click();
      await row.getByRole('textbox', { name: 'Workspace name' }).fill(name);
      await row.getByRole('textbox', { name: 'Workspace name' }).press('Enter');
      await expect(row.getByRole('button', { name: `Open ${name}`, exact: true })).toBeVisible();
    }
    for (const [scale, label] of [
      ['md', 'medium'],
      ['lg', 'large']
    ] as const) {
      await page.getByTestId('rail-settings').click();
      const font = page.getByTestId('settings-perspective').getByRole('button', { name: /Pane font size/ });
      for (let step = 0; step < 3 && (await font.getAttribute('data-font-scale-current')) !== scale; step++)
        await font.click();
      await expect(font).toHaveAttribute('data-font-scale-current', scale);
      await page.getByTestId('rail-workspaces').click();
      const rows = page.getByTestId('workspace-row');
      await expect(rows).toHaveCount(2);
      for (const row of await rows.all()) {
        const name = row.locator('.studio-recent-workspace__name');
        const meta = row.locator('.studio-recent-workspace__metadata');
        const nameBox = (await name.boundingBox())!;
        const metaBox = (await meta.locator('span').first().boundingBox())!;
        expect(nameBox.width).toBeGreaterThanOrEqual(160);
        if (metaBox.y < nameBox.y + nameBox.height) expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(metaBox.x);
        await expect(name).toHaveAttribute('title', (await name.innerText()).trim());
      }
      await dismissLocalTransportNotices(page);
      await waitForEntranceAnimations(page);
      await page.screenshot({ path: info.outputPath(`recents-${label}.png`) });
    }
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="workspaces-perspective"]').analyze()).violations
    ).toEqual([]);
    await page.getByTestId('rail-git').click();
    await page.getByRole('button', { name: 'Open Workspaces', exact: true }).click();
    await expect(page.getByTestId('workspaces-perspective')).toBeVisible();
    await page.getByTestId('rail-explore').click();
    await page.getByRole('button', { name: 'Import Model', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Skip validation conditions', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Include unused type definitions', exact: true })).toBeVisible();
  });

test('generated code gains reading height while its selection and editor stay intact', async ({ page }, info) => {
  const workerLoad = Promise.withResolvers<void>();
  let workerHeld = false;
  await page.route(
    /\/assets\/parser-worker-[^/]+\.js(?:\?|$)|\/src\/workers\/parser-worker\.ts\?worker_file/,
    async (route) => {
      workerHeld = true;
      await workerLoad.promise;
      await route.fallback();
    }
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'code-reading.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from('namespace review\ntype Quote:\n amount number (1..1)\n')
  });
  try {
    await page.getByTestId('rail-settings').click();
    await page.getByTestId('settings-perspective').getByLabel('Theme', { exact: true }).selectOption('light');
    await expect.poll(() => workerHeld).toBe(true);
    const retained = page.locator('[data-perspective-slot="explore"]');
    await expect(retained).toBeHidden();
    await expect(retained).toHaveAttribute('inert');
    await expect(retained).toHaveCSS('opacity', '0');
    await expect.poll(async () => (await retained.boundingBox())?.width ?? 0).toBeGreaterThan(1000);
  } finally {
    workerLoad.resolve();
  }
  // Finish preparation with Explore inactive, then verify its real panel size.
  await expect(page.getByText('Parsing files…', { exact: true })).toHaveCount(0);
  await page.getByTestId('rail-explore').click();
  await page.getByTestId('namespace-search').fill('Quote');
  await page.getByRole('button', { name: 'Navigate to Quote', exact: true }).click();
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.getByTestId('codegen-targets-table__view-typescript').click();
  const code = page.getByTestId('code-preview-editor');
  await expect(code).toContainText('Quote');
  const before = (await code.boundingBox())!;
  await page.getByRole('button', { name: 'Hide generation targets', exact: true }).click();
  await expect(page.getByTestId('codegen-targets-table')).toBeHidden();
  expect((await code.boundingBox())!.height).toBeGreaterThan(before.height + 100);
  await expect(page.getByTestId('codegen-active-target')).toHaveText('TypeScript');
  await expect(code).toContainText('Quote');
  await dismissLocalTransportNotices(page);
  expect(
    (
      await new AxeBuilder({ page })
        .include('.dv-tabs-and-actions-container')
        .include('[data-testid="code-preview-editor"]')
        .withRules(['color-contrast'])
        .analyze()
    ).violations
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath('code-reading-expanded.png') });
  await page.getByRole('button', { name: 'Show generation targets', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Regenerate TypeScript preview', exact: true })).toBeVisible();
  await expect(code).toContainText('Quote');
});
