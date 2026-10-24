// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WorkspaceStateContext, type WorkspaceState } from './workspace-context.js';
import { WorkspaceActionsContext, type WorkspaceActions } from '../perspectives/workspace-actions-context.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';
import {
  createGitHubInitializationSession,
  detectProjectInitialization
} from '../../workspace/project-initialization.js';
import { createProjectController, type ProjectController } from '../../workspace/project-controller.js';
import { useProjectReferenceView } from './use-project-reference-view.js';
import { useProjectRuntime } from './use-project-runtime.js';
import { ProjectContext, type ProjectState } from './project-context.js';
import { validateProjectTarget } from '@rune-langium/project-runtime/browser';
import { notifySyncOnSave } from '../../services/git-sync.js';
import { createPresentationRepository } from '../../workspace/form-presentation-repository.js';
import { useFormPresentationStore } from '../../store/form-presentation-store.js';
import { createExampleRepository } from '../../workspace/example-repository.js';
import { resolveExampleType } from '../../workspace/example-identity.js';
import { useInstanceStore } from '../../store/instance-store.js';
import { projectDiagnosticsForTargets, readProjectFiles } from '@rune-langium/project-config';

interface Props {
  state: WorkspaceState;
  actions: WorkspaceActions;
  children: React.ReactNode;
}

export const WorkspaceProvider = withInstrumentation(
  function WorkspaceProvider({ state, actions, children }: Props): React.ReactElement {
    const [project, setProject] = useState<ProjectState>({ status: 'unavailable', diagnostics: [] });
    const stateRef = useRef(state);
    stateRef.current = state;
    const workspaceId = state.workspaceId;
    const getLegacy = actions.getLegacyExampleStorage;
    const getAdapter = actions.getProjectFileAdapter;
    const getInitializationAdapter = actions.getProjectInitializationFileAdapter ?? getAdapter;
    const openProjectInitialization = useCallback(
      async (id: string) => {
        if (!getInitializationAdapter) return undefined;
        const adapter = await getInitializationAdapter(id);
        const captured = await readProjectFiles(adapter);
        await captured.verify();
        if (detectProjectInitialization(captured.files).kind !== 'maven') return undefined;
        return createGitHubInitializationSession(
          createProjectController({
            workspaceId: id,
            adapter,
            validateTarget: validateProjectTarget,
            onSaved: () => notifySyncOnSave(id)
          })
        );
      },
      [getInitializationAdapter]
    );
    const projectActions = useMemo(
      () => ({ ...actions, openProjectInitialization: actions.openProjectInitialization ?? openProjectInitialization }),
      [actions, openProjectInitialization]
    );
    useEffect(() => {
      useInstanceStore.getState().setExampleRepository(undefined);
      if (!workspaceId || !getAdapter) return;
      let cancelled = false;
      let controller: ProjectController | undefined;
      let unsubscribe: (() => void) | undefined;
      let repositoriesAttached = false;
      setProject({ workspaceId, status: 'loading', diagnostics: [] });
      void getAdapter(workspaceId)
        .then(async (adapter) => {
          if (cancelled) return;
          controller = createProjectController({
            workspaceId,
            adapter,
            validateTarget: validateProjectTarget,
            onSaved: () => notifySyncOnSave(workspaceId)
          });
          const update = () => {
            if (cancelled || !controller) return;
            const diagnostics = controller.diagnostics();
            const ready = !projectDiagnosticsForTargets(diagnostics).some((issue) => issue.severity === 'error');
            setProject({
              workspaceId,
              controller,
              snapshot: controller.current(),
              diagnostics,
              status: ready ? 'ready' : 'invalid'
            });
            if (ready && controller.current() && !repositoriesAttached) {
              repositoriesAttached = true;
              const owned = controller;
              void (async () => {
                const legacy = await getLegacy?.(workspaceId);
                if (cancelled) return;
                void useFormPresentationStore
                  .getState()
                  .setRepository(
                    workspaceId,
                    createPresentationRepository({ controller: owned, source: () => stateRef.current })
                  );
                useInstanceStore.getState().setExampleRepository(
                  createExampleRepository({
                    workspaceId,
                    controller: owned,
                    legacy,
                    resolveType: (record) =>
                      stateRef.current.workspaceId === workspaceId
                        ? resolveExampleType(stateRef.current, record)
                        : undefined
                  })
                );
              })().catch((error: unknown) => {
                if (cancelled) return;
                repositoriesAttached = false;
                setProject((previous) => ({
                  ...previous,
                  status: 'invalid',
                  diagnostics: [
                    ...previous.diagnostics,
                    {
                      code: 'PROJECT_REPOSITORY_UNAVAILABLE',
                      severity: 'error',
                      path: '',
                      message:
                        error instanceof Error
                          ? error.message
                          : 'Project repositories are unavailable. Reload to retry.'
                    }
                  ]
                }));
              });
            }
          };
          unsubscribe = controller.subscribe(update);
          await controller.recover();
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
        void useFormPresentationStore.getState().setRepository(workspaceId, undefined);
        useInstanceStore.getState().setExampleRepository(undefined);
      };
    }, [workspaceId, getAdapter, getLegacy]);
    // Never expose the previous workspace's snapshot during the effect handoff.
    const currentProject: ProjectState =
      project.workspaceId === workspaceId && getAdapter
        ? project
        : {
            workspaceId,
            status: workspaceId && getAdapter ? 'loading' : 'unavailable',
            diagnostics: []
          };
    const capturedRuntime = useProjectRuntime(currentProject, state.files);
    const view = useProjectReferenceView(capturedRuntime, state);
    const runtime = capturedRuntime;
    stateRef.current = view.state;
    return (
      <WorkspaceActionsContext.Provider value={projectActions}>
        <WorkspaceStateContext.Provider value={view.state}>
          <ProjectContext.Provider value={{ ...currentProject, runtime, referenceView: view.referenceView }}>
            {children}
          </ProjectContext.Provider>
        </WorkspaceStateContext.Provider>
      </WorkspaceActionsContext.Provider>
    );
  },
  { op: 'WorkspaceProvider' }
);
