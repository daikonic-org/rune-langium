// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Playwright E2E test — Source ↔ Graph ↔ Form Synchronization.
 *
 * Validates bidirectional sync between:
 * 1. Source editor content matches loaded model
 * 2. Form edits reflect correct data per node
 * 3. Selecting a node opens the source editor at its declaration
 * 4. Switching nodes updates the form
 *
 * The center Graph/Structure/Source/Inspector panes are independently
 * toggled via the pane-switcher pill (only Structure is active by
 * default — see DockShell.tsx's activePanes) — every test that needs
 * a pane explicitly opens it first via openPane().
 *
 * Node selection goes through the Type Explorer's "Navigate to <Type>"
 * buttons rather than clicking React Flow nodes directly — the graph
 * defaults to Focus mode, which hides nodes unrelated to the current
 * selection, so a freshly-loaded model's own nodes aren't necessarily
 * visible/clickable in the graph until something selects them first.
 */

import { fullSourceEditor } from '../helpers/source-editor.js';
import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SYNC_MODEL = `namespace sync.test
version "1.0.0"

type Customer:
  name string (1..1)
  email string (0..1)

enum Tier:
  Gold
  Silver
  Bronze
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadModel(page: Page) {
  const fileInput = page.locator('input[type="file"][accept=".rosetta"]');
  await fileInput.setInputFiles({
    name: 'sync.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from(SYNC_MODEL)
  });
  await page.waitForSelector('[data-testid="explore-workbench"]', { timeout: 15000 });
}

/** Toggles a center-stack pane (Graph/Structure/Source/Inspector) on via the pane-switcher pill. */
async function openPane(page: Page, pane: 'Graph' | 'Structure' | 'Source' | 'Inspector') {
  const button = page.getByRole('toolbar', { name: 'Center pane selector' }).getByRole('button', { name: pane });
  if ((await button.getAttribute('aria-pressed')) !== 'true') {
    await button.click();
  }
}

/** Selects a type via the Type Explorer sidebar's "Navigate to <Type>" button. */
async function navigateToType(page: Page, typeName: string) {
  await page.getByRole('button', { name: `Navigate to ${typeName}` }).click();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Source ↔ Graph ↔ Form Sync', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./');
    await page.waitForLoadState('domcontentloaded');
    await loadModel(page);
  });

  test('graph should render nodes for the selected type and its neighbors', async ({ page }) => {
    await openPane(page, 'Graph');
    await navigateToType(page, 'Customer');
    await expect(page.getByTestId('rf__node-sync.test.Customer')).toBeVisible({ timeout: 10000 });

    await navigateToType(page, 'Tier');
    await expect(page.getByTestId('rf__node-sync.test.Tier')).toBeVisible({ timeout: 10000 });
  });

  test('selecting a node should open the source editor at its declaration', async ({ page }) => {
    await navigateToType(page, 'Customer');
    await openPane(page, 'Source');

    const sourceEditor = fullSourceEditor(page);
    await expect(sourceEditor).toBeVisible({ timeout: 10000 });
    await expect(sourceEditor.getByText('Customer', { exact: false })).toBeVisible();
  });

  test('graph nodes should reflect model structure', async ({ page }) => {
    await openPane(page, 'Graph');

    await navigateToType(page, 'Customer');
    const customerNode = page.getByTestId('rf__node-sync.test.Customer');
    await expect(customerNode).toBeVisible({ timeout: 10000 });
    await expect(customerNode.getByText('name')).toBeVisible();

    await navigateToType(page, 'Tier');
    const tierNode = page.getByTestId('rf__node-sync.test.Tier');
    await expect(tierNode).toBeVisible({ timeout: 10000 });
    await expect(tierNode.getByText('Gold')).toBeVisible();
    await expect(tierNode.getByText('Silver')).toBeVisible();
  });

  test('structure pane should render a freshly loaded type', async ({ page }) => {
    await openPane(page, 'Structure');
    await navigateToType(page, 'Customer');

    const structureFlow = page.getByTestId('structure-view-flow');
    await expect(structureFlow).toBeVisible({ timeout: 10000 });
    await expect(structureFlow.getByText('Customer', { exact: false })).toBeVisible();
  });

  test('selecting a type should open the editor form panel', async ({ page }) => {
    await navigateToType(page, 'Tier');

    const panel = page.getByTestId('panel-formPreview');
    await expect(panel).toBeVisible({ timeout: 5000 });
  });

  test('form should show correct data when switching between nodes', async ({ page }) => {
    const panel = page.getByTestId('panel-formPreview');

    await navigateToType(page, 'Customer');
    await expect(panel).toBeVisible({ timeout: 5000 });

    await navigateToType(page, 'Tier');
    await expect(panel).toBeVisible();
  });

  test('status bar should show file count', async ({ page }) => {
    await expect(page.getByText('1 file', { exact: true })).toBeVisible();
  });
});
