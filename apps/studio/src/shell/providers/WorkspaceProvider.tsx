// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import type React from 'react';
import { useEffect, useState } from 'react';
import { WorkspaceStateContext, type WorkspaceState } from './workspace-context.js';
import { WorkspaceActionsContext, type WorkspaceActions } from '../perspectives/workspace-actions-context.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';
import { createProjectController, type ProjectController } from '../../workspace/project-controller.js';
import { ProjectContext, type ProjectState } from './project-context.js';
import { validateTargetOptions } from '@rune-langium/codegen/export';
import { projectDiagnosticsForTargets, type TargetValidator } from '@rune-langium/project-config';

const validateProjectTarget: TargetValidator = (target) =>
  validateTargetOptions(target.generator, target.options).errors.map((message) => ({
    code: 'TARGET_OPTIONS',
    severity: 'error',
    path: 'targets',
    message
  }));

interface Props {
  state: WorkspaceState;
  actions: WorkspaceActions;
  children: React.ReactNode;
}

export const WorkspaceProvider = withInstrumentation(
  function WorkspaceProvider({ state, actions, children }: Props): React.ReactElement {
    const [project, setProject] = useState<ProjectState>({ status: 'unavailable', diagnostics: [] });
    const workspaceId = state.workspaceId;
    const getAdapter = actions.getProjectFileAdapter;
    useEffect(() => {
      if (!workspaceId || !getAdapter) return;
      let cancelled = false;
      let controller: ProjectController | undefined;
      let unsubscribe: (() => void) | undefined;
      setProject({ workspaceId, status: 'loading', diagnostics: [] });
      void getAdapter(workspaceId)
        .then(async (adapter) => {
          if (cancelled) return;
          controller = createProjectController({ workspaceId, adapter, validateTarget: validateProjectTarget });
          const update = () => {
            if (cancelled || !controller) return;
            const diagnostics = controller.diagnostics();
            setProject({
              workspaceId,
              controller,
              snapshot: controller.current(),
              diagnostics,
              status: projectDiagnosticsForTargets(diagnostics).some((issue) => issue.severity === 'error')
                ? 'invalid'
                : 'ready'
            });
          };
          unsubscribe = controller.subscribe(update);
          await controller.load();
        })
        .catch((error: unknown) => {
          if (cancelled || controller) return;
          setProject({
            workspaceId,
            status: 'invalid',
            diagnostics: [
              {
                code: 'PROJECT_UNAVAILABLE',
                severity: 'error',
                path: '',
                message: error instanceof Error ? error.message : 'Project unavailable'
              }
            ]
          });
        });
      return () => {
        cancelled = true;
        unsubscribe?.();
        controller?.dispose();
      };
    }, [workspaceId, getAdapter]);
    // Never expose the previous workspace's snapshot during the effect handoff.
    const currentProject: ProjectState =
      project.workspaceId === workspaceId && getAdapter
        ? project
        : {
            workspaceId,
            status: workspaceId && getAdapter ? 'loading' : 'unavailable',
            diagnostics: []
          };
    return (
      <WorkspaceActionsContext.Provider value={actions}>
        <WorkspaceStateContext.Provider value={state}>
          <ProjectContext.Provider value={currentProject}>{children}</ProjectContext.Provider>
        </WorkspaceStateContext.Provider>
      </WorkspaceActionsContext.Provider>
    );
  },
  { op: 'WorkspaceProvider' }
);
