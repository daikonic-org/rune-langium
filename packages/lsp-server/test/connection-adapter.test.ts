// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Unit tests for the connection adapter.
 */

import { describe, it, expect, vi } from 'vitest';
import { createConnectionAdapter } from '../src/connection-adapter.js';
import { ResponseError as VscodeResponseError } from 'vscode-languageserver';
import { ResponseError } from '@lspeasy/core';

/** Minimal mock of an LSPServer (just the methods the adapter touches) */
function createMockServer() {
  const requestHandlers = new Map<string, Function>();
  const notificationHandlers = new Map<string, Function>();

  return {
    requestHandlers,
    notificationHandlers,
    onRequest: vi.fn((method: string, handler: Function) => {
      requestHandlers.set(method, handler);
      return { dispose: () => requestHandlers.delete(method) };
    }),
    onNotification: vi.fn((method: string, handler: Function) => {
      notificationHandlers.set(method, handler);
      return { dispose: () => notificationHandlers.delete(method) };
    }),
    sendRequest: vi.fn(async () => undefined),
    sendNotification: vi.fn(async () => undefined),
    isListening: vi.fn(() => true),
    close: vi.fn(async () => undefined)
  };
}

describe('createConnectionAdapter', () => {
  it.each(['returned', 'thrown'] as const)(
    'converts %s Langium cancellation errors for every request surface',
    async (mode) => {
      const server = createMockServer();
      const conn = createConnectionAdapter(server as any);
      const error = new VscodeResponseError(-32800, 'Request cancelled', { reason: 'new edit' });
      const handler = () => {
        if (mode === 'thrown') throw error;
        return error;
      };
      conn.onCompletion(handler);
      conn.onRequest('textDocument/hover', handler);
      conn.languages.semanticTokens.on(handler);
      for (const method of ['textDocument/completion', 'textDocument/hover', 'textDocument/semanticTokens/full']) {
        const result = server.requestHandlers.get(method)!({}, {});
        await expect(result).rejects.toBeInstanceOf(ResponseError);
        await expect(result).rejects.toMatchObject({ code: -32800, message: error.message, data: error.data });
      }
    }
  );
  it('should forward onRequest with string method', () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    const handler = vi.fn();
    conn.onRequest('textDocument/hover', handler);

    expect(server.onRequest).toHaveBeenCalledWith('textDocument/hover', expect.any(Function));
  });

  it('should forward onRequest with ProtocolRequestType object', () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    const handler = vi.fn();
    conn.onRequest({ method: 'textDocument/definition' }, handler);

    expect(server.onRequest).toHaveBeenCalledWith('textDocument/definition', expect.any(Function));
  });

  it('should forward onNotification with string method', () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    const handler = vi.fn();
    conn.onNotification('textDocument/didOpen', handler);

    expect(server.onNotification).toHaveBeenCalledWith('textDocument/didOpen', expect.any(Function));
  });

  it('should map typed convenience methods — onHover', () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    const handler = vi.fn();
    conn.onHover(handler);

    expect(server.onRequest).toHaveBeenCalledWith('textDocument/hover', expect.any(Function));
  });

  it('should map typed convenience methods — onCompletion', () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    const handler = vi.fn();
    conn.onCompletion(handler);

    expect(server.onRequest).toHaveBeenCalledWith('textDocument/completion', expect.any(Function));
  });

  it('should map typed convenience methods — onDefinition', () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    const handler = vi.fn();
    conn.onDefinition(handler);

    expect(server.onRequest).toHaveBeenCalledWith('textDocument/definition', expect.any(Function));
  });

  it('should map typed convenience methods — onDidOpenTextDocument', () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    const handler = vi.fn();
    conn.onDidOpenTextDocument(handler);

    expect(server.onNotification).toHaveBeenCalledWith('textDocument/didOpen', expect.any(Function));
  });

  it('should map sendDiagnostics to sendNotification', async () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    const params = { uri: 'file:///test.rosetta', diagnostics: [] };
    await conn.sendDiagnostics(params);

    expect(server.sendNotification).toHaveBeenCalledWith('textDocument/publishDiagnostics', params);
  });

  it('should skip sendNotification instead of throwing when the server is no longer listening', async () => {
    // sendDiagnostics can fire after a build settles asynchronously, which
    // can be after the client has already disconnected — sendNotification
    // throws "Server is not listening" in that case; the adapter guards
    // with isListening() so this is a silent no-op, not an unhandled
    // rejection.
    const server = createMockServer();
    server.isListening = vi.fn(() => false);
    const conn = createConnectionAdapter(server as any);

    const params = { uri: 'file:///test.rosetta', diagnostics: [] };
    await expect(conn.sendDiagnostics(params)).resolves.toBeUndefined();

    expect(server.sendNotification).not.toHaveBeenCalled();
  });

  it.each(['typed', 'generic'] as const)(
    'settles a %s notification when the socket closes during sending',
    async (surface) => {
      const server = createMockServer();
      let fail!: (error: Error) => void;
      server.sendNotification.mockImplementation(
        () =>
          new Promise((_, reject) => {
            fail = reject;
          })
      );
      const conn = createConnectionAdapter(server as any);
      const params = { uri: 'file:///late.rosetta', diagnostics: [] };
      const pending =
        surface === 'typed'
          ? conn.sendDiagnostics(params)
          : conn.sendNotification('textDocument/publishDiagnostics', params);
      expect(server.isListening()).toBe(true);
      fail(new Error('WebSocket is not connected'));
      await expect(pending).resolves.toBeUndefined();
    }
  );

  it('does not hide notification failures on a live socket', async () => {
    const server = createMockServer();
    const failure = new Error('Invalid diagnostic payload');
    server.sendNotification.mockRejectedValueOnce(failure);
    const conn = createConnectionAdapter(server as any);
    await expect(conn.sendDiagnostics({ uri: 'file:///bad.rosetta', diagnostics: [] })).rejects.toBe(failure);
  });

  it('settles a logging notification after the socket disconnects', async () => {
    const server = createMockServer();
    server.sendNotification.mockRejectedValueOnce(new Error('WebSocket is not connected'));
    const conn = createConnectionAdapter(server as any);
    conn.console.info('Late validation finished');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(server.sendNotification).toHaveBeenCalledWith('window/logMessage', {
      type: 3,
      message: 'Late validation finished'
    });
  });

  it('should handle sendNotification with string method', async () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    const params = { type: 3, message: 'test' };
    await conn.sendNotification('window/logMessage', params);

    expect(server.sendNotification).toHaveBeenCalledWith('window/logMessage', params);
  });

  it('should handle sendNotification with ProtocolNotificationType object', async () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    const params = { type: 3, message: 'test' };
    await conn.sendNotification({ method: 'window/logMessage' }, params);

    expect(server.sendNotification).toHaveBeenCalledWith('window/logMessage', params);
  });

  it('should provide a listen() method that is a no-op', () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    expect(() => conn.listen()).not.toThrow();
  });

  it('should provide console sub-object', () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    expect(conn.console).toBeDefined();
    expect(typeof conn.console.error).toBe('function');
    expect(typeof conn.console.warn).toBe('function');
    expect(typeof conn.console.info).toBe('function');
    expect(typeof conn.console.log).toBe('function');
  });

  it('should provide languages sub-object with nested features', () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    expect(conn.languages).toBeDefined();
    expect(conn.languages.semanticTokens).toBeDefined();
    expect(typeof conn.languages.semanticTokens.on).toBe('function');
    expect(typeof conn.languages.callHierarchy.onPrepare).toBe('function');
    expect(typeof conn.languages.typeHierarchy.onPrepare).toBe('function');
    expect(typeof conn.languages.inlayHint.on).toBe('function');
  });

  it('should provide workspace sub-object', () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    expect(conn.workspace).toBeDefined();
    expect(typeof conn.workspace.getConfiguration).toBe('function');
    expect(typeof conn.workspace.applyEdit).toBe('function');
    expect(typeof conn.workspace.onDidCreateFiles).toBe('function');
    expect(typeof conn.workspace.textDocumentContent.on).toBe('function');
  });

  it('maps workspace text-document-content requests', () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    conn.workspace.textDocumentContent.on(vi.fn());

    expect(server.onRequest).toHaveBeenCalledWith('workspace/textDocumentContent', expect.any(Function));
  });

  it('should provide client sub-object with register', () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    expect(conn.client).toBeDefined();
    expect(typeof conn.client.register).toBe('function');
  });

  it('should return no-op disposable for unknown methods starting with on', () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    const result = conn.onSomethingUnknown(() => {});
    expect(result).toBeDefined();
    expect(typeof result.dispose).toBe('function');
  });

  it('should forward request handler params through to Langium', async () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    const handler = vi.fn().mockResolvedValue({ contents: 'hello' });
    conn.onHover(handler);

    // Get the wrapped handler that was registered with the server
    const wrappedHandler = server.requestHandlers.get('textDocument/hover')!;
    expect(wrappedHandler).toBeDefined();

    // Simulate a call with params and token
    const params = {
      textDocument: { uri: 'file:///test.rosetta' },
      position: { line: 0, character: 0 }
    };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => {} })
    };

    const result = await wrappedHandler(params, token);

    expect(handler).toHaveBeenCalledWith(params, token);
    expect(result).toEqual({ contents: 'hello' });
  });

  it('should map onRenameRequest to textDocument/rename', () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    const handler = vi.fn();
    conn.onRenameRequest(handler);

    expect(server.onRequest).toHaveBeenCalledWith('textDocument/rename', expect.any(Function));
  });

  it('should map onFoldingRanges to textDocument/foldingRange', () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    const handler = vi.fn();
    conn.onFoldingRanges(handler);

    expect(server.onRequest).toHaveBeenCalledWith('textDocument/foldingRange', expect.any(Function));
  });

  it('should map onDocumentSymbol to textDocument/documentSymbol', () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    const handler = vi.fn();
    conn.onDocumentSymbol(handler);

    expect(server.onRequest).toHaveBeenCalledWith('textDocument/documentSymbol', expect.any(Function));
  });

  it('should map workspace file operation handlers via languages proxy', () => {
    const server = createMockServer();
    const conn = createConnectionAdapter(server as any);

    conn.languages.semanticTokens.on(() => {});
    expect(server.onRequest).toHaveBeenCalledWith('textDocument/semanticTokens/full', expect.any(Function));
  });
});
