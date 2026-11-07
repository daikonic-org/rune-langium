// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';
import { URI } from 'langium';
import { createRuneDslServices, assertValidDocuments, serializeRuneModel } from '@rune-langium/core';
import {
  calculationPeriodCases,
  calculationPeriodIdentity,
  calculationPeriodFiles,
  calculationPeriodCalendars,
  calculationPeriodCaller
} from '../../../../test/helpers/cdm-calculation-period.js';
import { installPublishedNativeImplementations } from '../../../../test/helpers/curated-implementations.js';
import { loadRealWorker } from './helpers/real-codegen-worker.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('executes the pinned selectors with published native leaves and an ordinary calendar override', async () => {
  const { RuneDsl } = createRuneDslServices();
  const references = calculationPeriodFiles(false);
  const documents = references.map((file) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(file.content, URI.parse(file.uri))
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(documents, { eagerLinking: true });
  assertValidDocuments(documents);
  installPublishedNativeImplementations(documents);
  const files = references.map((file, index) => ({
    uri: file.uri,
    content: '',
    serializedModelJson: serializeRuneModel(RuneDsl.serializer.JsonSerializer, documents[index]!.parseResult.value)
  }));
  const worker = await loadRealWorker();
  worker.dispatch({
    type: 'preview:setFiles',
    filesRevision: 1,
    files: [
      ...files,
      calculationPeriodCalendars,
      { uri: 'file:///model/calculation.rosetta', content: calculationPeriodCaller }
    ]
  });
  for (const test of calculationPeriodCases) {
    const requestId = `calculation:${test.id}`;
    worker.dispatch({ type: 'preview:execute', funcName: calculationPeriodIdentity, inputs: test.inputs, requestId });
    await vi.waitFor(
      () => expect(worker.scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId })),
      { timeout: 15000 }
    );
    expect(worker.scope.postMessage, test.id).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId,
        ...(test.expectedError
          ? { type: 'preview:execute-error', error: expect.stringMatching(new RegExp(test.expectedError, 'i')) }
          : { type: 'preview:execute-result', output: test.expected })
      })
    );
  }
  worker.dispatch({
    type: 'preview:execute',
    funcName: 'example.calculation.FixingPeriod',
    inputs: { start: '2024-03-01', end: '2024-03-08', offset: 1 },
    requestId: 'calculation:caller'
  });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'calculation:caller' })
      ),
    { timeout: 15000 }
  );
  expect(worker.scope.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'preview:execute-result',
      requestId: 'calculation:caller',
      output: { adjustedStartDate: '2024-03-06', adjustedEndDate: '2024-03-11' }
    })
  );
  worker.dispatch({ type: 'preview:setFiles', filesRevision: 2, files });
  for (const [index, test] of calculationPeriodCases.slice(0, 3).entries()) {
    const requestId = `removed-calendar:${test.id}`;
    worker.dispatch({ type: 'preview:execute', funcName: calculationPeriodIdentity, inputs: test.inputs, requestId });
    await vi.waitFor(
      () => expect(worker.scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId })),
      { timeout: 15000 }
    );
    expect(worker.scope.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId,
        ...(index === 2
          ? {
              type: 'preview:execute-error',
              error: expect.stringMatching(/BusinessCenterHolidays|implementation|binding/i)
            }
          : { type: 'preview:execute-result', output: test.expected })
      })
    );
  }
}, 30000);
