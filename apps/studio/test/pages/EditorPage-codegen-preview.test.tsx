// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * CodegenProvider — codegen worker→store path (Codex P2 follow-up coverage).
 *
 * The codegen:generate request/response cycle was lifted OUT of
 * CodePreviewPanel (now pure-display), through EditorPage, and finally INTO
 * CodegenProvider — the single app-level owner of the preview/codegen worker.
 * This suite drives the real CodegenProvider with a MockWorker and asserts on
 * observable behaviour only (MockWorker.postMessage spy + useCodegenStore
 * state) — never internals.
 *
 * Scenarios:
 *  1. Selecting a codegen target → CodegenProvider posts `codegen:generate`
 *     (correct target + a requestId).
 *  2. `codegen:result` for the current requestId → snapshot becomes `ready`.
 *  3. `codegen:outdated` → snapshot `stale`; `codegen:error` / worker `error`
 *     event → snapshot `unavailable`.
 *  4. STALE requestId: a `codegen:result` with a non-current requestId is
 *     ignored (restores the dropped stale-filter coverage).
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { usePreviewStore } from '../../src/store/preview-store.js';
import { useCodegenStore } from '../../src/store/codegen-store.js';
import { setRuneStudioTestApi } from '../../src/test-api.js';
import { CodegenProvider } from '../../src/shell/providers/CodegenProvider.js';
import { WorkspaceStateContext, type WorkspaceState } from '../../src/shell/providers/workspace-context.js';

// ---------------------------------------------------------------------------
// MockWorker — addEventListener-based so the provider's listener wiring is
// exercised exactly as in production. `dispatch` fires registered listeners.
// ---------------------------------------------------------------------------

class MockWorker {
  static instances: MockWorker[] = [];
  readonly postMessage = vi.fn((message: { type: string; requestId?: string; filesRevision?: number }) => {
    if (message.type === 'preview:setFiles')
      queueMicrotask(() =>
        this.dispatch('message', {
          data: {
            type: 'preview:files-ready',
            requestId: message.requestId,
            filesRevision: message.filesRevision
          }
        })
      );
  });
  readonly listeners = new Map<string, Set<EventListener>>();
  readonly addEventListener = vi.fn((type: string, listener: EventListener) => {
    const handlers = this.listeners.get(type) ?? new Set<EventListener>();
    handlers.add(listener);
    this.listeners.set(type, handlers);
  });
  readonly removeEventListener = vi.fn((type: string, listener: EventListener) => {
    this.listeners.get(type)?.delete(listener);
  });
  readonly terminate = vi.fn();

  constructor(_url?: URL, _options?: WorkerOptions) {
    MockWorker.instances.push(this);
  }

  dispatch(type: 'message' | 'error' | 'messageerror', event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event as Event);
    }
  }
}

vi.mock('../../src/utils/uri.js', () => ({ pathToUri: (path: string) => `file://${path}` }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WS_FILES = [{ name: 'a.rosetta', path: 'a.rosetta', content: 'namespace a', dirty: false }];

function wsState(files: WorkspaceState['files']): WorkspaceState {
  return {
    workspaceId: 'ws-A',
    workspaceKind: 'browser-only',
    workspaceName: 'ws-A',
    fileCount: files.length,
    files,
    models: [],
    parsedModels: [],
    deferredExports: [],
    parseErrors: new Map()
  };
}

/** Render CodegenProvider (the worker owner) wrapped in workspace context. */
function renderProvider(files: WorkspaceState['files'] = WS_FILES) {
  return render(
    <WorkspaceStateContext.Provider value={wsState(files)}>
      <CodegenProvider>
        <div />
      </CodegenProvider>
    </WorkspaceStateContext.Provider>
  );
}

/** Find the most recent codegen:generate message posted to the worker. */
function lastCodegenGenerate(worker: MockWorker): { type: string; target: string; requestId: string } | undefined {
  return worker.postMessage.mock.calls
    .map(([m]) => m as { type?: string; target?: string; requestId?: string })
    .filter((m): m is { type: string; target: string; requestId: string } => m.type === 'codegen:generate')
    .at(-1);
}

function lastPreviewSetFiles(
  worker: MockWorker
):
  | { type: string; files: Array<{ uri: string; content: string; serializedModelJson?: string }>; requestId?: string }
  | undefined {
  return worker.postMessage.mock.calls
    .map(
      ([m]) =>
        m as {
          type?: string;
          files?: Array<{ uri: string; content: string; serializedModelJson?: string }>;
          requestId?: string;
        }
    )
    .filter(
      (
        m
      ): m is {
        type: string;
        files: Array<{ uri: string; content: string; serializedModelJson?: string }>;
        requestId?: string;
      } => m.type === 'preview:setFiles' && Array.isArray(m.files)
    )
    .at(-1);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('CodegenProvider — codegen worker→store path', () => {
  beforeEach(() => {
    MockWorker.instances = [];
    // Provide the worker through the test API so the provider does not attempt
    // `new Worker(new URL(...))` (unsupported in jsdom).
    setRuneStudioTestApi(() => ({ createCodegenWorker: () => new MockWorker() as unknown as Worker }));
    usePreviewStore.getState().resetPreviewState();
    useCodegenStore.getState().resetCodegenState();
    vi.clearAllMocks();
  });

  afterEach(() => {
    setRuneStudioTestApi(() => undefined);
    cleanup();
  });

  it('posts codegen:generate to the worker when a codegen target is selected', async () => {
    renderProvider();

    await waitFor(() => {
      expect(MockWorker.instances).toHaveLength(1);
    });
    const worker = MockWorker.instances[0]!;

    // No codegen:generate while activeTarget is undefined (landing table).
    expect(lastCodegenGenerate(worker)).toBeUndefined();

    await act(async () => {
      useCodegenStore.getState().setCodePreviewTarget('typescript');
      useCodegenStore.getState().setActiveTarget('typescript');
    });

    await waitFor(() => {
      const msg = lastCodegenGenerate(worker);
      expect(msg).toBeDefined();
      expect(msg!.target).toBe('typescript');
      expect(typeof msg!.requestId).toBe('string');
      expect(msg!.requestId.length).toBeGreaterThan(0);
    });
  });

  it('publishes files once for each selected preview generation', async () => {
    const id = 'a.Model#Data';
    usePreviewStore.getState().setAvailableTargets([{ id, namespace: 'a', name: 'Model', kind: 'Data' }]);
    usePreviewStore.getState().selectTarget(id);
    renderProvider();
    await waitFor(() => expect(MockWorker.instances).toHaveLength(1));
    const worker = MockWorker.instances[0]!;
    await act(async () => {
      await Promise.resolve();
    });
    const publications = () =>
      worker.postMessage.mock.calls.filter(([message]) => message.type === 'preview:setFiles').length;
    const initial = publications();
    await act(async () => useCodegenStore.getState().setActiveTarget('zod'));
    await waitFor(() => expect(lastCodegenGenerate(worker)).toBeDefined());
    expect(publications() - initial).toBe(1);
    const previous = lastCodegenGenerate(worker)!.requestId;
    await act(async () => useCodegenStore.getState().refreshCodePreview());
    await waitFor(() => expect(lastCodegenGenerate(worker)?.requestId).not.toBe(previous));
    expect(publications() - initial).toBe(2);
  });

  it('requests explicit regeneration without changing the active target', async () => {
    renderProvider();
    await waitFor(() => expect(MockWorker.instances).toHaveLength(1));
    const worker = MockWorker.instances[0]!;
    await act(async () => useCodegenStore.getState().setActiveTarget('zod'));
    await waitFor(() => expect(lastCodegenGenerate(worker)).toBeDefined());
    const initial = lastCodegenGenerate(worker)!.requestId;
    await act(async () => useCodegenStore.getState().refreshCodePreview());
    await waitFor(() => expect(lastCodegenGenerate(worker)?.requestId).not.toBe(initial));
    expect(worker.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'codegen:generate',
      target: 'zod',
      regenerate: true
    });
    expect(useCodegenStore.getState().activeTarget).toBe('zod');
  });

  it('marks the store snapshot ready on codegen:result for the current requestId', async () => {
    renderProvider();
    await waitFor(() => expect(MockWorker.instances).toHaveLength(1));
    const worker = MockWorker.instances[0]!;

    await act(async () => {
      useCodegenStore.getState().setCodePreviewTarget('zod');
      useCodegenStore.getState().setActiveTarget('zod');
    });

    await waitFor(() => expect(lastCodegenGenerate(worker)).toBeDefined());
    const { requestId } = lastCodegenGenerate(worker)!;

    await act(async () => {
      worker.dispatch('message', {
        data: {
          type: 'codegen:result',
          target: 'zod',
          requestId,
          files: [{ relativePath: 'ns.zod.ts', content: 'export const X = z.object({});', sourceMap: [] }]
        }
      });
    });

    const snapshot = useCodegenStore.getState().snapshot;
    expect(snapshot.status).toBe('ready');
    if (snapshot.status === 'ready') {
      expect(snapshot.target).toBe('zod');
      expect(snapshot.files).toHaveLength(1);
      expect(snapshot.files[0]?.relativePath).toBe('ns.zod.ts');
      expect(snapshot.files[0]?.content).toContain('z.object');
    }
  });

  it('marks the store snapshot stale on codegen:outdated', async () => {
    renderProvider();
    await waitFor(() => expect(MockWorker.instances).toHaveLength(1));
    const worker = MockWorker.instances[0]!;

    await act(async () => {
      useCodegenStore.getState().setCodePreviewTarget('zod');
      useCodegenStore.getState().setActiveTarget('zod');
    });
    await waitFor(() => expect(lastCodegenGenerate(worker)).toBeDefined());
    const { requestId } = lastCodegenGenerate(worker)!;

    // First a successful result so stale has files to preserve.
    await act(async () => {
      worker.dispatch('message', {
        data: {
          type: 'codegen:result',
          target: 'zod',
          requestId,
          files: [{ relativePath: 'ns.zod.ts', content: 'good', sourceMap: [] }]
        }
      });
    });
    await act(async () => {
      worker.dispatch('message', {
        data: {
          type: 'codegen:outdated',
          target: 'zod',
          requestId,
          message: 'Fix model errors to refresh the code preview.'
        }
      });
    });

    const snapshot = useCodegenStore.getState().snapshot;
    expect(snapshot.status).toBe('stale');
    if (snapshot.status === 'stale') {
      expect(snapshot.message).toMatch(/Fix model errors/i);
      // Last-good content retained.
      expect(snapshot.files[0]?.content).toBe('good');
    }
  });

  it.each([
    'different declaration',
    'different kind',
    'workspace export',
    'different workspace',
    'same declaration'
  ] as const)('scopes outdated recovery when requesting %s', async (transition) => {
    const a = { id: 'a.Model#Data', namespace: 'a', name: 'Model', kind: 'Data' };
    const b =
      transition === 'different kind'
        ? { ...a, id: 'a.Model#RosettaFunction', kind: 'RosettaFunction' }
        : { ...a, id: 'a.Other#Data', name: 'Other' };
    usePreviewStore.getState().setAvailableTargets([a, b]);
    usePreviewStore.getState().selectTarget(a.id);
    const { rerender } = renderProvider();
    await waitFor(() => expect(MockWorker.instances).toHaveLength(1));
    const worker = MockWorker.instances[0]!;
    await act(async () => {
      useCodegenStore.getState().setCodePreviewTarget('typescript');
      useCodegenStore.getState().setActiveTarget('typescript');
    });
    await waitFor(() => expect(lastCodegenGenerate(worker)).toBeDefined());
    const firstId = lastCodegenGenerate(worker)!.requestId;
    await act(async () => {
      worker.dispatch('message', {
        data: {
          type: 'codegen:result',
          target: 'typescript',
          requestId: firstId,
          files: [{ relativePath: 'a.ts', content: 'declaration A', sourceMap: [] }]
        }
      });
    });
    expect(useCodegenStore.getState().snapshot.status).toBe('ready');
    await act(async () => {
      if (transition === 'same declaration') {
        useCodegenStore.getState().refreshCodePreview();
      } else if (transition === 'different workspace') {
        rerender(
          <WorkspaceStateContext.Provider value={{ ...wsState(WS_FILES), workspaceId: 'ws-B' }}>
            <CodegenProvider>
              <div />
            </CodegenProvider>
          </WorkspaceStateContext.Provider>
        );
      } else {
        usePreviewStore.getState().selectTarget(transition === 'workspace export' ? undefined : b.id);
      }
    });
    await waitFor(() => expect(lastCodegenGenerate(worker)!.requestId).not.toBe(firstId));
    const nextId = lastCodegenGenerate(worker)!.requestId;
    await act(async () => {
      worker.dispatch('message', {
        data: { type: 'codegen:outdated', target: 'typescript', requestId: nextId, message: 'Fix source.' }
      });
    });
    if (transition === 'same declaration') {
      expect(useCodegenStore.getState().snapshot).toMatchObject({
        status: 'stale',
        files: [{ relativePath: 'a.ts', content: 'declaration A' }]
      });
    } else {
      expect(useCodegenStore.getState().snapshot).toEqual({
        status: 'unavailable',
        target: 'typescript',
        message: 'Fix source.'
      });
    }
  });

  it('marks the store snapshot unavailable on codegen:error', async () => {
    renderProvider();
    await waitFor(() => expect(MockWorker.instances).toHaveLength(1));
    const worker = MockWorker.instances[0]!;

    await act(async () => {
      useCodegenStore.getState().setCodePreviewTarget('zod');
      useCodegenStore.getState().setActiveTarget('zod');
    });
    await waitFor(() => expect(lastCodegenGenerate(worker)).toBeDefined());
    const { requestId } = lastCodegenGenerate(worker)!;

    await act(async () => {
      worker.dispatch('message', {
        data: { type: 'codegen:error', target: 'zod', requestId, message: 'Code generation failed.' }
      });
    });

    const snapshot = useCodegenStore.getState().snapshot;
    expect(snapshot.status).toBe('unavailable');
    if (snapshot.status === 'unavailable') {
      expect(snapshot.message).toMatch(/Code generation failed/i);
    }
  });

  it('marks the store snapshot unavailable when the worker emits an error event', async () => {
    renderProvider();
    await waitFor(() => expect(MockWorker.instances).toHaveLength(1));
    const worker = MockWorker.instances[0]!;

    await act(async () => {
      useCodegenStore.getState().setCodePreviewTarget('zod');
      useCodegenStore.getState().setActiveTarget('zod');
    });
    await waitFor(() => expect(lastCodegenGenerate(worker)).toBeDefined());

    await act(async () => {
      worker.dispatch('error', { type: 'error', message: 'worker crashed' });
    });

    const snapshot = useCodegenStore.getState().snapshot;
    expect(snapshot.status).toBe('unavailable');
    if (snapshot.status === 'unavailable') {
      expect(snapshot.message).toMatch(/reload Studio/i);
    }
  });

  it('ignores a codegen:result carrying a stale (non-current) requestId', async () => {
    renderProvider();
    await waitFor(() => expect(MockWorker.instances).toHaveLength(1));
    const worker = MockWorker.instances[0]!;

    await act(async () => {
      useCodegenStore.getState().setCodePreviewTarget('zod');
      useCodegenStore.getState().setActiveTarget('zod');
    });
    await waitFor(() => expect(lastCodegenGenerate(worker)).toBeDefined());

    // A stale response with an older/foreign requestId must be ignored.
    await act(async () => {
      worker.dispatch('message', {
        data: {
          type: 'codegen:result',
          target: 'zod',
          requestId: 'codegen:zod:stale-0',
          files: [{ relativePath: 'stale.zod.ts', content: 'stale payload', sourceMap: [] }]
        }
      });
    });

    // Snapshot must NOT reflect the stale payload — still waiting.
    const afterStale = useCodegenStore.getState().snapshot;
    expect(afterStale.status).toBe('waiting');
  });

  it('drops list-only refOnly curated entries from preview:setFiles but keeps hydrated curated files', async () => {
    const files: WorkspaceState['files'] = [
      { name: 'a.rosetta', path: 'a.rosetta', content: 'namespace a', dirty: false },
      {
        name: 'cdm.base.math',
        path: '[cdm]/cdm.base.math',
        content: '',
        dirty: false,
        readOnly: true,
        refOnly: true,
        bundleId: 'cdm',
        bundleVersion: 'latest'
      },
      {
        name: 'Trade.rosetta',
        path: '[cdm]/Trade.rosetta',
        content: '',
        dirty: false,
        readOnly: true,
        refOnly: true,
        bundleId: 'cdm',
        bundleVersion: 'latest',
        serializedModelJson: '{"$type":"RosettaModel","name":"cdm.Trade"}'
      }
    ];

    renderProvider(files);

    await waitFor(() => expect(MockWorker.instances).toHaveLength(1));
    const worker = MockWorker.instances[0]!;

    await waitFor(() => expect(lastPreviewSetFiles(worker)).toBeDefined());
    const message = lastPreviewSetFiles(worker)!;

    expect(message.files).toEqual([
      { uri: 'file://a.rosetta', content: 'namespace a' },
      {
        uri: 'file://[cdm]/Trade.rosetta',
        content: '',
        serializedModelJson: '{"$type":"RosettaModel","name":"cdm.Trade"}'
      }
    ]);
  });
});
