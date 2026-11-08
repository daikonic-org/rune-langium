// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { workspaceTestCache } from '../../test/helpers/vitest-cache.js';
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  test: {
    fsModuleCachePath: workspaceTestCache(import.meta.url),
    globals: true,
    environment: 'jsdom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      ...(process.env.RUNE_CI_RENAME_GUARD_SEPARATE === '1' ? ['test/store/rename-cascade.test.ts'] : [])
    ],
    setupFiles: ['./test/setup.ts']
  }
});
