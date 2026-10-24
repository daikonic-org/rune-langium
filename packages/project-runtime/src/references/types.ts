// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import type { ReferenceCatalog } from '@rune-langium/curated-schema';
import type { ProjectDiagnostic } from '@rune-langium/project-config';
export interface ReferenceTransport {
  catalog(modelId: string, signal: AbortSignal): Promise<ReferenceCatalog>;
  artifact(url: string, signal: AbortSignal): Promise<Uint8Array>;
}
export interface ReferenceCache {
  get(checksum: string): Promise<Uint8Array | undefined>;
  put(checksum: string, bytes: Uint8Array): Promise<void>;
}
export interface ReferenceDocument {
  uri: string;
  content: string;
  serialized?: string;
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
