// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const buildMock = vi.fn(async () => undefined);
const fromStringMock = vi.fn((content: string, uri: string) => ({
  uri,
  content,
  parseResult: {
    value: {
      $type: 'RosettaModel',
      elements: [],
      uri,
      content
    },
    lexerErrors: [],
    parserErrors: []
  }
}));
const fromModelMock = vi.fn((model: unknown, uri: string) => ({
  uri,
  parseResult: {
    value: model,
    lexerErrors: [],
    parserErrors: []
  }
}));
const addDocumentMock = vi.fn();
const deserializeMock = vi.fn((json: string) => JSON.parse(json));
const hasDocumentMock = vi.fn((_uri: unknown) => false);
const getDocumentMock = vi.fn((_uri: unknown) => ({
  diagnostics: [],
  parseResult: { value: { $type: 'RosettaModel', elements: [] }, parserErrors: [] }
}));
const registerExportsMock = vi.fn();

vi.mock('@rune-langium/core', () => ({
  isRosettaModel: (node: { $type?: string }) => node.$type === 'RosettaModel',
  RuneDslIndexManager: class {},
  namespaceFromSource: (text: string) => text.match(/^\s*namespace\s+([\w.]+)/m)?.[1] ?? '',
  preserveCstText: () => {},
  serializeRuneModel: (_serializer: unknown, model: unknown) => JSON.stringify(model),
  createRuneDslServices: () => ({
    RuneDsl: {
      serializer: {
        JsonSerializer: { deserialize: deserializeMock }
      },
      shared: {
        workspace: {
          LangiumDocumentFactory: { fromString: fromStringMock, fromModel: fromModelMock },
          DocumentBuilder: { build: buildMock, update: vi.fn(async () => undefined) },
          LangiumDocuments: {
            addDocument: addDocumentMock,
            hasDocument: hasDocumentMock,
            getDocument: getDocumentMock,
            deleteDocument: vi.fn(),
            all: { toArray: () => [] }
          },
          IndexManager: { registerExports: registerExportsMock, allElements: () => [], remove: vi.fn() }
        }
      }
    }
  }),
  hydrateModelDocument: (_services: unknown, _uri: unknown, json: string, { register }: { register: string }) => {
    const model = deserializeMock(json);
    const document = fromModelMock(model, _uri);
    if (register === 'always') {
      addDocumentMock(document);
    }
    return { model, document };
  }
}));

vi.mock('langium', () => ({
  URI: {
    parse: (value: string) => value
  },
  EmptyFileSystem: {}
}));

async function loadParserWorkerModule() {
  vi.resetModules();
  return await import('../../src/workers/parser-worker.ts');
}

describe('parser-worker', () => {
  it('propagates a failed scope snapshot build and allows the next queued request', async () => {
    const { dispatchWorkerRequest } = await loadParserWorkerModule();
    buildMock.mockRejectedValueOnce(new Error('Snapshot build failed'));
    const result = await dispatchWorkerRequest({
      type: 'expressionScope',
      id: 'failed-scope',
      uri: 'file:///scope.rosetta',
      name: 'Calc',
      region: { from: 0, to: 1 },
      files: [{ name: 'file:///scope.rosetta', content: 'namespace test' }]
    });
    expect(result).toMatchObject({
      type: 'expressionScopeResult',
      entries: [],
      error: expect.stringContaining('Snapshot build failed')
    });
    expect(buildMock).toHaveBeenCalledTimes(1);
    expect(await dispatchWorkerRequest({ type: 'parse', id: 'next-request', content: 'namespace next' })).toMatchObject(
      { type: 'parseResult', id: 'next-request', errors: [] }
    );
  });
  beforeEach(() => {
    buildMock.mockReset();
    buildMock.mockImplementation(async () => undefined);
    fromStringMock.mockClear();
    fromModelMock.mockClear();
    addDocumentMock.mockClear();
    deserializeMock.mockClear();
    hasDocumentMock.mockReset();
    hasDocumentMock.mockReturnValue(false);
    getDocumentMock.mockClear();
    registerExportsMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds a single document with validation disabled for parse requests', async () => {
    const { handleParse } = await loadParserWorkerModule();

    const response = await handleParse({
      type: 'parse',
      id: 'parse-1',
      content: 'namespace demo',
      uri: 'file:///demo.rosetta'
    });

    expect(fromStringMock).toHaveBeenCalledWith('namespace demo', 'file:///demo.rosetta');
    expect(buildMock).toHaveBeenCalledWith([expect.objectContaining({ uri: 'file:///demo.rosetta' })], {
      validation: false,
      eagerLinking: false
    });
    expect(response).toMatchObject({
      type: 'parseResult',
      id: 'parse-1',
      errors: []
    });
  });

  it('builds workspace documents with validation disabled and preserves file ordering', async () => {
    const { handleParseWorkspace } = await loadParserWorkerModule();

    const response = await handleParseWorkspace({
      type: 'parseWorkspace',
      id: 'workspace-1',
      files: [
        { name: 'a.rosetta', content: 'namespace a' },
        { name: 'b.rosetta', content: 'namespace b' }
      ]
    });

    expect(fromStringMock).toHaveBeenNthCalledWith(1, 'namespace a', 'a.rosetta');
    expect(fromStringMock).toHaveBeenNthCalledWith(2, 'namespace b', 'b.rosetta');
    expect(buildMock).toHaveBeenCalledWith(
      [expect.objectContaining({ uri: 'a.rosetta' }), expect.objectContaining({ uri: 'b.rosetta' })],
      { validation: false, eagerLinking: false }
    );
    expect(response.type).toBe('parseWorkspaceResult');
    expect(response.id).toBe('workspace-1');
    expect(response.parsedModels.map((entry) => entry.filePath)).toEqual(['a.rosetta', 'b.rosetta']);
  });

  it('returns per-file parser errors from the built documents', async () => {
    buildMock.mockImplementation(
      async (documents: Array<{ parseResult: { parserErrors: Array<{ message: string }> } }>) => {
        documents[1]!.parseResult.parserErrors = [{ message: 'Broken syntax' }];
      }
    );

    const { handleParseWorkspace } = await loadParserWorkerModule();

    const response = await handleParseWorkspace({
      type: 'parseWorkspace',
      id: 'workspace-2',
      files: [
        { name: 'good.rosetta', content: 'namespace good' },
        { name: 'bad.rosetta', content: 'not valid' }
      ]
    });

    expect(response.errors).toEqual({
      'bad.rosetta': ['Broken syntax']
    });
  });

  it('stores corpus JSON for deferred loading and registers export stubs at workspace parse', async () => {
    const { handleParseWorkspace } = await loadParserWorkerModule();

    const response = await handleParseWorkspace({
      type: 'parseWorkspace',
      id: 'workspace-3',
      files: [
        {
          name: '[cdm]/base.rosetta',
          content: 'ignored',
          serializedModelJson: '{"$type":"RosettaModel","elements":[]}'
        },
        {
          name: '[cdm]/types.rosetta',
          content: 'namespace cdm.types',
          serializedModelJson: '{"$type":"RosettaModel","elements":[]}',
          exports: [{ type: 'RosettaType', name: 'Party', path: '/elements/0' }]
        },
        { name: 'local.rosetta', content: 'namespace local' }
      ]
    });

    // Corpus files are NOT deserialized at workspace load — JSON is stored for lazy use
    expect(deserializeMock).not.toHaveBeenCalled();
    // Only the user file is added to LangiumDocuments at workspace load
    expect(addDocumentMock).toHaveBeenCalledTimes(1);
    expect(fromStringMock).toHaveBeenCalledWith('namespace local', 'local.rosetta');
    // types.rosetta has exports → registerExports called once for Langium scope resolution
    expect(registerExportsMock).toHaveBeenCalledTimes(1);

    // Only user file appears in parsedModels
    expect(response.type).toBe('parseWorkspaceResult');
    expect(response.parsedModels.map((m) => m.filePath)).toEqual(['local.rosetta']);
    // Stub entries for the namespace explorer UI still emitted
    expect(response.deferredExports).toHaveLength(1);
    expect(response.deferredExports[0]!.exports[0]!.name).toBe('Party');
    // Corpus models are NOT in models[] at workspace load (deferred)
    expect(response.models).toHaveLength(1);
  });

  it('deserializes corpus document on first link request, not at workspace parse', async () => {
    const modelA = { $type: 'RosettaModel', elements: [] };
    deserializeMock.mockReturnValueOnce(modelA);

    const fakeDoc = {
      diagnostics: [],
      parseResult: { value: modelA, lexerErrors: [], parserErrors: [] }
    };
    fromModelMock.mockReturnValue(fakeDoc);

    const { handleParseWorkspace, handleLinkDocument } = await loadParserWorkerModule();

    await handleParseWorkspace({
      type: 'parseWorkspace',
      id: 'ws-link',
      files: [
        {
          name: '[cdm]/types.rosetta',
          content: 'namespace cdm.types',
          serializedModelJson: '{"$type":"RosettaModel","elements":[]}',
          exports: [{ type: 'RosettaType', name: 'Party', path: '/elements/0' }]
        },
        {
          name: '[cdm]/enums.rosetta',
          content: 'namespace cdm.enums',
          serializedModelJson: '{"$type":"RosettaModel","elements":[]}',
          exports: [{ type: 'RosettaEnumeration', name: 'PartyRole', path: '/elements/0' }]
        }
      ]
    });

    // No deserialization at workspace parse — corpus JSON is stored for lazy use
    expect(deserializeMock).not.toHaveBeenCalled();

    const linkResult = await handleLinkDocument({
      type: 'linkDocument',
      id: 'link-1',
      uri: '[cdm]/types.rosetta'
    });

    // Target corpus doc deserialized exactly once on first link request
    expect(deserializeMock).toHaveBeenCalledTimes(1);
    expect(fromModelMock).toHaveBeenCalledTimes(1);
    expect(addDocumentMock).toHaveBeenCalledTimes(1);
    // Build called with eagerLinking: true — RuneDslLinker handles transitive deps
    expect(buildMock).toHaveBeenLastCalledWith([fakeDoc], {
      validation: false,
      eagerLinking: true
    });
    expect(linkResult.linked).toBe(true);
    expect(linkResult.type).toBe('linkDocumentResult');
    // Newly deserialized corpus model returned for graph hydration
    expect(linkResult.newModels).toEqual([modelA]);
  });

  it('does not re-deserialize deferred documents on a second linkDocument call', async () => {
    const hydratedModel = { $type: 'RosettaModel', elements: [] };
    deserializeMock.mockReturnValue(hydratedModel);

    const fakeDoc = {
      diagnostics: [],
      parseResult: { value: hydratedModel, lexerErrors: [], parserErrors: [] }
    };
    fromModelMock.mockReturnValue(fakeDoc);

    const { handleParseWorkspace, handleLinkDocument } = await loadParserWorkerModule();

    await handleParseWorkspace({
      type: 'parseWorkspace',
      id: 'ws-once',
      files: [
        {
          name: '[cdm]/types.rosetta',
          content: 'ignored',
          serializedModelJson: '{"$type":"RosettaModel","elements":[]}',
          exports: [{ type: 'RosettaType', name: 'Party', path: '/elements/0' }]
        }
      ]
    });

    // First linkDocument — materializes the corpus doc from deferredModelJson
    const firstResult = await handleLinkDocument({
      type: 'linkDocument',
      id: 'link-1',
      uri: '[cdm]/types.rosetta'
    });
    expect(deserializeMock).toHaveBeenCalledTimes(1);
    expect(firstResult.newModels).toHaveLength(1);

    // Second call — deferredModelJson entry is consumed; doc found via LangiumDocuments
    // Deserialize must NOT be called again and newModels must be empty
    hasDocumentMock.mockReturnValue(true);
    getDocumentMock.mockReturnValue(fakeDoc);
    const secondResult = await handleLinkDocument({
      type: 'linkDocument',
      id: 'link-2',
      uri: '[cdm]/types.rosetta'
    });
    expect(deserializeMock).toHaveBeenCalledTimes(1);
    expect(secondResult.newModels).toEqual([]);
  });

  it('links a single document on demand after lazy workspace parse', async () => {
    const fakeDoc = {
      diagnostics: [],
      parseResult: { value: { $type: 'RosettaModel', elements: [] }, parserErrors: [] }
    };
    hasDocumentMock.mockReturnValue(true);
    getDocumentMock.mockReturnValue(fakeDoc);

    const { handleParseWorkspace, handleLinkDocument } = await loadParserWorkerModule();

    const wsResult = await handleParseWorkspace({
      type: 'parseWorkspace',
      id: 'ws-link',
      files: [
        {
          name: 'inmemory:///types.rosetta',
          content: 'namespace test\n\ntype Foo:\n  bar string (1..1)'
        },
        {
          name: 'inmemory:///refs.rosetta',
          content: 'namespace test\n\ntype Bar:\n  foo Foo (1..1)'
        }
      ]
    });
    expect(wsResult.models).toHaveLength(2);

    const linkResult = await handleLinkDocument({
      type: 'linkDocument',
      id: 'link-1',
      uri: 'inmemory:///refs.rosetta'
    });
    expect(linkResult.linked).toBe(true);
    expect(linkResult.type).toBe('linkDocumentResult');
    expect(linkResult.newModels).toEqual([]);
    expect(buildMock).toHaveBeenLastCalledWith([fakeDoc], {
      validation: false,
      eagerLinking: true
    });
  });

  it('returns linked: false for unknown document URIs', async () => {
    hasDocumentMock.mockReturnValue(false);

    const { handleLinkDocument } = await loadParserWorkerModule();

    const result = await handleLinkDocument({
      type: 'linkDocument',
      id: 'link-unknown',
      uri: 'inmemory:///does-not-exist.rosetta'
    });
    expect(result.linked).toBe(false);
    expect(result.type).toBe('linkDocumentResult');
    expect(result.errors).toEqual([]);
    expect(result.newModels).toEqual([]);
  });

  // Regression: surfaced by 2026-05-20 prod-smoke check. When the parser
  // worker module is imported by `services/workspace.ts` for its response
  // type guards, its top-level code must NOT register a `message` listener
  // on the main-thread `globalThis` / `window`. Previously the guard
  // `typeof self !== 'undefined' && typeof self.postMessage === 'function'`
  // was true in browsers because `self === window` and `window.postMessage`
  // exists, so arbitrary messages reaching the page (extensions, embed
  // beacons, cross-origin frames) crashed with `TypeError: Cannot read
  // properties of undefined (reading 'type')`.
  it('does not register a message listener when imported in a non-worker context', async () => {
    const addListener = vi.fn();
    const postMessage = vi.fn();
    // Simulate browser-main-thread `self`: has postMessage, NOT a WorkerGlobalScope.
    vi.stubGlobal('self', {
      addEventListener: addListener,
      postMessage
      // intentionally no `importScripts` and no instanceof WorkerGlobalScope
    });

    await loadParserWorkerModule();

    const messageListenerCalls = addListener.mock.calls.filter((args) => args[0] === 'message');
    expect(messageListenerCalls).toEqual([]);
  });
});
