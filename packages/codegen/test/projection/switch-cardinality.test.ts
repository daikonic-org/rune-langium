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
  expect(body('Select')).toContain('return value;');
  expect(body('Select')).toContain('return null;');
  expect(body('Partial')).not.toContain('default:');
  const runtime = compileGeneratedTypeScript<Record<string, (...args: unknown[]) => unknown>>(outputs);
  for (const direction of ['One', 'Many', 'Missing']) {
    for (const value of [7, undefined]) {
      for (const values of [[3, 4], [3], [], undefined]) {
        expect(runtime.Select!(direction, value, values)).toEqual(
          direction === 'One' ? (value == null ? [] : [value]) : direction === 'Many' ? (values ?? []) : []
        );
        if (direction === 'Many' && values && values.length > 1) {
          expect(() => runtime.Scalar!(direction, value, values)).toThrow('Expected at most one value');
        } else {
          expect(runtime.Scalar!(direction, value, values)).toEqual(
            direction === 'One' ? value : direction === 'Many' ? values?.[0] : undefined
          );
        }
      }
    }
    expect(runtime.Partial!(direction, 7)).toEqual(direction === 'One' ? [7] : []);
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
    expect(body('Read')).toContain('const item = selector;');
    expect(body('Read')).toContain('ReadMetadata(item)');
    expect(body('Payload')).not.toContain('.value');
    const runtime = compileGeneratedTypeScript<Record<string, (selector: Input) => string | undefined>>(outputs);
    for (const value of annotation === 'scheme' ? ['Cash', 'Credit'] : ['Cash', 'Credit', undefined]) {
      const selector =
        annotation === 'scheme' ? { value, meta: { scheme: 'urn:test' } } : { value, externalReference: 'key' };
      expect(runtime.Read!(selector)).toBe(annotation === 'scheme' ? 'urn:test' : 'key');
      expect(runtime.Payload!(selector)).toBe(value);
    }
    expect(runtime.Read!(undefined)).toBeUndefined();
  },
  20_000
);
