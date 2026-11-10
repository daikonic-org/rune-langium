// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { generatePythonModule, generateSelected } from '@rune-langium/codegen/export';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { runPython } from '../../codegen/test/projection/python-test-utils.js';
import {
  createCuratedResetForwardProject,
  fixtureTrade,
  resetForwardCases,
  resetForwardInput,
  type ResetForwardCase
} from '../../../test/helpers/cdm-reset-forward-rates.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';
import { buildEffectiveProject } from '../src/effective-project.js';

const reset = { namespace: 'cdm.event.common', name: 'ResolveReset', kind: 'RosettaFunction' } as const;
const forward = { namespace: 'example.resetforward', name: 'PublishedForwardRate', kind: 'RosettaFunction' } as const;
const markToMarket = { namespace: 'cdm.event.position', name: 'FxMarkToMarket', kind: 'RosettaFunction' } as const;
const selection = { namespaces: [], declarations: [reset, forward, markToMarket] };
let graph: Awaited<ReturnType<typeof buildEffectiveProject>>;

beforeAll(async () => {
  const project = await createCuratedResetForwardProject();
  graph = await buildEffectiveProject(project.installed, project.references);
  expect(graph.diagnostics).toEqual([]);
  expect(
    graph.documents.flatMap(({ uri, parseResult }) =>
      [...parseResult.lexerErrors, ...parseResult.parserErrors].map(({ message }) => uri.path + ': ' + message)
    )
  ).toEqual([]);
  expect([...project.changes.keys()]).toEqual(
    expect.arrayContaining(
      ['resolve-reset', 'interpolate-forward-rate', 'strata-linear-interpolation'].map(
        (name) => 'model/implementations/cdm/' + name + '.rosetta'
      )
    )
  );
}, GENERATED_MODULE_TEST_TIMEOUT);

function expectValue(value: unknown, test: ResetForwardCase) {
  if (test.function === 'InterpolateForwardRate') {
    expect(value, test.id).toBeCloseTo(test.value!, 12);
    return;
  }
  expect(value, test.id).toMatchObject({
    resetDate: test.date,
    ...(test.recordDate ? { rateRecordDate: test.recordDate } : {}),
    resetValue: { value: test.value },
    observations: [
      {
        value: {
          observedValue: { value: test.value },
          observationIdentifier: { observationDate: test.recordDate ?? test.date }
        }
      }
    ]
  });
}

it('runs the curated reset and rate bodies and the original FX caller in strict TypeScript', async () => {
  const { outputs } = await generateSelected([...graph.documents], selection, {
    target: 'typescript',
    strict: true,
    typescript: { layout: 'barrel' }
  });
  expect(outputs.flatMap((output) => output.diagnostics.filter(({ severity }) => severity === 'error'))).toEqual([]);
  const execute = compileGeneratedTypeScript(outputs, { entry: 'index.ts', checkTypes: 'workspace' });
  const nativeDate = (value: string) => Temporal.PlainDate.from(value);
  for (const test of resetForwardCases) {
    const name = test.function === 'ResolveReset' ? reset.name : forward.name;
    const run = () => execute[name]!(...Object.values(resetForwardInput(test, nativeDate)));
    if (test.error) expect(run, test.id).toThrow(test.error);
    else expectValue(JSON.parse(JSON.stringify(run())), test);
    if (test.function === 'InterpolateForwardRate' && test.markToMarket !== undefined)
      expect(execute[markToMarket.name]!(fixtureTrade(test.date, test.curve, nativeDate))).toBeCloseTo(
        test.markToMarket,
        10
      );
  }
}, 60_000);

it(
  'runs the same curated functions and original caller in standalone Python',
  () => {
    const python = generatePythonModule(graph.documents);
    expect(python.diagnostics.filter(({ severity }) => severity === 'error')).toEqual([]);
    const cases = resetForwardCases.map((test) => {
      const { namespace, name } = test.function === 'ResolveReset' ? reset : forward;
      return { expression: python.bindings.get(namespace + '.' + name) + '(data)', data: resetForwardInput(test) };
    });
    const fxCase = resetForwardCases.find(
      (test) => test.function === 'InterpolateForwardRate' && test.markToMarket !== undefined
    );
    if (fxCase?.function !== 'InterpolateForwardRate') throw new Error('Missing FX mark-to-market case.');
    const results = runPython(
      [
        ...cases,
        {
          expression: python.bindings.get(markToMarket.namespace + '.' + markToMarket.name) + '(data)',
          data: { trade: fixtureTrade(fxCase.date, fxCase.curve, (date) => date) }
        }
      ],
      python.code,
      { includeRuntime: false }
    );
    expect(results).toHaveLength(cases.length + 1);
    for (const [index, test] of resetForwardCases.entries()) {
      const result = results[index]!;
      if (test.error) expect(result, test.id).toEqual({ error: expect.stringContaining(test.error) });
      else expectValue('value' in result ? result.value : undefined, test);
    }
    expect(results.at(-1)).toEqual({ value: expect.closeTo(fxCase.markToMarket!, 10) });
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it(
  'reports the required forward snapshot binding in both targets',
  async () => {
    const project = await createCuratedResetForwardProject(false);
    const unbound = await buildEffectiveProject(project.installed, project.references);
    const { outputs } = await generateSelected([...unbound.documents], selection, { target: 'typescript' });
    const python = generatePythonModule(unbound.documents);
    for (const diagnostics of [outputs.flatMap((output) => output.diagnostics), python.diagnostics]) {
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'native-implementation-unavailable',
          message: expect.stringContaining('impl.cdm.market.ReadForwardRateSnapshot')
        })
      );
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);
