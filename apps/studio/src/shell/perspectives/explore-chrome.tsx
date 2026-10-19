// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Explore's chrome — the center (FileTabStrip) and actions (Validate /
 * Export Code / Share / Import) slots declared by the `explore` registry
 * entry, rendered by `AppHeader` (shared-perspective-chrome plan, Task 3).
 * Content MOVED VERBATIM from `ExplorePerspective`'s private header; each is
 * a zero-arg component reading its own hooks/stores rather than props
 * threaded from `ExplorePerspective` — the FileTabStrip's real dependencies
 * (activeEditorFile, openFileInSource, combinedFileDiagnostics) now come from
 * `useWorkspace()`, `useDiagnosticsStore()`, and `explore-file-nav-store.ts`.
 */

import { useMemo } from 'react';
import { Check, Download, Share2, Wand2, Plus, X } from 'lucide-react';
import { Button } from '@rune-langium/design-system/ui/button';
import type { WorkspaceFile } from '../../services/workspace.js';
import { createBlankWorkspaceFile, isUserWorkspaceFile } from '../../services/workspace.js';
import { useWorkspace } from '../providers/workspace-context.js';
import { useWorkspaceActions } from './workspace-actions-context.js';
import { useDiagnosticsStore } from '../../store/diagnostics-store.js';
import { combineFileDiagnostics } from '../explore-diagnostics.js';
import { useExploreFileNavStore } from '../explore-file-nav-store.js';
import { useImportDialogStore } from '../import-dialog-store.js';
import { useExportNavigationStore } from '../../services/export-navigation.js';
import { usePerspectiveStore } from '../../store/perspective-store.js';
import { useEditorStore } from '@rune-langium/visual-editor';
import type { LspDiagnostic } from '../../store/diagnostics-store.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';

/** Stable module-level reference — same rationale as ExplorePerspective's
 *  EMPTY_PARSE_ERRORS: avoids a fresh Map() on every render that would
 *  false-positive the useMemo dep check below when parseErrors is absent. */
const EMPTY_PARSE_ERRORS: ReadonlyMap<string, string[]> = new Map();

function getFileKindBadge(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() : '';
  switch (ext) {
    case 'rosetta':
      return 'DSL';
    case 'json':
      return 'JSON';
    case 'yaml':
    case 'yml':
      return 'YAML';
    case 'ts':
      return 'TS';
    case 'js':
      return 'JS';
    case 'md':
      return 'MD';
    default:
      return ext ? ext.slice(0, 4).toUpperCase() : 'FILE';
  }
}

/** Count error (severity 1) and warning (severity 2) diagnostics for a file. */
function countFileDiagnostics(diagnostics: readonly LspDiagnostic[] | undefined): {
  errors: number;
  warnings: number;
} {
  let errors = 0;
  let warnings = 0;
  if (diagnostics) {
    for (const d of diagnostics) {
      if (d.severity === 1) errors += 1;
      else if (d.severity === 2) warnings += 1;
    }
  }
  return { errors, warnings };
}

function FileTabStrip({
  files,
  activeFile,
  onSelectFile,
  onCreateFile,
  onDeleteFile,
  fileDiagnostics
}: {
  files: readonly WorkspaceFile[];
  activeFile: string | undefined;
  onSelectFile: (path: string) => void;
  onCreateFile: () => void;
  onDeleteFile: (path: string) => void;
  fileDiagnostics: ReadonlyMap<string, readonly LspDiagnostic[]>;
}) {
  const userFiles = files.filter(isUserWorkspaceFile);

  return (
    <div className="studio-topbar__tabs" role="group" aria-label="Open files">
      {userFiles.map((f) => {
        const { errors, warnings } = countFileDiagnostics(fileDiagnostics.get(f.path));
        const kindBadge = getFileKindBadge(f.name);
        const visibleLabel = [
          f.name,
          ...(errors > 0 ? [errors] : []),
          ...(warnings > 0 ? [warnings] : []),
          kindBadge
        ].join(' ');
        return (
          <div key={f.path} className={`studio-topbar__tab-wrapper ${f.path === activeFile ? 'is-active' : ''}`}>
            <button
              type="button"
              className="studio-topbar__tab"
              aria-pressed={f.path === activeFile}
              onClick={() => onSelectFile(f.path)}
              title={f.path}
              // Preserve the visible label for speech input; explain counts afterward.
              aria-label={`${visibleLabel}${f.dirty ? ', unsaved' : ''}${
                errors > 0 ? `, ${errors} error${errors === 1 ? '' : 's'}` : ''
              }${warnings > 0 ? `, ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}`}
            >
              <span className={`studio-topbar__tab-dot ${f.dirty ? 'is-dirty' : ''}`} />
              <span className="studio-topbar__tab-name">{f.name} </span>
              {errors > 0 && (
                <span className="studio-topbar__tab-count is-error" title={`${errors} error${errors === 1 ? '' : 's'}`}>
                  {errors}{' '}
                </span>
              )}
              {warnings > 0 && (
                <span
                  className="studio-topbar__tab-count is-warning"
                  title={`${warnings} warning${warnings === 1 ? '' : 's'}`}
                >
                  {warnings}{' '}
                </span>
              )}
              <span className="studio-topbar__tab-badge" aria-hidden="true">
                {kindBadge}
              </span>
            </button>
            <button
              type="button"
              className="studio-topbar__tab-delete"
              aria-label={`Delete ${f.name}`}
              title={`Delete ${f.name}`}
              onClick={(e) => {
                // Own sibling button, not nested inside the select button —
                // stopPropagation guards against a future markup change
                // accidentally nesting them and firing both handlers.
                e.stopPropagation();
                onDeleteFile(f.path);
              }}
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="studio-topbar__tab-new"
        aria-label="New file"
        title="New file"
        onClick={onCreateFile}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

export const ExploreCenterSlot = withInstrumentation(
  function ExploreCenterSlot() {
    const { files, parseErrors } = useWorkspace();
    const { onFilesChange } = useWorkspaceActions();
    const { fileDiagnostics } = useDiagnosticsStore();
    const activeEditorFile = useExploreFileNavStore((s) => s.activeEditorFile);
    const openFileInSource = useExploreFileNavStore((s) => s.openFileInSource);
    const setActiveEditorFile = useExploreFileNavStore((s) => s.setActiveEditorFile);

    const effectiveParseErrors = parseErrors ?? EMPTY_PARSE_ERRORS;
    const combinedFileDiagnostics = useMemo(
      () => combineFileDiagnostics(fileDiagnostics, files, effectiveParseErrors),
      [fileDiagnostics, files, effectiveParseErrors]
    );

    const handleCreateFile = () => {
      const file = createBlankWorkspaceFile(files);
      onFilesChange?.([...files, file]);
      openFileInSource(file.path);
    };

    // Issue #405 — no UI action previously deleted a workspace file. Native
    // confirm(), matching the established shell-wide destructive-action
    // pattern (WorkspaceSwitcher's handleDelete uses the same
    // `typeof confirm === 'function'` guard for jsdom/non-browser safety).
    // Deleting the currently-active file redirects to another remaining
    // user file, or clears activeEditorFile entirely when none remain —
    // exercising resolveEffectivePerspective's existing "delete last file"
    // fallback to the Workspaces launcher instead of stranding the user on
    // a now-blank Explore perspective.
    const handleDeleteFile = (path: string) => {
      const file = files.find((f) => f.path === path);
      if (!file) return;
      if (typeof confirm === 'function' && !confirm(`Delete "${file.name}"? This cannot be undone.`)) return;
      const remaining = files.filter((f) => f.path !== path);
      onFilesChange?.(remaining);
      setActiveEditorFile((prev) => {
        if (prev !== path) return prev;
        return remaining.find((f) => !f.readOnly)?.path;
      });
    };

    return (
      <FileTabStrip
        files={files}
        activeFile={activeEditorFile}
        onSelectFile={openFileInSource}
        onCreateFile={handleCreateFile}
        onDeleteFile={handleDeleteFile}
        fileDiagnostics={combinedFileDiagnostics}
      />
    );
  },
  { op: 'ExploreCenterSlot' }
);

export const ExploreActions = withInstrumentation(
  function ExploreActions() {
    const workspace = useWorkspace();
    const selectedNode = useEditorStore((state) =>
      state.selectedNodeId ? state.nodesById.get(state.selectedNodeId) : undefined
    );
    const openExport = useExportNavigationStore((state) => state.openExport);
    const setActivePerspective = usePerspectiveStore((state) => state.setActivePerspective);
    const setShowImportDialog = useImportDialogStore((s) => s.setOpen);
    const exportSelected = () => {
      const data = selectedNode?.data as { name?: string; $type?: string } | undefined;
      const namespace = selectedNode?.meta.namespace;
      if (workspace.workspaceId && namespace && data?.name && data.$type) {
        openExport(workspace.workspaceId, {
          namespaces: [],
          declarations: [{ namespace, name: data.name, kind: data.$type }]
        });
      } else {
        setActivePerspective('export');
      }
    };
    return (
      <>
        <Button variant="ghost" size="icon-sm" aria-label="Validate" title="Validate">
          <Check />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Export code"
          title={selectedNode ? 'Export selected declaration' : 'Open Export'}
          onClick={exportSelected}
        >
          <Download />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Share" title="Share">
          <Share2 />
        </Button>
        <button type="button" className="studio-topbar__import" onClick={() => setShowImportDialog(true)}>
          <Wand2 className="size-3.5" />
          Import
        </button>
      </>
    );
  },
  { op: 'ExploreActions' }
);
