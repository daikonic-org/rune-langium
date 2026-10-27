// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import JSZip from 'jszip';
import type { ExportSelection, GeneratorDiagnostic, Target } from '@rune-langium/codegen/export';
import { withInstrumentation } from './instrumentation/core.js';
import { throwCodegenDownloadError } from './workspace.js';
import { ProjectResolutionReceiptSchema, type ProjectResolutionReceipt } from '@rune-langium/core/project-contract';
import { projectReceiptMatches } from '@rune-langium/project-runtime/receipt';
import { downloadBlob } from './browser-download.js';

export interface ExportArtifactFile {
  path: string;
  kind: 'text' | 'binary';
  mimeType?: string;
  bytes: number;
  /** Namespace ownership captured by the generator, retained across target-output prefixes. */
  namespaces?: string[];
}

export interface ExportArtifactManifest {
  projectReceipt?: ProjectResolutionReceipt;
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
  readBytes?(path: string): Promise<Uint8Array>;
}

/** A generated artifact can establish readiness only for its captured project. */
export const assertExportProjectReceipt = withInstrumentation(
  function assertExportProjectReceipt(artifact: ExportArtifact, expected: ProjectResolutionReceipt | undefined): void {
    if (expected && !projectReceiptMatches(expected, artifact.manifest.projectReceipt))
      throw new Error('Export project receipt does not match the captured source and configuration.');
  },
  { op: 'assertExportProjectReceipt', capture: 0 }
);

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
    (file.namespaces === undefined ||
      (Array.isArray(file.namespaces) && file.namespaces.every((entry) => typeof entry === 'string'))) &&
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
    (manifest.projectReceipt === undefined ||
      ProjectResolutionReceiptSchema.safeParse(manifest.projectReceipt).success) &&
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
      async readBytes(path: string) {
        if (!manifest.files.some((file) => file.path === path)) throw new Error('Unknown export file: ' + path);
        return zip.file(path)!.async('uint8array');
      },
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

/** Batch previews and downloads retain the same staged bytes as saved target outputs. */
export const combineExportArtifacts = withInstrumentation(
  async function combineExportArtifacts(
    entries: readonly { output: string; artifact: ExportArtifact }[]
  ): Promise<ExportArtifact> {
    const receipt = entries.find((entry) => entry.artifact.manifest.projectReceipt)?.artifact.manifest.projectReceipt;
    for (const entry of entries) assertExportProjectReceipt(entry.artifact, receipt);
    const zip = new JSZip();
    const files: ExportArtifactFile[] = [];
    for (const { output, artifact } of entries)
      for (const file of artifact.manifest.files) {
        const path = output + '/' + file.path;
        const content = artifact.readBytes ? await artifact.readBytes(file.path) : await artifact.readText(file.path);
        zip.file(path, content);
        files.push({ ...file, path });
      }
    const manifest: ExportArtifactManifest = {
      version: 1,
      ...(receipt ? { projectReceipt: receipt } : {}),
      target: entries[0]!.artifact.manifest.target,
      files,
      diagnostics: entries.flatMap((entry) => entry.artifact.manifest.diagnostics)
    };
    zip.file('.rune/export.json', JSON.stringify(manifest));
    return decodeExportArtifact(
      new Response(new Uint8Array(await zip.generateAsync({ type: 'uint8array' })).buffer, {
        headers: { 'X-Rune-Export-Filename': 'rune-build.zip' }
      })
    );
  },
  { op: 'combineExportArtifacts' }
);
