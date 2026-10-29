// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import ts from 'typescript-classic';
import { valueEqualitySource } from '../../src/expr/value-equality.js';

describe.each([false, true])('value equality (TypeScript=%s)', (typescript) => {
  const source = valueEqualitySource(typescript);
  const executable = typescript
    ? ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText
    : source;
  const {
    rune: { equals: equal },
    runeValueKey: key
  } = new Function(`${executable}; return { rune, runeValueKey };`)() as {
    rune: { equals: (left: unknown, right: unknown, quantifier?: 'all' | 'any', unequal?: boolean) => boolean };
    runeValueKey: (value: unknown) => string;
  };

  it('pairs or broadcasts collection equality and preserves empty and unequal semantics', () => {
    expect(equal([1, 2], [1, 2], 'all')).toBe(true);
    expect(equal([1, 2], [2, 1], 'all')).toBe(false);
    expect(equal([1, 2], [1, 3], 'any')).toBe(true);
    expect(equal([1, 2], 2, 'any')).toBe(true);
    expect(equal(2, [2, 2], 'all')).toBe(true);
    expect(equal([], [], 'any')).toBe(true);
    expect(equal([], null, 'all')).toBe(false);
    expect(equal(null, undefined, 'all')).toBe(true);
    expect(equal([1, 2], [1], 'all', true)).toBe(false);
    expect(equal([1, 2], [1], 'any', true)).toBe(true);
    expect(equal([1, 2], [3], 'all', true)).toBe(true);
    expect(equal([], [], 'all', true)).toBe(false);
  });

  it.each([
    ['PlainDate', () => Temporal.PlainDate.from('2026-09-11'), () => Temporal.PlainDate.from('2026-09-12')],
    ['PlainTime', () => Temporal.PlainTime.from('10:00'), () => Temporal.PlainTime.from('11:00')],
    [
      'PlainDateTime',
      () => Temporal.PlainDateTime.from('2026-09-11T10:00'),
      () => Temporal.PlainDateTime.from('2026-09-11T11:00')
    ],
    [
      'ZonedDateTime',
      () => Temporal.ZonedDateTime.from('2026-09-11T10:00Z[UTC]'),
      () => Temporal.ZonedDateTime.from('2026-09-11T11:00Z[UTC]')
    ],
    ['Instant', () => Temporal.Instant.from('2026-09-11T10:00Z'), () => Temporal.Instant.from('2026-09-11T11:00Z')],
    ['PlainYearMonth', () => Temporal.PlainYearMonth.from('2026-09'), () => Temporal.PlainYearMonth.from('2026-10')],
    ['PlainMonthDay', () => Temporal.PlainMonthDay.from('09-11'), () => Temporal.PlainMonthDay.from('09-12')],
    ['Duration', () => Temporal.Duration.from('PT1H'), () => Temporal.Duration.from('PT2H')]
  ] as const)('compares %s by value in nested records and collection keys', (_name, first, other) => {
    expect(Object.keys(first())).toEqual([]);
    expect(equal(first(), first())).toBe(true);
    expect(equal(first(), other())).toBe(false);
    expect(equal({ values: [first()] }, { values: [other()] })).toBe(false);
    expect(new Set([key(first()), key(first()), key(other())]).size).toBe(2);
    expect(equal(first(), {})).toBe(false);
    expect(equal(first(), String(first()))).toBe(false);
  });

  it('keeps temporal types distinct and ordinary records structural', () => {
    expect(equal(Temporal.PlainDate.from('2026-09-11'), Temporal.PlainDateTime.from('2026-09-11T00:00'))).toBe(false);
    class RecordValue {
      constructor(public amount: number) {}
      toString() {
        return 'same';
      }
    }
    expect(equal(new RecordValue(1), new RecordValue(2))).toBe(false);
    expect(equal(new RecordValue(1), { amount: 1 })).toBe(true);
  });
});
