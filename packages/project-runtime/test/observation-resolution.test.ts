// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { generatePreviewSchemas, generatePythonModule, generateSelected } from '@rune-langium/codegen/export';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { runPython } from '../../codegen/test/projection/python-test-utils.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';
import {
  createCuratedObservationResolutionProject,
  observationResolutionCases,
  observationResolutionDeclarations,
  type ObservationResolutionCase
} from '../../../test/helpers/cdm-observation-resolution.js';
import { buildEffectiveProject } from '../src/effective-project.js';

const selection = { namespaces: [], declarations: [...observationResolutionDeclarations] };
let graph: Awaited<ReturnType<typeof buildEffectiveProject>>;

beforeAll(async () => {
  const project = await createCuratedObservationResolutionProject();
  graph = await buildEffectiveProject(project.installed, project.references);
  expect(graph.diagnostics).toEqual([]);
  expect(
    graph.documents.flatMap(({ uri, parseResult }) =>
      [...parseResult.lexerErrors, ...parseResult.parserErrors].map(({ message }) => uri.path + ': ' + message)
    )
  ).toEqual([]);
  expect([...project.changes.keys()]).toEqual(
    expect.arrayContaining([
      'model/implementations/cdm/resolve-observation.rosetta',
      'model/implementations/cdm/resolve-rate-index.rosetta',
      'model/implementations/cdm/rune-math.rosetta'
    ])
  );
}, GENERATED_MODULE_TEST_TIMEOUT);

function fixtureFunction(test: ObservationResolutionCase) {
  return test.function === 'ResolveRateIndex' ? 'PublishedIndexRate' : 'ResolveFixtureObservations';
}

function input(test: ObservationResolutionCase) {
  if (test.function === 'ResolveRateIndex') return { code: test.index };
  return {
    days: test.days,
    page: test.page ?? 'Main',
    scheme: test.scheme,
    averagingMethod: test.calculation
      ? { calculationMethod: test.calculation, isWeighted: test.weighted ?? false }
      : undefined
  };
}

function expectValue(value: unknown, test: ObservationResolutionCase) {
  if (test.function === 'ResolveRateIndex') {
    expect(value, test.id).toBe(test.value);
    return;
  }
  const aggregated = (test.days?.length ?? 0) > 1;
  const day = aggregated ? 28 : test.days?.[0];
  const scheme = aggregated ? 'urn:fixture:aggregate' : test.scheme;
  expect(value, test.id).toMatchObject({
    observedValue: {
      value: expect.closeTo(test.value!, 10),
      unit: { currency: { value: 'USD' } },
      perUnitOf: { financialUnit: 'Share' },
      priceType: 'AssetPrice'
    },
    observationIdentifier: {
      observationDate: '2024-10-' + String(day).padStart(2, '0'),
      informationSource: {
        sourcePage: {
          value: aggregated ? 'Aggregate' : (test.page ?? 'Main'),
          ...(scheme ? { meta: { scheme } } : {})
        }
      }
    }
  });
}

it('projects the published rate codelist as Rune enum choices', () => {
  const [preview] = generatePreviewSchemas([...graph.documents], {
    targetId: 'example.observation.PublishedIndexRate'
  });
  expect(preview?.fields[0]).toMatchObject({
    kind: 'enum',
    enumValues: expect.arrayContaining([{ value: 'EUR-EURIBOR', label: 'EUR-EURIBOR' }])
  });
});

it.each(['per-namespace', 'barrel'] as const)(
  'resolves observations and the nominated rate snapshot in strict %s TypeScript',
  async (layout) => {
    const { outputs } = await generateSelected([...graph.documents], selection, {
      target: 'typescript',
      strict: true,
      typescript: { layout }
    });
    expect(outputs.flatMap((output) => output.diagnostics)).toEqual([]);
    const entry = outputs.find((output) => output.funcs.some((fn) => fn.name === 'ResolveFixtureObservations'))!;
    const compiled = compileGeneratedTypeScript(outputs, { entry: entry.relativePath });
    for (const test of observationResolutionCases) {
      const fn = entry.funcs.find(({ name }) => name === fixtureFunction(test))!;
      const run = () => compiled[fn.exportName ?? fn.name]!(...Object.values(input(test)));
      if (test.error) expect(run, test.id).toThrow(test.error);
      else expectValue(JSON.parse(JSON.stringify(run())), test);
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it(
  'resolves the rate snapshot in a focused strict single-file TypeScript export',
  async () => {
    const { outputs } = await generateSelected(
      [...graph.documents],
      { namespaces: [], declarations: [observationResolutionDeclarations[3]] },
      { target: 'typescript', strict: true, typescript: { layout: 'single-file' } }
    );
    expect(outputs.flatMap((output) => output.diagnostics)).toEqual([]);
    const entry = outputs.find((output) => output.funcs.some((fn) => fn.name === 'PublishedIndexRate'))!;
    const compiled = compileGeneratedTypeScript(outputs, { entry: entry.relativePath });
    const fn = entry.funcs.find(({ name }) => name === 'PublishedIndexRate')!;
    for (const test of observationResolutionCases.filter(({ function: name }) => name === 'ResolveRateIndex')) {
      const run = () => compiled[fn.exportName ?? fn.name]!(test.index);
      if (test.error) expect(run, test.id).toThrow(test.error);
      else expectValue(run(), test);
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it(
  'reports missing project data bindings on both execution targets',
  async () => {
    const project = await createCuratedObservationResolutionProject(false);
    const unbound = await buildEffectiveProject(project.installed, project.references);
    expect(unbound.diagnostics).toEqual([]);
    const { outputs } = await generateSelected([...unbound.documents], selection, {
      target: 'typescript',
      strict: true,
      typescript: { layout: 'per-namespace' }
    });
    const python = generatePythonModule(unbound.documents);
    for (const diagnostics of [outputs.flatMap((output) => output.diagnostics), python.diagnostics]) {
      for (const name of ['ReadObservationInputs', 'ReadRateIndexSnapshot']) {
        expect(diagnostics).toContainEqual(
          expect.objectContaining({
            code: 'native-implementation-unavailable',
            message: expect.stringContaining('impl.cdm.market.' + name)
          })
        );
      }
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it(
  'resolves the same supplied observations and rates in standalone Python',
  () => {
    const python = generatePythonModule(graph.documents);
    expect(python.diagnostics).toEqual([]);
    const results = runPython(
      observationResolutionCases.map((test) => ({
        expression: python.bindings.get('example.observation.' + fixtureFunction(test)) + '(data)',
        data: input(test)
      })),
      python.code,
      { includeRuntime: false }
    );
    expect(results).toHaveLength(observationResolutionCases.length);
    for (const [index, test] of observationResolutionCases.entries()) {
      const result = results[index]!;
      if (test.error) expect(result, test.id).toEqual({ error: expect.stringContaining(test.error) });
      else {
        expect(result, test.id).toHaveProperty('value');
        expectValue('value' in result ? result.value : undefined, test);
      }
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);
