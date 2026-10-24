// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { CURATED_MIRROR_BASE } from '@rune-langium/curated-schema';
import {
  createReferenceTransport,
  resolveProjectReferences,
  loadLockedReferences,
  projectReferenceLockDiagnostics,
  type ReferenceTransport,
  type ReferenceCache
} from '@rune-langium/project-runtime/references';
import {
  createProjectSnapshot,
  prepareBuildConfigSave,
  projectFileRevision,
  ProjectSnapshotError,
  type ProjectSnapshot,
  type BuildConfig,
  type ProjectDiagnostic,
  type ProjectLock,
  type ProjectWrite
} from '@rune-langium/project-config';
import { validateProjectTarget } from '@rune-langium/project-runtime/browser';
import type { ProjectController } from '../workspace/project-controller.js';
import { curatedArtifactCache } from './curated-artifact-cache.js';
import { CURATED_FETCH_TIMEOUT_MS, type CuratedFetcher } from './curated-fetch.js';
import { withAbortTimeout } from './with-abort-timeout.js';
import { withInstrumentation } from './instrumentation/core.js';

export const createProjectReferenceTransport = withInstrumentation(
  function createProjectReferenceTransport(
    fetcher: CuratedFetcher = fetch,
    baseUrl = CURATED_MIRROR_BASE
  ): ReferenceTransport {
    return createReferenceTransport(
      (url, init) =>
        withAbortTimeout(
          (signal) => fetcher(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal }),
          CURATED_FETCH_TIMEOUT_MS
        ),
      baseUrl
    );
  },
  { op: 'createProjectReferenceTransport' }
);
export const projectReferenceCache: ReferenceCache = {
  get: (checksum) => curatedArtifactCache.referenceBytes(checksum),
  put: (checksum, bytes) => curatedArtifactCache.putReferenceBytes(checksum, bytes)
};

export interface PreparedReferenceChange {
  config: BuildConfig;
  lock: ProjectLock;
  diagnostics: readonly ProjectDiagnostic[];
  accept(signal: AbortSignal): Promise<ProjectSnapshot>;
}
/** Resolving verifies the entire closure without changing the active project. */
export const prepareProjectReferenceChange = withInstrumentation(
  async function prepareProjectReferenceChange(
    controller: ProjectController,
    transport: ReferenceTransport,
    cache: ReferenceCache,
    signal: AbortSignal,
    nextBuild?: BuildConfig
  ): Promise<PreparedReferenceChange> {
    nextBuild = nextBuild ? structuredClone(nextBuild) : undefined;
    const original = controller.current();
    if (!original) throw new Error('Project is not ready.');
    const writes: ProjectWrite[] = [];
    let proposed = original;
    if (nextBuild) {
      const revisions = new Map<string, string>();
      for (const [path, text] of original.files)
        if (path === 'build-config.yml' || path === 'build-config.yaml')
          revisions.set(path, await projectFileRevision(text));
      const model = original.project.rune.model as { name?: unknown } | undefined;
      const prepared = prepareBuildConfigSave({
        files: original.files,
        revisions,
        build: nextBuild,
        modelName: typeof model?.name === 'string' ? model.name : 'Workspace'
      });
      if (prepared.diagnostics.length) throw new ProjectSnapshotError(prepared.diagnostics);
      writes.push(...prepared.writes);
      const files = new Map(original.files);
      for (const write of writes) files.set(write.path, write.text);
      proposed = await createProjectSnapshot(original.workspaceId, files, validateProjectTarget);
    }
    const result = await resolveProjectReferences(proposed, transport, signal, cache);
    signal.throwIfAborted();
    if (!result.lock) throw new ProjectSnapshotError(result.diagnostics);
    const assertCurrent = () => {
      const current = controller.current();
      if (current?.workspaceId !== original.workspaceId || current.revision !== original.revision)
        throw new Error('Project changed while resolving references. Retry from the current project.');
    };
    assertCurrent();
    const previous = original.files.get('build-config.lock.json');
    writes.push({
      path: 'build-config.lock.json',
      text: JSON.stringify(result.lock, null, 2) + '\n',
      expectedRevision: previous === undefined ? null : await projectFileRevision(previous)
    });
    signal.throwIfAborted();
    assertCurrent();
    return {
      config: structuredClone(proposed.project.build),
      lock: structuredClone(result.lock),
      diagnostics: result.diagnostics,
      async accept(acceptSignal) {
        signal.throwIfAborted();
        acceptSignal.throwIfAborted();
        assertCurrent();
        return controller.save(writes);
      }
    };
  },
  { op: 'prepareProjectReferenceChange', capture: 0 }
);
/** Existing explicit callers use the same prepare/accept transaction as the review UI. */
export const resolveAndSaveProjectReferences = withInstrumentation(
  async function resolveAndSaveProjectReferences(
    controller: ProjectController,
    transport: ReferenceTransport,
    cache: ReferenceCache,
    signal: AbortSignal,
    nextBuild?: BuildConfig
  ): Promise<ProjectSnapshot> {
    const change = await prepareProjectReferenceChange(controller, transport, cache, signal, nextBuild);
    return change.accept(signal);
  },
  { op: 'resolveAndSaveProjectReferences', capture: 0 }
);

/** Ordinary open follows only the captured lock and verified cache; it never resolves tags. */
export const loadProjectReferences = withInstrumentation(
  async function loadProjectReferences(
    snapshot: ProjectSnapshot,
    transport: ReferenceTransport,
    cache: ReferenceCache,
    signal: AbortSignal
  ) {
    const diagnostics = await projectReferenceLockDiagnostics(snapshot);
    if (diagnostics.length) return { documents: [], diagnostics };
    if (!snapshot.lock) return { documents: [], diagnostics: [] };
    return loadLockedReferences(snapshot.lock, transport, cache, signal);
  },
  { op: 'loadProjectReferences' }
);
