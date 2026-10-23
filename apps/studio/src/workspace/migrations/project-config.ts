// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import {
  BuildConfigSchema,
  discoverProjectConfig,
  parseBuildConfig,
  prepareBuildConfigSave,
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
    const saved = prepareBuildConfigSave({
      files: input.files,
      revisions: input.revisions,
      build,
      modelName: input.workspaceName
    });
    return { writes: saved.writes, diagnostics: [...diagnostics, ...saved.diagnostics] };
  },
  { op: 'previewProjectConfigMigration' }
);
