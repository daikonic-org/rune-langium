// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { afterEach, expect, it, vi } from 'vitest';
import { createProjectDraftSnapshot } from '@rune-langium/project-config';
import { createCuratedRuneProject } from '../../../../test/helpers/curated-rune-project.js';
import {
  strikeScheduleDirectory,
  strikeScheduleCaller,
  strikeScheduleCases
} from '../../../../test/helpers/cdm-strike-schedule.js';
import { loadRealWorker } from './helpers/real-codegen-worker.js';
import { captureProjectRuntimeInput } from '../../src/services/project-runtime-input.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('executes the installed positional mapper, preserves partial rows and validates their missing dates', async () => {
  const project = await createCuratedRuneProject(strikeScheduleDirectory, strikeScheduleCaller);
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
    requestId: 'strike:install'
  });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'strike:install',
          type: 'preview:files-ready',
          projectReceipt: input.receipt
        })
      ),
    { timeout: 15000 }
  );
  for (const test of strikeScheduleCases) {
    const requestId = `strike:${test.id}`;
    worker.dispatch({
      type: 'preview:execute',
      funcName: 'example.strike.StrikeSchedule',
      inputs: {
        prices: test.inputs.fpmlStrikePricePerUnitStepList,
        dates: test.inputs.fpmlCommodityStrikePriceDateList
      },
      requestId,
      projectReceipt: input.receipt
    });
    await vi.waitFor(
      () => expect(worker.scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId })),
      { timeout: 15000 }
    );
    expect(worker.scope.postMessage, test.id).toHaveBeenCalledWith(
      expect.objectContaining({ requestId, type: 'preview:execute-result', output: test.expected })
    );
  }
  for (const [index, row] of [{ value: 10, date: '2024-01-01' }, { value: 10 }].entries()) {
    const requestId = `strike:validate-row:${index}`;
    worker.dispatch({
      type: 'instance:validate',
      typeFqn: 'cdm.base.math.DatedValue',
      data: row,
      requestId,
      projectReceipt: input.receipt
    });
    await vi.waitFor(
      () =>
        expect(worker.scope.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            requestId,
            type: 'instance:validateResult',
            diagnostics: index === 0 ? [] : expect.arrayContaining([expect.objectContaining({ path: 'date' })])
          })
        ),
      { timeout: 15000 }
    );
  }
  const path = 'model/implementations/cdm/strike-schedule.rosetta';
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
    requestId: 'strike:remove'
  });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'strike:remove', type: 'preview:files-ready' })
      ),
    { timeout: 15000 }
  );
  worker.dispatch({
    type: 'preview:execute',
    funcName: 'example.strike.StrikeSchedule',
    inputs: { prices: [], dates: [] },
    requestId: 'strike:removed',
    projectReceipt: missing.receipt
  });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'strike:removed', type: 'preview:execute-error' })
      ),
    { timeout: 15000 }
  );
}, 30000);
