// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { hydrateProjectNamespaces } from '../../../src/services/project-namespace-hydration.js';
import { linkDocument } from '../../../src/services/workspace.js';
import { useProjectReferenceView } from '../../../src/shell/providers/use-project-reference-view.js';
import { prepareProjectReferenceView } from '../../../src/services/project-reference-view.js';
import type { WorkspaceState } from '../../../src/shell/providers/workspace-context.js';
import type { ProjectRuntimeState } from '../../../src/shell/providers/project-context.js';
import type { ProjectRuntimeInput } from '../../../src/services/project-runtime-input.js';
import { createProjectFileAdapter } from '../../../src/workspace/project-file-adapter.js';
import {
  loadWorkspaceFiles,
  saveWorkspaceFiles,
  setWorkspaceFilesDeps
} from '../../../src/workspace/workspace-files.js';
import { createOpfsRoot, writeBytes } from '../../setup/opfs-mock.js';
import { createRuneDslServices, serializeRuneModel, type Data, type RosettaModel } from '@rune-langium/core';
import { EmptyFileSystem, URI } from 'langium';
import { useEditorStore } from '@rune-langium/visual-editor';
import { makeNodeId } from '@rune-langium/visual-editor/identifiers';

vi.mock('../../../src/services/project-reference-view.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/project-reference-view.js')>()),
  prepareProjectReferenceView: vi.fn()
}));
vi.mock('../../../src/services/workspace.js', () => ({
  installProjectParserDocuments: vi.fn(),
  linkDocument: vi.fn()
}));

afterEach(() => {
  vi.mocked(prepareProjectReferenceView).mockReset();
  vi.mocked(linkDocument).mockReset();
  useEditorStore.setState({ selectedNodeId: null });
  setWorkspaceFilesDeps({ getFolderProjectAdapter: undefined });
});

const file = (path: string, content: string) => ({ path, name: path, content, dirty: false });
const stateFor = (files: WorkspaceState['files'], workspaceId = 'editing'): WorkspaceState => ({
  workspaceId,
  files,
  fileCount: files.length,
  models: [],
  parsedModels: [],
  deferredExports: [],
  parseErrors: new Map()
});
const runtime: ProjectRuntimeState = {
  managed: true,
  status: 'captured',
  input: {} as ProjectRuntimeInput,
  diagnostics: []
};
const reference = { ...file('[cdm]/model.rosetta', 'namespace pinned'), readOnly: true, refOnly: true };

it.each([
  { failure: false, ambiguous: false },
  { failure: true, ambiguous: false },
  { failure: false, ambiguous: true }
])(
  'keeps selected-owner publication and namespace readiness correct, ambiguous=$ambiguous, later failure=$failure',
  async ({ failure, ambiguous }) => {
    const services = createRuneDslServices(EmptyFileSystem);
    const entries = [
      ['functions', ambiguous ? 'Data' : 'RosettaFunction', `namespace pinned\n${ambiguous ? 'type' : 'func'} Same:`],
      ['types', 'Data', 'namespace pinned\ntype Same:']
    ].map(([name, kind, source]) => {
      const path = `[cdm]/${name}.rosetta`;
      const document = services.shared.workspace.LangiumDocumentFactory.fromString(
        source!,
        URI.parse(`file:///${path}`)
      );
      const serialized = serializeRuneModel(services.RuneDsl.serializer.JsonSerializer, document.parseResult.value);
      return {
        path,
        kind: kind!,
        source: source!,
        serialized,
        model: { ...JSON.parse(serialized), $textRegion: { documentURI: document.uri.toString() } }
      };
    });
    const state = stateFor([]);
    vi.mocked(prepareProjectReferenceView).mockResolvedValue({
      ...state,
      files: entries.map((entry) => ({
        ...file(entry.path, entry.source),
        readOnly: true,
        refOnly: true,
        namespace: 'pinned',
        serializedModelJson: entry.serialized
      })),
      deferredExports: entries.map((entry) => ({
        filePath: entry.path,
        namespace: 'pinned',
        exports: [{ type: entry.kind, name: 'Same' }]
      }))
    });
    const remaining = Promise.withResolvers<Awaited<ReturnType<typeof linkDocument>>>();
    vi.mocked(linkDocument).mockImplementation((uri) =>
      uri.endsWith('/types.rosetta')
        ? Promise.resolve({ linked: true, errors: [], newModels: [entries[1]!.model] })
        : remaining.promise
    );
    useEditorStore.setState({ selectedNodeId: makeNodeId('pinned', 'Same', 'Data') });
    const { result } = renderHook(() => useProjectReferenceView(runtime, state));
    await waitFor(() => expect(result.current.referenceView?.status).toBe('ready'));
    let work!: Promise<void>;
    let settled = false;
    await act(async () => {
      work = hydrateProjectNamespaces('editing', ['pinned'])!;
      void work.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(result.current.state.parsedModels.map((entry) => entry.filePath)).toEqual(
        ambiguous ? [] : [entries[1]!.path]
      )
    );
    expect(linkDocument).toHaveBeenNthCalledWith(1, `file:///[cdm]/${ambiguous ? 'functions' : 'types'}.rosetta`, true);
    expect(linkDocument).toHaveBeenNthCalledWith(2, `file:///[cdm]/${ambiguous ? 'types' : 'functions'}.rosetta`, true);
    expect(settled).toBe(false);
    await act(async () => {
      remaining.resolve(
        failure
          ? { linked: false, errors: ['Remaining namespace file failed'], newModels: [] }
          : { linked: true, errors: [], newModels: [entries[0]!.model] }
      );
      if (failure) await expect(work).rejects.toThrow('Remaining namespace file failed');
      else await work;
    });
    expect(result.current.state.parsedModels.map((entry) => entry.filePath)).toEqual(
      failure
        ? [entries[1]!.path]
        : ambiguous
          ? entries.map((entry) => entry.path)
          : [entries[1]!.path, entries[0]!.path]
    );
    expect(result.current.referenceView?.status).toBe('ready');
  }
);

it('reports an initial failure without a previous view or workspace identity', async () => {
  const state = { ...stateFor([]), workspaceId: undefined };
  vi.mocked(prepareProjectReferenceView).mockRejectedValue(new Error('Reference view unavailable.'));
  const { result } = renderHook(() => useProjectReferenceView(runtime, state));
  await waitFor(() => expect(result.current.referenceView?.status).toBe('unavailable'));
  expect(result.current.referenceView?.diagnostics[0]?.message).toBe('Reference view unavailable.');
  expect(result.current.state.files).toBe(state.files);
});

it('autosaves edits to A and B made before a reference-view refresh without reverting A', async () => {
  const root = createOpfsRoot(),
    privateRoot = createOpfsRoot();
  const original = [file('a.rosetta', 'namespace a'), file('b.rosetta', 'namespace b')];
  for (const entry of original) await writeBytes(root, new TextEncoder().encode(entry.content), entry.path);
  const adapter = createProjectFileAdapter({
    workspaceId: 'editing',
    root: root as unknown as FileSystemDirectoryHandle,
    privateRoot: privateRoot as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  setWorkspaceFilesDeps({ getFolderProjectAdapter: async () => adapter });
  const state = stateFor(await loadWorkspaceFiles('editing'));
  const view = { ...state, files: [...state.files, reference] };
  vi.mocked(prepareProjectReferenceView)
    .mockResolvedValueOnce(view)
    .mockImplementation(() => new Promise(() => {}));
  const { result, rerender } = renderHook(({ state }) => useProjectReferenceView(runtime, state), {
    initialProps: { state }
  });
  await waitFor(() => expect(result.current.referenceView?.status).toBe('ready'));
  const edited = {
    ...state,
    files: state.files.map((entry) =>
      entry.path === 'a.rosetta' ? { ...entry, content: 'namespace a\n// first edit', dirty: true } : entry
    )
  };
  rerender({ state: edited });
  // This is the same read/modify/write contract used by Explore's latest-files ref.
  const secondEdit = result.current.state.files.map((entry) =>
    entry.path === 'b.rosetta' ? { ...entry, content: 'namespace b\n// second edit', dirty: true } : entry
  );
  await saveWorkspaceFiles('editing', secondEdit);
  expect((await adapter.read('a.rosetta'))?.text).toContain('// first edit');
  expect((await adapter.read('b.rosetta'))?.text).toContain('// second edit');
  expect(result.current.referenceView?.status).toBe('loading');
  expect(result.current.state.files).toContain(reference);
  expect(result.current.state.models).toBe(view.models);
});

it('keeps additions, deletions and current workspace metadata while a retained view is waiting for the parser', async () => {
  const state = stateFor([file('a.rosetta', 'namespace a'), file('b.rosetta', 'namespace b')]);
  const view = { ...state, files: [...state.files, reference] };
  vi.mocked(prepareProjectReferenceView)
    .mockResolvedValueOnce(view)
    .mockRejectedValue(new Error('Waiting for the parser snapshot of the current source: a.rosetta'));
  const { result, rerender } = renderHook(({ state }) => useProjectReferenceView(runtime, state), {
    initialProps: { state }
  });
  await waitFor(() => expect(result.current.referenceView?.status).toBe('ready'));
  const current = { ...state, workspaceName: 'Renamed', files: [state.files[0]!, file('c.rosetta', 'namespace c')] };
  rerender({ state: current });
  expect(result.current.state.files.map((entry) => entry.path)).toEqual(['a.rosetta', 'c.rosetta', reference.path]);
  expect(result.current.state.workspaceName).toBe('Renamed');
  await act(async () => {});
  expect(result.current.state.files).toContain(reference);
  expect(result.current.referenceView?.status).toBe('loading');
  rerender({ state: stateFor([file('next.rosetta', 'namespace next')], 'next') });
  expect(result.current.state.files.map((entry) => entry.path)).toEqual(['next.rosetta']);
});

it('routes managed namespace demand to the pinned parser and unregisters on workspace disposal', async () => {
  const state = stateFor([]);
  const entry = {
    ...reference,
    namespace: 'pinned',
    serializedModelJson: JSON.stringify({
      $type: 'RosettaModel',
      name: 'pinned',
      imports: [],
      elements: [],
      version: ''
    })
  };
  const model = {
    $type: 'RosettaModel',
    name: 'pinned',
    elements: [],
    $textRegion: { documentURI: 'file:///[cdm]/model.rosetta' }
  };
  vi.mocked(prepareProjectReferenceView).mockResolvedValue({ ...state, files: [entry] });
  vi.mocked(linkDocument).mockResolvedValue({ linked: true, errors: [], newModels: [model as never] });
  const { result, unmount } = renderHook(() => useProjectReferenceView(runtime, state));
  await waitFor(() => expect(result.current.referenceView?.status).toBe('ready'));
  await act(async () => {
    await hydrateProjectNamespaces('editing', ['pinned']);
  });
  expect(linkDocument).toHaveBeenCalledWith('file:///[cdm]/model.rosetta', true);
  expect(result.current.state.models).toEqual([expect.objectContaining({ name: 'pinned' })]);
  unmount();
  expect(hydrateProjectNamespaces('editing', ['pinned'])).toBeUndefined();
});

it('rejects an invalid materialized document through the request and retains the last valid view', async () => {
  const state = stateFor([]);
  const entry = { ...reference, namespace: 'pinned', serializedModelJson: '{}' };
  vi.mocked(prepareProjectReferenceView).mockResolvedValue({ ...state, files: [entry] });
  vi.mocked(linkDocument).mockResolvedValue({
    linked: true,
    errors: [],
    newModels: [
      { $type: 'RosettaModel', name: 'unknown', $textRegion: { documentURI: 'file:///unknown.rosetta' } } as never
    ]
  });
  const { result } = renderHook(() => useProjectReferenceView(runtime, state));
  await waitFor(() => expect(result.current.referenceView?.status).toBe('ready'));
  await expect(hydrateProjectNamespaces('editing', ['pinned'])).rejects.toThrow('current verified view');
  expect(result.current.state.models).toEqual([]);
  expect(result.current.referenceView?.status).toBe('ready');
});

it.each([false, true])('retains concurrent namespace publications after an earlier failure=%s', async (failure) => {
  const state = stateFor([]);
  const services = createRuneDslServices(EmptyFileSystem);
  const entries = ['alpha', 'beta'].map((namespace) => {
    const path = `[cdm]/${namespace}.rosetta`;
    const content = `namespace ${namespace}\ntype Item:`;
    const document = services.shared.workspace.LangiumDocumentFactory.fromString<RosettaModel>(
      content,
      URI.parse(`file:///${path}`)
    );
    return {
      file: {
        ...file(path, content),
        readOnly: true,
        refOnly: true,
        namespace,
        serializedModelJson: serializeRuneModel(services.RuneDsl.serializer.JsonSerializer, document.parseResult.value)
      },
      model: { ...document.parseResult.value, $textRegion: { documentURI: document.uri.toString() } }
    };
  });
  vi.mocked(prepareProjectReferenceView).mockResolvedValue({ ...state, files: entries.map((entry) => entry.file) });
  vi.mocked(linkDocument).mockImplementation(async (uri) => {
    if (failure && uri.endsWith('/alpha.rosetta'))
      return { linked: false, errors: ['First namespace failed'], newModels: [] };
    const entry = entries.find((entry) => uri.endsWith(`/${entry.file.namespace}.rosetta`))!;
    return { linked: true, errors: [], newModels: [entry.model] };
  });
  const { result } = renderHook(() => useProjectReferenceView(runtime, state));
  await waitFor(() => expect(result.current.referenceView?.status).toBe('ready'));
  await act(async () => {
    const first = hydrateProjectNamespaces('editing', ['alpha'])!;
    const second = hydrateProjectNamespaces('editing', ['beta'])!;
    await Promise.all([failure ? expect(first).rejects.toThrow('First namespace failed') : first, second]);
  });
  expect(result.current.state.models.map((model) => model.name)).toEqual(failure ? ['beta'] : ['alpha', 'beta']);
});

it('retains linked ASTs for source edits only, and relinks unchanged A when its dependency B changes', async () => {
  const state = stateFor([]);
  const services = createRuneDslServices(EmptyFileSystem);
  const documents = [
    ['a', 'namespace pinned\ntype A:\n child B (1..1)'],
    ['b', 'namespace pinned\ntype B:']
  ].map(([name, source]) =>
    services.shared.workspace.LangiumDocumentFactory.fromString(source!, URI.parse(`file:///[cdm]/${name}.rosetta`))
  );
  for (const document of documents) services.shared.workspace.LangiumDocuments.addDocument(document);
  await services.shared.workspace.DocumentBuilder.build(documents, { validation: false, eagerLinking: true });
  const parsedModels = documents.map((document, index) => ({
    filePath: `[cdm]/${index ? 'b' : 'a'}.rosetta`,
    model: document.parseResult.value as import('@rune-langium/core').RosettaModel,
    source: document.textDocument.getText(),
    serializedModelJson: serializeRuneModel(services.RuneDsl.serializer.JsonSerializer, document.parseResult.value)
  }));
  const files = parsedModels.map((entry) => ({
    ...file(entry.filePath, entry.source),
    namespace: 'pinned',
    readOnly: true,
    refOnly: true,
    serializedModelJson: entry.serializedModelJson,
    bundleId: 'cdm'
  }));
  const a = parsedModels[0]!.model.elements[0] as Data;
  const oldB = parsedModels[1]!.model.elements[0];
  expect(a.attributes[0]!.typeCall!.type?.ref).toBe(oldB);
  const initialView = { ...state, files, parsedModels, models: parsedModels.map((entry) => entry.model) };
  const inventory = { ...state, files };
  const capture = files.map((entry) => ({
    uri: entry.path,
    content: entry.content,
    serialized: entry.serializedModelJson
  }));
  const initialRuntime = { ...runtime, input: { referenceDocuments: capture } as ProjectRuntimeInput };
  vi.mocked(prepareProjectReferenceView).mockResolvedValueOnce(initialView).mockResolvedValueOnce(inventory);
  const { result, rerender } = renderHook(({ active }) => useProjectReferenceView(active, state), {
    initialProps: { active: initialRuntime }
  });
  await waitFor(() => expect(result.current.referenceView?.status).toBe('ready'));
  // A new source capture reuses the exact same immutable reference capture.
  rerender({ active: { ...initialRuntime, input: { ...initialRuntime.input! } } });
  await waitFor(() => expect(result.current.referenceView?.status).toBe('ready'));
  expect(result.current.state.models[0]!.elements[0]).toBe(a);
  const changedB = JSON.parse(files[1]!.serializedModelJson);
  changedB.elements[0].definition = 'new capture';
  const nextFiles = [files[0]!, { ...files[1]!, serializedModelJson: JSON.stringify(changedB) }];
  vi.mocked(prepareProjectReferenceView).mockResolvedValueOnce({ ...state, files: nextFiles });
  const nextCapture = nextFiles.map((entry) => ({
    uri: entry.path,
    content: entry.content,
    serialized: entry.serializedModelJson
  }));
  rerender({ active: { ...initialRuntime, input: { referenceDocuments: nextCapture } as ProjectRuntimeInput } });
  await waitFor(() => expect(result.current.referenceView?.status).toBe('ready'));
  // A's bytes are unchanged, but its old pointer to B cannot cross capture boundaries.
  expect(result.current.state.models).toEqual([]);
  vi.mocked(linkDocument).mockResolvedValue({
    linked: true,
    errors: [],
    newModels: documents.map((document) => ({
      ...document.parseResult.value,
      $textRegion: { documentURI: document.uri.toString() }
    })) as never
  });
  await act(async () => {
    await hydrateProjectNamespaces('editing', ['pinned']);
  });
  const nextA = result.current.state.models[0]!.elements[0] as Data;
  const nextB = result.current.state.models[1]!.elements[0];
  expect(nextA).not.toBe(a);
  expect(nextA.attributes[0]!.typeCall!.type?.ref).toBe(nextB);
  expect(nextB).not.toBe(oldB);
  expect(nextB).toMatchObject({ definition: 'new capture' });
});
