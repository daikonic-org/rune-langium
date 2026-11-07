// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { URI, AstUtils } from 'langium';
import {
  BASICTYPES_ROSETTA,
  createRuneDslServices,
  isRosettaModel,
  isRosettaFunction,
  getFunctionInputs,
  getFunctionOutput,
  getExpressionScope,
  getEnumValues,
  isRosettaEnumeration,
  isRosettaSymbolReference
} from '../../src/index.js';

describe('inherited function expression scope', () => {
  it('keeps identically named aliases local to each dispatch variant', async () => {
    const { RuneDsl } = createRuneDslServices();
    const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
    const basics = factory.fromString(BASICTYPES_ROSETTA, URI.parse('inmemory:///basics.rosetta'));
    const document = factory.fromString(
      `namespace scope.dispatch_aliases
enum Kind:
 First
 Second
func Compute:
 inputs:
  kind Kind (1..1)
  value number (1..1)
 output: result number (1..1)
func Compute(kind: Kind -> First):
 alias shared: value * 2
 alias firstOnly: shared + 1
 set result: firstOnly
func Compute(kind: Kind -> Second):
 alias shared: value * 3
 set result: shared
`,
      URI.parse('inmemory:///dispatch-aliases.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([basics, document], { eagerLinking: true });
    expect(document.parseResult.parserErrors).toEqual([]);
    expect(document.references.flatMap((ref) => (ref.error ? [ref.error.message] : []))).toEqual([]);
    if (!isRosettaModel(document.parseResult.value)) throw new Error('Expected model');
    const variants = document.parseResult.value.elements.filter(isRosettaFunction).filter((fn) => fn.dispatchAttribute);
    for (const variant of variants)
      for (const reference of AstUtils.streamAllContents(variant).filter(isRosettaSymbolReference))
        if (reference.symbol.$refText === 'shared')
          expect(reference.symbol.ref).toBe(variant.shortcuts.find((alias) => alias.name === 'shared'));
    const second = variants[1]!;
    expect(
      getExpressionScope(second.operations[0]!.expression, RuneDsl).some((entry) => entry.name === 'firstOnly')
    ).toBe(false);
  });
  it('links and exposes effective output enum members for inherited and dispatch functions', async () => {
    const { RuneDsl } = createRuneDslServices();
    const colors = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      `namespace scope.colors
enum OtherColor:
 Red
 Blue
enum BaseColor:
 Red
enum Color extends BaseColor:
 Blue
`,
      URI.parse('inmemory:///colors.rosetta')
    );
    const document = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      `namespace scope.callables
import scope.colors.Color
enum Kind:
 Cash
func Parent:
 output: result Color (1..1)
 set result: Red
func Child extends Parent:
 set result: Blue
func Grandchild extends Child:
 set result: Red
func Compute:
 inputs: kind Kind (1..1)
 output: result Color (1..1)
 set result: Red
func Compute(kind: Kind -> Cash):
 set result: Blue
`,
      URI.parse('inmemory:///output-enums.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([colors, document]);
    expect(colors.parseResult.parserErrors).toEqual([]);
    expect(document.parseResult.parserErrors).toEqual([]);
    expect(document.references.flatMap((ref) => (ref.error ? [ref.error.message] : []))).toEqual([]);
    if (!isRosettaModel(document.parseResult.value)) throw new Error('Expected model');
    for (const func of document.parseResult.value.elements.filter(isRosettaFunction)) {
      const expression = func.operations[0]!.expression;
      const outputEnum = getFunctionOutput(func)?.typeCall.type.ref;
      if (!isRosettaEnumeration(outputEnum) || !isRosettaSymbolReference(expression))
        throw new Error('Expected enum output');
      expect(getEnumValues(outputEnum)).toContain(expression.symbol.ref);
      const entries = getExpressionScope(expression, RuneDsl);
      expect(entries).toContainEqual(expect.objectContaining({ name: 'Red' }));
      expect(entries).toContainEqual(expect.objectContaining({ name: 'Blue' }));
    }
  });

  it('links parent input/output identities through multiple levels of inheritance', async () => {
    const { RuneDsl } = createRuneDslServices();
    const basics = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      BASICTYPES_ROSETTA,
      URI.parse('inmemory:///basics.rosetta')
    );
    const document = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      `namespace scope.inherited
func Parent:
 inputs: amount number (1..1)
 output: answer number (1..1)
 set answer: amount + 1
func Child extends Parent:
 set answer: super(amount) + 2
 post-condition Nonnegative: answer >= 0
func Grandchild extends Child:
 set answer: super(amount)
`,
      URI.parse('inmemory:///inherited.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([basics, document]);
    expect(document.parseResult.parserErrors).toEqual([]);
    expect(document.references.flatMap((ref) => (ref.error ? [ref.error.message] : []))).toEqual([]);
    if (!isRosettaModel(document.parseResult.value)) throw new Error('Expected model');
    const [parent, child, grandchild] = document.parseResult.value.elements.filter(isRosettaFunction);
    expect(getFunctionInputs(child!)).toEqual(parent!.inputs);
    expect(getFunctionInputs(grandchild!)).toEqual(parent!.inputs);
    expect(grandchild!.operations[0]!.assignRoot.ref).toBe(parent!.output);
    expect(getFunctionOutput(child!)).toBe(parent!.output);
  });
});
