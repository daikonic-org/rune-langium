// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * SourceEditor component tests (T018, T019, T022, T023).
 *
 * Covers: rendering, tab switching, content display,
 * diagnostics integration, hover, and completion.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { SourceEditor, handleTypeRefDragOver, handleTypeRefDrop } from '../../src/components/SourceEditor.js';
import type { SourceEditorProps, DropTargetView } from '../../src/components/SourceEditor.js';
import type { LspClientService } from '../../src/services/lsp-client.js';
import { TYPE_REF_PAYLOAD_MIME } from '@rune-langium/visual-editor';

// Mock CodeMirror since it needs a real DOM
const mockEditorViewDestroy = vi.fn();
const mockEditorViewFocus = vi.fn();
const mockContentDomFocus = vi.fn();
const mockEditorViewDispatch = vi.fn();
let lastEditorView: {
  dispatch: typeof mockEditorViewDispatch;
  focus: typeof mockEditorViewFocus;
  contentDOM: { focus: typeof mockContentDomFocus };
} | null = null;

vi.mock('@codemirror/view', () => {
  class MockEditorView {
    dom = document.createElement('div');
    contentDOM = {
      focus: mockContentDomFocus
    };
    state = {
      doc: {
        toString: () => '',
        lines: 20,
        line: (number: number) => ({ from: (number - 1) * 10, length: 10 }),
        lineAt: () => ({ number: 1, text: '' })
      }
    };
    dispatch = mockEditorViewDispatch;
    focus = mockEditorViewFocus;
    destroy = mockEditorViewDestroy;
    static updateListener = { of: vi.fn().mockReturnValue([]) };
    static contentAttributes = { of: vi.fn().mockReturnValue([]) };
    static domEventHandlers = vi.fn().mockReturnValue([]);
    static theme = vi.fn().mockReturnValue([]);
    static scrollIntoView = vi.fn((anchor: number) => ({ anchor }));
    static lineWrapping = [];
    constructor() {
      lastEditorView = {
        dispatch: this.dispatch,
        focus: this.focus,
        contentDOM: this.contentDOM
      };
    }
  }
  return {
    EditorView: MockEditorView,
    keymap: { of: vi.fn().mockReturnValue([]) }
  };
});

vi.mock('@codemirror/state', () => ({
  Transaction: { addToHistory: { of: () => ({}) } },
  EditorState: {
    create: vi.fn().mockReturnValue({
      doc: { toString: () => '' }
    }),
    readOnly: { of: vi.fn().mockReturnValue([]) }
  },
  Compartment: class MockCompartment {
    of(ext: unknown) {
      return ext;
    }
    reconfigure(ext: unknown) {
      return ext;
    }
  }
}));

vi.mock('../../src/lang/document-extensions.js', () => ({
  documentExtensions: () => [],
  externalDocumentChange: { of: () => ({}) },
  minimalDocumentChange: (before: string, after: string) => ({ from: 0, to: before.length, insert: after }),
  setProtectedRegion: { of: () => ({}) }
}));

// The real decoration lifecycle is exercised in SourceEditor-navigation-highlight.test.tsx.
vi.mock('../../src/lang/source-navigation-highlight.js', () => ({
  sourceNavigationHighlight: [],
  setSourceReveal: { of: (anchor: number) => ({ revealAnchor: anchor }) },
  clearSourceReveal: vi.fn()
}));

vi.mock('codemirror', () => ({
  basicSetup: []
}));

vi.mock('@codemirror/commands', () => ({
  defaultKeymap: []
}));

vi.mock('@codemirror/language', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@codemirror/language')>()),
  HighlightStyle: { define: vi.fn().mockReturnValue([]) },
  syntaxHighlighting: vi.fn().mockReturnValue([]),
  defaultHighlightStyle: []
}));

vi.mock('@lezer/highlight', () => ({
  tags: new Proxy(
    {},
    {
      get:
        () =>
        (..._args: unknown[]) =>
          'tag'
    }
  )
}));

vi.mock('../../src/lang/rune-dsl.js', () => ({
  runeDslLanguage: vi.fn().mockReturnValue([])
}));

vi.mock('../../src/lang/editor-theme.js', () => ({
  studioEditorExtensions: [],
  studioEditorTheme: [],
  studioEditorHighlightStyle: []
}));

const sampleFiles: SourceEditorProps['files'] = [
  {
    name: 'model.rosetta',
    path: '/workspace/model.rosetta',
    content: 'namespace foo',
    dirty: false
  },
  { name: 'types.rosetta', path: '/workspace/types.rosetta', content: 'type Bar:', dirty: true }
];

describe('SourceEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastEditorView = null;
  });

  describe('rendering', () => {
    it('renders empty state when no files', () => {
      render(<SourceEditor files={[]} />);
      expect(screen.getByText(/no files loaded/i)).toBeInTheDocument();
    });

    it('shows dirty indicator on modified files', () => {
      render(<SourceEditor files={sampleFiles} />);
      const typesTab = screen.getByText('types.rosetta').closest('button')!;
      expect(within(typesTab).getByText('●')).toBeInTheDocument();
    });

    it('highlights active tab', () => {
      render(<SourceEditor files={sampleFiles} activeFile="/workspace/types.rosetta" />);
      const typesTab = screen.getByText('types.rosetta').closest('button')!;
      expect(typesTab.getAttribute('aria-selected')).toBe('true');
    });
  });

  describe('tabs', () => {
    it('calls onFileSelect when tab is clicked', () => {
      const onFileSelect = vi.fn();
      render(<SourceEditor files={sampleFiles} onFileSelect={onFileSelect} />);
      fireEvent.click(screen.getByText('types.rosetta'));
      expect(onFileSelect).toHaveBeenCalledWith('/workspace/types.rosetta');
    });

    it('switches active tab on click', () => {
      render(<SourceEditor files={sampleFiles} />);
      fireEvent.click(screen.getByText('types.rosetta'));
      const typesTab = screen.getByText('types.rosetta').closest('button')!;
      expect(typesTab.getAttribute('aria-selected')).toBe('true');
    });

    it('supports arrow-key tab switching for compact keyboard navigation', () => {
      render(<SourceEditor files={sampleFiles} activeFile="/workspace/model.rosetta" />);
      const modelTab = screen.getByText('model.rosetta').closest('button')!;
      fireEvent.keyDown(modelTab, { key: 'ArrowRight' });
      const typesTab = screen.getByText('types.rosetta').closest('button')!;
      expect(typesTab.getAttribute('aria-selected')).toBe('true');
      expect(document.activeElement).toBe(typesTab);
      fireEvent.keyDown(typesTab, { key: 'ArrowLeft' });
      expect(modelTab.getAttribute('aria-selected')).toBe('true');
      expect(document.activeElement).toBe(modelTab);
    });
  });

  describe('editor container', () => {
    it('reveals a source position in the active editor view', () => {
      const ref = React.createRef<import('../../src/components/SourceEditor.js').SourceEditorRef>();
      render(<SourceEditor ref={ref} files={sampleFiles} />);

      ref.current?.revealPosition({ line: 2, character: 3 });

      expect(lastEditorView?.dispatch).toHaveBeenCalledWith({
        selection: { anchor: 12 },
        effects: [{ anchor: 12 }, { revealAnchor: 12 }]
      });
      expect(lastEditorView?.contentDOM.focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it('scrolls to an explorer-selected line without stealing focus from the filter', () => {
      const ref = React.createRef<import('../../src/components/SourceEditor.js').SourceEditorRef>();
      render(<SourceEditor ref={ref} files={sampleFiles} />);
      const filter = document.createElement('input');
      document.body.append(filter);
      filter.focus();

      expect(ref.current?.revealLine(2)).toBe(true);

      expect(lastEditorView?.dispatch).toHaveBeenCalledWith({
        selection: { anchor: 10 },
        effects: [{ anchor: 10 }, { revealAnchor: 10 }]
      });
      expect(lastEditorView?.contentDOM.focus).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(filter);
      filter.remove();
    });

    it('does not acknowledge or defer a line reveal when no editor view exists', () => {
      const ref = React.createRef<import('../../src/components/SourceEditor.js').SourceEditorRef>();
      const { rerender } = render(<SourceEditor ref={ref} files={[]} />);
      expect(ref.current?.revealLine(2, sampleFiles[0]!.path)).toBe(false);
      rerender(<SourceEditor ref={ref} files={sampleFiles} />);
      expect(mockEditorViewDispatch).not.toHaveBeenCalled();
    });

    it('rejects a different file without switching tabs or scheduling a reveal', async () => {
      const ref = React.createRef<import('../../src/components/SourceEditor.js').SourceEditorRef>();
      const onFileSelect = vi.fn();
      render(<SourceEditor ref={ref} files={sampleFiles} onFileSelect={onFileSelect} />);
      let revealed: boolean | undefined;
      await act(async () => {
        revealed = ref.current?.revealLine(2, sampleFiles[1]!.path);
      });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      expect(revealed).toBe(false);
      expect(mockEditorViewDispatch).not.toHaveBeenCalled();
      expect(onFileSelect).not.toHaveBeenCalled();
      expect(screen.getByText('model.rosetta').closest('button')).toHaveAttribute('aria-selected', 'true');
    });

    it('rejects a line reveal before the selected file has a matching live view', () => {
      const ref = React.createRef<import('../../src/components/SourceEditor.js').SourceEditorRef>();
      const results: (boolean | undefined)[] = [];
      function Harness({ path }: { path: string }) {
        React.useLayoutEffect(() => {
          results.push(ref.current?.revealLine(2, path));
        }, [path]);
        return <SourceEditor ref={ref} files={sampleFiles} activeFile={path} />;
      }
      const { rerender } = render(<Harness path={sampleFiles[0]!.path} />);
      expect(results).toEqual([false]);
      rerender(<Harness path={sampleFiles[1]!.path} />);
      expect(results).toEqual([false, false]);
      expect(mockEditorViewDispatch).not.toHaveBeenCalled();
      expect(ref.current?.revealLine(2, sampleFiles[1]!.path)).toBe(true);
    });

    it('does not apply deferred position navigation to a newer file selection', async () => {
      const ref = React.createRef<import('../../src/components/SourceEditor.js').SourceEditorRef>();
      render(<SourceEditor ref={ref} files={sampleFiles} />);
      await act(async () => {
        ref.current?.revealPosition({ line: 2, character: 3 }, sampleFiles[1]!.path);
      });
      fireEvent.click(screen.getByText('model.rosetta'));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      expect(mockEditorViewDispatch).not.toHaveBeenCalled();
      expect(mockContentDomFocus).not.toHaveBeenCalled();
    });

    it('switches files before revealing a source position in another tab', async () => {
      const ref = React.createRef<import('../../src/components/SourceEditor.js').SourceEditorRef>();
      const onFileSelect = vi.fn();
      render(
        <SourceEditor ref={ref} files={sampleFiles} activeFile="/workspace/model.rosetta" onFileSelect={onFileSelect} />
      );

      await act(async () => {
        ref.current?.revealPosition({ line: 2, character: 3 }, '/workspace/types.rosetta');
      });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      expect(onFileSelect).toHaveBeenCalledWith('/workspace/types.rosetta');
      const typesTab = screen.getByText('types.rosetta').closest('button')!;
      expect(typesTab.getAttribute('aria-selected')).toBe('true');
      expect(lastEditorView?.dispatch).toHaveBeenCalledWith({
        selection: { anchor: 12 },
        effects: [{ anchor: 12 }, { revealAnchor: 12 }]
      });
      expect(lastEditorView?.contentDOM.focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it('matches a basename when revealPosition is given a different file path format', async () => {
      const ref = React.createRef<import('../../src/components/SourceEditor.js').SourceEditorRef>();
      const onFileSelect = vi.fn();
      render(
        <SourceEditor ref={ref} files={sampleFiles} activeFile="/workspace/model.rosetta" onFileSelect={onFileSelect} />
      );

      await act(async () => {
        ref.current?.revealPosition({ line: 2, character: 3 }, 'types.rosetta');
      });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      expect(onFileSelect).toHaveBeenCalledWith('/workspace/types.rosetta');
      const typesTab = screen.getByText('types.rosetta').closest('button')!;
      expect(typesTab.getAttribute('aria-selected')).toBe('true');
      expect(lastEditorView?.dispatch).toHaveBeenCalledWith({
        selection: { anchor: 12 },
        effects: [{ anchor: 12 }, { revealAnchor: 12 }]
      });
      expect(lastEditorView?.contentDOM.focus).toHaveBeenCalledWith({ preventScroll: true });
    });
  });

  describe('read-only files', () => {
    const readOnlyFile = {
      name: 'system.rosetta',
      path: 'system://com.rosetta.model/system.rosetta',
      content: 'namespace com.rosetta.model',
      dirty: false,
      readOnly: true
    };
    const editableFile = {
      name: 'model.rosetta',
      path: '/workspace/model.rosetta',
      content: 'namespace foo',
      dirty: false
    };

    it('shows lock icon for read-only tab', () => {
      render(<SourceEditor files={[readOnlyFile, editableFile]} />);
      const systemTab = screen.getByText('system.rosetta').closest('button')!;
      expect(within(systemTab).getByLabelText('read-only')).toBeInTheDocument();
    });

    it('does not show lock icon for regular tab', () => {
      render(<SourceEditor files={[readOnlyFile, editableFile]} />);
      const modelTab = screen.getByText('model.rosetta').closest('button')!;
      expect(within(modelTab).queryByLabelText('read-only')).not.toBeInTheDocument();
    });

    it('hides close button for read-only tab when onFileClose is provided', () => {
      const onFileClose = vi.fn();
      render(<SourceEditor files={[readOnlyFile, editableFile]} onFileClose={onFileClose} />);
      // Read-only tab: no close button
      expect(screen.queryByLabelText('Close system.rosetta')).not.toBeInTheDocument();
      // Editable tab: close button present
      expect(screen.getByLabelText('Close model.rosetta')).toBeInTheDocument();
    });

    it('applies read-only EditorState extension when read-only file is active', async () => {
      const { EditorState } = vi.mocked(await import('@codemirror/state'));
      const onContentChange = vi.fn();
      render(<SourceEditor files={[readOnlyFile]} activeFile={readOnlyFile.path} onContentChange={onContentChange} />);
      // EditorState.readOnly.of should have been called with true
      expect(EditorState.readOnly.of).toHaveBeenCalledWith(true);
    });

    it('acknowledges a read-only line reveal without changing content or focus', () => {
      const ref = React.createRef<import('../../src/components/SourceEditor.js').SourceEditorRef>();
      const onContentChange = vi.fn();
      render(
        <SourceEditor
          ref={ref}
          files={[readOnlyFile]}
          activeFile={readOnlyFile.path}
          onContentChange={onContentChange}
        />
      );
      expect(ref.current?.revealLine(2, readOnlyFile.path)).toBe(true);
      expect(mockEditorViewDispatch).toHaveBeenCalledWith({
        selection: { anchor: 10 },
        effects: [{ anchor: 10 }, { revealAnchor: 10 }]
      });
      expect(onContentChange).not.toHaveBeenCalled();
      expect(mockContentDomFocus).not.toHaveBeenCalled();
    });

    it('does NOT register drop handlers for read-only files', async () => {
      const { EditorView } = vi.mocked(await import('@codemirror/view'));
      render(<SourceEditor files={[readOnlyFile]} activeFile={readOnlyFile.path} />);
      // domEventHandlers must not have been called with drag/drop handlers when the
      // active file is read-only — otherwise programmatic view.dispatch() inside the
      // drop handler would silently mutate a system buffer that onContentChange never sees.
      expect(EditorView.domEventHandlers).not.toHaveBeenCalled();
    });

    it('registers drop handlers for writable files', async () => {
      const { EditorView } = vi.mocked(await import('@codemirror/view'));
      render(<SourceEditor files={[editableFile]} activeFile={editableFile.path} />);
      // For a writable file the drop extension must be installed.
      expect(EditorView.domEventHandlers).toHaveBeenCalledOnce();
    });
  });

  describe('graph navigation via source clicks (issue #453 follow-up)', () => {
    const navFile = {
      name: 'nav.rosetta',
      path: '/workspace/nav.rosetta',
      content: ['namespace foo.bar', '', 'type MyType:', '  x string (1..1)'].join('\n'),
      dirty: false
    };

    // Invokes every EditorView.updateListener.of(...) callback registered
    // during render with a synthetic update carrying one transaction tagged
    // `userEvent` — mirrors how @codemirror/view actually tags a real
    // mouse-driven selection change ("select.pointer") vs. the LSP client's
    // go-to-definition ("select.definition"), verified against the
    // installed @codemirror/view package. The docChanged-only listener
    // (registered for non-readOnly files) no-ops on this synthetic update
    // since `docChanged` is left undefined, so invoking every captured
    // listener is safe — no need to single out "the navigation one".
    async function fireSelectionTransaction(userEvent: string, headPos: number, file = navFile) {
      const { EditorView } = vi.mocked(await import('@codemirror/view'));
      const { EditorState: RealEditorState } =
        await vi.importActual<typeof import('@codemirror/state')>('@codemirror/state');
      const { StreamLanguage } = await vi.importActual<typeof import('@codemirror/language')>('@codemirror/language');
      const { runeDslStreamParser } =
        await vi.importActual<typeof import('../../src/lang/rune-dsl.js')>('../../src/lang/rune-dsl.js');
      const state = RealEditorState.create({
        doc: file.content,
        extensions: StreamLanguage.define(runeDslStreamParser)
      });
      const update = {
        transactions: [{ isUserEvent: (e: string) => e === userEvent, newSelection: { main: { head: headPos } } }],
        state
      };
      for (const call of EditorView.updateListener.of.mock.calls) {
        (call[0] as (u: unknown) => void)(update);
      }
    }

    it('navigates to the graph node when the cursor is placed via a plain click (select.pointer)', async () => {
      const onNavigateToNode = vi.fn();
      render(<SourceEditor files={[navFile]} activeFile={navFile.path} onNavigateToNode={onNavigateToNode} />);

      // Position within "type MyType:" (line 3, 0-indexed offset within the doc).
      const headPos = navFile.content.indexOf('type MyType:') + 5;
      await fireSelectionTransaction('select.pointer', headPos);

      expect(onNavigateToNode).toHaveBeenCalledWith('foo.bar.MyType');
    });

    it('still navigates on an explicit go-to-definition (select.definition)', async () => {
      const onNavigateToNode = vi.fn();
      render(<SourceEditor files={[navFile]} activeFile={navFile.path} onNavigateToNode={onNavigateToNode} />);

      const headPos = navFile.content.indexOf('type MyType:') + 5;
      await fireSelectionTransaction('select.definition', headPos);

      expect(onNavigateToNode).toHaveBeenCalledWith('foo.bar.MyType');
    });

    it('keeps the declaration kind when selecting a function in source', async () => {
      const functionFile = {
        ...navFile,
        content: ['namespace foo.bar', '', 'func UpdateAmount:'].join('\n')
      };
      const onNavigateToNode = vi.fn();
      render(
        <SourceEditor files={[functionFile]} activeFile={functionFile.path} onNavigateToNode={onNavigateToNode} />
      );

      await fireSelectionTransaction('select.pointer', functionFile.content.indexOf('UpdateAmount'), functionFile);

      expect(onNavigateToNode).toHaveBeenCalledWith('foo.bar.UpdateAmount#RosettaFunction');
    });

    it('does not navigate on plain keyboard cursor movement (select.keyboard)', async () => {
      const onNavigateToNode = vi.fn();
      render(<SourceEditor files={[navFile]} activeFile={navFile.path} onNavigateToNode={onNavigateToNode} />);

      const headPos = navFile.content.indexOf('type MyType:') + 5;
      await fireSelectionTransaction('select.keyboard', headPos);

      expect(onNavigateToNode).not.toHaveBeenCalled();
    });
  });

  describe('late-binding the LSP plugin (issue: no squiggles/autocomplete)', () => {
    it('does not wire the LSP plugin while the client has not finished connecting', () => {
      const isInitialized = vi.fn().mockReturnValue(false);
      const getPlugin = vi.fn().mockReturnValue('mock-lsp-plugin');
      const lspClient = { isInitialized, getPlugin } as unknown as LspClientService;

      render(
        <SourceEditor files={sampleFiles} activeFile={sampleFiles[0]!.path} lspClient={lspClient} lspReady={false} />
      );

      expect(getPlugin).not.toHaveBeenCalled();
      expect(mockEditorViewDispatch).not.toHaveBeenCalled();
    });

    it('attaches the LSP plugin once lspReady flips true, without recreating the EditorView', () => {
      const isInitialized = vi.fn().mockReturnValue(false);
      const getPlugin = vi.fn().mockReturnValue('mock-lsp-plugin');
      const lspClient = { isInitialized, getPlugin } as unknown as LspClientService;

      const { rerender } = render(
        <SourceEditor files={sampleFiles} activeFile={sampleFiles[0]!.path} lspClient={lspClient} lspReady={false} />
      );
      expect(mockEditorViewDispatch).not.toHaveBeenCalled();

      // The LSP connection finishes — the client's underlying object identity
      // never changes (the same LspClientService instance is reused across
      // the connect lifecycle), only `lspReady` (a separately-tracked, truly
      // reactive prop) flips.
      isInitialized.mockReturnValue(true);
      rerender(
        <SourceEditor files={sampleFiles} activeFile={sampleFiles[0]!.path} lspClient={lspClient} lspReady={true} />
      );

      expect(getPlugin).toHaveBeenCalledWith(expect.stringContaining('model.rosetta'));
      expect(mockEditorViewDispatch).toHaveBeenCalledWith({ effects: 'mock-lsp-plugin' });
      // Must NOT tear down and recreate the whole EditorView for this — that
      // would drop the user's cursor position, scroll offset, and undo
      // history mid-session just because the LSP connection finished.
      expect(mockEditorViewDestroy).not.toHaveBeenCalled();
    });

    it('wires the LSP plugin immediately on mount when the client is already ready', () => {
      const isInitialized = vi.fn().mockReturnValue(true);
      const getPlugin = vi.fn().mockReturnValue('mock-lsp-plugin');
      const lspClient = { isInitialized, getPlugin } as unknown as LspClientService;

      render(<SourceEditor files={sampleFiles} activeFile={sampleFiles[0]!.path} lspClient={lspClient} lspReady />);

      expect(getPlugin).toHaveBeenCalledWith(expect.stringContaining('model.rosetta'));
    });

    it('does not re-wire the LSP plugin on a content-only edit (same path, new object identity)', () => {
      // handleSourceChange in ExplorePerspective.tsx spreads `{ ...f, content,
      // dirty: true }` on every edit, so `files` (and therefore the file
      // object matching `activeFile`) gets a brand-new reference on every
      // keystroke even though the path never changes. Reconfiguring the LSP
      // compartment on every such edit would destroy and recreate the
      // LSPPlugin instance, silently discarding whatever hadn't yet reached
      // the server via @codemirror/lsp-client's own debounced autoSync.
      const isInitialized = vi.fn().mockReturnValue(true);
      const getPlugin = vi.fn().mockReturnValue('mock-lsp-plugin');
      const lspClient = { isInitialized, getPlugin } as unknown as LspClientService;

      const { rerender } = render(
        <SourceEditor files={sampleFiles} activeFile={sampleFiles[0]!.path} lspClient={lspClient} lspReady />
      );
      expect(getPlugin).toHaveBeenCalledTimes(1);
      mockEditorViewDispatch.mockClear();
      getPlugin.mockClear();

      const editedFiles: SourceEditorProps['files'] = sampleFiles.map((f) =>
        f.path === sampleFiles[0]!.path ? { ...f, content: 'namespace foo\ntype Baz:', dirty: true } : f
      );
      rerender(<SourceEditor files={editedFiles} activeFile={sampleFiles[0]!.path} lspClient={lspClient} lspReady />);

      expect(getPlugin).not.toHaveBeenCalled();
      // The editor's own content-sync effect legitimately dispatches a
      // `changes` transaction to reflect the new prop content — only the
      // LSP-compartment RECONFIGURE (which would destroy/recreate the
      // LSPPlugin and its unsyncedChanges) must not happen.
      expect(mockEditorViewDispatch).not.toHaveBeenCalledWith({ effects: 'mock-lsp-plugin' });
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Phase 9: pure drop-handler unit tests (no EditorView construction needed)
// ────────────────────────────────────────────────────────────────────────────

/** Build a minimal DragEvent-like object for testing. */
function makeDragEvent(overrides: {
  types?: string[];
  getData?: (mime: string) => string;
  clientX?: number;
  clientY?: number;
}): DragEvent {
  const types = overrides.types ?? [TYPE_REF_PAYLOAD_MIME];
  const getData = overrides.getData ?? (() => '');
  const event = {
    dataTransfer: {
      types,
      get dropEffect() {
        return 'none';
      },
      set dropEffect(_v: string) {
        /* no-op in some stubs */
      },
      getData
    },
    clientX: overrides.clientX ?? 100,
    clientY: overrides.clientY ?? 200,
    preventDefault: vi.fn()
  } as unknown as DragEvent;
  return event;
}

const VALID_PAYLOAD = {
  rune: 'type-ref',
  namespaceUri: 'cdm.trade',
  typeId: 'cdm.trade.Trade',
  typeName: 'Trade',
  kind: 'Data'
};

function makeView(posAtCoordsResult: number | null = 42): {
  view: DropTargetView;
  dispatch: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
} {
  const dispatch = vi.fn();
  const focus = vi.fn();
  const view: DropTargetView = {
    posAtCoords: vi.fn().mockReturnValue(posAtCoordsResult),
    state: { selection: { main: { head: 7 } } },
    dispatch,
    focus
  };
  return { view, dispatch, focus };
}

describe('handleTypeRefDragOver', () => {
  it('accepts dragover when our MIME is present', () => {
    const event = makeDragEvent({ types: [TYPE_REF_PAYLOAD_MIME] });
    const result = handleTypeRefDragOver(event);
    expect(result).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('accepts MIME comparison case-insensitively (browsers uppercase)', () => {
    const event = makeDragEvent({ types: [TYPE_REF_PAYLOAD_MIME.toUpperCase()] });
    const result = handleTypeRefDragOver(event);
    expect(result).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('rejects dragover when MIME is absent', () => {
    const event = makeDragEvent({ types: ['text/plain'] });
    const result = handleTypeRefDragOver(event);
    expect(result).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('rejects dragover when dataTransfer is null', () => {
    const event = { dataTransfer: null, preventDefault: vi.fn() } as unknown as DragEvent;
    const result = handleTypeRefDragOver(event);
    expect(result).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('handleTypeRefDrop', () => {
  it('inserts qualified name at drop position and returns true', () => {
    const { view, dispatch, focus } = makeView(42);
    const event = makeDragEvent({
      getData: (mime) => (mime === TYPE_REF_PAYLOAD_MIME ? JSON.stringify(VALID_PAYLOAD) : '')
    });
    const result = handleTypeRefDrop(event, view);
    expect(result).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({
      changes: { from: 42, to: 42, insert: 'cdm.trade.Trade' },
      selection: { anchor: 42 + 'cdm.trade.Trade'.length }
    });
    // Focus must be restored after dispatch so the user can type immediately.
    expect(focus).toHaveBeenCalledOnce();
  });

  it('falls back to selection.main.head when posAtCoords returns null', () => {
    const { view, dispatch } = makeView(null);
    const event = makeDragEvent({
      getData: (mime) => (mime === TYPE_REF_PAYLOAD_MIME ? JSON.stringify(VALID_PAYLOAD) : '')
    });
    handleTypeRefDrop(event, view);
    // head is 7
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ changes: expect.objectContaining({ from: 7, to: 7 }) })
    );
  });

  it('rejects when MIME data is empty (wrong drag source)', () => {
    const { view, dispatch } = makeView(42);
    const event = makeDragEvent({ getData: () => '' });
    const result = handleTypeRefDrop(event, view);
    expect(result).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects when payload JSON is malformed', () => {
    const { view, dispatch } = makeView(42);
    const event = makeDragEvent({ getData: () => 'not-json{' });
    const result = handleTypeRefDrop(event, view);
    expect(result).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects when payload fails isTypeRefPayload guard (missing field)', () => {
    const { view, dispatch } = makeView(42);
    const invalid = { rune: 'type-ref', namespaceUri: 'cdm.trade' }; // missing typeId, typeName, kind
    const event = makeDragEvent({
      getData: (mime) => (mime === TYPE_REF_PAYLOAD_MIME ? JSON.stringify(invalid) : '')
    });
    const result = handleTypeRefDrop(event, view);
    expect(result).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects when dataTransfer is null', () => {
    const { view, dispatch } = makeView(42);
    const event = { dataTransfer: null, clientX: 0, clientY: 0, preventDefault: vi.fn() } as unknown as DragEvent;
    const result = handleTypeRefDrop(event, view);
    expect(result).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

it('reconfigures editability without destroying the active editor view', () => {
  const file = { name: 'session.rosetta', path: 'session.rosetta', content: 'namespace demo', dirty: false };
  const { rerender } = render(<SourceEditor files={[file]} activeFile={file.path} />);
  const view = lastEditorView;
  const destroyed = mockEditorViewDestroy.mock.calls.length;
  rerender(<SourceEditor files={[{ ...file, readOnly: true }]} activeFile={file.path} />);
  expect(lastEditorView).toBe(view);
  expect(mockEditorViewDestroy).toHaveBeenCalledTimes(destroyed);
  rerender(<SourceEditor files={[file]} activeFile={file.path} />);
  expect(lastEditorView).toBe(view);
  expect(mockEditorViewDestroy).toHaveBeenCalledTimes(destroyed);
});
