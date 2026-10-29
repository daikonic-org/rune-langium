// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { describe, expect, it } from 'vitest';
import { assertValidDocuments, BASICTYPES_ROSETTA, createRuneDslServices } from '@rune-langium/core';
import { Temporal } from '@js-temporal/polyfill';
import { URI } from 'langium';
import { generate } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { recordFunctionExports } from '../helpers/record-function-exports.js';

async function compile(source: string) {
  const { RuneDsl } = createRuneDslServices();
  const docs = [BASICTYPES_ROSETTA, source].map((text, index) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      text,
      URI.parse(`inmemory:///readability-${index}.rosetta`)
    )
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
  assertValidDocuments(docs);
  const outputs = await generate(docs, { target: 'typescript', typescript: { layout: 'single-file' } });
  expect(outputs.flatMap((output) => output.diagnostics.filter((item) => item.severity === 'error'))).toEqual([]);
  const model = outputs[0]!;
  return { funcs: recordFunctionExports(compileGeneratedTypeScript(outputs), outputs), model };
}

describe('readable generated expressions', () => {
  it('uses the native date comparator and retains null-safe keyed sorting without mutating inputs', async () => {
    const { funcs, model } = await compile(`namespace test.readableSort
type Entry:
 date date (0..1)
func Dates:
 inputs: dates date (0..*)
 output: result date (0..*)
 set result: dates sort
func Entries:
 inputs: entries Entry (0..*)
 output: result Entry (0..*)
 set result: entries sort [date]
`);
    const dates = [Temporal.PlainDate.from('2026-10-27'), Temporal.PlainDate.from('2026-01-01')];
    expect(funcs.Dates!({ dates })).toEqual([dates[1], dates[0]]);
    expect(dates.map(String)).toEqual(['2026-10-27', '2026-01-01']);
    const entries = [{}, { date: dates[0] }, { date: dates[1] }, {}];
    expect(funcs.Entries!({ entries })).toEqual([entries[2], entries[1], entries[0], entries[3]]);
    expect(funcs.Dates!({ dates: [] })).toEqual([]);
    expect(model.funcs.find((func) => func.name === 'Dates')!.fileContents).toContain(
      '.sort(Temporal.PlainDate.compare)'
    );
  });

  it('keeps optional ZonedDateTime conversion direct and omits constructor assertions only in the body view', async () => {
    const { funcs, model } = await compile(`namespace test.readableCalendar
type Result:
 date date (0..1)
func Read:
 inputs: value zonedDateTime (0..1)
 output: result Result (1..1)
 set result: Result { date: value -> date, ... }
`);
    expect(funcs.Read!({})).toEqual({ date: undefined });
    expect(
      String(
        (funcs.Read!({ value: Temporal.ZonedDateTime.from('2026-10-27T09:30[Europe/London]') }) as { date: unknown })
          .date
      )
    ).toBe('2026-10-27');
    const body = model.projections!.find((projection) => projection.kind === 'function')!.body!.code;
    expect(body).toContain('value?.toPlainDate()');
    expect(body).not.toMatch(/\bas RuneFuncData|\bsatisfies RuneFuncData|\(\(value:/);
    expect(model.funcs[0]!.fileContents).toContain('as RuneFuncData<ResultShape>');
  });

  it('lifts known collection fields without generic array or structural type wrappers', async () => {
    const { funcs, model } = await compile(`namespace test.readableReference
type Reference:
 href string (0..1)
type Exercise:
 notionalReference Reference (0..*)
func Read:
 inputs: exercise Exercise (0..1)
 output: result string (0..1)
 set result: exercise -> notionalReference -> href first
`);
    expect(funcs.Read!({})).toBeUndefined();
    expect(funcs.Read!({ exercise: { notionalReference: [{}, { href: 'a' }, { href: 'b' }] } })).toBe('a');
    const body = model.projections!.find((projection) => projection.kind === 'function')!.body!.code;
    expect(body).not.toContain('<const T>');
    expect(body).not.toContain("'href' in");
    expect(body).not.toContain('typeof');
  });
});
