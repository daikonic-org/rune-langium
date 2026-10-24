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
  createProjectDraftSnapshot,
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
import { reviewProjectCompatibility } from '@rune-langium/project-runtime';
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
  projectRevision: string;
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
    nextBuild?: BuildConfig | ((snapshot: ProjectSnapshot) => BuildConfig)
  ): Promise<PreparedReferenceChange> {
    const requested = typeof nextBuild === 'function' ? nextBuild : nextBuild ? structuredClone(nextBuild) : undefined;
    signal.throwIfAborted();
    const original = await controller.load();
    signal.throwIfAborted();
    nextBuild = typeof requested === 'function' ? structuredClone(requested(original)) : requested;
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
      proposed = await createProjectDraftSnapshot(
        original,
        new Map(writes.map((write) => [write.path, write.text])),
        validateProjectTarget
      );
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
    const lockText = JSON.stringify(result.lock, null, 2) + '\n';
    const reviewedSnapshot = await createProjectDraftSnapshot(
      proposed,
      new Map([['build-config.lock.json', lockText]]),
      validateProjectTarget
    );
    const loaded = await loadLockedReferences(result.lock, transport, cache, signal);
    if (loaded.diagnostics.some((issue) => issue.severity === 'error'))
      throw new ProjectSnapshotError(loaded.diagnostics);
    const baseline = original.lock ? await loadProjectReferences(original, transport, cache, signal) : undefined;
    const diagnostics = [
      ...result.diagnostics,
      ...(await reviewProjectCompatibility(
        reviewedSnapshot,
        loaded.documents,
        baseline && !baseline.diagnostics.length
          ? { snapshot: original, referenceDocuments: baseline.documents }
          : undefined
      ))
    ];
    if (baseline?.diagnostics.length)
      diagnostics.push(
        ...baseline.diagnostics.map((issue) => ({
          ...issue,
          code: 'REFERENCE_BASELINE_UNAVAILABLE',
          severity: 'warning' as const
        }))
      );
    signal.throwIfAborted();
    assertCurrent();
    const previous = original.files.get('build-config.lock.json');
    writes.push({
      path: 'build-config.lock.json',
      text: lockText,
      expectedRevision: previous === undefined ? null : await projectFileRevision(previous)
    });
    signal.throwIfAborted();
    assertCurrent();
    const destinations = new Set(writes.map((write) => write.path));
    const preconditions = {
      paths: [...original.files.keys()],
      inputs: await Promise.all(
        [...original.files]
          .filter(([path]) => !destinations.has(path))
          .map(async ([path, text]) => ({
            path,
            revision: original.fileRevisions.get(path) ?? (await projectFileRevision(text))
          }))
      )
    };
    return {
      projectRevision: original.revision,
      config: structuredClone(proposed.project.build),
      lock: structuredClone(result.lock),
      diagnostics,
      async accept(acceptSignal) {
        signal.throwIfAborted();
        acceptSignal.throwIfAborted();
        assertCurrent();
        if (diagnostics.some((issue) => issue.severity === 'error')) throw new ProjectSnapshotError(diagnostics);
        return controller.save(writes, preconditions);
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
