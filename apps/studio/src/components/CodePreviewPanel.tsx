// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * CodePreviewPanel — pure-display code generation preview.
 *
 * Worker ownership and the codegen:generate request/response cycle live
 * entirely in EditorPage (single owner). This component reads the
 * generated output from `useCodegenStore` (snapshot, activeTarget, etc.)
 * and renders it — it does NOT subscribe to the worker and does NOT post
 * messages. This prevents double-subscription when both the dock panel
 * and ExportPerspective display the same output.
 */
import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { clearSourceReveal, setSourceReveal, sourceNavigationHighlight } from '../lang/source-navigation-highlight.js';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import type { Target } from '@rune-langium/codegen/export';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@rune-langium/design-system/ui/select';
import { nameFromNodeId, useLatestRef } from '@rune-langium/visual-editor';
import { editorExtensions, externalDocumentChange } from '../lang/editor-extensions.js';
import {
  downloadTargetViaRouter,
  CodegenDownloadError,
  collectCuratedBundlesFromWorkspace,
  collectCuratedSourcesForCodegen,
  collectRawWorkspaceSources,
  type WorkspaceFile
} from '../services/workspace.js';
import { CodegenTargetsTable } from './CodegenTargetsTable.js';
import { DownloadConfigDialog, type DownloadConfig } from './DownloadConfigDialog.js';
import { TARGET_OPTION_FORMS } from './export-target-settings.js';
import { useCodegenStore, type CodePreviewFile, type CodePreviewSnapshot } from '../store/codegen-store.js';
import { useOutputStore, fmtLine } from '../store/output-store.js';
import { usePreviewStore } from '../store/preview-store.js';
import { useStudioToast } from './StudioToastProvider.js';
import { CODE_PREVIEW_PANEL_ID, TARGET_LABELS } from './codegen-ui.js';
import { uriToPath } from '../utils/uri.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

interface SourcePosition {
  line: number;
  character: number;
}

export interface SourceEditorHandle {
  revealPosition(position: SourcePosition, filePath?: string): void;
}

// Codegen worker message types — still used by EditorPage's owner effect.
// Re-exported so EditorPage can import them from a single location.
export interface CodegenResultMessage {
  type: 'codegen:result';
  target: Target;
  requestId: string;
  files: CodePreviewFile[];
}

export interface CodegenOutdatedMessage {
  type: 'codegen:outdated';
  target: Target;
  requestId: string;
  message: string;
}

export interface CodegenErrorMessage {
  type: 'codegen:error';
  target: Target;
  requestId: string;
  message: string;
}

export type CodegenWorkerMessage = CodegenResultMessage | CodegenOutdatedMessage | CodegenErrorMessage;

function statusLabel(snapshot: CodePreviewSnapshot, target: Target): string {
  switch (snapshot.status) {
    case 'waiting':
      return 'Generating…';
    case 'ready':
      return `Generated (${TARGET_LABELS[target]})`;
    case 'stale':
      return 'Outdated — fix errors to refresh';
    case 'unavailable':
      return 'Preview unavailable — reload Studio';
    default: {
      const exhaustiveCheck: never = snapshot;
      throw new Error(`Unknown code preview status: ${String(exhaustiveCheck)}`);
    }
  }
}

export interface CodePreviewPanelProps {
  sourceEditorRef: SourceEditorHandle | null;
  /**
   * Workspace files (user-authored only — curated bundles are
   * server-loaded). Used by the Download flow (018 Task 0.12) to
   * POST `{ files, target }` to `/api/codegen`. Optional during the
   * transition; absent → Download is disabled and logs a warning.
   */
  files?: ReadonlyArray<WorkspaceFile>;
}

function activeFileFromSnapshot(snapshot: CodePreviewSnapshot): CodePreviewFile | undefined {
  if (!('files' in snapshot) || !snapshot.files) {
    return undefined;
  }
  return snapshot.files.find((file) => file.relativePath === snapshot.activeRelativePath) ?? snapshot.files[0];
}

export const CodePreviewPanel = withInstrumentation(
  function CodePreviewPanel({ sourceEditorRef, files }: CodePreviewPanelProps): React.ReactElement {
    const target = useCodegenStore((s) => s.codePreviewTarget);
    const activeTarget = useCodegenStore((s) => s.activeTarget);
    const setActiveTarget = useCodegenStore((s) => s.setActiveTarget);
    const snapshot = useCodegenStore((s) => s.snapshot);
    const setCodePreviewTarget = useCodegenStore((s) => s.setCodePreviewTarget);
    const setActiveCodePreviewFile = useCodegenStore((s) => s.setActiveCodePreviewFile);
    const activeFile = useMemo(() => activeFileFromSnapshot(snapshot), [snapshot]);

    const editorContainerRef = useRef<HTMLDivElement>(null);
    const editorViewRef = useRef<EditorView | null>(null);
    const sourceEditorRefRef = useLatestRef(sourceEditorRef);
    const activeFileRef = useLatestRef<CodePreviewFile | undefined>(activeFile);

    // 019 polish — View toggles. Click the eye on the already-active row
    // collapses the preview area; click on a different row swaps it.
    const handleViewTarget = useCallback(
      (newTarget: Target) => {
        if (activeTarget === newTarget) {
          setActiveTarget(undefined);
          return;
        }
        setActiveTarget(newTarget);
        if (newTarget !== target) {
          setCodePreviewTarget(newTarget);
        }
      },
      [activeTarget, setActiveTarget, setCodePreviewTarget, target]
    );

    // 018 Task 0.12 — which target's Download is in flight, used to swap
    // its row buttons for a spinner on the targets table while the POST
    // to /api/codegen is outstanding. Panel-local state because no other
    // component needs to observe it.
    const { showToast } = useStudioToast();
    const [downloadingTarget, setDownloadingTarget] = useState<Target | undefined>(undefined);
    // 019 §5.1 — which target's Download config modal is open (undefined =
    // closed). Clicking Download opens the modal; the modal's Generate fires
    // the actual /api/codegen request with the chosen layout + namespace subset.
    const [downloadModalTarget, setDownloadModalTarget] = useState<Target | undefined>(undefined);
    const dependencyGraph = useCodegenStore((s) => s.dependencyGraph);
    // The downloadable namespace set = every namespace /api/parse walked
    // (user + curated). dependencyGraph keys are that set (§5.2).
    const namespaceList = useMemo(() => Object.keys(dependencyGraph).sort(), [dependencyGraph]);

    // §5.1 — Download click opens the config modal (was: immediate download).
    // The empty-workspace guard stays here so we don't open a modal for a
    // workspace with nothing to emit.
    const handleDownloadTarget = useCallback(
      (newTarget: Target) => {
        const fileList = files ?? [];
        const hasUserFiles = fileList.some((f) => !f.readOnly);
        const hasCurated = collectCuratedBundlesFromWorkspace(fileList).length > 0;
        if (!hasUserFiles && !hasCurated) {
          console.warn(
            '[CodePreviewPanel] Download skipped — workspace has no user files and no curated bundles for target:',
            newTarget
          );
          return;
        }
        setDownloadModalTarget(newTarget);
      },
      [files]
    );

    // §5.1/§5.3 — fire the configured download. Maps the modal's layout choice
    // and target-specific options into `options.<target>` and forwards the
    // dependency-closed namespace subset to /api/codegen.
    const handleModalGenerate = useCallback(
      async (config: DownloadConfig) => {
        const newTarget = config.target;
        setDownloadModalTarget(undefined);
        const fileList = files ?? [];
        const requestFiles = collectRawWorkspaceSources(fileList);
        const { curatedBundles, curatedDocs } = collectCuratedSourcesForCodegen(fileList);
        // Merge layout + target-specific options (e.g. excel sheet toggles) into
        // the options bag. The order of spreading means explicit options from the
        // form can include a layout key, but the layout radio always wins here.
        const targetOptions = (config.options?.[newTarget] ?? {}) as Record<string, unknown>;
        const layoutOption = config.layout ? { layout: config.layout } : {};
        const options = config.layout || config.options ? { [newTarget]: { ...targetOptions, ...layoutOption } } : {};
        setDownloadingTarget(newTarget);
        try {
          await downloadTargetViaRouter(
            requestFiles,
            newTarget,
            options,
            curatedBundles,
            config.namespaces,
            curatedDocs
          );
        } catch (err) {
          if (err instanceof CodegenDownloadError) {
            const detail = err.diagnostics.length > 0 ? err.diagnostics.map((d) => d.message).join('; ') : err.message;
            showToast({ title: 'Code generation failed', description: detail, variant: 'destructive' });
            useOutputStore.getState().addLine(fmtLine('codegen', err.message), 'error');
            err.diagnostics.forEach((d) =>
              useOutputStore
                .getState()
                .addLine(fmtLine('codegen', d.message, d.code), d.severity === 'error' ? 'error' : 'warn')
            );
            console.error(
              `[CodePreviewPanel] /api/codegen ${err.status} for target ${newTarget}: ${err.message}`,
              err.diagnostics
            );
          } else {
            const msg = err instanceof Error ? err.message : 'Unexpected error during download.';
            showToast({ title: 'Download failed', description: msg, variant: 'destructive' });
            useOutputStore.getState().addLine(fmtLine('codegen', msg), 'error');
            console.error('[CodePreviewPanel] Download failed for target', newTarget, err);
          }
        } finally {
          setDownloadingTarget(undefined);
        }
      },
      [files, showToast]
    );

    const handleLineClick = useCallback((outputLine: number) => {
      const ref = sourceEditorRefRef.current;
      const file = activeFileRef.current;
      if (!ref || !file) return;
      const entry = file.sourceMap.find((sourceMapEntry) => sourceMapEntry.outputLine === outputLine);
      if (!entry) return;
      ref.revealPosition({ line: entry.sourceLine, character: entry.sourceChar }, uriToPath(entry.sourceUri));
    }, []);

    // 018 Task 0.8 — `activeTarget` is a dep so the editor mounts on the
    // first transition from the targets-table view (where the container
    // ref is absent) to the viewer (where it exists), even when `target`
    // didn't change because the user clicked View on the current default.
    useEffect(() => {
      if (!editorContainerRef.current) return;

      const langExtension = target === 'json-schema' ? json() : javascript({ typescript: true });

      const state = EditorState.create({
        doc: '',
        extensions: [
          ...editorExtensions(langExtension, true),
          sourceNavigationHighlight,
          EditorView.domEventHandlers({
            click: (event, view) => {
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos === null) return;
              const lineNumber = view.state.doc.lineAt(pos).number - 1;
              handleLineClick(lineNumber);
            }
          })
        ]
      });

      const view = new EditorView({ state, parent: editorContainerRef.current });
      editorViewRef.current = view;

      return () => {
        view.destroy();
        editorViewRef.current = null;
      };
    }, [activeTarget, handleLineClick, target]);

    useEffect(() => {
      const view = editorViewRef.current;
      if (!view) return;
      const nextContent = activeFile?.content ?? '';
      const current = view.state.doc.toString();
      if (current === nextContent) return;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: nextContent },
        annotations: externalDocumentChange.of(true)
      });
    }, [activeFile, activeTarget, target]);

    const selectedTargetId = usePreviewStore((s) => s.selectedTargetId);
    const navigationRequest = usePreviewStore((s) => s.navigationRequest);
    const consumedArrivalRef = useRef<{ view: EditorView; request: typeof navigationRequest } | undefined>(undefined);
    useEffect(() => {
      const view = editorViewRef.current;
      if (!view) return;
      const consumed = consumedArrivalRef.current;
      if (consumed?.view === view && consumed.request === navigationRequest) return;
      clearSourceReveal(view);
      if (!navigationRequest || navigationRequest.targetId !== selectedTargetId || !activeFile) return;
      const typeName = nameFromNodeId(selectedTargetId);
      if (!typeName) return;
      const lines = activeFile.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i]!.trimStart();
        if (trimmed.includes(typeName) && /^(export |const |class |interface |type |function )/.test(trimmed)) {
          const lineInfo = view.state.doc.line(i + 1);
          consumedArrivalRef.current = { view, request: navigationRequest };
          view.dispatch({
            effects: [
              EditorView.scrollIntoView(lineInfo.from, { y: 'start', yMargin: 40 }),
              setSourceReveal.of(lineInfo.from)
            ]
          });
          return;
        }
      }
    }, [selectedTargetId, navigationRequest, activeFile, activeTarget, target]);

    const statusMessage =
      snapshot.status === 'stale' || snapshot.status === 'unavailable' ? snapshot.message : undefined;
    const selectableFiles = snapshot.status === 'ready' || snapshot.status === 'stale' ? snapshot.files : undefined;
    const activeRelativePath =
      snapshot.status === 'ready' || snapshot.status === 'stale' ? snapshot.activeRelativePath : undefined;

    // 019 polish — stacked layout: targets table always at the top; when
    // `activeTarget` is set, the viewer expands below it. Clicking the
    // eye icon on a row toggles its preview open/closed. `inflightTarget`
    // reflects the in-flight Download POST (Task 0.12) so the clicked
    // row shows a spinner while `/api/codegen` is outstanding.
    const viewerOpen = activeTarget !== undefined;
    return (
      <section
        id={CODE_PREVIEW_PANEL_ID}
        role={viewerOpen ? 'tabpanel' : undefined}
        aria-label={viewerOpen ? 'Code preview' : 'Code preview targets'}
        data-testid="panel-codePreview"
        data-component="workspace.codePreview"
        className="preview-panel preview-panel--code flex h-full min-h-0 flex-col overflow-hidden"
      >
        <div className="shrink-0 border-b border-border/70">
          <CodegenTargetsTable
            onView={handleViewTarget}
            onDownload={handleDownloadTarget}
            inflightTarget={downloadingTarget}
            activeTarget={activeTarget}
          />
        </div>
        {viewerOpen ? (
          <>
            <div className="preview-panel__toolbar flex shrink-0 flex-wrap items-center gap-2 border-b border-border/70 bg-card/40 px-3 py-1.5">
              <span className="text-sm font-medium text-foreground" data-testid="codegen-active-target">
                {TARGET_LABELS[activeTarget]}
              </span>
              {selectableFiles && selectableFiles.length > 1 ? (
                <Select value={activeRelativePath} onValueChange={(value) => setActiveCodePreviewFile(value)}>
                  <SelectTrigger
                    size="sm"
                    aria-label="Generated file"
                    data-testid="codegen-file-select"
                    className="max-w-[18rem] text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableFiles.map((file) => (
                      <SelectItem key={file.relativePath} value={file.relativePath} className="text-xs">
                        {file.relativePath}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <div className="ml-auto min-w-0 text-right">
                <span className="block text-xs text-muted-foreground" data-testid="codegen-status" aria-live="polite">
                  {statusLabel(snapshot, target)}
                </span>
                {activeFile?.relativePath ? (
                  <span
                    className="block max-w-[22rem] truncate text-2xs text-muted-foreground"
                    data-testid="codegen-relative-path"
                    title={activeFile.relativePath}
                  >
                    {activeFile.relativePath}
                  </span>
                ) : null}
                {statusMessage ? (
                  <span className="block max-w-[22rem] truncate text-2xs text-muted-foreground">{statusMessage}</span>
                ) : null}
              </div>
            </div>
            <div
              ref={editorContainerRef}
              data-testid="code-preview-editor"
              className="preview-panel__editor studio-scroll min-w-0 flex-1 overflow-auto"
            />
          </>
        ) : null}
        {downloadModalTarget !== undefined ? (
          <DownloadConfigDialog
            open
            target={downloadModalTarget}
            namespaces={namespaceList}
            dependencyGraph={dependencyGraph}
            onClose={() => setDownloadModalTarget(undefined)}
            onGenerate={handleModalGenerate}
            optionsForm={TARGET_OPTION_FORMS[downloadModalTarget]}
          />
        ) : null}
      </section>
    );
  },
  { op: 'CodePreviewPanel' }
);
