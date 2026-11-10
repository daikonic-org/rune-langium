// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { generatePythonModule, generateSelected } from '@rune-langium/codegen/export';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { runPython } from '../../codegen/test/projection/python-test-utils.js';
import {
  createCuratedMarketProject,
  marketCases,
  marketDeclarations,
  marketExpected,
  marketIndex,
  type MarketCase
} from '../../../test/helpers/cdm-market-observations.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';
import { buildEffectiveProject } from '../src/effective-project.js';

const selection = { namespaces: [], declarations: [...marketDeclarations] };
let graph: Awaited<ReturnType<typeof buildEffectiveProject>>;

beforeAll(async () => {
  const project = await createCuratedMarketProject();
  graph = await buildEffectiveProject(project.installed, project.references);
  expect(graph.diagnostics).toEqual([]);
}, GENERATED_MODULE_TEST_TIMEOUT);

function input(test: MarketCase) {
  const index = marketIndex(test);
  if (test.function === 'GetMarketRates')
    return { floatingRateIndex: index.floatingRateIndex, observationDates: test.dates };
  return {
    observationDate: test.function === 'IndexValueObservation' ? test.dates[0] : test.dates,
    interestRateIndex: index
  };
}

it.each(['per-namespace', 'barrel', 'single-file'] as const)(
  'executes the installed provider and observation selection in strict %s TypeScript',
  async (layout) => {
    const { outputs } = await generateSelected([...graph.documents], selection, {
      target: 'typescript',
      strict: true,
      typescript: { layout }
    });
    expect(outputs.flatMap((output) => output.diagnostics)).toEqual([]);
    const loaded = new Map<string, ReturnType<typeof compileGeneratedTypeScript>>();
    for (const test of marketCases) {
      const entry = outputs.find((output) => output.funcs.some((fn) => fn.name === test.function))!;
      const fn = entry.funcs.find((fn) => fn.name === test.function)!;
      let functions = loaded.get(entry.relativePath);
      if (!functions) {
        functions = compileGeneratedTypeScript(outputs, { entry: entry.relativePath, checkTypes: loaded.size === 0 });
        loaded.set(entry.relativePath, functions);
      }
      const dates = test.dates.map((date) => Temporal.PlainDate.from(date));
      const index = marketIndex(test);
      const call = functions[fn.exportName ?? fn.name]!;
      const run = () =>
        test.function === 'GetMarketRates'
          ? call(index.floatingRateIndex, dates)
          : call(test.function === 'IndexValueObservation' ? dates[0] : dates, index);
      if (test.error) expect(run, test.id).toThrow(test.error);
      else expect(JSON.parse(JSON.stringify(run())), test.id).toEqual(marketExpected(test));
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it(
  'uses the same provider and observations in standalone Python',
  () => {
    const python = generatePythonModule(graph.documents);
    expect(python.diagnostics).toEqual([]);
    const results = runPython(
      marketCases.map((test) => {
        const target = marketDeclarations.find((declaration) => declaration.name === test.function)!;
        const fn = python.bindings.get(target.namespace + '.' + target.name);
        return { expression: fn + '(data)', data: input(test) };
      }),
      python.code,
      { includeRuntime: false }
    );
    expect(results).toHaveLength(marketCases.length);
    for (const [index, test] of marketCases.entries())
      expect(results[index], test.id).toEqual(
        test.error ? { error: expect.stringContaining(test.error) } : { value: marketExpected(test) }
      );
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it(
  'reports the missing provider in the selected closure without substituting a market rate',
  async () => {
    const project = await createCuratedMarketProject(false);
    const unbound = await buildEffectiveProject(project.installed, project.references);
    expect(unbound.diagnostics).toEqual([]);
    const { outputs } = await generateSelected([...unbound.documents], selection, {
      target: 'typescript',
      strict: true
    });
    expect(outputs.flatMap((output) => output.diagnostics)).toContainEqual(
      expect.objectContaining({
        code: 'native-implementation-unavailable',
        message: expect.stringContaining('impl.cdm.market.ReadMarketObservations')
      })
    );
    const entry = outputs.find((output) => output.funcs.some((fn) => fn.name === 'IndexValueObservation'))!;
    const functions = compileGeneratedTypeScript(outputs, { entry: entry.relativePath });
    expect(() =>
      functions.IndexValueObservation!(Temporal.PlainDate.from('2021-07-31'), marketIndex(marketCases[0]!))
    ).toThrow('ReadMarketObservations');

    const python = generatePythonModule(unbound.documents);
    expect(python.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'native-implementation-unavailable',
        message: expect.stringContaining('impl.cdm.market.ReadMarketObservations')
      })
    );
    const observe = python.bindings.get('example.market.ObserveFixtureDate')!;
    expect(
      runPython([{ expression: observe + '(data)', data: { observationDate: '2021-07-31' } }], python.code, {
        includeRuntime: false
      })
    ).toEqual([{ error: expect.stringContaining('ReadMarketObservations') }]);
  },
  GENERATED_MODULE_TEST_TIMEOUT
);
