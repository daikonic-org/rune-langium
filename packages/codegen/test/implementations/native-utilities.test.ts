// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { beforeAll, expect, it } from 'vitest';
import { URI, type LangiumDocument } from 'langium';
import {
  ANNOTATIONS_ROSETTA,
  BASICTYPES_ROSETTA,
  assertValidDocuments,
  createRuneDslServices,
  isRosettaFunction,
  isRosettaModel
} from '@rune-langium/core';
import { Temporal } from '@js-temporal/polyfill';
import { generateSelected, generatePreviewSchemas } from '../../src/export.js';
import { generatePythonModule } from '../../src/projection/python-functions.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { runPython } from '../projection/python-test-utils.js';
import { nativeFunctionShape, matchesNativeFunction } from '../../src/implementations/signature.js';
const source = `namespace cdm.base.datetime
enum DayOfWeekEnum:
 MON
 TUE
 WED
 THU
 FRI
 SAT
 SUN
func AddDays:
 [codeImplementation]
 inputs:
  inputDate date (1..1)
  numDays int (1..1)
 output: resultDate date (1..1)
func DateDifference:
 [codeImplementation]
 inputs:
  firstDate date (1..1)
  secondDate date (1..1)
 output: difference int (1..1)
func LeapYearDateDifference:
 [codeImplementation]
 inputs:
  firstDate date (1..1)
  secondDate date (1..1)
 output: difference int (1..1)
func DayOfWeek:
 [codeImplementation]
 inputs: date date (1..1)
 output: dayOfWeek DayOfWeekEnum (1..1)
func ToTime:
 [codeImplementation]
 inputs:
  hours int (1..1)
  minutes int (1..1)
  seconds int (1..1)
 output: time time (1..1)
func Now:
 [codeImplementation]
 output: now zonedDateTime (1..1)
func PopOffDateList:
 [codeImplementation]
 inputs: dates date (0..*)
 output: newList date (0..*)
`;
const strings = `namespace cdm.ingest.fpml.confirmation.common
func StringContains:
 [codeImplementation]
 inputs:
  input string (0..1)
  str string (1..1)
 output: result boolean (1..1)
`;
let docs: LangiumDocument[],
  ts: Record<string, (...args: unknown[]) => unknown>,
  python: ReturnType<typeof generatePythonModule>;
beforeAll(async () => {
  const { RuneDsl } = createRuneDslServices();
  docs = [BASICTYPES_ROSETTA, ANNOTATIONS_ROSETTA, source, strings].map((text, index) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      text,
      URI.parse(`inmemory:///utilities-${index}.rosetta`)
    )
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
  assertValidDocuments(docs);
  const generated = await generateSelected(
    docs,
    { namespaces: ['cdm.base.datetime', 'cdm.ingest.fpml.confirmation.common'], declarations: [] },
    { target: 'typescript', strict: true, typescript: { layout: 'single-file' } }
  );
  expect(generated.outputs.flatMap((file) => file.diagnostics).filter((issue) => issue.severity === 'error')).toEqual(
    []
  );
  const module = compileGeneratedTypeScript(generated.outputs);
  ts = Object.fromEntries(
    generated.outputs
      .flatMap((file) => file.funcs)
      .map((func) => [func.name, module[func.exportName!] as (...args: unknown[]) => unknown])
  );
  python = generatePythonModule(docs);
});
const date = (text: string) => Temporal.PlainDate.from(text);
const call = (name: string, args: string) => `${python.bindings.get('cdm.base.datetime.' + name)}(${args})`;
it('adds calendar days and computes signed Gregorian differences across leap/century/year-zero boundaries', () => {
  const cases = [
    ['2020-02-28', 1, '2020-02-29'],
    ['1900-02-28', 1, '1900-03-01'],
    ['2000-03-01', -1, '2000-02-29'],
    ['0000-01-01', -1, '-000001-12-31']
  ] as const;
  for (const [base, days, result] of cases) expect(String(ts.AddDays!(date(base), days))).toBe(result);
  expect(
    runPython(
      cases.map(([base, days]) => ({ expression: call('AddDays', `${JSON.stringify(base)}, ${days}`) })),
      python.code,
      { includeRuntime: false }
    )
  ).toEqual(cases.map((row) => ({ value: row[2] })));
  const pairs = [
    ['2020-02-28', '2020-03-01', 2],
    ['1900-02-28', '1900-03-01', 1],
    ['2000-03-01', '2000-02-28', -2]
  ] as const;
  for (const [first, second, result] of pairs) expect(ts.DateDifference!(date(first), date(second))).toBe(result);
  expect(
    runPython(
      pairs.map(([first, second]) => ({
        expression: call('DateDifference', `${JSON.stringify(first)},${JSON.stringify(second)}`)
      })),
      python.code,
      { includeRuntime: false }
    )
  ).toEqual(pairs.map((row) => ({ value: row[2] })));
  expect(() => ts.AddDays!(date('2020-01-01'), 1.5)).toThrow(/integer/);
});
it('counts whole days in leap years rather than only February 29 and keeps sign reversal', () => {
  const pairs = [
    ['2020-01-01', '2021-01-01', 366],
    ['2019-12-31', '2020-01-02', 1],
    ['2020-03-01', '2020-02-28', -2],
    ['1900-01-01', '1901-01-01', 0],
    ['2000-01-01', '2001-01-01', 366]
  ] as const;
  for (const [first, second, result] of pairs)
    expect(ts.LeapYearDateDifference!(date(first), date(second))).toBe(result);
  expect(
    runPython(
      pairs.map(([first, second]) => ({
        expression: call('LeapYearDateDifference', `${JSON.stringify(first)},${JSON.stringify(second)}`)
      })),
      python.code,
      { includeRuntime: false }
    )
  ).toEqual(pairs.map((row) => ({ value: row[2] })));
});
it('uses weekday names, strict time components, UTC whole-second Now and non-mutating list trimming', () => {
  expect(ts.DayOfWeek!(date('2026-10-26'))).toBe('MON');
  expect(String(ts.ToTime!(23, 59, 59))).toBe('23:59:59');
  expect(() => ts.ToTime!(24, 0, 0)).toThrow();
  expect(() => ts.ToTime!(1.5, 0, 0)).toThrow();
  const now = ts.Now!() as Temporal.ZonedDateTime;
  expect(now.timeZoneId).toBe('UTC');
  expect(now.nanosecond + now.microsecond + now.millisecond).toBe(0);
  const values = [date('2020-01-01'), date('2020-01-01'), date('2020-01-02')];
  expect(ts.PopOffDateList!(values)).toEqual(values.slice(0, -1));
  expect(values).toHaveLength(3);
  expect(ts.PopOffDateList!(undefined)).toEqual([]);
  const results = runPython(
    [
      { expression: call('DayOfWeek', '"2026-10-26"') },
      { expression: call('ToTime', '23,59,59') },
      { expression: call('PopOffDateList', '["2020-01-01","2020-01-01","2020-01-02"]') },
      { expression: call('PopOffDateList', '[]') },
      { expression: `rune_clock_parts(${call('Now', '')})[3]` }
    ],
    python.code,
    { includeRuntime: false }
  );
  expect(results).toEqual(['MON', '23:59:59', ['2020-01-01', '2020-01-01'], [], 0].map((value) => ({ value })));
});
it('matches Java UTF-16 substring behavior, empty needles and missing optional strings across targets', () => {
  const cases: [string | undefined, string, boolean][] = [
    ['abc', 'b', true],
    ['abc', '', true],
    [undefined, 'a', false],
    ['😀', '\ud83d', true],
    ['\u0100\u0001', '\u0101', false],
    ['abc', 'B', false]
  ];
  for (const [input, needle, result] of cases) expect(ts.StringContains!(input, needle)).toBe(result);
  const name = python.bindings.get('cdm.ingest.fpml.confirmation.common.StringContains');
  expect(
    runPython(
      cases.map(([input, needle]) => ({
        expression: `${name}(${input === undefined ? 'None' : JSON.stringify(input)},${JSON.stringify(needle)})`
      })),
      python.code,
      { includeRuntime: false }
    )
  ).toEqual(cases.map((row) => ({ value: row[2] })));
});
it('reports bundled availability in preview and refuses drifted enum/signature shapes', () => {
  const preview = generatePreviewSchemas(docs, { targetId: 'cdm.base.datetime.AddDays' })[0]!;
  expect(preview.executionUnavailable).toBeUndefined();
  const root = docs[2]!.parseResult.value;
  if (!isRosettaModel(root)) throw new Error('model');
  const func = root.elements.find((node) => isRosettaFunction(node) && node.name === 'DayOfWeek');
  if (!isRosettaFunction(func)) throw new Error('func');
  const signature = nativeFunctionShape(func);
  expect(matchesNativeFunction(func, signature)).toBe(true);
  expect(matchesNativeFunction(func, { ...signature, output: { ...signature.output!, enumValues: ['Monday'] } })).toBe(
    false
  );
});

it('keeps invalid component and fractional-day errors in standalone Python', () => {
  const results = runPython(
    [
      { expression: call('ToTime', '24,0,0') },
      { expression: call('ToTime', '1.5,0,0') },
      { expression: call('AddDays', '"2020-01-01",1.5') }
    ],
    python.code,
    { includeRuntime: false }
  );
  expect(results).toEqual([
    { error: expect.stringContaining('hour') },
    { error: expect.stringContaining('integer') },
    { error: expect.stringContaining('integer') }
  ]);
});

it('passes actual positional values to explicit Python overrides before bundled defaults', () => {
  const code =
    python.code +
    '\nrune_bind("cdm.base.datetime.AddDays", lambda base, days: "2001-01-02" if base == "2020-01-01" and days == 2 else "wrong")\n';
  expect(runPython([{ expression: call('AddDays', '"2020-01-01",2') }], code, { includeRuntime: false })).toEqual([
    { value: '2001-01-02' }
  ]);
});

it('executes a parameterized native utility in a strictly compiled per-namespace artifact', async () => {
  const generated = await generateSelected(
    docs,
    { namespaces: ['cdm.base.datetime'], declarations: [] },
    { target: 'typescript', strict: true, typescript: { layout: 'per-namespace' } }
  );
  const func = generated.outputs.flatMap((file) => file.funcs).find((func) => func.name === 'AddDays')!;
  const entry = generated.outputs.find((file) => file.funcs.includes(func))!.relativePath;
  const module = compileGeneratedTypeScript(generated.outputs, { entry });
  expect(String((module[func.exportName!] as (...args: unknown[]) => unknown)(date('2020-02-28'), 1))).toBe(
    '2020-02-29'
  );
});

it('treats integral JSON numbers equally across executable targets', () => {
  expect(
    runPython(
      [{ expression: call('AddDays', '"2020-01-01",1.0') }, { expression: call('ToTime', '12.0,0.0,1.0') }],
      python.code,
      { includeRuntime: false }
    )
  ).toEqual([{ value: '2020-01-02' }, { value: '12:00:01' }]);
  expect(String(ts.AddDays!(date('2020-01-01'), 1.0))).toBe('2020-01-02');
  expect(String(ts.ToTime!(12.0, 0.0, 1.0))).toBe('12:00:01');
});
