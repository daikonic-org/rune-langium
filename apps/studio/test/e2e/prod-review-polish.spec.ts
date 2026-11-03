// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

for (const width of [1024, 800])
  test(`recent workspace names stay readable at ${width}px with larger text`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./');
    for (const name of ['Collateral agreement — desk examples', 'Clearing agreement — desk examples']) {
      await page.getByRole('button', { name: 'New workspace', exact: true }).click();
      await expect(page.getByTestId('explore-workbench')).toBeVisible();
      await page.getByTestId('rail-workspaces').click();
      const row = page.getByTestId('workspace-row').first();
      await row.getByRole('button', { name: /^Rename / }).click();
      await row.getByRole('textbox', { name: 'Workspace name' }).fill(name);
      await row.getByRole('textbox', { name: 'Workspace name' }).press('Enter');
      await expect(row.getByRole('button', { name: `Open ${name}`, exact: true })).toBeVisible();
    }
    for (const [scale, label] of [
      ['md', 'medium'],
      ['lg', 'large']
    ] as const) {
      await page.getByTestId('rail-settings').click();
      const font = page.getByTestId('settings-perspective').getByRole('button', { name: /Pane font size/ });
      for (let step = 0; step < 3 && (await font.getAttribute('data-font-scale-current')) !== scale; step++)
        await font.click();
      await expect(font).toHaveAttribute('data-font-scale-current', scale);
      await page.getByTestId('rail-workspaces').click();
      const rows = page.getByTestId('workspace-row');
      await expect(rows).toHaveCount(2);
      for (const row of await rows.all()) {
        const name = row.locator('.studio-recent-workspace__name');
        const meta = row.locator('.studio-recent-workspace__metadata');
        const nameBox = (await name.boundingBox())!;
        const metaBox = (await meta.locator('span').first().boundingBox())!;
        expect(nameBox.width).toBeGreaterThanOrEqual(160);
        if (metaBox.y < nameBox.y + nameBox.height) expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(metaBox.x);
        await expect(name).toHaveAttribute('title', (await name.innerText()).trim());
      }
      await dismissLocalTransportNotices(page);
      await page.screenshot({ path: info.outputPath(`recents-${label}.png`) });
    }
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="workspaces-perspective"]').analyze()).violations
    ).toEqual([]);
    await page.getByTestId('rail-git').click();
    await page.getByRole('button', { name: 'Open Workspaces', exact: true }).click();
    await expect(page.getByTestId('workspaces-perspective')).toBeVisible();
    await page.getByTestId('rail-explore').click();
    await page.getByRole('button', { name: 'Import Model', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Skip validation conditions', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Include unused type definitions', exact: true })).toBeVisible();
  });

test('generated code gains reading height while its selection and editor stay intact', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'code-reading.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from('namespace review\ntype Quote:\n amount number (1..1)\n')
  });
  await page.getByTestId('rail-settings').click();
  await page.getByTestId('settings-perspective').getByLabel('Theme', { exact: true }).selectOption('light');
  await page.getByTestId('rail-explore').click();
  await page.getByTestId('namespace-search').fill('Quote');
  await page.getByRole('button', { name: 'Navigate to Quote', exact: true }).click();
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.getByTestId('codegen-targets-table__view-typescript').click();
  const code = page.getByTestId('code-preview-editor');
  await expect(code).toContainText('Quote');
  const before = (await code.boundingBox())!;
  await page.getByRole('button', { name: 'Hide generation targets', exact: true }).click();
  await expect(page.getByTestId('codegen-targets-table')).toBeHidden();
  expect((await code.boundingBox())!.height).toBeGreaterThan(before.height + 100);
  await expect(page.getByTestId('codegen-active-target')).toHaveText('TypeScript');
  await expect(code).toContainText('Quote');
  await dismissLocalTransportNotices(page);
  expect(
    (
      await new AxeBuilder({ page })
        .include('.dv-tabs-and-actions-container')
        .include('[data-testid="code-preview-editor"]')
        .withRules(['color-contrast'])
        .analyze()
    ).violations
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath('code-reading-expanded.png') });
  await page.getByRole('button', { name: 'Show generation targets', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Regenerate TypeScript preview', exact: true })).toBeVisible();
  await expect(code).toContainText('Quote');
});
