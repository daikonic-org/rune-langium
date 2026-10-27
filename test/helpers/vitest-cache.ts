// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { fileURLToPath } from 'node:url';

/** Separate pnpm package processes must not invalidate each other's module cache. */
export function workspaceTestCache(configUrl: string): string {
  return fileURLToPath(new URL('./node_modules/.vitest-cache', configUrl));
}
