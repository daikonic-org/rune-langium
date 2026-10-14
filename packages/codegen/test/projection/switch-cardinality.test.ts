// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { createRuneDslServices, getNodeSourceRegion, isRosettaFunction, type RosettaModel } from '@rune-langium/core';
import { URI } from 'langium';
import { generate, selectTypeScriptProjection } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

it('preserves collection assignment semantics in projected switch returns', async () => {
  const { RuneDsl } = createRuneDslServices();
  const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString<RosettaModel>(
    `namespace test.switches
enum Direction:
 One
 Many
 Missing
func Select:
 inputs: direction Direction (1..1) value int (0..1) values int (0..*)
 output: result int (0..*)
 set result: direction switch
  One then value,
  Many then values,
  Missing then empty
func Scalar:
 inputs: direction Direction (1..1) value int (0..1) values int (0..*)
 output: result int (0..1)
 set result: direction switch
  One then value,
  Many then values,
  Missing then empty
func Partial:
 inputs: direction Direction (1..1) value int (1..1)
 output: result int (0..*)
 set result: direction switch
  One then value
`,
    URI.parse('file:///switch-cardinality.rosetta')
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([doc], { validation: false });
  expect(doc.parseResult.parserErrors).toEqual([]);
  const outputs = await generate([doc], { target: 'typescript' });
  const body = (name: string) => {
    const owner = doc.parseResult.value.elements.find((node) => isRosettaFunction(node) && node.name === name)!;
    return selectTypeScriptProjection(
      outputs,
      {
        uri: doc.uri.toString(),
        nodeId: name,
        region: getNodeSourceRegion(owner)
      },
      'function',
      'body'
    ).code;
  };
  expect(body('Select')).toContain('switch (direction)');
  const runtime = compileGeneratedTypeScript<{
    Select: (direction: string, value: number | undefined, values: number[] | undefined) => number[];
    displayedSelect: (direction: string, value: number | undefined, values: number[] | undefined) => number[];
    Partial: (direction: string, value: number) => number[];
    displayedPartial: (direction: string, value: number) => number[];
    Scalar: (direction: string, value: number | undefined, values: number[] | undefined) => number | undefined;
    displayedScalar: (direction: string, value: number | undefined, values: number[] | undefined) => number | undefined;
  }>(
    outputs.map((output) => ({
      ...output,
      content: `${output.content}
export function displayedSelect(direction: Direction, value: number | undefined, values: number[] | undefined): number[] { ${body('Select')} }
export function displayedPartial(direction: Direction, value: number): number[] { ${body('Partial')} }
export function displayedScalar(direction: Direction, value: number | undefined, values: number[] | undefined): number | undefined { ${body('Scalar')} }
`
    }))
  );
  for (const direction of ['One', 'Many', 'Missing']) {
    for (const value of [7, undefined]) {
      for (const values of [[3, 4], [3], [], undefined]) {
        expect(runtime.displayedSelect(direction, value, values)).toEqual(runtime.Select(direction, value, values));
        if (direction === 'Many' && values && values.length > 1) {
          expect(() => runtime.Scalar(direction, value, values)).toThrow('Expected at most one value');
          expect(() => runtime.displayedScalar(direction, value, values)).toThrow('Expected at most one value');
        } else {
          expect(runtime.displayedScalar(direction, value, values)).toEqual(runtime.Scalar(direction, value, values));
        }
      }
    }
    expect(runtime.displayedPartial(direction, 7)).toEqual(runtime.Partial(direction, 7));
  }
}, 20_000);
