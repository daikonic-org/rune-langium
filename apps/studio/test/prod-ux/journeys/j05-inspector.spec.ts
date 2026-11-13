// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { checkout as test, expect, loadCdm, readCombinedOpLog } from '../fixtures.js';
import { declarationNodeId, typeNavigationButton } from '../../helpers/type-navigation.js';
import { expectPopulatedAttributes } from '../readiness.js';
import { ANCHOR_DATA } from '../anchors.js';

test.describe('J05 — Inspector pane', () => {
  test.skip(!process.env.PLAYWRIGHT_PROD_SMOKE, 'set PLAYWRIGHT_PROD_SMOKE=1 to run against a deployed Studio');

  test(
    'J05 Inspector shows heading, namespace, reference-only badge, and populated members',
    { annotation: { type: 'journey-subid', description: 'members' } },
    async ({ page, evidence }) => {
      await loadCdm(page, evidence);
      const centerStack = page.getByTestId('center-stack');

      await page.getByTestId('rail-explore').click();
      await page.getByTestId('namespace-search').fill('BusinessCenters');
      const inspectorToggle = page.getByRole('button', { name: 'Inspector', exact: true });
      if ((await inspectorToggle.getAttribute('aria-pressed')) !== 'true') await inspectorToggle.click();
      const selectedAt = Date.now();
      await typeNavigationButton(page, ANCHOR_DATA).click();
      const inspector = centerStack.locator('[data-pane="inspector"]');
      await expectPopulatedAttributes(inspector);
      evidence.recordTiming('inspectorFirstContent', ANCHOR_DATA, Date.now() - selectedAt);
      await expect(inspector.locator('[data-inspector-readiness="linked"]')).toBeVisible({ timeout: 30_000 });
      evidence.recordTiming('hydration', ANCHOR_DATA, Date.now() - selectedAt);
      await expect(centerStack.getByRole('heading', { name: 'BusinessCenters' })).toBeVisible({ timeout: 30_000 });
      await expect(centerStack.getByText('cdm.base.datetime', { exact: true })).toBeVisible();
      await expect(centerStack.getByText('Reference Only', { exact: true })).toBeVisible();
      await expectPopulatedAttributes(centerStack);
      await evidence.checkpoint('inspector-populated');
    }
  );
  test(
    'J05 narrow viewport keeps three selected center panes readable',
    { annotation: { type: 'journey-subid', description: 'narrow-layout' } },
    async ({ page, evidence }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await loadCdm(page, evidence);
      await page.getByTestId('rail-explore').click();
      await page.getByTestId('namespace-search').fill('BusinessCenters');
      await typeNavigationButton(page, ANCHOR_DATA).click();
      for (const name of ['Graph', 'Source', 'Inspector']) {
        const button = page.getByRole('button', { name, exact: true });
        if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
      }
      const structure = page.getByRole('button', { name: 'Structure', exact: true });
      if ((await structure.getAttribute('aria-pressed')) === 'true') await structure.click();
      const stack = page.getByTestId('center-stack');
      await expect(stack).toHaveAttribute('data-count', '3');
      const measurePanes = () =>
        stack.locator('[data-pane]').evaluateAll((elements) =>
          elements.map((element) => ({
            width: element.getBoundingClientRect().width,
            parentWidth: element.parentElement!.getBoundingClientRect().width,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth
          }))
        );
      await expect.poll(async () => (await measurePanes()).every((pane) => pane.width > 300)).toBe(true);
      const panes = await measurePanes();
      for (const pane of panes) {
        expect(pane.width).toBeGreaterThan(300);
        expect(pane.width).toBeLessThanOrEqual(pane.parentWidth);
        expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth);
      }
      const inspector = stack.locator('[data-pane="inspector"]');
      await inspector.scrollIntoViewIfNeeded();
      await expectPopulatedAttributes(inspector);
      const graphCard = stack.getByTestId(`rf__node-${declarationNodeId(ANCHOR_DATA)}`).locator('.rune-node');
      await expect(graphCard.locator('.rune-node-member')).toHaveCount(3);
      // Natural dimensions remain independent of semantic zoom. Long linked
      // type names must not squeeze the member name to a letter-wide column.
      await expect.poll(() => graphCard.evaluate((card) => card.clientHeight)).toBeLessThan(220);
      await evidence.checkpoint('narrow-three-pane-inspector');
      expect(
        (await readCombinedOpLog(page)).filter(
          (entry) => entry.op === 'clientError' && /ResizeObserver/.test(entry.message)
        )
      ).toEqual([]);
    }
  );
});
