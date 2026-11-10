// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { PYTHON_RUNTIME_SOURCE } from '../../src/projection/python-runtime.js';
import { RUNTIME_HELPER_JS_SOURCE } from '../../src/helpers.js';

const cases = [
  ['rune.exists(None)', 'rune.exists(null)'],
  ['rune.exists([])', 'rune.exists([])'],
  ['rune.exists(False)', 'rune.exists(false)'],
  ['rune.exists(0)', 'rune.exists(0)'],
  ['rune.exists("")', 'rune.exists("")'],
  ['rune.contains([], [])', 'rune.contains([], [])'],
  ['rune.contains([{"a": 1, "b": None}], [{"a": 1}])', 'rune.contains([{a: 1, b: null}], [{a: 1}])'],
  ['rune.disjoint([False], [0])', 'rune.disjoint([false], [0])'],
  ['rune.disjoint([], [])', 'rune.disjoint([], [])'],
  ['rune.distinct([{"a": 1}, {"a": 1, "b": None}, {"a": 2}])', 'rune.distinct([{a: 1}, {a: 1, b: null}, {a: 2}])'],
  ['rune.distinct([])', 'rune.distinct([])'],
  ['rune.list(None)', 'rune.list(null)'],
  ['rune.list(False)', 'rune.list(false)'],
  ['rune.list(0)', 'rune.list(0)'],
  ['rune.list("")', 'rune.list("")'],
  ['rune.single([])', 'rune.single([])'],
  ['rune.single([1, 2])', 'rune.single([1, 2])'],
  ['rune.binary([], [2], lambda a, b: a + b)', 'rune.binary([], [2], (a, b) => a + b)'],
  ['rune.binary([1], [2], lambda a, b: a + b)', 'rune.binary([1], [2], (a, b) => a + b)'],
  ['rune.compare([], [2], lambda a, b: a < b)', 'rune.compare([], [2], (a, b) => a < b)'],
  ['rune.compare([1, 3], [2], lambda a, b: a < b, "any")', 'rune.compare([1, 3], [2], (a, b) => a < b, "any")'],
  ['rune.compare([1, 3], [2], lambda a, b: a < b, "all")', 'rune.compare([1, 3], [2], (a, b) => a < b, "all")'],
  ['rune.equals(False, 0)', 'rune.equals(false, 0)'],
  ['rune.equals({"a": 1, "missing": None}, {"a": 1})', 'rune.equals({a: 1, missing: null}, {a: 1})'],
  [
    'rune.equals({"a": 1, "@numberText": {"a": "1.00"}}, {"a": 1})',
    'rune.equals({a: 1, "@numberText": {a: "1.00"}}, {a: 1})'
  ],
  ['rune.equals({"value": False}, {"value": 0})', 'rune.equals({value: false}, {value: 0})'],
  ['rune.equals([1, 2], [2, 1])', 'rune.equals([1, 2], [2, 1])'],
  ...['all', 'any'].flatMap((quantifier) =>
    [false, true].flatMap((unequal) =>
      [
        [null, null],
        [[], []],
        [[], null],
        [[1, 2], 2],
        [2, [2, 2]],
        [[1, 2], [1]],
        [[1], [1, 2]],
        [[1, 2], [3]]
      ].map(
        ([left, right]) =>
          [
            `rune.equals(${JSON.stringify(left).replace(/null/g, 'None')}, ${JSON.stringify(right).replace(/null/g, 'None')}, "${quantifier}", ${unequal ? 'True' : 'False'})`,
            `rune.equals(${JSON.stringify(left)}, ${JSON.stringify(right)}, "${quantifier}", ${unequal})`
          ] as const
      )
    )
  ),
  ['rune.divide(1, 0)', '1 / 0'],
  ...[
    0,
    -0,
    1e-7,
    -1e-7,
    1e-6,
    1.25e-6,
    1e20,
    1e21,
    -1e21,
    1.0000000000000001e18,
    1.2345678901234567,
    5e-324,
    Number.MAX_VALUE
  ].map((value) => [`rune.toString(float(${String(value)}))`, `String(${String(value)})`] as const),
  [
    'rune.toField({"value": 0, "meta": {"scheme": "x"}}, "field")',
    'rune.toField({value: 0, meta: {scheme: "x"}}, "field")'
  ],
  ['rune.toField({"value": 7}, "value")', 'rune.toField({value: 7}, "value")'],
  [
    'rune.toReference({"externalReference": "id"}, "reference")',
    'rune.toReference({externalReference: "id"}, "reference")'
  ],
  ['rune.toField({"externalReference": "id"}, "reference")', 'rune.toField({externalReference: "id"}, "reference")'],
  ['rune.asKey({"meta": {"externalKey": "id"}}, "value")', 'rune.asKey({meta: {externalKey: "id"}}, "value")'],
  ['(1 if True else rune.single([1, 2]))', '(true ? 1 : rune.single([1, 2]))'],
  [
    'rune.withMeta(1, {"scheme":"x", "reference":"id"}, "value")',
    'rune.withMeta(1, {scheme:"x", reference:"id"}, "value")'
  ],
  [
    'rune.withMeta({"value":1,"reference":{"scope":"s"}}, {"address":"id"}, "reference")',
    'rune.withMeta({value:1,reference:{scope:"s"}}, {address:"id"}, "reference")'
  ],
  ['rune.withMeta({"a":1}, {"key":"id"}, "value")', 'rune.withMeta({a:1}, {key:"id"}, "value")'],
  ['rune.withMeta([None, 1], {"scheme":"x"}, "value")', 'rune.withMeta([null, 1], {scheme:"x"}, "value")'],
  [
    'rune.withMeta({"value":1,"externalReference":"id"}, {"scheme":"x"}, "reference")',
    'rune.withMeta({value:1,externalReference:"id"}, {scheme:"x"}, "reference")'
  ],
  [
    'rune.asKey({"value":{"meta":None},"meta":{"externalKey":"id"}}, "reference")',
    'rune.asKey({value:{meta:null},meta:{externalKey:"id"}}, "reference")'
  ],
  [
    'rune.asKey({"value":{"meta":{}},"meta":{"externalKey":"id"}}, "reference")',
    'rune.asKey({value:{meta:{}},meta:{externalKey:"id"}}, "reference")'
  ],
  [
    'rune.asKey({"meta":{"globalKey":None},"globalReference":"id"}, "value")',
    'rune.asKey({meta:{globalKey:null},globalReference:"id"}, "value")'
  ]
] as const;

function expectRuntimeParity(expressions: readonly string[]) {
  const expected = expressions.map((expression) => ({
    value: new Function('Temporal', RUNTIME_HELPER_JS_SOURCE + '\nreturn ' + expression)(Temporal)
  }));
  const result = spawnSync(
    process.env.PYTHON_BINARY ?? 'python3',
    [new URL('python-runtime-check.py', import.meta.url).pathname],
    {
      input: JSON.stringify({
        source: PYTHON_RUNTIME_SOURCE,
        cases: expressions.map((expression) => ({ expression }))
      }),
      encoding: 'utf8'
    }
  );
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual(expected);
}

describe('Python runtime contracts', () => {
  it.each([
    ['0000-02-29', '12:00:00.123456789', 'America/New_York'],
    ['-000001-12-31', '12:00:00', 'Europe/Paris'],
    ['0001-01-01', '00:00:00', 'Asia/Tokyo'],
    ['9999-12-31', '23:59:59', 'America/New_York'],
    ['+010000-07-01', '12:00:00', 'America/New_York'],
    ['+010000-01-01', '12:00:00', 'America/New_York'],
    ['1850-02-28', '12:00:00', 'Europe/Paris'],
    ['2026-03-08', '02:30:00.123456789', 'America/New_York'],
    ['2026-11-01', '01:30:00', 'America/New_York']
  ])('constructs and reads named-zone %s %s %s like Temporal', (date, time, timezone) => {
    const fields = { date, time, timezone };
    const construct = `rune.dateConstruct("zonedDateTime", ${JSON.stringify(fields)})`;
    const value = new Function('Temporal', RUNTIME_HELPER_JS_SOURCE + '\nreturn ' + construct)(Temporal) as string;
    const expressions = [
      construct,
      ...['year', 'date', 'time', 'timezone'].map(
        (field) => `rune.dateField(${JSON.stringify(value)}, "zonedDateTime", "${field}")`
      )
    ];
    expectRuntimeParity(expressions);
  });

  it.each([
    '0000-01-01T00:00:00Z[America/New_York]',
    '-000001-12-31T12:00:00+00:09:21[Europe/Paris]',
    '2026-11-01T01:30:00-05:00[America/New_York]'
  ])('reads instant rollovers and explicit overlap/second offsets in %s', (value) => {
    expectRuntimeParity(
      ['year', 'date', 'time', 'timezone'].map(
        (field) => `rune.dateField(${JSON.stringify(value)}, "zonedDateTime", "${field}")`
      )
    );
  });

  it('embeds exactly the authoritative Python file and regenerates deterministically', () => {
    expect(PYTHON_RUNTIME_SOURCE).toBe(
      readFileSync(new URL('../../src/projection/python-runtime.py', import.meta.url), 'utf8')
    );
    const script = fileURLToPath(new URL('../../scripts/generate-python-runtime.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, '--check'], {
      encoding: 'utf8'
    });
    expect(result.status, result.stderr).toBe(0);
  });
  it('preserves the authoritative TS semantics for scalars, collections, missing values and metadata', () => {
    const expected = cases.map(([, expression]) => {
      try {
        const value = new Function(RUNTIME_HELPER_JS_SOURCE + '\nreturn (' + expression + ');')();
        return { value: JSON.parse(JSON.stringify(value ?? null)) };
      } catch (error) {
        return { error: (error as Error).message };
      }
    });
    const result = spawnSync(
      process.env.PYTHON_BINARY ?? 'python3',
      [new URL('python-runtime-check.py', import.meta.url).pathname],
      {
        input: JSON.stringify({ source: PYTHON_RUNTIME_SOURCE, cases: cases.map(([expression]) => ({ expression })) }),
        encoding: 'utf8'
      }
    );
    expect(result.status, result.error?.message ?? result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(expected);
  });
});
