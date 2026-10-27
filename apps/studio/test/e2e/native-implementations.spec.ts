// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
const content = `namespace cdm.base.datetime
func AddDays:
 [codeImplementation]
 inputs:
  inputDate date (1..1)
  numDays int (1..1)
 output: resultDate date (1..1)
func DateDifference:
 [codeImplementation]
 inputs:
  firstDate date (1..1)
  secondDate date (1..1)
 output: difference int (1..1)
`;
for (const width of [1440, 390])
  test(`executes bundled calendar functions without host providers at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('./');
    await page
      .locator('input[type="file"][accept=".rosetta"]')
      .setInputFiles({ name: 'calendar.rosetta', buffer: Buffer.from(content), mimeType: 'text/plain' });
    await expect(page.getByTestId('explore-workbench')).toBeVisible();
    await page.getByTestId('rail-prototype').click();
    await page.getByRole('button', { name: /^Choose a function/ }).click();
    await page.getByRole('option', { name: /^AddDays.*cdm.base.datetime/ }).click();
    await page.getByLabel('Input Date', { exact: true }).fill('2020-02-28');
    await page.getByRole('spinbutton', { name: 'Num Days', exact: true }).fill('1');
    const execute = page.getByRole('button', { name: 'Execute', exact: true });
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(page.getByRole('region', { name: 'resultDate output' })).toContainText('2020-02-29');
    await page.getByRole('button', { name: /^Choose a function:/ }).click();
    await page.getByRole('option', { name: /^DateDifference.*cdm.base.datetime/ }).click();
    await page.getByLabel('First Date', { exact: true }).fill('2020-03-01');
    await page.getByLabel('Second Date', { exact: true }).fill('2020-02-28');
    await expect(execute).toBeEnabled();
    await execute.click();
    await expect(page.getByRole('region', { name: 'difference output' })).toContainText('-2');
    await dismissLocalTransportNotices(page);
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="prototype-perspective"]').analyze()).violations
    ).toEqual([]);
    expect(await page.locator('body').evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(width);
    await info.attach('native-calendar-workflow', {
      body: await page.screenshot({ path: info.outputPath('native-calendar.png') }),
      contentType: 'image/png'
    });
  });
