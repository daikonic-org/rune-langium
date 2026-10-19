// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

for (const width of [1280, 800, 390]) {
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
