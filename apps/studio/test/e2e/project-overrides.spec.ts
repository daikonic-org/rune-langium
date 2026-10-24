// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect, type Page } from '@playwright/test';
import { openReferenceModels } from '../helpers/workspace-launcher.js';
import AxeBuilder from '@axe-core/playwright';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { parseBuildConfig } from '@rune-langium/project-config';
import { CURATED_MIRROR_BASE } from '@rune-langium/curated-schema';
import { resolveProjectReferences } from '@rune-langium/project-runtime/references';
import { createReferenceArtifacts, repository } from '../../../../test/helpers/project-reference-artifacts.js';
import { serveCuratedDeclarations } from '../helpers/curated-declaration-server.js';
import { typeNavigationButton, typeSelectionCheckbox } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
import { projectBackingFiles as projectFiles } from '../helpers/project-backing.js';

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
async function executeCaller(page: Page, expected: string) {
  await page.getByTestId('rail-prototype').click();
  await page.getByRole('button', { name: /^Choose a function/ }).click();
  await page.getByRole('option', { name: /Caller.*example.functions/ }).click();
  const amount = page.getByRole('spinbutton', { name: 'Amount', exact: true });
  await expect(amount).toBeVisible({ timeout: 20000 });
  await amount.fill('10');
  await amount.press('Tab');
  const execute = page.getByRole('button', { name: 'Execute', exact: true });
  await expect(execute).toBeEnabled({ timeout: 20000 });
  await execute.click();
  await expect(page.getByRole('region', { name: 'result output' })).toContainText(expected);
}

test('managed Modify persists one map and drives curated caller execution and real worker export', async ({
  page,
  context
}, info) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1461, height: 988 });
  await serveCuratedDeclarations(context, [['functions', source]]);
  const fixture = await createReferenceArtifacts(
    { cdm: { repository: repository('cdm'), release: '1.0' } },
    [['cdm', '1.0', {}]],
    { cdm: source },
    CURATED_MIRROR_BASE
  );
  const resolved = await resolveProjectReferences(fixture.snapshot, fixture.transport, new AbortController().signal);
  expect(resolved.diagnostics).toEqual([]);
  const lock = resolved.lock!;
  await context.route('**/curated/cdm/artifacts/**', async (route) => {
    const bytes = fixture.artifacts.get(route.request().url());
    await route.fulfill({
      status: bytes ? 200 : 404,
      body: bytes ? Buffer.from(bytes) : 'Unknown fixture artifact',
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  });
  let legacyExports = 0;
  await context.route('**/api/codegen', async (route) => {
    legacyExports++;
    await route.fulfill({ status: 500, body: 'Managed exports must use the captured project worker.' });
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'New workspace', exact: true }).click();
  await openReferenceModels(page);
  await page.getByTestId('model-loader').getByRole('button', { name: /CDM/ }).first().click();
  await page.getByTestId('rail-explore').click();
  await page.getByTestId('namespace-search').fill('Compute');
  await typeNavigationButton(page, 'example.functions.Compute', 'RosettaFunction').click();
  await projectFiles(page, {
    'rune-config.yml': 'model: {name: Demo}',
    'build-config.yml': JSON.stringify({
      schemaVersion: 1,
      sources: ['**/*.rosetta'],
      references: fixture.snapshot.project.build.references
    }),
    'build-config.lock.json': JSON.stringify(lock)
  });
  await page.reload();
  await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });
  await executeCaller(page, '11');
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
  await expect(dialog).not.toBeVisible({ timeout: 30000 });
  const editor = page.getByTestId('implementation-editor').locator('.cm-content');
  await expect(title.getByText('custom', { exact: true })).toBeVisible();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.click();
  await editor.press('ControlOrMeta+A');
  await page.keyboard.insertText('set result: amount + 2');
  await editor.press('Tab');
  await expect(page.locator('[data-pane=source] .cm-content')).toContainText('set result: amount + 2');
  await expect
    .poll(async () => Object.values(await projectFiles(page)).some((text) => text.includes('set result: amount + 2')))
    .toBe(true);
  await executeCaller(page, '12');
  const saved = await projectFiles(page);
  expect(
    parseBuildConfig({ path: 'build-config.yml', text: saved['build-config.yml']! }).value?.overrides
  ).toHaveLength(1);
  expect(Object.keys(saved).filter((path) => path.includes('custom') && path.endsWith('.rosetta'))).toHaveLength(1);
  await page.getByTestId('rail-explore').click();
  await page.getByTestId('namespace-search').fill('Compute');
  await typeNavigationButton(page, 'example.functions.Compute', 'RosettaFunction').click();
  await title.getByRole('button', { name: 'Modify local copy' }).click();
  await dialog.getByRole('button', { name: 'Create local copy', exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30000 });
  await expect(title.getByText('custom', { exact: true })).toBeVisible();
  expect(
    parseBuildConfig({ path: 'build-config.yml', text: (await projectFiles(page))['build-config.yml']! }).value
      ?.overrides
  ).toHaveLength(1);
  await page.getByTestId('rail-export').click();
  await typeSelectionCheckbox(
    page.getByTestId('export-perspective'),
    'example.functions.Caller',
    'RosettaFunction'
  ).click();
  await page.getByRole('button', { name: 'Generate 1 selected', exact: true }).click();
  await expect(page.getByTestId('export-artifact-preview')).toBeVisible({ timeout: 30000 });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download export', exact: true }).click();
  const download = await downloadEvent;
  const destination = info.outputPath('effective-project.zip');
  await download.saveAs(destination);
  const zip = await JSZip.loadAsync(await readFile(destination));
  const manifest = JSON.parse(await zip.file('.rune/export.json')!.async('string'));
  expect(manifest.projectReceipt.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(manifest.resolvedCohorts.cdm).toBe(lock.references.cdm!.cohort);
  expect(manifest.resolvedSelection.included).toContainEqual({
    namespace: 'custom',
    name: 'Compute',
    kind: 'RosettaFunction'
  });
  const code = (
    await Promise.all(
      manifest.files
        .filter((file: { kind: string }) => file.kind === 'text')
        .map((file: { path: string }) => zip.file(file.path)!.async('string'))
    )
  ).join('\n');
  expect(code).toMatch(/amount\s*\+\s*2/);
  expect(code).not.toMatch(/amount\s*\+\s*1/);
  expect(legacyExports).toBe(0);
  await page.reload();
  await executeCaller(page, '12');
  await dismissLocalTransportNotices(page);
  expect(
    (await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze()).violations
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath('managed-project-caller.png') });
});
