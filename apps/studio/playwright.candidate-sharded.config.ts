// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { defineConfig } from '@playwright/test';
import candidate from './playwright.candidate.config.js';

/** CI shard wrapper. Local candidate runs continue to use playwright.candidate.config.ts. */
export default defineConfig({
  ...candidate,
  outputDir: process.env.STUDIO_CANDIDATE_OUTPUT_DIR ?? candidate.outputDir,
  // A shard may contain only candidate-polish tests. The aggregate gate
  // validates all journey records after it combines the isolated reports.
  globalTeardown: undefined,
  reporter: [
    ['list'],
    [
      'json',
      { outputFile: process.env.STUDIO_CANDIDATE_JSON_REPORT ?? '../../dist/ux-candidate/shard/playwright.json' }
    ],
    [
      'html',
      { outputFolder: process.env.STUDIO_CANDIDATE_HTML_REPORT ?? '../../dist/ux-candidate/shard/html', open: 'never' }
    ],
    ['blob', { outputDir: process.env.STUDIO_CANDIDATE_BLOB_REPORT_DIR ?? '../../dist/ux-candidate/shard/blob' }]
  ]
});
