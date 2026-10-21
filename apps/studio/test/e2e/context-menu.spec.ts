// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { test, expect, type Locator, type Page } from '@playwright/test';
import { fullSourceEditor } from '../helpers/source-editor.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

async function uncoveredCanvasPoint(pane: Locator) {
  return pane.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    for (const x of [0.3, 0.5, 0.7, 0.9]) {
      for (const y of [0.45, 0.65, 0.85]) {
        const hit = document.elementFromPoint(bounds.x + bounds.width * x, bounds.y + bounds.height * y);
        if (hit === element) return { x: bounds.width * x, y: bounds.height * y };
      }
    }
    throw new Error('No uncovered graph canvas point found');
  });
}

async function loadNavigationFile(page: Page) {
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'navigation.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from('namespace context\ntype Other:\n value string (0..1)\ntype Example:\n other Other (0..1)\n')
  });
  await expect(page.getByTestId('ns-type-link-context.Example#Data')).toBeVisible();
  await dismissLocalTransportNotices(page);
}

test('declarations and type references offer canonical right-click navigation', async ({ page }, testInfo) => {
  await loadNavigationFile(page);
  const row = page.getByTestId('ns-type-link-context.Example#Data');
  await expect(row).toBeVisible();
  await dismissLocalTransportNotices(page);
  await row.click({ button: 'right' });
  const menu = page.getByTestId('type-navigation-menu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
  await row.focus();
  await row.press('Shift+F10');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Go to type', exact: true }).click();
  const structure = page.locator('[data-pane="structure"]');
  const node = structure.getByRole('region', { name: 'Example', exact: true });
  await expect(node).toBeVisible();
  await node.locator('[data-attr="other"]').click({ button: 'right' });
  await expect(menu).toBeVisible();
  const referenceBounds = (await menu.boundingBox())!;
  expect(referenceBounds.x).toBeGreaterThanOrEqual(0);
  expect(referenceBounds.y).toBeGreaterThanOrEqual(0);
  expect(referenceBounds.x + referenceBounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(referenceBounds.y + referenceBounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await menu.getByRole('menuitem', { name: 'Inspect type' }).click();
  await expect(page.getByRole('complementary', { name: 'Edit Other' })).toBeVisible();
  await row.click();
  await node.getByRole('group', { name: 'Example type actions', exact: true }).click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Inspect type' })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Inspect type' }).click();
  const inspector = page.getByRole('complementary', { name: 'Edit Example' });
  await expect(inspector).toBeVisible();
  await inspector.getByRole('button', { name: 'Go to Other', exact: true }).click({ button: 'right' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Go to type', exact: true }).click();
  await expect(page.getByTestId('ns-type-context.Other#Data')).toHaveAttribute('aria-current', 'true');
  await page.screenshot({ path: testInfo.outputPath('structure-context-navigation.png') });
});

test('graph type-reference menus navigate to the reference rather than its owner', async ({ page }) => {
  await loadNavigationFile(page);
  await page.getByTestId('ns-type-link-context.Example#Data').click();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  const inspectorToggle = page.getByRole('button', { name: 'Inspector', exact: true });
  if ((await inspectorToggle.getAttribute('aria-pressed')) !== 'true') await inspectorToggle.click();
  const graph = page.locator('[data-pane="graph"]');
  const typeLink = graph
    .locator('[data-id="context.Example#Data"]')
    .getByRole('button', { name: 'Other', exact: true });
  await typeLink.click({ button: 'right' });
  await page.getByTestId('type-navigation-menu').getByRole('menuitem', { name: 'Go to type', exact: true }).click();
  await expect(page.getByTestId('ns-type-context.Other#Data')).toHaveAttribute('aria-current', 'true');
});

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
  const blankPoint = await uncoveredCanvasPoint(pane);
  await pane.click({ button: 'right', position: blankPoint });
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

test('inherited Structure headers and rows expose canonical context actions', async ({ page }) => {
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'inherited-navigation.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      'namespace context\ntype Other:\n value string (0..1)\ntype Parent:\n other Other (0..1)\ntype Child extends Parent:\n label string (0..1)\n'
    )
  });
  const child = page.getByTestId('ns-type-link-context.Child#Data');
  await expect(child).toBeVisible();
  await dismissLocalTransportNotices(page);
  await child.click();
  const structure = page.locator('[data-pane="structure"]');
  const menu = page.getByTestId('type-navigation-menu');
  const baseHeader = structure.getByRole('group', { name: 'Parent type actions' });
  await expect(baseHeader).toBeVisible();
  await baseHeader.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Inspect type' }).click();
  await expect(page.getByRole('complementary', { name: 'Edit Parent' })).toBeVisible();
  await child.click();
  const inherited = structure.getByRole('group', { name: 'other type Other', exact: true });
  await inherited.focus();
  await inherited.press('Shift+F10');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(inherited).toBeFocused();
  await inherited.press('Shift+F10');
  await menu.getByRole('menuitem', { name: 'Inspect type' }).click();
  await expect(page.getByRole('complementary', { name: 'Edit Other' })).toBeVisible();
});

test('Function input and output references expose keyboard context actions', async ({ page }) => {
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'function-navigation.rosetta',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      'namespace context\ntype Other:\n value string (0..1)\nfunc Identity:\n inputs:\n  input Other (1..1)\n output:\n  result Other (1..1)\n set result: input\n'
    )
  });
  const identity = page.getByTestId('ns-type-link-context.Identity#RosettaFunction');
  await expect(identity).toBeVisible();
  await dismissLocalTransportNotices(page);
  await identity.click();
  const structure = page.locator('[data-pane="structure"]');
  const menu = page.getByTestId('type-navigation-menu');
  for (const name of ['input type Other', 'result type Other']) {
    await identity.click();
    const reference = structure.getByRole('group', { name });
    await expect(reference).toBeVisible();
    await reference.focus();
    await reference.press('Shift+F10');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(reference).toBeFocused();
    await reference.press('Shift+F10');
    await menu.getByRole('menuitem', { name: 'Inspect type' }).click();
    await expect(page.getByRole('complementary', { name: 'Edit Other' })).toBeVisible();
  }
});
