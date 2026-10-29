// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test, expect } from '@playwright/test';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const source = `namespace polish
annotation marking:
 scheme string (1..1)
type Cash:
 value string (1..1)
type Security:
 value string (1..1)
choice Asset:
 Cash
 Security
enum AssetClass:
 Security
 Cash
type Payout:
 assetType AssetClass (1..1)
 underlier Asset (1..1) [marking scheme "scheme"="ISIN"]
 condition NotCash: if assetType <> AssetClass -> Security then underlier as Cash is absent
type Schedule:
 durationInYears number (0..1)
type Money:
 value number (1..1)
func Rate:
 inputs: durationInYears number (1..1)
 output: result number (1..1)
 set result: durationInYears
func Margin:
 inputs: schedule Schedule (1..1)
 output: result Money (0..1)
 alias rate: Rate(schedule -> durationInYears)
 set result -> value: rate
`;

test('selected objects, compact guards, details and regenerated code remain connected', async ({ page }, info) => {
  await page.setViewportSize({ width: 1646, height: 988 });
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'polish.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await page.getByTestId('namespace-search').fill('Payout');
  await typeNavigationButton(page, 'polish.Payout').click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await page.getByRole('tab', { name: 'Conditions', exact: true }).click();
  await page
    .getByRole('region', { name: 'Condition expression' })
    .getByRole('button', { name: 'TypeScript', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: 'Generated typescript' })).toContainText('!exists(underlier as Cash)');
  await expect(page.getByRole('textbox', { name: 'Generated typescript' })).not.toContainText('typeof');
  await expect(page.getByRole('textbox', { name: 'Generated typescript' })).toContainText('AssetClass.Security');
  await page.screenshot({ path: info.outputPath('enum-member-condition.png') });
  await page.getByRole('tab', { name: 'Members', exact: true }).click();
  await page
    .locator('[data-slot="attribute-row"]')
    .nth(1)
    .getByRole('textbox', { name: /Attribute name/ })
    .focus();
  const details = page.getByRole('region', { name: 'Details: underlier', exact: true });
  await expect(details.getByRole('button', { name: 'Edit marking annotation' })).toBeVisible();
  await expect(details.getByLabel('Definition')).toHaveCSS('resize', 'vertical');
  await page.getByRole('tab', { name: 'Details', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Doc', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Meta', exact: true })).toHaveCount(0);

  await page.getByTestId('namespace-search').fill('Margin');
  await typeNavigationButton(page, 'polish.Margin', 'RosettaFunction').click();
  const implementation = page.getByRole('region', { name: 'Function implementation' });
  await expect(implementation.getByText('Implementation', { exact: true })).toHaveCount(0);
  const rune = implementation.getByTestId('implementation-editor');
  await expect(rune).toContainText('set result');
  expect((await rune.boundingBox())!.height).toBeLessThan(160);
  await implementation.getByRole('button', { name: 'TypeScript', exact: true }).click();
  const projection = implementation.getByRole('textbox', { name: 'Generated typescript' });
  await expect(projection).toContainText('Rate(schedule.durationInYears)');
  await expect(projection).not.toContainText('RuneFuncData');
  await expect(projection).not.toContainText('Argument');
  await dismissLocalTransportNotices(page);
  await page.screenshot({ path: info.outputPath('compact-typed-body.png') });

  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.getByTestId('codegen-targets-table__view-typescript').click();
  await expect(page.getByTestId('codegen-status')).toContainText('Generated');
  await expect(page.getByTestId('code-preview-editor')).toContainText('function Margin(');
  await page.getByRole('button', { name: 'Regenerate TypeScript preview' }).click();
  await expect(page.getByTestId('codegen-status')).toContainText('Generated');
  await expect(page.getByTestId('code-preview-editor')).toContainText('function Margin(');
  await expect(page.getByTestId('code-preview-editor')).toBeVisible();
  await page.screenshot({ path: info.outputPath('selected-code-regenerated.png') });
});
