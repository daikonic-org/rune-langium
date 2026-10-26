// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { openGitHubRepository } from '@rune-langium/project-runtime/examples';
import type { StarterProject } from './starter-registry.js';
import type { StarterSource } from '../workspace/open-starter.js';
import { withInstrumentation } from './instrumentation/core.js';
/** Reads public Git objects only; no auth cookies, tokens, recursive partial tree or symlink traversal. */
export const readStarterSource = withInstrumentation(
  async function readStarterSource(
    starter: StarterProject,
    signal: AbortSignal,
    fetcher: typeof fetch = fetch
  ): Promise<StarterSource> {
    const source = await openGitHubRepository(starter.repository, starter.ref, signal, fetcher, {
      entries: 512,
      treeBytes: 2 * 1024 * 1024
    });
    const files = new Map<string, string>();
    let total = 0;
    for (const entry of source.files) {
      signal.throwIfAborted();
      if (entry.type === 'tree') continue;
      if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode))
        throw new Error('Starter symlinks and submodules are unsupported.');
      if (entry.size === undefined || entry.size > 1024 * 1024 || total + entry.size > 8 * 1024 * 1024)
        throw new Error('The starter source exceeds its size limit.');
      const text = await source.read(entry, 1024 * 1024);
      files.set(entry.path, text);
      total += entry.size;
    }
    return { files, commit: source.commit };
  },
  {
    op: 'readStarterSource',
    capture: 0,
    sanitizeError: (error) => ({ signature: error instanceof Error ? error.name : 'Error' })
  }
);
