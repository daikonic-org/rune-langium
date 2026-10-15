// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import {
  BASICTYPES_ROSETTA,
  createRuneDslServices,
  getNodeSourceRegion,
  isRosettaFunction,
  type RosettaModel
} from '@rune-langium/core';
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

it.each(['scheme', 'reference'] as const)(
  'retains %s metadata in primitive switch statement branches',
  async (annotation) => {
    const { RuneDsl } = createRuneDslServices();
    const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString<RosettaModel>(
      `namespace test.switchMetadata
metaType scheme string
metaType reference string
annotation metadata:
 scheme string (0..1)
 reference string (0..1)
enum Kind:
 Cash
 Credit
func ReadMetadata:
 inputs: selector Kind (0..1)
  [metadata ${annotation}]
 output: result string (0..1)
 set result: selector -> ${annotation}
func Read:
 inputs: selector Kind (0..1)
  [metadata ${annotation}]
 output: result string (0..1)
 set result: selector switch Cash then ReadMetadata(item), default ReadMetadata(item)
func Payload:
 inputs: selector Kind (0..1)
  [metadata ${annotation}]
 output: result Kind (0..1)
 set result: selector switch Cash then item, default item
`,
      URI.parse(`file:///switch-${annotation}.rosetta`)
    );
    RuneDsl.shared.workspace.LangiumDocuments.addDocument(doc);
    const basics = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      BASICTYPES_ROSETTA,
      URI.parse(`file:///switch-basics-${annotation}.rosetta`)
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([basics, doc]);
    expect(doc.parseResult.parserErrors).toEqual([]);
    expect(doc.references.filter((reference) => reference.error).map((reference) => reference.$refText)).toEqual([]);
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
    type Input = { value?: string; meta?: { scheme?: string }; externalReference?: string } | undefined;
    const parameter =
      annotation === 'scheme'
        ? '{ value: Kind; meta: { scheme?: string } } | undefined'
        : '{ value?: Kind; meta?: { scheme?: string }; externalReference?: string } | undefined';
    const runtime = compileGeneratedTypeScript<Record<string, (selector: Input) => string | undefined>>(
      outputs.map((output) => ({
        ...output,
        content: `${output.content}
export function displayedRead(selector: ${parameter}): string | undefined { ${body('Read')} }
export function displayedPayload(selector: ${parameter}): Kind | undefined { ${body('Payload')} }
`
      }))
    );
    for (const value of annotation === 'scheme' ? ['Cash', 'Credit'] : ['Cash', 'Credit', undefined]) {
      const selector =
        annotation === 'scheme' ? { value, meta: { scheme: 'urn:test' } } : { value, externalReference: 'key' };
      expect(runtime.displayedRead!(selector)).toBe(runtime.Read!(selector));
      expect(runtime.displayedRead!(selector)).toBe(annotation === 'scheme' ? 'urn:test' : 'key');
      expect(runtime.displayedPayload!(selector)).toBe(runtime.Payload!(selector));
    }
    expect(runtime.displayedRead!(undefined)).toBe(runtime.Read!(undefined));
    let reads = 0;
    const selector = {
      get value() {
        reads++;
        return 'Cash';
      },
      meta: { scheme: 'urn:test' },
      externalReference: 'key'
    };
    expect(runtime.displayedRead!(selector)).toBe(annotation === 'scheme' ? 'urn:test' : 'key');
    expect(reads).toBe(1);
  },
  20_000
);
