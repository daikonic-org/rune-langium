// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { createContext, useContext } from 'react';
import type { WorkspaceKind } from '../../workspace/persistence.js';
import type { WorkspaceFile, ParsedWorkspaceModel } from '../../services/workspace.js';
import type { RosettaModel } from '@rune-langium/core';
import type { DeferredExportEntry } from '../../workers/parser-worker.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

/** Current loaded-model data published by WorkspaceProvider. Value swaps per
 *  workspace; the provider component never remounts. */
export interface WorkspaceState {
  workspaceId?: string;
  /** Current App parse/activation epoch; ephemeral, never persisted. */
  workspaceEpoch?: number;
  workspaceKind?: WorkspaceKind;
  workspaceName?: string;
  fileCount: number;
  files: ReadonlyArray<WorkspaceFile>;
  models: RosettaModel[];
  parsedModels: ParsedWorkspaceModel[];
  deferredExports: DeferredExportEntry[];
  parseErrors: Map<string, string[]>;
}

export const WorkspaceStateContext = createContext<WorkspaceState | null>(null);

export const useWorkspace = withInstrumentation(
  function useWorkspace(): WorkspaceState {
    const ctx = useContext(WorkspaceStateContext);
    if (ctx === null) {
      throw new Error('useWorkspace must be used within a WorkspaceProvider');
    }
    return ctx;
  },
  { op: 'useWorkspace' }
);

export const useWorkspaceOptional = withInstrumentation(
  function useWorkspaceOptional(): WorkspaceState | null {
    return useContext(WorkspaceStateContext);
  },
  { op: 'useWorkspaceOptional' }
);
