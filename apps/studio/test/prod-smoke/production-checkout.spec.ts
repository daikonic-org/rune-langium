// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { loadCurrentCdm as loadCdm } from '../helpers/workspace-launcher.js';
import { fullSourceEditor } from '../helpers/source-editor.js';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { expectSourceReadOnly, expectReadyReferenceGraph } from '../prod-ux/readiness.js';
import { typeNavigationButton } from '../helpers/type-navigation.js';

const CF_PAGES_PROJECT = 'daikonic-dev';
const CF_PRODUCTION_BRANCH = 'master';

/**
 * Cloudflare Pages never rolls back on a failed build — canonical_deployment
 * is the last deployment that actually finished successfully, which can lag
 * latest_deployment (the most recent attempt) by any number of commits. A
 * "prod is current" check must read canonical_deployment, not branch HEAD or
 * the most recent deploy attempt.
 */
interface CfPagesDeployment {
  short_id: string;
  deployment_trigger: { metadata: { branch: string; commit_hash: string } };
  latest_stage: { status: string };
}

interface CfPagesProject {
  canonical_deployment?: CfPagesDeployment;
  latest_deployment?: CfPagesDeployment;
}

function resolveMasterCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', `origin/${CF_PRODUCTION_BRANCH}`], { encoding: 'utf-8' }).trim();
  } catch {
    return execFileSync('git', ['rev-parse', CF_PRODUCTION_BRANCH], { encoding: 'utf-8' }).trim();
  }
}

// Anchors must be corpus-stable: BusinessCenterEnum was migrated upstream to
// the codelist pattern (cdm.base.staticdata.codelist.BusinessCenter) in the
// 2026-07-02 curated build. Both anchors below match the single 'Business'
// search and live in cdm.base.datetime.
const ENUM_NODE_ID = 'cdm.base.datetime.BusinessDayConventionEnum';
const DATA_NODE_ID = 'cdm.base.datetime.BusinessCenters';
// Regression: cdm.base.staticdata.party is never pre-hydrated at load time.
// First navigation to it must populate Inspector members (resolveNodeFileRef fix).
const COUNTERPARTY_NODE_ID = 'cdm.base.staticdata.party.Counterparty';
test.describe('production checkout smoke', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');

  test('loads CDM and updates explorer-driven panes with original curated source', async ({ page }) => {
    await loadCdm(page);
    const centerStack = page.getByTestId('center-stack');

    await page.getByTestId('rail-explore').click();
    await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20000 });

    // The namespace tree is virtualized — filter narrowly before each click so
    // the target row is mounted regardless of corpus growth.
    const namespaceSearch = page.getByTestId('namespace-search');
    await namespaceSearch.fill('BusinessDayConvention');

    await typeNavigationButton(page, ENUM_NODE_ID, 'RosettaEnumeration').click();

    await namespaceSearch.fill('BusinessCenters');
    await typeNavigationButton(page, DATA_NODE_ID).click();

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

  test('Inspector populates members on first navigation to a never-hydrated curated namespace', async ({ page }) => {
    // Regression for fix/source-parse-recovery (resolveNodeFileRef, commit f6a64029).
    //
    // Before the fix: the hydration relink effect captured a stale resolveNodeFile
    // closure. On the first navigation to an unvisited namespace, linkDocument
    // received the synthetic ${bundleId}/${namespace} path instead of the real
    // deferred-model path, returned newModels:[], and Inspector stayed as a bare
    // header stub with no members.
    //
    // This test navigates directly to cdm.base.staticdata.party.Counterparty
    // without first visiting any other namespace, then asserts that the Inspector
    // shows a populated "Attributes (N)" list. An empty inspector would mean the
    // bug regressed.
    await loadCdm(page);
    const centerStack = page.getByTestId('center-stack');

    await page.getByTestId('rail-explore').click();
    await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 20_000 });

    const namespaceSearch = page.getByTestId('namespace-search');
    await namespaceSearch.fill('Counterparty');

    await typeNavigationButton(page, COUNTERPARTY_NODE_ID).click();

    await page.getByRole('button', { name: 'Inspector' }).click();
    await expect(centerStack.getByRole('heading', { name: 'Counterparty' })).toBeVisible({ timeout: 10_000 });
    await expect(centerStack.getByText('Reference Only', { exact: true })).toBeVisible();
    // Counterparty is a Data kind, so refOnly routes it through DataTypeForm
    // (not OtherForm) since PR #494 — its guard renders "Attributes (N)" only
    // when fields.length + inheritedCount > 0, so /Attributes \([1-9]/ ensures
    // at least one attribute; being explicit here documents the intent clearly.
    await expect(centerStack.getByText(/Attributes \([1-9]/)).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Source' }).click();
    await expect(page.getByLabel('Source file path')).toContainText('base-staticdata-party-type.rosetta');
    const source = fullSourceEditor(page).locator('.cm-content');
    await expect(source).toContainText('type Counterparty');
    await expectSourceReadOnly(source);
  });

  test('accepted reference closure opens a hydrated Graph', async ({ page }) => {
    await loadCdm(page);
    await expectReadyReferenceGraph(page, COUNTERPARTY_NODE_ID, 'Counterparty');
  });
});

test.describe('production deployment freshness', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');
  test.skip(
    !process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID,
    'set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to verify the live deployment against master'
  );

  test('canonical Pages deployment serves the current master commit', async ({ request }) => {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const res = await request.get(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${CF_PAGES_PROJECT}`,
      { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } }
    );
    expect(res.ok(), `Cloudflare API request failed: ${res.status()} ${await res.text()}`).toBeTruthy();

    const { result } = (await res.json()) as { result: CfPagesProject };
    const canonical = result.canonical_deployment;
    expect(canonical, 'project has no canonical_deployment — nothing has ever deployed successfully').toBeTruthy();

    const masterCommit = resolveMasterCommit();
    const liveCommit = canonical!.deployment_trigger.metadata.commit_hash;

    if (liveCommit !== masterCommit) {
      const latest = result.latest_deployment;
      const staleness =
        latest && latest.short_id !== canonical!.short_id
          ? ` The most recent deploy attempt (${latest.deployment_trigger.metadata.commit_hash}) is in status ` +
            `"${latest.latest_stage.status}" — if it failed, production is silently stuck on an older commit.`
          : '';
      expect(liveCommit, `Production (${liveCommit}) does not match master HEAD (${masterCommit}).${staleness}`).toBe(
        masterCommit
      );
    }
  });
});
