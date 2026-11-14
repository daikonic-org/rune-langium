// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { defineConfig } from 'vitest/config';
import { workspaceTestCache } from '../../test/helpers/vitest-cache.js';

export default defineConfig({
  test: {
    fsModuleCachePath: workspaceTestCache(import.meta.url),
    environment: 'node',
    include: ['test/**/*.test.{ts,mjs}']
  }
});
