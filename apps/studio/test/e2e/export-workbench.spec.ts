// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import JSZip from 'jszip';
import { expect, test } from '@playwright/test';
import { typeSelectionCheckbox } from '../helpers/type-navigation.js';
import { createRuneDslServices, BASICTYPES_ROSETTA } from '@rune-langium/core';
import { generate } from '@rune-langium/codegen/export';
import { URI } from 'langium';
import { readFileSync } from 'node:fs';

const source = `namespace demo
type Address:
  city string (1..1)
type Party:
  address Address (1..1)`;

async function artifact(): Promise<Buffer> {
  const zip = new JSZip();
  const content = 'export interface Party { address: Address }\n';
  zip.file('demo.ts', content);
  zip.file(
    '.rune/export.json',
    JSON.stringify({
      version: 1,
      target: 'typescript',
      resolvedSelection: {
        explicit: [{ namespace: 'demo', name: 'Party', kind: 'Data' }],
        included: [
          { namespace: 'demo', name: 'Party', kind: 'Data' },
          { namespace: 'demo', name: 'Address', kind: 'Data' }
        ],
        requiredBy: { '["demo","Data","Address"]': ['["demo","Data","Party"]'] }
      },
      files: [{ path: 'demo.ts', kind: 'text', bytes: new TextEncoder().encode(content).byteLength }],
      diagnostics: []
    })
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('selects and previews a captured declaration export', async ({ page }) => {
  await page.route('**/api/codegen', async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      artifactEnvelope: 1,
      selection: { declarations: [{ namespace: 'demo', name: 'Party', kind: 'Data' }] }
    });
    await route.fulfill({ status: 200, contentType: 'application/zip', body: await artifact() });
  });
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'demo.rosetta',
    buffer: Buffer.from(source),
    mimeType: 'text/plain'
  });
  await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('rail-export').click();
  await expect(page.getByTestId('export-perspective')).toBeVisible();
  await typeSelectionCheckbox(page.getByTestId('export-perspective'), 'demo.Party').click();
  await page.getByRole('button', { name: 'Generate 1 selected' }).click();
  await expect(page.getByTestId('export-artifact-preview')).toBeVisible();
  await expect(page.getByLabel('Generated export code')).toContainText('export interface Party');
  await expect(page.getByTestId('export-selection-summary')).toContainText('2 declarations included');
});

test('keeps export selection and settings reachable at a constrained width', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'demo.rosetta',
    buffer: Buffer.from(source),
    mimeType: 'text/plain'
  });
  await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('rail-export').click();

  const perspective = page.getByTestId('export-perspective');
  const panes = perspective.getByRole('tablist');
  const selection = perspective.getByTestId('export-selection').first();
  const settings = perspective.getByTestId('export-settings').first();
  await expect(panes).toBeVisible();
  await expect(selection).toBeVisible();
  await expect(settings).not.toBeVisible();

  await panes.getByRole('tab', { name: 'Settings' }).click();
  await expect(settings).toBeVisible();
  await expect(selection).not.toBeVisible();
  await panes.getByRole('tab', { name: 'Selection' }).click();
  await expect(selection).toBeVisible();
});

test('opens the real single-file model before helpers and downloads both', async ({ page }, testInfo) => {
  const { RuneDsl } = createRuneDslServices();
  const docs = [BASICTYPES_ROSETTA, source].map((content, index) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse(`file:///export-${index}.rosetta`))
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
  const outputs = await generate(docs, {
    target: 'typescript',
    typescript: { layout: 'single-file' },
    selection: { declarations: [{ namespace: 'demo', name: 'Party', kind: 'Data' }], namespaces: [] }
  });
  const zip = new JSZip();
  for (const output of outputs) zip.file(output.relativePath, output.content);
  zip.file(
    '.rune/export.json',
    JSON.stringify({
      version: 1,
      target: 'typescript',
      files: outputs.map((output) => ({
        path: output.relativePath,
        kind: 'text',
        bytes: Buffer.byteLength(output.content)
      })),
      diagnostics: outputs.flatMap((output) => output.diagnostics)
    })
  );
  const body = await zip.generateAsync({ type: 'nodebuffer' });
  await page.route('**/api/codegen', async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      target: 'typescript',
      options: { typescript: { layout: 'single-file' } }
    });
    await route.fulfill({ status: 200, contentType: 'application/zip', body });
  });
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'demo.rosetta',
    buffer: Buffer.from(source),
    mimeType: 'text/plain'
  });
  await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('rail-export').click();
  const settings = page.getByTestId('export-settings');
  await settings.getByLabel('Export target', { exact: true }).selectOption('typescript');
  await settings.getByLabel('Export layout', { exact: true }).selectOption('single-file');
  await typeSelectionCheckbox(page.getByTestId('export-perspective'), 'demo.Party').click();
  await page.getByRole('button', { name: 'Generate 1 selected' }).click();
  const picker = page.getByRole('combobox', { name: 'Generated export file' });
  await expect(picker).toHaveValue('model.ts');
  const preview = page.getByLabel('Generated export code');
  await expect(preview).toContainText("from './helpers.js'");
  await expect(preview).toContainText('export class Party');
  await expect(preview).not.toContainText('const rune =');
  await testInfo.attach('single-file-model', { body: await page.screenshot(), contentType: 'image/png' });
  await picker.selectOption('helpers.ts');
  await expect(preview).toContainText('export const rune =');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download export' }).click();
  const archive = await JSZip.loadAsync(readFileSync((await (await downloaded).path())!));
  for (const output of outputs) expect(await archive.file(output.relativePath)!.async('string')).toBe(output.content);
});
