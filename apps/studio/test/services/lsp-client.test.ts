// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * LSP client service tests (T016).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLspClientService } from '../../src/services/lsp-client.js';

// Mock transport provider
vi.mock('../../src/services/transport-provider.js', () => ({
  createTransportProvider: vi.fn()
}));

// Mock @codemirror/lsp-client to capture didOpen/didClose/notification calls
const {
  mockDidOpen,
  mockDidClose,
  mockNotification,
  mockLspDisconnect,
  mockLspConnect,
  mockPlugin,
  mockGetFile,
  mockRequest
} = vi.hoisted(() => ({
  mockRequest: vi.fn().mockResolvedValue(null),
  mockDidOpen: vi.fn(),
  mockDidClose: vi.fn(),
  mockNotification: vi.fn(),
  mockLspDisconnect: vi.fn(),
  mockLspConnect: vi.fn(),
  mockPlugin: vi.fn().mockReturnValue([]),
  mockGetFile: vi.fn().mockReturnValue(null)
}));

vi.mock('@codemirror/lsp-client', () => {
  class MockWorkspace {
    client: unknown;
    files: unknown[] = [];
    constructor(client: unknown) {
      this.client = client;
    }
    getFile(uri: string) {
      return mockGetFile(uri);
    }
    syncFiles() {
      return [];
    }
    openFile() {}
    closeFile() {}
    connected() {}
    disconnected() {}
    displayFile() {
      return Promise.resolve(null);
    }
    requestFile() {
      return Promise.resolve(null);
    }
    updateFile() {}
  }
  class MockLSPClient {
    didOpen = mockDidOpen;
    didClose = mockDidClose;
    notification = mockNotification;
    disconnect = mockLspDisconnect;
    connect = mockLspConnect;
    initializing = Promise.resolve(null);
    request = mockRequest;
    plugin = mockPlugin;
    workspace: MockWorkspace;
    constructor(opts: any) {
      if (opts?.workspace) {
        this.workspace = opts.workspace(this);
      } else {
        this.workspace = new MockWorkspace(this);
      }
    }
  }
  return {
    LSPClient: MockLSPClient,
    Workspace: MockWorkspace,
    LSPPlugin: { get: vi.fn().mockReturnValue(null) },
    languageServerExtensions: vi.fn().mockReturnValue([])
  };
});

import { createTransportProvider } from '../../src/services/transport-provider.js';

const mockCreateProvider = vi.mocked(createTransportProvider);

function makeFakeTransport() {
  return {
    send: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn()
  };
}

function makeFakeProvider(transport = makeFakeTransport()) {
  return {
    getTransport: vi.fn().mockResolvedValue(transport),
    getState: vi.fn().mockReturnValue({ mode: 'websocket', status: 'connected' }),
    reconnect: vi.fn().mockResolvedValue(transport),
    onStateChange: vi.fn().mockReturnValue(() => {}),
    dispose: vi.fn()
  };
}

describe('createLspClientService', () => {
  it('transfers a single document plugin on focus and keeps the survivor when another pane closes', async () => {
    const provider = makeFakeProvider();
    mockCreateProvider.mockReturnValue(provider as never);
    const service = createLspClientService();
    await service.connect();
    const source = { dom: document.createElement('div') };
    const inspector = { dom: document.createElement('div') };
    const configureSource = vi.fn();
    const configureInspector = vi.fn();
    service.syncWorkspaceFiles([{ path: 'a.rosetta', content: 'namespace a' }]);
    const releaseSource = service.claimDocumentView('file:///workspace/a.rosetta', source as never, configureSource);
    const releaseInspector = service.claimDocumentView(
      'file:///workspace/a.rosetta',
      inspector as never,
      configureInspector
    );
    expect(configureSource).toHaveBeenLastCalledWith([]);
    expect(configureInspector).not.toHaveBeenCalled();
    inspector.dom.dispatchEvent(new FocusEvent('focusin'));
    expect(configureSource).toHaveBeenLastCalledWith(null);
    expect(configureInspector).toHaveBeenLastCalledWith([]);
    releaseSource();
    expect(configureInspector).toHaveBeenLastCalledWith([]);
    releaseInspector();
    expect(configureInspector).toHaveBeenLastCalledWith(null);
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns expected API shape', () => {
    const provider = makeFakeProvider();
    mockCreateProvider.mockReturnValue(provider as never);

    const service = createLspClientService();
    expect(typeof service.connect).toBe('function');
    expect(typeof service.disconnect).toBe('function');
    expect(typeof service.getPlugin).toBe('function');
    expect(typeof service.isInitialized).toBe('function');
    expect(typeof service.onDiagnostics).toBe('function');
    expect(typeof service.reconnect).toBe('function');
    expect(typeof service.dispose).toBe('function');
  });

  it('starts as not initialized', () => {
    const provider = makeFakeProvider();
    mockCreateProvider.mockReturnValue(provider as never);

    const service = createLspClientService();
    expect(service.isInitialized()).toBe(false);
  });

  it('connects via transport provider', async () => {
    const transport = makeFakeTransport();
    const provider = makeFakeProvider(transport);
    mockCreateProvider.mockReturnValue(provider as never);

    const service = createLspClientService();
    await service.connect();

    expect(provider.getTransport).toHaveBeenCalled();
  });

  it('is initialized after connect', async () => {
    const transport = makeFakeTransport();
    const provider = makeFakeProvider(transport);
    mockCreateProvider.mockReturnValue(provider as never);

    const service = createLspClientService();
    await service.connect();

    expect(service.isInitialized()).toBe(true);
  });

  it('returns null plugin before connect', () => {
    const provider = makeFakeProvider();
    mockCreateProvider.mockReturnValue(provider as never);

    const service = createLspClientService();
    expect(service.getPlugin('file:///test.rosetta')).toBeNull();
  });

  it('returns a plugin after connect and opening its source document', async () => {
    const transport = makeFakeTransport();
    const provider = makeFakeProvider(transport);
    mockCreateProvider.mockReturnValue(provider as never);

    const service = createLspClientService();
    await service.connect();

    expect(service.getPlugin('file:///workspace/test.rosetta')).toBeNull();
    service.syncWorkspaceFiles([{ path: 'test.rosetta', content: 'namespace test' }]);
    const plugin = service.getPlugin('file:///workspace/test.rosetta');
    expect(plugin).not.toBeNull();
  });

  it('onDiagnostics returns unsubscribe function', () => {
    const provider = makeFakeProvider();
    mockCreateProvider.mockReturnValue(provider as never);

    const service = createLspClientService();
    const unsub = service.onDiagnostics(vi.fn());
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('disconnect cleans up', async () => {
    const transport = makeFakeTransport();
    const provider = makeFakeProvider(transport);
    mockCreateProvider.mockReturnValue(provider as never);

    const service = createLspClientService();
    await service.connect();
    await service.disconnect();

    expect(service.isInitialized()).toBe(false);
  });

  it('dispose cleans up everything', async () => {
    const transport = makeFakeTransport();
    const provider = makeFakeProvider(transport);
    mockCreateProvider.mockReturnValue(provider as never);

    const service = createLspClientService();
    await service.connect();
    service.dispose();

    expect(service.isInitialized()).toBe(false);
    expect(provider.dispose).toHaveBeenCalled();
  });

  it('accepts external transport provider', async () => {
    const transport = makeFakeTransport();
    const provider = makeFakeProvider(transport);

    const service = createLspClientService({ transportProvider: provider as never });
    await service.connect();

    expect(service.isInitialized()).toBe(true);
    expect(mockCreateProvider).not.toHaveBeenCalled();
  });

  it('stays uninitialized when transport acquisition fails', async () => {
    const provider = {
      ...makeFakeProvider(),
      getTransport: vi.fn().mockRejectedValue(new Error('language services unavailable'))
    };
    mockCreateProvider.mockReturnValue(provider as never);

    const service = createLspClientService();
    await expect(service.connect()).rejects.toThrow('language services unavailable');

    expect(service.isInitialized()).toBe(false);
    expect(mockLspConnect).not.toHaveBeenCalled();
  });
});

describe('syncWorkspaceFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFile.mockReturnValue(null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function createConnectedService() {
    const transport = makeFakeTransport();
    const provider = makeFakeProvider(transport);
    mockCreateProvider.mockReturnValue(provider as never);
    const service = createLspClientService();
    await service.connect();
    // Clear mocks from connect phase
    mockDidOpen.mockClear();
    mockDidClose.mockClear();
    mockNotification.mockClear();
    return service;
  }

  it('sends didOpen for new files', async () => {
    const service = await createConnectedService();

    service.syncWorkspaceFiles([{ path: 'foo.rosetta', content: 'namespace foo' }]);

    expect(mockDidOpen).toHaveBeenCalledOnce();
    expect(mockDidOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: 'file:///workspace/foo.rosetta',
        languageId: 'rosetta',
        version: 0
      })
    );
  });

  it('sends didChange for modified files', async () => {
    const service = await createConnectedService();

    // First sync — opens the file
    service.syncWorkspaceFiles([{ path: 'foo.rosetta', content: 'namespace foo' }]);
    vi.runAllTimers();
    mockDidOpen.mockClear();
    mockNotification.mockClear();

    // Second sync — same path, different content
    service.syncWorkspaceFiles([{ path: 'foo.rosetta', content: 'namespace bar' }]);
    vi.runAllTimers();

    expect(mockDidOpen).not.toHaveBeenCalled();
    expect(mockNotification).toHaveBeenCalledWith('textDocument/didChange', {
      textDocument: { uri: 'file:///workspace/foo.rosetta', version: 1 },
      contentChanges: [{ text: 'namespace bar' }]
    });
  });

  it('sends didClose for removed files', async () => {
    const service = await createConnectedService();

    // Open a file
    service.syncWorkspaceFiles([{ path: 'foo.rosetta', content: 'namespace foo' }]);
    vi.runAllTimers();
    mockDidOpen.mockClear();

    // Sync with empty list — file is removed
    service.syncWorkspaceFiles([]);
    vi.runAllTimers();

    expect(mockDidClose).toHaveBeenCalledWith('file:///workspace/foo.rosetta');
  });

  it('increments version numbers on subsequent changes', async () => {
    const service = await createConnectedService();

    service.syncWorkspaceFiles([{ path: 'a.rosetta', content: 'v1' }]);
    vi.runAllTimers();
    service.syncWorkspaceFiles([{ path: 'a.rosetta', content: 'v2' }]);
    vi.runAllTimers();
    service.syncWorkspaceFiles([{ path: 'a.rosetta', content: 'v3' }]);
    vi.runAllTimers();

    // v1→v2 is version 1, v2→v3 is version 2
    const changeCalls = mockNotification.mock.calls.filter((c) => c[0] === 'textDocument/didChange');
    // Filter to only the target URI changes (exclude refresh notifications)
    const targetChanges = changeCalls.filter((c) => c[1].textDocument.uri === 'file:///workspace/a.rosetta');
    expect(targetChanges[0][1].textDocument.version).toBe(1);
    expect(targetChanges[1][1].textDocument.version).toBe(2);
  });

  it('handles batch of multiple new files', async () => {
    const service = await createConnectedService();

    service.syncWorkspaceFiles([
      { path: 'a.rosetta', content: 'namespace a' },
      { path: 'b.rosetta', content: 'namespace b' },
      { path: 'c.rosetta', content: 'namespace c' }
    ]);
    vi.runAllTimers();

    expect(mockDidOpen).toHaveBeenCalledTimes(3);
  });

  it('does not send notifications when not connected', () => {
    const provider = makeFakeProvider();
    mockCreateProvider.mockReturnValue(provider as never);
    const service = createLspClientService();

    // Not connected — should still track files internally without errors
    service.syncWorkspaceFiles([{ path: 'foo.rosetta', content: 'namespace foo' }]);

    expect(mockDidOpen).not.toHaveBeenCalled();
    expect(mockNotification).not.toHaveBeenCalled();
  });

  it('refreshes unchanged files when new files are added', async () => {
    const service = await createConnectedService();

    // First sync — one file
    service.syncWorkspaceFiles([{ path: 'a.rosetta', content: 'namespace a' }]);
    mockDidOpen.mockClear();
    mockNotification.mockClear();

    // Second sync — add a new file alongside existing
    service.syncWorkspaceFiles([
      { path: 'a.rosetta', content: 'namespace a' },
      { path: 'b.rosetta', content: 'namespace b' }
    ]);

    // Flush debounced refresh
    vi.runAllTimers();

    // b.rosetta should be opened
    expect(mockDidOpen).toHaveBeenCalledOnce();

    // a.rosetta should get a refresh notification (unchanged content, bumped version)
    const changeCalls = mockNotification.mock.calls.filter((c) => c[0] === 'textDocument/didChange');
    const refreshForA = changeCalls.find((c) => c[1].textDocument.uri === 'file:///workspace/a.rosetta');
    expect(refreshForA).toBeTruthy();
  });

  it('refreshes ALL unchanged files and skips changed files when new files added', async () => {
    const service = await createConnectedService();

    // First sync — three files
    service.syncWorkspaceFiles([
      { path: 'a.rosetta', content: 'namespace a' },
      { path: 'b.rosetta', content: 'namespace b' },
      { path: 'c.rosetta', content: 'namespace c' }
    ]);
    vi.runAllTimers();
    mockDidOpen.mockClear();
    mockNotification.mockClear();

    // Second sync — add new file d, modify b, keep a and c unchanged
    service.syncWorkspaceFiles([
      { path: 'a.rosetta', content: 'namespace a' },
      { path: 'b.rosetta', content: 'namespace b_modified' },
      { path: 'c.rosetta', content: 'namespace c' },
      { path: 'd.rosetta', content: 'namespace d' }
    ]);

    // Flush debounced refresh
    vi.runAllTimers();

    // d.rosetta should be opened
    expect(mockDidOpen).toHaveBeenCalledOnce();

    const changeCalls = mockNotification.mock.calls.filter((c) => c[0] === 'textDocument/didChange');

    // b.rosetta should get exactly ONE change (content modification), not a second refresh
    const changesForB = changeCalls.filter((c) => c[1].textDocument.uri === 'file:///workspace/b.rosetta');
    expect(changesForB).toHaveLength(1);
    expect(changesForB[0][1].contentChanges[0].text).toBe('namespace b_modified');

    // a.rosetta and c.rosetta should BOTH get refresh notifications (unchanged files)
    const refreshForA = changeCalls.filter((c) => c[1].textDocument.uri === 'file:///workspace/a.rosetta');
    const refreshForC = changeCalls.filter((c) => c[1].textDocument.uri === 'file:///workspace/c.rosetta');
    expect(refreshForA).toHaveLength(1);
    expect(refreshForC).toHaveLength(1);

    // Refresh notifications send same content (no-op change)
    expect(refreshForA[0][1].contentChanges[0].text).toBe('namespace a');
    expect(refreshForC[0][1].contentChanges[0].text).toBe('namespace c');

    // Total: 1 content change (b) + 2 refreshes (a, c) = 3 didChange notifications
    expect(changeCalls).toHaveLength(3);
  });

  it('does not change anything when files are identical', async () => {
    const service = await createConnectedService();

    service.syncWorkspaceFiles([{ path: 'a.rosetta', content: 'namespace a' }]);
    vi.runAllTimers();
    mockDidOpen.mockClear();
    mockNotification.mockClear();

    // Same files, same content, no additions
    service.syncWorkspaceFiles([{ path: 'a.rosetta', content: 'namespace a' }]);
    vi.runAllTimers();

    // No new opens, no changes, no closes (no new files added so no refresh either)
    expect(mockDidOpen).not.toHaveBeenCalled();
    expect(mockNotification).not.toHaveBeenCalled();
    expect(mockDidClose).not.toHaveBeenCalled();
  });

  it('skips sending didChange when a live editor view already owns the uri (avoids racing autoSync)', async () => {
    const service = await createConnectedService();

    // First sync — opens the file (no live view yet, so didOpen still comes from here)
    service.syncWorkspaceFiles([{ path: 'foo.rosetta', content: 'namespace foo' }]);
    vi.runAllTimers();
    mockDidOpen.mockClear();
    mockNotification.mockClear();

    // A live editor view now owns this uri (StudioWorkspace.openFile ran via
    // client.plugin(uri)) — @codemirror/lsp-client's own autoSync/client.sync()
    // is responsible for this uri's didChange from here on.
    mockGetFile.mockImplementation((uri: string) => (uri === 'file:///workspace/foo.rosetta' ? {} : null));

    service.syncWorkspaceFiles([{ path: 'foo.rosetta', content: 'namespace bar' }]);
    vi.runAllTimers();

    expect(mockNotification).not.toHaveBeenCalled();
  });

  it('still sends didChange for a modified file with no live view even while another uri has one', async () => {
    const service = await createConnectedService();

    service.syncWorkspaceFiles([
      { path: 'foo.rosetta', content: 'namespace foo' },
      { path: 'bar.rosetta', content: 'namespace bar' }
    ]);
    vi.runAllTimers();
    mockDidOpen.mockClear();
    mockNotification.mockClear();

    // Only foo.rosetta has a live view; bar.rosetta does not.
    mockGetFile.mockImplementation((uri: string) => (uri === 'file:///workspace/foo.rosetta' ? {} : null));

    service.syncWorkspaceFiles([
      { path: 'foo.rosetta', content: 'namespace foo changed' },
      { path: 'bar.rosetta', content: 'namespace bar changed' }
    ]);
    vi.runAllTimers();

    const changeCalls = mockNotification.mock.calls.filter((c) => c[0] === 'textDocument/didChange');
    expect(changeCalls.some((c) => c[1].textDocument.uri === 'file:///workspace/foo.rosetta')).toBe(false);
    const barChange = changeCalls.find((c) => c[1].textDocument.uri === 'file:///workspace/bar.rosetta');
    expect(barChange).toBeTruthy();
    expect(barChange![1].contentChanges[0].text).toBe('namespace bar changed');
  });

  it('skips the batch-refresh didChange for a uri with a live editor view', async () => {
    const service = await createConnectedService();

    // First sync — one file, already tracked with a live view.
    service.syncWorkspaceFiles([{ path: 'a.rosetta', content: 'namespace a' }]);
    vi.runAllTimers();
    mockDidOpen.mockClear();
    mockNotification.mockClear();
    mockGetFile.mockImplementation((uri: string) => (uri === 'file:///workspace/a.rosetta' ? {} : null));

    // Second sync — add a new file alongside the live-viewed one; this
    // triggers the debounced no-op refresh across unchanged files.
    service.syncWorkspaceFiles([
      { path: 'a.rosetta', content: 'namespace a' },
      { path: 'b.rosetta', content: 'namespace b' }
    ]);
    vi.runAllTimers();

    expect(mockDidOpen).toHaveBeenCalledOnce();
    const changeCalls = mockNotification.mock.calls.filter((c) => c[0] === 'textDocument/didChange');
    expect(changeCalls.some((c) => c[1].textDocument.uri === 'file:///workspace/a.rosetta')).toBe(false);
  });
});

describe('semantic dependency synchronization', () => {
  it('keeps an already-open editor attached while dependency models synchronize', async () => {
    const service = createLspClientService({ transportProvider: makeFakeProvider() });
    await service.connect();
    service.syncWorkspaceFiles([{ path: 'base.rosetta', content: 'namespace base' }]);
    const configure = vi.fn();
    const view = { dom: document.createElement('div') };
    const releaseView = service.claimDocumentView('file:///workspace/base.rosetta', view as never, configure);
    expect(configure).toHaveBeenCalledOnce();
    let release!: (value: null) => void;
    mockRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const sync = service.syncWorkspaceModels([{ uri: 'file:///dependency.rosetta', modelJson: '{}' }]);
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(configure).toHaveBeenCalledOnce();
    expect(service.getPlugin('file:///workspace/base.rosetta')).not.toBeNull();
    release(null);
    await sync;
    expect(configure).toHaveBeenCalledOnce();
    releaseView();
    service.dispose();
  });
  it('attaches an editor only after dependencies and didOpen, and detaches before didClose', async () => {
    const service = createLspClientService({ transportProvider: makeFakeProvider() });
    await service.connect();
    let release!: (value: null) => void;
    mockRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const sync = service.syncWorkspaceModels([{ uri: 'file:///workspace/base.rosetta', modelJson: '{}' }]);
    await vi.waitFor(() => expect(release).toBeDefined());
    const configure = vi.fn();
    const view = { dom: document.createElement('div') };
    const releaseView = service.claimDocumentView('file:///workspace/base.rosetta', view as never, configure);
    service.syncWorkspaceFiles([{ path: 'base.rosetta', content: 'namespace base' }]);
    expect(configure).not.toHaveBeenCalled();
    expect(service.getPlugin('file:///workspace/base.rosetta')).toBeNull();
    release(null);
    await sync;
    expect(configure).toHaveBeenLastCalledWith([]);
    expect(mockDidOpen.mock.invocationCallOrder.at(-1)).toBeLessThan(configure.mock.invocationCallOrder.at(-1)!);
    service.syncWorkspaceFiles([]);
    expect(configure).toHaveBeenLastCalledWith(null);
    expect(configure.mock.invocationCallOrder.at(-1)).toBeLessThan(mockDidClose.mock.invocationCallOrder.at(-1)!);
    releaseView();
    service.dispose();
  });
  it('opens only the latest requested source after its closure finishes uploading', async () => {
    const service = createLspClientService({ transportProvider: makeFakeProvider() });
    await service.connect();
    mockDidOpen.mockClear();
    let release!: (value: null) => void;
    mockRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const sync = service.syncWorkspaceModels([{ uri: 'file:///workspace/next.rosetta', modelJson: '{}' }]);
    await vi.waitFor(() => expect(release).toBeDefined());
    service.syncWorkspaceFiles([{ path: 'next.rosetta', content: 'namespace original' }]);
    service.syncWorkspaceFiles([{ path: 'next.rosetta', content: 'namespace latest' }]);
    expect(mockDidOpen).not.toHaveBeenCalled();
    release(null);
    await sync;
    expect(mockDidOpen).toHaveBeenCalledTimes(1);
    expect(mockDidOpen.mock.lastCall?.[0].doc.toString()).toBe('namespace latest');
    service.dispose();
  });
  it('retries an unpublished closure before opening source after a failed retain', async () => {
    const service = createLspClientService({ transportProvider: makeFakeProvider() });
    await service.connect();
    mockDidOpen.mockClear();
    mockRequest.mockClear();
    mockRequest
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('retain failed'));
    const models = [{ uri: 'file:///workspace/next.rosetta', modelJson: '{}' }];
    const sync = service.syncWorkspaceModels(models);
    service.syncWorkspaceFiles([{ path: 'next.rosetta', content: 'namespace next' }]);
    await expect(sync).rejects.toThrow('retain failed');
    expect(mockDidOpen).not.toHaveBeenCalled();
    await service.syncWorkspaceModels(models);
    expect(mockDidOpen).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledTimes(6);
    service.dispose();
  });
  it('sends only changed models, prunes removed models and replays after reconnect', async () => {
    const service = createLspClientService({ transportProvider: makeFakeProvider() });
    mockRequest.mockClear();
    await service.connect();
    await service.syncWorkspaceModels([{ uri: 'file:///a.rosetta', modelJson: 'first' }]);
    expect(mockRequest.mock.calls.map((call) => call[1])).toEqual([
      { retain: [] },
      { document: { uri: 'file:///a.rosetta', modelJson: 'first' } },
      { retain: ['file:///a.rosetta'] }
    ]);
    mockRequest.mockClear();
    await service.syncWorkspaceModels([{ uri: 'file:///a.rosetta', modelJson: 'first' }]);
    expect(mockRequest).not.toHaveBeenCalled();
    await service.reconnect();
    expect(mockRequest.mock.calls.some((call) => call[1].document?.modelJson === 'first')).toBe(true);
    mockRequest.mockClear();
    await service.syncWorkspaceModels([]);
    expect(mockRequest.mock.calls.map((call) => call[1])).toEqual([{ retain: [] }, { retain: [] }]);
    service.dispose();
  });
});

describe('LSP URI identity', () => {
  it('canonicalizes curated brackets and spaces for source and model synchronization', async () => {
    const service = createLspClientService({ transportProvider: makeFakeProvider() });
    await service.connect();
    mockRequest.mockClear();
    mockDidOpen.mockClear();
    await service.syncWorkspaceModels([{ uri: 'file:///[cdm]/a file.rosetta', modelJson: '{}' }]);
    service.syncWorkspaceFiles([{ path: '[cdm]/a file.rosetta', content: 'namespace cdm' }]);
    const uri = 'file:///%5Bcdm%5D/a%20file.rosetta';
    expect(mockRequest.mock.calls.some((call) => call[1].document?.uri === uri)).toBe(true);
    expect(mockDidOpen).toHaveBeenCalledWith(expect.objectContaining({ uri }));
    service.getPlugin('file:///[cdm]/a file.rosetta');
    expect(mockPlugin).toHaveBeenCalledWith(uri);
    service.dispose();
  });
});
