// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { workspaceTestCache } from '../../test/helpers/vitest-cache.js';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fsModuleCachePath: workspaceTestCache(import.meta.url),
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**'],
    testTimeout: 30_000
  }
});
