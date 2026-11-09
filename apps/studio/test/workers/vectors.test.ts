// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';
import { createCuratedRuneProject } from '../../../../test/helpers/curated-rune-project.js';
import { vectorDirectory, vectorCaller, vectorCases, vectorCallers } from '../../../../test/helpers/cdm-vectors.js';
import { loadRealWorker } from './helpers/real-codegen-worker.js';
import { captureProjectRuntimeInput } from '../../src/services/project-runtime-input.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('executes installed vector math, omissions and cumulative decimal state through the real worker', async () => {
  const project = await createCuratedRuneProject(vectorDirectory, vectorCaller);
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
    requestId: 'vectors:install'
  });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'vectors:install',
          type: 'preview:files-ready',
          projectReceipt: input.receipt
        })
      ),
    { timeout: 15000 }
  );
  for (const test of vectorCases.filter((test) =>
    /upstream|half-even-ties|zero-pair|underflow-recovery|growth-empty/.test(test.id)
  )) {
    const requestId = `vectors:${test.id}`;
    worker.dispatch({
      type: 'preview:execute',
      funcName: `example.vectors.${vectorCallers[test.function]}`,
      inputs: test.inputs,
      requestId,
      projectReceipt: input.receipt
    });
    await vi.waitFor(
      () =>
        expect(worker.scope.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ requestId, type: 'preview:execute-result', output: test.expected })
        ),
      { timeout: 15000 }
    );
  }
}, 30000);
