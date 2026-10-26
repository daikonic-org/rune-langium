// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const source = `namespace imported
type Trade:
 amount number (1..1)
type Bond:
 amount number (1..1)
choice Instrument:
 Bond
typeAlias TradeAlias: Trade
typeAlias TradeAliasChain: TradeAlias
typeAlias InstrumentAlias: Instrument
choice Outer:
 Instrument
type CollisionBond:
 collisionBond string (1..1)
 collisionInstrument string (1..1)
choice CollisionInstrument:
 CollisionBond
choice CollisionOuter:
 CollisionInstrument
func CountTrades:
 inputs: trades Trade (0..*)
 output: total int (1..1)
 set total: trades count
func AcceptInstrument:
 inputs: instrument Instrument (1..1)
 output: total int (1..1)
 set total: 1
func CountAliasTrades:
 inputs: trades TradeAliasChain (0..*)
 output: total int (1..1)
 set total: trades count
func AcceptAliasInstrument:
 inputs: instrument InstrumentAlias (1..1)
 output: total int (1..1)
 set total: 1
func AcceptNestedInstrument:
 inputs: instrument Outer (1..1)
 output: total int (1..1)
 set total: 1
func AcceptCollisionInstrument:
 inputs: instrument CollisionInstrument (1..1)
 output: total int (1..1)
 set total: 1
func AcceptCollisionNested:
 inputs: instrument CollisionOuter (1..1)
 output: total int (1..1)
 set total: 1
`;

async function importInput(page: Page, name: string, value: unknown) {
  await page.getByRole('button', { name: `${name} node actions`, exact: true }).click();
  await page.getByRole('button', { name: 'Import input…', exact: true }).click();
  await page.getByRole('combobox', { name: 'Import format' }).click();
  await page.getByRole('option', { name: 'Rune JSON', exact: true }).click();
  await page.getByRole('textbox', { name: 'Import JSON data' }).fill(JSON.stringify(value));
  await page.getByRole('button', { name: 'Import', exact: true }).click();
}

for (const [scenario, func] of Object.entries({
  array: 'CountTrades',
  choice: 'AcceptInstrument',
  'alias-array': 'CountAliasTrades',
  'alias-choice': 'AcceptAliasInstrument',
  'nested-choice': 'AcceptNestedInstrument',
  'collision-choice': 'AcceptCollisionInstrument',
  'collision-nested': 'AcceptCollisionNested'
}))
  test(`Rune JSON ${scenario} inputs use linked declarations for real worker execution`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1461, height: 988 });
    await page.goto('./');
    await page
      .locator('input[type="file"][accept=".rosetta"]')
      .setInputFiles({ name: 'imports.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source) });
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await page.getByTestId('rail-prototype').click();
    await page.getByRole('button', { name: /^Choose a function/ }).click();
    await page.getByRole('option', { name: new RegExp(`${func}.*imported`) }).click();
    if (scenario.endsWith('array')) {
      for (const values of [
        [
          { '@type': 'imported.Trade', amount: 10 },
          { '@type': 'imported.Trade', amount: 20 }
        ],
        [{ amount: 30 }]
      ]) {
        await importInput(page, 'trades', values);
        await expect(page.getByRole('textbox', { name: 'Import JSON data' })).not.toBeVisible();
        await page.getByRole('button', { name: 'Execute', exact: true }).click();
        await expect(page.getByRole('region', { name: 'total output' })).toContainText(String(values.length));
      }
    } else {
      await importInput(
        page,
        'instrument',
        scenario.startsWith('collision-')
          ? {
              '@type': 'imported.CollisionBond',
              collisionBond: 'business-id',
              collisionInstrument: 'another-business-id'
            }
          : { '@type': 'imported.Bond', amount: 21 }
      );
      await expect(page.getByRole('textbox', { name: 'Import JSON data' })).not.toBeVisible();
      await page.getByRole('button', { name: 'Execute', exact: true }).click();
      await expect(page.getByRole('region', { name: 'total output' })).toContainText('1');
      await importInput(page, 'instrument', { '@type': 'imported.Trade', amount: 21 });
      await expect(page.getByRole('alert').filter({ hasText: /Choice|assignable/ })).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await dismissLocalTransportNotices(page);
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze()).violations
    ).toEqual([]);
    await page.screenshot({ path: info.outputPath(`rune-import-${scenario}.png`) });
  });
