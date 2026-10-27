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

for (const theme of ['daikonic', 'light'])
  test(
    `J17 axe sweep across perspectives and dialogs in ${theme} theme`,
    { annotation: { type: 'journey-subid', description: theme } },
    async ({ page, evidence }, testInfo) => {
      test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'requires a deployed Studio');
      const results: AxeSweepResult[] = [];
      const artifactDir = path.join(REPORT_DIR, 'axe', 'J17', theme, `attempt${testInfo.retry}`);
      await loadCdm(page, evidence);
      await page.getByTestId('rail-settings').click();
      await page.getByTestId('settings-perspective').getByLabel('Theme', { exact: true }).selectOption(theme);
      for (const [rail, surface] of [
        ['explore', 'explore-workbench'],
        ['workspaces', 'workspaces-perspective'],
        ['git', 'git-perspective'],
        ['export', 'export-perspective'],
        ['settings', 'settings-perspective']
      ]) {
        await page.getByTestId(`rail-${rail}`).click();
        await expect(page.getByTestId(surface)).toBeVisible({ timeout: 20000 });
        results.push(await sweepAxe(page, rail, artifactDir));
        await evidence.checkpoint(`axe-${theme}-${rail}`);
      }
      await page.getByTestId('rail-explore').click();
      await page.getByRole('button', { name: 'Import Model' }).click();
      await expect(page.getByTestId('import-dialog')).toBeVisible({ timeout: 10000 });
      results.push(await sweepAxe(page, 'import-dialog', artifactDir));
      await evidence.checkpoint(`axe-${theme}-import-dialog`);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('import-dialog')).not.toBeVisible();
      await page.getByTestId('namespace-search').fill('BusinessCenters');
      await typeNavigationButton(page, ANCHOR_DATA).click();
      await page.getByRole('tab', { name: 'Code', exact: true }).click();
      await page.getByTestId('codegen-targets-table__download-zod').click();
      await expect(page.getByTestId('download-config-dialog')).toBeVisible({ timeout: 10000 });
      results.push(await sweepAxe(page, 'download-config-dialog', artifactDir));
      await evidence.checkpoint(`axe-${theme}-download-config-dialog`);
      await page.getByTestId('download-config-dialog__cancel').click();
      expect(
        results.reduce((sum, r) => sum + r.blocking, 0),
        `serious/critical axe violations: ${JSON.stringify(results)}`
      ).toBe(0);
    }
  );
