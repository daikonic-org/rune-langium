// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, type Page } from '@playwright/test';

/** The full accessible workspace name must fit on one line without overlapping header actions. */
export async function expectWorkspaceHeaderBounds(page: Page) {
  const header = page.getByTestId('app-header');
  await expect(header).toHaveCount(1);
  const switcher = header.getByRole('button', { name: /^Workspace menu/ });
  await expect(switcher).toBeVisible();
  await expect(switcher.locator('.studio-topbar__ws-name')).toBeVisible();
  await expect
    .poll(() =>
      switcher.evaluate((button) => {
        const bounds = button.getBoundingClientRect();
        const label = button.querySelector('.studio-topbar__ws-name')!;
        const labelBounds = label.getBoundingClientRect();
        const right = button.closest('header')!.querySelector('.studio-topbar__right')!.getBoundingClientRect();
        const childrenFit = [...button.children].every((child) => {
          const box = child.getBoundingClientRect();
          return (
            box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom
          );
        });
        return (
          bounds.right <= right.left &&
          labelBounds.top >= bounds.top &&
          labelBounds.bottom <= bounds.bottom &&
          childrenFit
        );
      })
    )
    .toBe(true);
  await expect(switcher.locator('.studio-topbar__ws-name')).toHaveCSS('white-space', 'nowrap');
  await expect(switcher).toHaveCSS('height', '28px');
}
