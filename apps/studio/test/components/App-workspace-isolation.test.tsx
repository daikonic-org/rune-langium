// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEditorStore } from '@rune-langium/visual-editor';
import { App } from '../../src/App.js';
import { useModelStore } from '../../src/store/model-store.js';
import { usePreviewStore } from '../../src/store/preview-store.js';
import { useCodegenStore } from '../../src/store/codegen-store.js';
import { useActivityStore } from '../../src/store/activity-store.js';
import { useOutputStore } from '../../src/store/output-store.js';
import { getModelSource } from '../../src/services/model-registry.js';
import type { LoadedModel } from '../../src/types/model-types.js';
import { _resetForTests, listRecents, loadWorkspace, saveWorkspace } from '../../src/workspace/persistence.js';
import * as persistence from '../../src/workspace/persistence.js';
import { loadWorkspaceFiles, saveWorkspaceFiles, setWorkspaceFilesDeps } from '../../src/workspace/workspace-files.js';
import * as workspaceFiles from '../../src/workspace/workspace-files.js';
import { OpfsFs } from '../../src/opfs/opfs-fs.js';
import { createOpfsRoot } from '../setup/opfs-mock.js';
import { deferredCuratedWorker } from '../setup/deferred-curated-worker.js';
import { curatedArtifactCache } from '../../src/services/curated-artifact-cache.js';
import {
  _resetParserWorkerForTests,
  linkDocument,
  parseWorkspaceViaRouter,
  resetCuratedDocumentCache,
  subscribeCuratedCacheRecovery
} from '../../src/services/workspace.js';

const { parseMock } = vi.hoisted(() => ({ parseMock: vi.fn() }));
vi.mock('../../src/services/workspace.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/workspace.js')>()),
  parseWorkspaceFiles: parseMock
}));
vi.mock('../../src/services/transport-provider.js', () => ({
  createTransportProvider: () => ({ onStateChange: () => () => {}, dispose: () => {} })
}));
vi.mock('../../src/services/lsp-client.js', async () => {
  const { createLspClientStub } = await import('../helpers/lsp-client-stub.js');
  return { createLspClientService: createLspClientStub };
});
vi.mock('../../src/components/StudioToastProvider.js', () => ({
  StudioToastProvider: ({ children }: { children?: ReactNode }) => children,
  useStudioToast: () => ({ showToast: vi.fn(), showLoadingToast: vi.fn(() => 'loading'), dismissToast: vi.fn() })
}));
vi.mock('../../src/shell/ExplorePerspective.js', async () => {
  const { useEffect, useMemo, useState } = await import('react');
  const { GitHubWorkspaceFlow } = await import('../../src/components/GitHubWorkspaceFlow.js');
  const { DataTypeForm, useModelSourceSync, createEditorCommitRegistry } = await import('@rune-langium/visual-editor');
  const { useWorkspace } = await import('../../src/shell/providers/workspace-context.js');
  const { useWorkspaceActions } = await import('../../src/shell/perspectives/workspace-actions-context.js');
  function CloneReviewProbe() {
    const actions = useWorkspaceActions();
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Start clone review</button>
        {open && (
          <GitHubWorkspaceFlow
            authBase="https://auth.example"
            createWorkspace={actions.createGitBackedWorkspace}
            openProjectInitialization={actions.openProjectInitialization}
            onCreated={actions.onGitHubWorkspaceCreated}
            onCancel={() => setOpen(false)}
          />
        )}
      </>
    );
  }
  function InspectorFlushProbe() {
    const { files, models } = useWorkspace();
    useEffect(() => {
      if (
        models.some((model) => model.elements?.some((element) => element.$type === 'Data' && element.name === 'Person'))
      )
        useEditorStore.getState().loadModels(models);
    }, [models]);
    const { onFilesChange, registerEditorSaveBarrier } = useWorkspaceActions();
    const state = useEditorStore();
    const node = state.nodes.find((node) => node.data.name === 'Person');
    const registry = useMemo(createEditorCommitRegistry, []);
    const baseline = new Map([['project.a', files.find((file) => file.path === 'trade.rosetta')?.content ?? '']]);
    const source = useModelSourceSync(
      state.nodes,
      state.edges,
      (serialized) => {
        const content = serialized.get('project.a');
        if (content !== undefined)
          onFilesChange(
            files.map((file) => (file.path === 'trade.rosetta' ? { ...file, content, dirty: true } : file))
          );
      },
      state.parseEpoch,
      state.pendingEditPatches,
      baseline,
      state.pendingInversePatches
    );
    useEffect(
      () =>
        registerEditorSaveBarrier?.(async () => {
          registry.flush();
          const latest = useEditorStore.getState();
          await source.flush({
            nodes: latest.nodes,
            edges: latest.edges,
            parseEpoch: latest.parseEpoch,
            patches: latest.pendingEditPatches,
            inversePatches: latest.pendingInversePatches
          });
        }),
      [registerEditorSaveBarrier, registry, source.flush]
    );
    return node ? (
      <DataTypeForm
        nodeId={node.id}
        data={node.data}
        meta={node.meta}
        actions={state}
        availableTypes={[]}
        registerCommitFlush={registry.register}
      />
    ) : null;
  }
  return {
    ExplorePerspective: () => {
      const { files, deferredExports } = useWorkspace();
      const { onCreateWorkspace, onClose, onFilesChange, onGitHubWorkspaceCreated } = useWorkspaceActions();
      const { workspaceId } = useWorkspace();
      return (
        <div>
          <InspectorFlushProbe />
          <CloneReviewProbe />
          <span data-testid="workspace-id">{workspaceId}</span>
          <button onClick={() => void onGitHubWorkspaceCreated('empty-clone')}>Open POM-only clone</button>
          <span data-testid="files">{files.map((file) => file.path).join(',')}</span>
          <span data-testid="trade-content">{files.find((file) => file.path === 'trade.rosetta')?.content}</span>
          <span data-testid="deferred">{deferredExports.map((entry) => entry.namespace).join(',')}</span>
          <button onClick={onCreateWorkspace}>Create workspace</button>
          <button onClick={onClose}>Close from test</button>
          <button
            onClick={() =>
              onFilesChange(
                files.map((file) =>
                  file.path === 'trade.rosetta' ? { ...file, content: 'namespace project.edited\n', dirty: true } : file
                )
              )
            }
          >
            Edit from test
          </button>
        </div>
      );
    }
  };
});

const sourceFiles = [{ name: 'trade.rosetta', path: 'trade.rosetta', content: 'namespace project.a\n', dirty: false }];
const blankFiles = [{ name: 'blank.rosetta', path: 'blank.rosetta', content: 'namespace example\n', dirty: false }];
const emptyParse = () => ({ models: [], parsedModels: [], errors: new Map(), deferredExports: [] });

beforeEach(async () => {
  parseMock.mockReset().mockImplementation(async () => emptyParse());
  useModelStore.setState({ models: new Map(), loading: new Map(), errors: new Map() });
  useEditorStore.getState().loadDeferredExports([]);
  useEditorStore.getState().loadModels([]);
  usePreviewStore.getState().resetPreviewState();
  useCodegenStore.getState().resetCodegenState();
  const opfsRoot = createOpfsRoot();
  setWorkspaceFilesDeps({ getOpfsRoot: async () => opfsRoot as unknown as FileSystemDirectoryHandle });
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { getDirectory: vi.fn().mockResolvedValue(opfsRoot) }
  });
  await _resetForTests();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('rune-studio');
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
  const now = new Date().toISOString();
  await saveWorkspace({
    id: 'ws-a',
    name: 'Source project',
    kind: 'browser-only',
    createdAt: now,
    lastOpenedAt: now,
    layout: { version: 1, writtenBy: 'test', dockview: null },
    tabs: [],
    activeTabPath: null,
    curatedModels: [],
    schemaVersion: 1
  });
  await saveWorkspaceFiles('ws-a', sourceFiles);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.__runeStudioTestApi;
  useModelStore.setState({ models: new Map(), loading: new Map(), errors: new Map() });
  setWorkspaceFilesDeps({
    getOpfsRoot: async () => {
      throw new Error('test ended');
    }
  });
});

async function openSourceWorkspace() {
  render(<App />);
  await waitFor(() => expect(screen.getByTestId('files')).toHaveTextContent('trade.rosetta'));
  const cdm: LoadedModel = {
    source: getModelSource('cdm')!,
    commitHash: 'latest',
    loadedAt: Date.now(),
    files: [{ path: 'event-common-type.rosetta', content: 'namespace cdm.event.common\n' }]
  };
  const custom: LoadedModel = {
    source: {
      id: 'custom',
      name: 'Custom',
      repoUrl: 'https://example.com/model.git',
      ref: 'main',
      paths: ['*.rosetta']
    },
    commitHash: 'test',
    loadedAt: Date.now(),
    files: [{ path: 'copied.rosetta', content: 'namespace copied.cdm\n' }]
  };
  await act(async () =>
    useModelStore.setState({
      models: new Map([
        ['cdm', cdm],
        ['custom', custom]
      ])
    })
  );
  await waitFor(() => expect(screen.getByTestId('files')).toHaveTextContent('[custom]/copied.rosetta'));
  await waitFor(async () =>
    expect((await loadWorkspace('ws-a'))?.curatedModels?.map((b) => b.modelId)).toEqual(['cdm'])
  );
}

it.each([false, true])(
  'flushes pending canonical Inspector metadata before close, with storage failure=%s',
  async (failStorage) => {
    const { parse } = await import('@rune-langium/core');
    const content = 'namespace project.a\nversion "1"\ntype Person:\n  name string (1..1)\n';
    await saveWorkspaceFiles('ws-a', [{ ...sourceFiles[0]!, content }]);
    parseMock.mockImplementation(async (files) => {
      const file = files.find((file: { path: string }) => file.path === 'trade.rosetta');
      if (!file) return emptyParse();
      const parsed = await parse(file.content);
      return {
        models: [parsed.value],
        parsedModels: [{ filePath: file.path, model: parsed.value, source: file.content }],
        errors: new Map(),
        deferredExports: []
      };
    });
    const write = workspaceFiles.saveWorkspaceFiles;
    const save = vi.spyOn(workspaceFiles, 'saveWorkspaceFiles');
    render(<App />);
    await screen.findByLabelText('Data type name');
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
    fireEvent.change(screen.getByLabelText('Definition'), { target: { value: 'Saved from pending Inspector timer' } });
    expect(
      useEditorStore.getState().nodes.find((node) => node.data.name === 'Person')?.data.definition
    ).toBeUndefined();
    if (failStorage) save.mockRejectedValue(new Error('quota'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Close from test' })));
    if (failStorage) {
      await waitFor(() => expect(save).toHaveBeenCalled());
      expect(screen.getByRole('button', { name: /Workspace menu — .*Source project/ })).toBeVisible();
      expect((await loadWorkspaceFiles('ws-a'))[0]?.content).toBe(content);
      save.mockImplementation(write);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Close from test' })));
    }
    await screen.findByRole('button', { name: 'New workspace' });
    expect((await loadWorkspaceFiles('ws-a')).find((file) => file.path === 'trade.rosetta')?.content).toContain(
      'Saved from pending Inspector timer'
    );
  }
);

describe('workspace isolation', () => {
  it('records an autosave failure once in each history with one operation id', async () => {
    vi.spyOn(workspaceFiles, 'saveWorkspaceFiles').mockRejectedValue(new Error('Quota exceeded'));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('files')).toHaveTextContent('trade.rosetta'));
    useActivityStore.getState().clearEntries();
    useOutputStore.getState().clearLines();
    fireEvent.click(screen.getByRole('button', { name: 'Edit from test' }));
    await waitFor(() => {
      const activity = useActivityStore
        .getState()
        .entries.filter((entry) => entry.msg.includes('edits remain in memory'));
      const output = useOutputStore.getState().lines.filter((entry) => entry.text.includes('edits remain in memory'));
      expect(activity).toHaveLength(1);
      expect(output).toHaveLength(1);
      expect(activity[0].opId).toBeDefined();
      expect(output[0].opId).toBe(activity[0].opId);
      expect(output[0].text).toContain('Quota exceeded');
    });
  });
  it.each(['close', 'reset', 'switch', 'replace'] as const)(
    'preserves an unsaved draft when %s fails to flush, then saves it on retry',
    async (transition) => {
      const original = (await loadWorkspace('ws-a'))!;
      await saveWorkspace({ ...original, id: 'ws-b', name: 'Other', lastOpenedAt: '2000-01-01T00:00:00Z' });
      await saveWorkspaceFiles('ws-b', blankFiles);
      const write = workspaceFiles.saveWorkspaceFiles;
      const save = vi.spyOn(workspaceFiles, 'saveWorkspaceFiles');
      render(<App />);
      await waitFor(() => expect(screen.getByTestId('files')).toHaveTextContent('trade.rosetta'));
      save.mockRejectedValue(new Error('quota'));
      fireEvent.click(screen.getByRole('button', { name: 'Edit from test' }));
      const attempt = async () => {
        if (transition === 'close' || transition === 'reset') {
          fireEvent.click(
            screen.getByRole('button', { name: transition === 'close' ? 'Close from test' : 'Create workspace' })
          );
        } else if (transition === 'switch') {
          await window.__runeStudioTestApi!.switchWorkspace!('ws-b');
        } else {
          await window.__runeStudioTestApi!.loadFiles!(blankFiles);
        }
      };
      await act(attempt);
      await waitFor(() => expect(save).toHaveBeenCalled());
      expect(screen.getByTestId('trade-content')).toHaveTextContent('namespace project.edited');
      expect(screen.getByRole('button', { name: /Workspace menu — .*Source project/ })).toBeVisible();
      expect(await loadWorkspaceFiles('ws-a')).toEqual(sourceFiles);
      expect(await listRecents()).toHaveLength(2);

      save.mockImplementation(write);
      await act(attempt);
      if (transition === 'close' || transition === 'reset') {
        await waitFor(() => expect(screen.getByRole('button', { name: 'New workspace' })).toBeVisible());
      } else {
        expect(screen.getByTestId('files')).toHaveTextContent('blank.rosetta');
      }
      const persisted = await loadWorkspaceFiles('ws-a');
      expect(persisted.find((file) => file.path === 'trade.rosetta')?.content).toBe('namespace project.edited\n');
    }
  );

  it('lets a newer close supersede a workspace switch still waiting for storage', async () => {
    const original = (await loadWorkspace('ws-a'))!;
    await saveWorkspace({ ...original, id: 'ws-b', name: 'Other', lastOpenedAt: '2000-01-01T00:00:00Z' });
    await saveWorkspaceFiles('ws-b', blankFiles);
    const write = workspaceFiles.saveWorkspaceFiles;
    const save = vi.spyOn(workspaceFiles, 'saveWorkspaceFiles');
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('files')).toHaveTextContent('trade.rosetta'));
    const gate = Promise.withResolvers<void>();
    save.mockImplementationOnce(async (id, files) => {
      await gate.promise;
      await write(id, files);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit from test' }));
    let switching!: Promise<void>;
    await act(async () => {
      switching = window.__runeStudioTestApi!.switchWorkspace!('ws-b');
    });
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(screen.getByTestId('trade-content')).toHaveTextContent('namespace project.edited');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Close from test' })));
    await act(async () => {
      gate.resolve();
      await switching;
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'New workspace' })).toBeVisible());
    expect((await loadWorkspaceFiles('ws-a')).find((file) => file.path === 'trade.rosetta')?.content).toBe(
      'namespace project.edited\n'
    );
  });

  it('carries launcher selections into a pre-created Git-backed target without creating a duplicate', async () => {
    await persistence.deleteWorkspace('ws-a');
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'New workspace' })).toBeVisible());
    await act(async () => useModelStore.getState().load(getModelSource('rune-dsl')!));
    const now = new Date().toISOString();
    await saveWorkspace({
      id: 'ws-git-created',
      name: 'Git project',
      kind: 'git-backed',
      createdAt: now,
      lastOpenedAt: now,
      layout: { version: 1, writtenBy: 'test', dockview: null },
      tabs: [],
      activeTabPath: null,
      curatedModels: [],
      schemaVersion: 1,
      gitBacking: {
        repoUrl: 'https://example.com/project.git',
        branch: 'main',
        user: 'tester',
        tokenPath: '/token',
        syncState: 'clean',
        lastSyncedSha: null
      }
    });
    await act(async () => window.__runeStudioTestApi!.loadFiles!(blankFiles, 'ws-git-created'));
    expect(useModelStore.getState().models.has('rune-dsl')).toBe(true);
    expect((await loadWorkspace('ws-git-created'))?.curatedModels?.map((b) => b.modelId)).toContain('rune-dsl');
    expect(await listRecents()).toHaveLength(1);
    expect(await loadWorkspaceFiles('ws-git-created')).toEqual(blankFiles);
  });
  it('adds a curated model loaded after creating a blank workspace to its catalog and saved bindings', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('files')).toHaveTextContent('trade.rosetta'));
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    fireEvent.click(await screen.findByRole('button', { name: 'New workspace' }));
    await waitFor(() => expect(screen.getByTestId('files')).toHaveTextContent('untitled.rosetta'));
    parseMock.mockImplementation(async () => ({
      ...emptyParse(),
      deferredExports: [
        {
          filePath: '[cdm]/event.rosetta',
          namespace: 'cdm.event.common',
          exports: [{ type: 'Data', name: 'Event' }]
        }
      ]
    }));
    await act(async () => useModelStore.getState().load(getModelSource('cdm')!));
    await waitFor(() => expect(screen.getByTestId('deferred')).toHaveTextContent('cdm.event.common'));
    const workspace = (await listRecents())[0]!;
    await waitFor(async () =>
      expect((await loadWorkspace(workspace.id))?.curatedModels?.map((b) => b.modelId)).toContain('cdm')
    );
  });
  it('keeps curated models selected on the launcher when creating a new blank workspace', async () => {
    await _resetForTests();
    await persistence.deleteWorkspace('ws-a');
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'New workspace' })).toBeVisible());
    await act(async () => useModelStore.getState().load(getModelSource('rune-dsl')!));
    await waitFor(() => expect(useModelStore.getState().models.has('rune-dsl')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    await waitFor(() => expect(screen.getByTestId('files')).toHaveTextContent('.rosetta'));
    expect(useModelStore.getState().models.has('rune-dsl')).toBe(true);
    const workspace = (await listRecents())[0]!;
    await waitFor(async () =>
      expect((await loadWorkspace(workspace.id))?.curatedModels?.map((b) => b.modelId)).toContain('rune-dsl')
    );
  });
  it('launcher loads only the new files and preserves the previous workspace on disk', async () => {
    await openSourceWorkspace();
    await act(async () => window.__runeStudioTestApi!.loadFiles!(blankFiles));
    expect(useModelStore.getState().models.size).toBe(0);
    expect(screen.getByTestId('files')).toHaveTextContent('blank.rosetta');
    expect(screen.getByTestId('files')).not.toHaveTextContent('trade.rosetta');
    expect(screen.getByTestId('files')).not.toHaveTextContent('[cdm]');
    expect(screen.getByTestId('files')).not.toHaveTextContent('[custom]');
    expect(await loadWorkspaceFiles('ws-a')).toEqual(sourceFiles);
    const created = (await listRecents()).find((workspace) => workspace.id !== 'ws-a')!;
    expect((await loadWorkspace(created.id))?.curatedModels).toEqual([]);
    expect(await loadWorkspaceFiles(created.id)).toEqual(blankFiles);
  });

  it('New workspace clears files, model bindings, selection and previews before returning to the launcher', async () => {
    await openSourceWorkspace();
    const deferred = [
      { filePath: '[cdm]/event.rosetta', namespace: 'cdm.event.common', exports: [{ type: 'Data', name: 'SpinOff' }] }
    ];
    useEditorStore.getState().loadDeferredExports(deferred);
    useEditorStore.getState().loadModels([]);
    useEditorStore.getState().selectNode('cdm.event.common.SpinOff#Data');
    usePreviewStore.setState({ selectedTargetId: 'cdm.event.common.SpinOff' });
    useCodegenStore.getState().setCodePreviewTarget('typescript');
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'New workspace' })).toBeVisible());
    expect(screen.queryByRole('button', { name: /Workspace menu/ })).not.toBeInTheDocument();
    expect(useModelStore.getState().models.size).toBe(0);
    expect(useEditorStore.getState().nodes).toEqual([]);
    expect(useEditorStore.getState().selectedNodeId).toBeNull();
    expect(usePreviewStore.getState().selectedTargetId).toBeUndefined();
    expect(useCodegenStore.getState().codePreviewTarget).toBe('zod');
    expect(await loadWorkspaceFiles('ws-a')).toEqual(sourceFiles);
  });

  it('Close workspace returns to the launcher without erasing the saved files', async () => {
    await openSourceWorkspace();
    fireEvent.click(screen.getByRole('button', { name: /Workspace menu — .*Source project/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Close Source project and return to start page' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'New workspace' })).toBeVisible());
    expect(useModelStore.getState().models.size).toBe(0);
    expect(await loadWorkspaceFiles('ws-a')).toEqual(sourceFiles);
    expect((await loadWorkspace('ws-a'))?.curatedModels?.map((binding) => binding.modelId)).toEqual(['cdm']);
  });

  it('opening an empty workspace clears the previous source and models', async () => {
    await openSourceWorkspace();
    const previous = (await loadWorkspace('ws-a'))!;
    await saveWorkspace({ ...previous, id: 'ws-empty', name: 'Empty', curatedModels: [] });
    await act(async () => window.__runeStudioTestApi!.switchWorkspace!('ws-empty'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'New workspace' })).toBeVisible());
    expect(screen.queryByRole('button', { name: /Workspace menu/ })).not.toBeInTheDocument();
    expect(useModelStore.getState().models.size).toBe(0);
    expect(await loadWorkspaceFiles('ws-a')).toEqual(sourceFiles);
  });

  it('switching to an empty workspace cancels a cached-link recovery without starting another parse', async () => {
    await openSourceWorkspace();
    const previous = (await loadWorkspace('ws-a'))!;
    await saveWorkspace({ ...previous, id: 'ws-empty', name: 'Empty', curatedModels: [] });
    const artifactKey = JSON.stringify([
      'cdm',
      'https://www.daikonic.dev/curated/cdm/artifacts/2026-10-10-aaaaaaaaaaaa/ns/cached.example.json.gz'
    ]);
    const document = {
      uri: 'cdm/example.rosetta',
      namespace: 'cached.example',
      bundleId: 'cdm',
      artifactKey,
      content: '',
      sourceLoaded: false,
      serializedModel: '{broken',
      exports: []
    };
    _resetParserWorkerForTests();
    resetCuratedDocumentCache();
    const received = deferredCuratedWorker();
    await curatedArtifactCache.putDocuments(artifactKey, [document]);
    const response = (documents: (typeof document)[]) =>
      Response.json({
        ok: true,
        models: [],
        errors: {},
        deferredExports: [],
        hydrationState: { documents },
        requiredCuratedArtifacts: [
          { key: artifactKey, bundleId: 'cdm', namespace: document.namespace, documentCount: 1 }
        ]
      });
    const pending = Promise.withResolvers<Response>();
    const fetch = vi.fn().mockResolvedValueOnce(response([])).mockReturnValueOnce(pending.promise);
    vi.stubGlobal('fetch', fetch);
    const recovered = vi.fn();
    const unsubscribe = subscribeCuratedCacheRecovery(recovered);
    try {
      await parseWorkspaceViaRouter([], { curatedBundles: [{ id: 'cdm', version: 'latest' }] });
      // The parser retains its worker; keep unrelated providers' workers disabled.
      vi.stubGlobal('Worker', undefined);
      const linking = linkDocument(document.uri);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      const parseCalls = parseMock.mock.calls.length;
      await act(async () => window.__runeStudioTestApi!.switchWorkspace!('ws-empty'));
      expect(parseMock.mock.calls.length).toBe(parseCalls);
      await act(async () => {
        pending.resolve(response([{ ...document, serializedModel: '{"$type":"RosettaModel"}' }]));
        await linking;
      });
      expect(recovered.mock.calls.length).toBe(0);
      expect(received.filter((request) => request.type === 'hydrate')).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'New workspace' })).toBeVisible();
      expect(useModelStore.getState().models.size).toBe(0);
      expect(useEditorStore.getState().nodes).toEqual([]);
      expect(await loadWorkspaceFiles('ws-a')).toEqual(sourceFiles);
    } finally {
      pending.resolve(response([]));
      unsubscribe();
      _resetParserWorkerForTests();
      resetCuratedDocumentCache();
      await curatedArtifactCache.discardDocuments([artifactKey]);
      await curatedArtifactCache.close();
      vi.unstubAllGlobals();
    }
  });

  it('a superseded restore cannot hide the newer workspace', async () => {
    await openSourceWorkspace();
    const previous = (await loadWorkspace('ws-a'))!;
    await saveWorkspace({ ...previous, id: 'ws-slow', name: 'Slow', curatedModels: [] });
    await saveWorkspace({ ...previous, id: 'ws-new', name: 'New', curatedModels: [] });
    await saveWorkspaceFiles('ws-new', blankFiles);
    let finishRestore!: (files: typeof sourceFiles) => void;
    vi.spyOn(workspaceFiles, 'loadWorkspaceFiles').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRestore = resolve;
        })
    );
    let oldSwitch!: Promise<void>;
    await act(async () => {
      oldSwitch = window.__runeStudioTestApi!.switchWorkspace!('ws-slow');
    });
    await waitFor(() => expect(finishRestore).toBeTypeOf('function'));
    await act(async () => window.__runeStudioTestApi!.switchWorkspace!('ws-new'));
    await act(async () => {
      finishRestore(sourceFiles);
      await oldSwitch;
    });
    expect(screen.getByTestId('files')).toHaveTextContent('blank.rosetta');
    expect(screen.getByRole('button', { name: /Workspace menu — .*New/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'New workspace' })).not.toBeInTheDocument();
  });

  it('an import that supersedes a restore leaves the restoring screen', async () => {
    await openSourceWorkspace();
    const previous = (await loadWorkspace('ws-a'))!;
    await saveWorkspace({ ...previous, id: 'ws-slow', name: 'Slow', curatedModels: [] });
    let finishRestore!: (files: typeof sourceFiles) => void;
    vi.spyOn(workspaceFiles, 'loadWorkspaceFiles').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRestore = resolve;
        })
    );
    let oldSwitch!: Promise<void>;
    await act(async () => {
      oldSwitch = window.__runeStudioTestApi!.switchWorkspace!('ws-slow');
    });
    await waitFor(() => expect(screen.getByText('Restoring workspace…')).toBeVisible());
    await act(async () => window.__runeStudioTestApi!.loadFiles!(blankFiles));
    expect(screen.getByTestId('files')).toHaveTextContent('blank.rosetta');
    expect(screen.queryByText('Restoring workspace…')).not.toBeInTheDocument();
    await act(async () => {
      finishRestore(sourceFiles);
      await oldSwitch;
    });
    expect(screen.getByTestId('files')).toHaveTextContent('blank.rosetta');
    expect(screen.queryByText('Restoring workspace…')).not.toBeInTheDocument();
  });

  it('removes an empty record created by a superseded launcher import', async () => {
    await openSourceWorkspace();
    const saveRecord = persistence.saveWorkspace;
    let finishCreation!: () => void;
    let abandonedId!: string;
    vi.spyOn(persistence, 'saveWorkspace').mockImplementationOnce(async (workspace) => {
      await saveRecord(workspace);
      abandonedId = workspace.id;
      await new Promise<void>((resolve) => {
        finishCreation = resolve;
      });
    });
    let oldImport!: Promise<void>;
    await act(async () => {
      oldImport = window.__runeStudioTestApi!.loadFiles!(sourceFiles);
    });
    await waitFor(() => expect(finishCreation).toBeTypeOf('function'));
    await act(async () => window.__runeStudioTestApi!.loadFiles!(blankFiles));
    await act(async () => {
      finishCreation();
      await oldImport;
    });
    expect(await loadWorkspace(abandonedId)).toBeUndefined();
    expect(await loadWorkspaceFiles(abandonedId)).toEqual([]);
    expect(await listRecents()).toHaveLength(2);
    expect(screen.getByTestId('files')).toHaveTextContent('blank.rosetta');
    expect(await loadWorkspaceFiles('ws-a')).toEqual(sourceFiles);
  });

  it('ignores a model parse from the previous workspace that finishes after a new workspace loads', async () => {
    await openSourceWorkspace();
    let finishOldParse!: (value: ReturnType<typeof emptyParse>) => void;
    parseMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOldParse = resolve;
        })
    );
    await act(async () => {
      const current = useModelStore.getState().models;
      useModelStore.setState({
        models: new Map([...current].map(([id, model]) => [id, { ...model, loadedAt: model.loadedAt + 1 }]))
      });
    });
    await waitFor(() => expect(finishOldParse).toBeTypeOf('function'));
    await act(async () => window.__runeStudioTestApi!.loadFiles!(blankFiles));
    await act(async () =>
      finishOldParse({
        ...emptyParse(),
        deferredExports: [{ filePath: '[cdm]/old.rosetta', namespace: 'cdm.old', exports: [] }]
      })
    );
    expect(screen.getByTestId('deferred')).toBeEmptyDOMElement();
    expect(screen.getByTestId('files')).not.toHaveTextContent('[cdm]');
    expect(useModelStore.getState().models.size).toBe(0);
  });
});

it('activates a POM-only GitHub clone without duplicating it or carrying prior editor files', async () => {
  const source = (await loadWorkspace('ws-a'))!;
  const gitBacking = {
    repoUrl: 'https://github.com/example/native.git',
    branch: 'release',
    user: 'example',
    tokenPath: '/empty-clone/.studio/token',
    syncState: 'clean' as const,
    lastSyncedSha: null
  };
  await saveWorkspace({
    ...source,
    id: 'empty-clone',
    name: 'Native project',
    kind: 'git-backed',
    lastOpenedAt: '2020-01-01T00:00:00Z',
    gitBacking
  });
  const fs = new OpfsFs(await navigator.storage.getDirectory());
  await fs.writeFile('/empty-clone/files/pom.xml', '<project/>');
  render(<App />);
  await waitFor(() => expect(screen.getByTestId('workspace-id')).toHaveTextContent('ws-a'));
  fireEvent.click(screen.getByRole('button', { name: 'Open POM-only clone' }));
  await waitFor(() => expect(screen.getByTestId('workspace-id')).toHaveTextContent('empty-clone'));
  expect(screen.getByTestId('files')).not.toHaveTextContent('trade.rosetta');
  expect(await loadWorkspaceFiles('empty-clone')).toEqual([]);
  expect(await listRecents()).toHaveLength(2);
  expect((await loadWorkspace('empty-clone'))?.kind).toBe('git-backed');
  expect((await loadWorkspace('empty-clone'))?.gitBacking).toEqual(gitBacking);
  expect(await fs.readFile('/empty-clone/files/pom.xml', 'utf8')).toBe('<project/>');
});

it('reviews and saves a newly cloned inactive project through the real App adapter before activation', async () => {
  const git = await import('../../src/services/git-backing.js');
  vi.spyOn(git, 'cloneRepository').mockImplementation(async (fs, id) => {
    await fs.writeFile(
      '/' + id + '/files/pom.xml',
      new TextEncoder().encode(
        '<project><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>rates</artifactId><version>1</version></project>'
      )
    );
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/device-init'))
      return Response.json({
        device_code: 'fixture',
        user_code: 'TEST',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5
      });
    if (url.endsWith('/device-poll')) return Response.json({ access_token: 'fixture-only', scope: 'repo' });
    return new Response('{}', { status: 404 });
  });
  render(<App />);
  await waitFor(() => expect(screen.getByTestId('workspace-id')).toHaveTextContent('ws-a'));
  fireEvent.click(screen.getByRole('button', { name: 'Start clone review' }));
  fireEvent.click(await screen.findByRole('button', { name: /check now/i }));
  fireEvent.change(await screen.findByTestId('repo-url-input'), { target: { value: 'example/rates' } });
  fireEvent.click(screen.getByRole('button', { name: 'Clone', exact: true }));
  const initialize = await screen.findByRole('button', { name: 'Initialize project settings' });
  await waitFor(() => expect(initialize).toBeEnabled());
  expect(screen.getByTestId('workspace-id')).toHaveTextContent('ws-a');
  fireEvent.click(initialize);
  await waitFor(() => expect(screen.getByTestId('workspace-id').textContent).not.toBe('ws-a'));
  const id = screen.getByTestId('workspace-id').textContent!;
  const root = await navigator.storage.getDirectory();
  const files = await (await root.getDirectoryHandle(id)).getDirectoryHandle('files');
  expect(await (await (await files.getFileHandle('build-config.yml')).getFile()).text()).toContain('schemaVersion');
});
