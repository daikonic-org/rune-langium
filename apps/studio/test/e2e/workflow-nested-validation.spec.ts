// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect } from '@playwright/test';
import { test } from '../helpers/studio-test.js';
import AxeBuilder from '@axe-core/playwright';
import { seedProjectBackingFiles } from '../helpers/project-backing.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const source = `namespace review
version "1.0.0"
type Cash:
 amount number (1..1)
type Asset:
 code string (1..1)
choice Payout:
 Cash
 Asset
type Payment:
 payout Payout (1..1)
type Transfer:
 reference string (1..1)
choice Settlement:
 Payment
 Transfer
type Trade:
 settlement Settlement (1..1)
func InspectTrade:
 inputs:
  trade Trade (1..1)
 output:
  result Trade (1..1)
 set result: trade
`;
const identity = (name: string, kind = 'Data') => ({ model: 'local', namespace: 'review', kind, name });

for (const theme of ['light', 'daikonic'])
  test(`nested choice diagnostics retain separate accepted forms in ${theme}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('./');
    await page
      .locator('input[type="file"][accept=".rosetta"]')
      .setInputFiles({ name: 'choices.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source) });
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await seedProjectBackingFiles(page, {
      'rune-config.yml': 'model: { name: Choices }\n',
      'build-config.yml': 'schemaVersion: 1\nsources: ["**/*.rosetta"]\ntargets: {}\n',
      'studio-config.yml': 'schemaVersion: 1\n',
      'choices.rosetta': source,
      'workflows/choices.workflow.json': JSON.stringify({
        schemaVersion: 1,
        id: 'choices',
        name: 'Nested choices',
        function: identity('InspectTrade', 'RosettaFunction'),
        inputs: { trade: { kind: 'literal', value: { settlement: { payment: { payout: {} } } } } },
        outputs: { result: { name: 'trade', type: identity('Trade') } }
      })
    });
    await page.getByTestId('rail-settings').click();
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    await page.getByTestId('rail-prototype').click();
    await dismissLocalTransportNotices(page);
    await page.getByRole('combobox', { name: 'Saved workflow', exact: true }).click();
    await page.getByRole('option', { name: 'Nested choices', exact: true }).click();
    await page.getByRole('button', { name: /^trade: 1 issue · View validation$/ }).click();
    const popover = page.locator('.workflow-validation-popover');
    const outer = popover.locator(':scope > ul > li > details').filter({ hasText: 'Accepted forms' }).first();
    await outer.locator(':scope > summary').click();
    const nested = outer.locator('ol > li > ul > li > details').filter({ hasText: 'Accepted forms' }).first();
    await expect(nested.locator(':scope > summary')).toContainText('2 alternatives');
    await nested.locator(':scope > summary').click();
    const forms = nested.locator(':scope > ol > li');
    await expect(forms).toHaveCount(2);
    await expect(forms.nth(0)).toContainText('settlement.payment.payout.cash:');
    await expect(forms.nth(0)).not.toContainText('settlement.payment.payout.asset:');
    await expect(forms.nth(1)).toContainText('settlement.payment.payout.asset:');
    await expect(forms.nth(1)).not.toContainText('settlement.payment.payout.cash:');
    expect((await new AxeBuilder({ page }).include('.workflow-validation-popover').analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`nested-choices-${theme}.png`) });
    expect(errors).toEqual([]);
  });
