// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { checkout as test, expect, loadCdm, captureOpLogSnapshot } from '../fixtures.js';

test.describe('J15 — Settings perspective', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');

  test('J15 Settings perspective renders; font scale cycles and persists across reload', async ({ page, evidence }) => {
    await page.goto('./');
    await page.waitForLoadState('domcontentloaded');
    await page.getByTestId('rail-settings').click();
    await expect(page.getByTestId('settings-perspective')).toBeVisible({ timeout: 20000 });
    await evidence.checkpoint('settings-loaded');

    // LIVE FINDING (see file-header comment #2): FontScaleButton is mounted
    // in both AppHeader (always visible) and SettingsPerspective — an
    // unscoped getByRole match hits both. Scope to settings-perspective.
    const settingsPanel = page.getByTestId('settings-perspective');
    const fontScaleButton = settingsPanel.getByRole('button', { name: /Pane font size/i });
    await expect(fontScaleButton).toBeVisible();
    const before = await fontScaleButton.getAttribute('data-font-scale-current');
    await fontScaleButton.click();
    const after = await fontScaleButton.getAttribute('data-font-scale-current');
    expect(after, 'font scale cycled to a different value').not.toBe(before);
    await evidence.checkpoint('font-scale-cycled');

    await captureOpLogSnapshot(page, evidence);
    await page.reload();
    evidence.markNavigation();
    await page.waitForLoadState('domcontentloaded');
    await page.getByTestId('rail-settings').click();
    await expect(page.getByTestId('settings-perspective')).toBeVisible({ timeout: 20000 });
    const afterReload = await page
      .getByTestId('settings-perspective')
      .getByRole('button', { name: /Pane font size/i })
      .getAttribute('data-font-scale-current');
    expect(afterReload, 'font scale persisted across reload').toBe(after);
    await evidence.checkpoint('font-scale-persisted');

    // Phase 5 (spec §7): Privacy → telemetry opt-in toggle. It's a base-ui
    // Checkbox (button role="checkbox"), not a native input — per J12's own
    // finding, .setChecked()/.isChecked() can no-op against this component,
    // so this asserts aria-checked directly after an explicit click (same
    // pattern j12-import-dialog.spec.ts already established).
    const telemetryToggle = page.getByTestId('settings-telemetry-toggle');
    await expect(telemetryToggle).toBeVisible();
    await expect(telemetryToggle, 'telemetry opt-in defaults to unchecked').toHaveAttribute('aria-checked', 'false');
    await telemetryToggle.click();
    await expect(telemetryToggle).toHaveAttribute('aria-checked', 'true');
    await evidence.checkpoint('telemetry-toggle-checked');

    await captureOpLogSnapshot(page, evidence);
    await page.reload();
    evidence.markNavigation();
    await page.waitForLoadState('domcontentloaded');
    await page.getByTestId('rail-settings').click();
    await expect(page.getByTestId('settings-perspective')).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByTestId('settings-telemetry-toggle'),
      'telemetry opt-in persisted across reload'
    ).toHaveAttribute('aria-checked', 'true');
    await evidence.checkpoint('telemetry-toggle-persisted');

    await loadCdm(page, evidence);
    await page.getByTestId('rail-explore').click();
    await page.getByTestId('reset-layout').click();
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Inspector', exact: true })).toBeVisible();
    await evidence.checkpoint('layout-reset');
  });
});
