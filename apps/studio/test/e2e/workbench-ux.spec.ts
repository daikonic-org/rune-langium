// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { fullSourceEditor } from '../helpers/source-editor.js';
import { test, expect, type Page } from '@playwright/test';
import { typeNameButton, typeNavigationButton, typeSelectionCheckbox } from '../helpers/type-navigation.js';
import { expectContainedInPane } from '../helpers/pane-geometry.js';

const source = `namespace demo
type Party:
  name string (1..1)
type Trade:
  party Party (1..1)
`;

async function loadWorkspace(page: Page) {
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles({
    name: 'demo.rosetta',
    buffer: Buffer.from(source),
    mimeType: 'text/plain'
  });
  await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('namespace-search').fill('demo');
  await expect(typeNameButton(page, 'demo.Party')).toBeVisible({ timeout: 15_000 });
}

test('search opens declarations, files and destinations, and handles no results', async ({ page }) => {
  await loadWorkspace(page);
  const search = page.getByRole('combobox', { name: 'Search types, files and commands' });
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await search.fill('missing-declaration');
  await expect(page.getByText('No matches. Try a type name, namespace, file or destination.')).toBeVisible();
  await search.fill('demo.Trade');
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Search Studio' })).not.toBeVisible();
  await expect(page.getByTestId('structure-view-flow')).toContainText('Trade');
  await page.keyboard.press('ControlOrMeta+k');
  await search.fill('demo.rosetta');
  await page.getByRole('option', { name: 'demo.rosetta', exact: true }).click();
  await expect(fullSourceEditor(page)).toContainText('type Trade');
  await page.keyboard.press('ControlOrMeta+k');
  await search.fill('Open Export');
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page.getByTestId('export-perspective')).toBeVisible();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await search.press('Escape');
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
});

for (const width of [1280, 800]) {
  test(`navigation and Source keep the focused structure visible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await loadWorkspace(page);
    await typeNameButton(page, 'demo.Party').click();
    const structure = page.getByTestId('structure-view-flow');
    await expect(structure).toContainText('Party');
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await expectContainedInPane(structure.locator('.react-flow__node').first(), structure);
    await typeNavigationButton(page, 'demo.Trade').click();
    await expect(structure).toContainText('Trade');
    await expectContainedInPane(structure.locator('.react-flow__node').first(), structure);
    await page.getByRole('button', { name: 'Graph', exact: true }).click();
    await page.getByRole('button', { name: 'Hide all', exact: true }).click();
    await expect(page.getByTestId('graph-empty-state')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fit View', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Show selected type' }).click();
    await expect(page.getByTestId('graph-empty-state')).not.toBeVisible();
    await expect(page.getByTestId('panel-visualPreview').locator('.react-flow__node').first()).toBeVisible();
    await page.getByRole('button', { name: 'Filter visible types and relationships', exact: true }).click();
    await page.getByRole('button', { name: 'Data', exact: true }).click();
    await page.getByRole('button', { name: 'Data', exact: true }).press('Escape');
    await expect(page.getByTestId('graph-empty-state')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    const search = page.getByRole('combobox', { name: 'Search types, files and commands' });
    await search.fill('demo.Party');
    await search.press('ArrowDown');
    await search.press('Enter');
    await expect(page.getByTestId('graph-empty-state')).not.toBeVisible();
  });
}

test('Export prioritizes its selection area and navigation preserves inclusion', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await loadWorkspace(page);
  await page.getByTestId('rail-export').click();
  const selection = page.getByTestId('export-selection');
  await selection.getByTestId('namespace-search').fill('demo');
  const checkbox = typeSelectionCheckbox(selection, 'demo.Party');
  await checkbox.click();
  const tree = selection.getByTestId('namespace-tree');
  await expect.poll(async () => (await tree.boundingBox())?.height ?? 0).toBeGreaterThan(120);
  await typeNameButton(selection, 'demo.Trade').click();
  await expect(page.getByTestId('structure-view-flow')).toContainText('Trade');
  await page.getByTestId('rail-export').click();
  await selection.getByTestId('namespace-search').fill('demo');
  await expect(checkbox).toHaveAttribute('aria-checked', 'true');
  await expect(typeSelectionCheckbox(selection, 'demo.Trade')).toHaveAttribute('aria-checked', 'false');
});
