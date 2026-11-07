// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';
import { URI } from 'langium';
import { createRuneDslServices, serializeRuneModel } from '@rune-langium/core';
import { createProjectSnapshot, createProjectDraftSnapshot } from '@rune-langium/project-config';
import {
  cdmRuneImplementationSources,
  cdmRuneReferenceDocuments
} from '../../../../test/helpers/cdm-rune-implementations.js';
import { captureProjectRuntimeInput } from '../../src/services/project-runtime-input.js';
import { loadRealWorker } from './helpers/real-codegen-worker.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function sourceFiles(serialized = false) {
  let references = cdmRuneReferenceDocuments.map((document) => ({
    uri: `file:///reference/${document.uri}`,
    content: document.content
  }));
  if (serialized) {
    const { RuneDsl } = createRuneDslServices();
    const documents = references.map(({ uri, content }) =>
      RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse(uri))
    );
    for (const document of documents) RuneDsl.shared.workspace.LangiumDocuments.addDocument(document);
    await RuneDsl.shared.workspace.DocumentBuilder.build(documents, { validation: false });
    references = references.map((reference, index) => ({
      ...reference,
      content: '',
      serializedModelJson: serializeRuneModel(RuneDsl.serializer.JsonSerializer, documents[index]!.parseResult.value)
    }));
  }
  return [
    ...references,
    ...[...cdmRuneImplementationSources].map(([path, content]) => ({ uri: `file:///${path}`, content }))
  ];
}

it.each([false, true])(
  'shares overlapping schema and input-validation builds, serialized=%s',
  async (serialized) => {
    const files = await sourceFiles(serialized);
    const worker = await loadRealWorker();
    worker.dispatch({ type: 'preview:setFiles', filesRevision: 1, files });
    worker.dispatch({
      type: 'instance:generateSchema',
      typeFqn: 'cdm.event.common.ClearExecution#RosettaFunction',
      requestId: 'overlap:schema'
    });
    worker.dispatch({
      type: 'instance:validate',
      functionInputs: true,
      typeFqn: 'cdm.event.common.ClearExecution',
      data: {},
      requestId: 'overlap:validate'
    });
    for (const requestId of ['overlap:schema', 'overlap:validate'])
      await vi.waitFor(
        () => expect(worker.scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId })),
        { timeout: 15000 }
      );
    expect(worker.scope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'instance:generateSchemaResult',
        requestId: 'overlap:schema'
      })
    );
    expect(worker.scope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'instance:validateResult',
        requestId: 'overlap:validate',
        diagnostics: []
      })
    );
  },
  30000
);

it.each([
  ['output type', 'executionDetails ExecutionDetails (0..1)', 'executionDetails TransferState (0..1)', false],
  ['output cardinality', 'executionDetails ExecutionDetails (0..1)', 'executionDetails ExecutionDetails (1..1)', true],
  [
    'input contract',
    'func EmptyExecutionDetails:',
    'func EmptyExecutionDetails:\n    inputs:\n        extra number (1..1)',
    false
  ],
  ['duplicate override', 'func EmptyTransferHistory:', 'func EmptyExecutionDetails:', false]
] as const)(
  'rejects source-only override %s before schema, validation, export or execution',
  async (_case, before, after, serialized) => {
    const original = await sourceFiles(serialized);
    const files = original.map((file) => ({
      ...file,
      content:
        file.uri === 'file:///model/implementations/event-common.rosetta'
          ? file.content.replace(before, after)
          : file.content
    }));
    const worker = await loadRealWorker();
    worker.dispatch({ type: 'preview:setFiles', filesRevision: 1, files });
    worker.dispatch({
      type: 'instance:generateSchema',
      typeFqn: 'cdm.event.common.ClearExecution#RosettaFunction',
      requestId: 'drift:schema'
    });
    worker.dispatch({
      type: 'instance:validate',
      functionInputs: true,
      typeFqn: 'cdm.event.common.ClearExecution',
      data: {},
      requestId: 'drift:validate'
    });
    worker.dispatch({
      type: 'preview:execute',
      funcName: 'cdm.event.common.ClearExecution',
      inputs: {},
      requestId: 'drift:execute'
    });
    worker.dispatch({
      type: 'codegen:generate',
      target: 'typescript',
      requestId: 'drift:export',
      selection: {
        namespaces: [],
        declarations: [{ namespace: 'cdm.event.common', name: 'ClearExecution', kind: 'RosettaFunction' }]
      }
    });
    for (const requestId of ['drift:schema', 'drift:validate', 'drift:execute', 'drift:export'])
      await vi.waitFor(
        () => expect(worker.scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId })),
        { timeout: 15000 }
      );
    expect(worker.scope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'instance:generateSchemaStale',
        requestId: 'drift:schema',
        message: expect.stringContaining('NAMESPACE_OVERRIDE')
      })
    );
    expect(worker.scope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'instance:validateResult',
        requestId: 'drift:validate',
        unavailable: expect.stringContaining('NAMESPACE_OVERRIDE')
      })
    );
    expect(worker.scope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'preview:execute-error',
        requestId: 'drift:execute',
        error: expect.stringContaining('NAMESPACE_OVERRIDE')
      })
    );
    expect(worker.scope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'codegen:error',
        requestId: 'drift:export',
        message: expect.stringContaining('NAMESPACE_OVERRIDE')
      })
    );
    worker.dispatch({ type: 'preview:setFiles', filesRevision: 2, files: original });
    worker.dispatch({
      type: 'preview:execute',
      funcName: 'cdm.event.common.ClearExecution',
      inputs: {},
      requestId: 'drift:recovered'
    });
    await vi.waitFor(
      () =>
        expect(worker.scope.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'preview:execute-result',
            requestId: 'drift:recovered',
            output: true
          })
        ),
      { timeout: 15000 }
    );
  },
  30000
);

it('links and removes source-only overrides before function validation and execution', async () => {
  const worker = await loadRealWorker();
  const files = await sourceFiles();
  worker.dispatch({ type: 'preview:setFiles', filesRevision: 1, files });
  worker.dispatch({
    type: 'instance:validate',
    functionInputs: true,
    typeFqn: 'cdm.event.common.ClearExecution',
    data: {},
    requestId: 'source:validate'
  });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'instance:validateResult', requestId: 'source:validate', diagnostics: [] })
      ),
    { timeout: 15000 }
  );
  worker.dispatch({
    type: 'preview:execute',
    funcName: 'cdm.event.common.ClearExecution',
    inputs: {},
    requestId: 'source:execute'
  });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'preview:execute-result', requestId: 'source:execute', output: true })
      ),
    { timeout: 15000 }
  );
  worker.dispatch({
    type: 'preview:setFiles',
    filesRevision: 2,
    files: files.filter((file) => file.uri !== 'file:///model/implementations/event-common.rosetta')
  });
  worker.dispatch({
    type: 'preview:execute',
    funcName: 'cdm.event.common.ClearExecution',
    inputs: {},
    requestId: 'source:removed'
  });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'preview:execute-error',
          requestId: 'source:removed',
          error: expect.stringMatching(/implementation|implemented|unavailable/i)
        })
      ),
    { timeout: 15000 }
  );
}, 30000);

it('executes the Rune source pack through the managed Prototype worker without native callbacks', async () => {
  const sources = [...cdmRuneImplementationSources].map(([path, content]) => ({
    path,
    name: path.split('/').at(-1)!,
    content,
    dirty: false
  }));
  const snapshot = await createProjectSnapshot(
    'cdm-rune',
    new Map([
      ['rune-config.yml', 'model: {name: CDM Rune}\n'],
      ['build-config.yml', 'schemaVersion: 1\nsources: ["model/**/*.rosetta"]\n'],
      ...cdmRuneImplementationSources
    ]),
    () => []
  );
  const project = await captureProjectRuntimeInput(snapshot, sources, cdmRuneReferenceDocuments);
  const worker = await loadRealWorker();
  worker.dispatch({ type: 'preview:setFiles', filesRevision: 1, files: [], project, requestId: 'cdm:install' });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'preview:files-ready',
          requestId: 'cdm:install',
          projectReceipt: project.receipt
        })
      ),
    { timeout: 15000 }
  );
  for (const [index, value] of [
    { funcName: 'cdm.event.common.ClearExecution', inputs: {}, output: true },
    { funcName: 'cdm.event.common.ClearHistory', inputs: {}, output: 0 },
    { funcName: 'cdm.base.datetime.Pop', inputs: { dates: [] }, output: [] },
    {
      funcName: 'cdm.base.datetime.Pop',
      inputs: { dates: ['2024-02-29', '2024-02-29', '2024-03-01'] },
      output: ['2024-02-29', '2024-02-29']
    }
  ].entries()) {
    const requestId = `cdm:execute:${index}`;
    worker.dispatch({
      type: 'preview:execute',
      funcName: value.funcName,
      inputs: value.inputs,
      requestId,
      projectReceipt: project.receipt
    });
    await vi.waitFor(
      () =>
        expect(worker.scope.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'preview:execute-result',
            requestId,
            output: value.output,
            projectReceipt: project.receipt
          })
        ),
      { timeout: 15000 }
    );
  }
  const removed = await createProjectDraftSnapshot(
    snapshot,
    new Map([['model/implementations/event-common.rosetta', null]]),
    () => []
  );
  const missing = await captureProjectRuntimeInput(
    removed,
    sources.filter((file) => file.path !== 'model/implementations/event-common.rosetta'),
    cdmRuneReferenceDocuments
  );
  worker.dispatch({
    type: 'preview:setFiles',
    filesRevision: 2,
    files: [],
    project: missing,
    requestId: 'cdm:removed'
  });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'preview:files-ready',
          requestId: 'cdm:removed',
          projectReceipt: missing.receipt
        })
      ),
    { timeout: 15000 }
  );
  worker.dispatch({
    type: 'preview:execute',
    funcName: 'cdm.event.common.ClearExecution',
    inputs: {},
    requestId: 'cdm:unavailable',
    projectReceipt: missing.receipt
  });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'preview:execute-error',
          requestId: 'cdm:unavailable',
          error: expect.stringMatching(/implementation|implemented|unavailable/i)
        })
      ),
    { timeout: 15000 }
  );
}, 30000);
