// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors
import { test } from '../helpers/studio-test.js';
import { expect } from '@playwright/test';

for (const theme of ['daikonic', 'light'])
  test(`launcher lists share detailed cards without horizontal overflow (${theme})`, async ({ page }, info) => {
    await page.addInitScript((theme) => localStorage.setItem('rune-studio:theme', theme), theme);
    await page.goto('./');
    await page.getByTestId('rail-workspaces').click();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 720 });
      await page.getByTestId('workspaces-perspective').getByRole('button', { name: 'Workspaces', exact: true }).click();
      const examples = page.getByRole('list', { name: 'Example projects', exact: true });
      await expect(examples.locator('[data-slot="list-card"]').first()).toHaveAttribute('data-variant', 'detailed');
      await expect(examples.locator('[data-slot="list-card-description"]').first()).not.toBeEmpty();
      expect(await examples.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`examples-${width}.png`), animations: 'disabled' });
      await page.getByRole('button', { name: 'Reference models', exact: true }).click();
      const references = page.getByRole('list', { name: 'Reference models', exact: true });
      await expect(references.locator('[data-slot="list-card-description"]').first()).toHaveText(
        'Financial products, trades and lifecycle events.'
      );
      await expect(references.locator('[data-slot="list-card-detail"]').first()).toBeVisible();
      expect(await references.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`references-${width}.png`), animations: 'disabled' });
    }
  });
