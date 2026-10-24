// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { validateReferenceCatalog, type ReferenceCatalog, type ReferenceRelease } from '@rune-langium/curated-schema';
import {
  ProjectLockSchema,
  canonicalProjectJson,
  projectFileRevision,
  type ProjectSnapshot,
  type ProjectLock,
  type ProjectDiagnostic
} from '@rune-langium/project-config';
import { PROJECT_TOOLCHAIN, projectToolchainDiagnostics } from '../toolchain.js';
import { createMemoryReferenceCache } from './cache.js';
import { readReferenceManifest, readVerifiedReferenceBytes, loadLockedReferences } from './load.js';
import { ReferenceFailure, referenceFailure, type ReferenceTransport, type ReferenceCache } from './types.js';
/** Only reference requests affect lock freshness; target/source/example edits do not force a network resolve. */
export async function projectReferenceConfigHash(snapshot: ProjectSnapshot): Promise<string> {
  return projectFileRevision(canonicalProjectJson(snapshot.project.build.references));
}

/** Explicit resolve/upgrade proposes a verified lock; it never mutates a workspace. */
export async function resolveProjectReferences(
  snapshot: ProjectSnapshot,
  transport: ReferenceTransport,
  signal: AbortSignal,
  cache: ReferenceCache = createMemoryReferenceCache()
): Promise<{ lock?: ProjectLock; diagnostics: ProjectDiagnostic[] }> {
  try {
    signal.throwIfAborted();
    const catalogs = new Map<string, ReferenceCatalog>();
    const requests = structuredClone(snapshot.project.build.references);
    const configHash = await projectFileRevision(canonicalProjectJson(requests));
    const staged = new Map<string, Uint8Array>();
    const manifestBytes = new Map<string, Uint8Array>();
    type Request = {
      id: string;
      tag: string;
      repository?: string;
      cohort?: string;
      path: string;
      trail: readonly string[];
    };
    type Selection = {
      selected: Map<string, { release: ReferenceRelease; path: string }>;
      toolchain?: Record<string, string>;
    };
    async function catalog(id: string) {
      if (!catalogs.has(id)) {
        const result = validateReferenceCatalog(await transport.catalog(id, signal));
        signal.throwIfAborted();
        catalogs.set(id, result);
      }
      return catalogs.get(id)!;
    }
    const read = async (url: string, checksum: string) => {
      const bytes = await readVerifiedReferenceBytes(url, checksum, transport, cache, signal, staged);
      manifestBytes.set(url, bytes);
      return bytes;
    };
    // Artifact cohorts are variants of the same source release, not additional model versions.
    // Backtracking lets a later parent constrain an already visited direct dependency.
    async function search(queue: readonly Request[], state: Selection): Promise<Selection> {
      signal.throwIfAborted();
      const request = queue[0];
      if (!request) return state;
      const rest = queue.slice(1);
      const { id, tag, repository, path } = request;
      if (request.trail.includes(id))
        throw new ReferenceFailure('REFERENCE_CYCLE', 'Reference dependency cycle: ' + path);
      const prior = state.selected.get(id);
      if (prior) {
        if (
          prior.release.tag !== tag ||
          (repository && prior.release.repository !== repository) ||
          (request.cohort && prior.release.cohort !== request.cohort)
        )
          throw new ReferenceFailure(
            'REFERENCE_CONFLICT',
            `Conflicting reference requirements: ${prior.path} and ${path}`
          );
        return search(rest, state);
      }
      const candidates = (await catalog(id)).releases
        .filter(
          (release) =>
            release.modelId === id &&
            release.tag === tag &&
            (!repository || release.repository === repository) &&
            (!request.cohort || release.cohort === request.cohort)
        )
        .toReversed();
      if (!candidates.length || (!repository && new Set(candidates.map((release) => release.repository)).size > 1))
        throw new ReferenceFailure(
          'REFERENCE_RELEASE_UNAVAILABLE',
          'No unambiguous compatible published artifact for ' + path
        );
      let failure: unknown;
      for (const release of candidates) {
        try {
          const previous = Object.hasOwn(snapshot.lock?.references ?? {}, id)
            ? snapshot.lock!.references[id]
            : undefined;
          if (
            previous &&
            previous.repository === release.repository &&
            previous.release === tag &&
            previous.commit !== release.commit
          )
            throw new ReferenceFailure('REFERENCE_MOVED_TAG', 'Release tag moved; preserve the locked commit: ' + path);
          let versions: Record<string, string>;
          try {
            versions = ProjectLockSchema.shape.toolchain.parse(JSON.parse(release.toolchain));
          } catch {
            throw new ReferenceFailure(
              'REFERENCE_TOOLCHAIN',
              'Reference toolchain metadata is unavailable or unsupported: ' + path
            );
          }
          const issues = projectToolchainDiagnostics(versions, true);
          if (issues.length) throw new ReferenceFailure('REFERENCE_TOOLCHAIN', issues[0]!.message);
          if (state.toolchain && canonicalProjectJson(versions) !== canonicalProjectJson(state.toolchain))
            throw new ReferenceFailure(
              'REFERENCE_TOOLCHAIN',
              'Reference releases require different toolchains: ' + path
            );
          const manifest = await readReferenceManifest(id, { ...release, release: tag }, read);
          if (
            JSON.stringify(Object.keys(manifest.dependencies ?? {}).sort()) !==
            JSON.stringify(Object.keys(release.dependencies).sort())
          )
            throw new ReferenceFailure(
              'REFERENCE_DEPENDENCY',
              'Release catalog and manifest dependency sets differ: ' + path
            );
          const dependencies: Request[] = [];
          const requiredCohorts: Readonly<Record<string, string | undefined>> = manifest.dependencies ?? {};
          for (const [dependency, requirement] of Object.entries(release.dependencies).sort(([a], [b]) =>
            a.localeCompare(b)
          )) {
            const direct = Object.hasOwn(requests, dependency) ? requests[dependency] : undefined;
            if (direct && direct.release !== requirement.release)
              throw new ReferenceFailure(
                'REFERENCE_CONFLICT',
                `Conflicting reference requirements: ${path} -> ${dependency}@${requirement.release} and ${dependency}@${direct.release}`
              );
            dependencies.push({
              id: dependency,
              tag: requirement.release,
              repository: direct?.repository,
              cohort: requiredCohorts[dependency]!,
              path: path + ' -> ' + dependency + '@' + requirement.release,
              trail: [...request.trail, id]
            });
          }
          const selected = new Map(state.selected);
          selected.set(id, { release, path });
          return await search([...dependencies, ...rest], { selected, toolchain: versions });
        } catch (error) {
          signal.throwIfAborted();
          failure = error;
        }
      }
      throw failure;
    }
    const result = await search(
      Object.entries(requests)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, request]) => ({
          id,
          tag: request.release,
          repository: request.repository,
          path: id + '@' + request.release,
          trail: []
        })),
      { selected: new Map() }
    );
    const lock: ProjectLock = {
      schemaVersion: 1,
      configHash,
      toolchain: result.toolchain ?? { ...PROJECT_TOOLCHAIN },
      references: Object.fromEntries(
        [...result.selected]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, { release }]) => [
            id,
            {
              repository: release.repository,
              release: release.tag,
              commit: release.commit,
              manifest: release.manifest,
              cohort: release.cohort,
              checksum: release.checksum,
              dependencies: Object.fromEntries(
                Object.entries(release.dependencies).map(([id, dependency]) => [id, dependency.release])
              )
            }
          ])
      )
    };
    const capturedTransport: ReferenceTransport = {
      catalog: (id, signal) => transport.catalog(id, signal),
      artifact: async (url, signal) => {
        signal.throwIfAborted();
        return manifestBytes.get(url)?.slice() ?? transport.artifact(url, signal);
      }
    };
    const loaded = await loadLockedReferences(lock, capturedTransport, cache, signal);
    return loaded.diagnostics.some((issue) => issue.severity === 'error')
      ? { diagnostics: loaded.diagnostics }
      : { lock, diagnostics: [] };
  } catch (error) {
    return { diagnostics: [referenceFailure(error, signal)] };
  }
}

/** Reject stale requests and unrequested/missing lock entries before any host hydrates them. */
export async function projectReferenceLockDiagnostics(snapshot: ProjectSnapshot): Promise<ProjectDiagnostic[]> {
  const lock = snapshot.lock;
  const requests = snapshot.project.build.references;
  if (!Object.keys(requests).length)
    return Object.keys(lock?.references ?? {}).length
      ? [
          {
            code: 'REFERENCE_LOCK_STALE',
            severity: 'error',
            path: 'build-config.lock.json',
            message: 'Lock contains unrequested reference models. Resolve project references.'
          }
        ]
      : [];
  if (!lock || lock.configHash !== (await projectReferenceConfigHash(snapshot)))
    return [
      {
        code: 'REFERENCE_LOCK_STALE',
        severity: 'error',
        path: 'build-config.lock.json',
        message: 'Reference requests changed or no lock exists. Resolve project references.'
      }
    ];
  const visited = new Set<string>();
  const visit = (id: string, tag: string, repository?: string): boolean => {
    const entry = Object.hasOwn(lock.references, id) ? lock.references[id] : undefined;
    if (!entry || entry.release !== tag || (repository && entry.repository !== repository)) return false;
    if (visited.has(id)) return true;
    visited.add(id);
    return Object.entries(entry.dependencies).every(([id, tag]) => visit(id, tag));
  };
  if (
    !Object.entries(requests).every(([id, request]) => visit(id, request.release, request.repository)) ||
    visited.size !== Object.keys(lock.references).length
  )
    return [
      {
        code: 'REFERENCE_LOCK_STALE',
        severity: 'error',
        path: 'build-config.lock.json',
        message: 'Lock does not describe exactly the requested dependency closure.'
      }
    ];
  return [];
}
