// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect } from '@playwright/test';
import { test } from '../helpers/studio-test.js';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

test('shows builtin implementation mappings and executes a fixed native pattern', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'patterns.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from(`namespace patterns
func Fixed:
 output: result pattern (1..1)
 set result: "^x+$"`)
  });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await page.getByTestId('namespace-search').fill('time');
  await typeNavigationButton(page, 'com.rosetta.model.time', 'RosettaBasicType').click();
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.getByTestId('codegen-targets-table__view-typescript').click();
  const preview = page.getByTestId('code-preview-editor');
  await expect(preview).toContainText('export type time = Temporal.PlainTime;');
  await page.getByTestId('namespace-search').fill('pattern');
  await typeNavigationButton(page, 'com.rosetta.model.pattern', 'RosettaBasicType').click();
  await expect(preview).toContainText('export type pattern = globalThis.RegExp;');
  await dismissLocalTransportNotices(page);
  await page.screenshot({ path: info.outputPath('native-builtin-mappings.png') });

  await page.getByTestId('rail-prototype').click();
  await page.getByRole('button', { name: /^Choose a function/ }).click();
  await page.getByRole('option', { name: /^Fixed.*patterns/ }).click();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('region', { name: 'result output' })).toContainText('^x+$');
});
