// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { projectFileRevision, type ProjectSnapshot, type ProjectSavePreconditions } from '@rune-langium/project-config';
import { withInstrumentation } from '../services/instrumentation/core.js';
export const projectRevisionAt = withInstrumentation(
  async function projectRevisionAt(snapshot: ProjectSnapshot, path: string): Promise<string | null> {
    const text = snapshot.files.get(path);
    return text === undefined ? null : (snapshot.fileRevisions.get(path) ?? (await projectFileRevision(text)));
  },
  { op: 'projectRevisionAt', capture: 0 }
);
export const projectConfigurationPreconditions = withInstrumentation(
  async function projectConfigurationPreconditions(snapshot: ProjectSnapshot): Promise<ProjectSavePreconditions> {
    const paths = new Set([
      'rune-config.yml',
      'rune-config.yaml',
      'build-config.yml',
      'build-config.yaml',
      'studio-config.yml',
      'studio-config.yaml',
      snapshot.project.build.runeConfig
    ]);
    return {
      inputs: await Promise.all(
        [...paths].map(async (path) => ({ path, revision: await projectRevisionAt(snapshot, path) }))
      )
    };
  },
  { op: 'projectConfigurationPreconditions', capture: 0 }
);
