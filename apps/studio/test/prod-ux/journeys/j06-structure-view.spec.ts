// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { fullSourceEditor } from '../../helpers/source-editor.js';
import { checkout as test, expect, loadCdm } from '../fixtures.js';
import { declarationNodeId, typeNavigationButton } from '../../helpers/type-navigation.js';
import { waitForHydratedNode } from '../readiness.js';
import { ANCHOR_DATA } from '../anchors.js';
import { expectContainedInPane } from '../../helpers/pane-geometry.js';

test.describe('J06 — Structure view', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');

  test('J06 renders the graph with no empty state and selection syncs to Inspector', async ({ page, evidence }) => {
    await loadCdm(page, evidence);
    await page.getByTestId('rail-explore').click();
    await page.getByTestId('namespace-search').fill('BusinessCenters');
    await evidence.measure('hydration', ANCHOR_DATA, async () => {
      await typeNavigationButton(page, ANCHOR_DATA).click();
      await waitForHydratedNode(page, declarationNodeId(ANCHOR_DATA));
    });

    await page.getByRole('button', { name: 'Structure' }).click();
    await expect(page.getByTestId('structure-view-flow')).toBeVisible();
    await expect(page.getByTestId('structure-empty-state')).toHaveCount(0);
    await evidence.checkpoint('structure-view-rendered');

    const node = page.getByTestId('structure-view-flow').locator('.react-flow__node').first();
    await expect(node).toBeVisible();
    await node.click();
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(fullSourceEditor(page)).toBeVisible();
    await expectContainedInPane(node, page.getByTestId('structure-view-flow'));
    await evidence.checkpoint('node-selected');
  });
});
