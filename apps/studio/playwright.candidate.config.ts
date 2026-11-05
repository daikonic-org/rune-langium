// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { defineConfig } from '@playwright/test';
import production from './playwright.prod.config.js';

const port = Number(process.env.STUDIO_CANDIDATE_PORT ?? 5184);
process.env.PLAYWRIGHT_PROD_SMOKE = '1';
process.env.PROD_UX_DESKTOP_ONLY = '1';
process.env.PROD_UX_ASSET_ORIGIN = `http://127.0.0.1:${port}`;
process.env.PROD_UX_REPORT_DIR ??= '../../dist/ux-candidate/report';

/** Pre-merge UX gate: this checkout's optimized bundle, with public hosted APIs. */
export default defineConfig({
  ...production,
  forbidOnly: true,
  metadata: { reviewTarget: 'candidate', staticAssetOrigin: process.env.PROD_UX_ASSET_ORIGIN, backend: 'deployed' },
  globalTeardown: './test/prod-ux/candidate-teardown.ts',
  retries: 0,
  outputDir: '../../dist/ux-candidate/results',
  reporter: [
    ['list'],
    ['json', { outputFile: '../../dist/ux-candidate/playwright.json' }],
    ['html', { outputFolder: '../../dist/ux-candidate/html', open: 'never' }]
  ],
  use: { ...production.use, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 60000
  },
  projects: [
    {
      ...production.projects![0],
      name: 'candidate-journeys',
      testMatch: 'prod-ux/journeys/**/*.spec.ts',
      // A candidate is intentionally not deployed. Canonical deployment proof
      // remains in the post-deployment suite rather than blocking this gate.
      testIgnore: '**/j00-freshness.spec.ts'
    },
    {
      ...production.projects![0],
      name: 'candidate-polish',
      timeout: 30000,
      testMatch: [
        'e2e/prod-review-polish.spec.ts',
        'e2e/control-spacing.spec.ts',
        'e2e/evidence-redaction.spec.ts',
        'e2e/workbench-reading-space.spec.ts',
        'e2e/workflow-nested-validation.spec.ts',
        'e2e/export-workbench.spec.ts',
        'e2e/review-api-polish.spec.ts',
        'e2e/inspector-details.spec.ts',
        'e2e/inspector-local-declaration.spec.ts',
        'e2e/project-overrides.spec.ts',
        'e2e/native-builtin-mappings.spec.ts'
      ]
    }
  ]
});
