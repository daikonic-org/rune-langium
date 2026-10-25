// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Rune DSL LSP Server
 *
 * Creates a Langium LSP-capable service container and bridges it to an
 * @lspeasy/server LSPServer via the Connection adapter.
 *
 * Flow:
 *   1. Create LSPServer                    (@lspeasy/server)
 *   2. Wrap it in a Connection adapter      (connection-adapter.ts)
 *   3. Create Langium LSP services          (langium/lsp — includes all providers)
 *   4. startLanguageServer(shared)          (Langium wires everything automatically)
 *   5. server.listen(transport)             (when a client WebSocket connects)
 */

import { LSPServer, type ServerCapabilities } from '@lspeasy/server';
import type { Transport } from '@lspeasy/core';
import { EmptyFileSystem, DocumentState, URI, inject } from 'langium';
import type { LangiumServices, LangiumSharedServices } from 'langium/lsp';
import { createDefaultModule, createDefaultSharedModule, startLanguageServer } from 'langium/lsp';
import {
  RuneDslGeneratedModule,
  RuneDslGeneratedSharedModule,
  RuneDslModule,
  RuneDslSharedModule,
  RuneDslValidator,
  LSP_MODEL_SYNC_METHOD,
  ProjectResolutionContextSchema,
  type ProjectResolutionReceipt,
  type LspModelUpdate
} from '@rune-langium/core';

import { createConnectionAdapter } from './connection-adapter.js';
import { RuneDocumentUpdateHandler } from './document-update-handler.js';
import { RuneModelIndex, RuneLspDocumentBuilder } from './model-index.js';
import { RuneModelDefinitionProvider } from './model-definition-provider.js';

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * A fully-wired Rune DSL LSP server instance.
 *
 * @remarks
 * Returned by {@link createRuneLspServer}. Exposes the underlying
 * `@lspeasy/server` instance and Langium services for advanced use cases
 * (testing, custom middleware, capability introspection).
 *
 * @pitfalls
 * - Do NOT call `listen()` before the server is fully initialized — all
 *   Langium providers are registered during `createRuneLspServer()` synchronously
 *   via `startLanguageServer(shared)`. The server is ready to accept connections
 *   as soon as this factory function returns.
 * - Diagnostics are sent as `textDocument/publishDiagnostics` **notifications**
 *   (not responses). Clients must register a notification handler; they will not
 *   appear as request responses.
 * - Do NOT access `shared` or `services` from a concurrent request handler
 *   without understanding Langium's document locking model — document builds
 *   and index updates are not thread-safe.
 *
 * @category LSP Server
 */
export interface RuneLspServer {
  /** The underlying @lspeasy/server instance. */
  server: LSPServer<ServerCapabilities>;
  /** Langium shared services (for testing / advanced use). */
  shared: LangiumSharedServices;
  /** Langium language services for Rune DSL. */
  services: LangiumServices;
  /** Bind the server to a transport and start processing messages. */
  listen(transport: Transport): Promise<void>;
  syncModels(update: LspModelUpdate): Promise<ProjectResolutionReceipt | undefined>;
}

/**
 * Create a fully-wired Rune DSL LSP server backed by `@lspeasy/server`.
 *
 * @remarks
 * Initialization order (all synchronous before returning):
 * 1. `LSPServer` created with broad capability declarations
 * 2. `createConnectionAdapter()` wraps it to satisfy Langium's `Connection` interface
 * 3. Langium LSP services constructed (`createDefaultSharedModule` + Rune DSL modules)
 * 4. `RuneDslValidator` checks registered
 * 5. `startLanguageServer(shared)` wires all providers to connection handlers
 *
 * The server responds to `initialize` requests only once per lifecycle — the
 * connection adapter manages the `Created → Initializing → Initialized` state
 * machine to avoid duplicate initialization errors.
 *
 * @useWhen
 * - Embedding a Rune DSL language server in a web application via WebSocket
 * - Running a standalone LSP server process bridging to a VS Code / Theia client
 * - Integration-testing LSP features (hover, completion, diagnostics)
 *
 * @avoidWhen
 * - Parsing `.rosetta` files in a script — use `createRuneDslServices()` and
 *   `parse()` / `parseWorkspace()` instead (no LSP overhead).
 * - Creating multiple servers in the same process — each server maintains its
 *   own Langium workspace index; sharing a workspace across servers requires
 *   custom `ServiceRegistry` wiring.
 *
 * @pitfalls
 * - The workspace index is empty until the client sends `textDocument/didOpen`
 *   or `workspace/didChangeWatchedFiles`. Do NOT respond to semantic requests
 *   (hover, completion) before at least one `didOpen` has triggered a document
 *   build — results will be empty or stale.
 * - Diagnostics are push-only (`textDocument/publishDiagnostics` notifications).
 *   There is no request-response path for diagnostics — the client must handle
 *   the notification asynchronously.
 * - Langium batches diagnostic notifications; a burst of `didChange` events may
 *   not produce one notification per change. The final stable state is always
 *   published but intermediate states may be coalesced.
 *
 * @returns A {@link RuneLspServer} ready for `listen(transport)`.
 *
 * @example
 * ```ts
 * import { createRuneLspServer } from '@rune-langium/lsp-server';
 * import { WebSocketTransport } from '@lspeasy/core/transport/websocket';
 *
 * const lsp = createRuneLspServer();
 * const transport = new WebSocketTransport(webSocket);
 * await lsp.listen(transport);
 * ```
 *
 * @category LSP Server
 */
export function createRuneLspServer(
  options: { onModelUpdate?: (update: LspModelUpdate) => Promise<void> } = {}
): RuneLspServer {
  // 1. Create @lspeasy/server with broad capabilities.
  //    Langium's onInitialize returns the *actual* capabilities to the client.
  //    We just need non-strict mode (default) so handler registration isn't blocked.
  const server = new LSPServer<ServerCapabilities>({
    name: 'rune-dsl-lsp',
    version: '0.1.0',
    capabilities: {
      textDocumentSync: 1,
      hoverProvider: true,
      completionProvider: { triggerCharacters: ['.', ':'] },
      definitionProvider: true,
      declarationProvider: true,
      typeDefinitionProvider: true,
      referencesProvider: true,
      documentSymbolProvider: true,
      documentHighlightProvider: true,
      foldingRangeProvider: true,
      codeActionProvider: true,
      renameProvider: { prepareProvider: true },
      documentFormattingProvider: true,
      signatureHelpProvider: { triggerCharacters: ['(', ','] },
      documentLinkProvider: {},
      workspace: {
        workspaceFolders: {
          supported: true,
          changeNotifications: true
        }
      }
    }
  });

  // 2. Create the Connection adapter
  const connection = createConnectionAdapter(server);

  // 3. Create Langium *LSP* services (not core-only).
  //    createDefaultSharedModule from langium/lsp adds TextDocuments,
  //    DocumentUpdateHandler, LanguageServer, etc.
  const shared = inject(
    createDefaultSharedModule({ ...EmptyFileSystem, connection }),
    RuneDslGeneratedSharedModule,
    RuneDslSharedModule,
    {
      workspace: { DocumentBuilder: (services: LangiumSharedServices) => new RuneLspDocumentBuilder(services) },
      lsp: { DocumentUpdateHandler: (services: LangiumSharedServices) => new RuneDocumentUpdateHandler(services) }
    }
  );

  const RuneDsl = inject(createDefaultModule({ shared }), RuneDslGeneratedModule, RuneDslModule, {
    lsp: { DefinitionProvider: (services: LangiumServices) => new RuneModelDefinitionProvider(services) }
  });
  const models = new RuneModelIndex(shared, RuneDsl, options.onModelUpdate);
  shared.workspace.DocumentBuilder.onBuildPhase(DocumentState.Validated, (docs) =>
    models.captureSources(docs, options.onModelUpdate)
  );
  shared.workspace.DocumentBuilder.restoreModels = (uris) => models.restore(uris);
  const syncModels = async (update: LspModelUpdate) => {
    await shared.workspace.WorkspaceManager.ready;
    // Use Langium's write lock for all changes to the shared symbol index.
    let receipt: ProjectResolutionReceipt | undefined;
    await shared.workspace.WorkspaceLock.write(async () => {
      receipt = await models.sync(update);
    });
    return receipt;
  };
  connection.onRequest(LSP_MODEL_SYNC_METHOD, async (update: LspModelUpdate) => {
    if (
      !update ||
      (!update.document && !update.retain) ||
      (Object.hasOwn(update, 'resolution') && !update.retain) ||
      (update.document &&
        (typeof update.document.uri !== 'string' ||
          typeof update.document.modelJson !== 'string' ||
          update.document.uri.length > 2048 ||
          update.document.modelJson.length > 8 * 1024 * 1024)) ||
      (update.retain &&
        (!Array.isArray(update.retain) ||
          update.retain.length > 2048 ||
          update.retain.some((uri) => typeof uri !== 'string')))
    ) {
      throw new Error('Invalid model synchronization payload');
    }
    const canonical: LspModelUpdate = {
      ...(update.document ? { document: { ...update.document, uri: URI.parse(update.document.uri).toString() } } : {}),
      ...(update.retain ? { retain: update.retain.map((uri) => URI.parse(uri).toString()) } : {}),
      ...(Object.hasOwn(update, 'resolution')
        ? { resolution: update.resolution == null ? null : ProjectResolutionContextSchema.parse(update.resolution) }
        : {})
    };
    const receipt = await syncModels(canonical);
    await options.onModelUpdate?.(canonical);
    return receipt ? { projectReceipt: receipt } : null;
  });

  // 4. Register language + validation
  shared.ServiceRegistry.register(RuneDsl);

  const validator = new RuneDslValidator();
  validator.registerChecks(RuneDsl);

  // Langium publishes ranges without a version. Attach the validated document's
  // revision, never the newer TextDocuments buffer that may be awaiting a build.
  const publishDiagnostics = connection.sendDiagnostics;
  connection.sendDiagnostics = (params: { uri: string; diagnostics: unknown[]; version?: number }) => {
    const document = shared.workspace.LangiumDocuments.getDocument(URI.parse(params.uri));
    return publishDiagnostics({ ...params, ...(document ? { version: document.textDocument.version } : {}) });
  };

  // 5. Let Langium wire all providers → connection handlers + documents
  startLanguageServer(shared);

  return {
    server,
    shared,
    services: RuneDsl,
    syncModels,
    async listen(transport: Transport) {
      await server.listen(transport);
    }
  };
}
