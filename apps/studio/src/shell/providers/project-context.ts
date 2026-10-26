// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { createContext, useContext } from 'react';
import type { ProjectDiagnostic, ProjectSnapshot } from '@rune-langium/project-config';
import type { ProjectController } from '../../workspace/project-controller.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

import type { ProjectRuntimeInput } from '../../services/project-runtime-input.js';
export interface ProjectRuntimeState {
  retry?: () => void;
  /** Re-read moving references after an accepted review, even if saved config is unchanged. */
  refresh?: () => void;
  managed: boolean;
  status: 'legacy' | 'loading' | 'captured' | 'unavailable';
  input?: ProjectRuntimeInput;
  diagnostics: readonly ProjectDiagnostic[];
}
export interface ProjectState {
  referenceView?: {
    status: 'loading' | 'ready' | 'unavailable';
    diagnostics: readonly ProjectDiagnostic[];
    retry: () => void;
  };
  runtime?: ProjectRuntimeState;
  workspaceId?: string;
  controller?: ProjectController;
  snapshot?: ProjectSnapshot;
  status: 'unavailable' | 'loading' | 'ready' | 'invalid';
  diagnostics: readonly ProjectDiagnostic[];
}
export const ProjectContext = createContext<ProjectState>({ status: 'unavailable', diagnostics: [] });
export const useProject = withInstrumentation(
  function useProject(): ProjectState {
    return useContext(ProjectContext);
  },
  { op: 'useProject' }
);
