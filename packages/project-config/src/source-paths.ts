// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import picomatch from 'picomatch';
import { normalizeProjectPath } from './output-paths.js';
import type { ProjectFiles } from './types.js';

/** Shared source identity for browser snapshots and native builds. */
export function projectSourcePaths(files: ProjectFiles, patterns: readonly string[]): string[] {
  const matchers = patterns.map((pattern) => {
    const normalized = normalizeProjectPath(pattern);
    if (!normalized || normalized.startsWith('!'))
      throw new Error('Source patterns must be relative positive globs: ' + pattern);
    return picomatch(normalized, { windows: false, dot: true });
  });
  return [...files.keys()].filter((path) => path.endsWith('.rosetta') && matchers.some((match) => match(path)));
}
