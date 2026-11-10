// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { URI } from 'langium';
import { assertValidDocuments, createRuneDslServices, isRosettaModel, isRosettaFunction } from '@rune-langium/core';
import {
  generateSelected,
  generatePreviewSchemas,
  generatePythonModule,
  resolveNativeImplementation
} from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { runPython } from '../projection/python-test-utils.js';
import { vectorCases, vectorFiles, vectorCallers, vectorArguments } from '../../../../test/helpers/cdm-vectors.js';
import { installPublishedNativeImplementations } from '../../../../test/helpers/curated-implementations.js';

async function vectorDocuments(install = true) {
  const { RuneDsl } = createRuneDslServices();
  const docs = vectorFiles().map(({ uri, content }) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse(uri))
  );
  for (const doc of docs) RuneDsl.shared.workspace.LangiumDocuments.addDocument(doc);
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs, { eagerLinking: true });
  assertValidDocuments(docs);
  if (install) await installPublishedNativeImplementations(docs);
  return docs;
}
let docs: Awaited<ReturnType<typeof vectorDocuments>>;
beforeAll(async () => {
  docs = await vectorDocuments();
});

it.each(['single-file', 'per-namespace', 'barrel'] as const)(
  'executes exact vector math and cumulative growth in strict %s TypeScript',
  async (layout) => {
    const { outputs } = await generateSelected(
      docs,
      { namespaces: ['example.vectors'], declarations: [] },
      { target: 'typescript', strict: true, typescript: { layout } }
    );
    expect(outputs.flatMap((file) => file.diagnostics)).toEqual([]);
    const output = outputs.find((file) => file.funcs.some((fn) => fn.name === 'OperateVectors'))!;
    const module = compileGeneratedTypeScript(outputs, { entry: output.relativePath });
    const functions = Object.fromEntries(
      Object.entries(vectorCallers).map(([name, caller]) => [
        name,
        module[output.funcs.find((fn) => fn.name === caller)!.exportName!]!
      ])
    );
    for (const test of vectorCases) {
      const before = structuredClone(test.inputs);
      expect(functions[test.function]!(...vectorArguments(test)), test.id).toEqual(test.expected);
      expect(test.inputs).toEqual(before);
    }
    const operation = functions.VectorOperation!,
      growth = functions.VectorGrowthOperation!;
    for (const value of [NaN, Infinity, -Infinity, true, '1']) {
      expect(() => operation('Add', [value], [1])).toThrow();
      expect(() => growth(value, [])).toThrow();
      expect(() => growth(1, [value])).toThrow();
    }
    expect(() => operation('Other', [], [])).toThrow();
    expect(() => operation('Multiply', [Number.MAX_VALUE], [2])).toThrow(/finite/);
    expect(() => growth(Number.MAX_VALUE, [2])).toThrow(/finite/);
  }
);

it('executes standalone Python vector math independently of hostile decimal state', () => {
  const python = generatePythonModule(docs);
  expect(python.diagnostics).toEqual([]);
  const hostile = `\nimport decimal\ndecimal.DefaultContext.prec = 1\ndecimal.DefaultContext.Emin = -1\ndecimal.DefaultContext.Emax = 1\nfor signal in decimal.DefaultContext.traps:\n    decimal.DefaultContext.traps[signal] = True\ndecimal.setcontext(decimal.DefaultContext.copy())\n_before = repr(decimal.getcontext())\n`;
  expect(
    runPython(
      [
        ...vectorCases.map((test) => ({
          expression: `${python.bindings.get('cdm.base.math.' + test.function)}(data)`,
          data: test.inputs
        })),
        { expression: 'repr(decimal.getcontext()) == _before' }
      ],
      python.code + hostile,
      { includeRuntime: false }
    )
  ).toEqual([...vectorCases.map((test) => ({ value: test.expected })), { value: true }]);
  const op = python.bindings.get('cdm.base.math.VectorOperation')!,
    growth = python.bindings.get('cdm.base.math.VectorGrowthOperation')!;
  const results = runPython(
    [
      ...["float('nan')", "float('inf')", "-float('inf')", 'True', "'1'"].flatMap((value) => [
        { expression: `${op}({'arithmeticOp':'Add','left':[${value}], 'right':[1]})` },
        { expression: `${growth}({'baseValue':${value},'factor':[]})` },
        { expression: `${growth}({'baseValue':1,'factor':[${value}]})` }
      ]),
      { expression: `${op}({'arithmeticOp':'Other','left':[], 'right':[]})` },
      { expression: `${op}({'arithmeticOp':'Multiply','left':[1.7976931348623157e308], 'right':[2]})` },
      { expression: `${growth}({'baseValue':1.7976931348623157e308,'factor':[2]})` }
    ],
    python.code,
    { includeRuntime: false }
  );
  for (const result of results) expect(result).toMatchObject({ error: expect.any(String) });
});

it('normalizes omitted and None collections in direct Python vector exports', () => {
  const python = generatePythonModule(docs);
  expect(python.diagnostics).toEqual([]);
  const operation = python.bindings.get('cdm.base.math.VectorOperation')!;
  const growth = python.bindings.get('cdm.base.math.VectorGrowthOperation')!;
  expect(
    runPython(
      [
        { expression: `${operation}('Add', None, [2])` },
        { expression: `${operation}('Add', right=[2])` },
        { expression: `${operation}('Add', [2], None)` },
        { expression: `${operation}('Add', [2])` },
        { expression: `${operation}('Add')` },
        { expression: `${operation}('Divide', [1], None)` },
        { expression: `${growth}(1)` },
        { expression: `${growth}(1, None)` },
        { expression: `${growth}(0, None)` },
        { expression: `${growth}(1, [])` }
      ],
      python.code,
      { includeRuntime: false }
    )
  ).toEqual([
    { value: [2] },
    { value: [2] },
    { value: [2] },
    { value: [2] },
    { value: [] },
    { value: [] },
    { value: [1] },
    { value: [1] },
    { value: [0] },
    { value: [1] }
  ]);
});

it('keeps bare vectors unavailable and refuses native payload signature drift', async () => {
  const bare = await vectorDocuments(false);
  const previews = generatePreviewSchemas(bare);
  const functions = docs.flatMap((doc) =>
    isRosettaModel(doc.parseResult.value) ? doc.parseResult.value.elements.filter(isRosettaFunction) : []
  );
  for (const [name, id] of [
    ['VectorOperation', 'cdm.vector-operation'],
    ['VectorGrowthOperation', 'cdm.vector-growth-operation']
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
