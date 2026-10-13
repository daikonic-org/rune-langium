// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Playwright E2E test — Source Editor.
 *
 * Validates the source code editor panel:
 * 1. Opens with correct file content
 * 2. Active file identity and file switching
 * 3. CodeMirror renders with syntax content
 */

import { fullSourceEditor } from '../helpers/source-editor.js';
import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MODEL_A = `namespace source.test
version "1.0.0"

type Widget:
  value string (1..1)
  amount int (0..1)
`;

const MODEL_B = `namespace source.other
version "1.0.0"

enum Color:
  Red
  Green
  Blue
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadFiles(page: Page, files: { name: string; content: string }[]) {
  const fileInput = page.locator('input[type="file"][accept=".rosetta"]');
  await fileInput.setInputFiles(
    files.map((f) => ({
      name: f.name,
      mimeType: 'text/plain',
      buffer: Buffer.from(f.content)
    }))
  );
  await page.waitForSelector('[data-testid="explore-workbench"]', { timeout: 15000 });
  await page.waitForTimeout(1500);
}

async function openSourceFromNode(page: Page, nodeTestId: string) {
  await page.getByRole('button', { name: 'Navigate to Widget', exact: true }).click();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  const node = page.getByTestId(`${nodeTestId}#Data`);
  await node.dblclick({ force: true });
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  // Source opens alongside the selected declaration.
  await expect(fullSourceEditor(page)).toBeVisible({ timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Source Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./');
    await page.waitForLoadState('domcontentloaded');
  });

  test('should show source editor panel when toggled via toolbar', async ({ page }) => {
    await loadFiles(page, [{ name: 'widget.rosetta', content: MODEL_A }]);

    const sourceBtn = page.getByRole('button', { name: 'Source', exact: true });
    await sourceBtn.click();
    await page.waitForTimeout(500);

    const sourceEditor = fullSourceEditor(page);
    await expect(sourceEditor).toBeVisible({ timeout: 5000 });
  });

  test('should open source editor with CodeMirror for the selected node', async ({ page }) => {
    await loadFiles(page, [{ name: 'widget.rosetta', content: MODEL_A }]);
    await openSourceFromNode(page, 'rf__node-source.test.Widget');

    // CodeMirror should now be visible
    const cmEditor = page.locator('.cm-editor');
    await expect(cmEditor).toBeVisible({ timeout: 10000 });
  });

  test('should show and switch the active source file', async ({ page }) => {
    await loadFiles(page, [
      { name: 'widget.rosetta', content: MODEL_A },
      { name: 'color.rosetta', content: MODEL_B }
    ]);
    await openSourceFromNode(page, 'rf__node-source.test.Widget');

    const source = fullSourceEditor(page);
    await expect(page.getByLabel('Source file path', { exact: true })).toContainText('widget.rosetta');
    await page.getByRole('button', { name: 'color.rosetta', exact: true }).click();
    await expect(page.getByLabel('Source file path', { exact: true })).toContainText('color.rosetta');
    await expect(source.locator('.cm-content')).toContainText('enum Color');
  });

  test('should show CodeMirror editor with rosetta content', async ({ page }) => {
    await loadFiles(page, [{ name: 'widget.rosetta', content: MODEL_A }]);
    await openSourceFromNode(page, 'rf__node-source.test.Widget');

    const cmContent = page.locator('.cm-content');
    await expect(cmContent).toContainText('namespace', { timeout: 10000 });
  });

  test('should toggle source panel off and on', async ({ page }) => {
    await loadFiles(page, [{ name: 'widget.rosetta', content: MODEL_A }]);

    // Open source panel via toolbar
    const sourceBtn = page.getByRole('button', { name: 'Source', exact: true });
    await sourceBtn.click();
    await page.waitForTimeout(500);

    const sourceEditor = fullSourceEditor(page);
    await expect(sourceEditor).toBeVisible();

    // Close
    await sourceBtn.click();
    await page.waitForTimeout(300);

    // Re-open
    await sourceBtn.click();
    await page.waitForTimeout(500);
    await expect(sourceEditor).toBeVisible();
  });
});
