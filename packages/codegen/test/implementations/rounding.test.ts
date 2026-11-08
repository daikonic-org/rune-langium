// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { URI } from 'langium';
import { assertValidDocuments, createRuneDslServices, isRosettaFunction, isRosettaModel } from '@rune-langium/core';
import { generateSelected, generatePreviewSchemas } from '../../src/export.js';
import { generatePythonModule } from '../../src/projection/python-functions.js';
import { resolveNativeImplementation } from '../../src/implementations/index.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { runPython } from '../projection/python-test-utils.js';
import {
  roundingCases,
  roundingFiles,
  roundingIdentity,
  additionalRoundingCases,
  additionalRoundingArguments,
  additionalRoundingCallers
} from '../../../../test/helpers/cdm-rounding.js';
import { installPublishedNativeImplementations } from '../../../../test/helpers/curated-implementations.js';

async function roundingDocuments(install = true) {
  const { RuneDsl } = createRuneDslServices();
  const docs = roundingFiles().map(({ uri, content }) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse(uri))
  );
  for (const doc of docs) RuneDsl.shared.workspace.LangiumDocuments.addDocument(doc);
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs, { eagerLinking: true });
  assertValidDocuments(docs);
  if (install) installPublishedNativeImplementations(docs);
  return docs;
}

let docs: Awaited<ReturnType<typeof roundingDocuments>>;
beforeAll(async () => {
  docs = await roundingDocuments();
});

it.each(['single-file', 'per-namespace', 'barrel'] as const)(
  'preserves decimal ties, significant figures and exact increment division in strict %s TypeScript',
  async (layout) => {
    const { outputs } = await generateSelected(
      docs,
      { namespaces: ['example.rounding'], declarations: [] },
      { target: 'typescript', strict: true, typescript: { layout } }
    );
    expect(outputs.flatMap((file) => file.diagnostics)).toEqual([]);
    const output = outputs.find((file) => file.funcs.some((fn) => fn.name === 'RoundQuote'))!;
    const fn = output.funcs.find((fn) => fn.name === 'RoundQuote')!;
    const module = compileGeneratedTypeScript(outputs, { entry: output.relativePath });
    const round = module[fn.exportName!]!;
    for (const test of roundingCases) {
      const { value, precision, roundingMode, removeTrailingZeros } = test.inputs;
      expect(round(value, precision, roundingMode, removeTrailingZeros), test.id).toBe(test.expected);
    }
    const callers = Object.fromEntries(
      Object.entries(additionalRoundingCallers).map(([name, caller]) => [
        name,
        module[output.funcs.find((fn) => fn.name === caller)!.exportName!]!
      ])
    );
    for (const test of additionalRoundingCases) {
      const execute = () => callers[test.function]!(...additionalRoundingArguments(test));
      if (test.error) expect(execute, test.id).toThrow(/Non-terminating decimal/);
      else expect(execute(), test.id).toBe(test.expected);
    }
    const nearest = callers.RoundToNearest!;
    const figures = callers.RoundToSignificantFigures!;
    expect(() => nearest(1, 0, 'Up')).toThrow(/PositiveNearest/);
    expect(() => nearest(1, -1, 'Down')).toThrow(/PositiveNearest/);
    expect(() => figures(1, 0, 'Nearest')).toThrow(/NonZeroSignificantFigures/);
    for (const value of [NaN, Infinity, -Infinity, true, '1.25']) {
      expect(() => nearest(value, 0.5, 'Up')).toThrow();
      expect(() => figures(value, 2, 'Nearest')).toThrow();
    }
    for (const count of [1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => figures(1.25, count, 'Nearest')).toThrow();
    expect(() => nearest(1, 0.5, 'Nearest')).toThrow();
    expect(() => figures(1, 2, 'Other')).toThrow();
    expect(() => figures(Number.MAX_VALUE, 1, 'Up')).toThrow(/finite/);
    expect(() => nearest(Number.MAX_VALUE, 1e308, 'Up')).toThrow(/finite/);
    expect(figures(1.005, Number.MAX_SAFE_INTEGER, 'Nearest')).toBe(1.005);
    expect(Object.is(figures(-0, 2, 'Nearest'), -0)).toBe(false);
    for (const precision of [1_000_000, Number.MAX_SAFE_INTEGER])
      expect(round(1.005, precision, 'Nearest', false)).toBe(1.005);
    for (const args of [
      [1, -1, 'Nearest', false],
      [1, 1.5, 'Nearest', false],
      [1, Infinity, 'Nearest', false],
      [1, Number.MAX_SAFE_INTEGER + 1, 'Nearest', false],
      [NaN, 2, 'Nearest', false],
      [Infinity, 2, 'Nearest', false],
      [-Infinity, 2, 'Nearest', false],
      [true, 2, 'Nearest', false],
      ['1.005', 2, 'Nearest', false],
      [1, 2, 'Other', false],
      [1, 2, 'Nearest', 'false']
    ])
      expect(() => round(...args), JSON.stringify(args)).toThrow();
    expect(() => round(1, -1, 'Nearest', false)).toThrow(/NonNegativePrecision/);
    expect(Object.is(round(-0, 2, 'Nearest', false), -0)).toBe(false);
  }
);

it('executes the same corpus in Python without changing the global decimal context', () => {
  const python = generatePythonModule(docs);
  expect(python.diagnostics).toEqual([]);
  const fn = python.bindings.get(roundingIdentity)!;
  const prefix = `\nimport decimal\ndecimal.getcontext().prec = 3\ndecimal.getcontext().rounding = decimal.ROUND_FLOOR\n`;
  expect(
    runPython(
      roundingCases.map((test) => ({ expression: `${fn}(data)`, data: test.inputs })),
      python.code + prefix,
      { includeRuntime: false }
    )
  ).toEqual(roundingCases.map((test) => ({ value: test.expected })));
  expect(
    runPython(
      additionalRoundingCases.map((test) => ({
        expression: `${python.bindings.get('cdm.base.math.' + test.function)!}(data)`,
        data: test.inputs
      })),
      python.code + prefix,
      { includeRuntime: false }
    )
  ).toEqual(
    additionalRoundingCases.map((test) =>
      test.error ? { error: expect.stringContaining('Non-terminating decimal') } : { value: test.expected }
    )
  );
  const inputs = { value: 1.005, precision: -1, roundingMode: 'Nearest', removeTrailingZeros: false };
  const checks = runPython(
    [
      { expression: `${fn}(data)`, data: inputs },
      { expression: `${fn}(data)`, data: { ...inputs, precision: 1.5 } },
      { expression: `${fn}(data)`, data: { ...inputs, precision: 1000000 } },
      { expression: `${fn}(data)`, data: { ...inputs, precision: Number.MAX_SAFE_INTEGER } },
      { expression: `${fn}(data)`, data: { ...inputs, precision: 2, roundingMode: 'Other' } },
      { expression: `${fn}(data)`, data: { ...inputs, precision: 2, removeTrailingZeros: 'false' } },
      ...["float('nan')", "float('inf')", "-float('inf')", 'True', "'1.005'"].map((value) => ({
        expression: `${fn}({'value': ${value}, 'precision': 2, 'roundingMode': 'Nearest', 'removeTrailingZeros': False})`
      })),
      {
        expression: `__import__('math').copysign(1, ${fn}({'value': -0.0, 'precision': 2, 'roundingMode': 'Nearest', 'removeTrailingZeros': False}))`
      },
      { expression: `decimal.getcontext().prec` },
      { expression: `decimal.getcontext().rounding == decimal.ROUND_FLOOR` }
    ],
    python.code + prefix,
    { includeRuntime: false }
  );
  expect(checks).toEqual([
    { error: expect.stringContaining('NonNegativePrecision') },
    { error: expect.stringContaining('Rounding requires') },
    { value: 1.005 },
    { value: 1.005 },
    { error: expect.any(String) },
    { error: expect.stringContaining('Rounding requires') },
    ...Array.from({ length: 5 }, () => ({ error: expect.stringContaining('Rounding requires') })),
    { value: 1 },
    { value: 3 },
    { value: true }
  ]);
});

it('isolates Python rounding from mutable default traps, flags and exponent limits', () => {
  const python = generatePythonModule(docs);
  expect(python.diagnostics).toEqual([]);
  const fn = python.bindings.get(roundingIdentity)!;
  const hostileDefaults = `
import decimal
decimal.DefaultContext.prec = 1
decimal.DefaultContext.rounding = decimal.ROUND_FLOOR
decimal.DefaultContext.Emin = -1
decimal.DefaultContext.Emax = 1
decimal.DefaultContext.capitals = 0
decimal.DefaultContext.clamp = 1
for signal in decimal.DefaultContext.traps:
    decimal.DefaultContext.traps[signal] = True
    decimal.DefaultContext.flags[signal] = True
decimal.setcontext(decimal.DefaultContext.copy())
_rounding_default_before = repr(decimal.DefaultContext)
_rounding_active_before = repr(decimal.getcontext())
`;
  expect(
    runPython(
      [
        ...roundingCases.map((test) => ({ expression: `${fn}(data)`, data: test.inputs })),
        ...additionalRoundingCases.map((test) => ({
          expression: `${python.bindings.get('cdm.base.math.' + test.function)!}(data)`,
          data: test.inputs
        })),
        { expression: `repr(decimal.DefaultContext) == _rounding_default_before` },
        { expression: `repr(decimal.getcontext()) == _rounding_active_before` }
      ],
      python.code + hostileDefaults,
      { includeRuntime: false }
    )
  ).toEqual([
    ...roundingCases.map((test) => ({ value: test.expected })),
    ...additionalRoundingCases.map((test) =>
      test.error ? { error: expect.stringContaining('Non-terminating decimal') } : { value: test.expected }
    ),
    { value: true },
    { value: true }
  ]);
});

it('requires the published payload and refuses signature drift in either target', async () => {
  const bare = await roundingDocuments(false);
  const functions = docs.flatMap((doc) =>
    isRosettaModel(doc.parseResult.value) ? doc.parseResult.value.elements.filter(isRosettaFunction) : []
  );
  const previews = generatePreviewSchemas(bare);
  for (const [name, id] of [
    ['RoundToPrecision', 'cdm.round-to-precision'],
    ['RoundToNearest', 'cdm.round-to-nearest'],
    ['RoundToSignificantFigures', 'cdm.round-to-significant-figures']
  ]) {
    expect(previews.find((schema) => schema.targetId === `cdm.base.math.${name}`)?.executionUnavailable).toBeTruthy();
    const fn = functions.find((fn) => fn.name === name)!;
    for (const target of ['typescript', 'python']) {
      expect(resolveNativeImplementation(fn, target)).toMatchObject({ status: 'available', id });
      expect(resolveNativeImplementation({ ...fn, inputs: fn.inputs.slice(0, -1) }, target)).toMatchObject({
        status: 'unsupported'
      });
    }
  }
});

it('retains Python Rune guards, safe-count admission and finite result limits for both new functions', () => {
  const python = generatePythonModule(docs);
  const nearest = python.bindings.get('cdm.base.math.RoundToNearest')!;
  const figures = python.bindings.get('cdm.base.math.RoundToSignificantFigures')!;
  expect(
    runPython(
      [
        { expression: `${nearest}(data)`, data: { value: 1, nearest: 0, roundingMode: 'Up' } },
        { expression: `${nearest}(data)`, data: { value: 1, nearest: -1, roundingMode: 'Down' } },
        { expression: `${figures}(data)`, data: { value: 1, significantFigures: 0, roundingMode: 'Nearest' } },
        ...[1.5, Number.MAX_SAFE_INTEGER + 1].map((significantFigures) => ({
          expression: `${figures}(data)`,
          data: { value: 1.25, significantFigures, roundingMode: 'Nearest' }
        })),
        {
          expression: `${figures}(data)`,
          data: { value: 1.005, significantFigures: Number.MAX_SAFE_INTEGER, roundingMode: 'Nearest' }
        },
        { expression: `${nearest}({'value': float('nan'), 'nearest': 0.5, 'roundingMode': 'Up'})` },
        { expression: `${nearest}({'value': 1, 'nearest': float('inf'), 'roundingMode': 'Up'})` },
        { expression: `${figures}({'value': True, 'significantFigures': 2, 'roundingMode': 'Nearest'})` },
        { expression: `${figures}({'value': 1, 'significantFigures': float('inf'), 'roundingMode': 'Nearest'})` },
        { expression: `${nearest}(data)`, data: { value: 1, nearest: 0.5, roundingMode: 'Nearest' } },
        { expression: `${figures}(data)`, data: { value: 1, significantFigures: 2, roundingMode: 'Other' } },
        {
          expression: `${figures}(data)`,
          data: { value: Number.MAX_VALUE, significantFigures: 1, roundingMode: 'Up' }
        },
        { expression: `${nearest}(data)`, data: { value: Number.MAX_VALUE, nearest: 1e308, roundingMode: 'Up' } },
        {
          expression: `__import__('math').copysign(1, ${figures}({'value': -0.0, 'significantFigures': 2, 'roundingMode': 'Nearest'}))`
        }
      ],
      python.code,
      { includeRuntime: false }
    )
  ).toEqual([
    { error: expect.stringContaining('PositiveNearest') },
    { error: expect.stringContaining('PositiveNearest') },
    { error: expect.stringContaining('NonZeroSignificantFigures') },
    ...Array.from({ length: 2 }, () => ({ error: expect.stringContaining('Rounding requires') })),
    { value: 1.005 },
    ...Array.from({ length: 6 }, () => ({ error: expect.stringContaining('Rounding requires') })),
    { error: expect.stringContaining('finite') },
    { error: expect.stringContaining('float') },
    { value: 1 }
  ]);
});
