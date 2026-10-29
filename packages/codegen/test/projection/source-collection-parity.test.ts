// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { AstUtils } from 'langium';
import { isThenOperation, type ClosureParameter } from '@rune-langium/core';
import { generate } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { sourceProjectionBoundaries, sourceProjectionCollections } from '../helpers/source-projection-collections.js';
import { generatePythonModule } from '../../src/projection/python-functions.js';
import { linkedFunctions, runPython } from './python-test-utils.js';

it('keeps scalar extraction and collection groups consistent in Python exports', async () => {
  const functions = await linkedFunctions(sourceProjectionCollections);
  const python = generatePythonModule([AstUtils.getDocument(functions[0]!)]);
  const result = runPython(
    [
      { expression: 'GroupCount([{"values": [1, 2]}, {"values": [3]}])' },
      { expression: 'Flat([{"values": [1, 2]}, {"values": [3]}])' },
      { expression: 'Mix([{"values": [1, 2]}, {"values": [3]}], 4)' },
      { expression: 'CheckedGroups([{"values": [1, 2]}, {"values": [3]}])' },
      { expression: 'MixedGroups([{"values": [1, 2]}, {"values": [3]}], True)' },
      { expression: 'MixedGroups([], False)' },
      { expression: 'SwitchGroups([{"values": [1, 2]}, {"values": [3]}], 1)' },
      { expression: 'SwitchGroups([], 0)' },
      { expression: 'SwitchValues([{"values": [1, 2]}, {"values": [3]}], 1)' },
      { expression: 'SwitchValues([], 0)' },
      { expression: 'SwitchValues([], 2)' },
      { expression: 'PipeGroups([{"values": [1, 2]}, {"values": [3]}])' },
      { expression: 'PipeValues([{"values": [1, 2]}, {"values": [3]}])' },
      { expression: 'NestedPipeValues([{"values": [1, 2]}, {"values": [3]}])' },
      { expression: 'BarePipeValues([{"values": [1, 2]}, {"values": [3]}])' },
      ...['MixedValues', 'MixedArguments', 'MixedPipeValues'].flatMap((name) => [
        { expression: `${name}([{"values": [1, 2]}, {"values": [3]}], True, None)` },
        { expression: `${name}([], False, 1)` },
        { expression: `${name}([], False, 0)` },
        { expression: `${name}([], False, None)` }
      ]),
      { expression: 'GroupCount([{}, {"values": []}])' },
      { expression: 'EmptyCount([{"values": [1]}])' },
      { expression: 'ScalarEmpty(7)' },
      { expression: 'Scalar(None)' },
      { expression: 'Scalar(7)' },
      { expression: 'ScalarFilter(7)' },
      { expression: 'ScalarFilter(-1)' }
    ],
    python.code,
    { includeRuntime: false }
  );
  expect(result).toEqual([
    { value: 2 },
    { value: [1, 2, 3] },
    { value: [1, 2, 3, 4] },
    { value: 6 },
    { value: 6 },
    { error: 'values has too few values' },
    { value: 6 },
    { value: 15 },
    { value: [1, 2, 3] },
    { value: [4, 5, 6] },
    { value: [] },
    { value: 6 },
    { value: [1, 2, 3] },
    { value: [1, 2, 3] },
    { value: [1, 2, 3] },
    ...['MixedValues', 'MixedArguments', 'MixedPipeValues'].flatMap(() => [
      { value: [1, 2, 3] },
      { value: [1] },
      { value: [0] },
      { value: [] }
    ]),
    { value: 2 },
    { value: 0 },
    { value: null },
    { value: null },
    { value: 1 },
    { value: 7 },
    { value: null }
  ]);
});

it('preserves explicit pipeline parameter depth in both executable exports', async () => {
  const functions = await linkedFunctions(sourceProjectionCollections);
  const pipeline = functions.find((func) => func.name === 'MixedPipeValues')!.operations[0]!.expression;
  if (!isThenOperation(pipeline) || !pipeline.function) throw new Error('Expected pipeline');
  const fn = pipeline.function;
  const parameter: ClosureParameter = { $type: 'ClosureParameter', $container: fn, name: 'grouped' };
  fn.parameters.push(parameter);
  fn.body = {
    $type: 'RosettaSymbolReference',
    $container: fn,
    explicitArguments: false,
    rawArgs: [],
    symbol: { $refText: parameter.name, ref: parameter }
  };
  AstUtils.linkContentToContainer(fn);
  const document = AstUtils.getDocument(pipeline);
  const integer = functions.find((func) => func.name === 'Three')!.inputs[0]!.typeCall!.type.ref!;
  const outputs = await generate([AstUtils.getDocument(integer), document], {
    target: 'typescript',
    typescript: { layout: 'single-file' }
  });
  const runtime = compileGeneratedTypeScript<{
    MixedPipeValues: (groups: unknown[], flag: boolean, amount?: number) => unknown;
  }>(outputs);
  expect(runtime.MixedPipeValues([{ values: [1, 2] }, { values: [3] }], true)).toEqual([1, 2, 3]);
  expect(runtime.MixedPipeValues([], false, 0)).toEqual([0]);
  expect(runtime.MixedPipeValues([], false)).toEqual([]);
  expect(
    runPython(
      [
        { expression: 'MixedPipeValues([{"values": [1, 2]}, {"values": [3]}], True, None)' },
        { expression: 'MixedPipeValues([], False, 0)' },
        { expression: 'MixedPipeValues([], False, None)' }
      ],
      generatePythonModule([document]).code,
      { includeRuntime: false }
    )
  ).toEqual([{ value: [1, 2, 3] }, { value: [0] }, { value: [] }]);
});

it('keeps scalar boundaries and extraction callback groups consistent in Python', async () => {
  const functions = await linkedFunctions(sourceProjectionBoundaries);
  const python = generatePythonModule([AstUtils.getDocument(functions[0]!)]);
  const cases = [
    ...['ScalarArgument', 'ScalarAssignment', 'OptionalAssignment'].map((name) => ({
      expression: `${name}([{"values": [1]}, {"values": []}])`
    })),
    { expression: 'OptionalAssignment([{"values": []}])' },
    ...['Identity', 'NamedIdentity', 'BareIdentity'].map((name) => ({
      expression: `${name}([{"values": [1, 2]}, {"values": [3]}])`
    })),
    { expression: 'IdentityCount([{"values": [1, 2]}, {"values": [3]}])' },
    { expression: 'Constant([{"values": [1, 2]}, {"values": [3]}])' },
    ...['First', 'Last', 'Min', 'Max', 'Reduced'].map((name) => ({
      expression: `${name}([{"values": [1, 2]}, {"values": [3]}])`
    })),
    { expression: 'Only([{"values": [1, 2]}])' },
    { expression: 'Only([{"values": []}, {"values": [1]}])' },
    { expression: 'FirstScalar([{"values": [1]}, {"values": [2]}])' },
    { expression: 'FirstScalar([{"values": []}, {"values": [2]}])' },
    { expression: 'FirstScalar([{"values": [1, 2]}])' },
    ...['First', 'Last', 'Only', 'Min', 'Max', 'Reduced'].map((name) => ({ expression: `${name}([])` }))
  ];
  expect(runPython(cases, python.code, { includeRuntime: false })).toEqual([
    { value: 1 },
    { value: 1 },
    { value: 1 },
    { value: null },
    { value: [1, 2, 3] },
    { value: [1, 2, 3] },
    { value: [1, 2, 3] },
    { value: 2 },
    { value: [1, 1] },
    { value: [1, 2] },
    { value: [3] },
    { value: [3] },
    { value: [1, 2] },
    { value: [1, 2] },
    { value: [1, 2] },
    { value: [] },
    { value: 1 },
    { value: null },
    { error: 'Expected at most one value' },
    ...Array.from({ length: 6 }, () => ({ value: [] }))
  ]);
});

it('retains scalar and collection shapes for bare pipeline extraction and filtering', async () => {
  const functions = await linkedFunctions(`namespace test.pipelineShapes
 type Group:
  values int (0..*)
 func ScalarObject:
  inputs: group Group (0..1)
  output: result Group (0..1)
  set result: group then extract Group { values: values }
 func ScalarList:
  inputs: group Group (0..1)
  output: result int (0..*)
  set result: group then extract values
 func ManyList:
  inputs: groups Group (0..*)
  output: result int (0..*)
  set result: groups then extract values
 func FirstScalar:
  inputs: groups Group (0..*)
  output: result int (0..1)
  set result: groups first then extract values first
 func ScalarSwitch:
  inputs: group Group (0..1) selector int (1..1)
  output: result int (0..*)
  alias selected: selector switch 1 then group, default empty
  add result: selected extract values first
 func ScalarConditional:
  inputs: group Group (0..1) flag boolean (1..1)
  output: result int (0..*)
  alias selected: if flag then group else empty
  add result: selected extract values first
 func ScalarFilter:
  inputs: amount int (0..1)
  output: result int (0..1)
  set result: amount then filter [item > 0]
`);
  const document = AstUtils.getDocument(functions[0]!);
  const integer = functions.find((func) => func.name === 'ScalarFilter')!.inputs[0]!.typeCall!.type.ref!;
  const outputs = await generate([AstUtils.getDocument(integer), document], {
    target: 'typescript',
    typescript: { layout: 'single-file' }
  });
  const api = compileGeneratedTypeScript<Record<string, (...inputs: unknown[]) => unknown>>(outputs);
  expect(api.ScalarObject!({ values: [1, 2] })).toEqual({ values: [1, 2] });
  expect(api.ScalarObject!()).toBeUndefined();
  expect(api.ScalarList!({ values: [1, 2] })).toEqual([1, 2]);
  expect(api.ScalarList!()).toEqual([]);
  expect(api.ManyList!([{ values: [1, 2] }, { values: [3] }])).toEqual([1, 2, 3]);
  expect(api.FirstScalar!([{ values: [1, 2] }, { values: [3] }])).toBe(1);
  expect(api.FirstScalar!([])).toBeUndefined();
  expect(api.ScalarFilter!(7)).toBe(7);
  expect(api.ScalarFilter!(-1)).toBeUndefined();
  expect(api.ScalarSwitch!({ values: [1, 2] }, 1)).toEqual([1]);
  expect(api.ScalarSwitch!({ values: [1, 2] }, 0)).toEqual([]);
  expect(api.ScalarConditional!({ values: [1, 2] }, true)).toEqual([1]);
  expect(api.ScalarConditional!({ values: [1, 2] }, false)).toEqual([]);
  const expressions = [
    'ScalarObject({"group": {"values": [1, 2]}})',
    'ScalarObject(None)',
    'ScalarList({"group": {"values": [1, 2]}})',
    'ScalarList(None)',
    'ManyList([{"values": [1, 2]}, {"values": [3]}])',
    'FirstScalar([{"values": [1, 2]}, {"values": [3]}])',
    'FirstScalar([])',
    'ScalarFilter(7)',
    'ScalarFilter(-1)'
  ];
  expect(
    runPython(
      expressions.map((expression) => ({ expression })),
      generatePythonModule([document]).code,
      { includeRuntime: false }
    )
  ).toEqual([
    { value: { values: [1, 2] } },
    { value: null },
    { value: [1, 2] },
    { value: [] },
    { value: [1, 2, 3] },
    { value: 1 },
    { value: null },
    { value: 7 },
    { value: null }
  ]);
});
