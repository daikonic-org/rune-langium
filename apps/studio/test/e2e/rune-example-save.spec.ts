// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { test } from '@playwright/test';
import { checkRuneJsonMetadata, checkRuneJsonChoice } from '../helpers/rune-example-save.js';

for (const [name, run] of [
  ['renames and reopens Rune JSON without losing metadata or headers', checkRuneJsonMetadata],
  ['reopens a wire Choice before seeding workflow inputs', checkRuneJsonChoice]
] as const)
  test(name, async ({ page }, info) => {
    await run(page, {
      checkpoint: async (name) => {
        await page.screenshot({ path: info.outputPath(`${name}.png`) });
      }
    });
  });
