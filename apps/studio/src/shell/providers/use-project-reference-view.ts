// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectRuntimeState } from './project-context.js';
import type { WorkspaceState } from './workspace-context.js';
import { mergeProjectReferenceFiles, prepareProjectReferenceView } from '../../services/project-reference-view.js';
import { installProjectParserDocuments } from '../../services/workspace.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

export const useProjectReferenceView = withInstrumentation(
  function useProjectReferenceView(runtime: ProjectRuntimeState, state: WorkspaceState) {
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
      if (!runtime.managed || !input) return;
      const abort = new AbortController();
      void prepareProjectReferenceView(input, state, installProjectParserDocuments, abort.signal)
        .then((view) => {
          if (!abort.signal.aborted)
            setPublished({
              workspaceId: state.workspaceId,
              input,
              parsed: state.parsedModels,
              files: state.files,
              view
            });
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
      return () => abort.abort();
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
