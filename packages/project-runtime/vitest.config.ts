// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.ts'] } });
