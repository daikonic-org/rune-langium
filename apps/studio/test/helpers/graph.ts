// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, type Page } from '@playwright/test';

export async function captureResizeObserverErrors(page: Page) {
  await page.addInitScript(() => {
    const errors: string[] = [];
    Object.defineProperty(window, '__testResizeErrors', { value: errors });
    window.addEventListener('error', (event) => {
      if (/ResizeObserver/.test(event.message)) errors.push(event.message);
    });
  });
}

export async function expectNoResizeObserverErrors(page: Page) {
  expect(await page.evaluate(() => (window as Window & { __testResizeErrors: string[] }).__testResizeErrors)).toEqual(
    []
  );
}
