// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { REPORT_DIR } from './evidence.js';

/**
 * Runs once in Playwright's main orchestrator process before any worker
 * starts. Worker processes restart on retry (even with workers: 1) but
 * globalSetup does not re-run, so this is the only place a single
 * "reset the manifest once per run" can live — a module-scope flag inside
 * a worker cannot survive a retry's fresh process.
 */
export default async function globalSetup(): Promise<void> {
  const reportDir = REPORT_DIR;
  await mkdir(reportDir, { recursive: true });
  await copyFile(new URL('./known-issues.json', import.meta.url), path.join(reportDir, 'known-issues.json'));
  const manifestPath = path.join(reportDir, 'run-manifest.json');
  await rm(manifestPath, { force: true });
  await rm(path.join(reportDir, 'axe', 'J17'), { recursive: true, force: true });
}
