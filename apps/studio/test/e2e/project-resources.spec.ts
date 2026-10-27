// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { projectBackingFiles } from '../helpers/project-backing.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const content = `namespace quote
typeAlias Basis: string
func EchoBasis:
 inputs: basis Basis (1..1)
 output: result Basis (1..1)
 set result: basis`;
async function reloadProject(page: Page) {
  await page.getByTestId('rail-export').click();
  await page.getByRole('button', { name: 'Reload project files', exact: true }).click();
  await page.getByTestId('rail-prototype').click();
}
test('uses saved project code lists for real form choices, execution and unavailable recovery', async ({
  page
}, info) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1461, height: 988 });
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'quote.rosetta', buffer: Buffer.from(content), mimeType: 'text/plain' });
  await expect(page.getByTestId('explore-workbench')).toBeVisible();
  await projectBackingFiles(page, {
    'rune-config.yml': 'model: {name: Quote}',
    'build-config.yml': JSON.stringify({
      schemaVersion: 1,
      sources: ['**/*.rosetta'],
      overrides: [
        {
          kind: 'resource',
          source: { model: 'local', id: 'quote.Basis#RosettaTypeAlias' },
          path: 'resources/basis.json'
        }
      ]
    }),
    'resources/basis.json': '[{"value":"ACT/360","label":"Actual / 360"}]'
  });
  await page.reload();
  await page.getByTestId('rail-prototype').click();
  await page.getByRole('button', { name: /^Choose a function/ }).click();
  await page.getByRole('option', { name: /EchoBasis.*quote/ }).click();
  const basis = page.getByRole('combobox', { name: 'Basis', exact: true });
  await expect(basis).toBeVisible({ timeout: 20000 });
  await basis.click();
  await expect(page.getByRole('option', { name: 'Actual / 360', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: /Dollar/ })).toHaveCount(0);
  await page.getByRole('option', { name: 'Actual / 360', exact: true }).click();
  const execute = page.getByRole('button', { name: 'Execute', exact: true });
  await expect(execute).toBeEnabled({ timeout: 20000 });
  await execute.click();
  await expect(page.getByRole('region', { name: 'result output' })).toContainText('ACT/360');
  await projectBackingFiles(page, { 'resources/basis.json': '{broken' });
  await reloadProject(page);
  await expect(execute).toBeDisabled({ timeout: 20000 });
  await expect(page.getByText(/JSON|decod|Expected property|unsupported/i).first()).toBeVisible();
  await projectBackingFiles(page, { 'resources/basis.json': '[{"value":"30E/360","label":"30E / 360"}]' });
  await reloadProject(page);
  await expect(basis).toBeVisible({ timeout: 20000 });
  await basis.click();
  await page.getByRole('option', { name: '30E / 360', exact: true }).click();
  await expect(execute).toBeEnabled({ timeout: 20000 });
  await execute.click();
  await expect(page.getByRole('region', { name: 'result output' })).toContainText('30E/360');
  await dismissLocalTransportNotices(page);
  const a11y = await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze();
  expect(a11y.violations).toEqual([]);
  await info.attach('project-code-list-recovery', {
    body: await page.screenshot({ path: info.outputPath('project-code-list.png') }),
    contentType: 'image/png'
  });
});

for (const width of [1440, 390])
  test(`real CDM code-list resource validates and executes at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('./');
    const source = `namespace options
typeAlias OptionType: string
func EchoOption:
 inputs: option OptionType (1..1)
 output: result OptionType (1..1)
 set result: option`;
    await page
      .locator('input[type="file"][accept=".rosetta"]')
      .setInputFiles({ name: 'options.rosetta', buffer: Buffer.from(source), mimeType: 'text/plain' });
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    const codes = readFileSync(
      new URL('../../../../test/fixtures/third-party/cdm-codelists/option-type-1-0.json', import.meta.url),
      'utf8'
    );
    await projectBackingFiles(page, {
      'rune-config.yml': 'model: {name: Options}',
      'build-config.yml': JSON.stringify({
        schemaVersion: 1,
        sources: ['**/*.rosetta'],
        overrides: [
          {
            kind: 'resource',
            source: { model: 'local', id: 'options.OptionType#RosettaTypeAlias' },
            path: 'resources/option-type.json',
            codeList: {
              format: 'cdm-json',
              canonicalUri: 'http://www.fpml.org/coding-scheme/option-type',
              version: '1-0'
            }
          }
        ]
      }),
      'resources/option-type.json': codes
    });
    await page.reload();
    await page.getByTestId('rail-prototype').click();
    await page.getByRole('button', { name: /^Choose a function/ }).click();
    await page.getByRole('option', { name: /EchoOption.*options/ }).click();
    const option = page.getByRole('combobox', { name: 'Option', exact: true });
    await expect(option).toBeVisible();
    await page.getByRole('button', { name: 'EchoOption node actions' }).click();
    await page.getByRole('button', { name: 'Import input…' }).click();
    await page.getByRole('textbox', { name: 'Import JSON data' }).fill('{"option":"Unknown"}');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeDisabled();
    await expect(option).toContainText('Unknown (not in list)');
    await page.keyboard.press('Escape');
    await option.click();
    await page.getByRole('option', { name: /^Call/ }).click();
    await expect(page.getByRole('button', { name: 'Execute', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.getByRole('region', { name: 'result output' })).toContainText('Call');
    await dismissLocalTransportNotices(page);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze()).violations
    ).toEqual([]);
    await info.attach('cdm-code-list', {
      body: await page.screenshot({ path: info.outputPath('cdm-code-list.png') }),
      contentType: 'image/png'
    });
  });
