// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { cardinalityRuntimeSource } from '../../src/expr/cardinality-definition.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

it('exposes immutable cardinality constants and literal-preserving range factories', () => {
  const { Cardinality } = compileGeneratedTypeScript<{
    Cardinality: Readonly<Record<'One' | 'Optional' | 'ZeroOrMore' | 'OneOrMore', readonly [number, number | null]>> & {
      range(lower: number, upper: number): readonly [number, number];
      atLeast(lower: number): readonly [number, null];
    };
  }>(
    [
      {
        relativePath: 'cardinality.ts',
        content: cardinalityRuntimeSource(true),
        diagnostics: [],
        sourceMap: [],
        funcs: []
      }
    ],
    {
      erasableSyntaxOnly: true,
      assertions: `
const one: Cardinality<1, 1> = Cardinality.One;
const optional: Cardinality<0, 1> = Cardinality.Optional;
const many: Cardinality<0, null> = Cardinality.ZeroOrMore;
const requiredMany: Cardinality<1, null> = Cardinality.OneOrMore;
const bounded: Cardinality<2, 5> = Cardinality.range(2, 5);
const unbounded: Cardinality<2, null> = Cardinality.atLeast(2);
// @ts-expect-error cardinality constants are immutable
Cardinality.One[0] = 0;
// @ts-expect-error range endpoints retain their literal types
const wrong: Cardinality<1, 5> = Cardinality.range(2, 5);
`
    }
  );
  expect(Cardinality.One).toEqual([1, 1]);
  expect(Cardinality.Optional).toEqual([0, 1]);
  expect(Cardinality.ZeroOrMore).toEqual([0, null]);
  expect(Cardinality.OneOrMore).toEqual([1, null]);
  expect(Cardinality.range(0, 0)).toEqual([0, 0]);
  expect(Cardinality.range(2, 5)).toEqual([2, 5]);
  expect(Cardinality.atLeast(2)).toEqual([2, null]);
  expect(Object.isFrozen(Cardinality)).toBe(true);
  for (const value of [
    Cardinality.One,
    Cardinality.Optional,
    Cardinality.ZeroOrMore,
    Cardinality.OneOrMore,
    Cardinality.range(2, 5),
    Cardinality.atLeast(2)
  ]) {
    expect(Object.isFrozen(value)).toBe(true);
  }
  for (const [lower, upper] of [
    [-1, 2],
    [0.5, 2],
    [2, 1],
    [1, 1.5],
    [0, Infinity],
    [NaN, 1],
    [0, Number.MAX_SAFE_INTEGER + 1]
  ]) {
    expect(() => Cardinality.range(lower!, upper!)).toThrow(RangeError);
  }
  for (const lower of [-1, 1.5, NaN, Infinity]) expect(() => Cardinality.atLeast(lower)).toThrow(RangeError);
});
