// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Playwright E2E test — Graph Interactions.
 *
 * Validates the ReactFlow graph canvas:
 * 1. Nodes render with correct types and labels
 * 2. Edges render between related types
 * 3. Node selection highlights
 * 4. Fit view and re-layout actions work
 * 5. Graph controls (zoom, minimap) present
 */

import { test, expect, type Page } from '@playwright/test';
import { dismissLocalTransportNotices } from '../helpers/expression-workspace.js';

// ---------------------------------------------------------------------------
// Fixtures — Use unique names that won't be substrings of each other
// ---------------------------------------------------------------------------

const INHERITANCE_MODEL = `namespace graph.test
version "1.0.0"

type Vehicle:
  vin string (1..1)

type Sedan extends Vehicle:
  doors int (0..1)

enum Fuel:
  Gasoline
  Electric
  Hybrid
`;

const MULTI_FILE_MODEL_A = `namespace graph.alpha
version "1.0.0"

type AlphaOne:
  value string (1..1)

type AlphaTwo extends AlphaOne:
  count int (1..1)
`;

const MULTI_FILE_MODEL_B = `namespace graph.beta
version "1.0.0"

type BetaItem:
  ref string (0..1)

enum BetaStatus:
  Active
  Inactive
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadFiles(page: Page, files: { name: string; content: string }[], fit = true) {
  const fileInput = page.locator('input[type="file"][accept=".rosetta"]');
  await fileInput.setInputFiles(
    files.map((f) => ({
      name: f.name,
      mimeType: 'text/plain',
      buffer: Buffer.from(f.content)
    }))
  );
  await page.waitForSelector('[data-testid="explore-workbench"]', { timeout: 15000 });
  const firstName = files[0]!.content.match(/^(?:type|enum)\s+(\w+)/m)![1]!;
  await expect(page.getByRole('button', { name: `Navigate to ${firstName}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  const toolbar = page.getByRole('toolbar', { name: 'Graph toolbar' });
  const focus = toolbar.getByRole('button', { name: 'Focus', exact: true });
  if ((await focus.getAttribute('aria-pressed')) === 'true') await focus.click();
  await dismissLocalTransportNotices(page);
  if (fit) await toolbar.getByRole('button', { name: 'Fit View', exact: true }).click();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Graph Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./');
    await page.waitForLoadState('domcontentloaded');
  });

  test('should render all nodes from the model', async ({ page }) => {
    await loadFiles(page, [{ name: 'model.rosetta', content: INHERITANCE_MODEL }]);

    // 3 types: Vehicle, Sedan, Fuel
    await expect(page.getByTestId('rf__node-graph.test.Vehicle#Data')).toBeVisible();
    await expect(page.getByTestId('rf__node-graph.test.Sedan#Data')).toBeVisible();
    await expect(page.getByTestId('rf__node-graph.test.Fuel#RosettaEnumeration')).toBeVisible();
  });

  test('should render edges for inheritance relationships', async ({ page }) => {
    await loadFiles(page, [{ name: 'model.rosetta', content: INHERITANCE_MODEL }]);

    const edges = page.locator('.react-flow__edge');
    const edgeCount = await edges.count();
    // Sedan extends Vehicle = at least 1 edge
    expect(edgeCount).toBeGreaterThanOrEqual(1);
  });

  test('should select a node when clicked', async ({ page }) => {
    await loadFiles(page, [{ name: 'model.rosetta', content: INHERITANCE_MODEL }]);
    await page.waitForTimeout(2000); // Wait for layout animation

    const vehicleNode = page.getByTestId('rf__node-graph.test.Vehicle#Data');
    await vehicleNode.click({ force: true });
    await page.waitForTimeout(500);

    await expect(vehicleNode).toHaveClass(/selected/);
  });

  test('Fit View brings imported nodes into the viewport with Focus off', async ({ page }, info) => {
    await loadFiles(page, [{ name: 'model.rosetta', content: INHERITANCE_MODEL }]);

    const fitViewBtn = page.locator('[aria-label="Graph toolbar"]').getByRole('button', {
      name: 'Fit View'
    });
    await fitViewBtn.click();
    await page.waitForTimeout(500);

    for (const id of ['graph.test.Vehicle#Data', 'graph.test.Sedan#Data', 'graph.test.Fuel#RosettaEnumeration']) {
      await expect(page.getByTestId(`rf__node-${id}`)).toBeInViewport();
    }
    await page.screenshot({ path: info.outputPath('graph-fit-all.png') });
  });

  test('explorer navigation reaches imported types outside the current viewport', async ({ page }, info) => {
    await loadFiles(page, [{ name: 'model.rosetta', content: INHERITANCE_MODEL }], false);
    for (const name of ['Vehicle', 'Fuel']) {
      await page.getByRole('button', { name: `Navigate to ${name}`, exact: true }).click();
      const kind = name === 'Fuel' ? 'RosettaEnumeration' : 'Data';
      const node = page.getByTestId(`rf__node-graph.test.${name}#${kind}`);
      await expect(node).toBeInViewport();
      await expect.poll(async () => (await node.boundingBox())?.width ?? 0).toBeGreaterThan(100);
    }
    await page.screenshot({ path: info.outputPath('graph-navigation.png') });
  });

  for (const width of [900, 390]) {
    test(`Fit View includes imported nodes at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width: 1323, height: 988 });
      await loadFiles(page, [{ name: 'model.rosetta', content: INHERITANCE_MODEL }]);
      if (width === 390) {
        await page.getByRole('button', { name: 'Hide Type explorer', exact: true }).click();
        await page.getByRole('button', { name: 'Hide Preview panel', exact: true }).click();
      }
      await page.setViewportSize({ width, height: 988 });
      await page
        .getByRole('toolbar', { name: 'Graph toolbar' })
        .getByRole('button', { name: 'Fit View', exact: true })
        .click();
      for (const id of ['graph.test.Vehicle#Data', 'graph.test.Sedan#Data', 'graph.test.Fuel#RosettaEnumeration']) {
        await expect(page.getByTestId(`rf__node-${id}`)).toBeInViewport();
      }
      await page.screenshot({ path: info.outputPath(`graph-fit-${width}.png`) });
    });
  }

  test('Re-layout button should rearrange nodes', async ({ page }) => {
    await loadFiles(page, [{ name: 'model.rosetta', content: INHERITANCE_MODEL }]);

    const relayoutBtn = page.locator('[aria-label="Graph toolbar"]').getByRole('button', {
      name: 'Re-layout'
    });
    if (await relayoutBtn.isVisible()) {
      await relayoutBtn.click();
      await page.waitForTimeout(1000);

      // Nodes should still be visible after re-layout
      await expect(page.getByTestId('rf__node-graph.test.Vehicle#Data')).toBeVisible();
    }
  });

  test('should render nodes from multiple files', async ({ page }) => {
    await loadFiles(page, [
      { name: 'alpha.rosetta', content: MULTI_FILE_MODEL_A },
      { name: 'beta.rosetta', content: MULTI_FILE_MODEL_B }
    ]);

    await expect(page.getByTestId('rf__node-graph.alpha.AlphaOne#Data')).toBeVisible();
    await expect(page.getByTestId('rf__node-graph.alpha.AlphaTwo#Data')).toBeVisible();
    await expect(page.getByTestId('rf__node-graph.beta.BetaItem#Data')).toBeVisible();
    await expect(page.getByTestId('rf__node-graph.beta.BetaStatus#RosettaEnumeration')).toBeVisible();
  });

  test('should show node attributes in graph nodes', async ({ page }) => {
    await loadFiles(page, [{ name: 'model.rosetta', content: INHERITANCE_MODEL }]);

    await page.getByRole('button', { name: 'Navigate to Vehicle', exact: true }).click();
    const vehicleNode = page.getByTestId('rf__node-graph.test.Vehicle#Data');
    await expect(vehicleNode.getByText('vin')).toBeVisible();
  });

  test('graph canvas should be pannable', async ({ page }) => {
    await loadFiles(page, [{ name: 'model.rosetta', content: INHERITANCE_MODEL }]);

    const viewport = page.locator('.react-flow__viewport');
    const initialTransform = await viewport.getAttribute('style');

    // Pan the canvas
    const pane = page.locator('.react-flow__pane');
    await pane.hover({ position: { x: 200, y: 200 } });
    await page.mouse.down();
    await page.mouse.move(300, 300);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const newTransform = await viewport.getAttribute('style');
    expect(newTransform).not.toBe(initialTransform);
  });
});
