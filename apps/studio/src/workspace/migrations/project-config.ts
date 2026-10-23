// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import {
  BuildConfigSchema,
  discoverProjectConfig,
  parseBuildConfig,
  updateBuildConfig,
  type ProjectDiagnostic,
  type ProjectFiles,
  type ProjectWrite
} from '@rune-langium/project-config';
import { withInstrumentation } from '../../services/instrumentation/core.js';

/** Proposed writes only. The user confirms them through project Save. */
export const previewProjectConfigMigration = withInstrumentation(
  function previewProjectConfigMigration(input: {
    workspaceName: string;
    files: ProjectFiles;
    revisions: ReadonlyMap<string, string>;
    targetOptions: Readonly<Record<string, Record<string, unknown>>>;
    references: readonly { model: string; repository: string; release?: string }[];
  }): { writes: ProjectWrite[]; diagnostics: ProjectDiagnostic[] } {
    const found = discoverProjectConfig(input.files);
    const diagnostics = [...found.diagnostics];
    if (diagnostics.some((issue) => issue.severity === 'error')) return { writes: [], diagnostics };
    const parsed = found.build ? parseBuildConfig(found.build) : undefined;
    diagnostics.push(...(parsed?.diagnostics ?? []));
    if (parsed && !parsed.value) return { writes: [], diagnostics };
    const build = structuredClone(parsed?.value ?? BuildConfigSchema.parse({ schemaVersion: 1 }));
    let changed = !found.build;
    for (const [name, options] of Object.entries(input.targetOptions)) {
      if (Object.prototype.hasOwnProperty.call(build.targets, name)) continue;
      build.targets[name] = { generator: name, options: structuredClone(options), output: 'generated/' + name };
      changed = true;
    }
    for (const reference of input.references) {
      if (Object.prototype.hasOwnProperty.call(build.references, reference.model)) continue;
      if (!reference.release) {
        diagnostics.push({
          code: 'MIGRATION_RELEASE_REQUIRED',
          severity: 'error',
          path: 'references.' + reference.model,
          message: 'Choose an explicit release for ' + reference.model + ' before saving its legacy binding.'
        });
        continue;
      }
      build.references[reference.model] = { repository: reference.repository, release: reference.release };
      changed = true;
    }
    if (!changed) return { writes: [], diagnostics };
    const document = found.build ?? { path: 'build-config.yml', text: 'schemaVersion: 1\n' };
    const expectedRevision = found.build ? input.revisions.get(document.path) : null;
    if (expectedRevision === undefined)
      return {
        writes: [],
        diagnostics: [
          ...diagnostics,
          {
            code: 'MIGRATION_REVISION_REQUIRED',
            severity: 'error',
            path: document.path,
            message: 'Reload project files before migration.'
          }
        ]
      };
    const writes: ProjectWrite[] = [
      { path: document.path, text: updateBuildConfig(document, build), expectedRevision }
    ];
    if (
      !input.files.has(build.runeConfig) &&
      build.runeConfig === 'rune-config.yml' &&
      !input.files.has('rune-config.yaml')
    )
      writes.push({
        path: build.runeConfig,
        text: JSON.stringify({ model: { name: input.workspaceName } }, null, 2) + '\n',
        expectedRevision: null
      });
    return { writes, diagnostics };
  },
  { op: 'previewProjectConfigMigration' }
);
