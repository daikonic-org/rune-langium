// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { Buffer } from 'node:buffer';
import { expect, type Locator, type Page } from '@playwright/test';
import { referenceFiles } from '../../../../packages/codegen/test/helpers/cdm-reference.js';
import { typeNavigationButton } from './type-navigation.js';

/** Dismiss only expected notices from the hermetic server's absent Worker routes. */
export async function dismissLocalTransportNotices(page: Page) {
  const notices = page
    .locator('[data-slot="toast"]')
    .filter({ hasText: /Pages Function LSP unreachable|Server-side parsing unavailable/ });
  while (await notices.count()) {
    // A new notice may arrive during the close animation; wait on this root's identity, not a global count.
    const notice = await notices.first().elementHandle();
    if (!notice) continue;
    try {
      const close = await notice.$('[data-slot="toast-close"]');
      try {
        if (!close) throw new Error('Transport notice has no dismiss control.');
        await close.click();
      } catch (error) {
        // An expiring toast can detach while Playwright waits for its close button to stabilize.
        if (await notice.evaluate((element) => element.isConnected)) throw error;
      }
      await expect.poll(() => notice.evaluate((element) => element.isConnected)).toBe(false);
    } finally {
      await notice.dispose();
    }
  }
}

export async function expectCenterPaneBounds(page: Page) {
  const center = page.getByTestId('center-stack');
  const bounds = (await center.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  for (const pane of await center.locator('[data-pane]').all()) {
    const box = (await pane.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  }
  const toolbar = page.getByTestId('studio-paneswitch');
  const toolbarBounds = (await toolbar.boundingBox())!;
  for (const button of await toolbar.getByRole('button').all()) {
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(toolbarBounds.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(toolbarBounds.x + toolbarBounds.width + 1);
  }
}

export async function loadPinnedFunction(page: Page) {
  await page.goto('./');
  await page.locator('input[type="file"][accept=".rosetta"]').setInputFiles(
    referenceFiles().map(({ uri, content }) => ({
      name: uri.split('/').at(-1)!,
      mimeType: 'text/plain',
      buffer: Buffer.from(content)
    }))
  );
  await expect(page.getByTestId('explore-workbench')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('namespace-search').fill('Abs');
  await typeNavigationButton(page, 'cdm.base.math.Abs', 'RosettaFunction').click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  // Local LSP/router notices are dismissible; they must not trap keyboard focus during editing.
  await dismissLocalTransportNotices(page);
  await expect(page.getByTestId('implementation-editor')).toBeVisible();
}

export async function openComposeExpression(page: Page) {
  await dismissLocalTransportNotices(page);
  const composer = page.getByTestId('function-composer');
  if (!(await composer.isVisible())) {
    await page
      .getByRole('region', { name: 'Function implementation' })
      .getByRole('button', { name: 'Open in Compose', exact: true })
      .click();
  }
  const row = composer.getByTestId('expression-row-operation-0');
  await expect(row).toBeVisible();
  return row;
}

export async function openInlineRuneDraft(page: Page, row: Locator) {
  await row.getByRole('button', { name: 'Expression actions', exact: true }).click();
  await page.getByRole('option', { name: 'Edit Rune', exact: true }).click();
  const draft = row.getByTestId('inline-rune-draft');
  await expect(draft).toBeVisible();
  return draft;
}

export async function enlargeExpressionText(page: Page, expression: Locator) {
  const cancel = expression.getByRole('button', { name: 'Expression actions', exact: true });
  const originalSize = await cancel.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await page.evaluate(() => {
    const root = document.documentElement;
    root.style.fontSize = `${parseFloat(getComputedStyle(root).fontSize) * 1.25}px`;
  });
  await expect
    .poll(() => cancel.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)))
    .toBeGreaterThanOrEqual(originalSize * 1.25);
}
