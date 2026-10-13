// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Playwright E2E test — Workspace chrome and graph actions.
 *
 * Validates the simplified shell chrome:
 * 1. Workspace header renders brand + global actions
 * 2. Graph-specific actions live inside the graph panel
 * 3. Core authoring surfaces remain visible together
 * 4. Status bar information remains available
 */

import { fullSourceEditor } from '../helpers/source-editor.js';
import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TOOLBAR_MODEL = `namespace toolbar.test
version "1.0.0"

type Widget:
  name string (1..1)
  active boolean (0..1)

type Gadget extends Widget:
  model string (1..1)

enum Status:
  On
  Off
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadModel(page: Page) {
  const fileInput = page.locator('input[type="file"][accept=".rosetta"]');
  await fileInput.setInputFiles({
    name: 'toolbar.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from(TOOLBAR_MODEL)
  });
  await page.waitForSelector('[data-testid="explore-workbench"]', { timeout: 15000 });
  await page.locator('[aria-label="Graph toolbar"]').waitFor({ timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Workspace chrome & graph panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./');
    await page.waitForLoadState('domcontentloaded');
    await loadModel(page);
  });

  test('should display the workspace header and graph toolbar', async ({ page }) => {
    const header = page.locator('[aria-label="Studio workspace header"]');
    await expect(header).toBeVisible();
    await expect(header).toContainText('Rune Studio');
    await expect(header).toContainText('1 file');
    await expect(page.getByTitle('Generate code from model')).toBeVisible();

    const graphToolbar = page.locator('[aria-label="Graph toolbar"]');
    await expect(graphToolbar).toBeVisible();
    await expect(graphToolbar.getByRole('button', { name: 'Fit View' })).toBeVisible();
    await expect(graphToolbar.getByRole('button', { name: 'Re-layout' })).toBeVisible();
    await expect(graphToolbar.getByRole('button', { name: 'Grouped' })).toBeVisible();

    // The utilities toggle/reset-layout toolbar (studio-layout-presets) must
    // stay visible — it was regressed to `display: none` in a past commit.
    await expect(page.getByTestId('toggle-utilities')).toBeVisible();
    await expect(page.getByTestId('reset-layout')).toBeVisible();
  });

  test('should keep explorer, graph, and source surfaces visible together', async ({ page }) => {
    await expect(page.getByTestId('namespace-explorer')).toBeVisible();
    await expect(page.locator('[aria-label="Graph toolbar"]')).toBeVisible();
    const sourceEditor = fullSourceEditor(page);
    await expect(sourceEditor).toBeVisible();
  });

  test('status bar should show model info', async ({ page }) => {
    // Status footer should show file count
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    await expect(footer.getByText(/3 models/i)).toBeVisible();
  });

  test('Fit View should remain available from the graph toolbar', async ({ page }) => {
    const fitViewBtn = page.locator('[aria-label="Graph toolbar"]').getByRole('button', {
      name: 'Fit View'
    });
    await fitViewBtn.click();
    await page.waitForTimeout(500);
    await expect(page.locator('[aria-label="Graph toolbar"]')).toBeVisible();
    await expect(page.locator('.react-flow__viewport')).toBeVisible();
  });

  test('should show close button to return to file loader', async ({ page }) => {
    const closeBtn = page.getByTitle('Close all files');
    await expect(closeBtn).toBeVisible();

    await closeBtn.click();
    await page.waitForTimeout(500);

    // Should return to file loader
    await expect(page.getByTestId('file-loader')).toBeVisible();
  });
});
