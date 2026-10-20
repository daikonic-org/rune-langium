// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

for (const width of [1280, 800, 390]) {
  test(`rounded view groups stay separate and keyboard usable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('./');
    await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles(
      [0, 1, 2, 3].map((i) => ({
        name: `model${i}.rosetta`,
        mimeType: 'text/plain',
        buffer: Buffer.from(`namespace tabs\ntype Item${i}:\n value string (0..1)\n`)
      }))
    );
    await page.getByTestId('namespace-search').fill('Item0');
    await typeNavigationButton(page, 'tabs.Item0').click();
    if (width < 1280) {
      await page.getByRole('button', { name: 'Hide Type explorer', exact: true }).click();
      await page.getByRole('button', { name: 'Hide Preview panel', exact: true }).click();
    }
    await dismissLocalTransportNotices(page);
    const selector = page.getByRole('toolbar', { name: 'Center pane selector' });
    const view = selector.getByRole('group', { name: 'View', exact: true });
    const alongside = selector.getByRole('group', { name: 'Show alongside', exact: true });
    for (const group of [view, alongside]) {
      await expect(group).toBeVisible();
      expect(await group.evaluate((el) => parseFloat(getComputedStyle(el).borderRadius))).toBeGreaterThan(100);
    }
    await view.getByRole('button', { name: 'Graph', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(view.getByRole('button', { name: 'Graph', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(view.getByRole('button', { name: 'Structure', exact: true })).toHaveAttribute('aria-pressed', 'false');
    for (const pane of ['Source', 'Inspector']) {
      await alongside.getByRole('button', { name: pane, exact: true }).click();
      await expect(alongside.getByRole('button', { name: pane, exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
    const toolbarBox = (await selector.boundingBox())!;
    for (const button of await selector.getByRole('button').all()) {
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(toolbarBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(toolbarBox.x + toolbarBox.width);
    }
    if (width === 1280) {
      const files = page.getByRole('group', { name: 'Open files', exact: true });
      const first = files.getByRole('button', { name: 'model0.rosetta DSL', exact: true });
      const last = files.getByRole('button', { name: 'model3.rosetta DSL', exact: true });
      await last.focus();
      await last.press('Enter');
      await expect(last).toHaveAttribute('aria-pressed', 'true');
      await expect(first).toHaveAttribute('aria-pressed', 'false');
      await expect(last).toBeInViewport();
      expect(await files.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
      await expect(page.getByRole('button', { name: 'New file', exact: true })).toHaveCount(1);
      await first.focus();
      await first.press('Enter');
      await expect(first).toHaveAttribute('aria-pressed', 'true');
    }
    const audit = await new AxeBuilder({ page }).include('[data-testid="studio-paneswitch"]').analyze();
    expect(audit.violations).toEqual([]);
    await expect
      .poll(() => page.evaluate(() => document.getAnimations().every((a) => a.playState !== 'running')))
      .toBe(true);
    await page.screenshot({ path: info.outputPath(`tab-chrome-${width}.png`) });
  });

  test(`expression controls and offline recovery remain legible at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 800 });
    await page.route('**/api/lsp/session', (route) => route.fulfill({ status: 503, body: 'Offline test' }));
    await page.goto('./');
    await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
      name: 'polish.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'namespace polish\nfunc Run:\n inputs: amount int (1..1)\n output: result int (1..1)\n set result: amount + 1\n'
      )
    });
    await page.getByTestId('namespace-search').fill('Run');
    await typeNavigationButton(page, 'polish.Run', 'RosettaFunction').click();
    await page.getByRole('button', { name: 'Inspector', exact: true }).click();
    const footer = page.getByRole('group', { name: 'Workspace status' });
    await expect(footer.getByTestId('lsp-badge-error')).toBeVisible();
    await expect(footer.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(1);
    await expect(footer.getByText('Reconnect', { exact: true })).toHaveCount(0);
    await expect(footer).not.toContainText(/https?:\/\//);
    const retry = footer.getByRole('button', { name: 'Retry', exact: true });
    await retry.focus();
    await expect(retry).toBeFocused();
    const retryBox = (await retry.boundingBox())!;
    expect(retryBox.x).toBeGreaterThanOrEqual(0);
    expect(retryBox.x + retryBox.width).toBeLessThanOrEqual(width);
    const audit = await new AxeBuilder({ page }).include('footer[aria-label="Workspace status"]').analyze();
    expect(audit.violations).toEqual([]);

    if (width < 1280) {
      await page.getByRole('button', { name: 'Hide Type explorer', exact: true }).click();
      await page.getByRole('button', { name: 'Hide Preview panel', exact: true }).click();
    }
    await dismissLocalTransportNotices(page);
    const implementation = page.getByRole('region', { name: 'Function implementation' });
    const language = implementation.getByRole('group', { name: 'Expression language' });
    const rune = language.getByRole('button', { name: 'Rune', exact: true });
    const typescript = language.getByRole('button', { name: 'TypeScript', exact: true });
    await expect(rune).toHaveAttribute('aria-pressed', 'true');
    await expect(typescript).toHaveAttribute('aria-pressed', 'false');
    const color = (button: typeof rune) => button.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await color(rune)).not.toBe(await color(typescript));
    await typescript.focus();
    await typescript.press('Enter');
    await expect(typescript).toHaveAttribute('aria-pressed', 'true');
    await expect(implementation.getByRole('textbox', { name: 'Generated typescript' })).toContainText('amount + 1');
    await rune.click();
    await expect(rune).toHaveAttribute('aria-pressed', 'true');
    await expect(typescript).toHaveAttribute('aria-pressed', 'false');
    await expect(implementation.getByTestId('implementation-editor')).toContainText('set result: amount + 1');
    await expect(implementation.getByRole('group', { name: 'Expression actions' })).toBeVisible();
    await expect.poll(async () => (await implementation.boundingBox())!.width).toBeGreaterThan(180);
    await expect
      .poll(() => page.evaluate(() => document.getAnimations().every((a) => a.playState !== 'running')))
      .toBe(true);
    await page.screenshot({ path: info.outputPath(`workspace-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
