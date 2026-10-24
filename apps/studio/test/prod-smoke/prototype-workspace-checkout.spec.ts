// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Validated live end-to-end (both against `pnpm dev` and a real production
 * build served via `vite preview`): workspace load, rail-prototype, shared
 * type-picker creation, the worker-backed schema round trip, field editing,
 * and the unified Inspector payload all confirmed against real rendered DOM.
 *
 * Under plain `pnpm dev` (no Cloudflare Pages Functions), the codegen worker
 * crashed on this flow; under a real production build (`vite preview`) it
 * did not — this workspace never uses the curated-bundle-hydration path
 * `/api/parse` exists for, so the crash was a `pnpm dev`-only artifact, not
 * a feature dependency on Pages Functions. See
 * `test/prod-ux/journeys/j12-import-dialog.spec.ts` (formerly
 * `schema-import-checkout.spec.ts`, absorbed into J12) for a related,
 * confirmed dev-mode-only bug (an unrelated Node-builtin import that a
 * production build's tree-shaking correctly eliminates).
 */

import { Buffer } from 'node:buffer';
import { expect, test } from '@playwright/test';

// A small, self-contained fixture (not the CDM corpus) — the Prototype
// deterministic one-type model is both sufficient and faster than loading
// CDM just to exercise the shared type-picker instance-authoring flow.
const WORKSPACE_FILE_NAME = 'party.rosetta';
const WORKSPACE_FILE_CONTENT = 'namespace test\ntype Party:\n  name string (1..1)\n';
const INSTANCE_NAME = 'My Party';

async function loadWorkspace(page: import('@playwright/test').Page) {
  await page.goto('./');
  await page.waitForLoadState('domcontentloaded');
  await expect(page).toHaveTitle(/Rune Studio/);
  await expect(page.getByTestId('workspaces-perspective')).toBeVisible({ timeout: 20000 });

  const fileInput = page.locator('input[type="file"][accept=".rosetta"]');
  await fileInput.setInputFiles([
    {
      name: WORKSPACE_FILE_NAME,
      mimeType: 'text/plain',
      buffer: Buffer.from(WORKSPACE_FILE_CONTENT)
    }
  ]);
  await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });
}

test.describe('prototype workspace checkout smoke', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');

  test('creates an instance, edits a field via the worker-backed schema pipeline, and reflects it in the Inspector', async ({
    page
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await loadWorkspace(page);

    await page.getByTestId('rail-prototype').click();
    await expect(page.getByTestId('prototype-perspective')).toBeVisible({ timeout: 20000 });

    await page.getByRole('button', { name: 'Create example' }).click();
    await page.getByRole('button', { name: 'Example type' }).click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Example type' })).toContainText('Party');
    await page.getByLabel('Example name').fill(INSTANCE_NAME);
    const createButton = page.getByRole('button', { name: 'Create example' });
    expect(
      await createButton.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit === button || button.contains(hit);
      }),
      'the dialog button must receive pointer events above dockview dividers'
    ).toBe(true);
    await createButton.click();

    // Selecting the new row keeps its identity header and form in the same
    // Inspector. Schema generation still happens through the codegen worker.
    await expect(page.getByRole('tab', { name: 'Form' })).toBeVisible({ timeout: 15000 });
    const nameField = page.getByRole('textbox', { name: 'Name', exact: true });
    await expect(nameField).toBeVisible({ timeout: 20000 });

    await nameField.fill('Acme');
    await nameField.blur();

    const prototype = page.getByTestId('prototype-perspective');
    await expect(prototype.getByLabel('Example payload')).toContainText('"Acme"', { timeout: 10000 });
    const instanceRow = prototype.getByTestId('prototype-grid').getByRole('row', { name: new RegExp(INSTANCE_NAME) });
    await expect(instanceRow.getByRole('cell', { name: 'valid', exact: true })).toBeVisible({ timeout: 20000 });

    // The selected row and Inspector read the same persisted store record.
    await expect(instanceRow).toBeVisible();
  });
});
