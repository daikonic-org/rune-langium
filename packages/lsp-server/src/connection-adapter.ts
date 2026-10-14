// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Connection adapter — makes an @lspeasy/server LSPServer look like a
 * vscode-languageserver Connection so Langium's `startLanguageServer()`
 * can wire all its providers automatically.
 *
 * Design:
 *  - Core message methods (`onRequest`, `onNotification`, `sendRequest`,
 *    `sendNotification`) delegate directly to the underlying LSPServer.
 *  - Typed convenience methods (`onHover`, `onCompletion`, `onDidOpenTextDocument`, …)
 *    are resolved at runtime via a Proxy that maps method names to LSP strings.
 *  - The `initialize` request gets special handling: our composite handler
 *    replicates LSPServer's internal state management (state transitions,
 *    clientCapabilities storage) AND forwards to Langium's handler so that
 *    `startLanguageServer` works out of the box.
 *  - Sub-objects (`console`, `window`, `workspace`, `languages`, `client`,
 *    `telemetry`, `tracer`, `notebooks`) are provided as stubs or delegates.
 */

import { type LSPServer, ServerState, type ServerCapabilities } from '@lspeasy/server';
import { ResponseError } from '@lspeasy/core';
import { ResponseError as VscodeResponseError } from 'vscode-languageserver';

// ────────────────────────────────────────────────────────────────────────────
// Method-name → LSP-method-string maps
// ────────────────────────────────────────────────────────────────────────────

/** Typed request-handler shortcuts that Langium / TextDocuments may call. */
const REQUEST_MAP: Record<string, string> = {
  // lifecycle
  onInitialize: 'initialize',
  onShutdown: 'shutdown',
  // text-document features
  onHover: 'textDocument/hover',
  onCompletion: 'textDocument/completion',
  onCompletionResolve: 'completionItem/resolve',
  onDefinition: 'textDocument/definition',
  onDeclaration: 'textDocument/declaration',
  onTypeDefinition: 'textDocument/typeDefinition',
  onImplementation: 'textDocument/implementation',
  onReferences: 'textDocument/references',
  onDocumentSymbol: 'textDocument/documentSymbol',
  onDocumentHighlight: 'textDocument/documentHighlight',
  onFoldingRanges: 'textDocument/foldingRange',
  onCodeAction: 'textDocument/codeAction',
  onCodeActionResolve: 'codeAction/resolve',
  onRenameRequest: 'textDocument/rename',
  onPrepareRename: 'textDocument/prepareRename',
  onDocumentFormatting: 'textDocument/formatting',
  onDocumentRangeFormatting: 'textDocument/rangeFormatting',
  onDocumentOnTypeFormatting: 'textDocument/onTypeFormatting',
  onSignatureHelp: 'textDocument/signatureHelp',
  onDocumentLinks: 'textDocument/documentLink',
  onCodeLens: 'textDocument/codeLens',
  // workspace features
  onExecuteCommand: 'workspace/executeCommand',
  onWorkspaceSymbol: 'workspace/symbol',
  onWorkspaceSymbolResolve: 'workspaceSymbol/resolve',
  // document-sync request
  onWillSaveTextDocumentWaitUntil: 'textDocument/willSaveWaitUntil'
};

/** Typed notification-handler shortcuts. */
const NOTIFICATION_MAP: Record<string, string> = {
  onInitialized: 'initialized',
  onExit: 'exit',
  onDidOpenTextDocument: 'textDocument/didOpen',
  onDidChangeTextDocument: 'textDocument/didChange',
  onDidCloseTextDocument: 'textDocument/didClose',
  onDidSaveTextDocument: 'textDocument/didSave',
  onWillSaveTextDocument: 'textDocument/willSave',
  onDidChangeConfiguration: 'workspace/didChangeConfiguration',
  onDidChangeWatchedFiles: 'workspace/didChangeWatchedFiles',
  onDidChangeWorkspaceFolders: 'workspace/didChangeWorkspaceFolders'
};

/** Typed send shortcuts (server → client). */
const SEND_NOTIFICATION_MAP: Record<string, string> = {
  sendDiagnostics: 'textDocument/publishDiagnostics'
};

// ────────────────────────────────────────────────────────────────────────────
// Disposable / stub helpers
// ────────────────────────────────────────────────────────────────────────────

const NOOP_DISPOSABLE = Object.freeze({ dispose() {} });
const NOOP = () => NOOP_DISPOSABLE;
const NOOP_PROMISE = () => Promise.resolve(undefined);

// ────────────────────────────────────────────────────────────────────────────
// Sub-object factories
// ────────────────────────────────────────────────────────────────────────────

function createRequestRegistrar(
  server: LSPServer<ServerCapabilities>,
  method: string
): (handler: (...args: any[]) => any) => { dispose(): void } {
  return (handler: (...args: any[]) => any) => {
    return server.onRequest(method as any, async (params: any, token: any) => {
      try {
        const result = await handler(params, token);
        // vscode's Connection accepts returned errors; lspeasy expects them thrown.
        if (result instanceof VscodeResponseError) throw result;
        return result;
      } catch (error) {
        if (error instanceof VscodeResponseError) throw new ResponseError(error.code, error.message, error.data);
        throw error;
      }
    });
  };
}

/**
 * `connection.languages` — nested sub-features used by Langium for
 * semantic tokens, call hierarchy, type hierarchy, inlay hints, etc.
 */
function createLanguagesProxy(server: LSPServer<ServerCapabilities>): any {
  return {
    connection: undefined,
    attachWorkDoneProgress: NOOP,
    attachPartialResultProgress: NOOP_PROMISE,
    semanticTokens: {
      on: createRequestRegistrar(server, 'textDocument/semanticTokens/full'),
      onDelta: createRequestRegistrar(server, 'textDocument/semanticTokens/full/delta'),
      onRange: createRequestRegistrar(server, 'textDocument/semanticTokens/range')
    },
    callHierarchy: {
      onPrepare: createRequestRegistrar(server, 'textDocument/prepareCallHierarchy'),
      onIncomingCalls: createRequestRegistrar(server, 'callHierarchy/incomingCalls'),
      onOutgoingCalls: createRequestRegistrar(server, 'callHierarchy/outgoingCalls')
    },
    typeHierarchy: {
      onPrepare: createRequestRegistrar(server, 'textDocument/prepareTypeHierarchy'),
      onSupertypes: createRequestRegistrar(server, 'typeHierarchy/supertypes'),
      onSubtypes: createRequestRegistrar(server, 'typeHierarchy/subtypes')
    },
    inlayHint: {
      on: createRequestRegistrar(server, 'textDocument/inlayHint')
    },
    inlineValue: {
      on: createRequestRegistrar(server, 'textDocument/inlineValue')
    },
    diagnostics: {
      on: createRequestRegistrar(server, 'textDocument/diagnostic'),
      onWorkspace: createRequestRegistrar(server, 'workspace/diagnostic')
    },
    foldingRange: {
      on: createRequestRegistrar(server, 'textDocument/foldingRange')
    }
  };
}

/**
 * `connection.workspace` — workspace features (file operations, config, folders).
 */
function createWorkspaceProxy(server: LSPServer<ServerCapabilities>): any {
  return {
    connection: undefined,
    getConfiguration: (params: any) => server.sendRequest('workspace/configuration' as any, params).catch(() => ({})),
    getWorkspaceFolders: () => server.sendRequest('workspace/workspaceFolders' as any).catch(() => null),
    applyEdit: (params: any) =>
      server.sendRequest('workspace/applyEdit' as any, params).catch(() => ({ applied: false })),

    // File-operation notification handlers
    onDidCreateFiles: (handler: any) =>
      server.onNotification('workspace/didCreateFiles' as any, (p: any) => handler(p)),
    onDidRenameFiles: (handler: any) =>
      server.onNotification('workspace/didRenameFiles' as any, (p: any) => handler(p)),
    onDidDeleteFiles: (handler: any) =>
      server.onNotification('workspace/didDeleteFiles' as any, (p: any) => handler(p)),
    // File-operation request handlers (willCreate/willRename/willDelete)
    onWillCreateFiles: createRequestRegistrar(server, 'workspace/willCreateFiles'),
    onWillRenameFiles: createRequestRegistrar(server, 'workspace/willRenameFiles'),
    onWillDeleteFiles: createRequestRegistrar(server, 'workspace/willDeleteFiles'),

    textDocumentContent: {
      on: createRequestRegistrar(server, 'workspace/textDocumentContent')
    },

    onDidChangeWorkspaceFolders: (handler: any) =>
      server.onNotification('workspace/didChangeWorkspaceFolders' as any, (p: any) => handler(p))
  };
}

/**
 * `connection.window` — show-message helpers + work-done progress.
 */
function createWindowProxy(server: LSPServer<ServerCapabilities>): any {
  return {
    connection: undefined,
    showErrorMessage: (msg: string) =>
      server.sendRequest('window/showMessageRequest' as any, { type: 1, message: msg }).catch(() => undefined),
    showWarningMessage: (msg: string) =>
      server.sendRequest('window/showMessageRequest' as any, { type: 2, message: msg }).catch(() => undefined),
    showInformationMessage: (msg: string) =>
      server.sendRequest('window/showMessageRequest' as any, { type: 3, message: msg }).catch(() => undefined),
    showDocument: (params: any) =>
      server.sendRequest('window/showDocument' as any, params).catch(() => ({ success: false })),
    createWorkDoneProgress: () => Promise.resolve({ begin() {}, report() {}, done() {} })
  };
}

/** Async builds may publish after disconnect, before isListening has caught up. */
async function sendConnectedNotification(
  server: LSPServer<ServerCapabilities>,
  method: string,
  params: any
): Promise<void> {
  if (!server.isListening()) return;
  try {
    await server.sendNotification(method as any, params);
  } catch (error) {
    // These are the pinned lspeasy server/WS transport's terminal-send errors.
    // Langium does not await diagnostic publication, so they must settle here.
    if (
      error instanceof Error &&
      (error.message === 'WebSocket is not connected' || error.message === 'Server is not listening')
    )
      return;
    throw error;
  }
}

/**
 * `connection.console` — logging via window/logMessage notifications.
 */
function createConsoleProxy(server: LSPServer<ServerCapabilities>): any {
  const log = (type: number) => (message: string) => {
    void sendConnectedNotification(server, 'window/logMessage', { type, message });
  };
  return {
    connection: undefined,
    error: log(1),
    warn: log(2),
    info: log(3),
    log: log(4),
    debug: log(4)
  };
}

/**
 * `connection.client` — dynamic capability registration.
 */
function createClientProxy(server: LSPServer<ServerCapabilities>): any {
  return {
    connection: undefined,
    register: (typeOrRegistrations: any, registerOptions?: any) => {
      const params =
        registerOptions != null
          ? {
              registrations: [
                {
                  id: String(Date.now()),
                  method: typeof typeOrRegistrations === 'string' ? typeOrRegistrations : typeOrRegistrations?.method,
                  registerOptions
                }
              ]
            }
          : typeOrRegistrations;
      return server.sendRequest('client/registerCapability' as any, params).catch(() => undefined);
    }
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Main adapter factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a `vscode-languageserver`-compatible `Connection` backed by an
 * `@lspeasy/server` `LSPServer`.
 *
 * @remarks
 * Langium's `startLanguageServer()` expects a `Connection` object from
 * `vscode-languageserver`. This adapter bridges the gap: it translates Langium's
 * typed handler registration methods (`onHover`, `onCompletion`, etc.) into
 * `@lspeasy/server` request/notification registrations via a `Proxy`.
 *
 * The `initialize` request receives special composite handling that replicates
 * `@lspeasy/server`'s internal state transitions
 * (`Created → Initializing → Initialized`) AND forwards to Langium's handler.
 * Without this, Langium's `startLanguageServer` would register its own handler
 * that bypasses the state machine, causing all subsequent non-lifecycle requests
 * to be rejected with `ServerNotInitialized`.
 *
 * @useWhen
 * - Wiring a custom `@lspeasy/server` instance into Langium in tests or advanced
 *   embedding scenarios where `createRuneLspServer()` does not fit.
 *
 * @avoidWhen
 * - Normal usage — prefer `createRuneLspServer()` which calls this internally.
 *
 * @pitfalls
 * - The returned object is typed `any` — do not expose it to callers that
 *   expect `vscode-languageserver.Connection`; the shape matches but TypeScript
 *   cannot verify structural compatibility without the vscode-languageserver
 *   package installed.
 * - Sub-objects (`console`, `window`, `workspace`, `languages`) are stubs or
 *   delegates. Methods that require two-way communication (e.g.,
 *   `workspace.getConfiguration`) may return empty results if the underlying
 *   transport is not yet connected.
 *
 * @param server - The `@lspeasy/server` `LSPServer` instance to adapt.
 * @returns A duck-typed `Connection` object compatible with Langium's
 *   `createDefaultSharedModule({ connection })`.
 *
 * @category LSP Server
 */
export function createConnectionAdapter(server: LSPServer<ServerCapabilities>): any {
  // Pre-built sub-objects
  const languages = createLanguagesProxy(server);
  const workspace = createWorkspaceProxy(server);
  const window = createWindowProxy(server);
  const consoleSub = createConsoleProxy(server);
  const client = createClientProxy(server);

  // ── Core target object ───────────────────────────────────────────────

  const base: Record<string, any> = {
    // ── Generic onRequest ────────────────────────────────────────────
    onRequest(typeOrMethod: any, handler?: any) {
      const method = typeof typeOrMethod === 'string' ? typeOrMethod : typeOrMethod?.method;
      const h = typeof handler === 'function' ? handler : typeOrMethod;
      if (!method || typeof h !== 'function') return NOOP_DISPOSABLE;

      if (method === 'initialize') {
        return registerInitializeHandler(server, h);
      }
      return createRequestRegistrar(server, method)(h);
    },

    // ── Generic sendRequest ──────────────────────────────────────────
    sendRequest(typeOrMethod: any, ...args: any[]) {
      const method = typeof typeOrMethod === 'string' ? typeOrMethod : typeOrMethod?.method;
      return server.sendRequest(method, args[0]);
    },

    // ── Generic onNotification ───────────────────────────────────────
    onNotification(typeOrMethod: any, handler?: any) {
      const method = typeof typeOrMethod === 'string' ? typeOrMethod : typeOrMethod?.method;
      const h = typeof handler === 'function' ? handler : typeOrMethod;
      if (!method || typeof h !== 'function') return NOOP_DISPOSABLE;
      return server.onNotification(method, (params: any) => h(params));
    },

    // ── Generic sendNotification ─────────────────────────────────────
    sendNotification(typeOrMethod: any, params?: any) {
      const method = typeof typeOrMethod === 'string' ? typeOrMethod : typeOrMethod?.method;
      return sendConnectedNotification(server, method, params);
    },

    // ── Lifecycle ────────────────────────────────────────────────────
    listen() {
      /* no-op — LSPServer.listen(transport) is called externally */
    },
    dispose() {
      void server.close();
    },

    // ── Sub-objects ──────────────────────────────────────────────────
    console: consoleSub,
    window,
    workspace,
    languages,
    client,
    telemetry: { connection: undefined, logEvent: NOOP },
    tracer: { connection: undefined, log: NOOP },
    notebooks: {
      connection: undefined,
      synchronization: {
        onDidOpenNotebookDocument: NOOP,
        onDidChangeNotebookDocument: NOOP,
        onDidCloseNotebookDocument: NOOP,
        onDidSaveNotebookDocument: NOOP
      }
    },

    // ── Progress ─────────────────────────────────────────────────────
    onProgress: NOOP,
    sendProgress: NOOP_PROMISE
  };

  // ── Proxy for typed convenience methods ────────────────────────────

  return new Proxy(base, {
    get(target, prop, receiver) {
      // Properties already on the target
      if (prop in target) return Reflect.get(target, prop, receiver);

      const name = String(prop);

      // Typed request-handler shortcuts (e.g. connection.onHover)
      if (name in REQUEST_MAP) {
        const method = REQUEST_MAP[name];
        if (method === 'initialize') {
          return (handler: any) => registerInitializeHandler(server, handler);
        }
        return createRequestRegistrar(server, method);
      }

      // Typed notification-handler shortcuts (e.g. connection.onDidOpenTextDocument)
      if (name in NOTIFICATION_MAP) {
        const method = NOTIFICATION_MAP[name];
        return (handler: any) => server.onNotification(method as any, (params: any) => handler(params));
      }

      // Typed send shortcuts (e.g. connection.sendDiagnostics)
      if (name in SEND_NOTIFICATION_MAP) {
        const method = SEND_NOTIFICATION_MAP[name];
        return (params: any) => sendConnectedNotification(server, method, params);
      }

      // Fall-through: any unknown onXxx → no-op disposable
      if (name.startsWith('on')) return NOOP;
      if (name.startsWith('send')) return NOOP_PROMISE;

      return undefined;
    }
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Initialize handler — composite: state management + Langium handler
// ────────────────────────────────────────────────────────────────────────────

/**
 * Replace LSPServer's built-in `initialize` handler with a composite that:
 * 1. Manages LSPServer's internal state (Created → Initializing → Initialized)
 * 2. Stores client capabilities on the server instance
 * 3. Forwards to the Langium handler to run initialization side-effects
 *    and compute the InitializeResult (capabilities).
 *
 * This is necessary because LSPServer's built-in handler manages lifecycle
 * state — replacing it without replicating that state management causes all
 * subsequent non-lifecycle requests to be rejected with ServerNotInitialized.
 */
function registerInitializeHandler(
  server: LSPServer<ServerCapabilities>,
  langiumHandler: (...args: any[]) => any
): { dispose(): void } {
  return server.onRequest('initialize' as any, async (params: any, token: any, _context: any) => {
    const srv = server as any;

    // ── Replicate built-in state management ──
    if (srv.state !== undefined && srv.state !== ServerState.Created) {
      throw new Error('Server already initialized');
    }
    srv.state = ServerState.Initializing;

    // Store client capabilities so that capability guards work
    if (params.capabilities) {
      srv.clientCapabilities = params.capabilities;
      if (srv.dispatcher?.setClientCapabilities) {
        srv.dispatcher.setClientCapabilities(params.capabilities);
      }
    }
    if (params.clientInfo) {
      srv.clientInfo = params.clientInfo;
    }

    // ── Delegate to Langium's handler ──
    // Langium's handler signature: (params, token) → InitializeResult
    const result = await langiumHandler(params, token);

    // ── Transition state ──
    srv.state = ServerState.Initialized;

    return result;
  });
}
