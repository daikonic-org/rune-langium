// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { CURATED_MIRROR_BASE, CURATED_MODEL_REPOSITORIES } from '@rune-langium/curated-schema';
import { parseBuildConfig } from '@rune-langium/project-config';
import { resolveProjectReferences } from '@rune-langium/project-runtime/references';
import { createReferenceArtifacts, repository } from '../../../../test/helpers/project-reference-artifacts.js';
import { projectBackingFiles } from '../helpers/project-backing.js';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const source = `namespace example.functions
func Compute:
 inputs: amount number (1..1)
 output: result number (1..1)
 set result: amount + 1
func Caller:
 inputs: amount number (1..1)
 output: result number (1..1)
 set result: Compute(amount)
`;

for (const release of ['nightly', '1.0'])
  test(`Modify creates and reopens an executable local replacement from ${release}`, async ({
    page,
    context
  }, info) => {
    const fixture = await createReferenceArtifacts(
      { cdm: { repository: release === 'nightly' ? CURATED_MODEL_REPOSITORIES.cdm : repository('cdm'), release } },
      [['cdm', '1.0', {}]],
      { cdm: source },
      CURATED_MIRROR_BASE
    );
    const selected = fixture.releases.get('cdm')![0]!;
    const manifest = JSON.parse(new TextDecoder().decode(fixture.artifacts.get(selected.manifest)!));
    await context.route('**/curated/*/artifacts/**', async (route) => {
      const bytes = fixture.artifacts.get(route.request().url());
      await route.fulfill({
        status: bytes ? 200 : 404,
        body: bytes ? Buffer.from(bytes) : 'Unavailable',
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    });
    await context.route('**/curated/cdm/manifest.json', (route) =>
      route.fulfill({ json: manifest, headers: { 'Access-Control-Allow-Origin': '*' } })
    );
    await page.setViewportSize({ width: 1461, height: 988 });
    await page.goto('./');
    await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
      name: 'seed.rosetta',
      mimeType: 'text/plain',
      buffer: Buffer.from('namespace scratch\ntype Seed:\n value string (0..1)\n')
    });
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    const files: Record<string, string> = {
      'rune-config.yml': 'model: {name: Modify reference}',
      'build-config.yml': JSON.stringify({
        schemaVersion: 1,
        sources: ['**/*.rosetta'],
        references: fixture.snapshot.project.build.references
      })
    };
    if (release !== 'nightly') {
      const result = await resolveProjectReferences(fixture.snapshot, fixture.transport, new AbortController().signal);
      expect(result.diagnostics).toEqual([]);
      files['build-config.lock.json'] = JSON.stringify(result.lock);
    }
    await projectBackingFiles(page, files);
    await page.reload();
    await page.getByTestId('rail-explore').click();
    await page.getByTestId('namespace-search').fill('Compute');
    await typeNavigationButton(page, 'example.functions.Compute', 'RosettaFunction').click();
    const inspector = page.getByRole('button', { name: 'Inspector', exact: true });
    if ((await inspector.getAttribute('aria-pressed')) !== 'true') await inspector.click();
    const title = page.locator('[data-pane="inspector"] [data-slot="type-header"]');
    await title.getByRole('button', { name: 'Modify local copy' }).click();
    const dialog = page.getByRole('dialog', { name: 'Modify Compute', exact: true });
    await dialog.getByLabel('Local namespace').fill('custom');
    await dialog.getByRole('button', { name: 'Create local copy', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(title.getByText('custom', { exact: true })).toBeVisible();
    const editor = page.getByTestId('implementation-editor').locator('.cm-content');
    await editor.click();
    await editor.press('ControlOrMeta+A');
    await page.keyboard.insertText('set result: amount + 2');
    await editor.press('Tab');
    await expect
      .poll(async () =>
        Object.values(await projectBackingFiles(page)).some((text) => text.includes('set result: amount + 2'))
      )
      .toBe(true);
    await page.reload();
    await page.getByTestId('rail-prototype').click();
    await page.getByRole('button', { name: /^Choose a function/ }).click();
    await page.getByRole('option', { name: /Caller.*example.functions/ }).click();
    const amount = page.getByRole('spinbutton', { name: 'Amount', exact: true });
    await amount.fill('10');
    await amount.press('Tab');
    await page.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByRole('region', { name: 'result output' })).toContainText('12');
    const saved = await projectBackingFiles(page);
    const build = parseBuildConfig({ path: 'build-config.yml', text: saved['build-config.yml']! }).value!;
    expect(build.references.cdm!.release).toBe(release);
    expect(build.overrides).toHaveLength(1);
    expect(build.overrides![0]).toMatchObject({
      provenance: { uri: 'cdm/model.rosetta', commit: manifest.upstreamCommit, cohort: manifest.cohort }
    });
    if (release === 'nightly') expect(saved['build-config.lock.json']).toBeUndefined();
    else expect(JSON.parse(saved['build-config.lock.json']!).references.cdm.release).toBe(release);
    await dismissLocalTransportNotices(page);
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze()).violations
    ).toEqual([]);
    await page.screenshot({ path: info.outputPath(`modified-${release}.png`) });
  });
