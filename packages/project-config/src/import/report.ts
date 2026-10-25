// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { stringify } from 'yaml';
import { discoverProjectConfig } from '../config-codec.js';
import type { BuildConfig, ProjectFiles, ConfigResult, ConfigDocument } from '../types.js';
import type { ProjectWrite } from '../project-files.js';
export const ImportReportItemSchema = z.strictObject({
  code: z.string(),
  path: z.string(),
  message: z.string(),
  status: z.enum(['translated', 'unresolved', 'unsupported']),
  targets: z.array(z.string()),
  capabilities: z.array(z.string()),
  evidence: z.unknown().optional()
});
export type ImportReportItem = z.infer<typeof ImportReportItemSchema>;
export const MavenDependencySchema = z.strictObject({
  groupId: z.string(),
  artifactId: z.string(),
  version: z.string().optional(),
  type: z.string(),
  classifier: z.string().optional(),
  scope: z.string(),
  exclusions: z.array(z.strictObject({ groupId: z.string(), artifactId: z.string() })),
  path: z.string()
});
export type MavenDependency = z.infer<typeof MavenDependencySchema>;
export const ProjectImportReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  report: z.array(ImportReportItemSchema),
  dependencies: z.array(MavenDependencySchema),
  provenance: z.strictObject({
    pomPath: z.string(),
    profiles: z.array(z.string()),
    documents: z.array(z.string()),
    artifactId: z.string().optional()
  })
});
export type ProjectImportReport = z.infer<typeof ProjectImportReportSchema>;

/** Read persisted evidence without rerunning POM inspection on an initialized project. */
export function parseProjectImportReport(document: ConfigDocument): ConfigResult<ProjectImportReport> {
  try {
    return { value: ProjectImportReportSchema.parse(JSON.parse(document.text)), diagnostics: [] };
  } catch {
    return {
      diagnostics: [
        {
          code: 'IMPORT_REPORT_INVALID',
          severity: 'warning',
          path: document.path,
          message: 'The saved initialization report is invalid. Restore it to review the original import evidence.'
        }
      ]
    };
  }
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
