// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { WorkspaceFile } from './workspace.js';
import { allocateOpId } from './op-log.js';
import { recordPerf, recordPerfStart } from './perf-log.js';
import { withInstrumentation } from './instrumentation/core.js';

export const WORKSPACE_EDIT_SETTLE_MS = 1800;
export const WORKSPACE_SAVE_DEADLINE_MS = 6000;

export type WorkspaceSaveState = 'pending' | 'saving' | 'saved' | 'error';

export const createWorkspaceAutosave = withInstrumentation(
  function createWorkspaceAutosave(
    save: (workspaceId: string, files: readonly WorkspaceFile[]) => Promise<void>,
    onError: (error: unknown) => void,
    onState?: (workspaceId: string, state: WorkspaceSaveState) => void
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
    let enabled = true;

    function cancelTimer(workspaceId: string) {
      const entry = pending.get(workspaceId);
      if (!entry) return;
      clearTimeout(entry.trailing);
      clearTimeout(entry.deadline);
      pending.delete(workspaceId);
    }

    function scheduleTimer(workspaceId: string) {
      const existing = pending.get(workspaceId);
      if (existing) {
        clearTimeout(existing.trailing);
        existing.trailing = setTimeout(() => persist(workspaceId), WORKSPACE_EDIT_SETTLE_MS);
      } else {
        pending.set(workspaceId, {
          trailing: setTimeout(() => persist(workspaceId), WORKSPACE_EDIT_SETTLE_MS),
          deadline: setTimeout(() => persist(workspaceId), WORKSPACE_SAVE_DEADLINE_MS)
        });
      }
    }

    function persist(workspaceId: string): void {
      const files = unsaved.get(workspaceId);
      cancelTimer(workspaceId);
      if (!files) return;
      const opId = allocateOpId();
      recordPerfStart('workspaceSave', opId);
      const startedAt = performance.now();
      onState?.(workspaceId, 'saving');
      const operation = Promise.resolve()
        .then(() => save(workspaceId, files))
        .then(
          () => {
            if (unsaved.get(workspaceId) === files) unsaved.delete(workspaceId);
            onState?.(workspaceId, unsaved.has(workspaceId) ? 'pending' : 'saved');
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
            onState?.(workspaceId, 'error');
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
      get enabled() {
        return enabled;
      },
      hasUnsaved(): boolean {
        return unsaved.size > 0;
      },
      setEnabled(value: boolean): void {
        if (enabled === value) return;
        enabled = value;
        if (enabled) {
          for (const workspaceId of unsaved.keys()) scheduleTimer(workspaceId);
        } else {
          for (const workspaceId of pending.keys()) cancelTimer(workspaceId);
        }
      },
      schedule(workspaceId: string, files: readonly WorkspaceFile[]): void {
        unsaved.set(workspaceId, files);
        onState?.(workspaceId, 'pending');
        if (enabled) scheduleTimer(workspaceId);
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
