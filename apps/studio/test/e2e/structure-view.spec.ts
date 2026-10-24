// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Playwright E2E test — Structure View (Phase 11).
 *
 * Validates the Structure pane in CenterStackPanel (Phase 7.5):
 *  1. Smoke test (unskipped): Structure segment activates and shows empty
 *     state when no type is focused.
 *  2-6. Fixture-gated tests (skipped): canonical flows that require a loaded
 *       workspace — focus-to-populate, expand-collapse, drag-drop into
 *       structure cells, drag-drop into source editor (Phase 9), undo-redo.
 *
 * Selector note (Phase 7.5):
 *   The pane-switcher replaced the old Radix Tabs design. There is no longer
 *   a `data-testid="tab-structure"` element. Instead, each segment is a
 *   <button> rendered inside `data-testid="studio-paneswitch"`.
 *   Use `getByRole('button', { name: /^structure$/i })` to target it.
 *
 * App-boot note:
 *   CenterStackPanel (and therefore the Structure pane) is only present once
 *   the editor page is active (i.e., at least one workspace file is loaded).
 *   The smoke test enters the editor via "New workspace" — the simplest
 *   path that does not require an external fixture file.
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Boot the studio into the editor page by clicking "New workspace".
 * This is the cheapest fixture-free path into CenterStackPanel.
 */
async function enterEditorViaNew(page: import('@playwright/test').Page) {
  await page.goto('./');
  await page.waitForLoadState('domcontentloaded');
  // Click the primary CTA on the empty start page.
  await page.getByRole('button', { name: /new blank workspace/i }).click();
  // Wait for the editor shell to mount (visible-UI convention from CLAUDE.md).
  await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Structure View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./');
    await page.waitForLoadState('domcontentloaded');
  });

  test('Structure pane segment shows empty state when activated with no focused type', async ({ page }) => {
    // Phase 7.5: Structure is a peer pane in CenterStackPanel's pane-switcher.
    // The pane-switcher is only visible once the editor page is active.
    await enterEditorViaNew(page);

    // The paneswitch is now visible. Structure defaults to inactive (DockShell
    // initialises activePanes with ['graph']). Click the segment to activate it.
    await page.getByRole('button', { name: /^structure$/i }).click();

    // With no type focused the StructureView renders its empty-state sentinel.
    await expect(page.getByTestId('structure-empty-state')).toBeVisible();
  });

  test('Focusing a Data type via NamespaceExplorer double-click populates Structure View', async ({ page: _page }) => {
    // Phase 8: double-click on a namespace-explorer type row sets the focused
    // type in the store, which Structure View subscribes to and renders as a
    // ReactFlow graph (`data-testid="structure-view-flow"`).
    test.skip(true, 'requires workspace-loading fixture');
    // When the fixture is available:
    // const FIXTURE = `namespace cdm.trade\nversion "1.0.0"\n\ntype Trade:\n  tradeId string (1..1)\n`;
    // await loadInlineFiles(page, [{ name: 'trade.rosetta', content: FIXTURE }]);
    // await page.getByRole('button', { name: /^structure$/i }).click();
    // // Phase 8: double-click navigates (single-click marks drag source).
    // const chevron = page.locator('.ns-row__chevron').first();
    // await chevron.click();
    // await page.locator('.ns-type__name', { hasText: 'Trade' }).dblclick();
    // await expect(page.getByTestId('structure-view-flow')).toBeVisible();
    // await expect(page.getByText('Trade', { exact: true })).toBeVisible();
  });

  test('Hexagon-plus expands a complex-typed row in Structure View', async ({ page: _page }) => {
    // Phase 7: clicking the expand affordance on a row whose type has nested
    // complex-typed fields should inline-expand the child type's fields.
    test.skip(true, 'requires workspace-loading fixture');
    // When the fixture is available, double-click a type with nested complex
    // fields, then click the hexagon-plus cell to expand it and assert the
    // child row count increases.
  });

  test('Drag a type from NamespaceExplorer to a Structure cell updates the source', async ({ page: _page }) => {
    // Phase 7/8: dragging a type node from the NamespaceExplorer and dropping
    // it onto a structure cell should update the field's type in the source and
    // reflect the change in the LSP-validated source editor.
    test.skip(true, 'requires workspace-loading fixture');
    // When the fixture is available, load a two-type model, open Structure View,
    // drag one type onto the other's field cell, and assert the source editor
    // shows the updated type reference.
  });

  test('Drag a type from NamespaceExplorer to source editor inserts qualified name', async ({ page: _page }) => {
    // Phase 9: drop target is the CodeMirror source editor (not a structure cell).
    // Dropping should insert `${namespaceUri}.${typeName}` at the cursor position.
    test.skip(true, 'requires workspace-loading fixture');
    // When the fixture is available, drag a type from the explorer and drop it
    // into the source editor at a known cursor position, then assert the inserted
    // text matches the expected qualified name.
  });

  test('Cmd-Z / Ctrl-Z undoes a structure edit made via drag-drop', async ({ page: _page }) => {
    // Phase 7/8: edits applied through the structure view should be undoable via
    // the standard browser undo shortcut (zundo integration).
    test.skip(true, 'requires workspace-loading fixture');
    // When the fixture is available, perform a structure edit, press Cmd-Z /
    // Ctrl-Z, and assert the source reverts to its pre-edit state.
  });
});

// ---------------------------------------------------------------------------
// Visual snapshots
// ---------------------------------------------------------------------------

test.describe('Structure View — visual snapshots', () => {
  test('snapshot — collapsed Trade type', async ({ page: _page }) => {
    // Phase 11.2 scaffold: screenshot of the Structure pane showing the Trade
    // type in its collapsed (default) state.
    //
    // Disabled until a deterministic fixture is wired. When enabled, the
    // 0.02 maxDiffPixelRatio gives enough tolerance for sub-pixel rendering
    // variance across CI runners without masking real visual regressions.
    // Font-rendering and color-theme variance across CI environments is the
    // primary concern — consider restricting to a single platform in the
    // Playwright config when this is unskipped.
    test.skip(true, 'requires deterministic fixture');
    // When the fixture is available:
    // await loadInlineFiles(page, [{ name: 'trade.rosetta', content: TRADE_FIXTURE }]);
    // await page.getByRole('button', { name: /^structure$/i }).click();
    // const chevron = page.locator('.ns-row__chevron').first();
    // await chevron.click();
    // await page.locator('.ns-type__name', { hasText: 'Trade' }).dblclick();
    // await expect(page.getByTestId('structure-view-flow')).toBeVisible();
    // await expect(page).toHaveScreenshot('structure-collapsed.png', { maxDiffPixelRatio: 0.02 });
  });
});
