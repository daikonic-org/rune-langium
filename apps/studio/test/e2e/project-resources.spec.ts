// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { projectBackingFiles } from '../helpers/project-backing.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const content = `namespace quote
typeAlias Currency: string
func EchoCurrency:
 inputs: currency Currency (1..1)
 output: result Currency (1..1)
 set result: currency`;
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
          source: { model: 'local', id: 'quote.Currency#RosettaTypeAlias' },
          path: 'resources/currency.json'
        }
      ]
    }),
    'resources/currency.json': '[{"value":"EUR","label":"Euro"}]'
  });
  await page.reload();
  await page.getByTestId('rail-prototype').click();
  await page.getByRole('button', { name: /^Choose a function/ }).click();
  await page.getByRole('option', { name: /EchoCurrency.*quote/ }).click();
  const currency = page.getByRole('combobox', { name: 'Currency', exact: true });
  await expect(currency).toBeVisible({ timeout: 20000 });
  await currency.click();
  await expect(page.getByRole('option', { name: 'Euro', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: /Dollar|GBP/ })).toHaveCount(0);
  await page.getByRole('option', { name: 'Euro', exact: true }).click();
  const execute = page.getByRole('button', { name: 'Execute', exact: true });
  await expect(execute).toBeEnabled({ timeout: 20000 });
  await execute.click();
  await expect(page.getByRole('region', { name: 'result output' })).toContainText('EUR');
  await projectBackingFiles(page, { 'resources/currency.json': '{broken' });
  await reloadProject(page);
  await expect(execute).toBeDisabled({ timeout: 20000 });
  await expect(page.getByText(/JSON|decod|Expected property|unsupported/i).first()).toBeVisible();
  await projectBackingFiles(page, { 'resources/currency.json': '[{"value":"GBP","label":"Pound sterling"}]' });
  await reloadProject(page);
  await expect(currency).toBeVisible({ timeout: 20000 });
  await currency.click();
  await page.getByRole('option', { name: 'Pound sterling', exact: true }).click();
  await expect(execute).toBeEnabled({ timeout: 20000 });
  await execute.click();
  await expect(page.getByRole('region', { name: 'result output' })).toContainText('GBP');
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
