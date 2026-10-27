// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

export interface JourneyObserver {
  checkpoint?(name: string): Promise<void>;
  beforeReload?(): Promise<void>;
  afterReload?(): void;
}
export async function reloadJourney(page: import('@playwright/test').Page, observer: JourneyObserver): Promise<void> {
  await observer.beforeReload?.();
  await page.reload();
  observer.afterReload?.();
}
