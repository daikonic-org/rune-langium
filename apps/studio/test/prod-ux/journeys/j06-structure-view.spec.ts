// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { fullSourceEditor } from '../../helpers/source-editor.js';
import { checkout as test, expect, loadCdm } from '../fixtures.js';
import { declarationNodeId, typeNavigationButton } from '../../helpers/type-navigation.js';
import { expectPopulatedAttributes, waitForHydratedNode } from '../readiness.js';
import { ANCHOR_DATA } from '../anchors.js';
import { expectContainedInPane } from '../../helpers/pane-geometry.js';

test.describe('J06 — Structure view', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');

  test('J06 renders nested Structure cards and inspects their type through Source', async ({ page, evidence }) => {
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

    const structure = page.getByTestId('structure-view-flow');
    const node = structure.getByRole('region', { name: 'BusinessCenters', exact: true });
    await expect(node).toBeVisible();
    await node.getByRole('group', { name: 'BusinessCenters type actions', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Inspect type', exact: true }).click();
    await expectPopulatedAttributes(page.getByTestId('center-stack'));
    await expect(
      page.getByTestId('center-stack').getByRole('heading', { name: 'BusinessCenters', exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(fullSourceEditor(page)).toBeVisible();
    await expect(fullSourceEditor(page).locator('.cm-content')).toContainText('type BusinessCenters');
    await expectContainedInPane(node, structure);
    await evidence.checkpoint('node-selected');
  });
});
