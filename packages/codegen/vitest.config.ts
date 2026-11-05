// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { workspaceTestCache } from '../../test/helpers/vitest-cache.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../test/helpers/vitest-budget.js';
import { defineConfig } from 'vitest/config';
import { decoratorLoweringPlugin } from './vitest-decorator-plugin.js';

export default defineConfig({
  plugins: [decoratorLoweringPlugin()],
  test: {
    fsModuleCachePath: workspaceTestCache(import.meta.url),
    globals: true,
    environment: 'node',
    testTimeout: GENERATED_MODULE_TEST_TIMEOUT,
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**']
  }
});
