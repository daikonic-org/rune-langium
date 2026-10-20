// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect, vi } from 'vitest';
import { createRuneDslServices, compactLspModelJson, serializeRuneModel } from '@rune-langium/core';
import { URI } from 'langium';
import { createRuneLspServer } from '../src/rune-dsl-server.js';
import { DurableObjectWebSocketTransport } from '../src/cf-durable-object-transport.js';

function makeFakeWs() {
  const sent: unknown[] = [];
  return {
    readyState: 1,
    sent,
    send(data: string) {
      sent.push(JSON.parse(data));
    },
    close() {
      /* noop */
    }
  };
}

describe('RuneDocumentUpdateHandler', () => {
  it('removes a closed document from the workspace index on a real textDocument/didClose', async () => {
    const lsp = createRuneLspServer();
    const ws = makeFakeWs();
    const transport = new DurableObjectWebSocketTransport(ws);
    void lsp.listen(transport);
    const uri = URI.parse('file:///a.rosetta');

    // fireDocumentUpdate's deletion chain awaits workspaceManager.ready,
    // which only resolves once a real initialize/initialized handshake has
    // completed — drive one, matching what a real client does.
    transport.receive(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { processId: null, rootUri: null, capabilities: {} }
      })
    );
    await vi.waitFor(() => {
      expect(ws.sent.some((m: any) => m.id === 1)).toBe(true);
    });
    transport.receive(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }));

    transport.receive(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: { textDocument: { uri: uri.toString(), languageId: 'rosetta', version: 0, text: 'namespace a' } }
      })
    );
    await vi.waitFor(() => {
      expect(lsp.shared.workspace.LangiumDocuments.getDocument(uri)).toBeDefined();
    });

    transport.receive(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/didClose',
        params: { textDocument: { uri: uri.toString() } }
      })
    );

    await vi.waitFor(() => {
      expect(lsp.shared.workspace.LangiumDocuments.getDocument(uri)).toBeUndefined();
    });
  });

  it('publishes an empty diagnostics array for a closed document (clears client-side diagnostics)', async () => {
    // Not RuneDocumentUpdateHandler's own responsibility — Langium's
    // built-in addDiagnosticsHandler (wired automatically by
    // startLanguageServer, see language-server.js) listens on the SAME
    // DocumentBuilder.onUpdate hook didCloseDocument's fireDocumentUpdate
    // drives, and publishes `{ uri, diagnostics: [] }` for every deleted
    // URI. Without this, a client's Problems panel would keep showing a
    // closed file's last diagnostics forever. Locking this in here since
    // it's easy to assume (incorrectly) that it needs adding by hand.
    const lsp = createRuneLspServer();
    const ws = makeFakeWs();
    const transport = new DurableObjectWebSocketTransport(ws);
    void lsp.listen(transport);
    const uri = URI.parse('file:///c.rosetta');

    transport.receive(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { processId: null, rootUri: null, capabilities: {} }
      })
    );
    await vi.waitFor(() => {
      expect(ws.sent.some((m: any) => m.id === 1)).toBe(true);
    });
    transport.receive(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }));

    transport.receive(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: { textDocument: { uri: uri.toString(), languageId: 'rosetta', version: 0, text: 'namespace c' } }
      })
    );
    await vi.waitFor(() => {
      expect(lsp.shared.workspace.LangiumDocuments.getDocument(uri)).toBeDefined();
    });

    transport.receive(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/didClose',
        params: { textDocument: { uri: uri.toString() } }
      })
    );

    await vi.waitFor(() => {
      const cleared = ws.sent.find(
        (m: any) => m.method === 'textDocument/publishDiagnostics' && m.params?.uri === uri.toString()
      ) as any;
      expect(cleared).toBeDefined();
      expect(cleared.params.diagnostics).toEqual([]);
    });
  });
});

describe('lazy semantic dependency invalidation', () => {
  it('rechecks an open source after a transitive dependency changes through didOpen', async () => {
    const lsp = createRuneLspServer();
    const ws = makeFakeWs();
    const transport = new DurableObjectWebSocketTransport(ws);
    void lsp.listen(transport);
    transport.receive(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { processId: null, rootUri: null, capabilities: {} }
      })
    );
    await vi.waitFor(() => expect(ws.sent.some((m: any) => m.id === 1)).toBe(true));
    transport.receive(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }));
    const innerUri = 'file:///inner.rosetta';
    const outerUri = 'file:///outer.rosetta';
    const userUri = 'file:///user.rosetta';
    for (const [uri, source] of [
      [innerUri, 'namespace example\ntype Inner:\n field string (1..1)\n'],
      [outerUri, 'namespace example\ntype Outer:\n inner Inner (1..1)\n']
    ]) {
      const { RuneDsl, shared } = createRuneDslServices();
      const document = shared.workspace.LangiumDocumentFactory.fromString(source!, URI.parse(uri!));
      await shared.workspace.DocumentBuilder.build([document]);
      await lsp.syncModels({
        document: {
          uri: uri!,
          modelJson: compactLspModelJson(
            serializeRuneModel(RuneDsl.serializer.JsonSerializer, document.parseResult.value)
          )
        }
      });
    }
    await lsp.syncModels({ retain: [innerUri, outerUri] });
    const open = (uri: string, text: string) =>
      transport.receive(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'textDocument/didOpen',
          params: { textDocument: { uri, languageId: 'rosetta', version: 0, text } }
        })
      );
    open(
      userUri,
      'namespace example\ntype User:\n outer Outer (1..1)\n condition UsesField: outer -> inner -> field exists\n'
    );
    await vi.waitFor(() => {
      expect(
        ws.sent.some((m: any) => m.method === 'textDocument/publishDiagnostics' && m.params?.uri === userUri)
      ).toBe(true);
    });
    const diagnostics = () => {
      const messages = ws.sent.filter(
        (m: any) => m.method === 'textDocument/publishDiagnostics' && m.params?.uri === userUri
      );
      return messages[messages.length - 1] as any;
    };
    expect(diagnostics().params.diagnostics.filter((d: any) => d.severity === 1)).toEqual([]);
    open(innerUri, 'namespace example\ntype Inner:\n renamed string (1..1)\n');
    await vi.waitFor(() =>
      expect(diagnostics().params.diagnostics.some((d: any) => d.message.includes("'field'"))).toBe(true)
    );
    transport.signalClose();
  });
});
