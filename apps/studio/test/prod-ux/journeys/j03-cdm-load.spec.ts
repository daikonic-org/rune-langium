// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { checkout as test, expect, loadCdm, readOpLog, CDM_BUTTON } from '../fixtures.js';

test.describe('J03 — curated CDM load & unload', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');

  test('J03 loads and unloads CDM, recording cdmLoad timing', async ({ page, evidence }) => {
    const cdmLoadStartedAt = Date.now();
    await loadCdm(page, evidence);
    // loadCdm() only waits for the model chip + Unload button to mount, which
    // happens as soon as the curated archive's metadata-only load resolves —
    // BEFORE App.tsx's model-change effect re-parses/re-links and populates
    // the model's real file list (ModelLoader.tsx's isHydrating: curated
    // bundles render "(loading…)" until files.length > 0). Wait for that
    // transition too, or a slow/stuck /api/parse would stop the clock early
    // and silently pass the budget check — the exact gap this journey exists
    // to catch.
    //
    // Scoped to the CDM badge specifically (not `model-loader` as a whole):
    // against the real production corpus, CDM's registry entry pulls in
    // FpML as a dependency, so `ModelLoader.tsx` renders TWO
    // `LoadedModelBadge`s (CDM + FpML), each with its own "(N files)" text —
    // a bare `model-loader`-wide getByText(/\(\d+ files?\)/) hits Playwright
    // strict-mode ambiguity ("resolved to 2 elements") the moment both
    // finish hydrating, and asserting on "any" files-count badge is also
    // semantically wrong here: it could pass on FpML's badge while CDM's own
    // chip is still stuck "(loading…)", defeating the whole point of this
    // wait (confirmed live against production this session). Locate the CDM
    // badge via its already-proven `Unload ${CDM_BUTTON}` accessible name
    // (same locator loadCdm() itself asserts on) and walk up to the badge
    // container, mirroring ModelLoader.tsx's DOM (the unload button is a
    // direct child of the badge div alongside the "(N files)" span).
    const cdmBadge = page.getByRole('button', { name: `Unload ${CDM_BUTTON}` }).locator('xpath=..');
    await expect(cdmBadge.getByText(/\(\d+ files?\)/)).toBeVisible({ timeout: 90000 });
    const cdmLoadWallClockMs = Date.now() - cdmLoadStartedAt;
    await evidence.checkpoint('cdm-loaded');

    const opLog = await readOpLog(page);
    const modelLoadEntries = opLog.filter((e) => e.op === 'modelLoad' && e.subject === 'cdm');
    expect(
      modelLoadEntries.length,
      'expected a modelLoad op-log entry for the cdm subject (Task 6 instrumentation)'
    ).toBeGreaterThan(0);
    const successEntry = modelLoadEntries.find((e) => e.level === 'success');
    expect(successEntry?.durationMs, 'cdmLoad duration should be recorded').toBeGreaterThanOrEqual(0);

    // Budget check uses a test-side wall-clock stopwatch spanning the full
    // click-to-loaded UI transition (including the curated parse/link that
    // happens in App.tsx's model-change effect AFTER model-store's own
    // modelLoad span closes) rather than the opLog entry's durationMs, which
    // only covers the initial metadata fetch and can miss a slow/stuck parse.
    if (cdmLoadWallClockMs > 45000) {
      evidence.softFinding('cdmLoad-budget', `cdmLoad took ${cdmLoadWallClockMs}ms, over the 45s soft budget`);
    }

    await page.getByRole('button', { name: /Unload CDM/ }).click();
    await expect(page.getByTestId('workspaces-perspective')).toBeVisible({ timeout: 20000 });
    await evidence.checkpoint('cdm-unloaded');
  });
});
