// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * LSP Client Service (T017).
 *
 * Manages the @codemirror/lsp-client LSPClient lifecycle:
 *   - Transport acquisition via TransportProvider
 *   - Client initialisation and document plugin creation
 *   - Diagnostics subscription bridge to the graph
 *   - Reconnect and cleanup
 */

import { LSPClient, languageServerExtensions, Workspace } from '@codemirror/lsp-client';
import type { WorkspaceFile } from '@codemirror/lsp-client';
import type { Extension } from '@codemirror/state';
import { ChangeSet, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { LSPPlugin } from '@codemirror/lsp-client';
import {
  createTransportProvider,
  type TransportProvider,
  type TransportProviderOptions
} from './transport-provider.js';
import type { LspDiagnostic } from '../types/diagnostics.js';
import { URI } from 'langium';
import { pathToUri } from '../utils/uri.js';
import { LSP_MODEL_SYNC_METHOD, LSP_REQUEST_TIMEOUT_MS } from '@rune-langium/core';
import { withInstrumentation } from './instrumentation/core.js';

export type { LspDiagnostic } from '../types/diagnostics.js';

export interface LspClientOptions {
  /** Provide an external transport provider. */
  transportProvider?: TransportProvider;
  /** Options forwarded to the default transport provider. */
  transportOptions?: TransportProviderOptions;
}

export interface LspClientService {
  /** Connect and initialise the LSP client. */
  connect(options?: LspClientOptions): Promise<void>;
  /** Disconnect and clean up the client. */
  disconnect(): Promise<void>;
  /** Get a CM extension for a document URI. Returns null before connect. */
  getPlugin(uri: string): Extension | null;
  /** Focus selects one didChange owner among views of the same full document. */
  claimDocumentView(uri: string, view: EditorView, configurePlugin: (extension: Extension | null) => void): () => void;
  /** Whether the client is fully initialised. */
  isInitialized(): boolean;
  /** Subscribe to diagnostics (for graph bridge). Returns unsubscribe fn. */
  onDiagnostics(handler: (uri: string, diagnostics: LspDiagnostic[]) => void): () => void;
  /** Keep the server-side workspace in sync with loaded files (for cross-file refs). */
  syncWorkspaceModels(models: Array<{ uri: string; modelJson: string }>): Promise<void>;
  syncWorkspaceFiles(files: Array<{ path: string; content: string }>): void;
  /**
   * Register a handler for cross-file definition navigation (Task 7).
   *
   * When `jumpToDefinition` resolves to a file URI that is known in the
   * workspace snapshot, `displayFile` on the custom workspace calls this
   * handler with the target URI so the host can open the file tab and
   * return the resulting EditorView.
   *
   * Returns an unsubscribe function.
   */
  onDisplayFile(handler: (uri: string) => Promise<import('@codemirror/view').EditorView | null>): () => void;
  /** Force reconnect (tries WebSocket first). */
  reconnect(): Promise<void>;
  /** Clean up all resources. */
  dispose(): void;
}

// ────────────────────────────────────────────────────────────────────────────
// Custom Workspace (Task 7) — extends DefaultWorkspace to support
// cross-file displayFile via a registered callback.
// ────────────────────────────────────────────────────────────────────────────

type DisplayFileHandler = (uri: string) => Promise<EditorView | null>;

interface StudioWorkspaceFile extends WorkspaceFile {
  view: EditorView;
}

/**
 * A workspace implementation that supports cross-file go-to-definition
 * by delegating `displayFile` to an externally registered handler.
 *
 * The handler (set via `onDisplayFile`) is responsible for opening the
 * target file tab in the SourceEditor and returning the EditorView.
 */
export class StudioWorkspace extends Workspace {
  files: StudioWorkspaceFile[] = [];
  private fileVersions: Record<string, number> = Object.create(null);
  displayFileHandler: DisplayFileHandler | null = null;

  nextFileVersion(uri: string): number {
    return (this.fileVersions[uri] = (this.fileVersions[uri] ?? -1) + 1);
  }

  syncFiles() {
    const result: Array<{ file: WorkspaceFile; prevDoc: Text; changes: ChangeSet }> = [];
    for (const file of this.files) {
      const plugin = LSPPlugin.get(file.view);
      if (!plugin) continue;
      const changes = plugin.unsyncedChanges;
      if (!changes.empty) {
        result.push({ changes, file, prevDoc: file.doc });
        file.doc = file.view.state.doc;
        file.version = this.nextFileVersion(file.uri);
        plugin.clear();
      }
    }
    return result;
  }

  // Deliberately does NOT call this.client.didOpen/didClose — document
  // open/close lifecycle is owned solely by LspProvider.tsx's
  // syncWorkspaceFiles, which already opens/closes the active editor's
  // file regardless of which panel (Source/Graph/Structure/Form) edits
  // it. This workspace tracks `this.files` for the CodeMirror plugin's
  // own bookkeeping (getFile/syncFiles/displayFile — used for in-editor
  // hover/completion/diagnostics UI), AND is the sole sender of
  // didChange for any uri it currently tracks: @codemirror/lsp-client's
  // own autoSync/client.sync() drains syncFiles()'s unsyncedChanges and
  // sends the wire notification. syncWorkspaceFiles checks
  // `client.workspace.getFile(uri)` and skips sending its own didChange
  // whenever a live view already owns the uri, so the two paths never
  // race each other with independently-numbered versions against the
  // same document. Before the didOpen/didClose fix, an EditorView
  // mounting/unmounting (e.g. collapsing the Source pane, or a tab
  // switch destroying + recreating the view) sent a REAL didOpen/
  // didClose behind syncWorkspaceFiles's back: its own snapshot never
  // learned the doc had been closed, so it kept sending didChange-only
  // for a document the server no longer tracked as open — silently
  // breaking builds/diagnostics for every other editing surface on that
  // file until the Source editor reopened.

  openFile(uri: string, languageId: string, view: EditorView): void {
    // Allow re-opening the same file (tab switch destroys + recreates).
    const existing = this.files.findIndex((f) => f.uri === uri);
    if (existing >= 0) {
      this.files.splice(existing, 1);
    }
    const file: StudioWorkspaceFile = {
      uri,
      languageId,
      version: this.nextFileVersion(uri),
      doc: view.state.doc,
      view,
      getView: () => view
    };
    this.files.push(file);
  }

  closeFile(uri: string, view: EditorView): void {
    const file = this.files.find((candidate) => candidate.uri === uri);
    if (!file || file.view !== view) return;
    // Flush any edits autoSync's 500ms debounce hasn't drained yet. closeFile
    // runs synchronously from within LSPPlugin's own destroy() — confirmed
    // via @codemirror/view's updatePlugins that the PluginInstance's `.value`
    // (this same LSPPlugin) isn't cleared until after destroy() returns, so
    // LSPPlugin.get(view) here still resolves it and its live
    // unsyncedChanges. Without this, an edit made just before a tab switch
    // or pane collapse is silently discarded: closeFile untracks the file
    // without ever telling the server, and syncWorkspaceFiles only resumes
    // sending didChange for this uri once `client.workspace.getFile(uri)`
    // returns null — which happens right after this method returns, too
    // late for the already-lost edit. Full-text (no range), matching
    // syncWorkspaceFiles's own no-live-view branch — simpler and always
    // correct, unlike replicating the incremental-diff internals here.
    const plugin = LSPPlugin.get(view);
    if (plugin && !plugin.unsyncedChanges.empty) {
      this.client.notification('textDocument/didChange', {
        textDocument: { uri, version: this.nextFileVersion(uri) },
        contentChanges: [{ text: view.state.doc.toString() }]
      });
      plugin.clear();
    }
    if (file) {
      this.files = this.files.filter((f) => f !== file);
    }
  }

  override displayFile(uri: string): Promise<EditorView | null> {
    // Try to find an already-open file first
    const file = this.getFile(uri);
    if (file) {
      const view = file.getView();
      if (view) return Promise.resolve(view);
    }
    // Delegate to the registered handler for cross-file navigation
    if (this.displayFileHandler) {
      return this.displayFileHandler(uri);
    }
    return Promise.resolve(null);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Implementation
// ────────────────────────────────────────────────────────────────────────────

export const createLspClientService = withInstrumentation(
  function createLspClientService(opts?: LspClientOptions): LspClientService {
    let provider: TransportProvider = opts?.transportProvider ?? createTransportProvider(opts?.transportOptions);
    let client: LSPClient | null = null;
    let initialized = false;
    const workspaceSnapshot = new Map<string, { version: number; content: string }>();
    let modelSnapshot = new Map<string, string>();
    const sentModels = new Map<string, string>();
    const openedUris = new Set<string>();
    let modelSyncQueue = Promise.resolve();
    let modelGeneration = 0;
    let modelSyncPending = false;
    let pendingWorkspaceFiles: Array<{ path: string; content: string }> | null = null;
    let _pendingRefreshId: ReturnType<typeof setTimeout> | null = null;

    const diagnosticHandlers: ((uri: string, diagnostics: LspDiagnostic[]) => void)[] = [];
    type DocumentView = {
      view: EditorView;
      configure: (extension: Extension | null) => void;
      focus: () => void;
      attached: boolean;
    };
    const documentViews = new Map<string, { views: DocumentView[]; owner?: DocumentView }>();
    const detachDocumentPlugins = () => {
      for (const entry of documentViews.values()) {
        if (entry.owner?.attached) entry.owner.configure(null);
        if (entry.owner) entry.owner.attached = false;
      }
    };

    function refreshDocumentPlugins(): void {
      for (const [uri, entry] of documentViews) {
        const owner = entry.owner;
        if (!owner) continue;
        const ready = !!client && initialized && openedUris.has(uri);
        if (owner.attached === ready) continue;
        owner.configure(ready ? client!.plugin(uri) : null);
        owner.attached = ready;
      }
    }

    function closeDocument(uri: string): void {
      openedUris.delete(uri);
      refreshDocumentPlugins();
      client?.didClose(uri);
    }

    // Task 7: displayFile handler for cross-file go-to-definition
    let displayFileHandler: DisplayFileHandler | null = null;

    function cancelPendingRefresh(): void {
      if (_pendingRefreshId !== null) {
        clearTimeout(_pendingRefreshId);
        _pendingRefreshId = null;
      }
    }

    function syncModels(): Promise<void> {
      const generation = ++modelGeneration;
      const target = client;
      modelSyncPending = true;
      modelSyncQueue = modelSyncQueue
        .catch(() => {})
        .then(async () => {
          if (!target || target !== client || generation !== modelGeneration) return;
          await target.initializing;
          if (target !== client || generation !== modelGeneration) return;
          const unchanged = [...modelSnapshot]
            .filter(([uri, json]) => sentModels.get(uri) === json)
            .map(([uri]) => uri);
          if (unchanged.length === modelSnapshot.size && sentModels.size === modelSnapshot.size) return;
          // Evict changed/removed snapshots before uploading replacements. Keeping
          // two complete workspace generations would exceed a Worker isolate.
          await target.request(LSP_MODEL_SYNC_METHOD, { retain: unchanged });
          if (target !== client) return;
          const retained = new Set(unchanged);
          for (const uri of sentModels.keys()) if (!retained.has(uri)) sentModels.delete(uri);
          for (const [uri, modelJson] of modelSnapshot) {
            if (target !== client || generation !== modelGeneration) return;
            if (sentModels.get(uri) === modelJson) continue;
            await target.request(LSP_MODEL_SYNC_METHOD, { document: { uri, modelJson } });
            if (target !== client) return;
            sentModels.set(uri, modelJson);
          }
          if (target !== client || generation !== modelGeneration) return;
          await target.request(LSP_MODEL_SYNC_METHOD, { retain: [...modelSnapshot.keys()] });
          if (target !== client) return;
          for (const uri of sentModels.keys()) if (!modelSnapshot.has(uri)) sentModels.delete(uri);
        })
        .then(() => {
          if (target !== client || generation !== modelGeneration) return;
          modelSyncPending = false;
          if (pendingWorkspaceFiles) service.syncWorkspaceFiles(pendingWorkspaceFiles);
          else refreshDocumentPlugins();
        })
        .catch((error) => {
          // A failed final retain may leave acknowledged uploads unpublished.
          if (target === client) sentModels.clear();
          throw error;
        });
      return modelSyncQueue;
    }

    function buildClient(): LSPClient {
      return new LSPClient({
        rootUri: 'file:///workspace',
        // Cold wake can restore a large semantic closure before any request runs.
        timeout: LSP_REQUEST_TIMEOUT_MS,
        workspace: (lspClient) => {
          const ws = new StudioWorkspace(lspClient);
          ws.displayFileHandler = displayFileHandler;
          return ws;
        },
        notificationHandlers: {
          'textDocument/publishDiagnostics': (_client, params) => {
            const { uri, diagnostics } = params as {
              uri: string;
              diagnostics: LspDiagnostic[];
            };
            for (const h of diagnosticHandlers) h(uri, diagnostics);
            return false; // let serverDiagnostics() also handle editor underlines
          }
        },
        extensions: [...languageServerExtensions()]
      });
    }

    async function activateClient(transport: Parameters<LSPClient['connect']>[0]): Promise<void> {
      const target = buildClient();
      client = target;
      openedUris.clear();
      target.connect(transport);
      initialized = true;
      sentModels.clear();
      await syncModels();

      if (target !== client || !initialized || modelSyncPending) return;
      // Re-open files that were not already synchronized during model upload.
      for (const [uri, entry] of workspaceSnapshot) {
        if (openedUris.has(uri)) continue;
        openedUris.add(uri);
        target.didOpen({
          uri,
          languageId: 'rosetta',
          version: entry.version,
          doc: Text.of(entry.content.split('\n')),
          getView: () => null
        });
      }
      refreshDocumentPlugins();
    }

    const service: LspClientService = {
      async connect(): Promise<void> {
        if (client) {
          detachDocumentPlugins();
          client.disconnect();
          client = null;
        }
        const transport = await provider.getTransport();
        await activateClient(transport);
      },

      async disconnect(): Promise<void> {
        cancelPendingRefresh();
        detachDocumentPlugins();
        if (client) {
          client.disconnect();
          client = null;
        }
        initialized = false;
      },

      getPlugin(uri: string): Extension | null {
        uri = URI.parse(uri).toString();
        if (!client || !initialized || !openedUris.has(uri)) return null;
        return client.plugin(uri);
      },

      claimDocumentView(uri, view, configure) {
        uri = URI.parse(uri).toString();
        const entry = documentViews.get(uri) ?? { views: [] as DocumentView[], owner: undefined };
        documentViews.set(uri, entry);
        const select = (next: DocumentView | undefined) => {
          if (entry.owner === next) return;
          // Reconfiguration destroys the old plugin synchronously, flushing it
          // through StudioWorkspace.closeFile before the new owner opens.
          if (entry.owner?.attached) entry.owner.configure(null);
          if (entry.owner) entry.owner.attached = false;
          entry.owner = next;
          refreshDocumentPlugins();
        };
        const item: DocumentView = { view, configure, focus: () => select(item), attached: false };
        entry.views.push(item);
        view.dom.addEventListener('focusin', item.focus);
        if (!entry.owner || view.hasFocus) select(item);
        return () => {
          view.dom.removeEventListener('focusin', item.focus);
          entry.views = entry.views.filter((candidate) => candidate !== item);
          if (entry.owner === item) select(entry.views[entry.views.length - 1]);
          if (entry.views.length === 0) documentViews.delete(uri);
        };
      },

      isInitialized(): boolean {
        return initialized;
      },

      onDiagnostics(handler: (uri: string, diagnostics: LspDiagnostic[]) => void): () => void {
        diagnosticHandlers.push(handler);
        return () => {
          const idx = diagnosticHandlers.indexOf(handler);
          if (idx >= 0) diagnosticHandlers.splice(idx, 1);
        };
      },

      syncWorkspaceModels(models): Promise<void> {
        modelSnapshot = new Map(models.map((model) => [URI.parse(model.uri).toString(), model.modelJson]));
        return syncModels();
      },
      syncWorkspaceFiles(files: Array<{ path: string; content: string }>): void {
        if (modelSyncPending) {
          pendingWorkspaceFiles = files;
          const desired = new Set(files.map((file) => URI.parse(pathToUri(file.path)).toString()));
          for (const uri of workspaceSnapshot.keys()) {
            if (desired.has(uri)) continue;
            workspaceSnapshot.delete(uri);
            if (openedUris.has(uri)) closeDocument(uri);
          }
          return;
        }
        pendingWorkspaceFiles = null;
        const nextUris = new Set<string>();
        const changedUris = new Set<string>();
        let addedCount = 0;

        for (const file of files) {
          const uri = URI.parse(pathToUri(file.path)).toString();
          nextUris.add(uri);

          const prev = workspaceSnapshot.get(uri);
          if (!prev) {
            workspaceSnapshot.set(uri, { version: 0, content: file.content });
            addedCount++;
            changedUris.add(uri);
            if (client && initialized) {
              openedUris.add(uri);
              client.didOpen({
                uri,
                languageId: 'rosetta',
                version: 0,
                doc: Text.of(file.content.split('\n')),
                getView: () => null
              });
            }
            continue;
          }

          if (prev.content !== file.content) {
            const version = prev.version + 1;
            workspaceSnapshot.set(uri, { version, content: file.content });
            changedUris.add(uri);
            // A live editor view for this uri (StudioWorkspace.openFile) owns
            // didChange for it via @codemirror/lsp-client's own autoSync/
            // client.sync() path — sending a second, independently-versioned
            // didChange here races it and can desync the server's document
            // (a range-based edit from the live view applied against text a
            // full-text replace from here has already superseded, or vice
            // versa). Only send when no live view is tracking this uri.
            if (client && initialized && !client.workspace.getFile(uri)) {
              client.notification('textDocument/didChange', {
                textDocument: { uri, version },
                contentChanges: [{ text: file.content }]
              });
            }
          }
        }

        // eslint-disable-next-line unicorn/no-useless-spread
        for (const uri of [...workspaceSnapshot.keys()]) {
          if (nextUris.has(uri)) continue;
          workspaceSnapshot.delete(uri);
          if (openedUris.has(uri)) closeDocument(uri);
        }
        refreshDocumentPlugins();

        // When many files are newly opened, early-opened files may have been
        // validated before all dependencies were present. Force a no-op content
        // refresh across unchanged files so diagnostics are recomputed with the
        // complete workspace loaded.
        //
        // Debounced via setTimeout(0) to yield the UI thread and coalesce
        // multiple rapid syncWorkspaceFiles calls into a single batch refresh.
        if (client && initialized && addedCount > 0) {
          const urisToSkip = new Set(changedUris);
          cancelPendingRefresh();
          _pendingRefreshId = setTimeout(() => {
            _pendingRefreshId = null;
            if (!client || !initialized) return;
            for (const [uri, entry] of workspaceSnapshot) {
              if (urisToSkip.has(uri) || client.workspace.getFile(uri)) continue;
              const version = entry.version + 1;
              workspaceSnapshot.set(uri, { version, content: entry.content });
              client.notification('textDocument/didChange', {
                textDocument: { uri, version },
                contentChanges: [{ text: entry.content }]
              });
            }
          }, 0);
        }
      },

      onDisplayFile(handler: (uri: string) => Promise<EditorView | null>): () => void {
        displayFileHandler = handler;
        // Update existing workspace if client is already connected
        if (client) {
          const ws = client.workspace as StudioWorkspace;
          if (ws && 'displayFileHandler' in ws) {
            ws.displayFileHandler = handler;
          }
        }
        return () => {
          if (displayFileHandler === handler) {
            displayFileHandler = null;
            if (client) {
              const ws = client.workspace as StudioWorkspace;
              if (ws && 'displayFileHandler' in ws) {
                ws.displayFileHandler = null;
              }
            }
          }
        };
      },

      async reconnect(): Promise<void> {
        detachDocumentPlugins();
        if (client) {
          client.disconnect();
          client = null;
        }
        initialized = false;
        const transport = await provider.reconnect();
        await activateClient(transport);
      },

      dispose(): void {
        cancelPendingRefresh();
        detachDocumentPlugins();
        for (const entry of documentViews.values())
          for (const item of entry.views) item.view.dom.removeEventListener('focusin', item.focus);
        documentViews.clear();
        if (client) {
          client.disconnect();
          client = null;
        }
        initialized = false;
        modelGeneration++;
        pendingWorkspaceFiles = null;
        modelSnapshot.clear();
        sentModels.clear();
        provider.dispose();
        diagnosticHandlers.length = 0;
      }
    };
    return service;
    // `opts.transportOptions` is already captured by createTransportProvider's
    // own instrumentation when this constructs the default provider; the
    // returned LspClientService is a function-bearing object.
  },
  { op: 'createLspClientService' }
);
