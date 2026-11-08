// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';
import { createProjectDraftSnapshot } from '@rune-langium/project-config';
import { createCuratedFrequencyProject } from '../../../../test/helpers/curated-frequency.js';
import { frequencyCases } from '../../../../test/helpers/cdm-frequency.js';
import { loadRealWorker } from './helpers/real-codegen-worker.js';
import { captureProjectRuntimeInput } from '../../src/services/project-runtime-input.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('executes the installed Strata port through its CDM adapter and releases a removed override', async () => {
  const project = await createCuratedFrequencyProject();
  const sources = [...project.installed.files]
    .filter(([path]) => path.endsWith('.rosetta'))
    .map(([path, content]) => ({ path, name: path.split('/').at(-1)!, content, dirty: false }));
  const input = await captureProjectRuntimeInput(project.installed, sources, project.references);
  const worker = await loadRealWorker();
  worker.dispatch({
    type: 'preview:setFiles',
    filesRevision: 1,
    files: [],
    project: input,
    requestId: 'frequency:install'
  });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'frequency:install',
          type: 'preview:files-ready',
          projectReceipt: input.receipt
        })
      ),
    { timeout: 15000 }
  );
  for (const test of frequencyCases) {
    const requestId = `frequency:${test.id}`;
    worker.dispatch({
      type: 'preview:execute',
      funcName: 'example.frequency.AnnualPeriods',
      inputs: test.inputs,
      requestId,
      projectReceipt: input.receipt
    });
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
  const path = 'model/implementations/cdm/frequency.rosetta';
  const removed = await createProjectDraftSnapshot(project.installed, new Map([[path, null]]), () => []);
  const missing = await captureProjectRuntimeInput(
    removed,
    sources.filter((file) => file.path !== path),
    project.references
  );
  worker.dispatch({
    type: 'preview:setFiles',
    filesRevision: 2,
    files: [],
    project: missing,
    requestId: 'frequency:remove'
  });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'frequency:remove',
          type: 'preview:files-ready',
          projectReceipt: missing.receipt
        })
      ),
    { timeout: 15000 }
  );
  worker.dispatch({
    type: 'preview:execute',
    funcName: 'example.frequency.AnnualPeriods',
    inputs: frequencyCases[0]!.inputs,
    requestId: 'frequency:removed',
    projectReceipt: missing.receipt
  });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'frequency:removed', type: 'preview:execute-error' })
      ),
    { timeout: 15000 }
  );
}, 30000);
