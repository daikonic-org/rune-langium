// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { Route } from '@playwright/test';
import { checkout as test, expect, loadCdm } from '../fixtures.js';
import { typeNavigationButton } from '../../helpers/type-navigation.js';

test.describe('J16 — Resilience & chrome', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');

  test(
    'J16 closing a workspace during namespace hydration ignores its late result',
    { annotation: { type: 'journey-subid', description: 'cancel-hydration' } },
    async ({ page, evidence }) => {
      await loadCdm(page, evidence);
      let release!: () => void;
      let started!: () => void;
      let finished!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const inflight = new Promise<void>((resolve) => {
        started = resolve;
      });
      const settled = new Promise<void>((resolve) => {
        finished = resolve;
      });
      await page.route('**/api/parse', async (route) => {
        const body = route.request().postDataJSON();
        if (!body.hydrateNamespaces?.includes('cdm.base.datetime')) return route.continue();
        const response = await route.fetch();
        started();
        await held;
        try {
          await route.fulfill({ response });
        } catch {
          /* Closing may abort the request. */
        } finally {
          finished();
        }
      });
      await page.getByTestId('rail-explore').click();
      await page.getByTestId('namespace-search').fill('BusinessCenters');
      await typeNavigationButton(page, 'cdm.base.datetime.BusinessCenters', 'Data').click();
      await inflight;
      await evidence.checkpoint('namespace-hydration-in-flight');
      await page.getByRole('button', { name: /Workspace menu/ }).click();
      await page.getByRole('menuitem', { name: /Close .*return to start page/ }).click();
      await expect(page.getByRole('button', { name: 'New blank workspace', exact: true })).toBeVisible();
      await expect(page.getByTestId('rail-explore')).toBeDisabled();
      await expect(page.getByTestId('explore-workbench')).toBeHidden();
      await page.getByRole('button', { name: 'New blank workspace', exact: true }).click();
      await expect(page.getByTestId('explore-workbench')).toBeVisible();
      release();
      await settled;
      await page.getByTestId('namespace-search').fill('BusinessCenters');
      await expect(typeNavigationButton(page, 'cdm.base.datetime.BusinessCenters', 'Data')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Workspace menu.*untitled/ })).toBeVisible();
      await evidence.checkpoint('late-hydration-discarded');
      await page.reload();
      await expect(page.getByRole('button', { name: /Workspace menu.*untitled/ })).toBeVisible();
      await page.getByTestId('namespace-search').fill('BusinessCenters');
      await expect(typeNavigationButton(page, 'cdm.base.datetime.BusinessCenters', 'Data')).toHaveCount(0);
      await evidence.checkpoint('replacement-workspace-restored');
    }
  );

  test(
    'J16 reload mid-Explore restores active perspective and dockview layout',
    { annotation: { type: 'journey-subid', description: 'reload-explore' } },
    async ({ page, evidence }) => {
      await loadCdm(page, evidence);
      await page.getByTestId('rail-explore').click();
      await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });
      await evidence.checkpoint('before-reload');

      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });
      await evidence.checkpoint('after-reload');
    }
  );

  test(
    'J16 rail buttons for workspace-requiring perspectives are disabled with no workspace',
    { annotation: { type: 'journey-subid', description: 'rail-disabled' } },
    async ({ page, evidence }) => {
      await page.goto('./');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('model-loader')).toBeVisible({ timeout: 20000 });

      // No workspace loaded yet — explore/git/export require one; workspaces/
      // settings do not (perspective-registry.ts's requiresWorkspace flags).
      for (const railId of ['rail-explore', 'rail-git', 'rail-export']) {
        await expect(page.getByTestId(railId)).toBeDisabled();
      }
      for (const railId of ['rail-workspaces', 'rail-settings']) {
        await expect(page.getByTestId(railId)).toBeEnabled();
      }
      await evidence.checkpoint('rail-disabled-no-workspace');

      // Issue #405 (closed): FileTabStrip's per-tab "×" delete button now
      // provides the previously-missing UI trigger for
      // resolveEffectivePerspective's "delete last file while in Explore →
      // falls back to Workspaces" path. Reach a fresh single-file scratch
      // workspace (matches J02's own inline file-input pattern — the
      // helper isn't exported from fixtures.ts, and every journey that
      // needs it re-declares these two small constants locally), delete
      // that one file via the real delete button, and confirm the app
      // actually lands on the Workspaces launcher instead of a blank
      // Explore perspective.
      const WORKSPACE_FILE_NAME = 'starter.rosetta';
      const WORKSPACE_FILE_CONTENT = 'namespace example\n';
      await page.goto('./');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('model-loader')).toBeVisible({ timeout: 20000 });
      await page
        .locator('input[type="file"][accept=".rosetta"]')
        .setInputFiles([
          { name: WORKSPACE_FILE_NAME, mimeType: 'text/plain', buffer: Buffer.from(WORKSPACE_FILE_CONTENT) }
        ]);
      await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });
      await evidence.checkpoint('single-file-workspace-created');

      page.once('dialog', (dialog) => void dialog.accept());
      await page.getByLabel(`Delete ${WORKSPACE_FILE_NAME}`).click();

      // resolveEffectivePerspective falls back to 'workspaces' the moment
      // hasExploreContent drops to false — the Workspaces launcher (the
      // same model-loader surface loadCdm/J02 land on when navigating
      // there directly) becomes visible without any further navigation.
      await expect(page.getByTestId('model-loader')).toBeVisible({ timeout: 20000 });
      await evidence.checkpoint('delete-last-file-fallback-to-workspaces');
    }
  );

  test(
    'J16 toasts appear and auto-dismiss',
    { annotation: { type: 'journey-subid', description: 'toasts' } },
    async ({ page, evidence }) => {
      // The Code tab still uses DownloadConfigDialog and reports server-backed
      // download failures as a toast. Force that response so this journey
      // tests toast display and dismissal independently of codegen health.
      await page.route('**/api/codegen', async (route: Route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'J16 toast-determinism mock — forced failure' })
        });
      });

      await page.goto('./');
      await expect(page.getByTestId('model-loader')).toBeVisible();
      await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles([
        {
          name: 'toast.rosetta',
          mimeType: 'text/plain',
          buffer: Buffer.from('namespace toast\ntype Sample:\n value string (1..1)\n')
        }
      ]);
      await expect(page.getByTestId('explore-workbench')).toBeVisible();
      await page.getByTestId('namespace-search').fill('Sample');
      await typeNavigationButton(page, 'toast.Sample').click();
      await page.getByRole('tab', { name: 'Code' }).click();
      await page.getByTestId('codegen-targets-table__download-zod').click();
      await expect(page.getByTestId('download-config-dialog')).toBeVisible({ timeout: 10000 });
      await page.getByTestId('download-config-dialog__generate').click();

      // Base UI names the toast dialog from its title; the mocked failure
      // therefore gives us a stable accessible locator.
      const toast = page.getByRole('dialog', { name: 'Code generation failed' });
      await expect(toast).toBeVisible({ timeout: 20000 });
      await evidence.checkpoint('toast-appeared');
      await expect(toast).not.toBeVisible({ timeout: 5000 });
      await evidence.checkpoint('toast-auto-dismissed');
      await page.getByTestId('rail-explore').click();
      if ((await page.getByTestId('toggle-utilities').getAttribute('aria-pressed')) === 'false') {
        await page.getByTestId('toggle-utilities').click();
      }
      await page.getByRole('tab', { name: 'Activity', exact: true }).click();
      await expect(page.getByTestId('panel-activity')).toBeVisible();
      await evidence.checkpoint('activity-history');
      await page.getByRole('tab', { name: 'Output', exact: true }).click();
      await expect(page.getByTestId('panel-output')).toContainText('J16 toast-determinism mock');
      await evidence.checkpoint('download-error-retained-in-output');
    }
  );
});
