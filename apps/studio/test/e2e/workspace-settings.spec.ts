// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test } from '@playwright/test';
import { checkWorkspaceSettings } from '../helpers/workspace-settings.js';

for (const theme of ['daikonic', 'light'])
  test(`workspace configuration saves real YAML and navigates to owned settings (${theme})`, async ({ page }, info) => {
    await checkWorkspaceSettings(page, theme, {
      checkpoint: async (name) => {
        await page.screenshot({ path: info.outputPath(`${name}.png`) });
      }
    });
  });
