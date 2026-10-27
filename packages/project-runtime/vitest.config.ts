// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { workspaceTestCache } from '../../test/helpers/vitest-cache.js';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    fsModuleCachePath: workspaceTestCache(import.meta.url),
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
});
