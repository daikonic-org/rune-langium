// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { defineConfig } from '@playwright/test';

/** Merges the sanitized blob reports produced by the candidate CI shards. */
export default defineConfig({
  reporter: [
    ['json', { outputFile: process.env.STUDIO_CANDIDATE_MERGED_JSON }],
    ['html', { outputFolder: process.env.STUDIO_CANDIDATE_MERGED_HTML, open: 'never' }]
  ]
});
