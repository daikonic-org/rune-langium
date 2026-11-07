// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, type Page } from '@playwright/test';
import { test } from '../helpers/studio-test.js';
import { typeNavigationButton } from '../helpers/type-navigation.js';
import { fullSourceEditor } from '../helpers/source-editor.js';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

const source = `namespace demo.feedback
version "1"
type Quote:
  amount number (1..1)
  currency string (1..1)
`;

async function load(page: Page) {
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.goto('./');
  await page
    .locator('input[type="file"][accept=".rosetta"]')
    .setInputFiles({ name: 'feedback.rosetta', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await page.getByTestId('namespace-search').fill('Quote');
  await typeNavigationButton(page, 'demo.feedback.Quote', 'Data').click();
  for (const pane of ['Inspector', 'Source']) {
    const button = page
      .getByRole('toolbar', { name: 'Center pane selector' })
      .getByRole('button', { name: pane, exact: true });
    if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  }
  await dismissLocalTransportNotices(page);
  await expect(page.locator('[data-feedback-key="attributes:currency"]')).toBeVisible();
  await expect(fullSourceEditor(page).locator('.cm-content')).toBeVisible();
}

test('Inspector edits cue Source and leave the active name quiet', async ({ page }, info) => {
  await load(page);
  const row = page.locator('[data-feedback-key="attributes:currency"]');
  const name = row.getByRole('textbox', { name: /Attribute name/ });
  const changed = page.locator('[data-feedback-key="attributes:settlementCurrency"]');
  // Peer views settle independently; observe each short-lived cue from the edit onward.
  await Promise.all([
    expect(fullSourceEditor(page).locator('[data-change-feedback="change"]')).toBeVisible(),
    expect(page.getByTestId('structure-view-flow').locator('li[data-change-feedback="change"]')).toBeVisible(),
    expect(changed).toBeVisible(),
    name.fill('settlementCurrency')
  ]);
  await expect(changed).not.toHaveAttribute('data-change-feedback');
  await info.attach('inspector-origin', {
    body: await page.screenshot({ path: info.outputPath('inspector-origin.png') }),
    contentType: 'image/png'
  });
});

test('Structure edits cue peer views; Graph cues semantic updates but not canvas motion', async ({ page }, info) => {
  await load(page);
  const structure = page.getByTestId('structure-view-flow');
  await structure.getByRole('button', { name: 'currency', exact: true }).click();
  const field = structure.getByRole('textbox', { name: 'Edit currency', exact: true });
  await field.fill('settlementCurrency');
  await Promise.all([
    expect(fullSourceEditor(page).locator('[data-change-feedback="change"]')).toBeVisible(),
    expect(
      page.locator('[data-feedback-key="attributes:settlementCurrency"][data-change-feedback="change"]')
    ).toBeVisible(),
    field.press('Enter')
  ]);
  await expect(structure.locator('[data-change-feedback]')).toHaveCount(0);
  await page
    .getByRole('toolbar', { name: 'Center pane selector' })
    .getByRole('button', { name: 'Graph', exact: true })
    .click();
  const node = page.locator('.react-flow__node[data-id="demo.feedback.Quote#Data"] .rune-node');
  await expect(node).toBeVisible();
  await expect(node).not.toHaveAttribute('data-change-feedback');
  await page
    .locator('[data-feedback-key="attributes:settlementCurrency"]')
    .getByRole('textbox', { name: /Attribute name/ })
    .fill('currencyCode');
  await expect(node).toHaveAttribute('data-change-feedback', 'change');
  await info.attach('graph-target', {
    body: await page.screenshot({ path: info.outputPath('graph-target.png') }),
    contentType: 'image/png'
  });
  await expect(node).not.toHaveAttribute('data-change-feedback');
  const pane = page.locator('.studio-graph-canvas .react-flow__pane').first();
  const box = await pane.boundingBox();
  if (!box) throw new Error('Graph canvas bounds unavailable');
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 60, { steps: 5 });
  await page.mouse.up();
  await expect(node).not.toHaveAttribute('data-change-feedback');
});

test('Source edits cue Inspector, then additions/removals remain inert and temporary', async ({ page }, info) => {
  await load(page);
  const content = fullSourceEditor(page).locator('.cm-content');
  await content.fill(source.replace('currency string', 'settlementCurrency string'));
  await expect(
    page.locator('[data-feedback-key="attributes:settlementCurrency"][data-change-feedback="change"]')
  ).toBeVisible();
  await expect(fullSourceEditor(page).locator('[data-change-feedback]')).toHaveCount(0);
  await info.attach('source-origin', {
    body: await page.screenshot({ path: info.outputPath('source-origin.png') }),
    contentType: 'image/png'
  });
  await content.fill(source + '  note string (0..1)\n');
  await expect(page.locator('[data-feedback-key="attributes:note"][data-change-feedback="add"]')).toBeVisible();
  await content.fill(source);
  const ghost = page.locator('[data-change-feedback-ghost]');
  await expect(ghost.first()).toHaveAttribute('aria-hidden', 'true');
  expect(await ghost.evaluateAll((elements) => elements.every((element) => element.inert))).toBe(true);
  await expect(ghost).toHaveCount(0);
  await expect(content).toBeFocused();
});

test('sample changes cue exact JSON and reduced motion removes spatial feedback', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await load(page);
  const preview = page.getByTestId('panel-formPreview');
  await expect(preview).toBeVisible();
  await preview.getByLabel('Currency', { exact: true }).fill('USD');
  const payload = page.getByTestId('sample-data-output');
  await expect(payload.locator('[data-change-feedback]')).toBeVisible();
  expect(JSON.parse((await payload.textContent()) ?? '{}').currency).toBe('USD');
  const renamedSource = source.replace('currency string', 'settlementCurrency string');
  await fullSourceEditor(page).locator('.cm-content').fill(renamedSource);
  await expect(preview.locator('[data-field-path="settlementCurrency"][data-change-feedback="change"]')).toBeVisible();
  await fullSourceEditor(page)
    .locator('.cm-content')
    .fill(renamedSource + '  note string (0..1)\n');
  const added = page.locator('[data-feedback-key="attributes:note"][data-change-feedback="add"]');
  await expect(added).toBeVisible();
  expect(await added.evaluate((element) => getComputedStyle(element).animationName)).toBe('rune-change-highlight');
});

test('a later Inspector removal supersedes a Form value gesture and keeps the Inspector quiet', async ({ page }) => {
  await load(page);
  const preview = page.getByTestId('panel-formPreview');
  await preview.getByLabel('Currency', { exact: true }).fill('USD');
  const inspector = page.getByRole('complementary', { name: 'Edit Quote' });
  await inspector.getByRole('button', { name: 'Remove attribute currency', exact: true }).click();
  await expect(preview.locator('[data-change-feedback-ghost]').first()).toBeVisible();
  await expect(inspector.locator('[data-change-feedback-ghost]')).toHaveCount(0);
  await expect(inspector.locator('[data-change-feedback]')).toHaveCount(0);
});
