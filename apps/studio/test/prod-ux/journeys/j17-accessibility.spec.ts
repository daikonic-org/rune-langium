// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { checkout as test, expect, loadCdm } from '../fixtures.js';
import { REPORT_DIR } from '../evidence.js';
import { waitForEntranceAnimations } from '../readiness.js';
import { ANCHOR_DATA } from '../anchors.js';
import { typeNavigationButton } from '../../helpers/type-navigation.js';

// Mirrors test/e2e/a11y.spec.ts's exclusion list exactly — third-party
// widget a11y debt tracked separately per FR-A04, not this journey's gate.
const SELECTORS_TO_EXCLUDE = ['.monaco-editor', '.react-flow', '.dockview-theme-abyss'];

interface AxeSweepResult {
  checkpoint: string;
  blocking: number;
}

async function sweepAxe(page: Page, checkpointName: string, artifactDir: string): Promise<AxeSweepResult> {
  await waitForEntranceAnimations(page);
  const builder = new AxeBuilder({ page });
  for (const sel of SELECTORS_TO_EXCLUDE) builder.exclude(sel);
  const results = await builder.analyze();
  await mkdir(artifactDir, { recursive: true });
  await writeFile(path.join(artifactDir, `${checkpointName}.json`), JSON.stringify(results, null, 2));
  const blocking = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  if (blocking.length > 0) {
    console.log(`[axe:${checkpointName}:blocking]`, JSON.stringify(blocking, null, 2));
  }
  return { checkpoint: checkpointName, blocking: blocking.length };
}

test.describe('J17 — Accessibility sweep', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');

  test('J17 axe sweep across all perspectives and the Import/Export dialogs', async ({ page, evidence }, testInfo) => {
    const results: AxeSweepResult[] = [];
    const artifactDir = path.join(REPORT_DIR, 'axe', 'J17', `attempt${testInfo.retry}`);

    await loadCdm(page, evidence);

    await page.getByTestId('rail-explore').click();
    await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });
    results.push(await sweepAxe(page, 'explore', artifactDir));
    await evidence.checkpoint('axe-explore');

    await page.getByTestId('rail-workspaces').click();
    await expect(page.getByTestId('workspaces-perspective')).toBeVisible({ timeout: 20000 });
    results.push(await sweepAxe(page, 'workspaces', artifactDir));
    await evidence.checkpoint('axe-workspaces');

    await page.getByTestId('rail-git').click();
    await expect(page.getByTestId('git-perspective')).toBeVisible({ timeout: 20000 });
    results.push(await sweepAxe(page, 'git', artifactDir));
    await evidence.checkpoint('axe-git');

    await page.getByTestId('rail-export').click();
    await expect(page.getByTestId('export-perspective')).toBeVisible({ timeout: 20000 });
    results.push(await sweepAxe(page, 'export', artifactDir));
    await evidence.checkpoint('axe-export');

    await page.getByTestId('rail-settings').click();
    await expect(page.getByTestId('settings-perspective')).toBeVisible({ timeout: 20000 });
    results.push(await sweepAxe(page, 'settings', artifactDir));
    await evidence.checkpoint('axe-settings');

    await page.getByTestId('rail-explore').click();
    await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Import Model' }).click();
    await expect(page.getByTestId('import-dialog')).toBeVisible({ timeout: 10000 });
    results.push(await sweepAxe(page, 'import-dialog', artifactDir));
    await evidence.checkpoint('axe-import-dialog');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('import-dialog')).not.toBeVisible({ timeout: 5000 });

    await page.getByTestId('rail-explore').click();
    const explore = page.getByTestId('explore-workbench');
    await explore.getByTestId('namespace-search').fill('BusinessCenters');
    await typeNavigationButton(explore, ANCHOR_DATA).click();
    await page.getByRole('tab', { name: 'Code' }).click();
    await page.getByTestId('codegen-targets-table__download-zod').click();
    await expect(page.getByTestId('download-config-dialog')).toBeVisible({ timeout: 10000 });
    results.push(await sweepAxe(page, 'download-config-dialog', artifactDir));
    await evidence.checkpoint('axe-download-config-dialog');
    await page.getByTestId('download-config-dialog__cancel').click();
    await expect(page.getByTestId('download-config-dialog')).not.toBeVisible({ timeout: 5000 });

    // SPEC ADAPTATION: "both themes" is unreachable — J15 confirmed theme
    // is currently fixed at dark, no toggle exists. Recording rather than
    // fabricating a second sweep under an unreachable theme.
    evidence.softFinding(
      'KI-a11y-single-theme-only',
      "Axe sweep ran once under the app's fixed dark theme — no light-theme toggle exists to exercise the " +
        'spec\'s "both themes" requirement. Settings provides font scaling and layout reset, but no theme switch.'
    );

    const totalBlocking = results.reduce((sum, r) => sum + r.blocking, 0);
    expect(totalBlocking, `serious/critical axe violations: ${JSON.stringify(results)}`).toBe(0);
  });
});
