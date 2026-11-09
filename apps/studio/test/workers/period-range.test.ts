// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';
import { createCuratedRuneProject } from '../../../../test/helpers/curated-rune-project.js';
import {
  periodRangeCaller,
  periodRangeCases,
  periodRangeDirectory
} from '../../../../test/helpers/cdm-period-range.js';
import { captureProjectRuntimeInput } from '../../src/services/project-runtime-input.js';
import { loadRealWorker } from './helpers/real-codegen-worker.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('executes the installed period range through Prototype with the curated date helpers', async () => {
  const project = await createCuratedRuneProject(periodRangeDirectory, periodRangeCaller);
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
    requestId: 'period-range:install'
  });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'period-range:install',
          type: 'preview:files-ready',
          projectReceipt: input.receipt
        })
      ),
    { timeout: 15000 }
  );
  const cases = periodRangeCases.filter((test) =>
    ['enter-leap-year', 'ignored-following', 'same-day-leap', 'reverse-day', 'missing-start'].includes(test.id)
  );
  for (const test of cases) {
    const requestId = `period-range:${test.id}`;
    worker.dispatch({
      type: 'preview:execute',
      funcName: 'example.periodrange.BuildPeriodRange',
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
          ? { type: 'preview:execute-error', error: expect.stringContaining(test.expectedError) }
          : { type: 'preview:execute-result', output: test.expected })
      })
    );
  }
}, 30000);
