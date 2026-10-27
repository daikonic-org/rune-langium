// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { fullSourceEditor, codeMirrorDocument } from '../../helpers/source-editor.js';
import { loadCurrentCdm } from '../../helpers/workspace-launcher.js';
import { checkout as test, expect, captureOpLogSnapshot } from '../fixtures.js';
import { typeNavigationButton } from '../../helpers/type-navigation.js';

test('J20 pinned reference artifacts and original source are reused after reload', async ({ page, evidence }) => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'requires a deployed Studio');
  const artifactRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/curated\/[^/]+\/artifacts\//.test(new URL(request.url()).pathname)) artifactRequests.push(request.url());
  });
  await loadCurrentCdm(page, '7.8.0');
  async function source() {
    await page.getByTestId('rail-explore').click();
    await page.getByTestId('namespace-search').fill('Abs');
    await typeNavigationButton(page, 'cdm.base.math.Abs', 'RosettaFunction').click();
    const toggle = page.getByRole('button', { name: 'Source', exact: true });
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
    const editor = fullSourceEditor(page).locator('.cm-content');
    await expect(editor).toContainText('func Abs:');
    return codeMirrorDocument(editor);
  }
  const original = await evidence.measure('curatedSourceOpen', 'cold pinned Abs', source);
  expect(artifactRequests.length).toBeGreaterThan(0);
  const cold = [...artifactRequests];
  await evidence.checkpoint('cold-pinned-original-source');
  await captureOpLogSnapshot(page, evidence);
  await page.reload();
  evidence.markNavigation();
  expect(await evidence.measure('curatedSourceOpen', 'warm pinned Abs', source)).toBe(original);
  expect(artifactRequests).toEqual(cold);
  await evidence.checkpoint('warm-pinned-source-no-artifact-refetch');
});
