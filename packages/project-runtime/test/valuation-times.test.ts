// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { generatePreviewSchemas, generatePythonModule, generateSelected } from '@rune-langium/codegen/export';
import { getEnumValueLiteral, isRosettaEnumeration, isRosettaModel } from '@rune-langium/core';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { runPython } from '../../codegen/test/projection/python-test-utils.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';
import {
  createCuratedValuationTimeProject,
  valuationTimeCases,
  valuationTimeDeclarations,
  zoneScheme,
  type ValuationTimeCase
} from '../../../test/helpers/cdm-valuation-times.js';
import { buildEffectiveProject } from '../src/effective-project.js';

const selection = { namespaces: [], declarations: [...valuationTimeDeclarations] };
let graph: Awaited<ReturnType<typeof buildEffectiveProject>>;

beforeAll(async () => {
  const project = await createCuratedValuationTimeProject();
  graph = await buildEffectiveProject(project.installed, project.references);
  expect(graph.diagnostics).toEqual([]);
  expect([...project.changes.keys()]).toEqual(
    expect.arrayContaining([
      'model/implementations/cdm/time-zone-from-business-center-time.rosetta',
      'model/implementations/cdm/resolve-time-zone-from-time-type.rosetta',
      'model/implementations/cdm/valuation-times.rosetta'
    ])
  );
}, GENERATED_MODULE_TEST_TIMEOUT);

function schemeValue(value: string, scheme?: string) {
  return { value, meta: scheme === undefined ? {} : { scheme } };
}

function input(test: ValuationTimeCase, parseTime: (text: string) => unknown = (text) => text) {
  const time =
    test.wallTime && test.center
      ? { hourMinuteTime: parseTime(test.wallTime), businessCenter: schemeValue(test.center, test.centerScheme) }
      : undefined;
  const identifier = test.identifier ?? 'SAMPLE';
  const scheme = test.identifierScheme ?? (identifier === 'SAMPLE' ? 'urn:fixture:london' : undefined);
  const assetIdentifier = {
    identifier: schemeValue(identifier, scheme),
    identifierType: test.identifierType ?? 'Name'
  };
  const determinationMethod = test.determinationMethod ?? 'ClosingPrice';
  switch (test.function) {
    case 'TimeZoneFromBusinessCenterTime':
      return { time };
    case 'ResolveTimeZoneFromTimeType':
      return { assetIdentifier, timeType: test.timeType ?? 'Close', determinationMethod };
    case 'ResolvePerformanceValuationTime':
      return { valuationTime: time, valuationTimeType: test.timeType, assetIdentifier, determinationMethod };
    case 'PublishedBusinessCenterTime':
      return { center: test.center };
  }
}

function expected(test: ValuationTimeCase, python = false) {
  return {
    time: test.expectedTime,
    ...(test.expectedLocation === undefined
      ? python
        ? { location: null }
        : {}
      : { location: schemeValue(test.expectedLocation, zoneScheme) })
  };
}

it('links the published business-center Rune enum and projects its original code', () => {
  const model = graph.documents.find(({ uri }) => uri.path.endsWith('/derived/code-lists/BusinessCenter.rosetta'))
    ?.parseResult.value;
  const enumeration = isRosettaModel(model) ? model.elements.find(isRosettaEnumeration) : undefined;
  expect(enumeration?.name).toBe('BusinessCenter');
  const london = enumeration?.enumValues.find((value) => getEnumValueLiteral(value) === 'GBLO');
  expect(london?.definition).toBe('London, United Kingdom');
  const [preview] = generatePreviewSchemas([...graph.documents], {
    targetId: 'example.valuation.PublishedBusinessCenterTime'
  });
  expect(preview?.fields[0]).toMatchObject({
    kind: 'enum',
    enumValues: expect.arrayContaining([{ value: 'GBLO', label: 'GBLO' }])
  });
});

it.each(['per-namespace', 'barrel', 'single-file'] as const)(
  'resolves both time paths in strict %s TypeScript',
  async (layout) => {
    const { outputs } = await generateSelected([...graph.documents], selection, {
      target: 'typescript',
      strict: true,
      typescript: { layout }
    });
    expect(outputs.flatMap((output) => output.diagnostics)).toEqual([]);
    const compiled = new Map<string, ReturnType<typeof compileGeneratedTypeScript>>();
    for (const test of valuationTimeCases) {
      const entry = outputs.find((output) => output.funcs.some((fn) => fn.name === test.function))!;
      const fn = entry.funcs.find((fn) => fn.name === test.function)!;
      let loaded = compiled.get(entry.relativePath);
      if (!loaded) {
        loaded = compileGeneratedTypeScript(outputs, { entry: entry.relativePath, checkTypes: compiled.size === 0 });
        compiled.set(entry.relativePath, loaded);
      }
      const args = Object.values(input(test, (text) => Temporal.PlainTime.from(text)));
      const run = () => loaded[fn.exportName ?? fn.name]!(...args);
      if (test.error) expect(run, test.id).toThrow(test.error);
      else {
        const result = run();
        expect(result, test.id).toBeDefined();
        expect(JSON.parse(JSON.stringify(result)), test.id).toEqual(expected(test));
      }
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it(
  'keeps the original CDM caller and time data in standalone Python',
  () => {
    const python = generatePythonModule(graph.documents);
    expect(python.diagnostics).toEqual([]);
    const results = runPython(
      valuationTimeCases.map((test) => {
        const declaration = valuationTimeDeclarations.find(({ name }) => name === test.function)!;
        const fn = python.bindings.get(declaration.namespace + '.' + declaration.name);
        return { expression: fn + '(data)', data: input(test) };
      }),
      python.code,
      { includeRuntime: false }
    );
    expect(results).toHaveLength(valuationTimeCases.length);
    for (const [index, test] of valuationTimeCases.entries()) {
      expect(results[index], test.id).toEqual(
        test.error ? { error: expect.stringContaining(test.error) } : { value: expected(test, true) }
      );
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it(
  'reports the unbound data provider through each execution target',
  async () => {
    const project = await createCuratedValuationTimeProject(false);
    const linked = await buildEffectiveProject(project.installed, project.references);
    expect(linked.diagnostics).toEqual([]);
    const { outputs } = await generateSelected(
      [...linked.documents],
      { namespaces: [], declarations: [valuationTimeDeclarations[0]] },
      { target: 'typescript', strict: true }
    );
    expect(outputs.flatMap((output) => output.diagnostics)).toContainEqual(
      expect.objectContaining({
        code: 'native-implementation-unavailable',
        message: expect.stringContaining('impl.cdm.time.ReadBusinessCenterZones')
      })
    );
    const entry = outputs.find((output) => output.funcs.some((fn) => fn.name === 'TimeZoneFromBusinessCenterTime'))!;
    const compiled = compileGeneratedTypeScript(outputs, { entry: entry.relativePath });
    const args = input(valuationTimeCases[0]!, (text) => Temporal.PlainTime.from(text));
    expect(() => compiled.TimeZoneFromBusinessCenterTime!(...Object.values(args))).toThrow('ReadBusinessCenterZones');

    const python = generatePythonModule(linked.documents);
    expect(python.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'native-implementation-unavailable',
        message: expect.stringContaining('impl.cdm.time.ReadAssetValuationTimes')
      })
    );
    const resolveTime = python.bindings.get('cdm.observable.common.ResolveTimeZoneFromTimeType')!;
    const asset = valuationTimeCases.find(({ id }) => id === 'official-close')!;
    expect(
      runPython([{ expression: resolveTime + '(data)', data: input(asset) }], python.code, { includeRuntime: false })
    ).toEqual([{ error: expect.stringContaining('ReadAssetValuationTimes') }]);
  },
  GENERATED_MODULE_TEST_TIMEOUT
);
