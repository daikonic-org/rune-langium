// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { checkout as test, expect, loadCdm } from '../fixtures.js';
import { openReferenceModels } from '../../helpers/workspace-launcher.js';
import { projectBackingFiles } from '../../helpers/project-backing.js';

test('J03 loads the live Nightly closure and cancels a recheck without changing saved selections', async ({
  page,
  evidence
}) => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'requires a deployed Studio');
  await loadCdm(page, evidence);
  const files = await projectBackingFiles(page);
  expect(files['build-config.yml']).toMatch(/release:\s*nightly/);
  expect(files['build-config.lock.json']).toBeUndefined();
  const picker = await openReferenceModels(page);
  for (const name of [/CDM \(Common/, /FpML/, /Rune DSL/])
    await expect(picker.getByRole('button', { name })).toContainText('Nightly');
  await expect(picker.getByRole('button', { name: 'Review change', exact: true })).toBeDisabled();
  await evidence.checkpoint('nightly-closure-ready');
  await picker.getByRole('button', { name: 'Recheck references', exact: true }).click();
  await expect(picker.getByRole('heading', { name: 'Review reference change' })).toBeVisible({ timeout: 90000 });
  await evidence.checkpoint('reference-recheck');
  await picker.getByRole('button', { name: 'Cancel review', exact: true }).click();
  expect((await projectBackingFiles(page))['build-config.yml']).toBe(files['build-config.yml']);
  expect((await projectBackingFiles(page))['build-config.lock.json']).toBeUndefined();
  await evidence.checkpoint('reference-recheck-cancelled');
});
