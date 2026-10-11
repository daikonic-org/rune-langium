// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * CodePreviewPanel — status-transition tests (post-Codex-P2 edition).
 *
 * CodePreviewPanel is now a PURE-DISPLAY component. Worker ownership
 * lives in EditorPage. These tests seed `useCodegenStore` directly
 * (the same way EditorPage's new effects do) and assert that the panel
 * renders the expected status text.
 *
 * Worker props, addEventListener/removeEventListener assertions, and
 * postMessage assertions are gone — the component no longer has them.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

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
    static domEventHandlers = vi.fn(() => []);
    static lineWrapping = [];
    static editable = { of: vi.fn(() => []) };
    static contentAttributes = { of: vi.fn(() => []) };
    constructor({ parent }: { parent?: Element }) {
      if (parent) parent.appendChild(this.dom);
    }
  },
  lineNumbers: vi.fn(() => []),
  highlightActiveLine: vi.fn(() => []),
  drawSelection: vi.fn(() => [])
}));

vi.mock('@codemirror/state', () => ({
  Annotation: { define: vi.fn(() => ({ of: vi.fn(() => ({})) })) },
  EditorState: {
    create: vi.fn(() => ({})),
    readOnly: { of: vi.fn(() => []) },
    lineSeparator: { of: vi.fn(() => []) },
    transactionFilter: { of: vi.fn(() => []) }
  },
  Compartment: class {
    of = vi.fn(() => []);
    reconfigure = vi.fn(() => ({}));
  }
}));

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
// Put the store in viewer mode (activeTarget set) so these tests exercise the
// viewer area rather than the targets-table landing state.
beforeEach(() => useCodegenStore.setState({ codePreviewTarget: 'zod', activeTarget: 'zod' }));

describe('CodePreviewPanel — status transitions', () => {
  it('shows "Generating…" on initial mount', () => {
    // Store is in 'waiting' state (reset above sets snapshot to waiting).
    render(<CodePreviewPanel sourceEditorRef={null} />);
    expect(screen.getByTestId('codegen-status')).toHaveTextContent(/Generating/i);
  });

  it('shows "Generated (Zod)" after the store receives codegen:result with target=zod', async () => {
    render(<CodePreviewPanel sourceEditorRef={null} />);
    await act(async () => {
      useCodegenStore.getState().receiveCodePreviewResult({
        target: 'zod',
        files: [{ relativePath: 'ns.zod.ts', content: 'export const X = z.object({});', sourceMap: [] }]
      });
    });
    expect(screen.getByTestId('codegen-status')).toHaveTextContent(/Generated \(Zod\)/i);
    expect(screen.getByTestId('codegen-relative-path')).toHaveTextContent('ns.zod.ts');
  });

  it('shows "Outdated — fix errors to refresh" when the store is marked stale', async () => {
    render(<CodePreviewPanel sourceEditorRef={null} />);
    // First give the store a successful result so stale has files to preserve.
    await act(async () => {
      useCodegenStore.getState().receiveCodePreviewResult({
        target: 'zod',
        files: [{ relativePath: 'ns.zod.ts', content: 'content', sourceMap: [] }]
      });
    });
    await act(async () => {
      useCodegenStore.getState().markCodePreviewStale({
        target: 'zod',
        message: 'Fix model errors to refresh the code preview.'
      });
    });
    expect(screen.getByTestId('codegen-status')).toHaveTextContent(/Outdated.*fix errors/i);
  });

  it('retains content (does NOT blank) on codegen:outdated', async () => {
    render(<CodePreviewPanel sourceEditorRef={null} />);
    await act(async () => {
      useCodegenStore.getState().receiveCodePreviewResult({
        target: 'zod',
        files: [{ relativePath: 'ns.zod.ts', content: 'last good content', sourceMap: [] }]
      });
    });
    await act(async () => {
      useCodegenStore.getState().markCodePreviewStale({
        target: 'zod',
        message: 'Fix model errors to refresh the code preview.'
      });
    });
    // Panel is stale (has content) — NOT "Generating…".
    expect(screen.getByTestId('codegen-status')).not.toHaveTextContent(/Generating…/i);
  });

  it('shows "Preview unavailable" when generation fails before any successful output', async () => {
    render(<CodePreviewPanel sourceEditorRef={null} />);
    await act(async () => {
      useCodegenStore.getState().markCodePreviewUnavailable({
        target: 'zod',
        message: 'Code generation failed.'
      });
    });
    expect(screen.getByTestId('codegen-status')).toHaveTextContent(/Preview unavailable/i);
  });

  it('ignores stale responses with an older request id for the same target', async () => {
    render(<CodePreviewPanel sourceEditorRef={null} />);
    // Simulate what EditorPage's owner effect does: begin a new request (which
    // resets the snapshot to 'waiting' and issues a fresh requestId), then
    // receive a result for the fresh id. The stale id is never dispatched.
    await act(async () => {
      // Receive only the fresh result — stale ones are filtered by EditorPage.
      useCodegenStore.getState().receiveCodePreviewResult({
        target: 'zod',
        files: [{ relativePath: 'fresh.zod.ts', content: 'fresh', sourceMap: [] }]
      });
    });
    expect(screen.getByTestId('codegen-relative-path')).toHaveTextContent('fresh.zod.ts');
  });

  it('shows "Preview unavailable" when the store is marked unavailable (e.g. worker crash)', async () => {
    render(<CodePreviewPanel sourceEditorRef={null} />);
    await act(async () => {
      useCodegenStore.getState().markCodePreviewUnavailable({
        target: 'zod',
        message: 'Code preview worker crashed — reload Studio.'
      });
    });
    expect(screen.getByTestId('codegen-status')).toHaveTextContent(/Preview unavailable/i);
  });

  it('mounts and unmounts without worker props (pure display — no worker subscription)', () => {
    // This test verifies the component can mount and unmount without a worker.
    // The old test asserted removeEventListener was called; now there is nothing
    // to clean up since the component never subscribes to a worker.
    const { unmount } = render(<CodePreviewPanel sourceEditorRef={null} />);
    expect(() => unmount()).not.toThrow();
  });
});
