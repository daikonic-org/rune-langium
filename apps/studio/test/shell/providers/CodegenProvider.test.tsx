// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useState } from 'react';

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: any[] = [];
  listeners: Record<string, Function[]> = {};
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(m: any) {
    this.posted.push(m);
  }
  addEventListener(t: string, cb: Function) {
    (this.listeners[t] ||= []).push(cb);
  }
  removeEventListener(t: string, cb: Function) {
    this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== cb);
  }
  terminate() {
    this.terminated = true;
  }
}

beforeEach(() => {
  FakeWorker.instances = [];
  window.__runeStudioTestApi = { createCodegenWorker: () => new FakeWorker() as unknown as Worker };
  // This file's tests never touched useEditorStore before the hydration-wiring
  // test below started mutating pendingHydrationNamespaces/hydratedNamespaces;
  // reset the touched fields so state doesn't leak between tests.
  useEditorStore.setState({ pendingHydrationNamespaces: [], hydratedNamespaces: [], hydrationNonce: 0 });
  useInstanceStore.setState({
    instances: {},
    validationErrors: {},
    validationStatus: {},
    schemas: new Map(),
    schemaErrors: new Map()
  });
});

import {
  usePreviewSessionFactory,
  type PreviewSessionFactory
} from '../../../src/shell/providers/preview-session-context.js';
import { CodegenProvider } from '../../../src/shell/providers/CodegenProvider.js';
import { WorkspaceStateContext, type WorkspaceState } from '../../../src/shell/providers/workspace-context.js';
import { useInstanceStore } from '../../../src/store/instance-store.js';
import { usePreviewStore } from '../../../src/store/preview-store.js';
import { useOutputStore } from '../../../src/store/output-store.js';
import { useEditorStore } from '@rune-langium/visual-editor';

function wsState(id: string): WorkspaceState {
  return {
    workspaceId: id,
    workspaceKind: 'browser-only',
    workspaceName: id,
    fileCount: 1,
    files: [{ name: 'a.rosetta', path: 'a.rosetta', content: 'namespace a', dirty: false }],
    models: [],
    parsedModels: [],
    deferredExports: [],
    parseErrors: new Map()
  };
}

describe('CodegenProvider', () => {
  it('creates exactly ONE worker and re-posts setFiles across a workspace switch (single owner, P2)', () => {
    function Host() {
      const [id, setId] = useState('ws-A');
      return (
        <WorkspaceStateContext.Provider value={wsState(id)}>
          <button onClick={() => setId('ws-B')}>switch</button>
          <CodegenProvider>
            <div />
          </CodegenProvider>
        </WorkspaceStateContext.Provider>
      );
    }
    render(<Host />);
    expect(FakeWorker.instances.length).toBe(1);
    const before = FakeWorker.instances[0].posted.filter((m) => m.type === 'codegen:setFiles').length;
    act(() => document.querySelector('button')!.click());
    expect(FakeWorker.instances.length).toBe(1); // NOT re-created on switch
    const after = FakeWorker.instances[0].posted.filter((m) => m.type === 'codegen:setFiles').length;
    expect(after).toBeGreaterThan(before); // re-posted on model change
  });

  it('routes an instance:generateSchemaResult matching an instance-store pending schema request to instance-store, on its own channel from usePreviewStore (finding #6/#7)', () => {
    render(
      <WorkspaceStateContext.Provider value={wsState('ws-A')}>
        <CodegenProvider>
          <div />
        </CodegenProvider>
      </WorkspaceStateContext.Provider>
    );

    const worker = FakeWorker.instances[0]!;
    act(() => {
      useInstanceStore.getState().dispatchGenerateSchema('test.instance.Party');
    });
    const schemaRequest = worker.posted.find(
      (m) => m.type === 'instance:generateSchema' && m.typeFqn === 'test.instance.Party'
    );
    expect(schemaRequest?.requestId.startsWith('schema:')).toBe(true);
    // Confirms this request never touches preview:generate at all — the
    // whole point of finding #6/#7's fix.
    expect(worker.posted.some((m) => m.type === 'preview:generate' && m.targetId === 'test.instance.Party')).toBe(
      false
    );

    const schema = {
      schemaVersion: 1,
      targetId: 'test.instance.Party',
      title: 'Party',
      status: 'ready',
      fields: []
    };

    act(() => {
      for (const listener of worker.listeners['message'] ?? []) {
        listener({
          data: { type: 'instance:generateSchemaResult', requestId: schemaRequest.requestId, schema }
        });
      }
    });

    expect(useInstanceStore.getState().schemas.get('test.instance.Party')).toEqual(schema);
    expect(usePreviewStore.getState().schemas.has('test.instance.Party')).toBe(false);
  });

  it('routes an instance:generateSchemaStale response to instance-store schemaErrors (finding #7)', () => {
    useInstanceStore.setState({ schemaErrors: new Map() });
    render(
      <WorkspaceStateContext.Provider value={wsState('ws-A')}>
        <CodegenProvider>
          <div />
        </CodegenProvider>
      </WorkspaceStateContext.Provider>
    );

    const worker = FakeWorker.instances[0]!;
    act(() => {
      useInstanceStore.getState().dispatchGenerateSchema('test.instance.Unsupported');
    });
    const schemaRequest = worker.posted.find(
      (m) => m.type === 'instance:generateSchema' && m.typeFqn === 'test.instance.Unsupported'
    );

    act(() => {
      for (const listener of worker.listeners['message'] ?? []) {
        listener({
          data: {
            type: 'instance:generateSchemaStale',
            requestId: schemaRequest.requestId,
            reason: 'unsupported-target',
            message: 'No form preview schema is available for test.instance.Unsupported.'
          }
        });
      }
    });

    expect(useInstanceStore.getState().schemaErrors.get('test.instance.Unsupported')).toEqual({
      reason: 'unsupported-target',
      message: 'No form preview schema is available for test.instance.Unsupported.'
    });
  });

  it('waits for this instance file-sync receipt before requesting schema and validation', async () => {
    render(
      <WorkspaceStateContext.Provider value={wsState('ws-instance-ready')}>
        <CodegenProvider>
          <div />
        </CodegenProvider>
      </WorkspaceStateContext.Provider>
    );

    const worker = FakeWorker.instances[0]!;
    const id = useInstanceStore.getState().createInstance('user.missing.Type', 'Missing type');
    await act(async () => {
      await Promise.resolve();
    });
    const fileRequest = worker.posted.filter((message) => message.type === 'preview:setFiles').at(-1)!;
    expect(worker.posted.some((message) => message.type === 'instance:generateSchema')).toBe(false);

    act(() => {
      for (const listener of worker.listeners.message ?? []) {
        listener({
          data: {
            type: 'preview:files-ready',
            requestId: fileRequest.requestId,
            filesRevision: fileRequest.filesRevision
          }
        });
      }
    });

    await vi.waitFor(() => {
      const types = worker.posted.map((message) => message.type);
      expect(types).toContain('instance:generateSchema');
      expect(types).toContain('instance:validate');
    });
    expect(useInstanceStore.getState().validationStatus[id]).toBe('pending');
  });

  it('does not hydrate a user type that the parse response also lists as a deferred export', async () => {
    const workspace = {
      ...wsState('ws-user-export'),
      deferredExports: [{ filePath: 'a.rosetta', namespace: 'a', exports: [{ type: 'Data', name: 'Type' }] }]
    };
    render(
      <WorkspaceStateContext.Provider value={workspace}>
        <CodegenProvider>
          <div />
        </CodegenProvider>
      </WorkspaceStateContext.Provider>
    );

    const worker = FakeWorker.instances[0]!;
    const id = useInstanceStore.getState().createInstance('a.Type', 'User type');
    await vi.waitFor(() => {
      expect(worker.posted.filter((message) => message.type === 'preview:setFiles').length).toBeGreaterThan(1);
    });
    expect(useEditorStore.getState().pendingHydrationNamespaces).toEqual([]);

    const fileRequest = worker.posted.filter((message) => message.type === 'preview:setFiles').at(-1)!;
    act(() => {
      for (const listener of worker.listeners.message ?? []) {
        listener({
          data: {
            type: 'preview:files-ready',
            requestId: fileRequest.requestId,
            filesRevision: fileRequest.filesRevision
          }
        });
      }
    });
    await vi.waitFor(() => {
      expect(worker.posted).toContainEqual(
        expect.objectContaining({ type: 'instance:generateSchema', typeFqn: 'a.Type' })
      );
      expect(worker.posted).toContainEqual(expect.objectContaining({ type: 'instance:validate', typeFqn: 'a.Type' }));
    });
    expect(useInstanceStore.getState().validationStatus[id]).toBe('pending');
  });

  it('rejects a receipt whose revision does not match the dispatched instance file snapshot', async () => {
    render(
      <WorkspaceStateContext.Provider value={wsState('ws-revision-mismatch')}>
        <CodegenProvider>
          <div />
        </CodegenProvider>
      </WorkspaceStateContext.Provider>
    );

    const worker = FakeWorker.instances[0]!;
    const id = useInstanceStore.getState().createInstance('user.missing.Type', 'Missing type');
    await act(async () => {
      await Promise.resolve();
    });
    const fileRequest = worker.posted.filter((message) => message.type === 'preview:setFiles').at(-1)!;

    await act(async () => {
      for (const listener of worker.listeners.message ?? []) {
        listener({
          data: {
            type: 'preview:files-ready',
            requestId: fileRequest.requestId,
            filesRevision: fileRequest.filesRevision + 1
          }
        });
      }
      await Promise.resolve();
    });

    expect(worker.posted.some((message) => message.type === 'instance:generateSchema')).toBe(false);
    expect(worker.posted.some((message) => message.type === 'instance:validate')).toBe(false);
    await vi.waitFor(() => expect(useInstanceStore.getState().validationStatus[id]).toBe('unavailable'));
    expect(useInstanceStore.getState().schemaErrors.get('user.missing.Type')?.message).toContain('expected');
  });

  it('rejects pending instance file-sync waiters when the worker crashes', async () => {
    render(
      <WorkspaceStateContext.Provider value={wsState('ws-worker-crash')}>
        <CodegenProvider>
          <div />
        </CodegenProvider>
      </WorkspaceStateContext.Provider>
    );

    const worker = FakeWorker.instances[0]!;
    const id = useInstanceStore.getState().createInstance('user.missing.Type', 'Missing type');
    await act(async () => {
      await Promise.resolve();
    });
    expect(worker.posted.some((message) => message.type === 'preview:setFiles')).toBe(true);

    await act(async () => {
      for (const listener of worker.listeners.error ?? []) {
        listener({ type: 'error', message: 'worker crashed' });
      }
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(useInstanceStore.getState().validationStatus[id]).toBe('unavailable'));
    expect(useInstanceStore.getState().schemaErrors.get('user.missing.Type')?.message).toContain(
      'Preview worker crashed'
    );
    const postedBeforeRetry = worker.posted.length;
    useInstanceStore.getState().retryInstance(id);
    await act(async () => {
      await Promise.resolve();
    });
    expect(worker.posted).toHaveLength(postedBeforeRetry);
  });

  it('does not synchronize a hydrated instance until the hydrated workspace files commit', async () => {
    let commitHydratedFiles: (() => void) | undefined;
    function Host() {
      const [workspace, setWorkspace] = useState<WorkspaceState>({
        ...wsState('ws-hydration-commit'),
        deferredExports: [
          {
            filePath: 'curated/bundle.rosetta',
            namespace: 'curated',
            exports: [
              { type: 'data', name: 'Address' },
              { type: 'data', name: 'Country' }
            ]
          }
        ]
      });
      commitHydratedFiles = () =>
        setWorkspace((current) => ({
          ...current,
          files: [
            ...current.files,
            {
              name: 'address.rosetta',
              path: 'curated/address.rosetta',
              content: 'namespace curated',
              dirty: false,
              namespace: 'curated',
              serializedModelJson: '{}'
            }
          ]
        }));
      return (
        <WorkspaceStateContext.Provider value={workspace}>
          <CodegenProvider>
            <div />
          </CodegenProvider>
        </WorkspaceStateContext.Provider>
      );
    }

    render(<Host />);
    const worker = FakeWorker.instances[0]!;
    await act(async () => {
      useInstanceStore.getState().createInstance('curated.Address', 'Address');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useEditorStore.getState().pendingHydrationNamespaces).toContain('curated');
    const beforeHydration = worker.posted.filter((message) => message.type === 'preview:setFiles').length;

    act(() => {
      useEditorStore.getState().markNamespacesHydrated(['curated']);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(worker.posted.filter((message) => message.type === 'preview:setFiles')).toHaveLength(beforeHydration);

    // A second target in this namespace starts after the nonce-only React commit,
    // while App still exposes the old files. It must wait for definitions too.
    await act(async () => {
      useInstanceStore.getState().createInstance('curated.Country', 'Country');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(worker.posted.filter((message) => message.type === 'preview:setFiles')).toHaveLength(beforeHydration);

    act(() => commitHydratedFiles?.());
    await act(async () => {
      await Promise.resolve();
    });
    const hydratedRequest = worker.posted.filter((message) => message.type === 'preview:setFiles').at(-1)!;
    expect(hydratedRequest.files.some((file: { uri: string }) => file.uri.endsWith('/curated/address.rosetta'))).toBe(
      true
    );
  });

  it.each([true, false])(
    'acknowledges committed dependency files without a new file update (already hydrated: %s)',
    async (alreadyHydrated) => {
      useEditorStore.setState({
        hydratedNamespaces: alreadyHydrated ? ['curated'] : [],
        pendingHydrationNamespaces: []
      });
      const workspace: WorkspaceState = {
        ...wsState('ws-already-hydrated'),
        files: [
          ...wsState('ws-already-hydrated').files,
          {
            name: 'address.rosetta',
            path: 'curated/address.rosetta',
            content: 'namespace curated',
            dirty: false,
            namespace: 'curated',
            bundleId: 'cdm',
            serializedModelJson: '{}'
          }
        ],
        deferredExports: [
          {
            filePath: 'curated/bundle.rosetta',
            namespace: 'curated',
            exports: [{ type: 'data', name: 'Address' }]
          }
        ]
      };
      render(
        <WorkspaceStateContext.Provider value={workspace}>
          <CodegenProvider>
            <div />
          </CodegenProvider>
        </WorkspaceStateContext.Provider>
      );

      const worker = FakeWorker.instances[0]!;
      const initialRequest = worker.posted.filter((message) => message.type === 'preview:setFiles').at(-1)!;
      act(() => {
        for (const listener of worker.listeners.message ?? []) {
          listener({
            data: {
              type: 'preview:files-ready',
              requestId: initialRequest.requestId,
              filesRevision: initialRequest.filesRevision
            }
          });
        }
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      const beforePrepare = worker.posted.filter((message) => message.type === 'preview:setFiles').length;
      await act(async () => {
        useInstanceStore.getState().createInstance('curated.Address', 'Address');
        await Promise.resolve();
        await Promise.resolve();
      });
      if (!alreadyHydrated) {
        expect(useEditorStore.getState().pendingHydrationNamespaces).toContain('curated');
        await act(async () => {
          useEditorStore.getState().markNamespacesHydrated(['curated']);
        });
      }
      await vi.waitFor(() => {
        expect(worker.posted.filter((message) => message.type === 'preview:setFiles').length).toBeGreaterThan(
          beforePrepare
        );
      });
      expect(worker.posted.some((message) => message.type === 'instance:generateSchema')).toBe(false);
      const request = worker.posted.filter((message) => message.type === 'preview:setFiles').at(-1)!;
      await act(async () => {
        for (const listener of worker.listeners.message ?? [])
          listener({
            data: {
              type: 'preview:files-ready',
              requestId: request.requestId,
              filesRevision: request.filesRevision
            }
          });
      });
      await vi.waitFor(() =>
        expect(worker.posted).toContainEqual(
          expect.objectContaining({
            type: 'instance:generateSchema',
            typeFqn: 'curated.Address'
          })
        )
      );
    }
  );

  it('still routes an ordinary preview:result matching currentPreviewRequestIdRef to usePreviewStore', () => {
    usePreviewStore.getState().resetPreviewState();
    usePreviewStore.setState({
      selectedTargetId: 'test.preview.Trade',
      selectedTarget: { id: 'test.preview.Trade', namespace: 'test.preview', name: 'Trade', kind: 'data' }
    });

    render(
      <WorkspaceStateContext.Provider value={wsState('ws-B')}>
        <CodegenProvider>
          <div />
        </CodegenProvider>
      </WorkspaceStateContext.Provider>
    );

    const worker = FakeWorker.instances[0]!;
    const previewRequest = worker.posted.find(
      (m) => m.type === 'preview:generate' && m.targetId === 'test.preview.Trade'
    );
    expect(previewRequest).toBeDefined();

    const schema = {
      schemaVersion: 1,
      targetId: 'test.preview.Trade',
      title: 'Trade',
      status: 'ready',
      fields: []
    };

    act(() => {
      for (const listener of worker.listeners['message'] ?? []) {
        listener({
          data: { type: 'preview:result', targetId: schema.targetId, requestId: previewRequest.requestId, schema }
        });
      }
    });

    expect(usePreviewStore.getState().schemas.get('test.preview.Trade')).toEqual(schema);
  });

  it('logs an op-log error when the preview worker crashes, not just the preview panel status', () => {
    useOutputStore.setState({ lines: [] });
    render(
      <WorkspaceStateContext.Provider value={wsState('ws-crash')}>
        <CodegenProvider>
          <div />
        </CodegenProvider>
      </WorkspaceStateContext.Provider>
    );

    const worker = FakeWorker.instances[0]!;
    act(() => {
      for (const listener of worker.listeners['error'] ?? []) {
        listener({ type: 'error', message: 'boom' });
      }
    });

    const entry = useOutputStore.getState().lines.find((l) => l.op === 'preview');
    expect(entry).toBeDefined();
    expect(entry?.severity).toBe('error');
    expect(entry?.text).toContain('Preview worker crashed');
  });

  it('logs both the preview and codegen op-log entries for a single worker crash, since both listeners share one worker (Codex P2)', () => {
    // The shared codegenWorker has two independent 'error' listeners (the
    // preview channel's handleWorkerFailure and the codegen channel's
    // handleCodegenWorkerError) — a single native crash fires both. Both
    // op-log entries are legitimate (distinct channels), but only ONE
    // destructive toast should fire; handlePreviewWorkerFailure's `toast`
    // option is what prevents the duplicate (not directly observable here
    // since these tests don't wrap a StudioToastProvider — showToast is a
    // no-op — so this pins the op-log side of the fix).
    useOutputStore.setState({ lines: [] });
    render(
      <WorkspaceStateContext.Provider value={wsState('ws-crash-both')}>
        <CodegenProvider>
          <div />
        </CodegenProvider>
      </WorkspaceStateContext.Provider>
    );

    const worker = FakeWorker.instances[0]!;
    act(() => {
      for (const listener of worker.listeners['error'] ?? []) {
        listener({ type: 'error', message: 'boom' });
      }
    });

    const lines = useOutputStore.getState().lines;
    expect(lines.find((l) => l.op === 'preview')).toBeDefined();
    expect(lines.find((l) => l.text.includes('worker crashed'))).toBeDefined();
  });

  it('requests hydration and re-generates the failed target when a preview result reports an unresolved curated reference', async () => {
    usePreviewStore.getState().resetPreviewState();
    usePreviewStore.setState({
      selectedTargetId: 'Scheme',
      selectedTarget: { id: 'Scheme', namespace: 'fpml.consolidated.confirmation', name: 'Scheme', kind: 'data' }
    });

    const wsWithDeferredExports: WorkspaceState = {
      ...wsState('ws-hydrate'),
      deferredExports: [
        {
          filePath: 'fpml/consolidated/shared/bundle.rosetta',
          namespace: 'fpml.consolidated.shared',
          exports: [{ type: 'data', name: 'NormalizedString' }]
        }
      ]
    };

    render(
      <WorkspaceStateContext.Provider value={wsWithDeferredExports}>
        <CodegenProvider>
          <div />
        </CodegenProvider>
      </WorkspaceStateContext.Provider>
    );

    const worker = FakeWorker.instances[0]!;
    const generateMsg = worker.posted.find((m) => m.type === 'preview:generate' && m.targetId === 'Scheme');
    expect(generateMsg).toBeDefined();

    await act(async () => {
      for (const listener of worker.listeners['message'] ?? []) {
        listener({
          data: {
            type: 'preview:result',
            targetId: 'Scheme',
            requestId: generateMsg.requestId,
            schema: {
              schemaVersion: 1,
              kind: 'typeAlias',
              targetId: 'Scheme',
              title: 'Scheme',
              status: 'unsupported',
              fields: [],
              unsupportedFeatures: ['unresolved-reference:NormalizedString']
            }
          }
        });
      }
    });

    expect(useEditorStore.getState().pendingHydrationNamespaces).toContain('fpml.consolidated.shared');
    expect(usePreviewStore.getState().hydrationRetriesRemaining['Scheme']).toBe(4);

    await act(async () => {
      useEditorStore.getState().markNamespacesHydrated(['fpml.consolidated.shared']);
      // The retry is deliberately deferred by one macrotask (see
      // CodegenProvider's onRetry comment) — flush it here.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const generateMsgsAfter = worker.posted.filter((m) => m.type === 'preview:generate' && m.targetId === 'Scheme');
    expect(generateMsgsAfter.length).toBeGreaterThan(1);
    expect(generateMsgsAfter.at(-1)).not.toBe(generateMsg);

    // Finding 4: the retried preview:generate now resolves cleanly — the
    // mirrored hydrationRetriesRemaining store entry must be cleared, not
    // just orchestrator.markResolved() called internally.
    const retryRequest = generateMsgsAfter.at(-1)!;
    act(() => {
      for (const listener of worker.listeners['message'] ?? []) {
        listener({
          data: {
            type: 'preview:result',
            targetId: 'Scheme',
            requestId: retryRequest.requestId,
            schema: {
              schemaVersion: 1,
              kind: 'typeAlias',
              targetId: 'Scheme',
              title: 'Scheme',
              status: 'ready',
              fields: [],
              unsupportedFeatures: []
            }
          }
        });
      }
    });

    expect(usePreviewStore.getState().hydrationRetriesRemaining['Scheme']).toBeUndefined();
  });

  it('requests hydration for every name/namespace pair in one round without capping mid-loop, and spends only one attempt for the round (Finding 3)', () => {
    usePreviewStore.getState().resetPreviewState();
    usePreviewStore.setState({
      selectedTargetId: 'Scheme',
      selectedTarget: { id: 'Scheme', namespace: 'fpml.consolidated.confirmation', name: 'Scheme', kind: 'data' }
    });

    // MAX_HYDRATION_RETRIES_PER_TARGET is 5 — six simultaneously-unresolved
    // names in a single preview:result must not exhaust the budget mid-loop.
    const unresolvedNames = ['A', 'B', 'C', 'D', 'E', 'F'];
    const wsWithDeferredExports: WorkspaceState = {
      ...wsState('ws-hydrate-many'),
      deferredExports: unresolvedNames.map((name, i) => ({
        filePath: `fpml/consolidated/shared/bundle-${i}.rosetta`,
        namespace: `fpml.consolidated.shared.ns${i}`,
        exports: [{ type: 'data' as const, name }]
      }))
    };

    render(
      <WorkspaceStateContext.Provider value={wsWithDeferredExports}>
        <CodegenProvider>
          <div />
        </CodegenProvider>
      </WorkspaceStateContext.Provider>
    );

    const worker = FakeWorker.instances[0]!;
    const generateMsg = worker.posted.find((m) => m.type === 'preview:generate' && m.targetId === 'Scheme');
    expect(generateMsg).toBeDefined();

    act(() => {
      for (const listener of worker.listeners['message'] ?? []) {
        listener({
          data: {
            type: 'preview:result',
            targetId: 'Scheme',
            requestId: generateMsg.requestId,
            schema: {
              schemaVersion: 1,
              kind: 'typeAlias',
              targetId: 'Scheme',
              title: 'Scheme',
              status: 'unsupported',
              fields: [],
              unsupportedFeatures: unresolvedNames.map((name) => `unresolved-reference:${name}`)
            }
          }
        });
      }
    });

    for (let i = 0; i < unresolvedNames.length; i++) {
      expect(useEditorStore.getState().pendingHydrationNamespaces).toContain(`fpml.consolidated.shared.ns${i}`);
    }
    // Only ONE attempt spent for the whole round, not one per name.
    expect(usePreviewStore.getState().hydrationRetriesRemaining['Scheme']).toBe(4);
  });

  it('clears (not sets) hydrationRetriesRemaining when a retry round dispatches zero hydration requests for a genuinely unresolvable reference (final-review Critical fix)', () => {
    usePreviewStore.getState().resetPreviewState();
    usePreviewStore.setState({
      selectedTargetId: 'Scheme',
      selectedTarget: { id: 'Scheme', namespace: 'fpml.consolidated.confirmation', name: 'Scheme', kind: 'data' }
    });

    // deferredExports has no entry exporting `NotACuratedType` at all, so
    // findNamespacesForExport returns [] and no requestHydration call happens
    // for this round — a genuine typo / nonexistent type, not a deferred one.
    const wsWithDeferredExports: WorkspaceState = {
      ...wsState('ws-hydrate-unresolvable'),
      deferredExports: [
        {
          filePath: 'fpml/consolidated/shared/bundle.rosetta',
          namespace: 'fpml.consolidated.shared',
          exports: [{ type: 'data', name: 'NormalizedString' }]
        }
      ]
    };

    render(
      <WorkspaceStateContext.Provider value={wsWithDeferredExports}>
        <CodegenProvider>
          <div />
        </CodegenProvider>
      </WorkspaceStateContext.Provider>
    );

    const worker = FakeWorker.instances[0]!;
    const generateMsg = worker.posted.find((m) => m.type === 'preview:generate' && m.targetId === 'Scheme');
    expect(generateMsg).toBeDefined();

    act(() => {
      for (const listener of worker.listeners['message'] ?? []) {
        listener({
          data: {
            type: 'preview:result',
            targetId: 'Scheme',
            requestId: generateMsg.requestId,
            schema: {
              schemaVersion: 1,
              kind: 'typeAlias',
              targetId: 'Scheme',
              title: 'Scheme',
              status: 'unsupported',
              fields: [],
              unsupportedFeatures: ['unresolved-reference:NotACuratedType']
            }
          }
        });
      }
    });

    // No hydration was requested for this round — nothing to wait on.
    expect(useEditorStore.getState().pendingHydrationNamespaces).toEqual([]);
    // Must NOT be a positive number: that would show a permanent, never-
    // recovering "resolving..." spinner and hide the real diagnostic.
    expect(usePreviewStore.getState().hydrationRetriesRemaining['Scheme']).toBeUndefined();

    // Regression guard (follow-up Bug A): a zero-dispatch round must not
    // spend any of the target's beginRetryRound budget either — not just
    // leave the UI-facing mirror cleared. Fire TWO MORE zero-dispatch
    // rounds for the same target/typo, then a genuinely resolvable round,
    // and assert the resolvable round still has the FULL budget (minus the
    // one attempt it itself spends) — not drained by the earlier no-ops.
    for (let i = 0; i < 2; i++) {
      act(() => {
        for (const listener of worker.listeners['message'] ?? []) {
          listener({
            data: {
              type: 'preview:result',
              targetId: 'Scheme',
              requestId: generateMsg.requestId,
              schema: {
                schemaVersion: 1,
                kind: 'typeAlias',
                targetId: 'Scheme',
                title: 'Scheme',
                status: 'unsupported',
                fields: [],
                unsupportedFeatures: ['unresolved-reference:NotACuratedType']
              }
            }
          });
        }
      });
      expect(useEditorStore.getState().pendingHydrationNamespaces).toEqual([]);
      expect(usePreviewStore.getState().hydrationRetriesRemaining['Scheme']).toBeUndefined();
    }

    act(() => {
      for (const listener of worker.listeners['message'] ?? []) {
        listener({
          data: {
            type: 'preview:result',
            targetId: 'Scheme',
            requestId: generateMsg.requestId,
            schema: {
              schemaVersion: 1,
              kind: 'typeAlias',
              targetId: 'Scheme',
              title: 'Scheme',
              status: 'unsupported',
              fields: [],
              unsupportedFeatures: ['unresolved-reference:NormalizedString']
            }
          }
        });
      }
    });

    expect(useEditorStore.getState().pendingHydrationNamespaces).toContain('fpml.consolidated.shared');
    // If the 2 preceding zero-dispatch rounds had silently spent budget,
    // this would read <= 2 instead of 4 (one attempt spent for THIS round).
    expect(usePreviewStore.getState().hydrationRetriesRemaining['Scheme']).toBe(4);
  });

  it('skips a background hydration retry if the selected target has changed since the retry was scheduled (Finding 1)', async () => {
    usePreviewStore.getState().resetPreviewState();
    usePreviewStore.setState({
      selectedTargetId: 'Scheme',
      selectedTarget: { id: 'Scheme', namespace: 'fpml.consolidated.confirmation', name: 'Scheme', kind: 'data' }
    });

    const wsWithDeferredExports: WorkspaceState = {
      ...wsState('ws-hydrate-race'),
      deferredExports: [
        {
          filePath: 'fpml/consolidated/shared/bundle.rosetta',
          namespace: 'fpml.consolidated.shared',
          exports: [{ type: 'data', name: 'NormalizedString' }]
        }
      ]
    };

    render(
      <WorkspaceStateContext.Provider value={wsWithDeferredExports}>
        <CodegenProvider>
          <div />
        </CodegenProvider>
      </WorkspaceStateContext.Provider>
    );

    const worker = FakeWorker.instances[0]!;
    const generateMsg = worker.posted.find((m) => m.type === 'preview:generate' && m.targetId === 'Scheme');
    expect(generateMsg).toBeDefined();

    await act(async () => {
      for (const listener of worker.listeners['message'] ?? []) {
        listener({
          data: {
            type: 'preview:result',
            targetId: 'Scheme',
            requestId: generateMsg.requestId,
            schema: {
              schemaVersion: 1,
              kind: 'typeAlias',
              targetId: 'Scheme',
              title: 'Scheme',
              status: 'unsupported',
              fields: [],
              unsupportedFeatures: ['unresolved-reference:NormalizedString']
            }
          }
        });
      }
    });

    // User switches away from Scheme BEFORE the namespace hydrates — the
    // target-selection effect fires its own fresh preview:generate for the
    // newly-selected target here, which is the count we must not clobber.
    act(() => {
      usePreviewStore.setState({
        selectedTargetId: 'OtherTarget',
        selectedTarget: { id: 'OtherTarget', namespace: 'fpml.consolidated.confirmation', name: 'Other', kind: 'data' }
      });
    });
    const otherSelectionMsgs = worker.posted.filter(
      (m) => m.type === 'preview:generate' && m.targetId === 'OtherTarget'
    );
    expect(otherSelectionMsgs.length).toBe(1);

    await act(async () => {
      useEditorStore.getState().markNamespacesHydrated(['fpml.consolidated.shared']);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // The stale retry for Scheme must not have posted anything more, and
    // must not have clobbered currentPreviewRequestIdRef for OtherTarget.
    const schemeMsgsAfter = worker.posted.filter((m) => m.type === 'preview:generate' && m.targetId === 'Scheme');
    expect(schemeMsgsAfter.length).toBe(1);
    const otherSelectionMsgsAfter = worker.posted.filter(
      (m) => m.type === 'preview:generate' && m.targetId === 'OtherTarget'
    );
    expect(otherSelectionMsgsAfter.length).toBe(1);
  });
});

it('keeps an unsupported selected preview pending after namespace hydration until regeneration returns', () => {
  usePreviewStore.getState().resetPreviewState();
  const target = { id: 'selected.Trade', namespace: 'selected', name: 'Trade', kind: 'data' };
  usePreviewStore.getState().setAvailableTargets([target]);
  usePreviewStore.getState().selectTarget(target.id);
  render(
    <WorkspaceStateContext.Provider value={wsState('hydration-pending')}>
      <CodegenProvider>
        <div />
      </CodegenProvider>
    </WorkspaceStateContext.Provider>
  );
  const worker = FakeWorker.instances[0]!;
  const request = worker.posted.find((m) => m.type === 'preview:generate');
  act(() => {
    for (const listener of worker.listeners.message ?? [])
      listener({
        data: {
          type: 'preview:stale',
          requestId: request.requestId,
          targetId: target.id,
          reason: 'unsupported-target',
          message: 'No schema available.'
        }
      });
    useEditorStore.setState({ pendingHydrationNamespaces: ['selected'] });
  });
  expect(usePreviewStore.getState().status.state).toBe('unavailable');
  act(() => useEditorStore.getState().markNamespacesHydrated(['selected']));
  expect(useEditorStore.getState().pendingHydrationNamespaces).toEqual([]);
  expect(usePreviewStore.getState().status).toEqual({ state: 'waiting', targetId: target.id });
  act(() => {
    for (const listener of worker.listeners.message ?? [])
      listener({
        data: {
          type: 'preview:result',
          requestId: request.requestId,
          targetId: target.id,
          schema: { schemaVersion: 1, targetId: target.id, title: 'Trade', status: 'ready', fields: [] }
        }
      });
  });
  expect(usePreviewStore.getState().status).toEqual({ state: 'ready', targetId: target.id });
});

it('retains Prototype session factory and worker listeners across Explore selection', () => {
  let factory: PreviewSessionFactory | null = null;
  function ObserveFactory() {
    factory = usePreviewSessionFactory();
    return null;
  }
  render(
    <WorkspaceStateContext value={wsState('retained-workflow')}>
      <CodegenProvider>
        <ObserveFactory />
      </CodegenProvider>
    </WorkspaceStateContext>
  );
  const original = factory;
  const listener = FakeWorker.instances[0]!.listeners.message[0];
  expect(original).not.toBeNull();
  for (const id of ['test.Money#Data', 'test.AddMoney#RosettaFunction']) {
    act(() => usePreviewStore.setState({ selectedTargetId: id }));
    expect(factory).toBe(original);
    expect(FakeWorker.instances[0]!.listeners.message[0]).toBe(listener);
  }
});

it('keeps Explore validation and execution connected after a workspace data reset', () => {
  const { unmount } = render(
    <WorkspaceStateContext value={wsState('preview-reset')}>
      <CodegenProvider>
        <div />
      </CodegenProvider>
    </WorkspaceStateContext>
  );
  const worker = FakeWorker.instances[0]!;
  const listener = worker.listeners.message[0];
  const targetId = 'scratch.Widget#Data';
  act(() => {
    // Workspace transitions reset preview data without unmounting the worker owner.
    usePreviewStore.getState().resetPreviewState();
    usePreviewStore.getState().ensureSample(targetId, { quantity: 1.5 });
    usePreviewStore.getState().updateSampleValues(targetId, { quantity: 1.5 }, true);
    usePreviewStore.getState().dispatchValidate(targetId, { quantity: 1.5 });
    usePreviewStore.getState().dispatchExecute('scratch.Double', { x: 5 });
  });
  const validation = worker.posted.find((message) => message.type === 'instance:validate');
  const execution = worker.posted.find((message) => message.type === 'preview:execute');
  expect(validation).toMatchObject({ typeFqn: 'scratch.Widget', data: { quantity: 1.5 } });
  expect(execution).toMatchObject({ funcName: 'scratch.Double', inputs: { x: 5 } });
  act(() => {
    for (const callback of worker.listeners.message ?? []) {
      callback({
        data: {
          type: 'instance:validateResult',
          requestId: validation.requestId,
          diagnostics: [{ path: 'quantity', message: 'Expected an integer' }]
        }
      });
      callback({
        data: { type: 'preview:execute-result', requestId: execution.requestId, funcName: 'scratch.Double', output: 10 }
      });
    }
  });
  expect(usePreviewStore.getState().samples.get(targetId)).toMatchObject({
    validationPending: false,
    valid: false,
    errors: { quantity: 'Expected an integer' }
  });
  expect(usePreviewStore.getState().executionResults.get('scratch.Double')).toEqual({ output: 10 });
  expect(worker.listeners.message[0]).toBe(listener);
  expect(FakeWorker.instances).toHaveLength(1);
  unmount();
  const messages = worker.posted.length;
  usePreviewStore.getState().dispatchExecute('scratch.Double', { x: 6 });
  expect(worker.posted).toHaveLength(messages);
});

it.each(['manifest publication', 'workspace switch'] as const)(
  'hydrates from the live deferred manifest after %s without replacing Prototype sessions',
  async (change) => {
    usePreviewStore.getState().resetPreviewState();
    const targetId = 'example.Trade';
    usePreviewStore.setState({ selectedTargetId: targetId });
    let factory: PreviewSessionFactory | null = null;
    function ObserveFactory() {
      factory = usePreviewSessionFactory();
      return null;
    }
    const manifest = (namespace: string): WorkspaceState['deferredExports'] => [
      { namespace, filePath: `${namespace}.rosetta`, exports: [{ type: 'data', name: 'Party' }] }
    ];
    const view = (workspace: WorkspaceState) => (
      <WorkspaceStateContext value={workspace}>
        <CodegenProvider>
          <ObserveFactory />
        </CodegenProvider>
      </WorkspaceStateContext>
    );
    const initial = {
      ...wsState('before'),
      deferredExports: change === 'workspace switch' ? manifest('curated.old') : []
    };
    const { rerender } = render(view(initial));
    const worker = FakeWorker.instances[0]!;
    const originalFactory = factory;
    const originalListener = worker.listeners.message[0];
    rerender(
      view({
        ...initial,
        workspaceId: change === 'workspace switch' ? 'after' : 'before',
        deferredExports: manifest('curated.current')
      })
    );
    const request = worker.posted.filter((message) => message.type === 'preview:generate').at(-1)!;
    await act(async () => {
      for (const listener of worker.listeners.message ?? [])
        listener({
          data: {
            type: 'preview:result',
            targetId,
            requestId: request.requestId,
            schema: {
              schemaVersion: 1,
              kind: 'data',
              targetId,
              title: 'Trade',
              status: 'unsupported',
              fields: [],
              unsupportedFeatures: ['unresolved-reference:Party']
            }
          }
        });
    });
    expect(useEditorStore.getState().pendingHydrationNamespaces).toContain('curated.current');
    expect(useEditorStore.getState().pendingHydrationNamespaces).not.toContain('curated.old');
    expect(factory).toBe(originalFactory);
    expect(worker.listeners.message[0]).toBe(originalListener);
    await act(async () => {
      useEditorStore.getState().markNamespacesHydrated(['curated.current']);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const retry = worker.posted.filter((message) => message.type === 'preview:generate').at(-1)!;
    expect(retry.requestId).not.toBe(request.requestId);
    act(() => {
      for (const listener of worker.listeners.message ?? [])
        listener({
          data: {
            type: 'preview:result',
            targetId,
            requestId: retry.requestId,
            schema: { schemaVersion: 1, kind: 'data', targetId, title: 'Trade', status: 'ready', fields: [] }
          }
        });
    });
    expect(usePreviewStore.getState().status).toEqual({ state: 'ready', targetId });
    expect(usePreviewStore.getState().hydrationRetriesRemaining[targetId]).toBeUndefined();
    expect(factory).toBe(originalFactory);
  }
);
