// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { fullSourceEditor } from '../../helpers/source-editor.js';
import { checkout as test, expect, loadCdm } from '../fixtures.js';
import { typeNameButton, typeNavigationButton } from '../../helpers/type-navigation.js';
import { expectPopulatedAttributes, expectSourceReadOnly } from '../readiness.js';

import {
  ANCHOR_ENUM as ENUM_NODE_ID,
  ANCHOR_DATA as DATA_NODE_ID,
  ANCHOR_NEVER_HYDRATED_DATA as COUNTERPARTY_NODE_ID
} from '../anchors.js';

test.describe('J04 — explorer navigation & on-demand hydration', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');

  test('J04a explorer navigation updates panes with original curated source', async ({ page, evidence }) => {
    await loadCdm(page, evidence);
    const centerStack = page.getByTestId('center-stack');

    await page.getByTestId('rail-explore').click();
    await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });
    await evidence.checkpoint('explorer-nav');

    // The namespace tree is virtualized — filter narrowly before each click so
    // the target row is mounted regardless of corpus growth.
    const namespaceSearch = page.getByTestId('namespace-search');
    await namespaceSearch.fill('BusinessDayConvention');

    await typeNavigationButton(page, ENUM_NODE_ID, 'RosettaEnumeration').click();

    await namespaceSearch.fill('BusinessCenters');
    await typeNameButton(page, DATA_NODE_ID).click();

    await page.getByRole('button', { name: 'Structure' }).click();
    await expect(page.getByTestId('structure-view-flow')).toBeVisible();
    await expect(page.getByTestId('structure-empty-state')).toHaveCount(0);

    await page.getByRole('button', { name: 'Inspector' }).click();
    await expect(centerStack.getByRole('heading', { name: 'BusinessCenters' })).toBeVisible();
    await expect(centerStack.getByText('cdm.base.datetime', { exact: true })).toBeVisible();
    await expect(centerStack.getByText('Reference Only', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Source' }).click();
    await expect(page.getByLabel('Source file path')).toContainText('base-datetime-type.rosetta');
    const source = fullSourceEditor(page).locator('.cm-content');
    await expect(source).toContainText('type BusinessCenters');
    await expectSourceReadOnly(source);
  });

  test('J04b Inspector populates members on first navigation to a never-hydrated curated namespace', async ({
    page,
    evidence
  }) => {
    // First navigation must hydrate attributes without visiting another namespace first.
    await loadCdm(page, evidence);
    const centerStack = page.getByTestId('center-stack');

    await page.getByTestId('rail-explore').click();
    await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20_000 });

    const namespaceSearch = page.getByTestId('namespace-search');
    await namespaceSearch.fill('Counterparty');

    await evidence.measure('curatedNamespaceHydration', 'Counterparty', async () => {
      await typeNavigationButton(page, COUNTERPARTY_NODE_ID).click();
      await page.getByRole('button', { name: 'Inspector' }).click();
      await expect(centerStack.getByRole('heading', { name: 'Counterparty' })).toBeVisible({ timeout: 10_000 });
      await expect(centerStack.getByText('Reference Only', { exact: true })).toBeVisible();
      await expectPopulatedAttributes(centerStack);
    });

    await page.getByRole('button', { name: 'Source' }).click();
    await expect(page.getByLabel('Source file path')).toContainText('base-staticdata-party-type.rosetta');
    const source = fullSourceEditor(page).locator('.cm-content');
    await expect(source).toContainText('type Counterparty');
    await expectSourceReadOnly(source);

    await evidence.checkpoint('hydration-complete');
  });

  test('J04c graph node shows a hydrating spinner while a never-hydrated namespace loads', async ({
    page,
    evidence
  }) => {
    // Regression for the BaseFlowNode hydrating-placeholder indicator (spec
    // 021 follow-up). Production's on-demand hydration round-trip
    // (/api/parse) is normally too fast to reliably observe the transient
    // spinner state, so this test deliberately delays that one endpoint —
    // the delay only affects when the browser's real request completes, it
    // does not fabricate the response — giving the spinner a guaranteed
    // window to assert against before it clears.
    await page.route('**/api/parse', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    });

    await loadCdm(page, evidence);

    await page.getByTestId('rail-explore').click();
    await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20_000 });

    const namespaceSearch = page.getByTestId('namespace-search');
    await namespaceSearch.fill('Counterparty');
    await typeNavigationButton(page, COUNTERPARTY_NODE_ID).click();

    await expect(page.getByTestId('rune-node-hydrating-spinner')).toBeVisible({ timeout: 5_000 });
    await evidence.checkpoint('hydration-spinner-visible');

    // The spinner clears once hydration completes and members populate.
    const centerStack = page.getByTestId('center-stack');
    await page.getByRole('button', { name: 'Inspector' }).click();
    await expectPopulatedAttributes(centerStack);
    await expect(page.getByTestId('rune-node-hydrating-spinner')).toHaveCount(0);
    await evidence.checkpoint('hydration-complete');
  });
});
