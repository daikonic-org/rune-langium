// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * J14 — Git / Sync perspective.
 *
 * Live-verified this session (not just from the brief's plan text) before
 * writing assertions:
 *
 * 1. `GitSyncPerspective.tsx` — `SyncStatusBadge` only renders when
 *    `workspaceKind === 'git-backed' && workspaceId`. A plain (non-git)
 *    workspace — the only kind reachable in this harness without real GitHub
 *    OAuth — always takes the `!isGitBacked` branch and renders
 *    `GitNotConnectedEmptyState` (testid `git-not-connected`, heading "Not
 *    connected to Git"). There is no literal "unauthenticated" phase on
 *    `SyncStatusBadge` itself — its real `data-phase` values
 *    (syncing/offline/blocked/idle) are only reachable for an
 *    already-git-backed workspace. The first test below asserts the real
 *    `git-not-connected` empty state instead of a nonexistent
 *    "SyncStatusBadge unauthenticated" state.
 *
 * 2. `FileLoader.tsx` / `WorkspacesPerspective.tsx` / `workspace-actions-
 *    context.ts` / `App.tsx` — the "Open from GitHub repository…" CTA (only
 *    rendered when `config.githubAuthEnabled && createGitBackedWorkspace`,
 *    both true in production: `githubAuthEnabled` defaults `true` via
 *    `VITE_ENABLE_GITHUB_AUTH`, and `WorkspacesPerspective` always receives a
 *    real `createGitBackedWorkspace` from `WorkspaceActionsContext`, wired in
 *    App.tsx to `WorkspaceManager.createGitBacked`). NOTE: `FileLoader.tsx`'s
 *    own doc comment claims "App.tsx hasn't threaded the prop in yet" — that
 *    comment is stale, left over from before the perspective-based
 *    `WorkspacesPerspective` launcher subsumed the start page; the prop is
 *    threaded today. Clicking the CTA opens a `Dialog` containing
 *    `GitHubWorkspaceFlow`, whose initial `phase: 'auth'` renders
 *    `GitHubConnectDialog` directly (testid `github-connect-dialog`,
 *    `role="dialog"`, `aria-label="Connect GitHub"`) — so the dialog is
 *    reachable exactly as the brief describes, just via one extra
 *    (transparent) wrapper component.
 *
 * 3. Step 2's live-verification target — the device-flow pending-phase
 *    selector. Read `GitHubConnectDialog.tsx` and its component test
 *    directly: the rendered `userCode` (`body.user_code`, passed straight
 *    through by `github-auth.ts`'s `initDeviceFlow` with no local
 *    reformatting or validation — it is whatever the real github-auth
 *    Worker / GitHub's device-flow API returns) has NO dedicated testid; it
 *    is rendered as `<strong>{state.init.userCode}</strong>`, the only
 *    `<strong>` element the pending phase renders (the component test's own
 *    mocked codes — `WXYZ-1234`, `CODE-OK`, `C` — vary in shape, confirming
 *    the format isn't locally validated/constrained, so a strict
 *    `[A-Z0-9]{4}-[A-Z0-9]{4}` regex would be over-fitting to one example
 *    rather than a real constraint). Per the brief's own instruction
 *    ("prefer a data-testid if one exists … over a text regex") — none
 *    exists — the precise selector available is the element itself
 *    (`dialog.locator('strong')`), not a guessed content regex. This journey
 *    hits the real auth worker, so a successful, non-empty render of that
 *    element (plus the verification-URI link) is what confirms the real
 *    device-flow init reached `pending`.
 */

import { Buffer } from 'node:buffer';
import { checkout as test, expect } from '../fixtures.js';

const WORKSPACE_FILE_NAME = 'starter.rosetta';
const WORKSPACE_FILE_CONTENT = 'namespace example\n';

test.describe('J14 — Git / Sync perspective', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');

  test(
    'J14 Git perspective renders and shows not-connected for a plain workspace',
    { annotation: { type: 'journey-subid', description: 'not-connected' } },
    async ({ page, evidence }) => {
      await page.goto('./');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('workspaces-perspective')).toBeVisible({ timeout: 20000 });
      const fileInput = page.locator('input[type="file"][accept=".rosetta"]');
      await fileInput.setInputFiles([
        { name: WORKSPACE_FILE_NAME, mimeType: 'text/plain', buffer: Buffer.from(WORKSPACE_FILE_CONTENT) }
      ]);
      await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });

      await page.getByTestId('rail-git').click();
      await expect(page.getByTestId('git-perspective')).toBeVisible({ timeout: 20000 });

      // SPEC ADAPTATION: the spec text says "SyncStatusBadge shows the
      // unauthenticated state" — confirmed via source this session that
      // SyncStatusBadge only renders for an already-git-backed workspace
      // (workspaceKind === 'git-backed'), which this plain workspace is not.
      // The real equivalent for a non-git workspace is GitNotConnectedEmptyState.
      await expect(page.getByTestId('git-not-connected')).toBeVisible({ timeout: 10000 });
      await evidence.checkpoint('git-not-connected');
    }
  );

  test(
    'J14 GitHubConnectDialog opens, reaches the device-flow pending phase, and cancels cleanly',
    { annotation: { type: 'journey-subid', description: 'github-connect' } },
    async ({ page, evidence }) => {
      await page.goto('./');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('workspaces-perspective')).toBeVisible({ timeout: 20000 });

      // Confirmed live this session: reached via WorkspacesPerspective's
      // FileLoader "Open from GitHub repository…" CTA (see file-header
      // comment), not via rail-git — matches an accessible-name substring
      // match either way.
      await page.getByRole('button', { name: /Open from GitHub/i }).click();
      const dialog = page.getByTestId('github-connect-dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });

      // Stop at the auth boundary — assert the device-flow init reached
      // `pending` (a verification URI + user code rendered), never visit the
      // real verificationUri.
      //
      // Step 2 live verification (see file-header comment #3): no dedicated
      // testid exists on the userCode/verificationUri display, so the
      // precise available selector is the single <strong> element the
      // pending phase renders (GitHubConnectDialog.tsx), corroborated by the
      // verification-URI link also becoming visible.
      const userCode = dialog.locator('strong');
      await expect(userCode).toBeVisible({ timeout: 15000 });
      await expect(userCode).not.toHaveText('', { timeout: 5000 });
      await expect(dialog.getByRole('link')).toBeVisible({ timeout: 5000 });
      await evidence.checkpoint('github-connect-pending');

      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).not.toBeVisible({ timeout: 5000 });
    }
  );
});
