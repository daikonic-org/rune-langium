// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Daikonic contributors

import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { test } from '../helpers/studio-test.js';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const source = `namespace harden
enum BusinessCenterEnum:
 LN
 NY
enum CommodityBusinessCalendarEnum:
 Coal
 Gas
type BusinessCentersReference:
 href string (0..1)
type BusinessCenters:
 businessCenter BusinessCenterEnum (0..*)
 commodityBusinessCalendar CommodityBusinessCalendarEnum (0..*)
 businessCentersReference BusinessCentersReference (0..1)
`;

for (const theme of ['daikonic', 'light'])
  for (const width of [1280, 1920, 390]) {
    test(`long Graph members stay compact and named at ${width}px in ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 720 });
      await page.goto(`./?theme=${theme}`);
      await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
        name: 'hardening.rosetta',
        mimeType: 'text/plain',
        buffer: Buffer.from(source)
      });
      await typeNavigationButton(page, 'harden.BusinessCenters').click();
      await page.getByRole('button', { name: 'Graph', exact: true }).click();
      if (width >= 1280)
        for (const name of ['Source', 'Inspector']) {
          const toggle = page.getByRole('button', { name, exact: true });
          if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
        }
      const node = page.getByTestId('rf__node-harden.BusinessCenters#Data').locator('.rune-node');
      await expect(node.locator('.rune-node-member')).toHaveCount(3);
      await expect.poll(() => node.evaluate((card) => card.clientHeight)).toBeLessThan(220);
      for (const name of ['businessCenter', 'commodityBusinessCalendar', 'businessCentersReference'])
        await expect(node.getByTitle(name, { exact: true })).toHaveText(name);
      const rows = await node.locator('.rune-node-member').evaluateAll((elements) =>
        elements.map((element) => ({
          height: element.clientHeight,
          nameWidth: element.querySelector<HTMLElement>('.rune-node-member-name')!.offsetWidth,
          overflow: element.scrollWidth > element.clientWidth
        }))
      );
      expect(rows.every((row) => row.height <= 56 && row.nameWidth >= 40 && !row.overflow)).toBe(true);
      await dismissLocalTransportNotices(page);
      expect(
        (await new AxeBuilder({ page }).include('[data-testid="explore-workbench"]').analyze()).violations
      ).toEqual([]);
      await page.screenshot({ path: info.outputPath('graph-hardening.png') });
    });
  }
