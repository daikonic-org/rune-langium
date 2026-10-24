// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { stringify } from 'yaml';
import { discoverProjectConfig } from '../config-codec.js';
import type { BuildConfig, ProjectFiles } from '../types.js';
import type { ProjectWrite } from '../project-files.js';
export interface ImportReportItem {
  code: string;
  path: string;
  message: string;
  status: 'translated' | 'unresolved' | 'unsupported';
  targets: string[];
  capabilities: string[];
  evidence?: unknown;
}
export interface MavenDependency {
  groupId: string;
  artifactId: string;
  version?: string;
  type: string;
  classifier?: string;
  scope: string;
  exclusions: { groupId: string; artifactId: string }[];
  path: string;
}
export interface MavenImportPreview {
  build: BuildConfig;
  report: ImportReportItem[];
  dependencies: MavenDependency[];
  provenance: { pomPath: string; profiles: string[]; documents: string[]; artifactId?: string };
  writes: ProjectWrite[];
}
function reportText(preview: MavenImportPreview): string {
  return (
    JSON.stringify(
      { schemaVersion: 1, report: preview.report, dependencies: preview.dependencies, provenance: preview.provenance },
      null,
      2
    ) + '\n'
  );
}
/** Only absent files are proposed; the host must also fence the complete input revision. */
export function mavenPreviewWrites(preview: MavenImportPreview, files: ProjectFiles): ProjectWrite[] {
  const configured = discoverProjectConfig(files);
  if (configured.build || configured.diagnostics.length) return [];
  const writes: ProjectWrite[] = [{ path: 'build-config.yml', text: stringify(preview.build), expectedRevision: null }];
  if (!files.has(preview.build.runeConfig))
    writes.push({
      path: preview.build.runeConfig,
      text: stringify({ model: { name: preview.provenance.artifactId || 'Imported project' } }),
      expectedRevision: null
    });
  if (preview.build.importReport)
    writes.push({ path: preview.build.importReport, text: reportText(preview), expectedRevision: null });
  return writes;
}
/** Re-render only the writes already proposed by inspection, keeping their compare-and-swap preconditions. */
export function refreshMavenPreviewWrites(preview: MavenImportPreview): MavenImportPreview {
  return {
    ...preview,
    writes: preview.writes.map((write) =>
      write.path === 'build-config.yml'
        ? { ...write, text: stringify(preview.build) }
        : write.path === preview.build.importReport
          ? { ...write, text: reportText(preview) }
          : write
    )
  };
}
