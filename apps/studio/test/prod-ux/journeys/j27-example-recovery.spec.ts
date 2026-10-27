// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { checkout as test, expect, captureOpLogSnapshot } from '../fixtures.js';
import { projectBackingFiles } from '../../helpers/project-backing.js';

test('J27 failed example decoding retains original bytes and recovers after an explicit repair and reload', async ({
  page,
  evidence
}) => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'requires a deployed Studio');
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'seed.rosetta', mimeType: 'text/plain', buffer: Buffer.from('namespace seed\n') });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  const original = '{ "@type": "example.Trade", "payment": {"@type":"example.Other","amount":21} }\n';
  const descriptor = JSON.stringify({
    schemaVersion: 1,
    id: 'broken',
    name: 'Retained example',
    type: { model: 'local', namespace: 'example', name: 'Trade', kind: 'Data' },
    payload: 'examples/broken.json',
    codec: 'RUNE_JSON'
  });
  await projectBackingFiles(page, {
    'build-config.yml': 'schemaVersion: 1\nsources: ["model/**/*.rosetta"]\n',
    'rune-config.yml': 'model: {name: Example}\n',
    'model/trade.rosetta':
      'namespace example\ntype Other:\n amount number (1..1)\ntype Cash:\n amount number (1..1)\nchoice Payment:\n Cash\ntype Trade:\n payment Payment (1..1)\n',
    'examples/broken.example.json': descriptor,
    'examples/broken.json': original
  });
  await captureOpLogSnapshot(page, evidence);
  await page.reload();
  evidence.markNavigation();
  await page.getByTestId('rail-prototype').click();
  const row = page.getByTestId('prototype-grid').locator('tbody tr').filter({ hasText: 'Retained example' });
  await expect(row).toContainText(/failed/i);
  await row.getByRole('button', { name: 'Retry saving Retained example', exact: true }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: /original|repair|reload/i })
      .first()
  ).toBeVisible();
  const retained = await projectBackingFiles(page);
  expect(retained['examples/broken.json']).toBe(original);
  expect(retained['examples/broken.example.json']).toBe(descriptor);
  await evidence.checkpoint('decode-error-retains-source');
  await projectBackingFiles(page, {
    'examples/broken.json': '{"@type":"example.Trade","payment":{"@type":"example.Cash","amount":21}}'
  });
  await captureOpLogSnapshot(page, evidence);
  await page.reload();
  evidence.markNavigation();
  await page.getByTestId('rail-prototype').click();
  await expect(row).toContainText(/saved/i);
  await row.click();
  await page.getByRole('button', { name: 'Open Payment details', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Amount', { exact: true })).toHaveValue('21');
  await evidence.checkpoint('repaired-example-editable');
});
