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
        trailing: ReturnType<typeof setTimeout>;
        deadline: ReturnType<typeof setTimeout>;
      }
    >();
    const unsaved = new Map<string, readonly WorkspaceFile[]>();
    const running = new Map<Promise<void>, string>();

    function persist(workspaceId: string): void {
      const files = unsaved.get(workspaceId);
      if (!files) return;
      const entry = pending.get(workspaceId);
      pending.delete(workspaceId);
      if (entry) {
        clearTimeout(entry.trailing);
        clearTimeout(entry.deadline);
      }
      const opId = allocateOpId();
      recordPerfStart('workspaceSave', opId);
      const startedAt = performance.now();
      const operation = Promise.resolve()
        .then(() => save(workspaceId, files))
        .then(
          () => {
            if (unsaved.get(workspaceId) === files) unsaved.delete(workspaceId);
            recordPerf({
              op: 'workspaceSave',
              ok: true,
              durationMs: performance.now() - startedAt,
              ts: performance.now(),
              opId
            });
          },
          (error) => {
            recordPerf({
              op: 'workspaceSave',
              ok: false,
              durationMs: performance.now() - startedAt,
              ts: performance.now(),
              opId
            });
            onError(error);
            throw error;
          }
        );
      running.set(operation, workspaceId);
      void operation.then(
        () => running.delete(operation),
        () => running.delete(operation)
      );
    }

    return {
      schedule(workspaceId: string, files: readonly WorkspaceFile[]): void {
        unsaved.set(workspaceId, files);
        const existing = pending.get(workspaceId);
        if (existing) {
          clearTimeout(existing.trailing);
          existing.trailing = setTimeout(() => persist(workspaceId), 500);
        } else {
          pending.set(workspaceId, {
            trailing: setTimeout(() => persist(workspaceId), 500),
            deadline: setTimeout(() => persist(workspaceId), 2000)
          });
        }
      },
      async flush(): Promise<void> {
        while (unsaved.size > 0 || running.size > 0) {
          const active = new Set(running.values());
          for (const workspaceId of unsaved.keys()) {
            if (pending.has(workspaceId) || !active.has(workspaceId)) persist(workspaceId);
          }
          await Promise.all(running.keys());
        }
      }
    };
  },
  { op: 'createWorkspaceAutosave' }
);
