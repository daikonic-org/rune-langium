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
      if (!close) throw new Error('Transport notice has no dismiss control.');
      await close.click();
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

export async function openBuilder(page: Page) {
  await dismissLocalTransportNotices(page);

  await page.getByTestId('implementation-editor').locator('.cm-content').press('ControlOrMeta+End');
  await page
    .getByRole('region', { name: 'Function implementation' })
    .getByRole('button', { name: 'Builder', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Expression builder' });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate((el) =>
        el.getAnimations({ subtree: true }).every((animation) => animation.playState !== 'running')
      )
    )
    .toBe(true);
  return dialog;
}

export async function enlargeDialogText(page: Page, dialog: Locator) {
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  const originalSize = await cancel.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await page.evaluate(() => {
    const root = document.documentElement;
    root.style.fontSize = `${parseFloat(getComputedStyle(root).fontSize) * 1.25}px`;
  });
  await expect
    .poll(() => cancel.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)))
    .toBeGreaterThanOrEqual(originalSize * 1.25);
}
