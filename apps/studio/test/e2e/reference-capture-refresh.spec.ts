// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect } from '@playwright/test';
import { CURATED_MIRROR_BASE } from '@rune-langium/curated-schema';
import { resolveProjectReferences } from '@rune-langium/project-runtime/references';
import { createReferenceArtifacts, repository } from '../../../../test/helpers/project-reference-artifacts.js';
import { projectBackingFiles, seedProjectBackingFiles } from '../helpers/project-backing.js';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

test('local inheritance is ready before browsing references and a selected reference refreshes across releases', async ({
  page,
  context
}, info) => {
  test.setTimeout(90000);
  const fixtures = [];
  for (const version of ['1.0', '2.0']) {
    const prefix = version === '1.0' ? 'prior' : 'fresh';
    fixtures.push(
      await createReferenceArtifacts(
        { cdm: { repository: repository('cdm'), release: version } },
        [
          ['rune-dsl', version, {}],
          ['cdm', version, { 'rune-dsl': { modelId: 'rune-dsl', release: version } }]
        ],
        {
          cdm: 'namespace pinned\ntype Parent:\n amount string (1..1)',
          'rune-dsl': `namespace pinned.base\ntype Support:\n ${prefix}A string (0..1)\n ${prefix}B string (0..1)\n ${prefix}C string (0..1)`
        },
        CURATED_MIRROR_BASE
      )
    );
  }
  const artifacts = new Map(fixtures.flatMap((fixture) => [...fixture.artifacts]));
  await context.route('**/releases/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    return route.fulfill({
      json: { schemaVersion: 1, releases: fixtures.flatMap((fixture) => fixture.releases.get(id) ?? []) }
    });
  });
  await context.route('**/curated/*/artifacts/**', (route) => {
    const bytes = artifacts.get(route.request().url());
    return route.fulfill({
      status: bytes ? 200 : 404,
      body: bytes ? Buffer.from(bytes) : 'Unavailable',
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('./');
  await page
    .locator('input[type=file][accept=".rosetta"]')
    .setInputFiles({ name: 'seed.rosetta', mimeType: 'text/plain', buffer: Buffer.from('namespace seed') });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  const previous = fixtures[0]!;
  const { lock, diagnostics } = await resolveProjectReferences(
    previous.snapshot,
    previous.transport,
    new AbortController().signal
  );
  expect(diagnostics).toEqual([]);
  await seedProjectBackingFiles(page, {
    'rune-config.yml': 'model: {name: Inherited reference}',
    'build-config.yml': JSON.stringify({ ...previous.snapshot.project.build, sources: ['child.rosetta'] }),
    'build-config.lock.json': JSON.stringify(lock),
    'child.rosetta': 'namespace custom\nimport pinned.*\ntype Child extends Parent:\n own int (0..1)'
  });
  await page.getByTestId('rail-explore').click();
  await page.getByTestId('namespace-search').fill('Child');
  await typeNavigationButton(page, 'custom.Child', 'Data').click();
  const inspectorToggle = page.getByRole('button', { name: 'Inspector', exact: true });
  if ((await inspectorToggle.getAttribute('aria-pressed')) !== 'true') await inspectorToggle.click();
  const inspector = page.locator('[data-pane="inspector"]');
  await expect(inspector.locator('[data-slot="inherited-attribute-row"][data-name="amount"]')).toBeVisible();
  await dismissLocalTransportNotices(page);
  await page.screenshot({ path: info.outputPath('local-inheritance.png') });
  await page.getByTestId('namespace-search').fill('Support');
  await typeNavigationButton(page, 'pinned.base.Support', 'Data').click();
  await expect(inspector.getByLabel('Attribute name: priorA', { exact: true })).toBeVisible();
  await page.getByTestId('rail-workspaces').click();
  await page.getByRole('button', { name: 'Reference models', exact: true }).click();
  const picker = page.getByTestId('reference-model-picker');
  await picker.getByRole('button', { name: /CDM \(Common/ }).click();
  await picker.getByRole('combobox', { name: 'Release', exact: true }).click();
  await page.getByRole('option', { name: '2.0', exact: true }).click();
  await picker.getByRole('button', { name: 'Update reference', exact: true }).click();
  await picker.getByRole('button', { name: 'Save reference change', exact: true }).click();
  await expect
    .poll(
      async () =>
        JSON.parse((await projectBackingFiles(page))['build-config.lock.json'] ?? '{}').references?.cdm?.release
    )
    .toBe('2.0');
  await page.getByTestId('rail-explore').click();
  // Keep the same selected ID: the new placeholder must trigger hydration itself.
  await expect(inspector.getByLabel('Attribute name: freshA', { exact: true })).toBeVisible();
  await expect(inspector.getByLabel('Attribute name: priorA', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
  await dismissLocalTransportNotices(page);
  await page.screenshot({ path: info.outputPath('updated-selected-reference.png') });
});
