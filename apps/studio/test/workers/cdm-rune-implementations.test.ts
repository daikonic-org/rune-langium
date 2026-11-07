// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';
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

it('links and removes source-only overrides before function validation and execution', async () => {
  const worker = await loadRealWorker();
  const files = [
    ...cdmRuneReferenceDocuments.map((document) => ({
      uri: `file:///reference/${document.uri}`,
      content: document.content
    })),
    ...[...cdmRuneImplementationSources].map(([path, content]) => ({ uri: `file:///${path}`, content }))
  ];
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
