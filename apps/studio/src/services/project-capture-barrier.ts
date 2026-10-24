// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import type { ProjectRuntimeState } from '../shell/providers/project-context.js';
import type { ProjectRuntimeInput } from './project-runtime-input.js';
import { withInstrumentation } from './instrumentation/core.js';
/** Wait for a specific saved revision; render and worker adoption remain separate barriers. */
export const createProjectCaptureBarrier = withInstrumentation(
  function createProjectCaptureBarrier() {
    let workspaceId: string | undefined;
    let current: ProjectRuntimeState | undefined;
    type Waiter = {
      revision?: string;
      baseline?: ProjectRuntimeInput;
      resolve(input: ProjectRuntimeInput | undefined): void;
      reject(error: Error): void;
    };
    const waiters = new Set<Waiter>();
    function settle(waiter: Waiter) {
      if (
        current?.status === 'captured' &&
        current.input &&
        (waiter.revision === undefined || current.input.snapshot.revision === waiter.revision)
      ) {
        waiters.delete(waiter);
        waiter.resolve(current.input);
      } else if (current?.status === 'legacy' && waiter.revision === undefined) {
        waiters.delete(waiter);
        waiter.resolve(undefined);
      } else if (current?.status === 'unavailable' || current?.status === 'legacy') {
        waiters.delete(waiter);
        waiter.reject(
          new Error(
            current.diagnostics.map((issue) => issue.message).join('\n') || 'Managed project capture is unavailable.'
          )
        );
      } else if (current?.status === 'captured' && current.input !== waiter.baseline) {
        waiters.delete(waiter);
        waiter.reject(new Error('Project source changed while waiting for its saved revision.'));
      }
    }
    function wait(revision: string, signal: AbortSignal): Promise<ProjectRuntimeInput>;
    function wait(revision: undefined, signal: AbortSignal): Promise<ProjectRuntimeInput | undefined>;
    function wait(revision: string | undefined, signal: AbortSignal): Promise<ProjectRuntimeInput | undefined> {
      if (signal.aborted) return Promise.reject(new DOMException('Project capture was cancelled.', 'AbortError'));
      return new Promise((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          waiters.delete(waiter);
        };
        const waiter: Waiter = {
          revision,
          baseline: current?.input,
          resolve(input) {
            cleanup();
            resolve(input);
          },
          reject(error) {
            cleanup();
            reject(error);
          }
        };
        const abort = () => waiter.reject(new DOMException('Project capture was cancelled.', 'AbortError'));
        const timer = setTimeout(
          () =>
            waiter.reject(
              new Error('Timed out waiting for the current project capture. Retry after loading completes.')
            ),
          30_000
        );
        signal.addEventListener('abort', abort, { once: true });
        waiters.add(waiter);
        settle(waiter);
      });
    }
    return {
      update(nextWorkspaceId: string | undefined, runtime: ProjectRuntimeState | undefined) {
        if (nextWorkspaceId !== workspaceId) {
          for (const waiter of waiters)
            waiter.reject(new Error('Workspace changed while waiting for its project capture.'));
          waiters.clear();
        }
        workspaceId = nextWorkspaceId;
        current = runtime;
        for (const waiter of waiters) settle(waiter);
      },
      wait,
      waitCurrent: (signal: AbortSignal) => wait(undefined, signal),
      reset() {
        for (const waiter of waiters) waiter.reject(new Error('Project capture owner was detached.'));
        waiters.clear();
      }
    };
  },
  { op: 'createProjectCaptureBarrier', capture: 0 }
);
