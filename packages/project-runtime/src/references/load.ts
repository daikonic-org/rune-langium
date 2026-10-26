// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { inflate } from 'pako';
import {
  CURATED_MODEL_REPOSITORIES,
  CuratedManifestSchema,
  CuratedSerializedWorkspaceArtifactSchema,
  type CuratedManifest
} from '@rune-langium/curated-schema';
import {
  ProjectLockSchema,
  normalizeProjectPath,
  projectBytesRevision,
  type ProjectLock,
  type ProjectDiagnostic
} from '@rune-langium/project-config';
import { projectToolchainDiagnostics } from '../toolchain.js';
import {
  ReferenceFailure,
  referenceFailure,
  type ReferenceTransport,
  type ReferenceCache,
  type ReferenceDocument
} from './types.js';

/** Verify the whole pinned closure before exposing documents or promoting fetched bytes. */
export async function loadLockedReferences(
  lock: ProjectLock,
  transport: ReferenceTransport,
  cache: ReferenceCache,
  signal: AbortSignal
): Promise<{ documents: readonly ReferenceDocument[]; diagnostics: ProjectDiagnostic[] }> {
  const staged = new Map<string, Uint8Array>();
  const documents: ReferenceDocument[] = [];
  try {
    signal.throwIfAborted();
    lock = ProjectLockSchema.parse(lock);
    const issues = projectToolchainDiagnostics(lock.toolchain, Object.keys(lock.references).length > 0);
    if (issues.length) return { documents: [], diagnostics: issues };
    const read = (url: string, checksum: string) =>
      readVerifiedReferenceBytes(url, checksum, transport, cache, signal, staged);
    for (const [id, entry] of Object.entries(lock.references).sort(([a], [b]) => a.localeCompare(b))) {
      const manifest = await readReferenceManifest(id, entry, read);
      const deps = manifest.dependencies ?? {};
      if (JSON.stringify(Object.keys(deps).sort()) !== JSON.stringify(Object.keys(entry.dependencies).sort()))
        throw new ReferenceFailure('REFERENCE_DEPENDENCY', 'Manifest dependency set differs from the lock: ' + id);
      for (const [dependency, cohort] of Object.entries(deps)) {
        const peer = Object.hasOwn(lock.references, dependency) ? lock.references[dependency] : undefined;
        if (!peer || peer.cohort !== cohort || peer.release !== entry.dependencies[dependency])
          throw new ReferenceFailure('REFERENCE_DEPENDENCY', 'Locked dependency mismatch: ' + id + ' -> ' + dependency);
      }
      documents.push(
        ...(await readReferenceDocuments(id, manifest, lock.toolchain.langium, read)).map((document) =>
          document.source
            ? { ...document, source: { ...document.source, release: entry.release, repository: entry.repository } }
            : document
        )
      );
    }
    signal.throwIfAborted();
    for (const [key, bytes] of staged) {
      signal.throwIfAborted();
      try {
        await cache.put(key, bytes);
      } catch {
        /* Verified content can still load when storage is unavailable. */
      }
    }
    signal.throwIfAborted();
    return { documents, diagnostics: [] };
  } catch (error) {
    return { documents: [], diagnostics: [referenceFailure(error, signal)] };
  }
}

/** Shared verification for closure selection and locked opens; promotion stays with the caller. */
export async function readVerifiedReferenceBytes(
  url: string,
  checksum: string,
  transport: ReferenceTransport,
  cache: ReferenceCache,
  signal: AbortSignal,
  staged: Map<string, Uint8Array>
): Promise<Uint8Array> {
  signal.throwIfAborted();
  const pending = staged.get(checksum);
  if (pending) return pending.slice();
  let cached: Uint8Array | undefined;
  try {
    cached = (await cache.get(checksum))?.slice();
  } catch {
    /* Cache denial is a miss. */
  }
  signal.throwIfAborted();
  if (cached && (await projectBytesRevision(cached)) === checksum) return cached;
  const bytes = (await transport.artifact(url, signal)).slice();
  signal.throwIfAborted();
  if ((await projectBytesRevision(bytes)) !== checksum)
    throw new ReferenceFailure('REFERENCE_CHECKSUM', 'Reference checksum mismatch: ' + url);
  staged.set(checksum, bytes);
  return bytes.slice();
}
export async function readReferenceManifest(
  id: string,
  entry: Pick<ProjectLock['references'][string], 'manifest' | 'cohort' | 'checksum' | 'commit' | 'release'>,
  read: (url: string, checksum: string) => Promise<Uint8Array>
) {
  const url = new URL(entry.manifest);
  if (
    url.protocol !== 'https:' ||
    url.search ||
    url.hash ||
    url.pathname !== `/curated/${id}/artifacts/${entry.cohort}/manifest.json`
  )
    throw new ReferenceFailure('REFERENCE_MANIFEST', 'Lock does not identify an immutable model manifest: ' + id);
  const manifest = CuratedManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(await read(entry.manifest, entry.checksum)))
  );
  if (
    manifest.modelId !== id ||
    manifest.cohort !== entry.cohort ||
    manifest.upstreamCommit !== entry.commit ||
    manifest.upstreamRef !== entry.release
  )
    throw new ReferenceFailure('REFERENCE_PROVENANCE', 'Manifest provenance does not match the lock: ' + id);
  return manifest;
}

/** Shared bundle, checksum, format and document-path validation for tagged and moving references. */
export async function readReferenceDocuments(
  id: string,
  manifest: CuratedManifest,
  langiumVersion: string | undefined,
  read: (url: string, checksum: string) => Promise<Uint8Array>
): Promise<ReferenceDocument[]> {
  const artifact = manifest.artifacts?.serializedWorkspace;
  if (!artifact || !artifact.url.includes('/artifacts/') || artifact.url.includes('/latest'))
    throw new ReferenceFailure('REFERENCE_ARTIFACT', 'Immutable serialized artifact is missing: ' + id);
  const bytes = await read(artifact.url, artifact.sha256);
  if (bytes.byteLength !== artifact.sizeBytes)
    throw new ReferenceFailure('REFERENCE_CHECKSUM', 'Serialized artifact size mismatch: ' + id);
  const bundle = CuratedSerializedWorkspaceArtifactSchema.parse(JSON.parse(new TextDecoder().decode(inflate(bytes))));
  if (
    bundle.modelId !== id ||
    bundle.langiumVersion !== artifact.langiumVersion ||
    bundle.langiumVersion !== langiumVersion ||
    bundle.documents.length !== artifact.documentCount
  )
    throw new ReferenceFailure('REFERENCE_ARTIFACT', 'Serialized artifact identity/format mismatch: ' + id);
  const documents: ReferenceDocument[] = [];
  const seen = new Set<string>();
  for (const doc of bundle.documents) {
    const path = normalizeProjectPath(doc.path);
    if (!path || seen.has(path))
      throw new ReferenceFailure('REFERENCE_DOCUMENT', 'Unsafe or duplicate reference document path: ' + doc.path);
    seen.add(path);
    documents.push({
      uri: `${id}/${path}`,
      content: doc.content ?? '',
      serialized: doc.modelJson,
      ...(manifest.cohort ? { cohort: manifest.cohort } : {}),
      ...(Object.hasOwn(CURATED_MODEL_REPOSITORIES, id) && /^[a-f0-9]{40}$/.test(manifest.upstreamCommit)
        ? {
            source: {
              model: id,
              repository: CURATED_MODEL_REPOSITORIES[id as keyof typeof CURATED_MODEL_REPOSITORIES],
              release: manifest.upstreamRef,
              commit: manifest.upstreamCommit
            }
          }
        : {})
    });
  }
  return documents;
}
