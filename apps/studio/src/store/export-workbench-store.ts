// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { create } from 'zustand';
import type { GeneratorDiagnostic, Target } from '@rune-langium/codegen/export';
import {
  prepareBuildConfigSave,
  projectFileRevision,
  projectSourcePaths,
  normalizeProjectPath,
  projectDiagnosticsForTargets,
  type ProjectSnapshot,
  type BuildTarget,
  type ProjectDiagnostic
} from '@rune-langium/project-config';
import type { ProjectController } from '../workspace/project-controller.js';
import {
  exportTargetKey,
  exportInputKey,
  generateExport,
  type ExportConfig,
  type ExportInput
} from '../services/export-request.js';
import { combineExportArtifacts } from '../services/export-artifact.js';
import { assertExportProjectReceipt } from '../services/export-artifact.js';
import { projectTargetNamespaces } from '@rune-langium/project-runtime/browser';
import { namespaceFromSource } from '@rune-langium/core';
import type { ExportArtifact } from '../services/export-artifact.js';
import { withInstrumentation } from '../services/instrumentation/core.js';
import { readWorkbenchSettings, writeWorkbenchSettings } from '../shell/workbench-settings.js';
import { createActivationGuard } from './activation-guard.js';

type CapturedExport = { inputKey: string; artifact: ExportArtifact };

export type ExportRunState =
  | { status: 'idle' }
  | { status: 'generating'; requestId: string; previous?: CapturedExport }
  | ({ status: 'ready' | 'stale' } & CapturedExport)
  | { status: 'failed'; message: string; diagnostics: GeneratorDiagnostic[]; previous?: CapturedExport };

type GenerateExport = (input: ExportInput, signal: AbortSignal) => Promise<ExportArtifact>;

/** Durable preferences. Generated artifacts and source stay in memory only. */
export interface ExportWorkbenchPreferences {
  config: ExportConfig;
  activeFile: string | undefined;
  nativeLayout?: unknown;
  selectedTargetName?: string;
}

export interface ExportWorkbenchState {
  workspaceId: string | undefined;
  config: ExportConfig;
  activeFile: string | undefined;
  nativeLayout?: unknown;
  selectedTargetName: string | undefined;
  projectSnapshot: ProjectSnapshot | undefined;
  projectDiagnostics: readonly ProjectDiagnostic[];
  targetDirty: boolean;
  bindProject(controller: ProjectController | undefined, modelName?: string): () => void;
  selectTarget(name: string | undefined): void;
  saveTarget(name: string, draft: ExportConfig): Promise<ProjectSnapshot>;
  run: ExportRunState;
  activate(workspaceId: string): Promise<void>;
  configure(config: ExportConfig): void;
  setActiveFile(path: string | undefined): void;
  setNativeLayout(layout: unknown): void;
  invalidate(sourceRevision: number): void;
  generate(input: ExportInput): Promise<void>;
  buildTargets(targets: readonly string[] | 'all', input: ExportInput): Promise<void>;
  cancel(): void;
}

const DEFAULT_CONFIG: ExportConfig = {
  target: 'typescript' as Target,
  selection: { namespaces: [], declarations: [] },
  options: {}
};

const DEFAULT_PREFERENCES: ExportWorkbenchPreferences = {
  config: DEFAULT_CONFIG,
  activeFile: undefined
};

function cloneConfig(config: ExportConfig): ExportConfig {
  return structuredClone(config);
}

function namedTarget(snapshot: ProjectSnapshot | undefined, name: string | undefined): BuildTarget | undefined {
  const targets = snapshot?.project.build.targets;
  return targets && name && Object.prototype.hasOwnProperty.call(targets, name) ? targets[name] : undefined;
}
function configForTarget(config: ExportConfig, target: BuildTarget): ExportConfig {
  return {
    ...config,
    target: target.generator as Target,
    options: { [target.generator]: structuredClone(target.options) }
  };
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function errorDiagnostics(error: unknown): GeneratorDiagnostic[] {
  if (!error || typeof error !== 'object' || !('diagnostics' in error)) return [];
  const diagnostics = (error as { diagnostics?: unknown }).diagnostics;
  return Array.isArray(diagnostics) ? (diagnostics as GeneratorDiagnostic[]) : [];
}

function capturedExport(run: ExportRunState): CapturedExport | undefined {
  if (run.status === 'ready' || run.status === 'stale') return { inputKey: run.inputKey, artifact: run.artifact };
  if (run.status === 'generating' || run.status === 'failed') return run.previous;
  return undefined;
}

/** Create export state with an injected generator so races are independently testable. */
export const createExportWorkbench = withInstrumentation(
  function createExportWorkbench(generateExportArtifact: GenerateExport = generateExport) {
    let active: { requestId: string; controller: AbortController } | undefined;
    let sequence = 0;
    let projectController: ProjectController | undefined;
    let unbind: (() => void) | undefined;
    let modelName = 'Workspace';
    const activation = createActivationGuard();
    const cancelActive = () => {
      active?.controller.abort();
      active = undefined;
    };
    const persist = (
      state: Pick<ExportWorkbenchState, 'workspaceId' | 'config' | 'activeFile' | 'nativeLayout' | 'selectedTargetName'>
    ) => {
      if (!state.workspaceId) return;
      void writeWorkbenchSettings(state.workspaceId, 'export-workbench', {
        config: state.config,
        activeFile: state.activeFile,
        ...(state.selectedTargetName ? { selectedTargetName: state.selectedTargetName } : {}),
        nativeLayout: state.nativeLayout
      });
    };
    return create<ExportWorkbenchState>((set, get) => ({
      workspaceId: undefined,
      selectedTargetName: undefined,
      projectSnapshot: undefined,
      projectDiagnostics: [],
      targetDirty: false,
      config: DEFAULT_CONFIG,
      activeFile: undefined,
      run: { status: 'idle' },
      bindProject(controller, name) {
        unbind?.();
        projectController = controller;
        modelName = name ?? 'Workspace';
        const sync = () => {
          const state = get();
          const snapshot = controller?.current();
          const diagnostics = controller?.diagnostics() ?? [];
          if (
            snapshot?.revision !== state.projectSnapshot?.revision ||
            projectDiagnosticsForTargets(diagnostics).some((issue) => issue.severity === 'error')
          )
            state.invalidate(++sequence);
          set({ projectSnapshot: snapshot, projectDiagnostics: diagnostics });
          if (state.selectedTargetName && !state.targetDirty) get().selectTarget(state.selectedTargetName);
        };
        sync();
        const off = controller?.subscribe(sync);
        unbind = off;
        return () => {
          off?.();
          if (projectController === controller) {
            projectController = undefined;
            unbind = undefined;
            set({ projectSnapshot: undefined, projectDiagnostics: [] });
          }
        };
      },
      selectTarget(name) {
        const state = get();
        const target = namedTarget(state.projectSnapshot, name);
        if (name && !target && state.projectSnapshot) name = undefined;
        const config = target ? configForTarget(state.config, target) : state.config;
        if (exportTargetKey(config) !== exportTargetKey(state.config)) state.configure(config);
        set({ selectedTargetName: name, targetDirty: false, config });
        persist(get());
      },
      async saveTarget(name, draft) {
        const controller = projectController;
        const initial = get().projectSnapshot;
        const configured = initial && (initial.files.has('build-config.yml') || initial.files.has('build-config.yaml'));
        const snapshot = configured ? initial : await controller?.load();
        if (
          !configured &&
          snapshot &&
          (snapshot.files.has('build-config.yml') || snapshot.files.has('build-config.yaml'))
        )
          throw new Error('Build configuration appeared while editing. Reload project files before saving.');
        if (controller !== projectController) throw new Error('Project activation changed.');
        if (!controller || !snapshot || !name.trim())
          throw new Error('Open a writable project and name the target before saving.');
        if (projectDiagnosticsForTargets(get().projectDiagnostics).some((issue) => issue.severity === 'error'))
          throw new Error('Repair project configuration before saving target settings.');
        const build = structuredClone(snapshot.project.build);
        if (
          !snapshot.files.has('build-config.yml') &&
          !snapshot.files.has('build-config.yaml') &&
          !projectSourcePaths(snapshot.files, build.sources).length
        )
          build.sources = [...snapshot.files.keys()].filter((path) => path.endsWith('.rosetta'));
        const previous = namedTarget(snapshot, name);
        build.targets = {
          ...build.targets,
          [name]: {
            ...previous,
            generator: draft.target,
            options: structuredClone((draft.options[draft.target] as Record<string, unknown>) ?? {}),
            output: previous?.output ?? 'generated/' + name
          }
        };
        const revisions = new Map<string, string>();
        for (const [path, text] of snapshot.files)
          if (path === 'build-config.yml' || path === 'build-config.yaml')
            revisions.set(path, await projectFileRevision(text));
        const prepared = prepareBuildConfigSave({ files: snapshot.files, revisions, build, modelName });
        if (prepared.diagnostics.some((issue) => issue.severity === 'error'))
          throw new Error(prepared.diagnostics[0]?.message);
        const saved = await controller.save(prepared.writes);
        if (projectController === controller) {
          set({ projectSnapshot: saved });
          get().selectTarget(name);
        }
        return saved;
      },
      async activate(workspaceId) {
        const generation = activation.begin();
        cancelActive();
        set({
          workspaceId,
          selectedTargetName: undefined,
          targetDirty: false,
          config: cloneConfig(DEFAULT_CONFIG),
          activeFile: undefined,
          nativeLayout: undefined,
          run: { status: 'idle' }
        });
        const restored = await readWorkbenchSettings(workspaceId, 'export-workbench', DEFAULT_PREFERENCES);
        if (activation.isCurrent(generation) && get().workspaceId === workspaceId) {
          set({
            config: cloneConfig(restored.config ?? DEFAULT_CONFIG),
            activeFile: restored.activeFile,
            nativeLayout: restored.nativeLayout,
            run: { status: 'idle' }
          });
          if (restored.selectedTargetName) get().selectTarget(restored.selectedTargetName);
        }
      },
      configure(config) {
        activation.invalidate();
        cancelActive();
        const nextConfig = cloneConfig(config);
        set((state) => {
          const previous = capturedExport(state.run);
          return {
            config: nextConfig,
            targetDirty:
              Boolean(namedTarget(state.projectSnapshot, state.selectedTargetName)) &&
              exportTargetKey(nextConfig) !==
                exportTargetKey(
                  configForTarget(nextConfig, namedTarget(state.projectSnapshot, state.selectedTargetName)!)
                ),
            run: previous ? { status: 'stale', ...previous } : { status: 'idle' }
          };
        });
        persist({ ...get(), config: nextConfig });
      },
      setActiveFile(activeFile) {
        activation.invalidate();
        set({ activeFile });
        persist({ ...get(), activeFile });
      },
      setNativeLayout(nativeLayout) {
        activation.invalidate();
        set({ nativeLayout });
        persist({ ...get(), nativeLayout });
      },
      invalidate(sourceRevision) {
        cancelActive();
        set((state) => {
          const previous = capturedExport(state.run);
          if (!previous) return { run: { status: 'idle' } };
          return {
            run: { status: 'stale', inputKey: `${previous.inputKey}:${sourceRevision}`, artifact: previous.artifact }
          };
        });
      },
      async generate(input) {
        activation.invalidate();
        const previous = capturedExport(get().run);
        cancelActive();
        const controller = new AbortController();
        const requestId = `export:${++sequence}`;
        const config = cloneConfig(input.config);
        const ownedInput = { ...input, config };
        const inputKey = exportInputKey(ownedInput);
        active = { requestId, controller };
        set({ config, run: { status: 'generating', requestId, ...(previous ? { previous } : {}) } });
        persist({ ...get(), config });
        try {
          const artifact = await generateExportArtifact(ownedInput, controller.signal);
          if (active?.requestId !== requestId) return;
          set({ run: { status: 'ready', inputKey, artifact } });
        } catch (error) {
          if (active?.requestId !== requestId || isAbort(error)) return;
          set({
            run: {
              status: 'failed',
              message: error instanceof Error ? error.message : String(error),
              diagnostics: errorDiagnostics(error),
              ...(previous ? { previous } : {})
            }
          });
        } finally {
          if (active?.requestId === requestId) active = undefined;
        }
      },
      async buildTargets(targets, input) {
        const controller = projectController;
        const snapshot = get().projectSnapshot;
        if (!controller || !snapshot) return;
        cancelActive();
        const abort = new AbortController();
        const requestId = 'build:' + ++sequence;
        const previous = capturedExport(get().run);
        active = { requestId, controller: abort };
        const ownedInput = { ...input, projectRevision: snapshot.revision, projectBuild: true };
        set({ run: { status: 'generating', requestId, ...(previous ? { previous } : {}) } });
        const artifacts: { output: string; artifact: ExportArtifact }[] = [];
        try {
          if (input.projectUnavailable) throw new Error(input.projectUnavailable);
          const result = await controller.build(
            snapshot,
            { targets, signal: abort.signal, projectReceipt: input.project?.receipt },
            async (captured, target) => {
              const paths = projectSourcePaths(captured.files, captured.project.build.sources);
              if (!paths.length) throw new Error('No .rosetta sources match the configured source patterns.');
              const files = paths.map((path) => ({
                path,
                name: path.split('/').pop()!,
                content: captured.files.get(path)!,
                dirty: false
              }));
              const namespaces = input.project
                ? []
                : projectTargetNamespaces(
                    captured,
                    target,
                    new Set(files.map((file) => namespaceFromSource(file.content)).filter(Boolean))
                  );
              const artifact = await generateExportArtifact(
                {
                  ...ownedInput,
                  files,
                  ...(input.project ? { projectTarget: target } : {}),
                  config: {
                    target: target.generator as Target,
                    selection: { namespaces, declarations: [] },
                    options: { [target.generator]: target.options }
                  }
                },
                abort.signal
              );
              assertExportProjectReceipt(artifact, input.project?.receipt);
              const fatal = artifact.manifest.diagnostics.filter((issue) => issue.severity === 'error');
              if (fatal.length) throw Object.assign(new Error(fatal[0]!.message), { diagnostics: fatal });
              artifacts.push({ output: normalizeProjectPath(target.output)!, artifact });
              return Promise.all(
                artifact.manifest.files.map(async (file) => ({
                  relativePath: file.path,
                  content: file.kind === 'text' ? await artifact.readText(file.path) : '',
                  ...(file.kind === 'binary'
                    ? {
                        binary: await (artifact.readBytes
                          ? artifact.readBytes(file.path)
                          : Promise.reject(new Error('Binary export bytes unavailable.')))
                      }
                    : {}),
                  diagnostics: artifact.manifest.files[0] === file ? artifact.manifest.diagnostics : []
                }))
              );
            }
          );
          if (result.status !== 'success')
            throw Object.assign(
              new Error(
                (result.diagnostics[0]?.message ?? 'Build failed') +
                  (result.outputs.length ? ' Output written before failure: ' + result.outputs.join(', ') : '')
              ),
              {
                diagnostics: result.diagnostics
              }
            );
          const artifact = await combineExportArtifacts(artifacts);
          if (active?.requestId === requestId)
            set({ run: { status: 'ready', inputKey: exportInputKey(ownedInput), artifact } });
        } catch (error) {
          if (active?.requestId === requestId && !isAbort(error))
            set({
              run: {
                status: 'failed',
                message: error instanceof Error ? error.message : String(error),
                diagnostics: errorDiagnostics(error),
                ...(previous ? { previous } : {})
              }
            });
        } finally {
          if (active?.requestId === requestId) active = undefined;
        }
      },
      cancel() {
        cancelActive();
        const run = get().run;
        if (run.status === 'generating') {
          set({ run: run.previous ? { status: 'stale', ...run.previous } : { status: 'idle' } });
        }
      }
    }));
  },
  { op: 'createExportWorkbench' }
);

export const useExportWorkbenchStore = createExportWorkbench();
