// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { checkout as test, expect, captureOpLogSnapshot } from '../fixtures.js';

const WORKSPACE_FILE_NAME = 'starter.rosetta';
const WORKSPACE_FILE_CONTENT = 'namespace example\n';

test.describe('J02 — workspace lifecycle & persistence', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');

  test('J02 workspace survives a reload via OPFS/IndexedDB', async ({ page, evidence }) => {
    await page.goto('./');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('model-loader')).toBeVisible({ timeout: 20000 });

    const fileInput = page.locator('input[type="file"][accept=".rosetta"]');
    const openedAt = Date.now();
    await fileInput.setInputFiles([
      { name: WORKSPACE_FILE_NAME, mimeType: 'text/plain', buffer: Buffer.from(WORKSPACE_FILE_CONTENT) }
    ]);
    await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });
    evidence.recordTiming('workspaceOpen', WORKSPACE_FILE_NAME, Date.now() - openedAt);
    await evidence.checkpoint('workspace-created');

    const reloadedAt = Date.now();
    await captureOpLogSnapshot(page, evidence);
    await page.reload();
    evidence.markNavigation();
    await page.waitForLoadState('domcontentloaded');

    // A reloaded page with a prior workspace lands back in the workbench,
    // not the model-loader launcher — this IS the persistence assertion.
    await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });
    evidence.recordTiming('reloadRestore', WORKSPACE_FILE_NAME, Date.now() - reloadedAt);
    await evidence.checkpoint('after-reload');
  });
});
