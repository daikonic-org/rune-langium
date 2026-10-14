// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, describe, expect, it } from 'vitest';
import { URI } from 'langium';
import { createRuneDslServices, getNodeSourceRegion, isRosettaFunction, type RosettaModel } from '@rune-langium/core';
import { generate, selectTypeScriptProjection } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

const source = `namespace test.projection
 enum Direction:
  Increase
  Decrease
  Replace
 type Object:
  value number (1..1)
 type Money:
  value number (1..1)
 type Schedule:
  durationInYears number (0..1)
 type InterestRatePayout:
  paymentDate date (0..1)
 type OtherPayout:
  value number (0..1)
 choice Payout:
  InterestRatePayout
  OtherPayout
 type EconomicTerms:
  payout Payout (0..*)
 func UpdateAmount:
  inputs: oldAmount number (0..1)
          changeAmount number (0..1)
          direction Direction (1..1)
  output: newAmount number (0..1)
  set newAmount: direction switch
   Increase then oldAmount + changeAmount,
   Decrease then oldAmount - changeAmount,
   Replace then changeAmount
 func Rate:
  inputs: durationInYears number (1..1)
  output: result number (1..1)
  set result: durationInYears
 func Margin:
  inputs: schedule Schedule (1..1)
  output: result Money (0..1)
  alias rate: Rate(schedule -> durationInYears)
  set result -> value: rate
 func Payment:
  inputs: economicTerms EconomicTerms (1..1)
  output: result InterestRatePayout (0..*)
  set result: economicTerms -> payout as InterestRatePayout
 func Same:
  inputs: left Object (1..1)
          right Object (1..1)
  output: result boolean (1..1)
  set result: left = right
 func Missing:
  inputs: left Object (0..1)
  output: result boolean (1..1)
  set result: left = empty
 func EnumSame:
  inputs: direction Direction (1..1)
  output: result boolean (1..1)
  set result: direction = Direction -> Increase
 func Literal:
  output: result string (1..1)
  set result: "Increase"
 func OptionalSame:
  inputs: left Object (0..1)
          right Object (0..1)
  output: result boolean (1..1)
  set result: left = right
 func MissingMany:
  inputs: values Object (0..*)
  output: result boolean (1..1)
  set result: values = empty
 func NotInterest:
  inputs: payout Payout (0..1)
  output: result boolean (1..1)
  set result: payout as InterestRatePayout is absent
 func HasInterest:
  inputs: payout Payout (0..1)
  output: result boolean (1..1)
  set result: payout as InterestRatePayout exists
 func ManyInterest:
  inputs: payouts Payout (0..*)
  output: result boolean (1..1)
  set result: payouts as InterestRatePayout exists
 func ManySame:
  inputs: left Object (0..*)
          right Object (0..*)
  output: result boolean (1..1)
  set result: left = right
`;

describe('validated Rune object display contract', () => {
  const { RuneDsl } = createRuneDslServices();
  const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString<RosettaModel>(
    source,
    URI.parse('file:///projection.rosetta')
  );
  let outputs: Awaited<ReturnType<typeof generate>>;
  beforeAll(async () => {
    await RuneDsl.shared.workspace.DocumentBuilder.build([doc], { validation: false });
    expect(doc.parseResult.parserErrors).toEqual([]);
    outputs = await generate([doc], { target: 'typescript' });
  });
  function body(name: string) {
    const owner = doc.parseResult.value.elements.find((node) => isRosettaFunction(node) && node.name === name)!;
    return selectTypeScriptProjection(
      outputs,
      { uri: doc.uri.toString(), nodeId: name, region: getNodeSourceRegion(owner) },
      'function',
      'body'
    ).code;
  }
  it('shows an enum switch with return statements', () => {
    expect(body('UpdateAmount')).toContain('switch (direction)');
    expect(body('UpdateAmount')).toContain('case Direction.Increase:');
    expect(body('UpdateAmount')).toContain('return changeAmount;');
  });
  it('displays plain calls and an inferred output while executable APIs retain boundary checks', () => {
    const display = body('Margin');
    expect(display).toMatch(/Rate\(schedule\?\.durationInYears\)/);
    expect(display).not.toMatch(/RuneFuncData|NonNullable|throw new Error| as /);
    expect(outputs.map((output) => output.content).join('\n')).toContain("Argument 'durationInYears' requires a value");
  });
  it('narrows purpose-built collection elements with a named type guard', () => {
    expect(body('Payment')).toContain('.filter(isInterestRatePayout)');
    expect(body('Payment')).not.toMatch(/typeof|__as|__result/);
  });
  it('fuses choice narrowing and presence as a type-membership predicate', () => {
    expect(body('NotInterest')).toBe('return !isInterestRatePayout(payout);');
    expect(body('HasInterest')).toBe('return isInterestRatePayout(payout);');
    expect(body('ManyInterest')).toContain('.some(isInterestRatePayout)');
    const absent = new Function('payout', 'isInterestRatePayout', body('NotInterest'));
    const guard = (value: { kind?: string } | undefined) => value?.kind === 'interest';
    expect(absent(undefined, guard)).toBe(true);
    expect(absent({ kind: 'other' }, guard)).toBe(true);
    expect(absent({ kind: 'interest' }, guard)).toBe(false);
  });
  it('uses the declared enum member while retaining ordinary string literals', () => {
    expect(body('EnumSame')).toContain('direction === Direction.Increase');
    expect(body('EnumSame')).not.toContain('"Increase"');
    expect(body('Literal')).toMatch(/['"]Increase['"]/);
    const same = new Function('direction', 'Direction', body('EnumSame'));
    expect(same('Increase', { Increase: 'Increase' })).toBe(true);
    expect(same('Decrease', { Increase: 'Increase' })).toBe(false);
  });
  it.each(['per-namespace', 'barrel', 'single-file'] as const)(
    'compiles enum member projections in %s exports',
    async (layout) => {
      const enumDoc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString<RosettaModel>(
        `namespace test.enumvalues
       enum BaseDirection:
        Increase
       enum Direction extends BaseDirection:
        Decrease
        __proto__
       enum Empty:
       enum Number:
        Numeric
       enum rune:
        Helper
      `,
        URI.parse('file:///enum-values.rosetta')
      );
      await RuneDsl.shared.workspace.DocumentBuilder.build([enumDoc], { validation: false });
      expect(enumDoc.parseResult.parserErrors).toEqual([]);
      const enumOutputs = await generate([enumDoc], { target: 'typescript', typescript: { layout } });
      const entry = enumOutputs.find((output) => output.content.includes('export type Direction ='))!.relativePath;
      const runtime = compileGeneratedTypeScript<{
        Direction: { Increase: 'Increase'; Decrease: 'Decrease'; __proto__: '__proto__' };
        DirectionValues: string[];
        Empty: Record<string, never>;
        EmptyValues: never[];
        NumberEnum: { Numeric: 'Numeric' };
        runeEnum: { Helper: 'Helper' };
        projectedEnumSame: (direction: string) => boolean;
      }>(
        enumOutputs.map((output) => ({
          ...output,
          content:
            output.relativePath === entry
              ? `${output.content}\nexport function projectedEnumSame(direction: Direction): boolean { ${body('EnumSame')} }`
              : output.content
        })),
        { entry }
      );
      expect(runtime.Direction.Increase).toBe('Increase');
      expect(runtime.DirectionValues).toContain(runtime.Direction.Increase);
      expect(Object.prototype.hasOwnProperty.call(runtime.Direction, '__proto__')).toBe(true);
      expect(runtime.Direction.__proto__).toBe('__proto__');
      expect(runtime.projectedEnumSame(runtime.Direction.Increase)).toBe(true);
      expect(runtime.projectedEnumSame(runtime.Direction.Decrease)).toBe(false);
      expect(runtime.Empty).toEqual({});
      expect(runtime.EmptyValues).toEqual([]);
      expect(runtime.NumberEnum.Numeric).toBe('Numeric');
      expect(runtime.runeEnum.Helper).toBe('Helper');
    },
    20_000
  );
  it('does not invoke object equality when either optional operand is absent', () => {
    const same = new Function('left', 'right', body('OptionalSame'));
    let calls = 0;
    const object = {
      equals(other: unknown) {
        calls++;
        return other === object;
      }
    };
    expect(same(object, undefined)).toBe(false);
    expect(same(undefined, object)).toBe(false);
    expect(same(undefined, null)).toBe(true);
    expect(calls).toBe(0);
    expect(same(object, object)).toBe(true);
    expect(calls).toBe(1);
    expect(body('MissingMany')).not.toContain('equals');
    const absent = new Function('values', body('MissingMany'));
    expect(absent([])).toBe(true);
    expect(absent([object])).toBe(false);
  });
  it('uses object equality methods but native null presence comparisons', () => {
    expect(body('Same')).toContain('left.equals(right)');
    expect(body('Missing')).toContain('left == null');
    expect(body('Missing')).not.toMatch(/equals|valueKey/);
    const absent = new Function('left', body('Missing'));
    expect(absent(undefined)).toBe(true);
    expect(absent({ value: 1 })).toBe(false);
    expect(body('ManySame')).toContain('a.equals(b)');
    expect(body('ManySame')).not.toContain('valueKey');
  });
});
