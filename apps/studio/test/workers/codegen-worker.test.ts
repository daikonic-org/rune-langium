// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/projection-format.js', () => ({
  formatGeneratedProjection: async (projection: unknown) => projection
}));

const buildMock = vi.fn(async () => undefined);
const fromStringMock = vi.fn((content: string, uri: string) => ({
  uri,
  content,
  diagnostics: [],
  parseResult: { value: { uri, content }, lexerErrors: [], parserErrors: [] }
}));
const generateMock = vi.fn(() => []);
const generatePythonMock = vi.fn(() => ({ code: '', projections: [], bindings: new Map() }));
const selectPythonProjectionMock = vi.fn((_module, subject) => ({
  language: 'python',
  subject,
  code: 'def F(input: F_Input) -> float:\n    return 1.0\n',
  sourceMap: [],
  requiredHelpers: []
}));
const selectProjectionMock = vi.fn((_outputs, subject) => ({
  language: 'typescript',
  subject,
  code: 'export function F(): number { return 1; }',
  sourceMap: [],
  requiredHelpers: []
}));
const generatePreviewSchemasMock = vi.fn(() => []);
const emitStandaloneZodSchemaMock = vi.fn(() => ({ code: '', diagnostics: [] }));
// 019 Task #88 follow-up — curated entries hit `RuneDsl.serializer.JsonSerializer.deserialize`
// in `buildDocuments`. Mock returns a marker object that the assertions
// can identify in the deserialized-docs array.
const deserializeMock = vi.fn((json: string) => ({
  __deserialized: true,
  json
}));
// PR #169 follow-up — curated entries are wrapped via
// `factory.fromModel(model, uri)` and registered through
// `langiumDocuments.addDocument(doc)` so Langium's linker can resolve
// cross-references through `.ref`. Mock both methods and a backing
// `getDocument` lookup so the worker's idempotence check works.
const fromModelMock = vi.fn((model: unknown, uri: string) => ({
  uri,
  parseResult: { value: model, lexerErrors: [], parserErrors: [] }
}));
const registered = new Map<string, unknown>();
const getDocumentMock = vi.fn((uri: string) => registered.get(uri));
const addDocumentMock = vi.fn((doc: { uri: string }) => {
  registered.set(doc.uri, doc);
});
const deleteDocumentMock = vi.fn((uri: string) => {
  const existing = registered.get(uri);
  registered.delete(uri);
  return existing;
});

// `hydrateModelDocuments` (Task 2) is the REAL implementation, not a mock —
// it only calls getDocument/addDocument/deleteDocument?./LangiumDocumentFactory.fromModel
// plus JsonSerializer.deserialize, all provided by the mocked services below,
// so running it here exercises the actual relink loop. Imported directly
// from its compiled dist submodule rather than via `importOriginal` on the
// `@rune-langium/core` barrel: the barrel's index.js also re-exports the
// langium-zod-GENERATED ast/domain modules, which instantiate a real
// langium `AbstractAstReflection` at import time — that would require this
// file's minimal `vi.mock('langium', ...)` stub below (just `URI.parse`) to
// provide the entire real langium API surface just to load. The
// hydrate-model-document submodule only imports `URI` from 'langium',
// which the stub already covers.
//
// Precondition: this reads packages/core's COMPILED dist output, not its
// TS source, so it requires `pnpm --filter @rune-langium/core build` to
// have been run first. CI's build:ci already does this before tests run;
// for a fresh clone or after editing packages/core/src/ locally without
// rebuilding, this import will module-not-found (fresh clone, no dist/ at
// all) or silently exercise stale compiled behavior (edited src, stale
// dist) — rebuild packages/core if this test starts failing unexpectedly.
const { hydrateModelDocuments: realHydrateModelDocuments } =
  await import('../../../../packages/core/dist/serializer/hydrate-model-document.js');

const projectionOwner = {
  $type: 'RosettaFunction',
  name: 'F',
  $document: { uri: 'file:///f.rosetta', parseResult: { value: { name: 'f' } } }
};

vi.mock('@rune-langium/core', () => {
  return {
    createRuneDslServices: () => ({
      RuneDsl: {
        shared: {
          workspace: {
            LangiumDocumentFactory: { fromString: fromStringMock, fromModel: fromModelMock },
            DocumentBuilder: { build: buildMock },
            LangiumDocuments: {
              getDocument: getDocumentMock,
              addDocument: addDocumentMock,
              deleteDocument: deleteDocumentMock
            }
          }
        },
        serializer: {
          JsonSerializer: {
            deserialize: deserializeMock,
            deserializeModels: (contents: string[], register: (models: unknown[]) => void) => {
              const models = contents.map((json) => deserializeMock(json));
              register(models);
              return models;
            }
          }
        }
      }
    }),
    hydrateModelDocument: (_services: unknown, uri: string, json: string, { register }: { register: string }) => {
      const model = deserializeMock(json);
      const existing = register === 'idempotent' ? getDocumentMock(uri) : undefined;
      if (existing) {
        return { model, document: existing };
      }
      const document = fromModelMock(model, uri);
      if (register === 'always' || register === 'idempotent') {
        addDocumentMock(document);
      }
      return { model, document };
    },
    hydrateModelDocuments: realHydrateModelDocuments,
    getExpressionOwners: () => [projectionOwner],
    getFunctionImplementationRegion: () => ({ from: 0, to: 20 }),
    getNodeSourceRegion: () => ({ from: 0, to: 20 }),
    isRosettaFunction: (node: { $type: string }) => node.$type === 'RosettaFunction',
    namespaceFromModelName: (name: string) => name,
    qualifiedExportPath: (namespace: string, name: string) => `${namespace}.${name}`
  };
});

vi.mock('@rune-langium/codegen/export', () => ({
  generate: generateMock,
  resolveExportSelection: (documents: unknown[]) => ({ documents }),
  selectTypeScriptProjection: selectProjectionMock,
  generatePythonModule: generatePythonMock,
  selectPythonProjection: selectPythonProjectionMock,
  generatePreviewSchemas: generatePreviewSchemasMock,
  emitStandaloneZodSchema: emitStandaloneZodSchemaMock,
  RUNTIME_HELPER_JS_SOURCE: 'const runeToField = undefined; const runeToReference = undefined;',
  normalizePreviewInputs: (_documents: unknown, _targetId: string, inputs: unknown) => inputs
}));

const getActiveConditionPredicatesMock = vi.fn(() => []);
const findDataNodeMock = vi.fn(() => undefined);

vi.mock('@rune-langium/codegen/instances', () => ({
  getActiveConditionPredicates: getActiveConditionPredicatesMock,
  findDataNode: findDataNodeMock
}));

vi.mock('langium', () => ({
  AstUtils: { getDocument: (node: { $document: unknown }) => node.$document },
  URI: {
    parse: (value: string) => value
  }
}));

async function loadWorkerModule() {
  vi.resetModules();
  let messageHandler: ((event: MessageEvent<unknown>) => void) | undefined;
  const scope = {
    addEventListener: vi.fn((type: string, listener: (event: MessageEvent<unknown>) => void) => {
      if (type === 'message') {
        messageHandler = listener;
      }
    }),
    postMessage: vi.fn(),
    // Required by `isWorkerGlobalScope` in src/workers/runtime-guards.ts —
    // its fallback branch checks `typeof self.importScripts === 'function'`
    // when the env doesn't expose a `WorkerGlobalScope` constructor (as
    // jsdom/node don't). Without this the listener registration is skipped
    // and every dispatch below would throw "Worker message handler was not
    // registered".
    importScripts: () => {
      /* no-op */
    }
  };

  vi.stubGlobal('self', scope);
  await import('../../src/workers/codegen-worker.ts');

  return {
    scope,
    dispatch(data: unknown) {
      if (!messageHandler) {
        throw new Error('Worker message handler was not registered');
      }
      messageHandler({ data } as MessageEvent<unknown>);
    }
  };
}

async function flushWorker() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('codegen-worker preview messages', () => {
  it.each(['typescript', 'python'])(
    'reuses %s generation for identical receipts and invalidates when a dependency changes',
    async (language) => {
      const generate = language === 'python' ? generatePythonMock : generateMock;
      const { scope, dispatch } = await loadWorkerModule();
      const files = [
        { uri: 'file:///f.rosetta', content: 'namespace f\nfunc F: output: result int (1..1) set result: 1' },
        { uri: 'file:///dep.rosetta', content: 'namespace dep\ntype D:' }
      ];
      const request = {
        type: 'projection:generate',
        language,
        kind: 'function',
        source: files[0].content,
        subject: { uri: files[0].uri, nodeId: 'f.F#RosettaFunction', region: { from: 0, to: 20 } },
        filesRevision: 1
      };
      dispatch({ type: 'preview:setFiles', files, filesRevision: 1 });
      dispatch({ ...request, requestId: 'project:first' });
      await flushWorker();
      expect(generate).toHaveBeenCalledOnce();
      dispatch({ type: 'preview:setFiles', files: structuredClone(files), filesRevision: 2 });
      dispatch({ ...request, filesRevision: 2, requestId: 'project:again' });
      await flushWorker();
      expect(generate).toHaveBeenCalledOnce();
      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'projection:result', requestId: 'project:again' })
      );
      dispatch({
        type: 'preview:setFiles',
        files: [files[0], { ...files[1], content: 'namespace dep\ntype Changed:' }],
        filesRevision: 3
      });
      dispatch({ ...request, filesRevision: 3, requestId: 'project:dependency' });
      await flushWorker();
      expect(generate).toHaveBeenCalledTimes(2);
    }
  );
  it.each(['typescript', 'python'])(
    'rejects a %s generation reply superseded by another source snapshot',
    async (language) => {
      const generate = language === 'python' ? generatePythonMock : generateMock;
      const { scope, dispatch } = await loadWorkerModule();
      let release;
      generate.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      const file = { uri: 'file:///f.rosetta', content: 'namespace f\nfunc F:' };
      dispatch({ type: 'preview:setFiles', files: [file], filesRevision: 1 });
      dispatch({
        type: 'projection:generate',
        requestId: 'project:late',
        language,
        kind: 'function',
        filesRevision: 1,
        source: file.content,
        subject: { uri: file.uri, nodeId: 'f.F#RosettaFunction', region: { from: 0, to: 20 } }
      });
      await flushWorker();
      dispatch({ type: 'preview:setFiles', files: [{ ...file, content: file.content + '\n' }], filesRevision: 2 });
      release([]);
      await flushWorker();
      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'projection:error',
          requestId: 'project:late',
          error: expect.stringContaining('source changed')
        })
      );
    }
  );
  it('acknowledges the exact installed preview file revision', async () => {
    const { scope, dispatch } = await loadWorkerModule();
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 42,
      requestId: 'files:ack',
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "beta"' }]
    });
    await flushWorker();
    expect(scope.postMessage).toHaveBeenCalledWith({
      type: 'preview:files-ready',
      requestId: 'files:ack',
      filesRevision: 42
    });
  });

  beforeEach(() => {
    buildMock.mockReset();
    buildMock.mockImplementation(async () => undefined);
    fromStringMock.mockClear();
    generateMock.mockClear();
    generatePythonMock.mockClear();
    generatePreviewSchemasMock.mockReset();
    deserializeMock.mockClear();
    deserializeMock.mockImplementation((json: string) => ({ __deserialized: true, json }));
    fromModelMock.mockClear();
    fromModelMock.mockImplementation((model: unknown, uri: string) => ({
      uri,
      parseResult: { value: model, lexerErrors: [], parserErrors: [] }
    }));
    registered.clear();
    deleteDocumentMock.mockClear();
    getDocumentMock.mockClear();
    addDocumentMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts preview:stale with no-files when preview generation is requested before files are loaded', async () => {
    const { scope, dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:generate',
      targetId: 'beta.Trade',
      requestId: 'preview:beta.Trade:1'
    });
    await flushWorker();

    expect(scope.postMessage).toHaveBeenCalledWith({
      type: 'preview:stale',
      targetId: 'beta.Trade',
      requestId: 'preview:beta.Trade:1',
      reason: 'no-files',
      message: 'No files are loaded for form preview.'
    });
  });

  it('re-runs the last preview target after preview:setFiles and posts preview:result', async () => {
    generatePreviewSchemasMock.mockReturnValue([
      {
        schemaVersion: 1,
        targetId: 'beta.Trade',
        title: 'Trade',
        status: 'ready',
        fields: []
      }
    ]);

    const { scope, dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:generate',
      targetId: 'beta.Trade',
      requestId: 'preview:beta.Trade:2'
    });
    await flushWorker();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "beta"' }],
      requestId: 'preview:beta.Trade:3'
    });
    await flushWorker();

    expect(fromStringMock).toHaveBeenCalledWith('namespace "beta"', 'file:///trade.rosetta');
    expect(generatePreviewSchemasMock).toHaveBeenCalledWith(expect.any(Array), {
      targetId: 'beta.Trade'
    });
    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'preview:result',
      targetId: 'beta.Trade',
      requestId: 'preview:beta.Trade:3',
      schema: {
        schemaVersion: 1,
        targetId: 'beta.Trade',
        title: 'Trade',
        status: 'ready',
        fields: []
      }
    });
  });

  it('selects the function schema and retains its canonical target id', async () => {
    generatePreviewSchemasMock.mockReturnValue([
      { schemaVersion: 1, targetId: 'beta.Party', title: 'Party', status: 'ready', kind: 'data', fields: [] },
      { schemaVersion: 1, targetId: 'beta.Party', title: 'Party', status: 'ready', kind: 'function', fields: [] }
    ]);
    const { scope, dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///party.rosetta', content: 'namespace "beta"' }],
      requestId: 'function:files'
    });
    await flushWorker();
    dispatch({
      type: 'preview:generate',
      targetId: 'beta.Party#RosettaFunction',
      requestId: 'function:preview'
    });
    await flushWorker();

    expect(generatePreviewSchemasMock).toHaveBeenLastCalledWith(expect.any(Array), { targetId: 'beta.Party' });
    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'preview:result',
      targetId: 'beta.Party#RosettaFunction',
      requestId: 'function:preview',
      schema: {
        schemaVersion: 1,
        targetId: 'beta.Party#RosettaFunction',
        title: 'Party',
        status: 'ready',
        kind: 'function',
        fields: []
      }
    });
  });

  it('selects the function schema and retains its canonical target id', async () => {
    generatePreviewSchemasMock.mockReturnValue([
      { schemaVersion: 1, targetId: 'beta.Party', title: 'Party', status: 'ready', kind: 'data', fields: [] },
      { schemaVersion: 1, targetId: 'beta.Party', title: 'Party', status: 'ready', kind: 'function', fields: [] }
    ]);
    const { scope, dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///party.rosetta', content: 'namespace "beta"' }],
      requestId: 'function:files'
    });
    await flushWorker();
    dispatch({
      type: 'preview:generate',
      targetId: 'beta.Party#RosettaFunction',
      requestId: 'function:preview'
    });
    await flushWorker();

    expect(generatePreviewSchemasMock).toHaveBeenLastCalledWith(expect.any(Array), { targetId: 'beta.Party' });
    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'preview:result',
      targetId: 'beta.Party#RosettaFunction',
      requestId: 'function:preview',
      schema: {
        schemaVersion: 1,
        targetId: 'beta.Party#RosettaFunction',
        title: 'Party',
        status: 'ready',
        kind: 'function',
        fields: []
      }
    });
  });

  it('caches buildDocuments() results across calls when files have not changed', async () => {
    generatePreviewSchemasMock.mockImplementation((_documents: unknown, options: { targetId: string }) => [
      { schemaVersion: 1, targetId: options.targetId, title: options.targetId, status: 'ready', fields: [] }
    ]);

    const { dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "beta"' }],
      requestId: 'cache:1'
    });
    await flushWorker();

    dispatch({
      type: 'preview:generate',
      targetId: 'beta.Trade',
      requestId: 'cache:2'
    });
    await flushWorker();

    // A DIFFERENT targetId, so previewSchemaCache (which caches per-targetId)
    // doesn't short-circuit this second call before it reaches
    // generatePreviewSchemas — isolating this test to buildDocuments()'s own
    // cache rather than the schema-level one added on top of it.
    dispatch({
      type: 'preview:generate',
      targetId: 'beta.Event',
      requestId: 'cache:3'
    });
    await flushWorker();

    // Only the FIRST preview:generate should have triggered a real parse —
    // the second must hit the cache instead of re-parsing.
    expect(fromStringMock).toHaveBeenCalledTimes(1);
    expect(buildMock).toHaveBeenCalledTimes(1);

    // Both calls to generatePreviewSchemas must have received the exact
    // same documents array instance (not just equal content) — proves
    // buildDocuments() returned its cached result, not a fresh array.
    const firstCallDocuments = generatePreviewSchemasMock.mock.calls[0]![0];
    const secondCallDocuments = generatePreviewSchemasMock.mock.calls[1]![0];
    expect(secondCallDocuments).toBe(firstCallDocuments);
  });

  it('reuses documents for another receipt of unchanged file contents', async () => {
    generatePreviewSchemasMock.mockReturnValue([
      {
        schemaVersion: 1,
        targetId: 'beta.Trade',
        title: 'Trade',
        status: 'ready',
        fields: []
      }
    ]);

    const files = [{ uri: 'file:///trade.rosetta', content: 'namespace "beta"' }];
    const { dispatch } = await loadWorkerModule();

    dispatch({ type: 'preview:setFiles', filesRevision: 1, files, requestId: 'inval:1' });
    await flushWorker();
    dispatch({ type: 'preview:generate', targetId: 'beta.Trade', requestId: 'inval:2' });
    await flushWorker();

    // A readiness receipt acknowledges delivery; only changed content invalidates.
    dispatch({ type: 'preview:setFiles', filesRevision: 1, files: [...files], requestId: 'inval:3' });
    await flushWorker();
    dispatch({ type: 'preview:generate', targetId: 'beta.Trade', requestId: 'inval:4' });
    await flushWorker();

    expect(fromStringMock).toHaveBeenCalledOnce();
    expect(buildMock).toHaveBeenCalledOnce();
    expect(generatePreviewSchemasMock).toHaveBeenCalledOnce();
  });

  it('does not let a build suspended across a preview:setFiles poison the cache with stale documents', async () => {
    generatePreviewSchemasMock.mockImplementation((_documents: unknown, options: { targetId: string }) => [
      { schemaVersion: 1, targetId: options.targetId, title: options.targetId, status: 'ready', fields: [] }
    ]);

    const buildResolvers: Array<() => void> = [];
    buildMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          buildResolvers.push(resolve);
        })
    );

    const { dispatch } = await loadWorkerModule();

    // Call #1 starts against file set A and suspends inside builder.build.
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "A"' }],
      requestId: 'race:1'
    });
    await flushWorker();
    dispatch({ type: 'preview:generate', targetId: 'beta.Trade', requestId: 'race:2' });
    await flushWorker();

    // The file set changes to B WHILE call #1 is still suspended. This bumps
    // previewFilesVersion and — because lastPreviewTargetId is already set —
    // triggers a second, independent buildDocuments() call (#2) against B,
    // which also suspends inside its own builder.build.
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "B"' }],
      requestId: 'race:3'
    });
    await flushWorker();

    expect(buildResolvers).toHaveLength(2);

    // Resolve the SECOND (current, correct) call first, then the FIRST
    // (now-stale) call last — the exact ordering that would let a stale
    // resume silently overwrite an already-cached correct result if the
    // version weren't re-checked before writing to documentsCache.
    buildResolvers[1]!();
    await flushWorker();
    buildResolvers[0]!();
    await flushWorker();

    // Query a DIFFERENT targetId — previewSchemaCache has no entry for it
    // yet (only 'beta.Trade' was resolved above), so this forces a fresh
    // generatePreviewSchemas call using whatever buildDocuments() actually
    // has cached, isolating this assertion to documentsCache's own race
    // guard rather than previewSchemaCache's (which already cached the
    // correct schema for 'beta.Trade' above and would otherwise mask a
    // documentsCache regression for a same-targetId re-query).
    const fromStringCallsBeforeFourthRequest = fromStringMock.mock.calls.length;
    dispatch({ type: 'instance:generateSchema', typeFqn: 'beta.Event', requestId: 'race:4' });
    await flushWorker();

    expect(fromStringMock).toHaveBeenCalledTimes(fromStringCallsBeforeFourthRequest);

    const fourthCallDocuments = generatePreviewSchemasMock.mock.calls.at(-1)![0] as Array<{ content?: string }>;
    expect(fourthCallDocuments.some((d) => d.content === 'namespace "B"')).toBe(true);
    expect(fourthCallDocuments.some((d) => d.content === 'namespace "A"')).toBe(false);
  });

  it('posts preview:stale with unsupported-target when no preview schema is available', async () => {
    generatePreviewSchemasMock.mockReturnValue([]);

    const { scope, dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "beta"' }],
      requestId: 'preview:beta.Trade:4'
    });
    await flushWorker();

    dispatch({
      type: 'preview:generate',
      targetId: 'beta.Trade',
      requestId: 'preview:beta.Trade:5'
    });
    await flushWorker();

    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'preview:stale',
      targetId: 'beta.Trade',
      requestId: 'preview:beta.Trade:5',
      reason: 'unsupported-target',
      message: 'No form preview schema is available for beta.Trade.'
    });
  });

  it('posts preview:stale with parse-error when preview files fail validation', async () => {
    buildMock.mockImplementation(async (documents: Array<{ diagnostics: Array<{ severity: number }> }>) => {
      documents[0]!.diagnostics = [{ severity: 1 }];
    });

    const { scope, dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "beta"' }],
      requestId: 'preview:beta.Trade:6'
    });
    await flushWorker();

    dispatch({
      type: 'preview:generate',
      targetId: 'beta.Trade',
      requestId: 'preview:beta.Trade:7'
    });
    await flushWorker();

    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'preview:stale',
      targetId: 'beta.Trade',
      requestId: 'preview:beta.Trade:7',
      reason: 'parse-error',
      message: 'No valid files to generate a form preview from.'
    });
  });

  it('posts preview:stale with parse-error when preview files contain parser errors', async () => {
    buildMock.mockImplementation(
      async (documents: Array<{ parseResult: { parserErrors: Array<{ message: string }> } }>) => {
        documents[0]!.parseResult.parserErrors = [{ message: 'Unexpected token' }];
      }
    );

    const { scope, dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'broken syntax' }],
      requestId: 'preview:beta.Trade:parser-error'
    });
    await flushWorker();

    dispatch({
      type: 'preview:generate',
      targetId: 'beta.Trade',
      requestId: 'preview:beta.Trade:parser-error:generate'
    });
    await flushWorker();

    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'preview:stale',
      targetId: 'beta.Trade',
      requestId: 'preview:beta.Trade:parser-error:generate',
      reason: 'parse-error',
      message: 'No valid files to generate a form preview from.'
    });
  });

  it('posts preview:stale with generation-error when preview schema generation throws', async () => {
    generatePreviewSchemasMock.mockImplementation(() => {
      throw new Error('Preview schema generation failed.');
    });

    const { scope, dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "beta"' }],
      requestId: 'preview:beta.Trade:8'
    });
    await flushWorker();

    dispatch({
      type: 'preview:generate',
      targetId: 'beta.Trade',
      requestId: 'preview:beta.Trade:9'
    });
    await flushWorker();

    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'preview:stale',
      targetId: 'beta.Trade',
      requestId: 'preview:beta.Trade:9',
      reason: 'generation-error',
      message: 'Preview schema generation failed.'
    });
  });

  it('does not rerun preview:setFiles when no consumable preview request id exists', async () => {
    const { scope, dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:generate',
      targetId: 'beta.Trade'
    } as never);
    await flushWorker();

    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'preview:stale',
      targetId: 'beta.Trade',
      requestId: undefined,
      reason: 'no-files',
      message: 'No files are loaded for form preview.'
    });

    scope.postMessage.mockClear();
    generatePreviewSchemasMock.mockClear();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "beta"' }]
    });
    await flushWorker();

    expect(generatePreviewSchemasMock).not.toHaveBeenCalled();
    expect(scope.postMessage).not.toHaveBeenCalled();
  });

  it("instance:generateSchema posts instance:generateSchemaResult and does NOT corrupt the Preview perspective's own re-run target (finding #6/#7)", async () => {
    generatePreviewSchemasMock.mockImplementation((_docs: unknown, opts: { targetId: string }) => {
      if (opts.targetId === 'beta.Trade') {
        return [{ schemaVersion: 1, targetId: 'beta.Trade', title: 'Trade', status: 'ready', fields: [] }];
      }
      if (opts.targetId === 'instance.Party') {
        return [{ schemaVersion: 1, targetId: 'instance.Party', title: 'Party', status: 'ready', fields: [] }];
      }
      return [];
    });

    const { scope, dispatch } = await loadWorkerModule();

    // Files are loaded and the Preview perspective selects `beta.Trade`.
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "beta"' }],
      requestId: 'preview:beta.Trade:1'
    });
    await flushWorker();
    dispatch({
      type: 'preview:generate',
      targetId: 'beta.Trade',
      requestId: 'preview:beta.Trade:2'
    });
    await flushWorker();

    // Instance-editing requests a schema for an UNRELATED type on its own
    // channel — this must not touch the worker's preview re-run target.
    dispatch({
      type: 'instance:generateSchema',
      typeFqn: 'instance.Party',
      requestId: 'schema:instance.Party:1'
    });
    await flushWorker();

    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'instance:generateSchemaResult',
      requestId: 'schema:instance.Party:1',
      schema: { schemaVersion: 1, targetId: 'instance.Party', title: 'Party', status: 'ready', fields: [] }
    });

    // A subsequent workspace file change re-runs the Preview perspective's
    // LAST target — must still be `beta.Trade`, not `instance.Party`.
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "beta" // edited' }],
      requestId: 'preview:beta.Trade:3'
    });
    await flushWorker();

    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'preview:result',
      targetId: 'beta.Trade',
      requestId: 'preview:beta.Trade:3',
      schema: { schemaVersion: 1, targetId: 'beta.Trade', title: 'Trade', status: 'ready', fields: [] }
    });
  });

  it('instance:generateSchema posts instance:generateSchemaStale with unsupported-target when no schema is available', async () => {
    generatePreviewSchemasMock.mockReturnValue([]);

    const { scope, dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "beta"' }],
      requestId: 'preview:beta.Trade:1'
    });
    await flushWorker();

    dispatch({
      type: 'instance:generateSchema',
      typeFqn: 'instance.Unknown',
      requestId: 'schema:instance.Unknown:1'
    });
    await flushWorker();

    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'instance:generateSchemaStale',
      requestId: 'schema:instance.Unknown:1',
      reason: 'unsupported-target',
      message: 'No form preview schema is available for instance.Unknown.'
    });
  });

  it('instance:generateSchema posts instance:generateSchemaStale with no-files before any files are loaded', async () => {
    const { scope, dispatch } = await loadWorkerModule();

    dispatch({
      type: 'instance:generateSchema',
      typeFqn: 'instance.Party',
      requestId: 'schema:instance.Party:1'
    });
    await flushWorker();

    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'instance:generateSchemaStale',
      requestId: 'schema:instance.Party:1',
      reason: 'no-files',
      message: 'No files are loaded for form preview.'
    });
  });
});

describe('codegen-worker execute messages', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['build', 'generate'])('returns a terminal execution error when %s fails', async (stage) => {
    const { scope, dispatch } = await loadWorkerModule();
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///failed.rosetta', content: 'namespace failed' }]
    });
    const failing = stage === 'build' ? buildMock : generateMock;
    failing.mockImplementationOnce(() => {
      throw new Error(`${stage} failed`);
    });
    dispatch({ type: 'preview:execute', funcName: 'failed.Run', inputs: {}, requestId: 'failed:1' });
    await vi.waitFor(() =>
      expect(scope.postMessage).toHaveBeenCalledWith({
        type: 'preview:execute-error',
        funcName: 'failed.Run',
        requestId: 'failed:1',
        error: `${stage} failed`
      })
    );
  });

  it('posts preview:execute-error when function is not in cache', async () => {
    const { scope, dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:execute',
      funcName: 'beta.Trade',
      inputs: { symbol: 'AAPL', quantity: 10 },
      requestId: 'exec:beta.Trade:1'
    });

    await vi.waitFor(() => {
      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'preview:execute-error',
          requestId: 'exec:beta.Trade:1',
          funcName: 'beta.Trade'
        })
      );
    });
  });

  // Regression mirror of parser-worker.test.ts (PR #214). If anything in the
  // main bundle ever statically imports from `codegen-worker.ts` (e.g. for
  // type re-exports), the bottom-of-module listener must NOT register on
  // `window` / main-thread `self`. PR #214's body explicitly flagged this
  // worker as carrying the same anti-pattern; the shared
  // `isWorkerGlobalScope` helper from `src/workers/runtime-guards.ts`
  // closes the gap.
  it('does not register a message listener when imported in a non-worker context', async () => {
    const addListener = vi.fn();
    const postMessage = vi.fn();
    // Simulate browser-main-thread `self`: has postMessage, NOT a WorkerGlobalScope
    // and NO `importScripts`.
    vi.stubGlobal('self', {
      addEventListener: addListener,
      postMessage
    });

    vi.resetModules();
    await import('../../src/workers/codegen-worker.ts');

    const messageListenerCalls = addListener.mock.calls.filter((args) => args[0] === 'message');
    expect(messageListenerCalls).toEqual([]);
  });

  it('error message indicates function not found', async () => {
    const { scope, dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:execute',
      funcName: 'alpha.Foo',
      inputs: {},
      requestId: 'exec:alpha.Foo:1'
    });

    await vi.waitFor(() => {
      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'preview:execute-error',
          funcName: 'alpha.Foo',
          error: expect.stringContaining('not found')
        })
      );
    });
  });
});

describe('codegen-worker previewGenerateCache (executeFunction)', () => {
  beforeEach(() => {
    buildMock.mockReset();
    buildMock.mockImplementation(async () => undefined);
    fromStringMock.mockClear();
    generateMock.mockClear();
    generateMock.mockReturnValue([]);
    emitStandaloneZodSchemaMock.mockReset();
    emitStandaloneZodSchemaMock.mockReturnValue({
      code: 'export const $Rune$FunctionInputsSchema = z.record(z.string(), z.unknown());',
      diagnostics: [],
      schemaName: '$Rune$FunctionInputsSchema'
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validates inputs before calling a lean function and caches the input schema', async () => {
    generateMock.mockReturnValue([
      {
        relativePath: 'alpha.ts',
        content: 'export function Run(count) { return count + 1; }',
        diagnostics: [],
        funcs: [{ name: 'Run', parameterNames: ['count'], fileContents: '' }]
      }
    ]);
    emitStandaloneZodSchemaMock.mockReturnValue({
      code: 'export const $Rune$FunctionInputsSchema: z.ZodType<{count: number}> = z.object({count: z.number().int()});\nexport type $Rune$FunctionInputs = z.infer<typeof $Rune$FunctionInputsSchema>;',
      diagnostics: [],
      schemaName: '$Rune$FunctionInputsSchema'
    });
    const { scope, dispatch } = await loadWorkerModule();
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///run.rosetta', content: 'namespace alpha' }]
    });
    await flushWorker();
    dispatch({ type: 'preview:execute', funcName: 'alpha.Run', inputs: { count: 'bad' }, requestId: 'invalid' });
    await flushWorker();
    expect(scope.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'preview:execute-error',
        requestId: 'invalid',
        error: expect.stringContaining('count:')
      })
    );
    dispatch({ type: 'preview:execute', funcName: 'alpha.Run', inputs: { count: 2 }, requestId: 'valid' });
    await flushWorker();
    expect(scope.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'preview:execute-result',
        requestId: 'valid',
        output: 3
      })
    );
    expect(emitStandaloneZodSchemaMock).toHaveBeenCalledTimes(1);
    expect(emitStandaloneZodSchemaMock).toHaveBeenCalledWith(expect.any(Array), 'alpha.Run', { functionInputs: true });
  });

  it('resolves a qualified function name on a fresh worker, without codegen:generate ever having run', async () => {
    generateMock.mockReturnValue([
      {
        relativePath: 'alpha.ts',
        content: 'export function CalcTrade(input) { return input; }',
        sourceMap: undefined,
        diagnostics: [],
        funcs: [{ name: 'CalcTrade', parameterNames: [], fileContents: 'function CalcTrade(input) { return input; }' }]
      }
    ]);

    const { scope, dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "alpha"' }],
      requestId: 'qualified:1'
    });
    await flushWorker();

    dispatch({
      type: 'preview:execute',
      funcName: 'alpha.CalcTrade#RosettaFunction',
      inputs: {},
      requestId: 'qualified:2'
    });
    await flushWorker();

    expect(scope.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'preview:execute-result',
        requestId: 'qualified:2',
        funcName: 'alpha.CalcTrade#RosettaFunction'
      })
    );
  });

  it('caches generate() across repeated preview:execute calls', async () => {
    generateMock.mockReturnValue([
      {
        relativePath: 'alpha.ts',
        content: 'export function CalcTrade(input) { return input; }',
        sourceMap: undefined,
        diagnostics: [],
        funcs: [{ name: 'CalcTrade', parameterNames: [], fileContents: 'function CalcTrade(input) { return input; }' }]
      }
    ]);

    const { dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "alpha"' }],
      requestId: 'hit:1'
    });
    await flushWorker();

    dispatch({ type: 'preview:execute', funcName: 'CalcTrade', inputs: {}, requestId: 'hit:2' });
    await flushWorker();
    dispatch({ type: 'preview:execute', funcName: 'CalcTrade', inputs: {}, requestId: 'hit:3' });
    await flushWorker();

    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it('invalidates the cached function code after preview:setFiles', async () => {
    generateMock.mockReturnValue([
      {
        relativePath: 'alpha.ts',
        content: 'export function CalcTrade(input) { return input; }',
        sourceMap: undefined,
        diagnostics: [],
        funcs: [{ name: 'CalcTrade', parameterNames: [], fileContents: 'function CalcTrade(input) { return input; }' }]
      }
    ]);

    const { dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "alpha"' }],
      requestId: 'inv:1'
    });
    await flushWorker();
    dispatch({ type: 'preview:execute', funcName: 'CalcTrade', inputs: {}, requestId: 'inv:2' });
    await flushWorker();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "alpha"\n// dependency snapshot changed' }],
      requestId: 'inv:3'
    });
    await flushWorker();
    dispatch({ type: 'preview:execute', funcName: 'CalcTrade', inputs: {}, requestId: 'inv:4' });
    await flushWorker();

    expect(generateMock).toHaveBeenCalledTimes(2);
  });

  it('transpiles nested calls with generic metadata and set helpers', async () => {
    generateMock.mockReturnValue([
      {
        relativePath: 'alpha.ts',
        content: `
          const runeWithMeta = <T, K extends string>(value: T, entries: Record<K, unknown>): T => value;
          const runeDistinct = <T>(values: readonly T[]): T[] => Array.from(new Set(values));
          const increment = (value: number): number => value + 1;
          export function Summarize(values: number[]): number[] {
            return runeWithMeta(runeDistinct(values.map(increment)), { source: 'preview' });
          }
        `,
        sourceMap: undefined,
        diagnostics: [],
        funcs: [{ name: 'Summarize', parameterNames: ['values'], fileContents: '' }]
      }
    ]);

    const { scope, dispatch } = await loadWorkerModule();
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "alpha"' }],
      requestId: 'generic:1'
    });
    await flushWorker();

    dispatch({
      type: 'preview:execute',
      funcName: 'alpha.Summarize',
      inputs: { values: [2, 2, 1] },
      requestId: 'generic:2'
    });
    await flushWorker();

    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'preview:execute-result',
      requestId: 'generic:2',
      funcName: 'alpha.Summarize',
      output: [3, 2]
    });
  });

  it('executes the emitted export name and supplies Temporal to generated modules', async () => {
    generateMock.mockReturnValue([
      {
        relativePath: 'alpha.ts',
        content: `import { Temporal } from '@js-temporal/polyfill';
        export function DateFunction(value) { return Temporal.PlainDate.from(value).year; }`,
        diagnostics: [],
        funcs: [{ name: 'Date', parameterNames: ['value'], exportName: 'DateFunction', fileContents: '' }]
      }
    ]);
    const { scope, dispatch } = await loadWorkerModule();
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///dates.rosetta', content: 'namespace "alpha"' }],
      requestId: 'date:1'
    });
    await flushWorker();
    dispatch({ type: 'preview:execute', funcName: 'alpha.Date', inputs: { value: '2024-02-29' }, requestId: 'date:2' });
    await flushWorker();
    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'preview:execute-result',
      requestId: 'date:2',
      funcName: 'alpha.Date',
      output: 2024
    });
  });

  it.each([
    { expression: 'NaN', expected: NaN },
    { expression: 'Infinity', expected: Infinity },
    { expression: '-Infinity', expected: -Infinity },
    { expression: '-0', expected: -0 },
    {
      expression: `({
        dates: [
          Temporal.PlainDate.from('2026-10-10'),
          Temporal.PlainTime.from('12:30:00'),
          Temporal.PlainDateTime.from('2026-10-10T12:30:00'),
          Temporal.ZonedDateTime.from('2026-10-10T12:30:00+00:00[UTC]')
        ],
        numbers: [NaN, Infinity, -Infinity, -0],
        optional: undefined
      })`,
      expected: {
        dates: ['2026-10-10', '12:30:00', '2026-10-10T12:30:00', '2026-10-10T12:30:00+00:00[UTC]'],
        numbers: [NaN, Infinity, -Infinity, -0],
        optional: undefined
      }
    }
  ])('preserves ordinary output values while transporting Temporal: $expression', async ({ expression, expected }) => {
    generateMock.mockReturnValue([
      {
        relativePath: 'alpha.ts',
        content: `import { Temporal } from '@js-temporal/polyfill';
          export function Output() { return ${expression}; }`,
        diagnostics: [],
        funcs: [{ name: 'Output', parameterNames: [], fileContents: '' }]
      }
    ]);
    const { scope, dispatch } = await loadWorkerModule();
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///output.rosetta', content: 'namespace "alpha"' }]
    });
    await flushWorker();
    dispatch({ type: 'preview:execute', funcName: 'alpha.Output', inputs: {}, requestId: 'output:1' });
    await flushWorker();
    expect(structuredClone(scope.postMessage.mock.lastCall?.[0])).toEqual({
      type: 'preview:execute-result',
      requestId: 'output:1',
      funcName: 'alpha.Output',
      output: expected
    });
  });

  it('resolves imports between generated namespace modules', async () => {
    generateMock.mockReturnValue([
      {
        relativePath: 'alpha.ts',
        content: `
          import { innerValue } from './beta.js';
          export function Outer(value: number): number {
            return innerValue(value);
          }
        `,
        sourceMap: undefined,
        diagnostics: [],
        funcs: [{ name: 'Outer', parameterNames: ['value'], fileContents: '' }]
      },
      {
        relativePath: 'beta.ts',
        content: `
          export function innerValue(value: number): number {
            return value * 2;
          }
        `,
        sourceMap: undefined,
        diagnostics: [],
        funcs: [{ name: 'innerValue', parameterNames: ['value'], fileContents: '' }]
      }
    ]);

    const { scope, dispatch } = await loadWorkerModule();
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "alpha"' }],
      requestId: 'modules:1'
    });
    await flushWorker();

    dispatch({
      type: 'preview:execute',
      funcName: 'alpha.Outer',
      inputs: { value: 4 },
      requestId: 'modules:2'
    });
    await flushWorker();

    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'preview:execute-result',
      requestId: 'modules:2',
      funcName: 'alpha.Outer',
      output: 8
    });
  });

  it('rejects imports outside the generated module graph', async () => {
    generateMock.mockReturnValue([
      {
        relativePath: 'alpha.ts',
        content: `
          import { readFileSync } from 'node:fs';
          export function Unsafe(input: { path: string }): string {
            return readFileSync(input.path, 'utf8');
          }
        `,
        sourceMap: undefined,
        diagnostics: [],
        funcs: [{ name: 'Unsafe', parameterNames: ['path'], fileContents: '' }]
      }
    ]);

    const { scope, dispatch } = await loadWorkerModule();
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "alpha"' }],
      requestId: 'blocked:1'
    });
    await flushWorker();

    dispatch({
      type: 'preview:execute',
      funcName: 'alpha.Unsafe',
      inputs: { path: '/tmp/secret' },
      requestId: 'blocked:2'
    });
    await flushWorker();

    expect(scope.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'preview:execute-error',
        requestId: 'blocked:2',
        funcName: 'alpha.Unsafe',
        error: expect.stringContaining("unsupported dependency 'node:fs'")
      })
    );
  });
});

describe('codegen-worker code preview messages', () => {
  beforeEach(() => {
    buildMock.mockReset();
    buildMock.mockImplementation(async () => undefined);
    fromStringMock.mockClear();
    generateMock.mockReset();
    generatePreviewSchemasMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts codegen:result for the requested target after files are loaded', async () => {
    generateMock.mockReturnValue([
      {
        relativePath: 'trade.zod.ts',
        content: 'export const Trade = z.object({});',
        sourceMap: []
      }
    ]);

    const { scope, dispatch } = await loadWorkerModule();

    dispatch({
      type: 'codegen:setFiles',
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace demo' }]
    });
    await flushWorker();

    dispatch({
      type: 'codegen:generate',
      target: 'zod',
      requestId: 'codegen:zod:1'
    });
    await flushWorker();

    expect(generateMock).toHaveBeenCalledWith(expect.any(Array), { target: 'zod' });
    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'codegen:result',
      target: 'zod',
      requestId: 'codegen:zod:1',
      files: [
        {
          relativePath: 'trade.zod.ts',
          content: 'export const Trade = z.object({});',
          sourceMap: []
        }
      ]
    });
  });

  it('generates refreshed files only under an explicit generation request id', async () => {
    generateMock.mockReturnValue([
      {
        relativePath: 'trade.zod.ts',
        content: 'export const Trade = z.object({});',
        sourceMap: []
      }
    ]);

    const { scope, dispatch } = await loadWorkerModule();

    dispatch({
      type: 'codegen:setFiles',
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace demo' }]
    });
    await flushWorker();

    dispatch({
      type: 'codegen:generate',
      target: 'zod',
      requestId: 'codegen:zod:7'
    });
    await flushWorker();

    dispatch({
      type: 'codegen:setFiles',
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace demo\n\ntype Trade:' }],
      requestId: 'ignored-file-publication'
    });
    await flushWorker();
    expect(generateMock).toHaveBeenCalledTimes(1);
    dispatch({ type: 'codegen:generate', target: 'zod', requestId: 'codegen:zod:8' });
    await flushWorker();

    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'codegen:result',
      target: 'zod',
      requestId: 'codegen:zod:8',
      files: [
        {
          relativePath: 'trade.zod.ts',
          content: 'export const Trade = z.object({});',
          sourceMap: []
        }
      ]
    });
  });

  it('posts codegen:outdated when code preview files contain lexer or parser errors', async () => {
    buildMock.mockImplementation(
      async (
        documents: Array<{
          parseResult: {
            lexerErrors: Array<{ message: string }>;
            parserErrors: Array<{ message: string }>;
          };
        }>
      ) => {
        documents[0]!.parseResult.lexerErrors = [{ message: 'Bad token' }];
      }
    );

    const { scope, dispatch } = await loadWorkerModule();

    dispatch({
      type: 'codegen:setFiles',
      files: [{ uri: 'file:///trade.rosetta', content: 'broken syntax' }]
    });
    await flushWorker();

    dispatch({
      type: 'codegen:generate',
      target: 'zod',
      requestId: 'codegen:zod:syntax-error'
    });
    await flushWorker();

    expect(generateMock).not.toHaveBeenCalled();
    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'codegen:outdated',
      target: 'zod',
      requestId: 'codegen:zod:syntax-error',
      message: 'Fix model errors to refresh the code preview.'
    });
  });

  // 019 Task #88 follow-up — preview was broken for curated workspaces
  // because `buildDocuments` parsed empty `content` strings and filtered
  // the resulting parse-error docs out. Now entries with
  // `serializedModelJson` set take the deserialize path and reach the
  // preview generator.
  it('deserializes curated entries via JsonSerializer and forwards them to the preview generator', async () => {
    generatePreviewSchemasMock.mockReturnValue([
      {
        schemaVersion: 1,
        targetId: 'cdm.base.math.Quantity',
        title: 'Quantity',
        status: 'ready',
        fields: []
      }
    ]);

    const { scope, dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [
        // Curated entry — content empty, serializedModelJson set.
        {
          uri: 'file:///cdm/base/math.rosetta',
          content: '',
          serializedModelJson: '{"$type":"RosettaModel","name":"cdm.base.math"}'
        }
      ],
      requestId: 'preview:curated:1'
    });
    await flushWorker();

    dispatch({
      type: 'preview:generate',
      targetId: 'cdm.base.math.Quantity',
      requestId: 'preview:curated:2'
    });
    await flushWorker();

    // The deserializer was called with the curated JSON; the parser was
    // NOT called for this entry (it would have hit `fromString` with an
    // empty content otherwise).
    expect(deserializeMock).toHaveBeenCalledWith('{"$type":"RosettaModel","name":"cdm.base.math"}');
    expect(fromStringMock).not.toHaveBeenCalledWith('', 'file:///cdm/base/math.rosetta');

    // The deserialized doc reached the preview generator.
    const previewCall = generatePreviewSchemasMock.mock.calls.at(-1);
    expect(previewCall).toBeDefined();
    const [forwardedDocs] = previewCall!;
    expect(forwardedDocs).toHaveLength(1);
    expect((forwardedDocs as Array<{ parseResult: { value: unknown } }>)[0]!.parseResult.value).toMatchObject({
      __deserialized: true
    });

    // Preview result posted back.
    expect(scope.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'preview:result', targetId: 'cdm.base.math.Quantity' })
    );
  });

  it('mixes curated and user entries in a single preview build', async () => {
    generatePreviewSchemasMock.mockReturnValue([
      { schemaVersion: 1, targetId: 'user.Trade', title: 'Trade', status: 'ready', fields: [] }
    ]);

    const { dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [
        { uri: 'file:///user.rosetta', content: 'namespace user' },
        {
          uri: 'file:///cdm/base/math.rosetta',
          content: '',
          serializedModelJson: '{"$type":"RosettaModel","name":"cdm.base.math"}'
        }
      ],
      requestId: 'preview:mixed:1'
    });
    await flushWorker();

    dispatch({
      type: 'preview:generate',
      targetId: 'user.Trade',
      requestId: 'preview:mixed:2'
    });
    await flushWorker();

    expect(fromStringMock).toHaveBeenCalledWith('namespace user', 'file:///user.rosetta');
    // The deserializer was called for the curated entry. Each
    // `preview:setFiles` + `preview:generate` pair re-runs preview, so
    // the count is ≥ 1 — what matters is the curated JSON was processed
    // and the user file was NOT deserialized.
    expect(deserializeMock).toHaveBeenCalledWith('{"$type":"RosettaModel","name":"cdm.base.math"}');
    expect(deserializeMock).not.toHaveBeenCalledWith('namespace user');
    const previewCall = generatePreviewSchemasMock.mock.calls.at(-1);
    const [forwardedDocs] = previewCall!;
    // Both docs reach the generator: 1 parsed user doc + 1 deserialized curated doc.
    expect(forwardedDocs).toHaveLength(2);
  });

  it('ignores list-only curated refOnly entries without serializedModelJson during preview builds', async () => {
    generatePreviewSchemasMock.mockReturnValue([
      { schemaVersion: 1, targetId: 'user.Trade', title: 'Trade', status: 'ready', fields: [] }
    ]);

    const { dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [
        { uri: 'file:///user.rosetta', content: 'namespace user' },
        { uri: 'file:///cdm/cdm.base.math', content: '' },
        {
          uri: 'file:///cdm/base/math.rosetta',
          content: '',
          serializedModelJson: '{"$type":"RosettaModel","name":"cdm.base.math"}'
        }
      ],
      requestId: 'preview:list-only:1'
    });
    await flushWorker();

    dispatch({
      type: 'preview:generate',
      targetId: 'user.Trade',
      requestId: 'preview:list-only:2'
    });
    await flushWorker();

    expect(fromStringMock).toHaveBeenCalledWith('namespace user', 'file:///user.rosetta');
    expect(fromStringMock).not.toHaveBeenCalledWith('', 'file:///cdm/cdm.base.math');
    expect(deserializeMock).toHaveBeenCalledWith('{"$type":"RosettaModel","name":"cdm.base.math"}');

    const previewCall = generatePreviewSchemasMock.mock.calls.at(-1);
    const [forwardedDocs] = previewCall!;
    expect(forwardedDocs).toHaveLength(2);
  });
});

// Task 2 (curated-document staleness fix): `preview:setFiles` must relink
// curated documents via the batch `hydrateModelDocuments` fixpoint and cache
// the result, instead of the old per-entry `hydrateModelDocument(..., {
// register: 'idempotent' })` loop that returned an already-registered
// document verbatim — including any previously-failed reference resolution
// — forever.
describe('codegen-worker preview:setFiles curated document relinking', () => {
  beforeEach(() => {
    buildMock.mockReset();
    buildMock.mockImplementation(async () => undefined);
    fromStringMock.mockClear();
    generatePreviewSchemasMock.mockReset();
    deserializeMock.mockClear();
    deserializeMock.mockImplementation((json: string) => ({ __deserialized: true, json }));
    fromModelMock.mockClear();
    fromModelMock.mockImplementation((model: unknown, uri: string) => ({
      uri,
      parseResult: { value: model, lexerErrors: [], parserErrors: [] }
    }));
    registered.clear();
    getDocumentMock.mockClear();
    addDocumentMock.mockClear();
    deleteDocumentMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces a curated document's registered identity when preview:setFiles resends it, rather than reusing the existing registration", async () => {
    const { dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      requestId: 'files:1',
      files: [{ uri: 'curated:///fpml/consolidated/shared/Scheme.rosetta', content: '', serializedModelJson: '{}' }]
    });
    await flushWorker();
    const firstRegistration = registered.get('curated:///fpml/consolidated/shared/Scheme.rosetta');
    expect(firstRegistration).toBeDefined();

    // A second preview:setFiles carrying the same curated entry (as happens
    // whenever ANY new namespace hydrates — the file-sync effect resends the
    // full curated set every time) must trigger a fresh relink, not a
    // do-nothing idempotent skip.
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      requestId: 'files:2',
      files: [
        { uri: 'curated:///fpml/consolidated/shared/Scheme.rosetta', content: '', serializedModelJson: '{}' },
        {
          uri: 'curated:///fpml/consolidated/shared/NormalizedString.rosetta',
          content: '',
          serializedModelJson: '{}'
        }
      ]
    });
    await flushWorker();
    const secondRegistration = registered.get('curated:///fpml/consolidated/shared/Scheme.rosetta');

    expect(deleteDocumentMock).toHaveBeenCalledWith('curated:///fpml/consolidated/shared/Scheme.rosetta');
    expect(secondRegistration).not.toBe(firstRegistration);
  });

  it('does not re-relink when preview:setFiles resends an identical curated set (e.g. after a pure user-file edit)', async () => {
    const { dispatch } = await loadWorkerModule();
    const files = [
      { uri: 'curated:///fpml/consolidated/shared/Scheme.rosetta', content: '', serializedModelJson: '{}' }
    ];

    dispatch({ type: 'preview:setFiles', filesRevision: 1, requestId: 'files:1', files });
    await flushWorker();
    deleteDocumentMock.mockClear();
    addDocumentMock.mockClear();

    // Same curated entries, unchanged — as happens when only a user-authored
    // file was edited and the curated set along for the ride is identical.
    dispatch({ type: 'preview:setFiles', filesRevision: 1, requestId: 'files:2', files: [...files] });
    await flushWorker();

    expect(deleteDocumentMock).not.toHaveBeenCalled();
    expect(addDocumentMock).not.toHaveBeenCalled();
  });
});

describe('codegen-worker previewSchemaCache (shared across preview/instance handlers)', () => {
  beforeEach(() => {
    buildMock.mockReset();
    buildMock.mockImplementation(async () => undefined);
    fromStringMock.mockClear();
    generatePreviewSchemasMock.mockReset();
    findDataNodeMock.mockReset();
    getActiveConditionPredicatesMock.mockReset();
    getActiveConditionPredicatesMock.mockReturnValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shares one generatePreviewSchemas result across runPreview and validateInstance for the same targetId', async () => {
    findDataNodeMock.mockReturnValue({ name: 'Trade' });
    generatePreviewSchemasMock.mockReturnValue([
      { schemaVersion: 1, targetId: 'beta.Trade', title: 'Trade', status: 'ready', fields: [] }
    ]);

    const { dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "beta"' }],
      requestId: 'shared:1'
    });
    await flushWorker();

    dispatch({ type: 'preview:generate', targetId: 'beta.Trade', requestId: 'shared:2' });
    await flushWorker();

    dispatch({ type: 'instance:validate', typeFqn: 'beta.Trade', data: {}, requestId: 'shared:3' });
    await flushWorker();

    expect(generatePreviewSchemasMock).toHaveBeenCalledTimes(1);
  });

  it('caches a repeated preview:generate for the same targetId', async () => {
    generatePreviewSchemasMock.mockReturnValue([
      { schemaVersion: 1, targetId: 'beta.Trade', title: 'Trade', status: 'ready', fields: [] }
    ]);

    const { dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "beta"' }],
      requestId: 'hit:1'
    });
    await flushWorker();

    dispatch({ type: 'preview:generate', targetId: 'beta.Trade', requestId: 'hit:2' });
    await flushWorker();
    dispatch({ type: 'preview:generate', targetId: 'beta.Trade', requestId: 'hit:3' });
    await flushWorker();

    expect(generatePreviewSchemasMock).toHaveBeenCalledTimes(1);
  });

  it('keeps separate cache entries for different targetIds', async () => {
    generatePreviewSchemasMock.mockImplementation((_documents: unknown, options: { targetId: string }) => [
      { schemaVersion: 1, targetId: options.targetId, title: options.targetId, status: 'ready', fields: [] }
    ]);

    const { dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "beta"' }],
      requestId: 'multi:1'
    });
    await flushWorker();

    dispatch({ type: 'preview:generate', targetId: 'beta.Trade', requestId: 'multi:2' });
    await flushWorker();
    dispatch({ type: 'preview:generate', targetId: 'beta.Event', requestId: 'multi:3' });
    await flushWorker();

    expect(generatePreviewSchemasMock).toHaveBeenCalledTimes(2);
  });

  it('invalidates the schema cache after preview:setFiles', async () => {
    generatePreviewSchemasMock.mockReturnValue([
      { schemaVersion: 1, targetId: 'beta.Trade', title: 'Trade', status: 'ready', fields: [] }
    ]);

    const { dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "beta"' }],
      requestId: 'inv:1'
    });
    await flushWorker();
    dispatch({ type: 'preview:generate', targetId: 'beta.Trade', requestId: 'inv:2' });
    await flushWorker();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "beta"\n// dependency snapshot changed' }],
      requestId: 'inv:3'
    });
    await flushWorker();
    dispatch({ type: 'preview:generate', targetId: 'beta.Trade', requestId: 'inv:4' });
    await flushWorker();

    expect(generatePreviewSchemasMock).toHaveBeenCalledTimes(2);
  });

  it('does not let a build suspended across a preview:setFiles poison previewSchemaCache with a stale schema', async () => {
    generatePreviewSchemasMock.mockImplementation(
      (documents: Array<{ content?: string }>, options: { targetId: string }) => [
        {
          schemaVersion: 1,
          targetId: options.targetId,
          title: documents.some((d) => d.content === 'namespace "B"') ? 'FromB' : 'FromA',
          status: 'ready',
          fields: []
        }
      ]
    );

    const buildResolvers: Array<() => void> = [];
    buildMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          buildResolvers.push(resolve);
        })
    );

    const { scope, dispatch } = await loadWorkerModule();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "A"' }],
      requestId: 'poison:1'
    });
    await flushWorker();

    // instance:generateSchema deliberately never touches lastPreviewTargetId
    // (see its own doc comment), so — unlike preview:generate — the
    // preview:setFiles below will NOT auto-trigger a second, competing call
    // that could populate previewSchemaCache first. This call is the ONLY
    // one in flight, and it suspends inside builder.build against file set A.
    dispatch({ type: 'instance:generateSchema', typeFqn: 'beta.Trade', requestId: 'poison:2' });
    await flushWorker();

    // File set changes to B WHILE the call above is still suspended.
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "B"' }],
      requestId: 'poison:3'
    });
    await flushWorker();

    expect(buildResolvers).toHaveLength(1);

    // Resolve the suspended build. buildDocuments()'s own guard correctly
    // refuses to cache this now-stale (file-set-A) result under the live
    // version, but its RETURNED documents are still A-based — without
    // tagging the previewSchemaCache write with the version those documents
    // were ACTUALLY built from (not the live counter, already at 2), this
    // caches a schema computed from stale documents as if it were valid for
    // the current version.
    buildResolvers[0]!();
    await flushWorker();

    // Back to immediate resolution — the controllable-promise implementation
    // above only exists to suspend the ONE call under test.
    buildMock.mockImplementation(async () => undefined);

    // A fresh request for the SAME targetId must recompute against the
    // CURRENT (B-based) documents and see the correct schema — never the
    // stale A-based one the suspended call computed.
    dispatch({ type: 'instance:generateSchema', typeFqn: 'beta.Trade', requestId: 'poison:4' });
    await flushWorker();

    expect(scope.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'instance:generateSchemaResult',
        requestId: 'poison:4',
        schema: expect.objectContaining({ title: 'FromB' })
      })
    );
  });
});

describe('codegen-worker validateInstance (real standalone Zod validator)', () => {
  beforeEach(() => {
    buildMock.mockReset();
    buildMock.mockImplementation(async () => undefined);
    fromStringMock.mockClear();
    emitStandaloneZodSchemaMock.mockReset();
    findDataNodeMock.mockReset();
    findDataNodeMock.mockReturnValue(undefined);
    getActiveConditionPredicatesMock.mockReset();
    getActiveConditionPredicatesMock.mockReturnValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function setFilesAndFlush(dispatch: (data: unknown) => void, flush: () => Promise<void>) {
    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "beta"' }],
      requestId: 'setup:1'
    });
    await flush();
  }

  it('validates real sample data through a plain-object emitted schema', async () => {
    // The trailing `export type Trade = z.infer<typeof TradeSchema>;` line
    // matches zod-emitter.ts's emitInferAlias, which real
    // emitStandaloneZodSchema output always includes for a non-cyclic Data
    // type — The shared TypeScript compiler must erase it entirely (it's
    // TypeScript-only syntax `new Function` cannot parse), not merely strip
    // `export` off it.
    emitStandaloneZodSchemaMock.mockReturnValue({
      code: [
        "import { z } from 'zod';",
        '',
        'export const TradeSchema = z',
        '  .object({',
        '    id: z.string().min(1)',
        '  })',
        '  .strict();',
        'export type Trade = z.infer<typeof TradeSchema>;'
      ].join('\n'),
      diagnostics: []
    });

    const { scope, dispatch } = await loadWorkerModule();
    await setFilesAndFlush(dispatch, flushWorker);

    dispatch({ type: 'instance:validate', typeFqn: 'beta.Trade', data: { id: 'T-1' }, requestId: 'v:1' });
    await flushWorker();
    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'instance:validateResult',
      requestId: 'v:1',
      diagnostics: []
    });

    dispatch({ type: 'instance:validate', typeFqn: 'beta.Trade', data: {}, requestId: 'v:2' });
    await flushWorker();
    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'instance:validateResult',
      requestId: 'v:2',
      diagnostics: [{ path: 'id', message: expect.any(String) }]
    });
  });

  it('exercises the cyclic-type interface-stripping path end-to-end', async () => {
    // Mirrors zod-emitter.ts's emitCyclicInterface + the z.ZodType<Name> =
    // z.lazy(...) shape it pairs with for a self-referencing Data type.
    emitStandaloneZodSchemaMock.mockReturnValue({
      code: [
        "import { z } from 'zod';",
        '',
        'export interface Node {',
        '  value: string;',
        '  child?: Node;',
        '}',
        '',
        'export const NodeSchema: z.ZodType<Node> = z.lazy(() =>',
        '  z',
        '    .object({',
        '      value: z.string().min(1),',
        '      child: NodeSchema.optional()',
        '    })',
        '    .strict()',
        ');'
      ].join('\n'),
      diagnostics: []
    });

    const { scope, dispatch } = await loadWorkerModule();
    await setFilesAndFlush(dispatch, flushWorker);

    dispatch({
      type: 'instance:validate',
      typeFqn: 'beta.Node',
      data: { value: 'root', child: { value: 'leaf' } },
      requestId: 'v:1'
    });
    await flushWorker();
    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'instance:validateResult',
      requestId: 'v:1',
      diagnostics: []
    });
  });

  it('reports "Structural validation unavailable" when the closure has an error diagnostic', async () => {
    emitStandaloneZodSchemaMock.mockReturnValue({
      code: '',
      diagnostics: [{ severity: 'error', code: 'unknown-target', message: "Target 'beta.Ghost' was not found." }]
    });

    const { scope, dispatch } = await loadWorkerModule();
    await setFilesAndFlush(dispatch, flushWorker);

    dispatch({ type: 'instance:validate', typeFqn: 'beta.Ghost', data: {}, requestId: 'v:1' });
    await flushWorker();

    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'instance:validateResult',
      requestId: 'v:1',
      diagnostics: [{ path: '', message: "Structural validation unavailable: Target 'beta.Ghost' was not found." }]
    });
  });

  it('reports "Structural validation unavailable" when the stripped script throws on compile/eval', async () => {
    emitStandaloneZodSchemaMock.mockReturnValue({
      code: "import { z } from 'zod';\n\nexport const TradeSchema = z.object({ id: notAFunction() });",
      diagnostics: []
    });

    const { scope, dispatch } = await loadWorkerModule();
    await setFilesAndFlush(dispatch, flushWorker);

    dispatch({ type: 'instance:validate', typeFqn: 'beta.Trade', data: {}, requestId: 'v:1' });
    await flushWorker();

    const call = scope.postMessage.mock.calls.at(-1)![0];
    expect(call.type).toBe('instance:validateResult');
    expect(call.requestId).toBe('v:1');
    expect(call.diagnostics).toHaveLength(1);
    expect(call.diagnostics[0].path).toBe('');
    expect(call.diagnostics[0].message).toMatch(/^Structural validation unavailable:/);
  });

  it('keeps structural paths when a condition shares the field name', async () => {
    emitStandaloneZodSchemaMock.mockReturnValue({
      code: `import { z } from 'zod';
export const TradeSchema = z.object({ trade: z.object({ amount: z.number().min(1) }) })
  .superRefine((_data, ctx) => { ctx.addIssue({ code: 'custom', message: 'trade: condition failed', path: ['trade'] }); });`,
      diagnostics: []
    });
    findDataNodeMock.mockReturnValue({ name: 'Trade' });
    getActiveConditionPredicatesMock.mockReturnValue([{ name: 'trade', predicate: 'false' }]);
    const { scope, dispatch } = await loadWorkerModule();
    await setFilesAndFlush(dispatch, flushWorker);
    dispatch({
      type: 'instance:validate',
      typeFqn: 'beta.Trade',
      data: { trade: { amount: 0 } },
      requestId: 'collision'
    });
    await flushWorker();
    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'instance:validateResult',
      requestId: 'collision',
      diagnostics: [
        { path: 'trade.amount', message: expect.any(String) },
        { path: 'trade', message: 'trade: condition failed', conditionName: 'trade' }
      ]
    });
  });

  it('formats every array index in nested structural paths', async () => {
    emitStandaloneZodSchemaMock.mockReturnValue({
      code: `import { z } from 'zod';
export const TradeSchema = z.object({ orders: z.array(z.object({ lines: z.array(z.object({ amount: z.number() })) })) });`,
      diagnostics: []
    });
    const { scope, dispatch } = await loadWorkerModule();
    await setFilesAndFlush(dispatch, flushWorker);
    dispatch({
      type: 'instance:validate',
      typeFqn: 'beta.Trade',
      data: { orders: [{ lines: [{ amount: 1 }, { amount: 'invalid' }] }] },
      requestId: 'nested'
    });
    await flushWorker();
    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'instance:validateResult',
      requestId: 'nested',
      diagnostics: [{ path: 'orders[0].lines[1].amount', message: expect.any(String) }]
    });
  });

  it('attributes a multi-condition superRefine issue to its condition name via path', async () => {
    emitStandaloneZodSchemaMock.mockReturnValue({
      code: [
        "import { z } from 'zod';",
        '',
        'export const TradeSchema = z',
        '  .object({',
        '    fixedRate: z.string().optional(),',
        '    floatingRate: z.string().optional()',
        '  })',
        '  .strict()',
        '  .superRefine((data, ctx) => {',
        '    const present = [data.fixedRate, data.floatingRate].filter((v) => v !== undefined).length;',
        '    if (present !== 1) {',
        "      ctx.addIssue({ code: 'custom', message: 'oneRateKind: exactly one of [fixedRate, floatingRate] must be present in Trade', path: ['oneRateKind'] });",
        '    }',
        '  });',
        'export type Trade = z.infer<typeof TradeSchema>;'
      ].join('\n'),
      diagnostics: []
    });
    findDataNodeMock.mockReturnValue({ name: 'Trade' });
    getActiveConditionPredicatesMock.mockReturnValue([{ name: 'oneRateKind', predicate: 'runeCheckOneOf([...])' }]);

    const { scope, dispatch } = await loadWorkerModule();
    await setFilesAndFlush(dispatch, flushWorker);

    dispatch({ type: 'instance:validate', typeFqn: 'beta.Trade', data: {}, requestId: 'v:1' });
    await flushWorker();

    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'instance:validateResult',
      requestId: 'v:1',
      diagnostics: [
        {
          path: 'oneRateKind',
          message: 'oneRateKind: exactly one of [fixedRate, floatingRate] must be present in Trade',
          conditionName: 'oneRateKind'
        }
      ]
    });
  });

  it('attributes a single-condition refine issue (empty path) to the sole active condition', async () => {
    emitStandaloneZodSchemaMock.mockReturnValue({
      code: [
        "import { z } from 'zod';",
        '',
        'export const TradeSchema = z',
        '  .object({ id: z.string().optional() })',
        '  .strict()',
        "  .refine((data) => data.id !== undefined, 'hasId: id must be present in Trade');",
        'export type Trade = z.infer<typeof TradeSchema>;'
      ].join('\n'),
      diagnostics: []
    });
    findDataNodeMock.mockReturnValue({ name: 'Trade' });
    getActiveConditionPredicatesMock.mockReturnValue([{ name: 'hasId', predicate: 'runeAttrExists(data.id)' }]);

    const { scope, dispatch } = await loadWorkerModule();
    await setFilesAndFlush(dispatch, flushWorker);

    dispatch({ type: 'instance:validate', typeFqn: 'beta.Trade', data: {}, requestId: 'v:1' });
    await flushWorker();

    expect(scope.postMessage).toHaveBeenLastCalledWith({
      type: 'instance:validateResult',
      requestId: 'v:1',
      diagnostics: [{ path: 'hasId', message: 'hasId: id must be present in Trade', conditionName: 'hasId' }]
    });
  });

  it('does not attribute an unrelated root-path structural issue to the sole active condition', async () => {
    // The sole condition's own .refine() always PASSES here (predicate is
    // `true`); the only issue that can occur is `.strict()`'s
    // `unrecognized_keys` for the extra `bogus` key, which lands at the
    // root path with a message that does NOT start with the condition's
    // name. Without the message-prefix guard, translateValidationIssues
    // would mislabel this structural issue as 'hasId's own failure just
    // because the path is empty and there's exactly one active condition.
    emitStandaloneZodSchemaMock.mockReturnValue({
      code: [
        "import { z } from 'zod';",
        '',
        'export const TradeSchema = z',
        '  .object({ id: z.string().optional() })',
        '  .strict()',
        "  .refine(() => true, 'hasId: id must be present in Trade');",
        'export type Trade = z.infer<typeof TradeSchema>;'
      ].join('\n'),
      diagnostics: []
    });
    findDataNodeMock.mockReturnValue({ name: 'Trade' });
    getActiveConditionPredicatesMock.mockReturnValue([{ name: 'hasId', predicate: 'runeAttrExists(data.id)' }]);

    const { scope, dispatch } = await loadWorkerModule();
    await setFilesAndFlush(dispatch, flushWorker);

    dispatch({ type: 'instance:validate', typeFqn: 'beta.Trade', data: { bogus: 'nope' }, requestId: 'v:1' });
    await flushWorker();

    const call = scope.postMessage.mock.calls.at(-1)![0];
    expect(call.type).toBe('instance:validateResult');
    expect(call.diagnostics).toHaveLength(1);
    expect(call.diagnostics[0].conditionName).toBeUndefined();
    expect(call.diagnostics[0].path).toBe('');
    expect(call.diagnostics[0].message).not.toMatch(/^hasId/);
  });

  it('caches the compiled validator across repeated instance:validate calls for the same typeFqn', async () => {
    emitStandaloneZodSchemaMock.mockReturnValue({
      code: "import { z } from 'zod';\n\nexport const TradeSchema = z.object({}).strict();\nexport type Trade = z.infer<typeof TradeSchema>;",
      diagnostics: []
    });

    const { dispatch } = await loadWorkerModule();
    await setFilesAndFlush(dispatch, flushWorker);

    dispatch({ type: 'instance:validate', typeFqn: 'beta.Trade', data: {}, requestId: 'v:1' });
    await flushWorker();
    dispatch({ type: 'instance:validate', typeFqn: 'beta.Trade', data: {}, requestId: 'v:2' });
    await flushWorker();

    expect(emitStandaloneZodSchemaMock).toHaveBeenCalledTimes(1);
  });

  it('recompiles the validator after a preview:setFiles bumps the file version', async () => {
    emitStandaloneZodSchemaMock.mockReturnValue({
      code: "import { z } from 'zod';\n\nexport const TradeSchema = z.object({}).strict();\nexport type Trade = z.infer<typeof TradeSchema>;",
      diagnostics: []
    });

    const { dispatch } = await loadWorkerModule();
    await setFilesAndFlush(dispatch, flushWorker);

    dispatch({ type: 'instance:validate', typeFqn: 'beta.Trade', data: {}, requestId: 'v:1' });
    await flushWorker();

    dispatch({
      type: 'preview:setFiles',
      filesRevision: 1,
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "beta" // changed' }],
      requestId: 'setup:2'
    });
    await flushWorker();

    dispatch({ type: 'instance:validate', typeFqn: 'beta.Trade', data: {}, requestId: 'v:2' });
    await flushWorker();

    expect(emitStandaloneZodSchemaMock).toHaveBeenCalledTimes(2);
  });
});

describe('codegen-worker codegenGenerateCache (runCodegen)', () => {
  beforeEach(() => {
    buildMock.mockReset();
    buildMock.mockImplementation(async () => undefined);
    fromStringMock.mockClear();
    generateMock.mockClear();
    generateMock.mockReturnValue([
      { relativePath: 'out.ts', content: 'x', sourceMap: undefined, diagnostics: [], funcs: [] }
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('caches generate() across repeated codegen:generate calls for the same target', async () => {
    const { dispatch } = await loadWorkerModule();

    dispatch({
      type: 'codegen:setFiles',
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "gamma"' }],
      requestId: 'hit:1'
    });
    await flushWorker();

    // Only the first explicit request computes; the next request reuses it.
    dispatch({ type: 'codegen:generate', target: 'zod', requestId: 'hit:2' });
    await flushWorker();
    dispatch({ type: 'codegen:generate', target: 'zod', requestId: 'hit:3' });
    await flushWorker();

    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it('installs files without generating discarded workspace output before a selected request', async () => {
    const { dispatch, scope } = await loadWorkerModule();
    dispatch({ type: 'codegen:setFiles', files: [{ uri: 'file:///trade.rosetta', content: 'namespace gamma' }] });
    await flushWorker();
    expect(generateMock).not.toHaveBeenCalled();
    expect(scope.postMessage).not.toHaveBeenCalled();
    dispatch({
      type: 'preview:setFiles',
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace gamma' }],
      requestId: 'preview:files:1',
      filesRevision: 1
    });
    await flushWorker();
    expect(generateMock).not.toHaveBeenCalled();
    const selection = { declarations: [{ namespace: 'gamma', name: 'Trade', kind: 'Data' }], namespaces: [] };
    dispatch({ type: 'codegen:generate', target: 'zod', requestId: 'selected:1', selection });
    await flushWorker();
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(generateMock).toHaveBeenLastCalledWith(expect.any(Array), { target: 'zod' });
    expect(scope.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'codegen:result', requestId: 'selected:1' })
    );
  });

  it('keeps separate cache entries per target', async () => {
    const { dispatch } = await loadWorkerModule();

    dispatch({
      type: 'codegen:setFiles',
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "gamma"' }],
      requestId: 'multi:1'
    });
    await flushWorker();

    dispatch({ type: 'codegen:generate', target: 'zod', requestId: 'multi:2' });
    await flushWorker();
    // A DIFFERENT target — must miss the cache and compute independently
    // (call #2), coexisting with the 'zod' entry rather than replacing it.
    dispatch({ type: 'codegen:generate', target: 'typescript', requestId: 'multi:3' });
    await flushWorker();

    expect(generateMock).toHaveBeenCalledTimes(2);
  });

  it('explicit regeneration reruns generation with unchanged sources', async () => {
    const { dispatch } = await loadWorkerModule();
    dispatch({
      type: 'codegen:setFiles',
      files: [{ uri: 'file:///retry.rosetta', content: 'namespace retry' }],
      requestId: 'retry:files'
    });
    await flushWorker();
    dispatch({ type: 'codegen:generate', target: 'zod', requestId: 'retry:cached' });
    await flushWorker();
    expect(generateMock).toHaveBeenCalledTimes(1);
    dispatch({ type: 'codegen:generate', target: 'zod', requestId: 'retry:fresh', regenerate: true });
    await flushWorker();
    expect(generateMock).toHaveBeenCalledTimes(2);
  });

  it('invalidates the codegen cache after codegen:setFiles', async () => {
    const { dispatch } = await loadWorkerModule();

    // First generation populates the cache for file version 1.
    dispatch({
      type: 'codegen:setFiles',
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "gamma"' }],
      requestId: 'inv:1'
    });
    await flushWorker();
    dispatch({ type: 'codegen:generate', target: 'zod', requestId: 'inv:2' });
    await flushWorker();

    // Publication invalidates the cache; the explicit request below recomputes.
    dispatch({
      type: 'codegen:setFiles',
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "gamma"' }],
      requestId: 'inv:3'
    });
    await flushWorker();
    dispatch({ type: 'codegen:generate', target: 'zod', requestId: 'inv:4' });
    await flushWorker();

    expect(generateMock).toHaveBeenCalledTimes(2);
  });

  it('does not let an older run whose generate() resolves late clobber a newer entry already cached', async () => {
    // Two runCodegen('zod') calls in flight for the SAME cache key, each
    // suspended inside its own generate() call, captured under a DIFFERENT
    // codegenFilesVersion. The older one's generate() resolves LAST —
    // reproduces the out-of-order-completion race: getOrComputeAsync's write
    // guard must compare against the cache's own current state, not
    // re-invoke `getVersion()` — for these two call sites `getVersion` is a
    // closure over an already-fixed `documentsVersion`, so re-invoking it
    // trivially always equals `versionAtStart` and would let the older,
    // stale write clobber the newer, correct entry.
    const generateResolvers: Array<(value: unknown) => void> = [];
    generateMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          generateResolvers.push(resolve);
        })
    );

    const { scope, dispatch } = await loadWorkerModule();

    // Call A captures file version 1 and suspends inside generate().
    dispatch({
      type: 'codegen:setFiles',
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "gamma-v1"' }],
      requestId: 'race:1'
    });
    dispatch({ type: 'codegen:generate', target: 'zod', requestId: 'race:1' });
    await flushWorker();

    // Call B captures version 2; both requests are now in flight.
    dispatch({
      type: 'codegen:setFiles',
      files: [{ uri: 'file:///trade.rosetta', content: 'namespace "gamma-v2"' }],
      requestId: 'race:2'
    });
    dispatch({ type: 'codegen:generate', target: 'zod', requestId: 'race:2' });
    await flushWorker();

    expect(generateResolvers).toHaveLength(2);

    // Resolve B (the NEWER call, version 2) FIRST — it correctly caches.
    generateResolvers[1]!([{ relativePath: 'out.ts', content: 'B', sourceMap: undefined, diagnostics: [], funcs: [] }]);
    await flushWorker();

    // Resolve A (the OLDER call, version 1) SECOND. Its write must be
    // refused — the cache already holds a newer (version 2) entry.
    generateResolvers[0]!([{ relativePath: 'out.ts', content: 'A', sourceMap: undefined, diagnostics: [], funcs: [] }]);
    await flushWorker();

    // Back to immediate resolution for the follow-up dispatch below. Its
    // content is a sentinel that must never actually be returned — a cache
    // hit should serve B's already-cached result without calling generate() again.
    generateMock.mockImplementation(async () => [
      { relativePath: 'out.ts', content: 'SHOULD-NOT-BE-CALLED', sourceMap: undefined, diagnostics: [], funcs: [] }
    ]);

    dispatch({ type: 'codegen:generate', target: 'zod', requestId: 'race:3' });
    await flushWorker();

    expect(generateMock).toHaveBeenCalledTimes(2);
    expect(scope.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'codegen:result',
        requestId: 'race:3',
        files: [expect.objectContaining({ relativePath: 'out.ts', content: 'B' })]
      })
    );
  });
});
