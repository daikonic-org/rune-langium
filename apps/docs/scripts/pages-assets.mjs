// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { cpSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export const PAGES_ASSET_LIMIT = 25 * 1024 * 1024;

const isSourceMap = (path) => path.endsWith('.map');

/** Copy public assets while retaining source maps only in the original build. */
export function copyPagesAssets(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, filter: (path) => !isSourceMap(path) });
}

/** Validate the complete static output before Cloudflare attempts publication. */
export function validatePagesAssets(root) {
  let largest = null;
  const directories = [root];
  while (directories.length) {
    const directory = directories.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        directories.push(path);
        continue;
      }
      const name = relative(root, path);
      if (isSourceMap(path)) {
        throw new Error(`[build-combined] source map in public Pages output: ${name}`);
      }
      const { size } = statSync(path);
      if (size > PAGES_ASSET_LIMIT) {
        throw new Error(`[build-combined] Pages asset exceeds 25 MiB: ${name} (${size} bytes)`);
      }
      if (!largest || size > largest.size) largest = { path: name, size };
    }
  }
  return largest;
}
