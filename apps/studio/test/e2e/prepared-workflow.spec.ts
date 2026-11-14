// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect } from '@playwright/test';
import { test } from '../helpers/studio-test.js';
import { projectBackingFiles, seedProjectBackingFiles } from '../helpers/project-backing.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
import { projectFileRevision } from '@rune-langium/project-config';
import driver from '../../../cdm-example-data-worker/src/generated/driver-source.json' with { type: 'json' };

const provider = `namespace prepared\nversion "1.0.0"\nfunc Rate:\n output: result number (1..1)\n set result: 1\n`;
const caller = `namespace prepared\nversion "1.0.0"\nfunc Accrue:\n inputs:\n  principal number (1..1)\n output:\n  result number (1..1)\n set result: principal * Rate()\n`;
const preparedProvider = provider.replace('result: 1', 'result: 0.0433');
const preparation = {
  module: 'scripts/prepare.ts',
  driver: 'scripts/driver.js',
  outputs: ['model/rate.rosetta'],
  parameters: { date: '2026-11-02', generation: 1 }
};
const recipe = {
  schemaVersion: 1,
  id: 'prepared',
  name: 'Prepared rate calculation',
  function: { model: 'local', namespace: 'prepared', name: 'Accrue', kind: 'RosettaFunction' },
  inputs: { principal: { kind: 'literal', value: 1000 } },
  outputs: { result: { name: 'result' } },
  preparation
};
const module = `import { drizzle, eq, benchmarkData } from './driver.js';
export default async (connection, { parameters }) => {
  const db = drizzle((sql, params, method) => connection.query(sql, params, method));
  const row = await db.select({ value: benchmarkData.value }).from(benchmarkData).where(eq(benchmarkData.date, parameters.date)).get();
  if (!row) throw new Error('The pinned fixing is unavailable.');
  return { schemaVersion: 1, sources: { 'model/rate.rosetta': ${JSON.stringify(provider)}.replace('result: 1', 'result: ' + row.value) } };
};`;

test('prepares a calculation in isolation, reviews provider sources and explicitly saves them for offline use', async ({
  page
}, info) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1280, height: 720 });
  let requests = 0;
  await page.route('**/api/database-preparation', async (route) => {
    requests++;
    const request = route.request().postDataJSON();
    expect(request.driverRevision).toBe(await projectFileRevision(driver.source));
    expect(request.input).toEqual({ inputs: { principal: 1000 }, parameters: preparation.parameters });
    await route.fulfill({
      json: {
        schemaVersion: 1,
        executionId: '9eff0b54-f949-47ad-9fd0-794cce5cd58a',
        projectRevision: request.projectRevision,
        queryCount: 1,
        value: { schemaVersion: 1, sources: { 'model/rate.rosetta': preparedProvider } }
      }
    });
  });
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'bootstrap.rosetta', mimeType: 'text/plain', buffer: Buffer.from('namespace bootstrap\n') });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await seedProjectBackingFiles(page, {
    'rune-config.yml': 'model: { name: Prepared }\n',
    'build-config.yml': 'schemaVersion: 1\nsources: ["model/**/*.rosetta"]\n',
    'studio-config.yml': 'schemaVersion: 1\nexamples: examples\nworkflows: workflows\nlayouts: layouts\n',
    'model/rate.rosetta': provider,
    'model/accrue.rosetta': caller,
    'scripts/prepare.ts': module,
    'scripts/driver.js': driver.source,
    'workflows/prepared.workflow.json': JSON.stringify(recipe),
    'workflows/offline.workflow.json': JSON.stringify({
      ...recipe,
      id: 'offline',
      name: 'Offline rate calculation',
      preparation: undefined
    })
  });
  // Synthetic credentials belong only to this fresh test context's private OPFS directory.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    for await (const [, directory] of root.entries()) {
      if (directory.kind !== 'directory') continue;
      try {
        await directory.getDirectoryHandle('files');
      } catch {
        continue;
      }
      const privateDir = await directory.getDirectoryHandle('.studio', { create: true });
      const file = await privateDir.getFileHandle('token', { create: true }),
        writer = await file.createWritable();
      await writer.write('synthetic-preparation-token');
      await writer.close();
      return;
    }
    throw new Error('Test workspace not found.');
  });
  await dismissLocalTransportNotices(page);
  await page.getByTestId('rail-prototype').click();
  const choose = async (name: string) => {
    await page.getByRole('combobox', { name: 'Saved workflow', exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
    await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
  };
  await choose('Prepared rate calculation');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('43.3');
  expect((await projectBackingFiles(page))['model/rate.rosetta']).toBe(provider);
  await choose('Offline rate calculation');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('1000');
  await choose('Prepared rate calculation');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await page.getByRole('button', { name: 'Review prepared data', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Prepared provider sources', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('0.0433');
  await expect
    .poll(() =>
      dialog.evaluate((element) =>
        element.getAnimations({ subtree: true }).every((animation) => animation.playState !== 'running')
      )
    )
    .toBe(true);
  await page.screenshot({ path: info.outputPath('prepared-data-review-hd.png') });
  await dialog.getByRole('button', { name: 'Save prepared data', exact: true }).click();
  await expect.poll(async () => (await projectBackingFiles(page))['model/rate.rosetta']).toBe(preparedProvider);
  const files = await projectBackingFiles(page);
  expect(JSON.parse(files['model/rate.rosetta.9eff0b54-f949-47ad-9fd0-794cce5cd58a.preparation.json']!)).toMatchObject({
    queryCount: 1,
    sourceRevisions: { 'model/rate.rosetta': expect.stringMatching(/^[a-f0-9]{64}$/) }
  });
  expect(JSON.stringify(files)).not.toContain('synthetic-preparation-token');
  await page.reload();
  await dismissLocalTransportNotices(page);
  await page.getByTestId('rail-prototype').click();
  await choose('Offline rate calculation');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByTestId('instance-payload-output')).toContainText('43.3');
  expect(requests).toBe(2);
});
