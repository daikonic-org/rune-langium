// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/** Production smoke for worker-backed example creation and isolated workflow drafts. */

import { Buffer } from 'node:buffer';
import { expect, test } from '@playwright/test';
import { projectBackingFiles } from '../helpers/project-backing.js';

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

  test('creates an example and edits isolated workflow inputs through the worker schema', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await loadWorkspace(page);

    await page.getByTestId('rail-prototype').click();
    await expect(page.getByTestId('prototype-perspective')).toBeVisible({ timeout: 20000 });

    await page.getByRole('button', { name: 'Add', exact: true }).click();
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

    // Workflow inputs are private drafts cloned from a saved example.
    // Editing them must not overwrite the reusable saved payload.
    await expect(page.getByRole('region', { name: 'input fields', exact: true })).toBeVisible({ timeout: 15000 });
    const before = await projectBackingFiles(page);
    const descriptorPath = Object.keys(before).find((path) => path.endsWith('.example.json'))!;
    const descriptor = JSON.parse(before[descriptorPath]!);
    const originalPayload = before[descriptor.payload];
    const nameField = page.getByRole('textbox', { name: 'Name', exact: true });
    await expect(nameField).toBeVisible({ timeout: 20000 });

    await nameField.fill('Acme');
    await nameField.blur();

    const prototype = page.getByTestId('prototype-perspective');
    // Without a transform, the output follows input edits immediately.
    await expect(page.getByRole('button', { name: 'Execute', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('instance-payload-output')).toContainText('"Acme"', { timeout: 10000 });
    expect((await projectBackingFiles(page))[descriptor.payload]).toBe(originalPayload);
    const instanceRow = prototype.getByTestId('prototype-grid').getByRole('row', { name: new RegExp(INSTANCE_NAME) });
    await expect(instanceRow.getByText('saved', { exact: true })).toBeVisible();

    // The reusable example remains visible while its workflow draft is edited.
    await expect(instanceRow).toBeVisible();
  });
});
