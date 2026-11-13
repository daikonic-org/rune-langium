// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { afterEach, expect, it, vi } from 'vitest';
import { BenchmarkSeriesSchema } from '@rune-langium/project-runtime/market-data';
import { benchmarkFeeds } from '../../../../test/helpers/benchmark-feeds.js';
import { createBenchmarkProject, benchmarkIndex } from '../../../../test/helpers/benchmark-project.js';
import { captureProjectRuntimeInput } from '../../src/services/project-runtime-input.js';
import { loadRealWorker } from './helpers/real-codegen-worker.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('executes all six saved series offline through the managed Prototype receipt boundary', async () => {
  const installed = await createBenchmarkProject();
  const files = [...installed.installed.files]
    .filter(([path]) => path.endsWith('.rosetta'))
    .map(([path, content]) => ({ path, name: path.split('/').at(-1)!, content, dirty: false }));
  const project = await captureProjectRuntimeInput(installed.installed, files, installed.references);
  const worker = await loadRealWorker();
  worker.dispatch({ type: 'preview:setFiles', filesRevision: 1, files: [], project, requestId: 'benchmark:install' });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'preview:files-ready',
          requestId: 'benchmark:install',
          projectReceipt: project.receipt
        })
      ),
    { timeout: 15000 }
  );
  for (const series of BenchmarkSeriesSchema.options) {
    const requestId = `benchmark:${series}`;
    worker.dispatch({
      type: 'preview:execute',
      funcName: 'cdm.observable.asset.calculatedrate.IndexValueObservation',
      inputs: { observationDate: '2026-11-02', interestRateIndex: benchmarkIndex(series) },
      requestId,
      projectReceipt: project.receipt
    });
    await vi.waitFor(
      () =>
        expect(worker.scope.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'preview:execute-result',
            requestId,
            output: benchmarkFeeds[series].expected[0],
            projectReceipt: project.receipt
          })
        ),
      { timeout: 15000 }
    );
  }
  worker.dispatch({
    type: 'preview:execute',
    funcName: 'cdm.observable.asset.calculatedrate.IndexValueObservation',
    inputs: { observationDate: '2026-11-04', interestRateIndex: benchmarkIndex('estr') },
    requestId: 'benchmark:missing',
    projectReceipt: project.receipt
  });
  await vi.waitFor(
    () =>
      expect(worker.scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'preview:execute-error',
          requestId: 'benchmark:missing',
          error: expect.stringContaining('MarketObservationMissing')
        })
      ),
    { timeout: 15000 }
  );
}, 30000);
