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
import { roundingCases, roundingFiles, roundingIdentity } from '../../../../test/helpers/cdm-rounding.js';
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
  'preserves decimal ties and signed directions in strict %s TypeScript',
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
        { expression: `repr(decimal.DefaultContext) == _rounding_default_before` },
        { expression: `repr(decimal.getcontext()) == _rounding_active_before` }
      ],
      python.code + hostileDefaults,
      { includeRuntime: false }
    )
  ).toEqual([...roundingCases.map((test) => ({ value: test.expected })), { value: true }, { value: true }]);
});

it('requires the published payload and refuses signature drift in either target', async () => {
  const bare = await roundingDocuments(false);
  expect(
    generatePreviewSchemas(bare).find((schema) => schema.targetId === roundingIdentity)?.executionUnavailable
  ).toBeTruthy();
  const fn = docs
    .flatMap((doc) =>
      isRosettaModel(doc.parseResult.value) ? doc.parseResult.value.elements.filter(isRosettaFunction) : []
    )
    .find((fn) => fn.name === 'RoundToPrecision')!;
  for (const target of ['typescript', 'python']) {
    expect(resolveNativeImplementation(fn, target)).toMatchObject({
      status: 'available',
      id: 'cdm.round-to-precision'
    });
    expect(resolveNativeImplementation({ ...fn, inputs: fn.inputs.slice(0, -1) }, target)).toMatchObject({
      status: 'unsupported'
    });
  }
});
