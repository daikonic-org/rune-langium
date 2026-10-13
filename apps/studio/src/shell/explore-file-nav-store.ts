// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Explore's file-navigation surface — narrow zustand store (shared-perspective-
 * chrome plan, Task 3 prep). Formerly local `useState` in `ExplorePerspective`;
 * lifted here so a sibling `ExploreCenterSlot` component (the FileTabStrip,
 * mounted from `AppHeader`'s centerSlot) can read/write the same active file
 * and git-sync status without prop-threading from `ExplorePerspective`'s body.
 *
 * Scope is intentionally narrow — this is EXPLORE's navigation state, not
 * global chrome state. It does NOT hold `combinedFileDiagnostics`: that value
 * is a pure derivation over `useWorkspace()` (files/parseErrors) and
 * `useDiagnosticsStore()` (fileDiagnostics), so any consumer recomputes it via
 * the shared helpers in `explore-diagnostics.ts` rather than a second stored
 * copy (single source, no duplication).
 */

import { create } from 'zustand';
import { withInstrumentation } from '../services/instrumentation/core.js';
import type { WorkspaceFile } from '../services/workspace.js';
import type { SyncStatus } from '@rune-langium/git-sync-engine';

interface ExploreFileNavState {
  requestedSourceFile: string | undefined;
  activeEditorFile: string | undefined;
  syncStatus: SyncStatus | null;
}

interface ExploreFileNavActions {
  /** Open a searched file and reveal the companion Source pane. */
  requestSourceFile(filePath: string): void;
  clearSourceRequest(): void;
  setActiveEditorFile(file: string | undefined | ((prev: string | undefined) => string | undefined)): void;
  /** Opens `filePath` in the source editor. Kept as a named action (not just
   *  `setActiveEditorFile`) because it is the primitive every navigation call
   *  site (structure view, LSP-driven opens, diagnostics jump-to-file, the
   *  tab strip) already calls by this name — renaming it would touch every
   *  one of those call sites for no behavioral reason. */
  openFileInSource(filePath: string): void;
  setSyncStatus(status: SyncStatus | null): void;
}

type ExploreFileNavStore = ExploreFileNavState & ExploreFileNavActions;

export const useExploreFileNavStore = create<ExploreFileNavStore>((set) => ({
  activeEditorFile: undefined,
  requestedSourceFile: undefined,

  requestSourceFile(filePath) {
    set({ activeEditorFile: filePath, requestedSourceFile: filePath });
  },
  clearSourceRequest() {
    set({ requestedSourceFile: undefined });
  },
  syncStatus: null,

  setActiveEditorFile(file) {
    set((state) => ({
      activeEditorFile: typeof file === 'function' ? file(state.activeEditorFile) : file
    }));
  },

  openFileInSource(filePath) {
    set({ activeEditorFile: filePath });
  },

  setSyncStatus(status) {
    set({ syncStatus: status });
  }
}));

/** Resolve parser identities against editor files, including deferred curated source. */
export const resolveEditorFilePath = withInstrumentation(
  function resolveEditorFilePath(parserPath: string | undefined, files: readonly WorkspaceFile[]): string | undefined {
    if (!parserPath) return undefined;
    const file =
      files.find((entry) => entry.path === parserPath) ??
      files.find((entry) => {
        if (!entry.refOnly || !entry.bundleId) return false;
        const prefix = `[${entry.bundleId}]/`;
        return entry.path.startsWith(prefix) && `${entry.bundleId}/${entry.path.slice(prefix.length)}` === parserPath;
      });
    return file?.path;
  },
  { op: 'resolveEditorFilePath' }
);

export interface HydratedSourceRequest {
  bundleId: string;
  bundleVersion: string;
  namespace: string;
  path: string;
  nodeId?: string;
  artifactKey?: string;
}

/** Preserve document ownership when hydration replaces a catalogue placeholder. */
export const resolveHydratedSourcePath = withInstrumentation(
  function resolveHydratedSourcePath(
    request: HydratedSourceRequest,
    files: readonly WorkspaceFile[],
    hydratedNamespaces: readonly string[],
    resolvedDeclarationPath?: string
  ): string | undefined {
    const path = resolveEditorFilePath(request.nodeId ? resolvedDeclarationPath : request.path, files);
    const file = path ? files.find((candidate) => candidate.path === path) : undefined;
    if (
      !file?.refOnly ||
      file.bundleId !== request.bundleId ||
      file.bundleVersion !== request.bundleVersion ||
      file.namespace !== request.namespace ||
      (request.artifactKey !== undefined && file.artifactKey !== request.artifactKey)
    )
      return undefined;
    return file.artifactKey || hydratedNamespaces.includes(request.namespace) ? file.path : undefined;
  },
  { op: 'resolveHydratedSourcePath' }
);
