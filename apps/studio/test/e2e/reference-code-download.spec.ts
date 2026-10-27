// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { CURATED_MIRROR_BASE } from '@rune-langium/curated-schema';
import { createReferenceArtifacts } from '../../../../test/helpers/project-reference-artifacts.js';
import { openReferenceModels } from '../helpers/workspace-launcher.js';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { serveCuratedDeclarations } from '../helpers/curated-declaration-server.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

test('Code tab downloads an accepted reference through the captured project worker', async ({
  page,
  context
}, info) => {
  const source = 'namespace cdm.base.datetime\ntype BusinessCenters:\n code string (1..1)';
  const fixture = await createReferenceArtifacts({}, [['cdm', '1.0', {}]], { cdm: source }, CURATED_MIRROR_BASE);
  await serveCuratedDeclarations(context, [['types', source]]);
  await context.route('**/releases/*', (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        releases: fixture.releases.get(new URL(route.request().url()).pathname.split('/').pop()!) ?? []
      }
    })
  );
  await context.route('**/curated/*/artifacts/**', (route) => {
    const bytes = fixture.artifacts.get(route.request().url());
    return route.fulfill({
      status: bytes ? 200 : 404,
      body: bytes ? Buffer.from(bytes) : 'Unavailable',
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  });
  let legacyRequests = 0;
  await context.route('**/api/codegen', (route) => {
    legacyRequests++;
    return route.fulfill({ status: 500, body: 'Managed exports must use their captured worker input.' });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('./');
  await page.getByRole('button', { name: 'New workspace', exact: true }).click();
  const picker = await openReferenceModels(page);
  await picker.getByRole('button', { name: /CDM \(Common/ }).click();
  await picker.getByRole('combobox', { name: 'Release', exact: true }).click();
  await page.getByRole('option', { name: '1.0', exact: true }).click();
  await picker.getByRole('button', { name: /^(Add|Update) reference$/, exact: true }).click();
  await picker.getByRole('button', { name: 'Save reference change', exact: true }).click();
  await expect(picker.getByRole('heading', { name: 'Review reference change', exact: true })).toHaveCount(0);
  await expect(picker.getByRole('button', { name: /CDM \(Common/ })).toContainText('1.0');
  await page.getByTestId('rail-explore').click();
  await page.getByTestId('namespace-search').fill('BusinessCenters');
  await typeNavigationButton(page, 'cdm.base.datetime.BusinessCenters', 'Data').click();
  await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await page.getByTestId('codegen-targets-table__download-typescript').click();
  const dialog = page.getByTestId('download-config-dialog');
  await expect(page.getByTestId('download-config-dialog__ns-row-cdm.base.datetime')).toBeVisible();
  for (const checkbox of await dialog.getByRole('checkbox').all()) await checkbox.uncheck();
  await page.getByTestId('download-config-dialog__ns-cdm.base.datetime').check();
  await dismissLocalTransportNotices(page);
  expect(
    (await new AxeBuilder({ page }).include('[data-testid="download-config-dialog"]').analyze()).violations
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath('reference-download-dialog.png') });
  const downloaded = page.waitForEvent('download');
  await page.getByTestId('download-config-dialog__generate').click();
  const download = await downloaded;
  const path = info.outputPath('reference.zip');
  await download.saveAs(path);
  const zip = await JSZip.loadAsync(await readFile(path));
  const manifest = JSON.parse(await zip.file('.rune/export.json')!.async('string'));
  expect(manifest.projectReceipt.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(manifest.resolvedSelection.explicit).toContainEqual({
    namespace: 'cdm.base.datetime',
    name: 'BusinessCenters',
    kind: 'Data'
  });
  const text = (
    await Promise.all(manifest.files.map((file: { path: string }) => zip.file(file.path)!.async('string')))
  ).join('\n');
  expect(text).toContain('BusinessCenters');
  expect(text).toMatch(/code:\s*string/);
  expect(legacyRequests).toBe(0);
  expect(errors).toEqual([]);
});
