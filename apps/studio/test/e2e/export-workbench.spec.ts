// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import JSZip from 'jszip';
import { expect } from '@playwright/test';
import { test } from '../helpers/studio-test.js';
import { codeMirrorDocument } from '../helpers/source-editor.js';
import { typeSelectionCheckbox, typeNavigationButton } from '../helpers/type-navigation.js';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { handleCodegenDownload } from '../../src/services/codegen-download-handler.js';

const source = `namespace demo
type Address:
  city string (1..1)
type Party:
  address Address (1..1)`;
const longPath = 'generated/example/with-a-long-namespace-and-file-name/party-model-with-dependencies.ts';

async function artifact(): Promise<Buffer> {
  const zip = new JSZip();
  const content = 'export interface Party { address: Address }\n';
  zip.file('demo.ts', content);
  zip.file('notes.txt', 'Additional output');
  const schema = '{"type":"object"}';
  zip.file('model.schema.json', schema);
  zip.file('dependency.ts', 'export {};');
  zip.file(longPath, 'Long file output');
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
      files: [
        { path: 'dependency.ts', kind: 'text', namespaces: ['base'], bytes: 10 },
        { path: 'demo.ts', kind: 'text', namespaces: ['demo'], bytes: new TextEncoder().encode(content).byteLength },
        { path: 'notes.txt', kind: 'text', namespaces: [], bytes: 17 },
        { path: 'model.schema.json', kind: 'text', namespaces: [], bytes: schema.length },
        { path: longPath, kind: 'text', namespaces: ['demo'], bytes: 16 }
      ],
      diagnostics: Array.from({ length: 25 }, (_, index) => ({
        severity: 'warning',
        code: 'example-warning',
        message: `Example warning ${index}`
      }))
    })
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

for (const theme of ['daikonic', 'light'])
  test(`selects, navigates and expands a captured export while diagnostics stay behind a disclosure (${theme})`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width: 1969, height: 1270 });
    await page.addInitScript((theme) => localStorage.setItem('rune-studio:theme', theme), theme);
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
    await expect(page.getByTestId('export-selection').getByText(/^Select declarations or namespaces\./)).toHaveCSS(
      'margin-top',
      '4px'
    );
    await typeSelectionCheckbox(page.getByTestId('export-perspective'), 'demo.Party').click();
    await page.getByRole('button', { name: 'Generate target' }).click();
    await expect(page.getByTestId('export-artifact-preview')).toBeVisible();
    const code = page.getByRole('textbox', { name: 'Generated export code' });
    await expect(code).toContainText('export interface Party');
    await expect(code.locator('span').filter({ hasText: /^export$/ })).toBeVisible();
    await expect(code).toHaveAttribute('aria-readonly', 'true');
    await expect(code).toHaveCSS('font-size', '13px');
    await expect(page.locator('body')).toHaveCSS('font-size', '13px');
    const italicLoaded = await code.evaluate(async () => {
      const faces = await document.fonts.load('italic 350 13px "Daikonic Transit Code"');
      return faces.some((face) => face.style === 'italic' && face.status === 'loaded');
    });
    expect(italicLoaded).toBe(true);
    const selection = await page.getByRole('tabpanel', { name: 'Selection' }).boundingBox();
    const settings = await page.getByRole('region', { name: 'Export settings', exact: true }).boundingBox();
    const output = await page.getByRole('region', { name: 'Generated output', exact: true }).boundingBox();
    expect(selection!.width).toBeLessThan(300);
    expect(settings!.x).toBeGreaterThan(selection!.x);
    expect(output!.x).toBe(settings!.x);
    expect(output!.width).toBe(settings!.width);
    expect(output!.y).toBeGreaterThan(settings!.y);
    expect(output!.height).toBeGreaterThan(settings!.height);
    await expect(page.getByTestId('export-selection-summary')).toContainText('2 declarations included');
    const diagnostics = page.getByRole('button', { name: 'Show generation diagnostics (25)' });
    await expect(page.getByText('Example warning 0', { exact: true })).not.toBeVisible();
    await diagnostics.click();
    await expect(page.getByRole('dialog', { name: 'Generation diagnostics' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(diagnostics).toBeFocused();
    await page.getByRole('combobox', { name: 'Generated export file' }).selectOption('notes.txt');
    await expect(code).toContainText('Additional output');
    await expect(code.locator('.cm-line span')).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Generated export file' }).selectOption('model.schema.json');
    await expect(code.locator('span').filter({ hasText: /^"type"$/ })).toBeVisible();
    await page.getByRole('combobox', { name: 'Generated export file' }).selectOption(longPath);
    await expect(page.getByLabel('Generated export code')).toContainText('Long file output');
    await testInfo.attach('long-export-file-picker', { body: await page.screenshot(), contentType: 'image/png' });
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByLabel('Export target', { exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByLabel('Export layout', { exact: true })).toBeInViewport({ ratio: 1 });
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
    await page.getByRole('button', { name: 'Copy file', exact: true }).click();
    await expect(page.getByTestId('export-artifact-preview').getByRole('status')).toContainText(
      'Select and copy the text instead'
    );
    await expect(page.getByRole('button', { name: 'Copy file', exact: true })).toBeEnabled();
    await code.focus();
    await expect(code).toBeFocused();
    await page.keyboard.type('changed');
    await expect.poll(() => codeMirrorDocument(code)).toBe('Long file output');
    expect((await new AxeBuilder({ page }).include('[data-testid="export-perspective"]').analyze()).violations).toEqual(
      []
    );
    await testInfo.attach('clipboard-recovery-hd', { body: await page.screenshot(), contentType: 'image/png' });
    await typeNavigationButton(page.getByTestId('export-perspective'), 'demo.Party').click();
    await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Generated export file' })).toHaveValue('demo.ts');
    await expect(page.getByTestId('export-perspective')).toBeVisible();
    const before = await page.getByTestId('export-workspace').boundingBox();
    await page.getByRole('button', { name: 'Expand export panel' }).click();
    await expect(page.getByRole('button', { name: 'Restore export panel' })).toBeVisible();
    const after = await page.getByTestId('export-workspace').boundingBox();
    expect(after!.width).toBeGreaterThan(before!.width);
    await expect(page.getByLabel('Generated export code')).toBeVisible();
    await testInfo.attach('expanded-export-output', {
      body: await page.screenshot({ path: '/tmp/rune-export-expanded.png' }),
      contentType: 'image/png'
    });
    expect((await new AxeBuilder({ page }).include('[data-testid="export-perspective"]').analyze()).violations).toEqual(
      []
    );
    await page.getByRole('button', { name: 'Restore export panel' }).click();
  });

for (const width of [700, 390])
  test(`keeps export selection and settings reachable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./');
    await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
      name: 'demo.rosetta',
      buffer: Buffer.from(source),
      mimeType: 'text/plain'
    });
    await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('rail-export').click();

    const perspective = page.getByTestId('export-perspective');
    const panes = perspective
      .getByRole('tablist')
      .filter({ has: page.getByRole('tab', { name: 'Selection', exact: true }) });
    const selection = perspective.getByTestId('export-selection').first();
    const settings = perspective.getByTestId('export-settings').first();
    await expect(panes).toBeVisible();
    await expect(selection).toBeVisible();
    await expect(settings).not.toBeVisible();

    await panes.getByRole('tab', { name: 'Export', exact: true }).click();
    await expect(settings).toBeVisible();
    await expect(settings.getByRole('button', { name: 'Generate target', exact: true })).toBeVisible();
    await expect(selection).not.toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('compact-settings.png') });
    if (width === 700) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(selection).toBeVisible();
      await expect(settings).toBeVisible();
      await page.setViewportSize({ width, height: 800 });
      await expect(panes).toBeVisible();
      await expect(settings).toBeVisible();
      await expect(selection).not.toBeVisible();
    }
    await panes.getByRole('tab', { name: 'Selection' }).click();
    await expect(selection).toBeVisible();
  });

test('reveals generation failures and their diagnostics from Settings without a prior export', async ({ page }) => {
  await page.route('**/api/codegen', async (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        error: 'Selected expression cannot be generated.',
        diagnostics: [
          { severity: 'error', code: 'unsupported-expression', message: 'The selected expression is unsupported.' }
        ]
      })
    })
  );
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'demo.rosetta', buffer: Buffer.from(source), mimeType: 'text/plain' });
  await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('rail-export').click();
  await typeSelectionCheckbox(page.getByTestId('export-perspective'), 'demo.Party').click();
  await page.getByRole('button', { name: 'Generate target' }).click();
  await expect(page.getByRole('region', { name: 'Generated output', exact: true })).toBeVisible();
  await expect(page.getByTestId('export-artifact-status')).toContainText('Selected expression cannot be generated.');
  await page.getByRole('button', { name: 'Show generation diagnostics (1)' }).click();
  await expect(page.getByRole('dialog', { name: 'Generation diagnostics' })).toContainText(
    'The selected expression is unsupported.'
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Export settings', exact: true })).toBeVisible();
});

for (const target of ['typescript', 'python'] as const)
  test(`previews and downloads the generated ${target} module`, async ({ page }, testInfo) => {
    let servedArchive: JSZip | undefined;
    await page.route('**/api/codegen', async (route) => {
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({
        target,
        selection: { declarations: [{ namespace: 'demo', name: 'Party', kind: 'Data' }] },
        ...(target === 'typescript' ? { options: { typescript: { layout: 'single-file' } } } : {})
      });
      const request = new Request(route.request().url(), { method: 'POST', body: JSON.stringify(body) });
      const response = await handleCodegenDownload({ request });
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(response.ok, response.ok ? undefined : bytes.toString('utf8')).toBe(true);
      servedArchive = await JSZip.loadAsync(bytes);
      await route.fulfill({ status: response.status, contentType: 'application/zip', body: bytes });
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
    await settings.getByLabel('Export target', { exact: true }).selectOption(target);
    if (target === 'typescript') {
      await settings.getByLabel('Export layout', { exact: true }).selectOption('single-file');
    }
    await typeSelectionCheckbox(page.getByTestId('export-perspective'), 'demo.Party').click();
    await page.getByRole('button', { name: 'Generate target' }).click();
    const preview = page.getByLabel('Generated export code');
    if (target === 'python') {
      await expect(preview).toHaveAttribute('data-language', 'python');
      await expect(
        preview
          .locator('span')
          .filter({ hasText: /^from$/ })
          .first()
      ).toBeVisible();
      expect(await codeMirrorDocument(preview)).toContain('Party = TypedDict("Party"');
    } else {
      const picker = page.getByRole('combobox', { name: 'Generated export file' });
      await expect(picker).toHaveValue('model.ts');
      const model = await codeMirrorDocument(preview);
      expect(model).toContain("from './helpers.js'");
      expect(model).toContain('export namespace Party');
      expect(model).toContain('export interface Shape');
      expect(model).toContain('export class Party ');
      expect(model).not.toContain('const rune =');
      await picker.selectOption('helpers.ts');
      await expect.poll(() => codeMirrorDocument(preview)).toContain('export const rune =');
    }
    await testInfo.attach('single-file-model', { body: await page.screenshot(), contentType: 'image/png' });
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download export' }).click();
    const archive = await JSZip.loadAsync(readFileSync((await (await downloaded).path())!));
    for (const path of target === 'python' ? ['model.py'] : ['model.ts', 'helpers.ts']) {
      expect(await archive.file(path)!.async('string')).toBe(await servedArchive!.file(path)!.async('string'));
    }
  });
