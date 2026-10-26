// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { CURATED_MODEL_REPOSITORIES, CuratedManifestSchema, type CuratedManifest } from '@rune-langium/curated-schema';
import type { ProjectSnapshot, ProjectDiagnostic } from '@rune-langium/project-config';
import { projectToolchainDiagnostics } from '../toolchain.js';
import { projectReferenceLockDiagnostics } from './resolve.js';
import { loadLockedReferences, readReferenceDocuments, readVerifiedReferenceBytes } from './load.js';
import {
  ReferenceFailure,
  referenceFailure,
  type ReferenceTransport,
  type ReferenceCache,
  type ReferenceDocument
} from './types.js';

/** Tagged releases reopen from their lock; Nightly always follows the current mirror without a saved pin. */
export async function loadProjectReferences(
  snapshot: ProjectSnapshot,
  transport: ReferenceTransport,
  cache: ReferenceCache,
  signal: AbortSignal
): Promise<{ documents: readonly ReferenceDocument[]; diagnostics: ProjectDiagnostic[] }> {
  const diagnostics = await projectReferenceLockDiagnostics(snapshot);
  if (diagnostics.length) return { documents: [], diagnostics };
  try {
    signal.throwIfAborted();
    const locked = snapshot.lock
      ? await loadLockedReferences(snapshot.lock, transport, cache, signal)
      : { documents: [], diagnostics: [] };
    if (locked.diagnostics.length) return locked;
    const manifests = new Map<string, CuratedManifest>();
    async function current(id: string, trail: readonly string[] = []): Promise<CuratedManifest> {
      signal.throwIfAborted();
      if (trail.includes(id))
        throw new ReferenceFailure('REFERENCE_CYCLE', 'Nightly dependency cycle: ' + [...trail, id].join(' -> '));
      if (Object.hasOwn(snapshot.lock?.references ?? {}, id))
        throw new ReferenceFailure('REFERENCE_CONFLICT', 'Nightly and tagged releases require the same model: ' + id);
      const existing = manifests.get(id);
      if (existing) return existing;
      const request = snapshot.project.build.references[id];
      const repository = CURATED_MODEL_REPOSITORIES[id as keyof typeof CURATED_MODEL_REPOSITORIES];
      if (
        !repository ||
        (request && (request.release !== 'nightly' || request.repository.replace(/\.git$/, '') !== repository))
      )
        throw new ReferenceFailure(
          'REFERENCE_CONFLICT',
          'Nightly repository or release does not match the current curated model: ' + id
        );
      if (!transport.nightly)
        throw new ReferenceFailure('REFERENCE_NIGHTLY_UNAVAILABLE', 'This host cannot load current Nightly mirrors.');
      const manifest = CuratedManifestSchema.parse(await transport.nightly(id, signal));
      signal.throwIfAborted();
      if (manifest.modelId !== id)
        throw new ReferenceFailure('REFERENCE_PROVENANCE', 'Nightly model identity mismatch: ' + id);
      manifests.set(id, manifest);
      for (const [dependency, cohort] of Object.entries(manifest.dependencies ?? {})) {
        const peer = await current(dependency, [...trail, id]);
        if (!cohort || peer.cohort !== cohort)
          throw new ReferenceFailure(
            'REFERENCE_DEPENDENCY',
            'Nightly publication is changing; retry after its dependency mirrors finish updating: ' +
              id +
              ' -> ' +
              dependency
          );
      }
      return manifest;
    }
    for (const [id, request] of Object.entries(snapshot.project.build.references))
      if (request.release === 'nightly') await current(id);
    const staged = new Map<string, Uint8Array>();
    const documents = [...locked.documents];
    const read = (url: string, checksum: string) =>
      readVerifiedReferenceBytes(url, checksum, transport, cache, signal, staged);
    for (const [id, manifest] of manifests) {
      const langium = manifest.artifacts?.serializedWorkspace?.langiumVersion;
      if (!langium || projectToolchainDiagnostics({ langium }).length)
        throw new ReferenceFailure('REFERENCE_TOOLCHAIN', 'Nightly compiler format is unsupported: ' + id);
      documents.push(...(await readReferenceDocuments(id, manifest, langium, read)));
    }
    signal.throwIfAborted();
    for (const [checksum, bytes] of staged) {
      signal.throwIfAborted();
      try {
        await cache.put(checksum, bytes);
      } catch {
        /* Verified data can load without a writable cache. */
      }
    }
    signal.throwIfAborted();
    return { documents, diagnostics: [] };
  } catch (error) {
    return { documents: [], diagnostics: [referenceFailure(error, signal)] };
  }
}
