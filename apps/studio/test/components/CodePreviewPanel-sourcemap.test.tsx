// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * CodePreviewPanel — source-map click-to-navigate tests (post-Codex-P2 edition).
 *
 * CodePreviewPanel is now a PURE-DISPLAY component. Worker ownership lives in
 * EditorPage. These tests seed `useCodegenStore` directly (via
 * `receiveCodePreviewResult`) — the same way EditorPage's owner effect does —
 * then invoke the CodeMirror click handler to assert source-map navigation.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

// Capture the domEventHandlers argument so tests can invoke the click handler
// directly — the CodeMirror-based panel no longer has per-line DOM elements.
const capturedHandlers: { click?: (event: MouseEvent, view: object) => void } = {};

// These tests exercise panel routing/status; real editor cues are covered in CodePreviewPanel-arrival.
vi.mock('../../src/lang/source-navigation-highlight.js', () => ({
  sourceNavigationHighlight: [],
  clearSourceReveal: vi.fn(),
  setSourceReveal: { of: vi.fn(() => ({})) }
}));

vi.mock('@codemirror/view', () => ({
  EditorView: class MockEditorView {
    dom = document.createElement('div');
    state = { doc: { toString: () => '' } };
    destroy = vi.fn();
    dispatch = vi.fn();
    static theme = vi.fn(() => []);
    static updateListener = { of: vi.fn(() => []) };
    static lineWrapping = [];
    static editable = { of: vi.fn(() => []) };
    static contentAttributes = { of: vi.fn(() => []) };
    static domEventHandlers = vi.fn((handlers: { click?: (e: MouseEvent, v: object) => void }) => {
      if (handlers.click) capturedHandlers.click = handlers.click;
      return [];
    });
    constructor({ parent }: { parent?: Element }) {
      if (parent) parent.appendChild(this.dom);
    }
  },
  lineNumbers: vi.fn(() => []),
  highlightActiveLine: vi.fn(() => []),
  drawSelection: vi.fn(() => [])
}));
vi.mock('codemirror', () => ({ basicSetup: [] }));
vi.mock('@codemirror/language', () => ({
  StreamLanguage: { define: vi.fn(() => []) },
  HighlightStyle: { define: vi.fn(() => ({})) },
  syntaxHighlighting: vi.fn(() => [])
}));
vi.mock('@codemirror/lang-json', () => ({ json: vi.fn(() => []) }));
vi.mock('@codemirror/lang-javascript', () => ({ javascript: vi.fn(() => []) }));

import { CodePreviewPanel } from '../../src/components/CodePreviewPanel.js';
import { useCodegenStore } from '../../src/store/codegen-store.js';

afterEach(() => cleanup());
beforeEach(() => {
  // 018 Task 0.8 — `activeTarget` puts the panel in viewer mode so the
  // source-map navigation tests see the CodeMirror editor instead of
  // the landing targets table.
  useCodegenStore.setState({ codePreviewTarget: 'zod', activeTarget: 'zod' });
  capturedHandlers.click = undefined;
});

/** Returns a fake CodeMirror view whose posAtCoords maps to a given outputLine. */
function makeFakeView(outputLine: number) {
  return {
    posAtCoords: vi.fn((_: { x: number; y: number }) => outputLine),
    state: { doc: { lineAt: vi.fn((_pos: number) => ({ number: outputLine + 1 })) } }
  };
}

describe('CodePreviewPanel — source-map click-to-navigate', () => {
  it('calls revealPosition on mapped line click', async () => {
    const sourceEditorRef = { revealPosition: vi.fn() };
    render(<CodePreviewPanel sourceEditorRef={sourceEditorRef as never} />);
    const sourceMap = [{ outputLine: 2, sourceUri: 'file:///workspace/trade.rune', sourceLine: 5, sourceChar: 3 }];

    // Seed the store — simulates what EditorPage's owner effect does after
    // the worker posts a codegen:result message.
    await act(async () => {
      useCodegenStore.getState().receiveCodePreviewResult({
        target: 'zod',
        files: [{ relativePath: 'ns.zod.ts', content: 'line0\nline1\nline2\n', sourceMap }]
      });
    });

    // Invoke the CodeMirror click handler — posAtCoords returns 2, lineAt(2)
    // returns { number: 3 }, so lineNumber = 3 - 1 = 2, matching outputLine 2.
    await act(async () => {
      capturedHandlers.click?.(new MouseEvent('click', { clientX: 0, clientY: 0 }), makeFakeView(2));
    });

    expect(sourceEditorRef.revealPosition).toHaveBeenCalledWith({ line: 5, character: 3 }, 'trade.rune');
  });

  it('does nothing when clicking with empty source map', async () => {
    const sourceEditorRef = { revealPosition: vi.fn() };
    render(<CodePreviewPanel sourceEditorRef={sourceEditorRef as never} />);
    await act(async () => {
      useCodegenStore.getState().receiveCodePreviewResult({
        target: 'zod',
        files: [{ relativePath: 'ns.zod.ts', content: 'line0\nline1\n', sourceMap: [] }]
      });
    });
    await act(async () => {
      capturedHandlers.click?.(new MouseEvent('click', { clientX: 0, clientY: 0 }), makeFakeView(0));
    });
    expect(sourceEditorRef.revealPosition).not.toHaveBeenCalled();
  });

  it('does nothing when sourceEditorRef is null', async () => {
    render(<CodePreviewPanel sourceEditorRef={null} />);
    await act(async () => {
      useCodegenStore.getState().receiveCodePreviewResult({
        target: 'zod',
        files: [
          {
            relativePath: 'ns.zod.ts',
            content: 'line0\n',
            sourceMap: [
              {
                outputLine: 0,
                sourceUri: 'file:///workspace/trade.rune',
                sourceLine: 5,
                sourceChar: 3
              }
            ]
          }
        ]
      });
    });
    // Invoking the click handler with a null ref must not throw.
    await act(async () => {
      capturedHandlers.click?.(new MouseEvent('click', { clientX: 0, clientY: 0 }), makeFakeView(0));
    });
  });

  it('opens the mapped source file when the source map points at a different file', async () => {
    const sourceEditorRef = { revealPosition: vi.fn() };
    render(<CodePreviewPanel sourceEditorRef={sourceEditorRef as never} />);
    await act(async () => {
      useCodegenStore.getState().receiveCodePreviewResult({
        target: 'zod',
        files: [
          {
            relativePath: 'ns.zod.ts',
            content: 'line0\n',
            sourceMap: [
              {
                outputLine: 0,
                sourceUri: 'file:///workspace/other-file.rosetta',
                sourceLine: 9,
                sourceChar: 2
              }
            ]
          }
        ]
      });
    });

    await act(async () => {
      capturedHandlers.click?.(new MouseEvent('click', { clientX: 0, clientY: 0 }), makeFakeView(0));
    });

    expect(sourceEditorRef.revealPosition).toHaveBeenCalledWith({ line: 9, character: 2 }, 'other-file.rosetta');
  });
});
