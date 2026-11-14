// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { beforeAll, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { generateSelected, generatePreviewSchemas, generatePythonModule } from '@rune-langium/codegen/export';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { runPython } from '../../codegen/test/projection/python-test-utils.js';
import { createBenchmarkProject, benchmarkIndex as index } from '../../../test/helpers/benchmark-project.js';
import { marketDeclarations } from '../../../test/helpers/cdm-market-observations.js';
import { benchmarkFeeds } from '../../../test/helpers/benchmark-feeds.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';
import { BenchmarkSeriesSchema } from '../src/market-data.js';
import { buildEffectiveProject } from '../src/effective-project.js';

let graph: Awaited<ReturnType<typeof buildEffectiveProject>>;
beforeAll(async () => {
  const project = await createBenchmarkProject();
  graph = await buildEffectiveProject(project.installed, project.references);
  expect(graph.diagnostics).toEqual([]);
}, GENERATED_MODULE_TEST_TIMEOUT);

const dates = ['2026-11-03', '2026-11-02', '2026-11-03'];
it.each(['single-file', 'per-namespace', 'barrel'] as const)(
  'runs all six saved series offline through the installed Rune provider (%s)',
  async (layout) => {
    const { outputs } = await generateSelected(
      [...graph.documents],
      { namespaces: [], declarations: [...marketDeclarations] },
      { target: 'typescript', strict: true, typescript: { layout } }
    );
    expect(outputs.flatMap((output) => output.diagnostics)).toEqual([]);
    const entry = outputs.find((output) => output.funcs.some((fn) => fn.name === 'GetMarketRates'))!;
    const fn = entry.funcs.find((fn) => fn.name === 'GetMarketRates')!;
    const module = compileGeneratedTypeScript(outputs, { entry: entry.relativePath });
    const invoke = module[fn.exportName!]!;
    for (const series of BenchmarkSeriesSchema.options) {
      const values = benchmarkFeeds[series].expected;
      const observed = invoke(
        index(series).floatingRateIndex,
        dates.map((date) => Temporal.PlainDate.from(date))
      );
      expect(JSON.parse(JSON.stringify(observed))).toEqual(
        dates.map((date, i) => ({ date, value: values[i === 1 ? 0 : 1] }))
      );
    }
    expect(() =>
      invoke(index('sofr', { period: 'M', periodMultiplier: 3 }).floatingRateIndex, [
        Temporal.PlainDate.from(dates[0]!)
      ])
    ).toThrow('BenchmarkTenorSupported');
    expect(() => invoke(index('sofr').floatingRateIndex, [Temporal.PlainDate.from('2026-11-04')])).toThrow(
      'MarketObservationMissing'
    );
    const unsupported = {
      ...index('sofr').floatingRateIndex,
      floatingRateIndex: { value: 'USD_SOFR_CME_Term', meta: {} }
    };
    expect(() => invoke(unsupported, [Temporal.PlainDate.from(dates[0]!)])).toThrow('BenchmarkIndexSupported');
    const preview = generatePreviewSchemas([...graph.documents], {
      targetId: 'cdm.event.instructioncomposition.reset.GetMarketRates'
    });
    expect(preview).toHaveLength(1);
    expect(preview[0]?.executionUnavailable).toBeUndefined();
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it(
  'runs the same saved provider through upstream IndexValueObservation in Python',
  () => {
    const python = generatePythonModule(graph.documents);
    expect(python.diagnostics).toEqual([]);
    const fn = python.bindings.get('cdm.observable.asset.calculatedrate.IndexValueObservation');
    const results = runPython(
      BenchmarkSeriesSchema.options.map((series) => ({
        expression: `${fn}(data)`,
        data: { observationDate: '2026-11-02', interestRateIndex: index(series) }
      })),
      python.code,
      { includeRuntime: false }
    );
    expect(results).toEqual(
      BenchmarkSeriesSchema.options.map((series) => ({ value: benchmarkFeeds[series].expected[0] }))
    );
  },
  GENERATED_MODULE_TEST_TIMEOUT
);
