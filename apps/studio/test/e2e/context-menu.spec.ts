// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test, expect } from '@playwright/test';
import { fullSourceEditor } from '../helpers/source-editor.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

test('graph right-click menus open at the pointer and execute visibility actions', async ({ page }, testInfo) => {
  const menuErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /Base UI|MenuGroupContext/.test(message.text())) menuErrors.push(message.text());
  });
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'context.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from('namespace context\ntype Example:\n value string (0..1)\n')
  });
  const graphToggle = page.getByRole('button', { name: 'Graph', exact: true });
  if ((await graphToggle.getAttribute('aria-pressed')) !== 'true') await graphToggle.click();
  const graph = page.locator('[data-pane="graph"]');
  const node = graph.locator('.react-flow__node').filter({ hasText: 'Example' });
  await expect(node).toBeVisible();
  await dismissLocalTransportNotices(page);
  const nodeBounds = (await node.boundingBox())!;
  const pointer = { x: nodeBounds.x + nodeBounds.width / 2, y: nodeBounds.y + nodeBounds.height / 2 };
  await page.mouse.click(pointer.x, pointer.y, { button: 'right' });
  const menu = page.getByTestId('graph-context-menu');
  await expect(menu).toBeVisible();
  await expect
    .poll(() => menu.evaluate((el) => el.getAnimations().every((animation) => animation.playState !== 'running')))
    .toBe(true);
  const menuBounds = (await menu.boundingBox())!;
  expect(Math.abs(menuBounds.x - pointer.x)).toBeLessThan(4);
  expect(Math.abs(menuBounds.y - pointer.y)).toBeLessThan(4);
  await page.screenshot({ path: testInfo.outputPath('graph-node-menu.png') });
  await menu.getByRole('menuitem', { name: 'Hide this node' }).click();
  await expect(menu).not.toBeVisible();
  await expect(node).toHaveCount(0);

  const pane = graph.locator('.react-flow__pane');
  await pane.click({ button: 'right', position: { x: 100, y: 150 } });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Hide this node' })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Show all nodes' }).click();
  await graph
    .getByRole('toolbar', { name: 'Graph toolbar', exact: true })
    .getByRole('button', { name: 'Fit View', exact: true })
    .click();
  await expect(node).toBeVisible();
  await node.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();

  await page.getByRole('button', { name: 'Source', exact: true }).click();
  const source = fullSourceEditor(page).locator('.cm-content');
  await expect(source).toContainText('type Example:');
  await page.evaluate(() => {
    document.addEventListener(
      'contextmenu',
      (event) => {
        document.body.dataset.sourceContextPrevented = String(event.defaultPrevented);
      },
      { once: true }
    );
  });
  await source.click({ button: 'right' });
  await expect(page.locator('body')).toHaveAttribute('data-source-context-prevented', 'false');
  await expect(menu).not.toBeVisible();
  expect(menuErrors).toEqual([]);
});
