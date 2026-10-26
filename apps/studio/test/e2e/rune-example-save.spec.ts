// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { projectBackingFiles } from '../helpers/project-backing.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

test('renames and reopens a Rune JSON example through the real worker without losing metadata or wire headers', async ({
  page
}, info) => {
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
  await page.reload();
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
    await page.reload();
    await page.getByTestId('rail-prototype').click();
  }
  await dismissLocalTransportNotices(page);
  expect(
    (await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze()).violations
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath('rune-json-example-resaved.png') });
});
