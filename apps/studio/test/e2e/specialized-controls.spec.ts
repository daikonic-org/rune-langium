// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { test } from '../helpers/studio-test.js';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
import { waitForEntranceAnimations } from '../prod-ux/readiness.js';
import { writeFile } from 'node:fs/promises';

const source = `namespace shared.pickers
version "1.0.0"
synonym source FpML
synonym source ISO
type Person:
 name string (1..1)
type Trade:
 person Person (0..1)
`;

async function capture(page: Page, info: TestInfo, name: string, trigger: Locator) {
  await waitForEntranceAnimations(page);
  const popup = page.locator('[data-slot="popover-content"]:visible').last();
  const anchor = (await trigger.boundingBox())!;
  const menu = (await popup.boundingBox())!;
  const viewport = page.viewportSize()!;
  const x = Math.max(0, Math.min(anchor.x, menu.x) - 12);
  const y = Math.max(0, Math.min(anchor.y, menu.y) - 12);
  const right = Math.min(viewport.width, Math.max(anchor.x + anchor.width, menu.x + menu.width) + 12);
  const bottom = Math.min(viewport.height, Math.max(anchor.y + anchor.height, menu.y + menu.height) + 12);
  await page.screenshot({ path: info.outputPath(`${name}.png`), clip: { x, y, width: right - x, height: bottom - y } });
  return popup.evaluate((element) => ({
    searchHeight: element.querySelector('input')?.getBoundingClientRect().height,
    emptyStateHeight: element.querySelector('[data-slot="command-empty"]')?.getBoundingClientRect().height,
    optionHeights: [...element.querySelectorAll('[role="option"]')]
      .slice(0, 5)
      .map((row) => row.getBoundingClientRect().height)
  }));
}

for (const theme of ['light', 'daikonic'])
  for (const width of [1280, 390]) {
    test(`shared specialized pickers at ${width}px in ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 720 });
      await page.goto(`./?theme=${theme}`);
      await page
        .locator('input[type="file"][accept=".rosetta"]')
        .setInputFiles({ name: 'pickers.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source) });
      await typeNavigationButton(page, 'shared.pickers.Person').click();
      const show = page.getByRole('button', { name: 'Inspector', exact: true });
      if ((await show.getAttribute('aria-pressed')) !== 'true') await show.click();
      if (width === 390) await page.getByRole('button', { name: 'Focus Inspector', exact: true }).click();
      await dismissLocalTransportNotices(page);
      const row = page.locator('[data-slot="attribute-row"]').first();
      const cardinality = row.getByRole('button', { name: 'Cardinality 1..1', exact: true });
      await cardinality.click();
      const metrics: Record<string, unknown> = { cardinality: await capture(page, info, 'cardinality', cardinality) };
      await page.getByRole('option', { name: 'Custom…', exact: true }).click();
      const custom = page.getByRole('textbox', { name: 'Custom cardinality', exact: true });
      await custom.fill('3..2');
      await custom.press('Enter');
      await expect(custom).toHaveAttribute('aria-invalid', 'true');
      await capture(page, info, 'custom-error', cardinality);
      await custom.fill('1..1');
      await custom.press('Enter');
      await expect(custom).toBeHidden();
      const type = row.locator('[data-slot="type-picker-trigger"]');
      await type.click();
      await page.getByRole('textbox', { name: 'Search types', exact: true }).fill('Trade');
      await expect(page.getByTestId('nstp-type-shared.pickers.Trade#Data')).toBeVisible();
      metrics.type = await capture(page, info, 'type-search', type);
      await page.keyboard.press('Escape');
      await row.getByRole('textbox', { name: 'Attribute name: name', exact: true }).focus();
      const details = page.getByRole('region', { name: 'Details: name', exact: true });
      const sourceTrigger = details.locator('[data-slot="source-ref-trigger"]');
      await sourceTrigger.scrollIntoViewIfNeeded();
      await sourceTrigger.click();
      const search = page.getByRole('combobox', { name: 'Search sources', exact: true });
      await expect(search).toBeVisible();
      const emptyState = page.locator('[data-slot="popover-content"]:visible [data-slot="command-empty"]');
      await expect(emptyState).toHaveJSProperty('offsetHeight', 0);
      metrics.source = await capture(page, info, 'source-search', sourceTrigger);
      await search.fill('not-a-source');
      await expect(emptyState).toHaveText('No matching options.');
      await expect(emptyState).toBeVisible();
      await search.fill('FpML');
      await expect(emptyState).toBeEmpty();
      await expect(emptyState).toHaveJSProperty('offsetHeight', 0);
      await search.press('ArrowDown');
      await search.press('Enter');
      await expect(sourceTrigger).toHaveText('FpML');
      await details.getByRole('textbox', { name: 'Synonym value', exact: true }).fill('partyName');
      await details.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(details.getByRole('button', { name: 'Edit synonym 1', exact: true })).toBeVisible();
      await writeFile(info.outputPath('geometry.json'), JSON.stringify(metrics, null, 2));
    });
  }
