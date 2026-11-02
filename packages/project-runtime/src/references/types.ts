// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import type { RepositoryExampleSource } from '@rune-langium/core/project-contract';
import type {
  ReferenceCatalog,
  CuratedManifest,
  CuratedSerializedWorkspaceArtifact
} from '@rune-langium/curated-schema';
import type { ProjectDiagnostic } from '@rune-langium/project-config';
/** Derived with the canonical core helpers; versioned by the host's cache contract. */
export interface ReferenceModelInfo {
  metadata: ReturnType<typeof import('@rune-langium/core').readLspModelMetadata>;
  compact: string;
}
export type DecodedReferenceArtifact = Omit<CuratedSerializedWorkspaceArtifact, 'documents'> & {
  documents: Array<CuratedSerializedWorkspaceArtifact['documents'][number] & { lsp?: ReferenceModelInfo }>;
};
export interface ReferenceTransport {
  /** Optional host decoder (e.g. browser worker); bytes have already passed checksum verification. */
  decodeArtifact?(bytes: Uint8Array, checksum: string, signal: AbortSignal): Promise<DecodedReferenceArtifact>;
  catalog(modelId: string, signal: AbortSignal): Promise<ReferenceCatalog>;
  artifact(url: string, signal: AbortSignal): Promise<Uint8Array>;
  /** Current moving mirror, fetched on open/refresh, never stored in a project lock. */
  nightly?(modelId: string, signal: AbortSignal): Promise<CuratedManifest>;
}
export interface ReferenceCache {
  get(checksum: string): Promise<Uint8Array | undefined>;
  put(checksum: string, bytes: Uint8Array): Promise<void>;
}
export interface ReferenceDocument {
  uri: string;
  content: string;
  serialized?: string;
  exports?: CuratedSerializedWorkspaceArtifact['documents'][number]['exports'];
  lsp?: ReferenceModelInfo;
  /** Verified publication identity for a local copy's provenance; never a Nightly lock. */
  cohort?: CuratedManifest['cohort'];
  /** Active verified source, kept in memory for version-matched example discovery. */
  source?: Omit<RepositoryExampleSource, 'path' | 'format' | 'version'>;
}
export class ReferenceFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly path = 'references'
  ) {
    super(message);
  }
}
export function referenceFailure(error: unknown, signal: AbortSignal): ProjectDiagnostic {
  return {
    severity: 'error',
    code: signal.aborted
      ? 'REFERENCE_CANCELLED'
      : error instanceof ReferenceFailure
        ? error.code
        : 'REFERENCE_UNAVAILABLE',
    path: error instanceof ReferenceFailure ? error.path : 'references',
    message: signal.aborted
      ? 'Reference loading cancelled.'
      : error instanceof Error
        ? error.message
        : 'Reference is unavailable.'
  };
}
