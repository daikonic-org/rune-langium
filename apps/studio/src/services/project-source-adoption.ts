// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { projectSourcePaths, type ProjectSnapshot } from '@rune-langium/project-config';
import type { WorkspaceFile } from './workspace.js';
import { withInstrumentation } from './instrumentation/core.js';
/** Adopt explicit saved source writes while preserving every live editor change. */
export const adoptSavedProjectSources = withInstrumentation(
  function adoptSavedProjectSources(
    previous: ProjectSnapshot,
    next: ProjectSnapshot,
    files: readonly WorkspaceFile[]
  ): readonly WorkspaceFile[] {
    const result = new Map(files.map((file) => [file.path, file]));
    const paths = new Set([
      ...projectSourcePaths(previous.files, previous.project.build.sources),
      ...projectSourcePaths(next.files, next.project.build.sources)
    ]);
    let changed = false;
    for (const path of paths) {
      const before = previous.files.get(path),
        after = next.files.get(path),
        live = result.get(path);
      if (before === after) continue;
      if (before !== undefined && !live) continue;
      if (live && (live.readOnly || live.refOnly || live.content !== before)) continue;
      if (after === undefined) {
        if (live) {
          result.delete(path);
          changed = true;
        }
      } else if (!live || before !== after) {
        result.set(path, { ...live, path, name: live?.name ?? path.split('/').at(-1)!, content: after, dirty: false });
        changed = true;
      }
    }
    return changed ? [...result.values()] : files;
  },
  { op: 'adoptSavedProjectSources', capture: 0 }
);
