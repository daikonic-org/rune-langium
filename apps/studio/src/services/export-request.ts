// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { canonicalProjectJson } from '@rune-langium/project-config';
import type { ExportSelection, Target } from '@rune-langium/codegen/export';
import { decodeExportArtifact, type ExportArtifact } from './export-artifact.js';
import { requestCodegenDownload } from './codegen-download-client.js';
import { withInstrumentation } from './instrumentation/core.js';
import { collectCuratedSourcesForCodegen, collectRawWorkspaceSources, type WorkspaceFile } from './workspace.js';

export interface ExportConfig {
  target: Target;
  selection: ExportSelection;
  options: Record<string, unknown>;
}

export interface ExportInput {
  workspaceId: string;
  sourceRevision: number;
  projectRevision?: string;
  projectBuild?: boolean;
  config: ExportConfig;
  files: readonly WorkspaceFile[];
}

/** The exact workspace-file fields that can change a generated export. */
export const exportSourceFiles = withInstrumentation(
  function exportSourceFiles(files: readonly WorkspaceFile[]) {
    return files.map(({ path, content, readOnly, serializedModelJson, bundleId, bundleVersion }) => ({
      path,
      content,
      readOnly: Boolean(readOnly),
      serializedModelJson,
      bundleId,
      bundleVersion
    }));
  },
  { op: 'exportSourceFiles' }
);

/** Stable identity for source changes that invalidate an export artifact. */
export const exportSourceFingerprint = withInstrumentation(
  function exportSourceFingerprint(workspaceId: string | undefined, files: readonly WorkspaceFile[]): string {
    return canonicalProjectJson({ workspaceId, files: exportSourceFiles(files) });
  },
  { op: 'exportSourceFingerprint' }
);

/** Only generator settings belong to a saved target; declaration roots remain a run draft. */
export const exportTargetKey = withInstrumentation(
  function exportTargetKey(config: ExportConfig): string {
    return canonicalProjectJson({ generator: config.target, options: config.options[config.target] ?? {} });
  },
  { op: 'exportTargetKey' }
);

/** Stable identity for a captured generation input, independent of object insertion order. */
export const exportInputKey = withInstrumentation(
  function exportInputKey(input: ExportInput): string {
    return canonicalProjectJson({
      workspaceId: input.workspaceId,
      sourceRevision: input.sourceRevision,
      projectRevision: input.projectRevision,
      projectBuild: input.projectBuild,
      config: input.config,
      files: exportSourceFiles(input.files)
    });
  },
  { op: 'exportInputKey' }
);

/** Generate one inspectable, immutable export artifact for a captured workspace input. */
export const generateExport = withInstrumentation(
  async function generateExport(input: ExportInput, signal: AbortSignal): Promise<ExportArtifact> {
    const files = collectRawWorkspaceSources(input.files);
    const { curatedBundles, curatedDocs } = collectCuratedSourcesForCodegen(input.files);
    const response = await requestCodegenDownload(
      {
        files,
        target: input.config.target,
        options: input.config.options,
        curatedBundles,
        curatedDocs,
        selection: input.config.selection,
        artifactEnvelope: 1,
        ...(input.projectBuild ? { projectBuild: true } : {})
      },
      signal
    );
    return decodeExportArtifact(response);
  },
  { op: 'generateExport' }
);
