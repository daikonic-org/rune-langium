// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { CURATED_MIRROR_BASE } from '@rune-langium/curated-schema';
import { createReferenceArtifacts } from '../../../../test/helpers/project-reference-artifacts.js';
import { projectBackingFiles } from '../helpers/project-backing.js';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
for (const width of [1440, 390])
  test(`pinned release review, cache reopen and Explorer ownership at ${width}px`, async ({ page, context }, info) => {
    test.setTimeout(90000);
    const fixture = await createReferenceArtifacts(
      {},
      undefined,
      {
        cdm: 'namespace pinned\ntype Payment:\n amount number (1..1)\n',
        'rune-dsl': 'namespace pinned.base\ntype Support:\n value string (0..1)\n'
      },
      CURATED_MIRROR_BASE
    );
    let offline = false,
      artifactReads = 0,
      catalogReads = 0;
    await context.route('**/releases/*', async (route) => {
      catalogReads++;
      const id = new URL(route.request().url()).pathname.split('/').pop()!;
      await route.fulfill({
        status: offline ? 503 : 200,
        json: { schemaVersion: 1, releases: fixture.releases.get(id) ?? [] }
      });
    });
    await context.route('**/curated/*/artifacts/**', async (route) => {
      artifactReads++;
      const bytes = fixture.artifacts.get(route.request().url());
      await route.fulfill({
        status: offline ? 503 : bytes ? 200 : 404,
        body: bytes ? Buffer.from(bytes) : 'Unavailable',
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    await page.goto('./');
    await page.getByRole('button', { name: 'New workspace', exact: true }).click();
    await page.getByTestId('rail-workspaces').click();
    await page.getByRole('button', { name: 'Reference models', exact: true }).click();
    const picker = page.getByTestId('reference-model-picker');
    await picker.getByRole('button', { name: /CDM \(Common/ }).click();
    if (width === 390) {
      await picker.getByRole('button', { name: 'Back to reference models' }).click();
      await expect(picker.getByRole('button', { name: /CDM \(Common/ })).toBeFocused();
      await picker.getByRole('button', { name: /CDM \(Common/ }).click();
    }
    await picker.getByRole('combobox', { name: 'Release', exact: true }).click();
    await page.getByRole('option', { name: '1.0', exact: true }).click();
    await picker.getByRole('button', { name: /^(Add|Update) reference$/ }).click();
    await expect(picker.getByText('Required by cdm', { exact: false })).toBeVisible();
    expect((await projectBackingFiles(page))['build-config.lock.json']).toBeUndefined();
    await picker.getByRole('button', { name: 'Cancel review' }).click();
    await picker.getByRole('button', { name: /^(Add|Update) reference$/ }).click();
    await picker.getByRole('button', { name: 'Save reference change' }).click();
    await expect
      .poll(
        async () =>
          JSON.parse((await projectBackingFiles(page))['build-config.lock.json'] ?? '{}').references?.cdm?.release
      )
      .toBe('1.0');
    await expect(picker.getByRole('button', { name: /^(Add|Update) reference$/ })).toBeDisabled();
    expect(await picker.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="reference-model-picker"]').analyze()).violations
    ).toEqual([]);
    await dismissLocalTransportNotices(page);
    await page.screenshot({ path: info.outputPath('reference-picker.png') });
    await page.getByTestId('rail-explore').click();
    await page.getByTestId('namespace-search').fill('Payment');
    await typeNavigationButton(page, 'pinned.Payment', 'Data').click();
    const structure = page.getByRole('button', { name: 'Structure', exact: true });
    if ((await structure.getAttribute('aria-pressed')) !== 'true') await structure.click();
    await expect(page.locator('.rune-structure-document')).toContainText('amount');
    const reads = artifactReads,
      catalogs = catalogReads;
    offline = true;
    await page.reload();
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await page.getByTestId('namespace-search').fill('Payment');
    await typeNavigationButton(page, 'pinned.Payment', 'Data').click();
    expect(artifactReads).toBe(reads);
    expect(catalogReads).toBe(catalogs);
    if (width === 390) {
      offline = false;
      await page.getByTestId('rail-workspaces').click();
      await page.getByRole('button', { name: 'Reference models', exact: true }).click();
      await picker.getByRole('button', { name: 'Recheck references' }).click();
      await expect(picker.getByRole('heading', { name: 'Review reference change' })).toBeVisible();
      await picker.getByRole('button', { name: 'Cancel review' }).click();
    }
    if (width === 1440) {
      offline = false;
      await page.getByTestId('rail-workspaces').click();
      await page.getByTestId('workspaces-perspective').getByRole('button', { name: 'Workspaces', exact: true }).click();
      await page.getByRole('button', { name: 'New workspace', exact: true }).click();
      await page.getByTestId('rail-workspaces').click();
      await page.getByRole('button', { name: 'Reference models', exact: true }).click();
      await picker.getByRole('button', { name: /CDM \(Common/ }).click();
      await picker.getByRole('combobox', { name: 'Release' }).click();
      await page.getByRole('option', { name: '2.0', exact: true }).click();
      await picker.getByRole('button', { name: /^(Add|Update) reference$/ }).click();
      await picker.getByRole('button', { name: 'Save reference change' }).click();
      await expect(picker.getByRole('button', { name: /CDM \(Common/ })).toContainText('2.0');
      await page.getByTestId('workspaces-perspective').getByRole('button', { name: 'Workspaces', exact: true }).click();
      await page.getByTestId('workspace-row').last().getByRole('button', { name: /Open / }).click();
      await page.getByTestId('rail-workspaces').click();
      await page.getByRole('button', { name: 'Reference models', exact: true }).click();
      await expect(picker.getByRole('button', { name: /CDM \(Common/ })).toContainText('1.0');
      await page.getByTestId('workspaces-perspective').getByRole('button', { name: 'Workspaces', exact: true }).click();
      await page.getByTestId('workspace-row').last().getByRole('button', { name: /Open / }).click();
      await page.getByTestId('rail-workspaces').click();
      await page.getByRole('button', { name: 'Reference models', exact: true }).click();
      await expect(picker.getByRole('button', { name: /CDM \(Common/ })).toContainText('2.0');
    }
  });

test('Nightly stays moving without a lock and can be replaced by a tagged workspace reference', async ({
  page,
  context
}, info) => {
  const fixture = await createReferenceArtifacts(
    {},
    [
      ['rune-dsl', '1.0', {}],
      ['fpml', '1.0', { 'rune-dsl': { modelId: 'rune-dsl', release: '1.0' } }],
      ['cdm', '1.0', { fpml: { modelId: 'fpml', release: '1.0' } }]
    ],
    {
      cdm: 'namespace moving\ntype Payment:\n amount number (1..1)\n',
      fpml: 'namespace moving.fpml\ntype Support:\n value string (0..1)\n',
      'rune-dsl': 'namespace moving.base\ntype Support:\n value string (0..1)\n'
    },
    CURATED_MIRROR_BASE
  );
  const updated = await createReferenceArtifacts(
    {},
    [
      ['rune-dsl', '2.0', {}],
      ['fpml', '2.0', { 'rune-dsl': { modelId: 'rune-dsl', release: '2.0' } }],
      ['cdm', '2.0', { fpml: { modelId: 'fpml', release: '2.0' } }]
    ],
    {
      cdm: 'namespace moving\ntype Payment:\n amount string (1..1)\n updated string (0..1)\n',
      fpml: 'namespace moving.fpml\ntype Support:\n value string (0..1)\n',
      'rune-dsl': 'namespace moving.base\ntype Support:\n value string (0..1)\n'
    },
    CURATED_MIRROR_BASE
  );
  let published = fixture;
  let currentReads = 0;
  await context.route('**/releases/*', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    await route.fulfill({ json: { schemaVersion: 1, releases: fixture.releases.get(id) ?? [] } });
  });
  await context.route('**/curated/*/artifacts/**', async (route) => {
    const bytes = published.artifacts.get(route.request().url()) ?? fixture.artifacts.get(route.request().url());
    await route.fulfill({
      status: bytes ? 200 : 404,
      body: bytes ? Buffer.from(bytes) : 'Unavailable',
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  });
  await context.route('**/curated/*/manifest.json', async (route) => {
    currentReads++;
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    const release = published.releases.get(id)![0]!;
    await route.fulfill({
      json: JSON.parse(new TextDecoder().decode(published.artifacts.get(release.manifest)!)),
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'New workspace', exact: true }).click();
  await page.getByTestId('rail-workspaces').click();
  await page.getByRole('button', { name: 'Reference models', exact: true }).click();
  const picker = page.getByTestId('reference-model-picker');
  await expect(page.getByText('Legacy model loading', { exact: true })).toHaveCount(0);
  await picker.getByRole('button', { name: /CDM \(Common/ }).click();
  await picker.getByRole('combobox', { name: 'Release' }).click();
  await expect(page.getByRole('option', { name: '1.0', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'Nightly', exact: true }).click();
  await picker.getByRole('button', { name: /^(Add|Update) reference$/ }).click();
  await expect(picker.getByRole('list', { name: 'Proposed reference releases' })).toContainText('fpml Nightly');
  await expect(picker.getByRole('list', { name: 'Proposed reference releases' })).toContainText('rune-dsl Nightly');
  await picker.getByRole('button', { name: 'Save reference change' }).click();
  await expect(picker.getByRole('button', { name: /CDM \(Common/ })).toContainText('Nightly');
  await expect(picker.getByRole('button', { name: /FpML/ })).toContainText('Nightly');
  await expect(picker.getByRole('combobox', { name: 'Release' })).toHaveText('Nightly');
  await expect(picker.getByRole('button', { name: /^(Add|Update) reference$/, exact: true })).toBeDisabled();
  await expect
    .poll(async () => (await projectBackingFiles(page))['build-config.yml'] ?? '')
    .toMatch(/release:\s*nightly/);
  expect((await projectBackingFiles(page))['build-config.lock.json']).toBeUndefined();
  expect(
    (await new AxeBuilder({ page }).include('[data-testid="reference-model-picker"]').analyze()).violations
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath('nightly-reference.png') });
  const beforeReload = currentReads;
  await page.reload();
  await page.getByTestId('rail-explore').click();
  await page.getByTestId('namespace-search').fill('Payment');
  await typeNavigationButton(page, 'moving.Payment', 'Data').click();
  await expect.poll(() => currentReads).toBeGreaterThan(beforeReload);
  expect((await projectBackingFiles(page))['build-config.lock.json']).toBeUndefined();
  const structure = page.getByRole('button', { name: 'Structure', exact: true });
  if ((await structure.getAttribute('aria-pressed')) !== 'true') await structure.click();
  await expect(page.locator('.rune-structure-document')).toContainText('amount');
  await expect(page.locator('.rune-structure-document')).not.toContainText('updated');
  const originalConfig = (await projectBackingFiles(page))['build-config.yml'];
  await projectBackingFiles(page, {
    'examples/payment.example.json': JSON.stringify({
      schemaVersion: 1,
      id: 'payment',
      name: 'Payment',
      type: { model: 'cdm', namespace: 'moving', kind: 'Data', name: 'Payment' },
      payload: 'examples/payment.json',
      codec: 'JSON'
    }),
    'examples/payment.json': '{"amount":10}'
  });
  published = updated;
  await page.getByTestId('rail-workspaces').click();
  await page.getByRole('button', { name: 'Reference models', exact: true }).click();
  await picker.getByRole('button', { name: 'Recheck references' }).click();
  await expect(picker.getByRole('alert').filter({ hasText: 'REFERENCE_SCHEMA_CHANGED' })).toContainText(
    'examples/payment.example.json'
  );
  await picker.getByRole('button', { name: 'Save reference change' }).click();
  await expect(picker.getByRole('heading', { name: 'Review reference change' })).toHaveCount(0);
  await page.getByTestId('rail-explore').click();
  await typeNavigationButton(page, 'moving.Payment', 'Data').click();
  await expect(page.locator('.rune-structure-document')).toContainText('updated');
  const refreshedFiles = await projectBackingFiles(page);
  expect(refreshedFiles['build-config.yml']).toBe(originalConfig);
  expect(refreshedFiles['build-config.lock.json']).toBeUndefined();
  await page.getByTestId('rail-workspaces').click();
  await page.getByRole('button', { name: 'Reference models', exact: true }).click();
  await picker.getByRole('button', { name: /CDM \(Common/ }).click();
  await picker.getByRole('combobox', { name: 'Release' }).click();
  await page.getByRole('option', { name: '1.0', exact: true }).click();
  await picker.getByRole('button', { name: /^(Add|Update) reference$/ }).click();
  await picker.getByRole('button', { name: 'Save reference change' }).click();
  await expect
    .poll(
      async () =>
        JSON.parse((await projectBackingFiles(page))['build-config.lock.json'] ?? '{}').references?.cdm?.release
    )
    .toBe('1.0');
});
