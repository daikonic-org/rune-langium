// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useEditorStore } from '@rune-langium/visual-editor';
import { registerProjectNamespaceHydrator } from '../../services/project-namespace-hydration.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectRuntimeInput } from '../../services/project-runtime-input.js';
import type { ProjectRuntimeState } from './project-context.js';
import type { WorkspaceState } from './workspace-context.js';
import {
  mergeProjectReferenceFiles,
  prepareProjectReferenceView,
  type ProjectReferenceInventory
} from '../../services/project-reference-view.js';
import { installProjectParserDocuments } from '../../services/workspace.js';
import { createProjectReferenceHydrator } from '../../services/project-reference-hydrator.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

export const useProjectReferenceView = withInstrumentation(
  function useProjectReferenceView(runtime: ProjectRuntimeState, state: WorkspaceState) {
    const latestView = useRef<WorkspaceState | undefined>(undefined);
    const referenceDocuments = useRef<ProjectRuntimeInput['referenceDocuments'] | undefined>(undefined);
    const [attempt, setAttempt] = useState(0);
    const retry = useCallback(() => setAttempt((value) => value + 1), []);
    const [published, setPublished] = useState<{
      workspaceId?: string;
      input: typeof runtime.input;
      parsed: WorkspaceState['parsedModels'];
      files: WorkspaceState['files'];
      view?: WorkspaceState;
      inventory?: ProjectReferenceInventory;
      preparing?: boolean;
      error?: string;
    }>();
    useEffect(() => {
      const input = runtime.input;
      if (!runtime.managed) return;
      if (!input)
        return state.workspaceId
          ? registerProjectNamespaceHydrator(state.workspaceId, async () => {
              throw new Error('The current project reference capture is not ready. Retry once loading completes.');
            })
          : undefined;
      const abort = new AbortController();
      const sameReferenceCapture = referenceDocuments.current === input.referenceDocuments;
      if (!sameReferenceCapture) {
        // Reset before publishing inventory so new selections queued during linking survive.
        useEditorStore.getState().resetHydration();
        referenceDocuments.current = input.referenceDocuments;
        latestView.current = undefined;
      }
      const work = prepareProjectReferenceView(
        input,
        state,
        installProjectParserDocuments,
        abort.signal,
        undefined,
        (inventory) => {
          if (abort.signal.aborted) return;
          setPublished((previous) => ({
            workspaceId: state.workspaceId,
            input,
            parsed: state.parsedModels,
            files: state.files,
            view: previous && previous.workspaceId === state.workspaceId ? previous.view : undefined,
            inventory,
            preparing: true
          }));
        }
      );
      let currentView: WorkspaceState | undefined;
      void work
        .then((view) => {
          currentView = view;
          if (!abort.signal.aborted) {
            const previous = latestView.current;
            const retained =
              sameReferenceCapture && previous && previous.workspaceId === state.workspaceId
                ? previous.parsedModels.filter((model) => {
                    const old = previous.files.find((file) => file.path === model.filePath);
                    const next = view.files.find((file) => file.path === model.filePath);
                    return old?.refOnly && next?.refOnly && old.serializedModelJson === next.serializedModelJson;
                  })
                : [];
            const parsedModels = [
              ...view.parsedModels,
              ...retained.filter((model) => !view.parsedModels.some((entry) => entry.filePath === model.filePath))
            ];
            currentView = retained.length
              ? { ...view, parsedModels, models: parsedModels.map((entry) => entry.model) }
              : view;
            latestView.current = currentView;
            setPublished({
              workspaceId: state.workspaceId,
              input,
              parsed: state.parsedModels,
              files: state.files,
              view: currentView
            });
          }
        })
        .catch((error) => {
          if (!abort.signal.aborted)
            setPublished((previous) => ({
              workspaceId: state.workspaceId,
              input,
              parsed: state.parsedModels,
              files: state.files,
              view: previous && previous.workspaceId === state.workspaceId ? previous.view : undefined,
              error: error instanceof Error ? error.message : 'Reference view unavailable.'
            }));
        });
      const unregister = state.workspaceId
        ? registerProjectNamespaceHydrator(
            state.workspaceId,
            createProjectReferenceHydrator({
              ready: work,
              current: () => currentView,
              selected: () => useEditorStore.getState().selectedNodeId,
              signal: abort.signal,
              publish: (materialized) => {
                currentView = materialized;
                latestView.current = materialized;
                setPublished((previous) =>
                  previous?.input === input ? { ...previous, view: materialized } : previous
                );
              }
            })
          )
        : undefined;
      return () => {
        abort.abort();
        unregister?.();
      };
    }, [runtime.managed, runtime.input, state.files, state.parsedModels, attempt]);
    const view = runtime.managed && published?.workspaceId === state.workspaceId ? published?.view : undefined;
    const current =
      published?.workspaceId === state.workspaceId &&
      published?.input === runtime.input &&
      published?.parsed === state.parsedModels &&
      published?.files === state.files;
    const inventory = current ? published?.inventory : undefined;
    const referenceFiles = inventory?.files ?? view?.files;
    const files = useMemo(
      () => (referenceFiles ? mergeProjectReferenceFiles(state.files, referenceFiles) : state.files),
      [state.files, referenceFiles]
    );
    if (!runtime.managed) return { state, referenceView: undefined };
    const error = current ? published?.error : undefined;
    const pending =
      !current || !runtime.input || published?.preparing || error?.startsWith('Waiting for the parser snapshot');
    return {
      state:
        view || inventory
          ? {
              ...state,
              files,
              models: view?.models ?? state.models,
              parsedModels: view?.parsedModels ?? state.parsedModels,
              deferredExports: inventory?.deferredExports ?? view?.deferredExports ?? state.deferredExports,
              curatedCacheSeeds: inventory?.curatedCacheSeeds ?? view?.curatedCacheSeeds ?? state.curatedCacheSeeds
            }
          : state,
      referenceView: {
        status: pending ? ('loading' as const) : error ? ('unavailable' as const) : ('ready' as const),
        diagnostics:
          error && !pending
            ? [{ code: 'REFERENCE_VIEW_UNAVAILABLE', severity: 'error' as const, path: '', message: error }]
            : [],
        retry
      }
    };
  },
  {
    op: 'useProjectReferenceView',
    capture: 0,
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
