// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import {
  createProjectSnapshot,
  readProjectSnapshot,
  readProjectFiles,
  normalizeProjectPath,
  saveProject,
  recoverProjectSave,
  ProjectFileConflict,
  ProjectSnapshotError,
  type ProjectDiagnostic,
  type ProjectFileAdapter,
  type ProjectSnapshot,
  type ProjectSavePreconditions,
  type ProjectWrite,
  type TargetValidator
} from '@rune-langium/project-config';
import {
  runProjectBuild,
  type ProjectTargetGenerator,
  type ProjectBuildResult
} from '@rune-langium/project-runtime/browser';
import { withInstrumentation } from '../services/instrumentation/core.js';
import type { EffectiveProjectReceipt } from '@rune-langium/project-runtime/receipt';

export interface ProjectController {
  load(): Promise<ProjectSnapshot>;
  current(): ProjectSnapshot | undefined;
  diagnostics(): readonly ProjectDiagnostic[];
  save(writes: readonly ProjectWrite[], preconditions?: ProjectSavePreconditions): Promise<ProjectSnapshot>;
  recover(): Promise<ProjectSnapshot>;
  build(
    snapshot: ProjectSnapshot,
    request: { targets: readonly string[] | 'all'; signal?: AbortSignal; projectReceipt?: EffectiveProjectReceipt },
    generate: ProjectTargetGenerator
  ): Promise<ProjectBuildResult>;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export const createProjectController = withInstrumentation(
  function createProjectController(input: {
    workspaceId: string;
    adapter: ProjectFileAdapter;
    validateTarget: TargetValidator;
    onSaved?: () => void;
  }): ProjectController {
    let snapshot: ProjectSnapshot | undefined;
    let diagnostics: readonly ProjectDiagnostic[] = [];
    let disposed = false;
    let generation = 0;
    let saving = false;
    const listeners = new Set<() => void>();
    const publish = () => listeners.forEach((listener) => listener());
    function active(epoch: number) {
      if (disposed || epoch !== generation) throw new Error('Project activation is no longer active');
    }
    function report(error: unknown, epoch: number): never {
      if (!disposed && epoch === generation) {
        diagnostics =
          error instanceof ProjectSnapshotError
            ? error.diagnostics
            : [
                {
                  code: error instanceof ProjectFileConflict ? 'SAVE_CONFLICT' : 'PROJECT_UNAVAILABLE',
                  severity: 'error',
                  path: error instanceof ProjectFileConflict ? error.path : '',
                  message: error instanceof Error ? error.message : 'Project is unavailable'
                }
              ];
        publish();
      }
      throw error;
    }
    async function read(epoch: number) {
      const next = await readProjectSnapshot(input);
      active(epoch);
      snapshot = next;
      diagnostics = next.project.diagnostics;
      publish();
      return next;
    }
    async function mutate(perform: (epoch: number) => Promise<void>): Promise<ProjectSnapshot> {
      if (saving) throw new Error('Project Save is still active');
      const epoch = ++generation;
      active(epoch);
      saving = true;
      try {
        await perform(epoch);
        active(epoch);
        return await read(epoch);
      } catch (error) {
        return report(error, epoch);
      } finally {
        saving = false;
      }
    }
    return {
      current: () => snapshot,
      diagnostics: () => diagnostics,
      async load() {
        if (saving) throw new Error('Project Save is still active');
        const epoch = ++generation;
        try {
          active(epoch);
          return await read(epoch);
        } catch (error) {
          return report(error, epoch);
        }
      },
      save(writes, preconditions) {
        let changed = false;
        return mutate(async (epoch) => {
          const current = await readProjectFiles(input.adapter);
          active(epoch);
          changed = writes.some((write) => current.files.get(write.path) !== write.text);
          const proposed = new Map(current.files);
          for (const write of writes) proposed.set(normalizeProjectPath(write.path) ?? write.path, write.text);
          await createProjectSnapshot(input.workspaceId, proposed, input.validateTarget);
          active(epoch);
          await current.verify();
          const result = await saveProject(input.adapter, writes, crypto.randomUUID(), preconditions);
          if (result.status !== 'saved') throw new ProjectSnapshotError(result.diagnostics);
        }).then((next) => {
          if (changed) input.onSaved?.();
          return next;
        });
      },
      async build(captured, request, generate) {
        const epoch = generation;
        active(epoch);
        const adapter = new Proxy(input.adapter, {
          get(target, key) {
            const value = Reflect.get(target, key);
            return typeof value === 'function'
              ? (...args: unknown[]) => {
                  active(epoch);
                  return value.apply(target, args);
                }
              : value;
          }
        });
        const result = await runProjectBuild(captured, request, adapter, async (...args) => {
          active(epoch);
          return generate(...args);
        });
        active(epoch);
        if (result.status === 'success') await read(epoch);
        return result;
      },
      recover() {
        return mutate(async () => {
          const issues = await recoverProjectSave(input.adapter);
          if (issues.length) throw new ProjectSnapshotError(issues);
        });
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      dispose() {
        disposed = true;
        generation++;
        listeners.clear();
      }
    };
  },
  { op: 'createProjectController' }
);
