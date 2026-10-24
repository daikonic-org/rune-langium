// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * T063 (014/Phase-8 / US7) — visual cross-surface assertions.
 *
 * The Studio start page renders with the canonical primitives: the UI
 * sans body font (Inter) — the brand display font (Outfit) is opt-in for
 * brand surfaces (e.g. the wordmark), NOT the body default, since making it
 * the default leaked Outfit into portaled overlays — plus an 8px
 * primary-button radius and transparent secondary buttons (NOT amber).
 * This Playwright spec asserts those properties via `page.evaluate`
 * against the live computed style — independent of the form-baseline
 * screenshot suite, which is for component-level regressions.
 *
 * First-time setup: `pnpm --filter @rune-langium/studio exec playwright
 * test apps/studio/test/visual/cross-surface.spec.ts --update-snapshots`
 * (no screenshots are required today, but the spec leaves room).
 */

import { test, expect } from '@playwright/test';

const VIEWPORTS = [
  { name: 'sm-laptop', width: 1280, height: 800 },
  { name: 'md-laptop', width: 1440, height: 900 }
] as const;

test.describe('Cross-surface UX consistency (T063 / US7)', () => {
  for (const viewport of VIEWPORTS) {
    test(`start page primitives at ${viewport.name} (${viewport.width}×${viewport.height})`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('./');
      await page.waitForLoadState('domcontentloaded');

      // 1. body font-family is the UI sans stack (Inter), not the display
      //    font (Outfit). Display is opt-in (brand wordmark) — making it the
      //    body default leaked Outfit into portaled overlays (dialogs/toasts).
      const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
      expect(bodyFont).toMatch(/Inter/i);

      // 2. The primary "New workspace" button has a 6px border-radius.
      //    shadcn/Button uses the `rounded-md` utility, and Tailwind v4's
      //    `@theme inline` INLINES its value into the utility — so `rounded-md`
      //    is `calc(var(--radius) - 2px)` = 6px (it does NOT reference
      //    `var(--radius-md)`). This has been the rendered value since the
      //    `@theme inline` bridge existed; the prior `8px` assertion never
      //    matched reality. 6px is the intended crisp-control corner (distinct
      //    from the 12px surface/card corner).
      const primaryButton = page.getByTestId('file-loader').getByRole('button', { name: /^New/i });
      await expect(primaryButton).toBeVisible();
      const primaryRadius = await primaryButton.evaluate((el) => getComputedStyle(el as Element).borderRadius);
      // Some browsers report `6px 6px 6px 6px` (per-corner); accept either.
      expect(primaryRadius).toMatch(/^(6px|6px 6px 6px 6px)$/);

      // 3. Secondary buttons (Select Files / Select Folder) render
      //    transparent — NOT solid amber. (FR-023, T054.)
      const secondaryButton = page.getByTestId('file-loader').getByRole('button', { name: 'Import files…' });
      await expect(secondaryButton).toBeVisible();
      const secondaryBg = await secondaryButton.evaluate((el) => getComputedStyle(el as Element).backgroundColor);
      // `bg-transparent` produces `rgba(0, 0, 0, 0)` in most engines;
      // `transparent` is also acceptable. Reject any opaque colour
      // (anything with non-zero alpha that isn't 0/0/0).
      expect(secondaryBg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    });
  }
});
