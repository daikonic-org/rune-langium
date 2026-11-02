// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useEditorStore } from '@rune-langium/visual-editor';
import { pathToUri } from '../../utils/uri.js';
import { registerProjectNamespaceHydrator } from '../../services/project-namespace-hydration.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectRuntimeInput } from '../../services/project-runtime-input.js';
import type { ProjectRuntimeState } from './project-context.js';
import type { WorkspaceState } from './workspace-context.js';
import {
  mergeProjectReferenceFiles,
  prepareProjectReferenceView,
  materializeProjectReferenceView
} from '../../services/project-reference-view.js';
import { installProjectParserDocuments, linkDocument } from '../../services/workspace.js';
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
      const work = prepareProjectReferenceView(input, state, installProjectParserDocuments, abort.signal);
      let currentView: WorkspaceState | undefined;
      void work
        .then((view) => {
          currentView = view;
          if (!abort.signal.aborted) {
            const sameReferenceCapture = referenceDocuments.current === input.referenceDocuments;
            if (!sameReferenceCapture) {
              useEditorStore.getState().resetHydration();
              referenceDocuments.current = input.referenceDocuments;
            }
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
        ? registerProjectNamespaceHydrator(state.workspaceId, async (namespaces) => {
            const view = currentView ?? (await work);
            abort.signal.throwIfAborted();
            const requested = new Set(namespaces);
            const targets = view.files.filter((file) => file.refOnly && requested.has(file.namespace ?? ''));
            if ([...requested].some((namespace) => !view.files.some((file) => file.namespace === namespace)))
              throw new Error('Requested namespace is absent from the current verified reference inventory');
            const results = await Promise.all(targets.map((file) => linkDocument(pathToUri(file.path), true)));
            abort.signal.throwIfAborted();
            if (results.some((result) => !result.linked || result.errors.length))
              throw new Error(
                results.flatMap((result) => result.errors).join('\n') || 'Reference namespace is unavailable'
              );
            const additions = results.flatMap((result) => result.newModels);
            // Materialization can fail: reject through the namespace request's
            // normal error channel, rather than throwing inside React's updater.
            currentView = materializeProjectReferenceView(currentView ?? view, additions);
            latestView.current = currentView;
            const materialized = currentView;
            setPublished((previous) => (previous?.input === input ? { ...previous, view: materialized } : previous));
          })
        : undefined;
      return () => {
        abort.abort();
        unregister?.();
      };
    }, [runtime.managed, runtime.input, state.files, state.parsedModels, attempt]);
    const view = runtime.managed && published?.workspaceId === state.workspaceId ? published?.view : undefined;
    const files = useMemo(
      () => (view ? mergeProjectReferenceFiles(state.files, view.files) : state.files),
      [state.files, view?.files]
    );
    if (!runtime.managed) return { state, referenceView: undefined };
    const current =
      published?.workspaceId === state.workspaceId &&
      published?.input === runtime.input &&
      published?.parsed === state.parsedModels &&
      published?.files === state.files;
    const error = current ? published?.error : undefined;
    const pending = !current || !runtime.input || error?.startsWith('Waiting for the parser snapshot');
    return {
      state: view
        ? {
            ...state,
            files,
            models: view.models,
            parsedModels: view.parsedModels,
            deferredExports: view.deferredExports,
            curatedCacheSeeds: view.curatedCacheSeeds
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
