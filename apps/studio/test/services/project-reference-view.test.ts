// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { afterEach, it, expect, vi } from 'vitest';
import { parse, createRuneDslServices, serializeRuneModel, hydrateModelDocuments, type Data } from '@rune-langium/core';
import { EmptyFileSystem, URI } from 'langium';
import {
  createMemoryReferenceCache,
  resolveProjectReferences,
  loadLockedReferences
} from '@rune-langium/project-runtime/references';
import { createReferenceArtifacts } from '../../../../test/helpers/project-reference-artifacts.js';
import { captureProjectRuntimeInput } from '../../src/services/project-runtime-input.js';
import {
  prepareProjectReferenceView,
  materializeProjectReferenceView
} from '../../src/services/project-reference-view.js';
import {
  workspaceDeclarationIdentities,
  resolveExampleType,
  resolvePresentationType
} from '../../src/workspace/example-identity.js';
import { createProjectSnapshot } from '@rune-langium/project-config';
import { previewTypeSymbol } from '@rune-langium/codegen/export';
import { projectReferenceUri } from '@rune-langium/project-runtime/context';
import { pathToUri } from '../../src/utils/uri.js';
import { createProjectFileAdapter } from '../../src/workspace/project-file-adapter.js';
import { loadWorkspaceFiles, saveWorkspaceFiles, setWorkspaceFilesDeps } from '../../src/workspace/workspace-files.js';
import { createOpfsRoot, writeBytes } from '../setup/opfs-mock.js';

afterEach(() => vi.restoreAllMocks());

it('projects exact locked ASTs into Explorer and parser hydration without a latest-model request', async () => {
  const fixture = await createReferenceArtifacts(undefined, undefined, {
    cdm: 'namespace pinned\ntype Payment:\n amount number (1..1)',
    'rune-dsl': 'namespace pinned.base\ntype Support:\n name string (0..1)'
  });
  const cache = createMemoryReferenceCache();
  const { lock } = await resolveProjectReferences(
    fixture.snapshot,
    fixture.transport,
    new AbortController().signal,
    cache
  );
  const snapshot = { ...fixture.snapshot, lock: lock! };
  const loaded = await loadLockedReferences(lock!, fixture.transport, cache, new AbortController().signal);
  const file = {
    path: 'main.rosetta',
    name: 'main.rosetta',
    content: 'namespace local\ntype Draft:\n value number (0..1)',
    dirty: false
  };
  const parsed = await parse(file.content, 'file:///workspace/main.rosetta');
  const services = createRuneDslServices(EmptyFileSystem);
  const state = {
    workspaceId: 'p',
    fileCount: 1,
    files: [file],
    models: [parsed.value!],
    parsedModels: [
      {
        filePath: file.path,
        model: parsed.value!,
        source: file.content,
        serializedModelJson: serializeRuneModel(services.RuneDsl.serializer.JsonSerializer, parsed.value!)
      }
    ],
    deferredExports: [],
    parseErrors: new Map()
  };
  const input = await captureProjectRuntimeInput(snapshot, [file], loaded.documents);
  const install = vi.fn().mockResolvedValue(undefined);
  const view = await prepareProjectReferenceView(input, state, install, new AbortController().signal);
  expect(view.files.find((file) => file.bundleId === 'cdm')).toMatchObject({
    path: '[cdm]/model.rosetta',
    readOnly: true,
    refOnly: true,
    sourceLoaded: true
  });
  expect(workspaceDeclarationIdentities(view)).toContainEqual({
    model: 'cdm',
    namespace: 'pinned',
    kind: 'Data',
    name: 'Payment'
  });
  expect(install).toHaveBeenCalledOnce();
  expect(install.mock.calls[0]![0]).toEqual(
    expect.arrayContaining([expect.objectContaining({ uri: 'file:///[cdm]/model.rosetta' })])
  );
});

it('preserves excluded Rune files through a bound-folder edit and autosave while excluding them from semantic hydration', async () => {
  const fixture = await createReferenceArtifacts(undefined, undefined, {
    cdm: 'namespace pinned\ntype Payment:\n amount number (1..1)',
    'rune-dsl': 'namespace pinned.base\ntype Support:\n name string (0..1)'
  });
  const root = createOpfsRoot();
  const privateRoot = createOpfsRoot();
  const id = 'excluded-sources';
  const source = 'namespace local\ntype Draft:\n value number (0..1)';
  const excluded = 'namespace scratch\ntype Unselected:\n name string (0..1)';
  const files = new Map(fixture.snapshot.files);
  files.set('build-config.yml', JSON.stringify({ ...fixture.snapshot.project.build, sources: ['model/**/*.rosetta'] }));
  files.set('model/main.rosetta', source);
  files.set('scratch/excluded.rosetta', excluded);
  const snapshot = await createProjectSnapshot(id, files, () => []);
  for (const [path, content] of files) await writeBytes(root, new TextEncoder().encode(content), ...path.split('/'));
  const adapter = createProjectFileAdapter({
    workspaceId: id,
    root: root as unknown as FileSystemDirectoryHandle,
    privateRoot: privateRoot as unknown as FileSystemDirectoryHandle,
    isWritable: () => true
  });
  setWorkspaceFilesDeps({ getFolderProjectAdapter: async (workspace) => (workspace === id ? adapter : undefined) });
  try {
    const writable = await loadWorkspaceFiles(id);
    const cache = createMemoryReferenceCache();
    const { lock } = await resolveProjectReferences(snapshot, fixture.transport, new AbortController().signal, cache);
    const loaded = await loadLockedReferences(lock!, fixture.transport, cache, new AbortController().signal);
    const parsed = await parse(source, 'file:///workspace/model/main.rosetta');
    const services = createRuneDslServices(EmptyFileSystem);
    const state = {
      workspaceId: id,
      fileCount: writable.length,
      files: writable,
      models: [parsed.value!],
      parsedModels: [
        {
          filePath: 'model/main.rosetta',
          model: parsed.value!,
          source,
          serializedModelJson: serializeRuneModel(services.RuneDsl.serializer.JsonSerializer, parsed.value!)
        }
      ],
      deferredExports: [],
      parseErrors: new Map()
    };
    const input = await captureProjectRuntimeInput({ ...snapshot, lock: lock! }, writable, loaded.documents);
    const install = vi.fn().mockResolvedValue(undefined);
    const view = await prepareProjectReferenceView(input, state, install, new AbortController().signal);
    await saveWorkspaceFiles(
      id,
      view.files.map((file) =>
        file.path === 'model/main.rosetta' ? { ...file, content: source + '\n// edited', dirty: true } : file
      )
    );
    expect((await adapter.read('scratch/excluded.rosetta'))?.text).toBe(excluded);
    expect((await adapter.read('model/main.rosetta'))?.text).toContain('// edited');
    expect(view.files.find((file) => file.path === 'scratch/excluded.rosetta')?.content).toBe(excluded);
    expect(view.models.map((model) => model.name)).not.toContain('scratch');
    expect(install.mock.calls[0]![0].some((document: { uri: string }) => document.uri.includes('excluded'))).toBe(
      false
    );
    expect(view.files.find((file) => file.bundleId === 'cdm')?.namespace).toBe('pinned');
  } finally {
    setWorkspaceFilesDeps({ getFolderProjectAdapter: undefined });
  }
});

it('publishes the complete index before materializing references and links selected documents through the worker', async () => {
  const { prepareReferenceArtifact } = await import('../../src/services/reference-artifact-decoder.js');
  const { dispatchWorkerRequest, _testInternals } = await import('../../src/workers/parser-worker.js');
  const fixture = await createReferenceArtifacts(undefined, undefined, {
    cdm: 'namespace pinned\ntype Payment:\n amount number (1..1)',
    'rune-dsl': 'namespace pinned.base\ntype Support:\n name string (0..1)'
  });
  const transport = { ...fixture.transport, decodeArtifact: prepareReferenceArtifact };
  const cache = createMemoryReferenceCache();
  const signal = new AbortController().signal;
  const { lock } = await resolveProjectReferences(fixture.snapshot, transport, signal, cache);
  const loaded = await loadLockedReferences(lock!, transport, cache, signal);
  const state = {
    workspaceId: 'p',
    fileCount: 0,
    files: [],
    models: [],
    parsedModels: [],
    deferredExports: [],
    parseErrors: new Map()
  };
  const input = await captureProjectRuntimeInput({ ...fixture.snapshot, lock: lock! }, [], loaded.documents);
  const view = await prepareProjectReferenceView(
    input,
    state,
    async (documents) => {
      expect((await dispatchWorkerRequest({ type: 'hydrate', id: 'managed', documents })).type).toBe('hydrateResult');
    },
    signal
  );
  expect(view.models).toHaveLength(0);
  expect(view.deferredExports.every((entry) => view.files.some((file) => file.path === entry.filePath))).toBe(true);
  expect(resolveExampleType(view, { typeFqn: 'pinned.Payment' })).toEqual({
    model: 'cdm',
    namespace: 'pinned',
    kind: 'Data',
    name: 'Payment'
  });
  expect(resolvePresentationType(view, previewTypeSymbol('Data', 'pinned.Payment'))).toEqual({
    model: 'cdm',
    namespace: 'pinned',
    kind: 'Data',
    name: 'Payment'
  });
  expect(view.deferredExports.flatMap((entry) => entry.exports).some((entry) => entry.name.includes('.'))).toBe(false);
  expect(view.deferredExports).toContainEqual(
    expect.objectContaining({
      namespace: 'pinned',
      exports: expect.arrayContaining([{ type: 'Data', name: 'Payment' }])
    })
  );
  expect(_testInternals().deferredModelJson.size).toBe(2);
  const linked = await dispatchWorkerRequest({
    type: 'linkDocument',
    id: 'selected',
    uri: 'file:///[cdm]/model.rosetta'
  });
  expect(linked).toMatchObject({ linked: true, errors: [], newModels: [expect.objectContaining({ name: 'pinned' })] });
  expect(_testInternals().deferredModelJson.size).toBe(1);
  if (linked.type !== 'linkDocumentResult') throw new Error('Expected linked model');
  const abort = new AbortController();
  const cancelled = materializeProjectReferenceView(view, linked.newModels, abort.signal);
  abort.abort();
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  expect(view.models).toHaveLength(0);
  const materialized = await materializeProjectReferenceView(view, linked.newModels);
  expect(materialized.models).toHaveLength(1);
  expect(materialized.models[0]!.elements[0]!.$container).toBe(materialized.models[0]);
  expect(await materializeProjectReferenceView(materialized, linked.newModels)).toBe(materialized);
});

it('revives an immutable cross-document cycle without forcing name resolution or loading unrelated documents', async () => {
  const { dispatchWorkerRequest, _testInternals } = await import('../../src/workers/parser-worker.js');
  const services = createRuneDslServices(EmptyFileSystem);
  const documents = [
    ['a', 'namespace cycle.a\ntype A:\n peer cycle.b.B (0..1)'],
    ['b', 'namespace cycle.b\ntype B:\n peer cycle.a.A (0..1)']
  ].map(([name, source]) =>
    services.shared.workspace.LangiumDocumentFactory.fromString(source!, URI.parse(`file:///[cdm]/${name}.rosetta`))
  );
  for (const document of documents) services.shared.workspace.LangiumDocuments.addDocument(document);
  await services.shared.workspace.DocumentBuilder.build(documents, { eagerLinking: true, validation: false });
  const installed = await Promise.all(
    documents.map(async (document) => ({
      uri: document.uri.toString(),
      content: '',
      bundleId: 'cdm',
      serializedModel: serializeRuneModel(services.RuneDsl.serializer.JsonSerializer, document.parseResult.value),
      exports: (await services.RuneDsl.references.ScopeComputation.collectExportedSymbols(document)).map(
        ({ type, name, path }) => ({ type, name, path })
      )
    }))
  );
  const warn = vi.spyOn(console, 'warn');
  try {
    await dispatchWorkerRequest({
      type: 'hydrate',
      id: 'cycle',
      documents: [
        ...installed,
        {
          uri: 'file:///unrelated.rosetta',
          content: '',
          serializedModel: '{"$type":"RosettaModel","name":"unrelated","elements":[]}',
          exports: [],
          bundleId: 'other'
        }
      ]
    });
    for (const id of ['first', 'repeated']) {
      const response = await dispatchWorkerRequest({
        type: 'linkDocument',
        id,
        uri: installed[0]!.uri,
        snapshot: true
      });
      expect(response).toMatchObject({ linked: true, errors: [] });
      if (response.type !== 'linkDocumentResult') throw new Error('Expected link result');
      expect(response.newModels.map((model) => model.name).sort()).toEqual(['cycle.a', 'cycle.b']);
      const live = _testInternals().services.shared.workspace.LangiumDocuments.getDocument(
        URI.parse(installed[0]!.uri)
      )!.parseResult.value as import('@rune-langium/core').RosettaModel;
      const a = live.elements[0] as Data;
      const b = a.attributes[0]!.typeCall!.type!.ref as Data;
      expect(b.name).toBe('B');
      expect(b.attributes[0]!.typeCall!.type!.ref).toBe(a);
      expect(_testInternals().deferredModelJson.size).toBe(1);
    }
    expect(warn.mock.calls.filter(([message]) => String(message).includes('ComputedScopes state'))).toEqual([]);
  } finally {
    warn.mockRestore();
  }
});

it.each(
  ['file:///child.rosetta', pathToUri('child.rosetta')].flatMap((sourceUri) =>
    [false, true].map((overridden) => ({ sourceUri, overridden }))
  )
)(
  'publishes local inheritance from $sourceUri (namespace override=$overridden), including repeated installs',
  async ({ sourceUri, overridden }) => {
    const warn = vi.spyOn(console, 'warn');
    const { prepareReferenceArtifact } = await import('../../src/services/reference-artifact-decoder.js');
    const { dispatchWorkerRequest, _testInternals } = await import('../../src/workers/parser-worker.js');
    const fixture = await createReferenceArtifacts(undefined, undefined, {
      cdm: 'namespace pinned\ntype Grandparent:\n code string (1..1)\ntype Parent extends Grandparent:\n amount number (1..1)',
      'rune-dsl': 'namespace unused\ntype Support:\n value string (0..1)'
    });
    const transport = { ...fixture.transport, decodeArtifact: prepareReferenceArtifact };
    const cache = createMemoryReferenceCache();
    const signal = new AbortController().signal;
    const { lock } = await resolveProjectReferences(fixture.snapshot, transport, signal, cache);
    const loaded = await loadLockedReferences(lock!, transport, cache, signal);
    const namespace = overridden ? 'pinned' : 'local';
    const content =
      (overridden
        ? 'override namespace pinned\nimport pinned.*\ntype Parent extends Grandparent:\n amount number (1..1)\n replacement string (0..1)\n'
        : 'namespace local\nimport pinned.*\n') + 'type Child extends Parent:\n own int (0..1)';
    const services = createRuneDslServices(EmptyFileSystem);
    const referenceModels = hydrateModelDocuments(
      services,
      loaded.documents.map((doc) => ({
        uri: projectReferenceUri(doc.uri),
        json: doc.serialized!
      }))
    );
    const local = services.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse(sourceUri));
    services.shared.workspace.LangiumDocuments.addDocument(local);
    await services.shared.workspace.DocumentBuilder.build([...referenceModels.map((entry) => entry.document), local], {
      validation: false,
      eagerLinking: true
    });
    expect(
      (local.parseResult.value as import('@rune-langium/core').RosettaModel).elements.find(
        (element) => 'name' in element && element.name === 'Child'
      )
    ).toMatchObject({
      superType: { ref: { name: 'Parent' } }
    });
    const serializedModelJson = serializeRuneModel(services.RuneDsl.serializer.JsonSerializer, local.parseResult.value);
    const files = new Map(fixture.snapshot.files);
    files.set('child.rosetta', content);
    files.set('build-config.yml', JSON.stringify({ ...fixture.snapshot.project.build, sources: ['**/*.rosetta'] }));
    files.set('build-config.lock.json', JSON.stringify(lock));
    const snapshot = await createProjectSnapshot('p', files, () => []);
    const file = { path: 'child.rosetta', name: 'child.rosetta', content, dirty: false };
    const state = {
      workspaceId: 'p',
      fileCount: 1,
      files: [file],
      models: [local.parseResult.value as import('@rune-langium/core').RosettaModel],
      parsedModels: [
        {
          filePath: file.path,
          model: local.parseResult.value as import('@rune-langium/core').RosettaModel,
          source: content,
          serializedModelJson
        }
      ],
      deferredExports: [],
      parseErrors: new Map()
    };
    const input = await captureProjectRuntimeInput(snapshot, [file], loaded.documents);
    const install = async (documents: import('../../src/workers/parser-worker.js').HydrateRequest['documents']) => {
      expect(await dispatchWorkerRequest({ type: 'hydrate', id: 'local-roots', documents })).toMatchObject({
        ok: true
      });
    };
    const link = async (uri: string, snapshot = false) => {
      const result = await dispatchWorkerRequest({ type: 'linkDocument', id: 'local-closure', uri, snapshot });
      if (result.type !== 'linkDocumentResult') throw new Error('Expected link response');
      return result;
    };
    for (let round = 0; round < 2; round++) {
      const view = await prepareProjectReferenceView(input, state, install, signal, link);
      const child = view.models
        .find(
          (model) =>
            model.name === namespace && model.elements.some((element) => 'name' in element && element.name === 'Child')
        )!
        .elements.find((element) => 'name' in element && element.name === 'Child') as Data;
      const parent = child.superType?.ref as Data;
      expect(parent).toMatchObject({
        name: 'Parent',
        attributes: expect.arrayContaining([expect.objectContaining({ name: 'amount' })])
      });
      if (overridden) expect(parent.attributes).toContainEqual(expect.objectContaining({ name: 'replacement' }));
      expect(parent.superType?.ref).toMatchObject({
        name: 'Grandparent',
        attributes: [expect.objectContaining({ name: 'code' })]
      });
      expect(view.models.map((model) => model.name).sort()).toEqual([namespace, 'pinned'].sort());
      expect(_testInternals().deferredModelJson.size).toBe(1); // The unrelated support model stays deferred.
    }
    expect(warn.mock.calls.filter(([message]) => String(message).includes('ComputedScopes state'))).toEqual([]);
    warn.mockRestore();
  }
);
