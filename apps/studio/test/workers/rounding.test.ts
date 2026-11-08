// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';
import { createCuratedRuneProject } from '../../../../test/helpers/curated-rune-project.js';
import { roundingDirectory, roundingCaller, roundingCases } from '../../../../test/helpers/cdm-rounding.js';
import { loadRealWorker } from './helpers/real-codegen-worker.js';
import { captureProjectRuntimeInput } from '../../src/services/project-runtime-input.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('executes published rounding with enum inputs through the managed worker and retains the Rune precondition', async () => {
  const project = await createCuratedRuneProject(roundingDirectory, roundingCaller);
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
    requestId: 'rounding:install'
  });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'rounding:install',
          type: 'preview:files-ready',
          projectReceipt: input.receipt
        })
      ),
    { timeout: 15000 }
  );
  const selected = roundingCases.filter((test) =>
    /^(positive-tie|negative-tie|minimum-subnormal)-.*-retain$/.test(test.id)
  );
  for (const test of selected) {
    const requestId = `rounding:${test.id}`;
    worker.dispatch({
      type: 'preview:execute',
      funcName: 'example.rounding.RoundQuote',
      inputs: test.inputs,
      requestId,
      projectReceipt: input.receipt
    });
    await vi.waitFor(
      () =>
        expect(worker.scope.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            requestId,
            type: 'preview:execute-result',
            output: test.expected
          })
        ),
      { timeout: 15000 }
    );
  }
  worker.dispatch({
    type: 'preview:execute',
    funcName: 'example.rounding.RoundQuote',
    inputs: { value: 1.005, precision: -1, roundingMode: 'Nearest', removeTrailingZeros: false },
    requestId: 'rounding:invalid',
    projectReceipt: input.receipt
  });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'rounding:invalid',
          type: 'preview:execute-error',
          error: expect.stringContaining('NonNegativePrecision')
        })
      ),
    { timeout: 15000 }
  );
}, 30000);
