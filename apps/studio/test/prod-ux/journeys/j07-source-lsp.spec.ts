// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { fullSourceEditor } from '../../helpers/source-editor.js';
import { checkout as test, expect } from '../fixtures.js';

const WORKSPACE_FILE_NAME = 'starter.rosetta';
const WORKSPACE_FILE_CONTENT = 'namespace example\ntype Foo:\n    bar string (1..1)\n';

// CodeMirror's defaultKeymap binds "select all" to Cmd-A on Mac (Meta) and
// Ctrl-A elsewhere — on Mac it separately binds a bare Ctrl-A to the emacs-
// style cursorLineBoundaryBackward command, so a hardcoded literal
// 'Control+A' on a Mac-hosted browser moves the caret instead of selecting
// text, and the following Delete only forward-deletes one character. Same
// platform-modifier pattern already used by fixtures.ts's
// authorScratchType/authorScratchFunction and j08-edit-roundtrip.spec.ts.
const platformModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('J07 — Source view + LSP diagnostics', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');

  test('J07 LSP connects and a syntax error surfaces as a diagnostic', async ({ page, evidence }) => {
    await page.goto('./');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('workspaces-perspective')).toBeVisible({ timeout: 20000 });

    const fileInput = page.locator('input[type="file"][accept=".rosetta"]');
    await fileInput.setInputFiles([
      { name: WORKSPACE_FILE_NAME, mimeType: 'text/plain', buffer: Buffer.from(WORKSPACE_FILE_CONTENT) }
    ]);
    await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });

    // The bottom utility group (Problems/Activity/Output) starts collapsed —
    // layout-factory.ts's buildDefaultLayout() sets bottomGroup.collapsed = true
    // for a fresh workspace, and DockShell/CenterStackPanel implement "collapsed"
    // as `group.api.setSize({ height: 0 })`, not an unmount. Without expanding it
    // first, `panel-problems` exists in the DOM but has zero height and never
    // satisfies Playwright's toBeVisible().
    await page.getByTestId('toggle-utilities').click();
    await expect(page.getByTestId('panel-problems')).toBeVisible({ timeout: 10000 });

    // LspConnectionBadge (data-testid="lsp-badge-connected") only renders on a
    // `connected` state when `import.meta.env.DEV` is true — in production it
    // renders null on success (see LspConnectionBadge.tsx). There is no
    // `lsp-connection-badge` testid and no `data-status` attribute anywhere in
    // that component. The reliable, always-rendered production signal is the
    // neighboring ConnectionStatus `<output>` in the same status footer, whose
    // text reads "Connected" (optionally suffixed with the transport mode, e.g.
    // "Connected (WebSocket)").
    const footer = page.locator('footer.glass-statusbar');
    await expect(footer.getByText(/^Connected/)).toBeVisible({ timeout: 20000 });
    await evidence.checkpoint('lsp-connected');

    // A fresh workspace only opens the Structure pane (DockShell's
    // activePanes seed) — Source is not active yet, so `source-editor` isn't
    // mounted/visible until we switch to it, same as production-checkout.spec.ts
    // / j04-explorer-hydration.spec.ts do before asserting on source content.
    await page.getByRole('button', { name: 'Source' }).click();

    // Click into CodeMirror's content element (the established pattern in
    // test/e2e/source-editor.spec.ts) rather than the outer `source-editor`
    // section, so keyboard input is guaranteed to land in the editable surface.
    const editor = fullSourceEditor(page);
    await expect(editor).toBeVisible({ timeout: 10000 });
    await editor.locator('.cm-content').click();
    await page.keyboard.type('type Bad syntax here###');
    await expect(page.getByTestId('panel-problems').getByText(/error/i)).toBeVisible({ timeout: 10000 });
    await evidence.checkpoint('diagnostic-shown');

    await page.keyboard.press(`${platformModifier}+A`);
    await page.keyboard.press('Delete');
    await page.keyboard.type(WORKSPACE_FILE_CONTENT);
    await expect(page.getByTestId('panel-problems').getByText(/error/i)).toHaveCount(0, { timeout: 10000 });
    await evidence.checkpoint('diagnostic-cleared');
  });
});
