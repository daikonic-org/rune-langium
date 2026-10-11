// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * SourceEditor — CodeMirror 6 editor for .rosetta files (T020).
 *
 * Replaces the read-only SourceView with a full-featured editor
 * backed by @codemirror/lsp-client for diagnostics, hover,
 * completion, and go-to-definition.
 *
 * Multi-tab support (T026): Tab bar, active tab switching,
 * and cross-file navigation.
 */

import {
  useState,
  useId,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useImperativeHandle,
  forwardRef,
  type ForwardedRef,
  type KeyboardEvent
} from 'react';
import { EditorView } from '@codemirror/view';
import { Compartment, EditorState, Transaction, type Extension } from '@codemirror/state';
import type { SourceRegion } from '@rune-langium/core';
import {
  documentExtensions,
  externalDocumentChange,
  minimalDocumentChange,
  setProtectedRegion
} from '../lang/document-extensions.js';
import type { LspClientService } from '../services/lsp-client.js';
import { pathToUri } from '../utils/uri.js';
import { cn } from '@rune-langium/design-system/utils';
import { isTypeRefPayload, makeNodeId, TYPE_REF_PAYLOAD_MIME, useLatestRef } from '@rune-langium/visual-editor';
import { withInstrumentation, Capture } from '../services/instrumentation/core.js';

// Re-export pathToUri for backward compatibility
export { pathToUri } from '../utils/uri.js';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface SourceEditorFile {
  name: string;
  path: string;
  content: string;
  dirty: boolean;
  /** When true, the file is a system/built-in file and cannot be edited. */
  readOnly?: boolean;
}

export interface SourceEditorProps {
  /** Workspace files to show as tabs. */
  files: SourceEditorFile[];
  /** Currently active file path. */
  activeFile?: string;
  /** Called when user switches tabs. */
  onFileSelect?: (path: string) => void;
  /** Called when a tab close button is clicked. */
  onFileClose?: (path: string) => void;
  /** Called when editor content changes. */
  onContentChange?: (path: string, content: string) => void;
  /** LSP client service (injected). */
  lspClient?: LspClientService;
  /**
   * Whether the LSP connection has finished connecting. The `lspClient`
   * object identity does NOT change across its connect lifecycle (the same
   * instance is reused), so it can't be used on its own to detect this
   * transition — this prop is the reactive signal that does. Late-binds the
   * LSP CodeMirror plugin (diagnostics, hover, completion, go-to-definition)
   * into the already-mounted editor via a Compartment once this flips true,
   * instead of requiring a full EditorView recreation.
   */
  lspReady?: boolean;
  /**
   * Called when go-to-definition resolves to a graph node (Task 7).
   * The nodeId is derived from the definition target URI.
   */
  onNavigateToNode?: (nodeId: string) => void;
  /**
   * Called when a new EditorView is created for a file (e.g., after tab switch).
   * Used by cross-file go-to-definition to resolve pending displayFile promises.
   */
  onEditorViewCreated?: (filePath: string, view: EditorView) => void;
  /** When true, suppress the internal tab strip. Use when the parent (e.g. topbar
   * FileTabStrip) already provides file-tab navigation. */
  hideTabs?: boolean;
  /** Display/edit a protected region, retaining the full document internally. */
  region?: SourceRegion;
  /** Source snapshot from which region coordinates were calculated. */
  regionSource?: string;
  onSelectionChange?: (selection: SourceRegion, view: EditorView) => void;
}

/** Imperative handle exposed by SourceEditor for programmatic navigation. */
export interface SourceEditorRef {
  /** Reveal a line without focus; returns true only when applied to the matching live view. */
  revealLine(line: number, filePath?: string): boolean;
  /** Scroll to a source position in the specified (or current) file and place the cursor there. */
  revealPosition(position: { line: number; character: number }, filePath?: string): void;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generate a stable, unique ID for a tab from a file path.
 * Uses encodeURIComponent so that all non-alphanumerics are encoded with
 * '%' delimiters, avoiding collisions with literal alphanumeric sequences.
 */
function getTabId(path: string): string {
  const encoded = encodeURIComponent(path);
  return `tab-${encoded}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 9: type-ref drop helpers (exported for unit testing)
// ────────────────────────────────────────────────────────────────────────────

export const handleTypeRefDragOver = withInstrumentation(
  function handleTypeRefDragOver(event: DragEvent): boolean {
    const types = Array.from(event.dataTransfer?.types ?? []);
    const hasOurMime = types.some((t) => t.toLowerCase() === TYPE_REF_PAYLOAD_MIME);
    if (!hasOurMime) return false;
    event.preventDefault();
    try {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'link';
    } catch {
      // Some test stubs make dropEffect read-only — non-fatal.
    }
    return true;
    // `event` (DOM DragEvent) isn't captured; output is a plain boolean — safe.
  },
  {
    op: 'handleTypeRefDragOver',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' ? value : undefined)
  }
);

/** Minimal view interface required by the drop handler (subset of EditorView). */
export interface DropTargetView {
  posAtCoords(coords: { x: number; y: number }): number | null;
  state: { selection: { main: { head: number } } };
  dispatch(tr: { changes: { from: number; to: number; insert: string }; selection: { anchor: number } }): void;
  /** Restore keyboard focus to the editor so the user can type immediately after a drop. */
  focus(): void;
}

export const handleTypeRefDrop = withInstrumentation(
  function handleTypeRefDrop(event: DragEvent, view: DropTargetView): boolean {
    const raw = event.dataTransfer?.getData(TYPE_REF_PAYLOAD_MIME);
    if (!raw) return false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return false;
    }
    if (!isTypeRefPayload(parsed)) return false;

    // Only preventDefault once we've confirmed the payload is ours — otherwise
    // plain-text and file drops on the SourceEditor would be suppressed.
    event.preventDefault();

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
    const qualified = `${parsed.namespaceUri}.${parsed.typeName}`;
    view.dispatch({
      changes: { from: pos, to: pos, insert: qualified },
      // Place caret after the inserted text so the user can keep typing.
      selection: { anchor: pos + qualified.length }
    });
    // Restore focus so the user can type immediately without clicking first.
    view.focus();
    return true;
    // `event`/`view` aren't captured; output is a plain boolean — safe.
  },
  {
    op: 'handleTypeRefDrop',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' ? value : undefined)
  }
);

function scrollToPosition(
  view: EditorView | null,
  position: { line: number; character: number },
  focus: boolean
): void {
  if (!view) return;
  const clampedLine = Math.max(1, Math.min(position.line, view.state.doc.lines));
  const lineInfo = view.state.doc.line(clampedLine);
  const lineOffset = Math.max(0, Math.min(position.character - 1, lineInfo.length));
  const selectionAnchor = lineInfo.from + lineOffset;
  view.dispatch({
    selection: { anchor: selectionAnchor },
    effects: EditorView.scrollIntoView(selectionAnchor, { y: 'center' })
  });
  if (focus) view.contentDOM.focus({ preventScroll: true });
}

/**
 * Extract a graph nodeId (namespace.TypeName) from the cursor position
 * after a go-to-definition jump (Task 7).
 *
 * When jumpToDefinition places the cursor at a type definition, we scan
 * backwards to find the `namespace` declaration and forwards/around to
 * find the type keyword + name (e.g. `type Foo:`, `enum Bar:`, `func Baz:`).
 *
 * Returns null if the position doesn't correspond to a recognizable type definition.
 */
function extractNodeIdAtPosition(state: EditorState, pos: number): string | null {
  const doc = state.doc;
  const lineAt = doc.lineAt(pos);

  // Find the type name on the current line or nearby lines.
  // Rosetta DSL patterns: `type <Name>:`, `enum <Name>:`, `func <Name>:`,
  // `choice <Name>:`, `typeAlias <Name>`, `metaType <Name>`
  const typePattern = /\b(type|enum|func|choice|typeAlias|metaType)\s+(\w+)/;

  // Check the line where the cursor landed
  let match = typePattern.exec(lineAt.text);

  // If not on this line, check a few lines around (definition might span lines)
  if (!match) {
    for (let delta = -2; delta <= 2; delta++) {
      if (delta === 0) continue;
      const lineNum = lineAt.number + delta;
      if (lineNum < 1 || lineNum > doc.lines) continue;
      const nearbyLine = doc.line(lineNum);
      match = typePattern.exec(nearbyLine.text);
      if (match) break;
    }
  }

  if (!match) return null;
  const typeName = match[2]!;

  // Scan backwards from the cursor to find the `namespace` declaration
  const nsPattern = /^namespace\s+([\w.]+)/;
  let namespace: string | null = null;
  for (let ln = lineAt.number; ln >= 1; ln--) {
    const nsMatch = nsPattern.exec(doc.line(ln).text);
    if (nsMatch) {
      namespace = nsMatch[1]!;
      break;
    }
  }

  // Skip graph navigation if namespace can't be determined
  if (!namespace) return null;

  return makeNodeId(namespace, typeName, match[1] === 'func' ? 'RosettaFunction' : undefined);
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

// Manually wrapped (codemod only rewrites `export function` declarations,
// not a forwardRef-wrapped arrow/function-expression export): the render
// function is wrapped, then handed to forwardRef, so forwardRef's own
// $$typeof marker on the exported component is preserved. Props (files,
// callbacks) aren't capturable — same as every other React component in
// this sweep.
const renderSourceEditor = withInstrumentation(
  function SourceEditor(
    {
      files,
      activeFile,
      onFileSelect,
      onFileClose,
      onContentChange,
      lspClient,
      lspReady,
      onNavigateToNode,
      onEditorViewCreated,
      hideTabs,
      region,
      regionSource,
      onSelectionChange
    }: SourceEditorProps,
    ref: ForwardedRef<SourceEditorRef>
  ) {
    const [selectedPath, setSelectedPath] = useState<string>(activeFile ?? files[0]?.path ?? '');
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const editorViewRef = useRef<EditorView | null>(null);
    const editorViewPathRef = useRef<string | null>(null);
    const positionRequestRef = useRef(0);
    const editorId = useId();
    const tabId = useCallback((path: string) => `${editorId}-${getTabId(path)}`, [editorId]);
    const panelId = `${editorId}-panel`;
    const regionRef = useLatestRef(region);
    const onSelectionChangeRef = useLatestRef(onSelectionChange);
    // Holds the Compartment reserved for the LSP plugin slot in the CURRENTLY
    // MOUNTED EditorView (recreated alongside it — see the editor-creation
    // effect below). Lets the LSP plugin be late-bound via a dispatched
    // reconfigure once the async LSP connection finishes, without tearing
    // down and recreating the whole EditorView (which would drop the user's
    // cursor position, scroll offset, and undo history).
    const lspCompartmentRef = useRef<Compartment | null>(null);

    // Sync selectedPath when activeFile prop changes externally. Adjusted
    // during render (React's blessed pattern) rather than in an effect, so
    // external navigation lands in the same render instead of flashing the
    // stale selectedPath for one frame first. Triggers off activeFile itself
    // (not selectedPath) so internal tab-clicks — which change selectedPath
    // without activeFile changing — never re-fire this.
    //
    // Tracked via useState, NOT a plain ref: a ref mutation made during render
    // is not rolled back if React discards/retries this render under
    // concurrent rendering, while the accompanying setSelectedPath call IS
    // rolled back (it never committed) — so even the conditional
    // `.current = activeFile` assignment below could leave a retry believing
    // this activeFile was already handled while the selection update it was
    // paired with never actually committed (Codex review, round 2).
    const [prevActiveFile, setPrevActiveFile] = useState(activeFile);
    if (activeFile && activeFile !== prevActiveFile) {
      const exists = files.some((f) => f.path === activeFile);
      if (exists) {
        setSelectedPath(activeFile);
        // Only mark this activeFile as "handled" once it actually resolved —
        // if `files` hasn't hydrated it yet (async navigation race), leave
        // prevActiveFile stale so a LATER render (once `files` catches up)
        // still sees activeFile !== prevActiveFile and retries, instead of
        // silently giving up because this assignment already marked the miss
        // as "seen".
        setPrevActiveFile(activeFile);
      }
    } else if (activeFile !== prevActiveFile) {
      setPrevActiveFile(activeFile);
    }

    // Expose imperative handle for programmatic navigation
    useImperativeHandle(ref, () => {
      const revealPosition = (position: { line: number; character: number }, filePath?: string, focus = true) => {
        const request = ++positionRequestRef.current;
        // If a different file is specified, switch to it first
        if (filePath && filePath !== selectedPath) {
          const target = files.find((f) => f.path === filePath || f.name === filePath);
          if (target) {
            setSelectedPath(target.path);
            onFileSelect?.(target.path);
            // Schedule the scroll after the editor is recreated for the new file
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (request === positionRequestRef.current && editorViewPathRef.current === target.path) {
                  scrollToPosition(editorViewRef.current, position, focus);
                }
              });
            });
            return;
          }
        }
        scrollToPosition(editorViewRef.current, position, focus);
      };
      return {
        revealLine(line: number, filePath?: string) {
          // Explorer selection synchronizes source position without moving
          // keyboard focus away from the type filter or another active pane.
          const view = editorViewRef.current;
          const targetPath = filePath ?? selectedPath;
          if (!view || targetPath !== selectedPath || editorViewPathRef.current !== targetPath) return false;
          ++positionRequestRef.current;
          scrollToPosition(view, { line, character: 1 }, false);
          return true;
        },
        revealPosition(position, filePath) {
          revealPosition(position, filePath);
        }
      };
    }, [files, selectedPath, onFileSelect]);

    // Track content per file for document model
    const contentMapRef = useRef<Map<string, string>>(new Map());

    // Stable callback refs — prevents editor recreation when parent re-renders
    const onContentChangeRef = useRef(onContentChange);
    useEffect(() => {
      onContentChangeRef.current = onContentChange;
    }, [onContentChange]);

    const onNavigateToNodeRef = useRef(onNavigateToNode);
    useEffect(() => {
      onNavigateToNodeRef.current = onNavigateToNode;
    }, [onNavigateToNode]);

    const onEditorViewCreatedRef = useRef(onEditorViewCreated);
    useEffect(() => {
      onEditorViewCreatedRef.current = onEditorViewCreated;
    }, [onEditorViewCreated]);

    // Initialise content map (new files only)
    useEffect(() => {
      for (const file of files) {
        if (!contentMapRef.current.has(file.path)) {
          contentMapRef.current.set(file.path, file.content);
        }
      }
    }, [files]);

    const currentFile = useMemo(() => files.find((f) => f.path === selectedPath), [files, selectedPath]);

    // Handle external content updates (e.g., from graph → source sync)
    useEffect(() => {
      const view = editorViewRef.current;
      if (!view) return;
      const file = currentFile;
      if (!file) return;
      const editorContent = view.state.doc.toString();
      const mapContent = contentMapRef.current.get(file.path);
      // Only update if file content differs from BOTH editor and map (external change)
      if (file.content !== editorContent && file.content !== mapContent) {
        contentMapRef.current.set(file.path, file.content);
        view.dispatch({
          changes: minimalDocumentChange(editorContent, file.content),
          annotations: [externalDocumentChange.of(true), Transaction.addToHistory.of(false)]
        });
      }
      // A cursor/dialog rerender may provide a new files array containing the
      // same snapshot. Only a changed source value can be an external edit.
    }, [currentFile?.content, selectedPath]);

    useEffect(() => {
      const view = editorViewRef.current;
      if (view && region && regionSource === view.state.doc.toString()) {
        view.dispatch({ effects: setProtectedRegion.of(region), annotations: externalDocumentChange.of(true) });
      }
    }, [region?.from, region?.to, regionSource, currentFile?.content]);

    const handleFileSelect = useCallback(
      (path: string) => {
        ++positionRequestRef.current;
        // Save current content before switching
        if (editorViewRef.current && selectedPath) {
          const content = editorViewRef.current.state.doc.toString();
          contentMapRef.current.set(selectedPath, content);
        }
        setSelectedPath(path);
        onFileSelect?.(path);
      },
      [selectedPath, onFileSelect]
    );

    const handleTabKeyDown = useCallback(
      (event: KeyboardEvent<HTMLButtonElement>, path: string) => {
        const currentIndex = files.findIndex((file) => file.path === path);
        if (currentIndex < 0 || files.length === 0) {
          return;
        }
        let nextIndex: number | undefined;
        switch (event.key) {
          case 'ArrowRight':
            nextIndex = (currentIndex + 1) % files.length;
            break;
          case 'ArrowLeft':
            nextIndex = (currentIndex - 1 + files.length) % files.length;
            break;
          case 'Home':
            nextIndex = 0;
            break;
          case 'End':
            nextIndex = files.length - 1;
            break;
          default:
            return;
        }
        event.preventDefault();
        const nextFile = files[nextIndex];
        if (nextFile) {
          handleFileSelect(nextFile.path);
          const nextTab = document.getElementById(tabId(nextFile.path));
          if (nextTab instanceof HTMLButtonElement) {
            nextTab.focus();
          }
        }
      },
      [files, handleFileSelect, tabId]
    );

    // Build extensions — uses refs for callbacks to keep extensions stable
    const buildExtensions = useCallback(
      (filePath: string, isReadOnly: boolean, lspCompartment: Compartment): Extension[] => {
        const exts: Extension[] = documentExtensions(regionRef.current);
        exts.push(
          EditorView.contentAttributes.of({ 'aria-label': 'Rune source editor' }),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.docChanged) {
              const selection = update.state.selection.main;
              onSelectionChangeRef.current?.({ from: selection.from, to: selection.to }, update.view);
            }
          })
        );

        if (isReadOnly) {
          exts.push(EditorState.readOnly.of(true));
        } else {
          exts.push(
            EditorView.updateListener.of((update) => {
              if (update.docChanged && !update.transactions.every((tr) => tr.annotation(externalDocumentChange))) {
                const content = update.state.doc.toString();
                contentMapRef.current.set(filePath, content);
                onContentChangeRef.current?.(filePath, content);
              }
            })
          );
        }

        // Task 7 (+ issue #453 follow-up): detect go-to-definition navigation
        // AND plain click-driven cursor placement, firing onNavigateToNode
        // for either. @codemirror/lsp-client's jumpToDefinition tags its
        // transaction "select.definition"; CodeMirror's own built-in mouse
        // handling tags a click-to-position-cursor transaction
        // "select.pointer" (@codemirror/view's MouseSelectionDragging —
        // verified against the installed package). Originally this only
        // listened for "select.definition", so placing the cursor in a
        // type's own declaration via a plain click never synced selection
        // elsewhere — only the LSP's explicit go-to-definition action did.
        // Deliberately NOT "select.keyboard" (arrow-key cursor movement) —
        // that would resync on every keystroke while just moving around;
        // add it separately if that granularity is ever wanted.
        exts.push(
          EditorView.updateListener.of((update) => {
            for (const tr of update.transactions) {
              if (tr.isUserEvent('select.definition') || tr.isUserEvent('select.pointer')) {
                // The transaction has already moved the cursor to its new
                // position. Try to extract the type name at the cursor
                // position for graph navigation.
                const pos = tr.newSelection.main.head;
                const nodeId = extractNodeIdAtPosition(update.state, pos);
                if (nodeId && onNavigateToNodeRef.current) {
                  onNavigateToNodeRef.current(nodeId);
                }
              }
            }
          })
        );

        // Reserve the LSP plugin slot as an empty Compartment — the lspReady
        // effect below fills it in (both for "already connected at mount"
        // and "connects later") via a single dispatched reconfigure, so the
        // plugin never needs recreating this EditorView to attach.
        exts.push(lspCompartment.of([]));

        // Phase 9: accept type-ref drops from NamespaceExplorer onto the editor surface.
        // Delegates to pure helpers (handleTypeRefDragOver / handleTypeRefDrop) so the
        // logic is unit-testable without constructing a full EditorView.
        // Guard: read-only editors must never receive drop mutations — CodeMirror's
        // EditorState.readOnly.of(true) blocks user input but NOT programmatic
        // view.dispatch(), so without this gate a drop would silently mutate a
        // system/built-in buffer that onContentChange never sees.
        if (!isReadOnly) {
          exts.push(
            EditorView.domEventHandlers({
              dragover: handleTypeRefDragOver,
              drop: handleTypeRefDrop
            })
          );
        }

        return exts;
        // No external reactive values captured — callbacks route through
        // stable refs, and the LSP plugin is wired separately via the
        // reserved compartment (see the lspReady effect below).
      },
      []
    );

    // Create / update editor view when the file PATH changes (tab switch).
    // Content changes are handled by CodeMirror's internal state + updateListener.
    // The LSP connecting later does NOT recreate the view — see the lspReady
    // effect below, which late-binds the LSP plugin into the existing view
    // via the lspCompartmentRef reserved here.
    useEffect(() => {
      if (!editorContainerRef.current || !currentFile) return;

      // Destroy previous editor
      if (editorViewRef.current) {
        editorViewRef.current.destroy();
        editorViewRef.current = null;
        editorViewPathRef.current = null;
      }

      const content = contentMapRef.current.get(currentFile.path) ?? currentFile.content;
      const lspCompartment = new Compartment();
      lspCompartmentRef.current = lspCompartment;

      const state = EditorState.create({
        doc: content,
        selection: regionRef.current ? { anchor: regionRef.current.from } : undefined,
        extensions: buildExtensions(currentFile.path, currentFile.readOnly ?? false, lspCompartment)
      });

      const view = new EditorView({
        state,
        parent: editorContainerRef.current
      });

      editorViewRef.current = view;
      editorViewPathRef.current = currentFile.path;

      // Notify host that a new EditorView was created (for cross-file go-to-definition)
      if (currentFile?.path) {
        onEditorViewCreatedRef.current?.(currentFile.path, view);
      }

      return () => {
        view.destroy();
        editorViewRef.current = null;
        editorViewPathRef.current = null;
        lspCompartmentRef.current = null;
      };
      // Only recreate editor when file path changes (tab switch).
      // Content updates are handled by the updateListener extension, NOT by recreating.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentFile?.path, currentFile?.readOnly, buildExtensions]);

    // Late-bind the LSP plugin once the async LSP connection finishes,
    // reconfiguring the reserved compartment in the already-mounted
    // EditorView instead of recreating it (see lspCompartmentRef above).
    // `lspReady` is the reactive signal for this — `lspClient`'s object
    // identity never changes across its connect lifecycle, so a dependency
    // on `lspClient` alone would never re-fire this effect.
    //
    // Depend on `currentFile?.path`, NOT the `currentFile` object itself —
    // every content edit produces a brand-new file object (handleSourceChange
    // in ExplorePerspective.tsx spreads `{ ...f, content, dirty: true }`), so
    // depending on the object would reconfigure the compartment on every
    // keystroke, not just on tab switches. Reconfiguring destroys the current
    // LSPPlugin instance and constructs a fresh one, whose constructor resets
    // `unsyncedChanges` to empty against the CURRENT (already-edited) doc —
    // silently discarding whatever hadn't yet reached the server via
    // @codemirror/lsp-client's own debounced autoSync, which believes from
    // then on that the document is fully synced when it never was.
    useEffect(() => {
      if (!lspReady || !lspClient?.isInitialized() || !currentFile) return;
      const view = editorViewRef.current;
      const compartment = lspCompartmentRef.current;
      if (!view || !compartment) return;
      const configure = (plugin: Extension | null) => {
        if (editorViewRef.current === view) view.dispatch({ effects: compartment.reconfigure(plugin ?? []) });
      };
      if (lspClient.claimDocumentView) return lspClient.claimDocumentView(pathToUri(currentFile.path), view, configure);
      // Compatibility for older externally supplied service implementations.
      configure(lspClient.getPlugin(pathToUri(currentFile.path)));
      return () => configure(null);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lspReady, lspClient, currentFile?.path, currentFile?.readOnly]);

    // Empty state
    if (files.length === 0) {
      return (
        <section
          className="studio-editor-page__source flex h-full flex-col items-center justify-center bg-card text-muted-foreground"
          data-testid="source-editor"
        >
          <p>No files loaded</p>
        </section>
      );
    }

    return (
      <section
        className="studio-source-editor studio-editor-page__source flex h-full flex-col bg-card"
        data-testid="source-editor"
      >
        {/* Tab bar — suppressed when parent already provides file-tab navigation */}
        {!hideTabs && (
          <nav className="studio-source-editor__tabs" role="tablist" aria-label="Open files">
            {files.map((file) => (
              <div
                key={file.path}
                className={cn(
                  'studio-source-editor__tab-shell group',
                  file.path === selectedPath ? 'studio-source-editor__tab-shell--active' : ''
                )}
              >
                <button
                  type="button"
                  id={tabId(file.path)}
                  role="tab"
                  aria-selected={file.path === selectedPath}
                  aria-controls={panelId}
                  tabIndex={file.path === selectedPath ? 0 : -1}
                  className={cn(
                    'studio-source-editor__tab',
                    file.path === selectedPath ? 'studio-source-editor__tab--active' : ''
                  )}
                  onClick={() => handleFileSelect(file.path)}
                  onKeyDown={(event) => handleTabKeyDown(event, file.path)}
                  title={file.path}
                >
                  <span className="studio-source-editor__tab-label">{file.name}</span>
                  {file.readOnly && (
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      aria-label="read-only"
                      className="studio-source-editor__tab-lock"
                    >
                      <path d="M11 7V5a3 3 0 0 0-6 0v2H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-1zm-5 0V5a2 2 0 1 1 4 0v2H6zm2 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" />
                    </svg>
                  )}
                  {file.dirty && (
                    <span className="studio-source-editor__tab-dirty" aria-hidden>
                      ●
                    </span>
                  )}
                </button>
                {onFileClose && !file.readOnly && (
                  <button
                    type="button"
                    aria-label={`Close ${file.name}`}
                    className={cn(
                      'studio-source-editor__tab-close',
                      file.path === selectedPath && 'studio-source-editor__tab-close--active'
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      onFileClose(file.path);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M4.5 4.5L11.5 11.5M11.5 4.5L4.5 11.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </nav>
        )}

        {/* Editor container */}
        <div
          id={panelId}
          className="flex-1 overflow-hidden"
          role={hideTabs ? 'region' : 'tabpanel'}
          aria-label={hideTabs ? 'Rune source editor' : undefined}
          aria-labelledby={!hideTabs && selectedPath ? tabId(selectedPath) : undefined}
          data-testid="source-editor-container"
          ref={editorContainerRef}
        />
      </section>
    );
  },
  { op: 'SourceEditor' }
);

export const SourceEditor = forwardRef<SourceEditorRef, SourceEditorProps>(renderSourceEditor);
