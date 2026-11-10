// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { getFunctionInputs, isRosettaEnumeration, isRosettaFunction, isRosettaModel } from '@rune-langium/core';
import { generatePreviewSchemas, generatePythonModule, generateSelected } from '@rune-langium/codegen/export';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { runPython } from '../../codegen/test/projection/python-test-utils.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';
import {
  createCuratedFroProject,
  froCases,
  froDeclarations,
  type FroCase
} from '../../../test/helpers/cdm-floating-rate-metadata.js';
import { buildEffectiveProject } from '../src/effective-project.js';
import { selectCdmImplementation } from '../src/curated-implementations/cdm.js';

const selection = { namespaces: [], declarations: [...froDeclarations] };
let graph: Awaited<ReturnType<typeof buildEffectiveProject>>;

beforeAll(async () => {
  const project = await createCuratedFroProject();
  graph = await buildEffectiveProject(project.installed, project.references);
  expect(graph.diagnostics).toEqual([]);
  expect([...project.changes.keys()]).toEqual(
    expect.arrayContaining([
      'model/implementations/cdm/floating-rate-index-metadata.rosetta',
      'model/implementations/cdm/extract-floating-rate-option-data.rosetta',
      'model/implementations/cdm/floating-rate-index-matrix.rosetta'
    ])
  );
}, GENERATED_MODULE_TEST_TIMEOUT);

it('gives forms the pinned code-list enum and its wire value', () => {
  const [preview] = generatePreviewSchemas([...graph.documents], { targetId: 'example.fro.CatalogIndexCode' });
  expect(preview?.fields[0]).toMatchObject({
    kind: 'enum',
    enumValues: expect.arrayContaining([expect.objectContaining({ value: 'EUR-EURIBOR-Act/365' })])
  });
});

it('rejects enum membership drift in the publication signature', async () => {
  const abstract = graph.documents
    .flatMap((doc) => (isRosettaModel(doc.parseResult.value) ? doc.parseResult.value.elements : []))
    .filter(isRosettaFunction)
    .find((func) => func.name === 'FloatingRateIndexMetadata' && !func.operations.length);
  if (!abstract) throw new Error('Missing pinned abstract declaration.');
  expect(await selectCdmImplementation(abstract)).toMatchObject({ kind: 'rune' });
  const index = getFunctionInputs(abstract)[0]?.typeCall.type.ref;
  const member = isRosettaEnumeration(index) ? index.enumValues[0] : undefined;
  if (!member) throw new Error('Missing pinned index enum member.');
  const name = member.name;
  try {
    member.name = name + '_DRIFT';
    expect(await selectCdmImplementation(abstract)).toBeUndefined();
  } finally {
    member.name = name;
  }
});

function checkResult(result: unknown, test: FroCase) {
  if (test.expected === null) {
    expect(result ?? null, test.id).toBeNull();
  } else if (test.function === 'FloatingRateIndexMetadata' || test.function === 'ExtractFloatingRateOptionData') {
    expect(result, test.id).toMatchObject({ definitionalSource: test.expected });
  } else {
    expect(result, test.id).toEqual(test.expected);
  }
}

function pythonInput(test: FroCase) {
  switch (test.function) {
    case 'ExtractFloatingRateOptionData':
      return { tradeDate: test.tradeDate, floatingRateIndex: test.index };
    case 'FloatingRateIndexMetadata':
      return { floatingRateIndexName: test.index };
    case 'ValidateFloatingRateIndexName':
      return { floatingRateIndexName: test.index, contractualDefs: test.contractualDefs };
    case 'CatalogIndexCode':
      return { index: test.index };
  }
}

it.each(['per-namespace', 'barrel', 'single-file'] as const)(
  'selects the version and the index from installed sources in strict %s TypeScript',
  async (layout) => {
    const { outputs } = await generateSelected([...graph.documents], selection, {
      target: 'typescript',
      strict: true,
      typescript: { layout }
    });
    expect(outputs.flatMap((output) => output.diagnostics)).toEqual([]);
    const compiled = new Map<string, ReturnType<typeof compileGeneratedTypeScript>>();
    for (const test of froCases) {
      const entry = outputs.find((output) => output.funcs.some((fn) => fn.name === test.function))!;
      const fn = entry.funcs.find((fn) => fn.name === test.function)!;
      let loaded = compiled.get(entry.relativePath);
      if (!loaded) {
        loaded = compileGeneratedTypeScript(outputs, { entry: entry.relativePath, checkTypes: compiled.size === 0 });
        compiled.set(entry.relativePath, loaded);
      }
      const call = loaded[fn.exportName ?? fn.name]!;
      const run = () =>
        test.tradeDate
          ? call(Temporal.PlainDate.from(test.tradeDate), test.index)
          : test.function === 'ValidateFloatingRateIndexName'
            ? call(test.index, test.contractualDefs)
            : call(test.index);
      if (test.error) expect(run, test.id).toThrow(test.error);
      else checkResult(run(), test);
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it(
  'uses the same versioned lookup and code-list enum in standalone Python',
  () => {
    const python = generatePythonModule(graph.documents);
    expect(python.diagnostics).toEqual([]);
    const results = runPython(
      froCases.map((test) => {
        const declaration = froDeclarations.find(({ name }) => name === test.function)!;
        const fn = python.bindings.get(declaration.namespace + '.' + declaration.name);
        return { expression: fn + '(data)', data: pythonInput(test) };
      }),
      python.code,
      { includeRuntime: false }
    );
    expect(results).toHaveLength(froCases.length);
    for (const [index, test] of froCases.entries()) {
      const result = results[index]!;
      if (test.error) expect(result, test.id).toEqual({ error: expect.stringContaining(test.error) });
      else {
        expect(result, test.id).toHaveProperty('value');
        checkResult('value' in result ? result.value : undefined, test);
      }
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it(
  'reports an unbound matrix provider through the original function closure',
  async () => {
    const project = await createCuratedFroProject(false);
    const linked = await buildEffectiveProject(project.installed, project.references);
    expect(linked.diagnostics).toEqual([]);
    const { outputs } = await generateSelected(
      [...linked.documents],
      {
        namespaces: [],
        declarations: [{ namespace: 'example.fro', name: 'DescribeTradeDate', kind: 'RosettaFunction' }]
      },
      { target: 'typescript', strict: true }
    );
    expect(outputs.flatMap((output) => output.diagnostics)).toContainEqual(
      expect.objectContaining({
        code: 'native-implementation-unavailable',
        message: expect.stringContaining('impl.cdm.fro.ReadFloatingRateIndexMatrix')
      })
    );
    const entry = outputs.find((output) => output.funcs.some((fn) => fn.name === 'DescribeTradeDate'))!;
    const compiled = compileGeneratedTypeScript(outputs, { entry: entry.relativePath });
    expect(() => compiled.DescribeTradeDate!(Temporal.PlainDate.from('2024-07-01'))).toThrow(
      'ReadFloatingRateIndexMatrix'
    );
  },
  GENERATED_MODULE_TEST_TIMEOUT
);
