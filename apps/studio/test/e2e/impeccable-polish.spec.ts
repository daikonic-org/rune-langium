// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';
import { workflowJourneys } from '../helpers/prototype-workflow.js';

for (const journey of workflowJourneys.filter((entry) =>
  ['validation', 'viewport-1440', 'viewport-700', 'viewport-390'].includes(entry.id)
)) {
  test(journey.title, async ({ page }, info) => {
    await journey.run(page, {
      checkpoint: async (name) => {
        if (journey.id === 'viewport-390') {
          const status = page.getByRole('button', { name: /^value: Checks passed/ });
          const box = (await status.boundingBox())!;
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
        await page.screenshot({ path: info.outputPath(`${name}.png`) });
      },
      accessibility: async (_name, result) => {
        expect(result.violations).toEqual([]);
      }
    });
  });
}

for (const width of [1440, 390])
  test(`reference catalog error and Retry stay together at ${width}px`, async ({ page }, info) => {
    let attempts = 0;
    await page.route('**/releases/cdm', async (route) => {
      attempts++;
      await route.fulfill(
        attempts === 1
          ? { status: 503, body: 'Unavailable' }
          : { status: 200, json: { schemaVersion: 1, releases: [] } }
      );
    });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    await page.goto('./');
    const launcher = page.getByTestId('workspaces-perspective');
    await launcher.getByRole('button', { name: 'Reference models', exact: true }).click();
    await launcher
      .getByTestId('reference-model-picker')
      .getByRole('button', { name: /Common Domain Model/ })
      .click();
    const detail = launcher.locator('.starter-picker__detail');
    await expect(detail.getByRole('alert')).toContainText('Your workspace references are unchanged');
    await expect(detail.getByText(/HTTP 503/)).toBeHidden();
    await expect(detail.getByRole('button', { name: 'Retry releases' })).toBeVisible();
    await dismissLocalTransportNotices(page);
    await page.screenshot({ path: info.outputPath('catalog-error.png') });
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="workspaces-perspective"]').analyze()).violations
    ).toEqual([]);
    await detail.getByRole('button', { name: 'Retry releases' }).click();
    await expect(detail.getByText(/No published compatible releases/)).toBeVisible();
    expect(attempts).toBe(2);
  });
