// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import JSZip from 'jszip';
import type { ExportSelection, GeneratorDiagnostic, Target } from '@rune-langium/codegen/export';
import { withInstrumentation } from './instrumentation/core.js';
import { throwCodegenDownloadError } from './workspace.js';
import { downloadBlob } from './browser-download.js';

export interface ExportArtifactFile {
  path: string;
  kind: 'text' | 'binary';
  mimeType?: string;
  bytes: number;
}

export interface ExportArtifactManifest {
  version: 1;
  target: Target;
  selection?: ExportSelection;
  resolvedSelection?: {
    explicit: ExportSelection['declarations'];
    included: ExportSelection['declarations'];
    requiredBy: Record<string, readonly string[]>;
  };
  /** Immutable curated bundle cohorts that supplied hydrated source documents. */
  resolvedCohorts?: Record<string, string>;
  files: ExportArtifactFile[];
  diagnostics: GeneratorDiagnostic[];
}

export interface ExportArtifact {
  blob: Blob;
  filename: string;
  manifest: ExportArtifactManifest;
  readText(path: string): Promise<string>;
}

/** Save the exact immutable ZIP Blob that was decoded for preview. */
export const downloadExportArtifact = withInstrumentation(
  function downloadExportArtifact(artifact: ExportArtifact): void {
    downloadBlob(artifact.blob, artifact.filename);
  },
  { op: 'downloadExportArtifact' }
);

function isArtifactFile(value: unknown): value is ExportArtifactFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<ExportArtifactFile>;
  return (
    typeof file.path === 'string' &&
    (file.kind === 'text' || file.kind === 'binary') &&
    (file.mimeType === undefined || typeof file.mimeType === 'string') &&
    typeof file.bytes === 'number' &&
    Number.isSafeInteger(file.bytes) &&
    file.bytes >= 0
  );
}

function isManifest(value: unknown): value is ExportArtifactManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<ExportArtifactManifest>;
  return (
    manifest.version === 1 &&
    typeof manifest.target === 'string' &&
    Array.isArray(manifest.files) &&
    manifest.files.every(isArtifactFile) &&
    Array.isArray(manifest.diagnostics)
  );
}

/** Decode an envelope response without regenerating or eagerly reading source files. */
export const decodeExportArtifact = withInstrumentation(
  async function decodeExportArtifact(response: Response): Promise<ExportArtifact> {
    if (!response.ok) return throwCodegenDownloadError(response);
    const blob = await response.blob();
    // JSZip rejects ArrayBuffers created by a different runtime realm (for
    // example, a Node Response in a browser-like test environment). Normalize
    // the bytes into this realm before parsing while retaining the original
    // Blob for the exact download artifact.
    const zip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
    const manifestEntry = zip.file('.rune/export.json');
    if (!manifestEntry) throw new Error('Export artifact is missing .rune/export.json.');
    const manifest: unknown = JSON.parse(await manifestEntry.async('string'));
    if (!isManifest(manifest)) throw new Error('Export artifact manifest is invalid.');
    for (const file of manifest.files) {
      const entry = zip.file(file.path);
      if (!entry) throw new Error(`Export artifact is missing '${file.path}'.`);
      if ((await entry.async('uint8array')).byteLength !== file.bytes) {
        throw new Error(`Export artifact file '${file.path}' does not match its manifest.`);
      }
    }
    const filename = response.headers.get('X-Rune-Export-Filename') ?? 'rune-export.zip';
    return {
      blob,
      filename,
      manifest,
      async readText(path: string): Promise<string> {
        const file = manifest.files.find((candidate) => candidate.path === path);
        if (!file || file.kind !== 'text') throw new Error(`'${path}' is not a text export file.`);
        const entry = zip.file(path);
        if (!entry) throw new Error(`Export artifact is missing '${path}'.`);
        return entry.async('string');
      }
    };
  },
  { op: 'decodeExportArtifact' }
);
