// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { createContext, useContext } from 'react';
import type { WorkspaceFile } from '../../services/workspace.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';
import type { ProjectFileAdapter } from '@rune-langium/project-config';

/**
 * Actions + data the WorkspacesPerspective launcher needs, lifted from
 * App.tsx prop-drilling via context so PerspectiveHost doesn't need
 * knowledge of workspace state. App provides this context value.
 */
export interface WorkspaceActions {
  /** Working-copy IO bound to an explicit workspace, with live ownership checks. */
  getProjectFileAdapter?: (workspaceId: string) => Promise<ProjectFileAdapter>;
  /** Current workspace files — forwarded to FileLoader as `existingFiles`. */
  files: WorkspaceFile[];
  registerEditorSaveBarrier?: (flush: () => Promise<void>) => () => void;
  /** Called when the user loads files via drag-drop / file picker / new. */
  onFilesLoaded: (files: WorkspaceFile[]) => void;
  /**
   * Creates a git-backed workspace (GitHub flow). Matches the shape that
   * FileLoader's `createGitBackedWorkspace` prop expects.
   */
  createGitBackedWorkspace: (input: {
    name: string;
    repoUrl: string;
    branch: string;
    user: string;
    token: string;
  }) => Promise<{ id: string }>;
  /** Notified when the GitHub workspace creation flow completes. */
  onGitHubWorkspaceCreated: (workspaceId: string) => void;
  /** Open an existing workspace by id (WorkspaceSwitcher onOpen). */
  onOpenWorkspace: (workspaceId: string) => void;
  /** Create a new blank workspace (WorkspaceSwitcher onCreate). */
  onCreateWorkspace: () => void;
  /** Delete a workspace by id (WorkspaceSwitcher onDelete). */
  onDeleteWorkspace: (workspaceId: string) => void;
  /**
   * Persist + reparse workspace file content changes (e.g. source-editor
   * edits). Sourced by EditorPage in place of its former `onFilesChange` prop.
   */
  onFilesChange: (files: WorkspaceFile[]) => void;
  /** Load original source for one selected curated namespace. */
  loadCuratedSource: (bundleId: string, version: string, namespace: string, artifactKey?: string) => Promise<void>;
  /** Close the active workspace and return to the launcher (EditorPage topbar). */
  onClose: () => void;
  /**
   * Switch to a different workspace from the EditorPage topbar dropdown.
   * Same handler as {@link onOpenWorkspace}; kept under its EditorPage-facing
   * name so the topbar reads it directly from context.
   */
  onSwitchWorkspace: (workspaceId: string) => void;
}

export const WorkspaceActionsContext = createContext<WorkspaceActions | null>(null);

export const useWorkspaceActions = withInstrumentation(
  function useWorkspaceActions(): WorkspaceActions {
    const v = useContext(WorkspaceActionsContext);
    if (!v) throw new Error('useWorkspaceActions must be used within a WorkspaceActionsContext provider');
    return v;
  },
  { op: 'useWorkspaceActions' }
);

export const useWorkspaceActionsOptional = withInstrumentation(
  function useWorkspaceActionsOptional(): WorkspaceActions | null {
    return useContext(WorkspaceActionsContext);
  },
  { op: 'useWorkspaceActionsOptional' }
);
