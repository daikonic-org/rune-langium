// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { WorkspaceFile } from './workspace.js';
import { allocateOpId } from './op-log.js';
import { recordPerf, recordPerfStart } from './perf-log.js';
import { withInstrumentation } from './instrumentation/core.js';

export const createWorkspaceAutosave = withInstrumentation(
  function createWorkspaceAutosave(
    save: (workspaceId: string, files: readonly WorkspaceFile[]) => Promise<void>,
    onError: (error: unknown) => void
  ) {
    const pending = new Map<
      string,
      {
        files: readonly WorkspaceFile[];
        trailing: ReturnType<typeof setTimeout>;
        deadline: ReturnType<typeof setTimeout>;
      }
    >();
    const running = new Set<Promise<void>>();

    function persist(workspaceId: string): void {
      const entry = pending.get(workspaceId);
      if (!entry) return;
      pending.delete(workspaceId);
      clearTimeout(entry.trailing);
      clearTimeout(entry.deadline);
      const opId = allocateOpId();
      recordPerfStart('workspaceSave', opId);
      const startedAt = performance.now();
      const operation = Promise.resolve()
        .then(() => save(workspaceId, entry.files))
        .then(
          () =>
            recordPerf({
              op: 'workspaceSave',
              ok: true,
              durationMs: performance.now() - startedAt,
              ts: performance.now(),
              opId
            }),
          (error) => {
            recordPerf({
              op: 'workspaceSave',
              ok: false,
              durationMs: performance.now() - startedAt,
              ts: performance.now(),
              opId
            });
            onError(error);
          }
        );
      running.add(operation);
      void operation.finally(() => running.delete(operation));
    }

    return {
      schedule(workspaceId: string, files: readonly WorkspaceFile[]): void {
        const existing = pending.get(workspaceId);
        if (existing) {
          existing.files = files;
          clearTimeout(existing.trailing);
          existing.trailing = setTimeout(() => persist(workspaceId), 500);
        } else {
          pending.set(workspaceId, {
            files,
            trailing: setTimeout(() => persist(workspaceId), 500),
            deadline: setTimeout(() => persist(workspaceId), 2000)
          });
        }
      },
      async flush(): Promise<void> {
        for (const workspaceId of pending.keys()) persist(workspaceId);
        await Promise.all(running);
      }
    };
  },
  { op: 'createWorkspaceAutosave' }
);
