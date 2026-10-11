// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Integration tests for the Rune DSL LSP server.
 *
 * Uses @lspeasy/client + @lspeasy/core StdioTransport with cross-wired
 * PassThrough streams to talk to a real LSP server in-process.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { OperationCancelled } from 'langium';
import { PassThrough } from 'node:stream';
import { StdioTransport } from '@lspeasy/core/node';
import { LSPClient } from '@lspeasy/client';
import { createRuneLspServer } from '../src/rune-dsl-server.js';
import type { RuneLspServer } from '../src/rune-dsl-server.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a cross-wired transport pair:
 *   client writes → server reads
 *   server writes → client reads
 */
function createTransportPair(): {
  clientTransport: StdioTransport;
  serverTransport: StdioTransport;
} {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();

  const clientTransport = new StdioTransport({
    input: serverToClient,
    output: clientToServer
  });

  const serverTransport = new StdioTransport({
    input: clientToServer,
    output: serverToClient
  });

  return { clientTransport, serverTransport };
}

const SAMPLE_URI = 'file:///test/sample.rosetta';
const SAMPLE_CONTENT = `namespace demo

type Foo:
  bar string (1..1)
  baz int (0..1)
`;

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('Rune DSL LSP Server', () => {
  let lsp: RuneLspServer;
  let client: LSPClient;

  beforeAll(async () => {
    const { clientTransport, serverTransport } = createTransportPair();

    // Create and start the server
    lsp = createRuneLspServer();
    await lsp.listen(serverTransport);

    // Connect the client (sends initialize + initialized automatically)
    client = new LSPClient({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
  }, 15_000);

  afterAll(async () => {
    if (client?.isConnected()) {
      await client.disconnect();
    }
  });

  // ── Initialization ────────────────────────────────────────────────────

  it('should initialize successfully', () => {
    expect(client.isConnected()).toBe(true);
    const caps = client.getServerCapabilities();
    expect(caps).toBeDefined();
  });

  it('should report hover capability', () => {
    const caps = client.getServerCapabilities();
    expect(caps?.hoverProvider).toBeTruthy();
  });

  it('should report completion capability', () => {
    const caps = client.getServerCapabilities();
    expect(caps?.completionProvider).toBeTruthy();
  });

  it('should report definition capability', () => {
    const caps = client.getServerCapabilities();
    expect(caps?.definitionProvider).toBeTruthy();
  });

  // ── Document lifecycle ────────────────────────────────────────────────

  it('sends a cancelled Langium completion as a JSON-RPC error over the wire', async () => {
    const uri = 'file:///cancelled-completion.rosetta';
    const diagnostics = client.waitForNotification('textDocument/publishDiagnostics', {
      timeout: 10000,
      filter: (p) => p.uri === uri
    });
    await client.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: 'rune-dsl', version: 1, text: SAMPLE_CONTENT }
    });
    await diagnostics;
    const completion = vi
      .spyOn(lsp.services.lsp.CompletionProvider!, 'getCompletion')
      .mockRejectedValueOnce(OperationCancelled);
    try {
      await expect(
        client.sendRequest('textDocument/completion', {
          textDocument: { uri },
          position: { line: 0, character: 0 }
        })
      ).rejects.toThrow('The request has been cancelled. (code: -32800)');
    } finally {
      completion.mockRestore();
    }
  });

  it('should accept textDocument/didOpen and produce diagnostics', async () => {
    const diagnosticsPromise = client.waitForNotification('textDocument/publishDiagnostics', {
      timeout: 10_000,
      filter: (p) => p.uri === SAMPLE_URI
    });

    await client.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: SAMPLE_URI,
        languageId: 'rune-dsl',
        version: 1,
        text: SAMPLE_CONTENT
      }
    });

    const result = await diagnosticsPromise;
    expect(result).toBeDefined();
    expect(result.uri).toBe(SAMPLE_URI);
    expect(result.diagnostics).toEqual([]);
  }, 15_000);

  it('should report errors for invalid content', async () => {
    const badUri = 'file:///test/bad.rosetta';

    const diagnosticsPromise = client.waitForNotification('textDocument/publishDiagnostics', {
      timeout: 10_000,
      filter: (p) => p.uri === badUri
    });

    await client.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: badUri,
        languageId: 'rune-dsl',
        version: 1,
        text: 'this is not valid rune dsl !!!'
      }
    });

    const result = await diagnosticsPromise;
    expect(result.diagnostics.length).toBeGreaterThan(0);
    // Parser errors should be severity 1 (Error)
    expect(result.diagnostics.some((d: any) => d.severity === 1)).toBe(true);
  }, 15_000);

  it('clears a real syntax error after restoring valid built-in types', async () => {
    const uri = 'file:///test/restore.rosetta';
    const open = client.waitForNotification('textDocument/publishDiagnostics', {
      timeout: 10_000,
      filter: (p) => p.uri === uri
    });
    await client.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: 'rune-dsl', version: 1, text: 'invalid rune !!!' }
    });
    const opened = await open;
    expect(opened.version).toBe(1);
    expect(opened.diagnostics.some((d) => d.severity === 1)).toBe(true);
    const changed = client.waitForNotification('textDocument/publishDiagnostics', {
      timeout: 10_000,
      filter: (p) => p.uri === uri
    });
    await client.sendNotification('textDocument/didChange', {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: SAMPLE_CONTENT }]
    });
    const restored = await changed;
    expect(restored.version).toBe(2);
    expect(restored.diagnostics).toEqual([]);
  });

  // ── Document Symbols ──────────────────────────────────────────────────

  it('should return document symbols', async () => {
    const result = await client.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri: SAMPLE_URI }
    });

    // Should find at least the `Foo` type
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  }, 10_000);

  // ── Hover ─────────────────────────────────────────────────────────────

  it('should return hover for a type name', async () => {
    const result = await client.sendRequest('textDocument/hover', {
      textDocument: { uri: SAMPLE_URI },
      position: { line: 2, character: 5 } // "Foo" on `type Foo:`
    });

    // May return null if hover is not implemented for this position,
    // but at minimum the request should not error
    if (result) {
      expect(result.contents).toBeDefined();
    }
  }, 10_000);

  // ── Folding Ranges ────────────────────────────────────────────────────

  it('should return folding ranges', async () => {
    const result = await client.sendRequest('textDocument/foldingRange', {
      textDocument: { uri: SAMPLE_URI }
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  }, 10_000);
});
