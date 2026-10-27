// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { projectBackingFiles } from './project-backing.js';
import { dismissLocalTransportNotices } from './expression-workspace.js';

import { reloadJourney, type JourneyObserver } from './journey-observer.js';

export async function checkRuneJsonMetadata(page: Page, observer: JourneyObserver = {}): Promise<void> {
  await page.setViewportSize({ width: 1461, height: 988 });
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'bootstrap.rosetta', mimeType: 'text/plain', buffer: Buffer.from('namespace bootstrap\n') });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  const wire = {
    '@model': 'source-model',
    '@type': 'example.Trade',
    '@version': '7',
    amount: { '@data': 21, '@scheme': 'USD' }
  };
  await projectBackingFiles(page, {
    'rune-config.yml': 'model: {name: Example}\n',
    'build-config.yml': 'schemaVersion: 1\nsources: ["model/**/*.rosetta"]\n',
    'model/trade.rosetta': 'namespace example\ntype Trade:\n amount number (1..1)\n  [metadata scheme]\n',
    'examples/wire.example.json': JSON.stringify({
      schemaVersion: 1,
      id: 'wire',
      name: 'Wire trade',
      type: { model: 'local', namespace: 'example', name: 'Trade', kind: 'Data' },
      payload: 'examples/wire.json',
      codec: 'RUNE_JSON'
    }),
    'examples/wire.json': JSON.stringify(wire)
  });
  await reloadJourney(page, observer);
  await page.getByTestId('rail-prototype').click();
  const grid = page.getByTestId('prototype-grid');
  for (const name of ['Renamed trade', 'Reopened trade']) {
    const row = grid.locator('tbody tr').first();
    await expect(row).toContainText('saved');
    await row.getByRole('button', { name: 'Rename', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Rename example', exact: true });
    await dialog.getByRole('textbox', { name: 'Example name', exact: true }).fill(name);
    await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(row).toContainText(name);
    await expect(row).toContainText('saved');
    await expect
      .poll(async () => {
        const files = await projectBackingFiles(page);
        expect(JSON.parse(files['examples/wire.json']!)).toEqual(wire);
        const descriptor = JSON.parse(files['examples/wire.example.json']!);
        expect(descriptor.codec).toBe('RUNE_JSON');
        return descriptor.name;
      })
      .toBe(name);
    await reloadJourney(page, observer);
    await page.getByTestId('rail-prototype').click();
  }
  await dismissLocalTransportNotices(page);
  expect(
    (await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze()).violations
  ).toEqual([]);
  await observer.checkpoint?.('rune-json-example-resaved');
}

export async function checkRuneJsonChoice(page: Page, observer: JourneyObserver = {}): Promise<void> {
  await page.setViewportSize({ width: 1461, height: 988 });
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'bootstrap.rosetta', mimeType: 'text/plain', buffer: Buffer.from('namespace bootstrap\n') });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  const wire = { '@type': 'example.Trade', payment: { '@type': 'example.Cash', amount: 21 } };
  await projectBackingFiles(page, {
    'rune-config.yml': 'model: {name: Example}\n',
    'build-config.yml': 'schemaVersion: 1\nsources: ["model/**/*.rosetta"]\n',
    'model/trade.rosetta':
      'namespace example\ntype Cash:\n amount number (1..1)\nchoice Payment:\n Cash\ntype Trade:\n payment Payment (1..1)\nfunc AcceptTrade:\n inputs: trade Trade (1..1)\n output: total int (1..1)\n set total: 1\n',
    'examples/wire.example.json': JSON.stringify({
      schemaVersion: 1,
      id: 'wire',
      name: 'Wire trade',
      type: { model: 'local', namespace: 'example', name: 'Trade', kind: 'Data' },
      payload: 'examples/wire.json',
      codec: 'RUNE_JSON'
    }),
    'examples/wire.json': JSON.stringify(wire)
  });
  await reloadJourney(page, observer);
  await page.getByTestId('rail-prototype').click();
  const row = page.getByTestId('prototype-grid').locator('tbody tr').first();
  await expect(row).toContainText('saved');
  await row.click();
  await page.getByRole('button', { name: 'Open Payment details', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox')).toHaveText('Cash');
  await expect(dialog.getByLabel('Amount', { exact: true })).toHaveValue('21');
  await dialog.getByLabel('Amount', { exact: true }).fill('22');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Choose a function/ }).click();
  await page.getByRole('option', { name: /AcceptTrade.*example/ }).click();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('region', { name: 'total output' })).toContainText('1');
  await row.getByRole('button', { name: 'Rename', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Rename example', exact: true });
  await rename.getByRole('textbox', { name: 'Example name', exact: true }).fill('Choice restored');
  await rename.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(row).toContainText('saved');
  expect(JSON.parse((await projectBackingFiles(page))['examples/wire.json']!)).toEqual(wire);
  await dismissLocalTransportNotices(page);
  expect(
    (await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze()).violations
  ).toEqual([]);
  await observer.checkpoint?.('reopened-choice');
}
