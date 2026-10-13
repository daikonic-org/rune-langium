// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { Page } from '@playwright/test';

/** The complete file editor, excluding embedded Inspector expression editors. */
export function fullSourceEditor(page: Page) {
  return page.getByTestId('center-stack').locator('[data-pane="source"]').getByTestId('source-editor');
}
