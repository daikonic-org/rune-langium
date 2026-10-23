// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { discoverProjectConfig, updateBuildConfig } from './config-codec.js';
import type { BuildConfig, ProjectDiagnostic, ProjectFiles } from './types.js';
import type { ProjectWrite } from './project-files.js';

/** One lossless companion-file write path for migration and explicit target Save. */
export function prepareBuildConfigSave(input: {
  files: ProjectFiles;
  revisions: ReadonlyMap<string, string>;
  build: BuildConfig;
  modelName: string;
}): { writes: ProjectWrite[]; diagnostics: ProjectDiagnostic[] } {
  const found = discoverProjectConfig(input.files);
  if (found.diagnostics.length) return { writes: [], diagnostics: found.diagnostics };
  const document = found.build ?? { path: 'build-config.yml', text: 'schemaVersion: 1\n' };
  const expectedRevision = found.build ? input.revisions.get(document.path) : null;
  if (expectedRevision === undefined)
    return {
      writes: [],
      diagnostics: [
        {
          code: 'MIGRATION_REVISION_REQUIRED',
          severity: 'error',
          path: document.path,
          message: 'Reload project files before saving configuration.'
        }
      ]
    };
  const writes: ProjectWrite[] = [
    { path: document.path, text: updateBuildConfig(document, input.build), expectedRevision }
  ];
  if (
    input.build.runeConfig === 'rune-config.yml' &&
    !input.files.has('rune-config.yml') &&
    !input.files.has('rune-config.yaml')
  )
    writes.push({
      path: 'rune-config.yml',
      text: JSON.stringify({ model: { name: input.modelName } }, null, 2) + '\n',
      expectedRevision: null
    });
  return { writes, diagnostics: [] };
}
