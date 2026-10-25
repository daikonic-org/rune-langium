// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * T088 — axe-core a11y gate.
 *
 * Runs axe-core against the studio's main routes and FAILS the suite on
 * any 'serious' or 'critical' violation in code we own. The CodeMirror
 * editor surface and other third-party widgets inherit their upstream
 * a11y posture (FR-A04) and are excluded — gaps there are tracked as
 * known caveats, not as merge gates.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const SELECTORS_TO_EXCLUDE = [
  // CodeMirror editor chrome — third-party, large a11y debt that's upstream's
  // responsibility per FR-A04.
  '.monaco-editor',
  // Reactflow nodes — drag-drop graph; complementary keyboard nav lives
  // in the visual-editor package and is covered by its own tests.
  '.react-flow',
  // dockview's internal chrome (drag handles etc.) — its own a11y track.
  '.dockview-theme-abyss'
];

async function openBlankWorkspace(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('./');
  // Wait for the file-loader directly instead of networkidle — the embedded
  // LSP worker keeps background network connections alive indefinitely.
  const loader = page.getByTestId('file-loader');
  await expect(loader).toBeVisible({ timeout: 10_000 });
  await loader.getByRole('button', { name: /^New/i }).click();
  await expect(page.getByTestId('dock-shell')).toBeVisible({ timeout: 10_000 });
}

test.describe('Studio a11y (T088)', () => {
  test('handles a transport notice expiring during its animated dismissal', async ({ page }) => {
    await page.setContent(`<style>@keyframes move { from { transform: translateX(0); } to { transform: translateX(100px); } }</style>
      <div data-slot="toast" style="animation: move 2s linear">Server-side parsing unavailable
        <button data-slot="toast-close" onclick="this.parentElement.remove()">Dismiss</button>
      </div>`);
    await page.evaluate(() => setTimeout(() => document.querySelector('[data-slot="toast"]')?.remove(), 300));
    await dismissLocalTransportNotices(page);
    await expect(page.locator('[data-slot="toast"]')).toHaveCount(0);
  });
  test('recent workspace metadata remains descriptive without changing the action name', async ({ page }, testInfo) => {
    await openBlankWorkspace(page);
    await page.getByTestId('rail-workspaces').click();
    await dismissLocalTransportNotices(page);
    const switcher = page.getByTestId('workspace-switcher');
    const open = switcher.getByRole('button', { name: /^Open / }).first();
    await expect(open).toBeVisible();
    await expect(open).toHaveAccessibleDescription(/Browser/);
    await open.focus();
    await expect(open).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.getAnimations().every((animation) => animation.playState !== 'running')))
      .toBe(true);
    const result = await new AxeBuilder({ page }).include('[data-testid="workspace-switcher"]').analyze();
    expect(result.violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('recent-workspace.png') });
    await open.press('Enter');
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await page.getByTestId('rail-workspaces').click();
    const row = switcher.getByTestId('workspace-row').first();
    await row.hover();
    await row.getByRole('button', { name: /^Delete / }).click();
    await expect(page.getByTestId('workspace-delete-dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByTestId('workspace-delete-dialog')).toHaveCount(0);
    const badge = (await row.getByText('Browser only', { exact: true }).boundingBox())!;
    await page.mouse.click(badge.x + badge.width / 2, badge.y + badge.height / 2);
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
  });
  test('home / start page passes axe-core (no serious/critical)', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByTestId('file-loader')).toBeVisible();
    const builder = new AxeBuilder({ page });
    for (const sel of SELECTORS_TO_EXCLUDE) builder.exclude(sel);
    const results = await builder.analyze();
    const blocking = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
    if (blocking.length > 0) {
      console.log(JSON.stringify(blocking, null, 2));
    }
    expect(blocking).toEqual([]);
  });

  test('blank workspace grouped layout passes axe-core (no serious/critical)', async ({ page }) => {
    await openBlankWorkspace(page);
    const builder = new AxeBuilder({ page });
    for (const sel of SELECTORS_TO_EXCLUDE) builder.exclude(sel);
    const results = await builder.analyze();
    const blocking = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
    if (blocking.length > 0) {
      console.log(JSON.stringify(blocking, null, 2));
    }
    expect(blocking).toEqual([]);
  });
});
