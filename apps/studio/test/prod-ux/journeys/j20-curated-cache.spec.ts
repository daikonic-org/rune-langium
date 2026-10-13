// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { fullSourceEditor } from '../../helpers/source-editor.js';
import { checkout as test, expect, loadCdm, captureOpLogSnapshot } from '../fixtures.js';
import { captureNetworkResponse } from '../network-evidence.js';
import { typeNavigationButton } from '../../helpers/type-navigation.js';

test('J20 cached curated JSON and lazy source are reused after reload', async ({ page, evidence }) => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'requires a deployed Studio');
  let sourceRequests = 0;
  let warm = false;
  const warmDocumentCounts: Array<number | undefined> = [];
  const reads: Promise<void>[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/curated-source') sourceRequests++;
  });
  page.on('response', (response) => {
    if (!warm || new URL(response.url()).pathname !== '/api/parse') return;
    if (!response.request().postDataJSON().hydrateNamespaces?.includes('cdm.base.math')) return;
    reads.push(
      captureNetworkResponse(response).then((record) => {
        warmDocumentCounts.push(record.curatedDocumentCount);
      })
    );
  });
  await loadCdm(page, evidence);
  async function openSource() {
    await page.getByTestId('rail-explore').click();
    await page.getByTestId('namespace-search').fill('Abs');
    await typeNavigationButton(page, 'cdm.base.math.Abs', 'RosettaFunction').click();
    const toggle = page.getByRole('button', { name: 'Source', exact: true });
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
    await expect(fullSourceEditor(page).locator('.cm-content')).toContainText('func Abs:');
    const declaration = fullSourceEditor(page).locator('.cm-source-reveal-line').filter({ hasText: 'func Abs:' });
    await expect(declaration).toBeVisible();
    await expect(declaration).toBeInViewport();
  }
  await evidence.measure('curatedSourceOpen', 'cold Abs', openSource);
  await evidence.checkpoint('cold-original-source');
  const coldSourceRequests = sourceRequests;
  expect(coldSourceRequests).toBeGreaterThan(0);
  await captureOpLogSnapshot(page, evidence);
  warm = true;
  await page.reload();
  evidence.markNavigation();
  await evidence.measure('curatedSourceOpen', 'warm Abs', openSource);
  await Promise.all(reads);
  expect(sourceRequests).toBe(coldSourceRequests);
  expect(warmDocumentCounts.length).toBeGreaterThan(0);
  expect(warmDocumentCounts.every((count) => count === 0)).toBe(true);
  await evidence.checkpoint('warm-original-source-no-refetch');
});
