// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import {
  discoverProjectConfig,
  StudioConfigSchema,
  updateStudioConfig,
  type ProjectSnapshot
} from '@rune-langium/project-config';
import type { ProjectController } from './project-controller.js';
import { projectConfigurationPreconditions, projectRevisionAt } from './project-save-inputs.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

/** Shared YAML update and normal Save/readback, retaining unknown fields and comments. */
export const saveWorkspaceConfiguration = withInstrumentation(
  async function saveWorkspaceConfiguration(controller: ProjectController, snapshot: ProjectSnapshot, value: unknown) {
    if (controller.current()?.workspaceId !== snapshot.workspaceId)
      throw new Error('This workspace is no longer active.');
    const found = discoverProjectConfig(snapshot.files);
    if (found.diagnostics.some((issue) => issue.severity === 'error'))
      throw new Error(found.diagnostics.map((issue) => issue.message).join(' '));
    const source = found.studio ?? { path: 'studio-config.yml', text: 'schemaVersion: 1\n' };
    const next = StudioConfigSchema.parse(value);
    return controller.save(
      [
        {
          path: source.path,
          text: updateStudioConfig(source, next),
          expectedRevision: await projectRevisionAt(snapshot, source.path)
        }
      ],
      await projectConfigurationPreconditions(snapshot, [source.path])
    );
  },
  { op: 'saveWorkspaceConfiguration', capture: 0 }
);
