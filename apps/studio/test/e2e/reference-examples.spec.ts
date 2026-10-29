// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { CURATED_MIRROR_BASE } from '@rune-langium/curated-schema';
import { createReferenceArtifacts } from '../../../../test/helpers/project-reference-artifacts.js';
import { projectBackingFiles } from '../helpers/project-backing.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
const source = `namespace reference.example
version "1.0"
type Payment:
 amount number (1..1)
  [metadata scheme]
func Double:
 inputs: payment Payment (1..1)
 output: result Payment (1..1)
 set result: Payment { amount: payment -> amount * 2 }
`;
for (const width of [1440, 390])
  test(`reference library import, explicit binding and execution at ${width}px`, async ({ page, context }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const fixture = await createReferenceArtifacts({}, [['cdm', '1.0', {}]], { cdm: source }, CURATED_MIRROR_BASE);
    const release = fixture.releases.get('cdm')![0]!;
    const path = 'examples/payment.json',
      payload = JSON.stringify({
        '@model': 'cdm',
        '@type': 'reference.example.Payment',
        '@version': '1.0',
        amount: { '@data': 21, '@scheme': 'USD' }
      });
    const blob = createHash('sha1')
      .update(`blob ${Buffer.byteLength(payload)}\0`)
      .update(payload)
      .digest('hex');
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
    await context.route('https://api.github.com/repos/org/cdm/**', (route) => {
      const url = route.request().url();
      if (url.includes('/commits/'))
        return route.fulfill({ json: { sha: release.commit, commit: { tree: { sha: 'b'.repeat(40) } } } });
      if (url.includes('/git/trees/'))
        return route.fulfill({
          json: {
            truncated: false,
            tree: [{ path, sha: blob, mode: '100644', type: 'blob', size: Buffer.byteLength(payload) }]
          }
        });
      return route.fulfill({ body: payload, contentType: 'application/json' });
    });
    await page.setViewportSize({ width, height: 960 });
    await page.goto('./');
    await page.getByRole('button', { name: 'New workspace', exact: true }).click();
    await page.getByTestId('rail-workspaces').click();
    await page.getByRole('button', { name: 'Reference models', exact: true }).click();
    const picker = page.getByTestId('reference-model-picker');
    await picker.getByRole('button', { name: /CDM \(Common/ }).click();
    await picker.getByRole('combobox', { name: 'Release', exact: true }).click();
    await page.getByRole('option', { name: '1.0', exact: true }).click();
    await picker.getByRole('button', { name: /^(Add|Update) reference$/ }).click();
    await picker.getByRole('button', { name: 'Save reference change' }).click();
    await expect(picker.getByRole('heading', { name: 'Review reference change', exact: true })).toHaveCount(0);
    await expect(picker.getByRole('button', { name: /CDM \(Common/ })).toContainText('1.0');
    await expect(picker.getByRole('button', { name: /^(Add|Update) reference$/ })).toBeDisabled();
    await page.getByTestId('rail-prototype').click();
    if (width === 390) await page.getByRole('tab', { name: 'Examples', exact: true }).click();
    await page.getByRole('button', { name: 'Reference examples…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import reference examples' });
    await dialog.getByRole('button', { name: path, exact: true }).click();
    await expect(dialog.getByText('reference.example.Payment · Data')).toBeVisible();
    await dialog.getByRole('checkbox', { name: `Select ${path}` }).check();
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('reference-example-preview.png') });
    await dialog.getByRole('button', { name: 'Import 1 into library' }).click();
    await expect(dialog.getByText(`${path}: imported.`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
    const row = page.getByTestId('prototype-grid').getByRole('row').filter({ hasText: 'reference.example.Payment' });
    await expect(row).toContainText('saved');
    const files = await projectBackingFiles(page);
    const descriptor = Object.entries(files).find(([path]) => path.endsWith('.example.json'));
    expect(descriptor).toBeDefined();
    expect(JSON.parse(descriptor![1]).provenance.reference).toMatchObject({
      commit: release.commit,
      release: '1.0',
      path,
      format: 'RUNE_JSON'
    });
    await dismissLocalTransportNotices(page);
    if (width === 390) await page.getByRole('tab', { name: 'Workflow', exact: true }).click();
    await page.getByRole('button', { name: /Choose a function/ }).click();
    await page.getByRole('option', { name: /Double/ }).click();
    await expect(page.getByRole('region', { name: 'payment fields', exact: true })).toBeVisible();
    if (width === 390) await page.getByRole('tab', { name: 'Examples', exact: true }).click();
    await row.click();
    await page
      .getByRole('dialog', { name: 'Use object as input', exact: true })
      .getByRole('button', { name: 'payment Payment', exact: true })
      .click();
    if (width === 390) await page.getByRole('tab', { name: 'Workflow', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
    const amount = page
      .getByRole('region', { name: 'payment fields', exact: true })
      .getByRole('spinbutton', { name: 'Amount', exact: true });
    await expect(amount).toHaveValue('21');
    await amount.fill('22');
    await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByTestId('instance-payload-output')).toContainText('44');
    await page.reload();
    await page.getByTestId('rail-prototype').click();
    if (width === 390) await page.getByRole('tab', { name: 'Examples', exact: true }).click();
    await expect(row).toContainText('reference.example.Payment');
    await expect(row).toContainText('saved');
    expect(errors).toEqual([]);
  });
