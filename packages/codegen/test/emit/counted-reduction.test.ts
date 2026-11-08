// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { URI, type LangiumDocument } from 'langium';
import { createRuneDslServices, assertValidDocuments, isRosettaFunction, isRosettaModel } from '@rune-langium/core';
import { generate } from '../../src/export.js';
import { generatePythonModule } from '../../src/projection/python-functions.js';
import { countedReductionPlans, countedLookupCalls } from '../../src/expr/counted-reduction.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { runPython } from '../projection/python-test-utils.js';

const pick = (name: string, barrier = '') => `func ${name}:
 inputs:
  sequence number (0..*)
  offset int (1..1)
 output: result Cursor (1..1)
 alias staged: [Cursor { tick: 0 }, sequence extract elementValue [Cursor { tick: 0, token: elementValue }]]
 ${barrier}
 alias folded: staged reduce prior, entry [Cursor {
  tick: prior -> tick + 1,
  saved: if prior -> tick = offset then entry -> token else prior -> saved
 }]
 set result: folded
`;
const gather = (name: string, barrier = '', append = 'entry -> token') => `func ${name}:
 inputs: sequence number (0..*)
 output: result Bucket (1..1)
 alias staged: [Bucket { tick: 0 }, sequence extract elementValue [Bucket { tick: 0, token: elementValue }]]
 ${barrier}
 alias folded: staged reduce prior, entry [Bucket {
  tick: prior -> tick + 1,
  outputValues: [prior -> outputValues, ${append}]
 }]
 set result: folded
`;
const source = `namespace unrelated.counted
type Cursor:
 tick int (1..1)
 token number (0..1)
 saved number (0..1)
type Bucket:
 tick int (1..1)
 token number (0..1)
 outputValues number (0..*)
func Size:
 inputs: bucket Bucket (1..1)
 output: result int (1..1)
 set result: bucket -> outputValues count
${pick('Pick')}
${pick('SlowPick', 'alias barrier: 0')}
${gather('Gather')}
${gather('SlowGather', 'alias barrier: 0')}
${gather('Escaping', '', 'Size(prior)')}
${gather('SlowEscaping', 'alias barrier: 0', 'Size(prior)')}
${pick('Colliding').replaceAll('sequence', '__indexedValues').replaceAll('offset', '__indexedPosition')}
${pick('NonzeroSeed').replaceAll('tick: 0', 'tick: 1')}
${pick('PickValue').replace('result Cursor (1..1)', 'result number (0..1)').replace('set result: folded', 'set result: folded -> saved')}
${pick('PickChecked').replace('result Cursor (1..1)', 'result number (0..1)').replace('set result: folded', 'condition IndexAllowed: offset < 2\n set result: folded -> saved')}
${gather('Zipped', '', 'PickValue(other, prior -> tick)').replace('inputs: sequence number (0..*)', 'inputs:\n  sequence number (0..*)\n  other number (0..*)')}
${gather('SlowZipped', 'alias barrier: 0', 'PickValue(other, prior -> tick)').replace('inputs: sequence number (0..*)', 'inputs:\n  sequence number (0..*)\n  other number (0..*)')}
${gather('ZippedChecked', '', 'PickChecked(other, prior -> tick)').replace('inputs: sequence number (0..*)', 'inputs:\n  sequence number (0..*)\n  other number (0..*)')}
`;
let docs: LangiumDocument[];
let module: Record<string, (...args: unknown[]) => unknown>;
let content: string;
beforeAll(async () => {
  const { RuneDsl } = createRuneDslServices();
  await RuneDsl.shared.workspace.WorkspaceManager.initializeWorkspace([]);
  const document = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    source,
    URI.parse('file:///counted.rosetta')
  );
  RuneDsl.shared.workspace.LangiumDocuments.addDocument(document);
  await RuneDsl.shared.workspace.DocumentBuilder.build([document], { eagerLinking: true });
  assertValidDocuments([document]);
  docs = [document];
  const outputs = await generate(docs, { target: 'typescript', typescript: { layout: 'single-file' } });
  expect(
    outputs.flatMap((output) => output.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'))
  ).toEqual([]);
  content = outputs[0]!.content;
  module = compileGeneratedTypeScript(outputs);
});
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

it('matches the original lowering for empty, singleton, duplicate and absent entries without mutating input', () => {
  const sparse: number[] = [];
  sparse.length = 4;
  sparse[1] = 3;
  sparse[3] = 6;
  for (const values of [undefined, [], [0], [3, 7, 3], [1, null, undefined, 3], sparse]) {
    const original = JSON.stringify(values);
    for (const index of [-1, 0, 1, 2, 3, 5, 0.5, Number.NaN, Infinity]) {
      expect(json(module.Pick!(values, index))).toEqual(json(module.SlowPick!(values, index)));
      expect(json(module.Colliding!(values, index))).toEqual(json(module.SlowPick!(values, index)));
    }
    expect(json(module.Gather!(values))).toEqual(json(module.SlowGather!(values)));
    expect(JSON.stringify(values)).toBe(original);
  }
  expect(json(module.Pick!([3, 7, 3], 1))).toEqual({ tick: 3, saved: 7 });
  expect(json(module.Gather!([3, 7, 3]))).toEqual({ tick: 3, outputValues: [3, 7, 3] });
  expect(json(module.Gather!([]))).toEqual({ tick: 0 });
});

it('keeps the original evaluation when the accumulator escapes, a seed differs or another alias intervenes', () => {
  const model = docs[0]!.parseResult.value;
  if (!isRosettaModel(model)) throw new Error('Expected model');
  const plans = new Map(model.elements.filter(isRosettaFunction).map((fn) => [fn.name, countedReductionPlans(fn)]));
  for (const name of ['SlowPick', 'SlowGather', 'Escaping', 'NonzeroSeed'])
    expect(plans.get(name)?.reductions.size).toBe(0);
  for (const name of ['Pick', 'Gather', 'Colliding']) expect(plans.get(name)?.reductions.size).toBe(1);
  expect(json(module.Escaping!([1, 1, 2]))).toEqual(json(module.SlowEscaping!([1, 1, 2])));
  expect(json(module.Escaping!([1, 1, 2]))).toEqual({ tick: 3, outputValues: [0, 1, 2] });
  expect(content).not.toContain('as unknown');
});

it('uses the same proof in executable Python while preserving its existing admission behavior', () => {
  const python = generatePythonModule(docs);
  expect(python.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  const examples = [[], [0], [3, 7, 3], [1, null, 3]].flatMap((sequence) =>
    [0, 1, 3].map((offset) => ({ sequence, offset }))
  );
  const calls = ['Pick', 'SlowPick', 'Gather', 'SlowGather'].flatMap((name) => {
    const binding = python.bindings.get(`unrelated.counted.${name}`)!;
    return examples.map((data) => ({ expression: `${binding}(data)`, data }));
  });
  const results = runPython(calls, python.code, { includeRuntime: false });
  expect(results.slice(0, examples.length)).toEqual(results.slice(examples.length, 2 * examples.length));
  expect(results.slice(2 * examples.length, 3 * examples.length)).toEqual(results.slice(3 * examples.length));
});

it('prepares captured lookup input once only when the complete call chain is pure and unbound', () => {
  for (const other of [[], [2], [2, 5, 2], [2, null, 4], [2, 5, 2, 9]]) {
    const snapshot = JSON.stringify(other);
    expect(json(module.Zipped!([7, 7, 8], other))).toEqual(json(module.SlowZipped!([7, 7, 8], other)));
    expect(JSON.stringify(other)).toBe(snapshot);
  }
  const start = content.indexOf('export function Zipped(');
  const body = content.slice(start, content.indexOf('\n}', start));
  expect(body).toContain('__indexedLookup');
  expect(body).not.toContain('PickValue(');
  expect(() => module.ZippedChecked!([7, 7, 8], [1, 2, 3])).toThrow('IndexAllowed');
  const model = docs[0]!.parseResult.value;
  if (!isRosettaModel(model)) throw new Error('Expected model');
  const zipped = model.elements.find((node) => isRosettaFunction(node) && node.name === 'Zipped');
  if (!isRosettaFunction(zipped)) throw new Error('Expected function');
  const plan = [...countedReductionPlans(zipped).reductions.values()][0]!;
  expect(countedLookupCalls(plan, () => false)).toEqual([]);
});
