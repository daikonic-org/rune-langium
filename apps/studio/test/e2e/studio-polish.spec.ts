// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, test, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { serveCuratedDeclarations } from '../helpers/curated-declaration-server.js';
import { createPrototypeExample } from '../helpers/prototype-examples.js';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  return (await locator.boundingBox())!;
}

for (const theme of ['light', 'daikonic']) {
  test(`launcher keeps long recents beside starters and references fill the frame in ${theme}`, async ({
    page,
    context
  }, info) => {
    await serveCuratedDeclarations(context, []);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`./?theme=${theme}`);
    const launcher = page.getByTestId('workspaces-perspective');
    for (let i = 0; i < 14; i++) {
      await launcher.getByRole('button', { name: 'New workspace', exact: true }).click();
      await expect(page.getByTestId('explore-workbench')).toBeVisible();
      await page.getByTestId('rail-workspaces').click();
    }
    await dismissLocalTransportNotices(page);
    const recents = launcher.getByRole('list', { name: 'Recent workspaces' });
    await expect(recents.getByRole('listitem')).toHaveCount(14);
    const starters = launcher.locator('.starter-section');
    const recentBox = await box(recents);
    const starterBox = await box(starters);
    expect(starterBox.x).toBeGreaterThan(recentBox.x + recentBox.width);
    expect(starterBox.y + starterBox.height).toBeLessThanOrEqual(720);
    expect(await recents.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await recents.focus();
    await recents.press('End');
    await expect.poll(() => recents.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(recents.getByRole('listitem').last()).toBeInViewport();
    await expect(launcher.getByRole('button', { name: 'New workspace', exact: true })).toBeInViewport();
    expect(await launcher.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="workspaces-perspective"]').analyze()).violations
    ).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${theme}-workspaces.png`) });
    await launcher.getByRole('button', { name: 'Reference models', exact: true }).click();
    const references = await box(page.getByTestId('reference-model-picker'));
    expect(references.y + references.height).toBeGreaterThan(700);
    expect(references.x + references.width).toBeGreaterThan(1250);
    await page.screenshot({ path: info.outputPath(`${theme}-references.png`) });
  });

  test(`compact forms stay aligned and splitters remain draggable in ${theme}`, async ({ page, context }, info) => {
    await serveCuratedDeclarations(context, []);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`./?theme=${theme}`);
    await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
      name: 'polish.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from('namespace polish\ntype Party:\n name string (1..1)\n active boolean (1..1)\n')
    });
    await typeNavigationButton(page, 'polish.Party').click();
    await dismissLocalTransportNotices(page);
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    const sash = page
      .locator('.dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash')
      .filter({ visible: true })
      .first();
    const handle = await box(sash);
    expect(handle.width).toBe(16);
    await expect(sash).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const paint = await sash.evaluate((el) => {
      const style = getComputedStyle(el, '::after');
      return { width: style.width, shadow: style.boxShadow, color: style.backgroundColor };
    });
    expect(paint.width).toBe('1px');
    expect(paint.shadow).toBe('none');
    expect(paint.color).not.toBe('rgba(0, 0, 0, 0)');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await expect(sash).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 24, handle.y + handle.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Math.abs((await box(sash)).x - handle.x)).toBeGreaterThan(15);
    await page.screenshot({ path: info.outputPath(`${theme}-explore.png`) });
    await page.getByTestId('rail-settings').click();
    const select = page.getByRole('combobox', { name: 'Theme', exact: true });
    const themeBox = await box(select);
    expect(themeBox.height).toBe(24);
    expect(themeBox.width).toBe(208);
    const fontBox = await box(page.getByTestId('settings-perspective').getByRole('button', { name: /font size/i }));
    expect(fontBox.x).toBeCloseTo(themeBox.x, 0);
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="settings-perspective"]').analyze()).violations
    ).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${theme}-settings.png`) });
    await page.getByTestId('rail-export').click();
    const name = page.getByRole('textbox', { name: 'Target name', exact: true });
    const save = page.getByRole('button', { name: 'Save target settings', exact: true });
    expect((await box(name)).height).toBe(24);
    expect((await box(save)).height).toBe(24);
    await page.screenshot({ path: info.outputPath(`${theme}-export.png`) });
    await page.getByTestId('rail-prototype').click();
    const form = await createPrototypeExample(page, 'Party', 'Aligned Party');
    await form.getByLabel('Name', { exact: true }).fill('Alice');
    const checkbox = form.getByRole('checkbox', { name: 'Active', exact: true });
    const label = form.locator('label', { hasText: /^Active$/ });
    const checkBox = await box(checkbox);
    const labelBox = await box(label);
    expect(Math.abs(checkBox.y + checkBox.height / 2 - labelBox.y - labelBox.height / 2)).toBeLessThan(1);
    await expect(checkbox).toHaveAttribute('aria-invalid', 'true');
    const errorId = await checkbox.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    const error = form.locator(`[id="${errorId}"]`);
    expect((await box(error)).y).toBeGreaterThan(checkBox.y + checkBox.height);
    await page.screenshot({ path: info.outputPath(`${theme}-boolean-error.png`) });
    await label.click();
    await expect(checkbox).toBeChecked();
    await expect(error).toBeHidden();
    expect((await new AxeBuilder({ page }).include('[aria-label="input fields"]').analyze()).violations).toEqual([]);
    expect(errors).toEqual([]);
  });
}
