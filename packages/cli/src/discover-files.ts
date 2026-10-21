// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readdir, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

/**
 * Discover `.rosetta` files from a list of file/directory paths.
 */
export async function discoverFiles(paths: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const p of paths) {
    const resolved = resolve(p);
    const s = await stat(resolved);
    if (s.isDirectory()) {
      const entries = await readdir(resolved, { recursive: true });
      for (const entry of entries) {
        if (extname(entry) === '.rosetta') {
          files.push(resolve(resolved, entry));
        }
      }
    } else if (extname(resolved) === '.rosetta') {
      files.push(resolved);
    }
  }
  return files;
}
