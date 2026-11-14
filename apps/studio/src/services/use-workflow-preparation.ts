// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useEffect, useRef, useState } from 'react';
import { canonicalProjectJson, type WorkflowPreparation } from '@rune-langium/project-config';
import { useProject } from '../shell/providers/project-context.js';
import { useWorkspaceOptional } from '../shell/providers/workspace-context.js';
import type { FunctionSessionState } from '../store/function-session-store.js';
import type { PreviewSessionClient } from './preview-session-client.js';
import { projectRuntimeSources } from './project-runtime-input.js';
import { prepareWorkflowData, savePreparedWorkflowData, type PreparedWorkflowData } from './prepared-workflow.js';
import { executePreparedWorkflow } from './prepared-preview.js';
import { loadWorkspaceToken } from './github-auth.js';
import { OpfsFs } from '../opfs/opfs-fs.js';
import { withInstrumentation } from './instrumentation/core.js';

export const useWorkflowPreparation = withInstrumentation(
  function useWorkflowPreparation(preparation: WorkflowPreparation | undefined, state: FunctionSessionState) {
    const project = useProject(),
      workspace = useWorkspaceOptional();
    const fingerprint = preparation
      ? canonicalProjectJson([
          workspace?.workspaceId,
          project.runtime?.status,
          project.runtime?.input?.receipt,
          preparation,
          state.functionFqn,
          state.inputs,
          Object.fromEntries(projectRuntimeSources(workspace?.files ?? [], project.snapshot))
        ])
      : undefined;
    const live = useRef({ fingerprint, project, workspace, preparation });
    live.current = { fingerprint, project, workspace, preparation };
    const [accepted, setAccepted] = useState<{ data: PreparedWorkflowData; isCurrent(): boolean }>();
    const [phase, setPhase] = useState<'preparing' | 'calculating'>();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string>();
    const runVersion = useRef(0);
    useEffect(() => {
      setAccepted(undefined);
      setPhase(undefined);
      setError(undefined);
    }, [fingerprint]);

    const execute: PreviewSessionClient['execute'] = async (fqn, inputs, signal) => {
      const captured = live.current;
      const runtime = captured.project.runtime;
      if (!captured.preparation || runtime?.status !== 'captured' || !runtime.input || !captured.workspace?.workspaceId)
        throw new Error('Open a current saved project before preparing data.');
      const isCurrent = () => !signal.aborted && live.current.fingerprint === captured.fingerprint;
      const version = ++runVersion.current;
      setAccepted(undefined);
      setError(undefined);
      setPhase('preparing');
      try {
        const token = await loadWorkspaceToken(
          new OpfsFs(await navigator.storage.getDirectory()),
          captured.workspace.workspaceId
        );
        signal.throwIfAborted();
        if (!token) throw new Error('Connect this workspace to GitHub to prepare example data.');
        const data = await prepareWorkflowData(runtime.input, captured.preparation, inputs, {
          token,
          signal,
          isCurrent
        });
        if (!isCurrent()) throw new DOMException('Preparation superseded.', 'AbortError');
        setPhase('calculating');
        const output = await executePreparedWorkflow(data, fqn, inputs, signal);
        if (!isCurrent()) throw new DOMException('Prepared calculation superseded.', 'AbortError');
        setAccepted({ data, isCurrent });
        return output;
      } finally {
        if (version === runVersion.current) setPhase(undefined);
      }
    };
    return {
      execute,
      phase,
      prepared: accepted?.isCurrent() ? accepted.data : undefined,
      saving,
      error,
      async save() {
        const controller = live.current.project.controller;
        if (!controller || !accepted || !accepted.isCurrent()) return;
        setSaving(true);
        setError(undefined);
        try {
          await savePreparedWorkflowData(controller, accepted.data, accepted.isCurrent);
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : 'Prepared data could not be saved.');
        } finally {
          setSaving(false);
        }
      }
    };
  },
  {
    op: 'useWorkflowPreparation',
    capture: 0,
    sanitizeError: (error) => ({ signature: error instanceof Error ? error.name : 'Error' })
  }
);
