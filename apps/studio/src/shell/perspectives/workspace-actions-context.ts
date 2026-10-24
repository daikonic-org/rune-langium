// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { createContext, useContext } from 'react';
import type { GitHubInitializationSession } from '../../workspace/project-initialization.js';
import type { WorkspaceFile } from '../../services/workspace.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';
import type { ProjectFileAdapter } from '@rune-langium/project-config';
import type { StarterProject } from '../../services/starter-registry.js';
import type { LegacyExampleStorage } from '../../opfs/instances-fs.js';

/**
 * Actions + data the WorkspacesPerspective launcher needs, lifted from
 * App.tsx prop-drilling via context so PerspectiveHost doesn't need
 * knowledge of workspace state. App provides this context value.
 */
export interface WorkspaceActions {
  onStartBlankWorkspace?: () => void | Promise<void>;
  onOpenStarter?: (starter: StarterProject, signal: AbortSignal) => Promise<unknown>;
  onOpenFolder?: () => Promise<void>;
  /** Working-copy IO bound to an explicit workspace, with live ownership checks. */
  getProjectFileAdapter?: (workspaceId: string) => Promise<ProjectFileAdapter>;
  /** Limited typed legacy records for migration; never the private filesystem itself. */
  getLegacyExampleStorage?: (workspaceId: string) => Promise<LegacyExampleStorage>;
  /** Optional native configuration review, bound to an already cloned working copy. */
  openProjectInitialization?: (workspaceId: string) => Promise<GitHubInitializationSession | undefined>;
  /** Current workspace files — forwarded to FileLoader as `existingFiles`. */
  files: WorkspaceFile[];
  /** Finish editor publication and persist the active working-copy files. */
  flushWorkspaceSave?: () => Promise<void>;
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
  onGitHubWorkspaceCreated: (workspaceId: string) => void | Promise<void>;
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
