// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEditorStore } from '@rune-langium/visual-editor';

import { App } from '../../src/App.js';
import { getModelSource } from '../../src/services/model-registry.js';
import { useModelStore } from '../../src/store/model-store.js';
import { useActivityStore } from '../../src/store/activity-store.js';
import { useOutputStore } from '../../src/store/output-store.js';
import { saveWorkspace, _resetForTests, type WorkspaceRecord } from '../../src/workspace/persistence.js';
import { createOpfsRoot, type OpfsRoot } from '../setup/opfs-mock.js';
import { saveWorkspaceFiles, setWorkspaceFilesDeps } from '../../src/workspace/workspace-files.js';

const { parseWorkspaceFilesMock, showToastSpy, setCuratedFilesSpy } = vi.hoisted(() => ({
  parseWorkspaceFilesMock: vi.fn(),
  showToastSpy: vi.fn(),
  setCuratedFilesSpy: vi.fn()
}));

vi.mock('../../src/services/workspace.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/workspace.js')>();
  return {
    ...actual,
    parseWorkspaceFiles: parseWorkspaceFilesMock
  };
});

vi.mock('../../src/components/ModelLoader.js', () => ({
  ModelLoader: () => null
}));

vi.mock('../../src/shell/ExplorePerspective.js', async () => {
  const { useWorkspace } = await import('../../src/shell/providers/workspace-context.js');
  const { useWorkspaceActions } = await import('../../src/shell/perspectives/workspace-actions-context.js');
  return {
    ExplorePerspective: () => {
      const { files, models, parsedModels, parseErrors } = useWorkspace();
      const { onFilesChange } = useWorkspaceActions();
      return (
        <div data-testid="explore-workbench">
          <span data-testid="model-count">{models.length}</span>
          <span data-testid="parsed-count">{parsedModels.length}</span>
          <span data-testid="error-count">{parseErrors.size}</span>
          <span data-testid="curated-read-only-count">
            {files.filter((file) => file.bundleId === 'cdm' && file.refOnly).length}
          </span>
          <button
            type="button"
            onClick={() =>
              onFilesChange(
                files.map((file) =>
                  file.path === 'trade.rosetta'
                    ? {
                        ...file,
                        content: 'namespace restored.project\n\ntype Trade\n  tradeDate date (1..1)\n',
                        dirty: true
                      }
                    : file
                )
              )
            }
          >
            break
          </button>
          <button
            type="button"
            onClick={() => useEditorStore.getState().requestNamespaceHydration('cdm.base.staticdata.party')}
          >
            hydrate
          </button>
        </div>
      );
    }
  };
});

vi.mock('../../src/store/model-store.js', () => {
  const state = {
    models: new Map(),
    load: vi.fn(),
    unload: vi.fn(),
    setCuratedFiles: setCuratedFilesSpy
  };
  const useStore = ((selector: (value: typeof state) => unknown) => selector(state)) as unknown as {
    (selector: (value: typeof state) => unknown): unknown;
    getState: () => typeof state;
  };
  useStore.getState = () => state;
  return { useModelStore: useStore };
});

vi.mock('../../src/services/transport-provider.js', () => ({
  createTransportProvider: () => ({
    onStateChange: () => () => {},
    dispose: () => {}
  })
}));

vi.mock('../../src/services/lsp-client.js', () => ({
  createLspClientService: () => ({
    connect: vi.fn().mockResolvedValue(undefined),
    reconnect: vi.fn().mockResolvedValue(undefined),
    syncWorkspaceFiles: vi.fn(),
    syncWorkspaceModels: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn()
  })
}));

vi.mock('../../src/components/StudioToastProvider.js', () => ({
  StudioToastProvider: ({ children }: { children?: ReactNode }) => children,
  useStudioToast: () => ({ showToast: showToastSpy, showLoadingToast: vi.fn(() => 'toast-id'), dismissToast: vi.fn() })
}));

function makeWorkspace(id: string, name: string): WorkspaceRecord {
  const now = new Date().toISOString();
  return {
    id,
    name,
    kind: 'browser-only',
    createdAt: now,
    lastOpenedAt: now,
    layout: { version: 1, writtenBy: '0', dockview: null },
    tabs: [],
    activeTabPath: null,
    curatedModels: [],
    schemaVersion: 1
  };
}

class MockWorker {
  readonly postMessage = vi.fn();
  readonly addEventListener = vi.fn();
  readonly removeEventListener = vi.fn();
  readonly terminate = vi.fn();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  useActivityStore.getState().clearEntries();
  useOutputStore.getState().clearLines();
  useEditorStore.getState().resetHydration();
  parseWorkspaceFilesMock.mockReset();
  showToastSpy.mockReset();
  setCuratedFilesSpy.mockReset();
  useModelStore.getState().models.clear();
  vi.stubGlobal('Worker', MockWorker);
  const opfsRoot: OpfsRoot = createOpfsRoot();
  setWorkspaceFilesDeps({
    getOpfsRoot: async () => opfsRoot as unknown as FileSystemDirectoryHandle
  });
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: {
      getDirectory: vi.fn().mockResolvedValue(opfsRoot as unknown as FileSystemDirectoryHandle)
    }
  });
  await _resetForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('rune-studio');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  document.body.removeAttribute('data-workspace-active');
});

afterEach(() => {
  setWorkspaceFilesDeps({
    getOpfsRoot: async () => {
      throw new Error('test opfs root not configured');
    }
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

describe('App parse recovery', () => {
  it('keeps the last valid semantic model when an edit-time parse fails', async () => {
    parseWorkspaceFilesMock
      .mockResolvedValueOnce({
        models: [{ name: 'restored.project' }],
        parsedModels: [{ filePath: 'trade.rosetta', model: { name: 'restored.project' } }],
        errors: new Map(),
        parseMode: 'router'
      })
      .mockResolvedValueOnce({
        models: [],
        parsedModels: [],
        errors: new Map([['trade.rosetta', ['Expected ":" after type declaration']]]),
        parseMode: 'router'
      });

    await saveWorkspace(makeWorkspace('ws-parse-errors', 'Parse Recovery'));
    await saveWorkspaceFiles('ws-parse-errors', [
      {
        name: 'trade.rosetta',
        path: 'trade.rosetta',
        content: 'namespace restored.project\n\ntype Trade:\n  tradeDate date (1..1)\n',
        dirty: false
      }
    ]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('model-count').textContent).toBe('1');
      expect(screen.getByTestId('parsed-count').textContent).toBe('1');
      expect(screen.getByTestId('error-count').textContent).toBe('0');
    });

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'break' }));
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(screen.getByTestId('model-count').textContent).toBe('1');
    expect(screen.getByTestId('parsed-count').textContent).toBe('1');
    expect(screen.getByTestId('error-count').textContent).toBe('1');
  });

  it('ignores stale edit-time parse results that resolve after newer content', async () => {
    const staleInvalid = deferred<{
      models: [];
      parsedModels: [];
      errors: Map<string, string[]>;
      parseMode: 'router';
    }>();
    const latestValid = deferred<{
      models: Array<{ name: string }>;
      parsedModels: Array<{ filePath: string; model: { name: string } }>;
      errors: Map<string, string[]>;
      parseMode: 'router';
    }>();
    parseWorkspaceFilesMock
      .mockResolvedValueOnce({
        models: [{ name: 'restored.project' }],
        parsedModels: [{ filePath: 'trade.rosetta', model: { name: 'restored.project' } }],
        errors: new Map(),
        parseMode: 'router'
      })
      .mockReturnValueOnce(staleInvalid.promise)
      .mockReturnValueOnce(latestValid.promise);

    await saveWorkspace(makeWorkspace('ws-parse-race', 'Parse Race'));
    await saveWorkspaceFiles('ws-parse-race', [
      {
        name: 'trade.rosetta',
        path: 'trade.rosetta',
        content: 'namespace restored.project\n\ntype Trade:\n  tradeDate date (1..1)\n',
        dirty: false
      }
    ]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('model-count').textContent).toBe('1');
      expect(screen.getByTestId('error-count').textContent).toBe('0');
    });

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'break' }));
      await vi.advanceTimersByTimeAsync(500);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'break' }));
      await vi.advanceTimersByTimeAsync(500);
    });

    latestValid.resolve({
      models: [{ name: 'restored.project' }],
      parsedModels: [{ filePath: 'trade.rosetta', model: { name: 'restored.project' } }],
      errors: new Map(),
      parseMode: 'router'
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('error-count').textContent).toBe('0');

    staleInvalid.resolve({
      models: [],
      parsedModels: [],
      errors: new Map([['trade.rosetta', ['Expected ":" after type declaration']]]),
      parseMode: 'router'
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('model-count').textContent).toBe('1');
    expect(screen.getByTestId('parsed-count').textContent).toBe('1');
    expect(screen.getByTestId('error-count').textContent).toBe('0');
  });
});

describe('App curated parse projection', () => {
  it('records one correlated hydration failure while retaining the graph and showing a notification', async () => {
    parseWorkspaceFilesMock
      .mockResolvedValueOnce({
        models: [{ name: 'restored.project' }],
        parsedModels: [{ filePath: 'trade.rosetta', model: { name: 'restored.project' } }],
        errors: new Map(),
        parseMode: 'router'
      })
      .mockRejectedValueOnce(new Error('hydration unavailable'));
    await saveWorkspace(makeWorkspace('ws-hydration-reject', 'Hydration reject'));
    await saveWorkspaceFiles('ws-hydration-reject', [
      {
        name: 'trade.rosetta',
        path: 'trade.rosetta',
        content: 'namespace restored.project',
        dirty: false
      }
    ]);
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('model-count').textContent).toBe('1'));
    fireEvent.click(screen.getByRole('button', { name: 'hydrate' }));
    await waitFor(() =>
      expect(showToastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Failed to hydrate the selected namespace; keeping the last valid graph'
        })
      )
    );
    const failureEntries = useActivityStore.getState().entries.filter((entry) => !entry.ok);
    const failureLines = useOutputStore.getState().lines.filter((line) => line.severity === 'error');
    expect(failureEntries).toHaveLength(1);
    expect(failureLines).toHaveLength(1);
    const start = useActivityStore
      .getState()
      .entries.find((entry) => entry.msg === 'Loading cdm.base.staticdata.party…')!;
    expect(failureEntries[0]).toMatchObject({ tag: 'curated', opId: start.opId, durationMs: expect.any(Number) });
    expect(failureLines[0]).toMatchObject({ opId: start.opId, durationMs: expect.any(Number) });
    expect(failureLines[0]!.text).toContain('hydration unavailable');
    expect(useEditorStore.getState().pendingHydrationNamespaces).toEqual([]);
    expect(useEditorStore.getState().hydratedNamespaces).not.toContain('cdm.base.staticdata.party');
    expect(screen.getByTestId('model-count').textContent).toBe('1');
  });

  it('keeps hydration retryable when the parse preserves the last valid graph', async () => {
    parseWorkspaceFilesMock
      .mockResolvedValueOnce({
        models: [{ name: 'restored.project' }],
        parsedModels: [{ filePath: 'trade.rosetta', model: { name: 'restored.project' } }],
        errors: new Map(),
        parseMode: 'router'
      })
      .mockResolvedValueOnce({
        models: [],
        parsedModels: [],
        errors: new Map([['trade.rosetta', ['Expected ":" after type declaration']]]),
        parseMode: 'router',
        curatedRefOnlyFiles: {
          cdm: [
            {
              path: 'base-staticdata-party-type.rosetta',
              content: 'namespace cdm.base.staticdata.party\n',
              namespace: 'cdm.base.staticdata.party',
              serializedModelJson: '{}',
              exports: [],
              refOnly: true
            }
          ]
        }
      });
    await saveWorkspace(makeWorkspace('ws-hydration-errors', 'Hydration Errors'));
    await saveWorkspaceFiles('ws-hydration-errors', [
      {
        name: 'trade.rosetta',
        path: 'trade.rosetta',
        content: 'namespace restored.project\n\ntype Trade:\n  tradeDate date (1..1)\n',
        dirty: false
      }
    ]);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('model-count').textContent).toBe('1'));
    fireEvent.click(screen.getByRole('button', { name: 'hydrate' }));

    await waitFor(() => {
      expect(parseWorkspaceFilesMock).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('error-count').textContent).toBe('1');
      expect(useEditorStore.getState().pendingHydrationNamespaces).toEqual([]);
    });
    expect(useEditorStore.getState().hydratedNamespaces).not.toContain('cdm.base.staticdata.party');
    expect(screen.getByTestId('model-count').textContent).toBe('1');
    expect(screen.getByTestId('curated-read-only-count').textContent).toBe('0');
  });

  it('puts initially hydrated curated files into the read-only workspace view', async () => {
    const source = getModelSource('cdm');
    expect(source).toBeDefined();
    useModelStore
      .getState()
      .models.set('cdm', { source: source!, commitHash: 'latest', files: [], loadedAt: Date.now() });
    setCuratedFilesSpy.mockImplementation(
      (id: string, files: Array<{ path: string; content: string; serializedModelJson?: string }>) => {
        const state = useModelStore.getState();
        const existing = state.models.get(id);
        if (!existing) return;
        if (
          existing.files.length === files.length &&
          existing.files.every(
            (file, index) =>
              file.path === files[index]?.path &&
              file.content === files[index]?.content &&
              file.serializedModelJson === files[index]?.serializedModelJson
          )
        )
          return;
        state.models = new Map(state.models);
        state.models.set(id, { ...existing, files });
      }
    );
    parseWorkspaceFilesMock.mockResolvedValue({
      models: [],
      parsedModels: [],
      errors: new Map(),
      parseMode: 'router',
      curatedRefOnlyFiles: {
        cdm: [
          {
            path: 'base-staticdata-party-type.rosetta',
            content: 'namespace cdm.base.staticdata.party\n',
            namespace: 'cdm.base.staticdata.party',
            serializedModelJson: '{}',
            exports: [],
            refOnly: true
          }
        ]
      }
    });
    await saveWorkspace(makeWorkspace('ws-curated-import', 'Curated Import'));
    await saveWorkspaceFiles('ws-curated-import', [
      {
        name: 'starter.rosetta',
        path: 'starter.rosetta',
        content: 'namespace example\n',
        dirty: false
      }
    ]);

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('curated-read-only-count').textContent).toBe('1'));
    expect(setCuratedFilesSpy).toHaveBeenCalled();
  });
});
