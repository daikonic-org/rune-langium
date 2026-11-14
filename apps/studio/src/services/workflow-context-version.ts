// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { canonicalProjectJson } from '@rune-langium/project-config';
import type { RosettaModel } from '@rune-langium/core';
import type { ProjectState } from '../shell/providers/project-context.js';
import { withInstrumentation } from './instrumentation/core.js';

/** Managed previews use the captured project, independently of read-only explorer publication. */
export const workflowContextVersion = withInstrumentation(
  function workflowContextVersion(
    project: ProjectState,
    models: RosettaModel[] | undefined
  ): { models: RosettaModel[] | undefined; projectRevision: string } {
    const managed = project.runtime?.managed;
    return {
      models: managed ? undefined : models,
      projectRevision: canonicalProjectJson([
        project.workspaceId,
        managed ? project.runtime?.input?.receipt : project.snapshot?.revision
      ])
    };
  },
  { op: 'workflowContextVersion', capture: 0 }
);
