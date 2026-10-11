// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * StudioWorkspace tests — the @codemirror/lsp-client Workspace
 * implementation backing the Source editor's LSP features.
 *
 * Deliberately does NOT mock @codemirror/lsp-client (unlike
 * lsp-client.test.ts) — StudioWorkspace's real logic, extending the real
 * Workspace base class, is what's under test here.
 */

import { describe, it, expect, vi } from 'vitest';
import { Text } from '@codemirror/state';
import type { LSPClient } from '@codemirror/lsp-client';
import type { EditorView } from '@codemirror/view';
import { StudioWorkspace } from '../../src/services/lsp-client.js';

function makeFakeClient() {
  return {
    didOpen: vi.fn(),
    didClose: vi.fn(),
    notification: vi.fn()
  };
}

/** `plugin` stands in for what a real EditorView.plugin(lspPlugin) lookup
 * would return — LSPPlugin.get(view) forwards it verbatim. Defaults to
 * null, matching "no LSPPlugin currently mounted on this bare view". */
function makeFakeView(text: string, plugin: unknown = null): EditorView {
  return {
    state: { doc: Text.of(text.split('\n')) },
    plugin: () => plugin
  } as unknown as EditorView;
}

describe('StudioWorkspace', () => {
  it('tracks a file on openFile without calling client.didOpen', () => {
    // Document lifecycle is owned solely by LspProvider.tsx's
    // syncWorkspaceFiles — an EditorView mounting must not independently
    // tell the server anything, or it can race syncWorkspaceFiles's own
    // open/close tracking (see the comment above StudioWorkspace's
    // openFile/closeFile in lsp-client.ts).
    const client = makeFakeClient();
    const ws = new StudioWorkspace(client as unknown as LSPClient);
    const view = makeFakeView('namespace a');

    ws.openFile('file:///a.rosetta', 'rosetta', view);

    expect(ws.getFile('file:///a.rosetta')).not.toBeNull();
    expect(client.didOpen).not.toHaveBeenCalled();
  });

  it('untracks a file on closeFile without calling client.didClose', () => {
    const client = makeFakeClient();
    const ws = new StudioWorkspace(client as unknown as LSPClient);
    const view = makeFakeView('namespace a');
    ws.openFile('file:///a.rosetta', 'rosetta', view);

    ws.closeFile('file:///a.rosetta', view);

    expect(ws.getFile('file:///a.rosetta')).toBeNull();
    expect(client.didClose).not.toHaveBeenCalled();
  });

  it('re-opening the same URI (tab switch destroy + recreate) still never calls client.didOpen/didClose', () => {
    const client = makeFakeClient();
    const ws = new StudioWorkspace(client as unknown as LSPClient);
    const view1 = makeFakeView('namespace a');
    ws.openFile('file:///a.rosetta', 'rosetta', view1);

    const view2 = makeFakeView('namespace a');
    ws.openFile('file:///a.rosetta', 'rosetta', view2);

    expect(ws.files).toHaveLength(1);
    expect(ws.getFile('file:///a.rosetta')?.view).toBe(view2);
    expect(client.didOpen).not.toHaveBeenCalled();
    expect(client.didClose).not.toHaveBeenCalled();
  });

  it('preserves the synchronized version across view-only remounts', () => {
    const client = makeFakeClient();
    const ws = new StudioWorkspace(client as unknown as LSPClient);
    const uri = 'file:///a.rosetta';
    const first = makeFakeView('namespace a');
    ws.openFile(uri, 'rosetta', first);
    const version = ws.getFile(uri)!.version;
    ws.closeFile(uri, first);
    ws.openFile(uri, 'rosetta', makeFakeView('namespace a'));
    ws.openFile(uri, 'rosetta', makeFakeView('namespace a'));

    expect(ws.getFile(uri)!.version).toBe(version);
    expect(client.notification).not.toHaveBeenCalled();
  });

  it('closing an inactive Source view leaves the Inspector tracked and does not flush stale text', () => {
    const client = makeFakeClient();
    const ws = new StudioWorkspace(client as unknown as LSPClient);
    const source = makeFakeView('old', { unsyncedChanges: { empty: false }, clear: vi.fn() });
    const inspector = makeFakeView('latest');
    ws.openFile('file:///a.rosetta', 'rosetta', source);
    ws.openFile('file:///a.rosetta', 'rosetta', inspector);
    ws.closeFile('file:///a.rosetta', source);
    expect(ws.getFile('file:///a.rosetta')?.view).toBe(inspector);
    expect(client.notification).not.toHaveBeenCalled();
  });

  it('focus handoffs flush final edits with increasing versions', () => {
    const client = makeFakeClient();
    const ws = new StudioWorkspace(client as unknown as LSPClient);
    for (const text of ['first edit', 'second edit']) {
      const view = makeFakeView(text, { unsyncedChanges: { empty: false }, clear: vi.fn() });
      ws.openFile('file:///a.rosetta', 'rosetta', view);
      ws.closeFile('file:///a.rosetta', view);
    }
    const calls = client.notification.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]![1].textDocument.version).toBeGreaterThan(calls[0]![1].textDocument.version);
    expect(calls[1]![1].contentChanges).toEqual([{ text: 'second edit' }]);
  });

  it('closing an unopened URI is a no-op, not an error', () => {
    const client = makeFakeClient();
    const ws = new StudioWorkspace(client as unknown as LSPClient);
    const view = makeFakeView('namespace a');

    expect(() => ws.closeFile('file:///never-opened.rosetta', view)).not.toThrow();
    expect(client.didClose).not.toHaveBeenCalled();
  });

  it('flushes pending unsynced changes as a full-text didChange before untracking on closeFile', () => {
    // Regression: an edit made just before a tab switch or pane collapse,
    // before @codemirror/lsp-client's own 500ms autoSync debounce fires,
    // must not be silently dropped when closeFile untracks the file.
    const client = makeFakeClient();
    const ws = new StudioWorkspace(client as unknown as LSPClient);
    const fakePlugin = { unsyncedChanges: { empty: false }, clear: vi.fn() };
    const view = makeFakeView('namespace a\ntype Foo:', fakePlugin);
    ws.openFile('file:///a.rosetta', 'rosetta', view);

    ws.closeFile('file:///a.rosetta', view);

    expect(client.notification).toHaveBeenCalledWith('textDocument/didChange', {
      textDocument: { uri: 'file:///a.rosetta', version: expect.any(Number) },
      contentChanges: [{ text: 'namespace a\ntype Foo:' }]
    });
    expect(fakePlugin.clear).toHaveBeenCalledOnce();
  });

  it('does not send a didChange on closeFile when there are no unsynced changes', () => {
    const client = makeFakeClient();
    const ws = new StudioWorkspace(client as unknown as LSPClient);
    const fakePlugin = { unsyncedChanges: { empty: true }, clear: vi.fn() };
    const view = makeFakeView('namespace a', fakePlugin);
    ws.openFile('file:///a.rosetta', 'rosetta', view);

    ws.closeFile('file:///a.rosetta', view);

    expect(client.notification).not.toHaveBeenCalled();
    expect(fakePlugin.clear).not.toHaveBeenCalled();
  });

  it('does not flush when no LSPPlugin is found for the view (plugin already detached)', () => {
    const client = makeFakeClient();
    const ws = new StudioWorkspace(client as unknown as LSPClient);
    const view = makeFakeView('namespace a', null);
    ws.openFile('file:///a.rosetta', 'rosetta', view);

    expect(() => ws.closeFile('file:///a.rosetta', view)).not.toThrow();
    expect(client.notification).not.toHaveBeenCalled();
  });
});
