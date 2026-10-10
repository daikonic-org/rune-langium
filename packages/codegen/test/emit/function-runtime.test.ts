// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { describe, expect, it } from 'vitest';
import { createRuneDslServices, assertValidDocuments, BASICTYPES_ROSETTA } from '@rune-langium/core';
import { URI } from 'langium';
import ts from 'typescript-classic';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Temporal } from '@js-temporal/polyfill';
import { generate } from '../../src/export.js';
import { mixedChoiceSource, mixedChoiceCases } from '../helpers/mixed-choice.js';

async function compile(
  source: string | string[],
  typeAssertions = '',
  checkLinks = false,
  onSource?: (source: string) => void
) {
  const { RuneDsl } = createRuneDslServices();
  const docs = (Array.isArray(source) ? source : [source]).map((content, index) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      content,
      URI.parse(`inmemory:///functions-${index}.rosetta`)
    )
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
  for (const doc of docs) expect(doc.parseResult.parserErrors).toEqual([]);
  if (checkLinks) assertValidDocuments(docs);
  const outputs = await generate(docs, { target: 'typescript', typescript: { layout: 'single-file' } });
  expect(outputs.flatMap((output) => output.diagnostics.filter((d) => d.severity === 'error'))).toEqual([]);
  const code = outputs[0]!.content;
  onSource?.(code);
  const fileName = resolve(import.meta.dirname, 'generated-function-runtime.ts');
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    skipLibCheck: true,
    types: []
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  host.readFile = (file) => (file === fileName ? code + '\n' + typeAssertions : readFile(file));
  const program = ts.createProgram([fileName], options, host);
  expect(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual(
    []
  );
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const exports: Record<string, (input: Record<string, unknown>) => unknown> = {};
  new Function('exports', 'require', js)(exports, createRequire(import.meta.url));
  return exports;
}

describe('generated TypeScript function execution', () => {
  it('uses Temporal values and equality in both functions and Data classes', async () => {
    const funcs = await compile(`namespace typed.calendar
recordType date { year int month int day int }
type Window:
 start date (1..1)
 end date (1..1)
 condition Same: start = end
func Same:
 inputs: left date (1..1) right date (1..1)
 output: result boolean (1..1)
 set result: left = right
`);
    expect(
      funcs.Same!({ left: Temporal.PlainDate.from('2026-10-10'), right: Temporal.PlainDate.from('2026-10-10') })
    ).toBe(true);
    expect(
      funcs.Same!({ left: Temporal.PlainDate.from('2026-10-10'), right: Temporal.PlainDate.from('2026-10-11') })
    ).toBe(false);
    const Window = funcs.Window as unknown as new (data: object) => {
      validateSame(): { valid: boolean; errors: string[] };
    };
    expect(
      new Window({
        start: Temporal.PlainDate.from('2026-10-10'),
        end: Temporal.PlainDate.from('2026-10-10')
      }).validateSame().valid
    ).toBe(true);
    expect(
      new Window({
        start: Temporal.PlainDate.from('2026-10-10'),
        end: Temporal.PlainDate.from('2026-10-11')
      }).validateSame().valid
    ).toBe(false);
  });
  it('keeps optional calendar navigation compilable in an absence-narrowed branch', async () => {
    const funcs = await compile([
      BASICTYPES_ROSETTA,
      `namespace test.optionalCalendar
func Read:
 inputs: value dateTime (0..1)
 output: result date (0..1)
 set result: if value exists then value -> date else value -> date
`
    ]);
    expect(funcs.Read!({})).toBeUndefined();
    expect(String(funcs.Read!({ value: Temporal.PlainDateTime.from('2026-10-10T12:30:00') }))).toBe('2026-10-10');
  });
  it('operates directly on validated JSON, preserving optional access and structural/collection equality', async () => {
    const declarations = new Map<string, string>();
    const funcs = await compile(
      `namespace test.validatedJson
enum Kind:
 A
 B
type Child:
 value int (1..1)
type Root:
 child Child (0..1)
func Read:
 inputs: source Root (1..1)
 output: result int (0..1)
 set result: source -> child -> value
func ReadDeep:
 inputs: source Root (1..1)
 output: result int (0..1)
 set result: source ->> value
func Equal:
 inputs: left Child (1..1) right Child (1..1)
 output: result boolean (1..1)
 set result: left -> value = right -> value
func OptionalEqual:
 inputs: left int (0..1) right int (0..1)
 output: result boolean (1..1)
 set result: left = right
func EnumEqual:
 inputs: left Kind (1..1) right Kind (1..1)
 output: result boolean (1..1)
 set result: left = right
func Echo:
 inputs: source Child (1..1)
 output: result Child (1..1)
 set result: source
func Forward:
 inputs: source Child (1..1)
 output: result Child (1..1)
 set result: Echo(source)
func SameObject:
 inputs: left Root (1..1) right Root (1..1)
 output: result boolean (1..1)
 set result: left = right
func SameList:
 inputs: left int (0..*) right int (0..*)
 output: result boolean (1..1)
 set result: left = right
func ComputedNaN:
 output: result boolean (1..1)
 set result: (0 / 0) = (0 / 0)
`,
      '',
      false,
      (source) => {
        const file = ts.createSourceFile('generated.ts', source, ts.ScriptTarget.ES2022, true);
        for (const statement of file.statements) {
          if (ts.isFunctionDeclaration(statement) && statement.name)
            declarations.set(statement.name.text, statement.getText(file));
        }
      }
    );
    for (const name of ['Read', 'ReadDeep', 'Equal', 'OptionalEqual', 'EnumEqual', 'Echo', 'Forward']) {
      const emitted = declarations.get(name)!;
      expect(emitted).not.toMatch(/input =|rune\.(single|list|equals|normalize\w*|get)\(/);
    }
    expect(declarations.get('Read')).toContain('input.source?.child?.value');
    expect(declarations.get('ReadDeep')).toContain('input.source?.child?.value');
    expect(declarations.get('Echo')).toContain('return input.source;');
    expect(declarations.get('Equal')).toContain('===');
    expect(declarations.get('SameObject')).toContain('rune.valueKey');
    expect(declarations.get('SameObject')).not.toContain('rune.equals');
    expect(declarations.get('SameList')).toContain('rune.equals');
    const child = Object.freeze({ value: 10 });
    expect(funcs.Read!({ source: { child } })).toBe(10);
    expect(funcs.Read!({ source: {} })).toBeUndefined();
    expect(funcs.ReadDeep!({ source: {} })).toBeUndefined();
    expect(funcs.Echo!(Object.freeze({ source: child }))).toBe(child);
    expect(funcs.Forward!({ source: child })).toBe(child);
    expect(funcs.Equal!({ left: child, right: { value: 10 } })).toBe(true);
    expect(funcs.Equal!({ left: child, right: { value: 11 } })).toBe(false);
    expect(funcs.OptionalEqual!({})).toBe(true);
    expect(funcs.OptionalEqual!({ left: 10 })).toBe(false);
    expect(funcs.EnumEqual!({ left: 'A', right: 'B' })).toBe(false);
    expect(funcs.SameObject!({ left: { child }, right: { child: { value: 10 } } })).toBe(true);
    expect(funcs.SameList!({ left: [1, 2], right: [2, 1] })).toBe(false);
    expect(funcs.SameList!({ left: [1, 2], right: [1, 2] })).toBe(true);
    expect(funcs.ComputedNaN!({})).toBe(true);
  });
  it('selects basic, calendar, enum and alias Choice arms while retaining enum-value switches', async () => {
    const funcs = await compile(
      [
        BASICTYPES_ROSETTA,
        `namespace test.switches
enum Kind:
 A
 B
typeAlias Text: string
type Payload:
 amount int (1..1)
typeAlias PayloadAlias: Payload
choice Value:
 number
 date
 Kind
 Text
 PayloadAlias
func Select:
 inputs: value Value (1..1)
 output: result int (1..1)
 set result: value switch number then 1, com.rosetta.model.date then 2, Kind then 3, test.switches.Text then 4, PayloadAlias then 5, default 0
func EnumValue:
 inputs: value Kind (1..1)
 output: result int (1..1)
 set result: value switch A then 1, B then 2, default 0
`
      ],
      '',
      true
    );
    expect(funcs.Select!({ value: { number: 42 } })).toBe(1);
    expect(funcs.Select!({ value: { date: Temporal.PlainDate.from('2026-09-12') } })).toBe(2);
    expect(funcs.Select!({ value: { kind: 'A' } })).toBe(3);
    expect(funcs.Select!({ value: { text: 'text' } })).toBe(4);
    expect(funcs.Select!({ value: { payloadAlias: { amount: 7 } } })).toBe(5);
    expect(funcs.EnumValue!({ value: 'A' })).toBe(1);
    expect(funcs.EnumValue!({ value: 'B' })).toBe(2);
  });

  it('links calendar constructors and preserves conversion types through navigation and comparisons', async () => {
    const funcs = await compile(
      [
        BASICTYPES_ROSETTA,
        `namespace test.conversion
func Day:
 inputs: value string (1..1)
 output: result date (0..1)
 set result: (value to-zoned-date-time) -> date
func Year:
 inputs: value string (1..1)
 output: result int (0..1)
 alias converted: value to-zoned-date-time
 set result: converted -> date -> year
func DateYear:
 inputs: value string (1..1)
 output: result int (0..1)
 set result: (value to-date then item) -> year
func Clock:
 inputs: value string (1..1)
 output: result time (0..1)
 set result: (value to-date-time) -> time
func ImplicitYear:
 inputs: value string (1..1) year int (0..1)
 output: result int (0..1)
 set result: value to-date then year
func Before:
 inputs: left string (1..1) right string (1..1)
 output: result boolean (1..1)
 alias start: left to-zoned-date-time
 set result: start < (right to-zoned-date-time)
func Make:
 inputs: day date (1..1)
 output: zonedDateTime zonedDateTime (0..1)
 set zonedDateTime: zonedDateTime {date: day, time: "12:30:00" to-time, timezone: "Z"}
`
      ],
      '',
      true
    );
    expect(String(funcs.Day!({ value: '2026-09-11T12:30:00Z' }))).toBe('2026-09-11');
    expect(String(funcs.Day!({ value: '2026-01-01T00:30:00+05:30' }))).toBe('2026-01-01');
    expect(funcs.Year!({ value: '2026-01-01T00:30:00+05:30' })).toBe(2026);
    expect(funcs.DateYear!({ value: '2026-09-11' })).toBe(2026);
    expect(funcs.ImplicitYear!({ value: '2026-09-11', year: 1900 })).toBe(2026);
    expect(String(funcs.Clock!({ value: '2026-09-11T12:30:00' }))).toBe('12:30:00');
    expect(funcs.Before!({ left: '2026-01-01T00:30:00+05:30', right: '2025-12-31T20:00:00Z' })).toBe(true);
    expect(String(funcs.Make!({ day: Temporal.PlainDate.from('2026-09-11') }))).toBe('2026-09-11T12:30:00+00:00[UTC]');
  });

  it('keeps constructor fields ahead of metadata keywords and converts scalar fields to lists', async () => {
    const funcs = await compile(`namespace test.address
annotation metadata:
 address string (0..1)
type Address:
 country string (1..1)
type Contact:
 address Address (0..*)
func Build:
 output: result Contact (1..1)
 set result: Contact {address: Address {country: "US"}}
`);
    expect(funcs.Build!({})).toEqual({ address: [{ country: 'US' }] });
  });

  it('selects nested Choice paths through reference metadata', async () => {
    const funcs = await compile(`namespace test.paths
type Basket:
 amount int (1..1)
type Cash:
 currency string (1..1)
choice Observable:
 Basket
 Cash
choice Underlier:
 Observable
  [metadata reference]
func Amount:
 inputs: underlier Underlier (1..1)
 output: result int (0..1)
 set result: (underlier as Basket) -> amount
`);
    expect(funcs.Amount!({ underlier: { observable: { value: { basket: { amount: 7 } } } } })).toBe(7);
    expect(funcs.Amount!({ underlier: { observable: { externalReference: 'unresolved' } } })).toBeUndefined();
    expect(funcs.Amount!({ underlier: { observable: { value: { cash: { currency: 'USD' } } } } })).toBeUndefined();
  });

  it('uses the declared Choice arm ahead of same-named imported aliases', async () => {
    const funcs = await compile([
      `namespace test.aliases
typeAlias Rate: string`,
      `namespace test.rates
import test.aliases.*
type Rate:
 amount int (1..1)
type Fixed:
 amount int (1..1)
choice Index:
 Rate
 Fixed
func Amount:
 inputs: index Index (1..1)
 output: result int (1..1)
 set result: index switch Rate then amount, default 0
`
    ]);
    expect(funcs.Amount!({ index: { rate: { amount: 7 } } })).toBe(7);
    expect(funcs.Amount!({ index: { fixed: { amount: 2 } } })).toBe(0);
  });

  it('checks required constructor fields read through implicit collection lookups', async () => {
    const funcs = await compile(`namespace test.constructedBounds
type Entry:
 amount int (1..1)
type Result:
 amount int (1..1)
func Map:
 inputs: entries Entry (0..*)
 output: result Result (0..*)
 set result: entries extract Result { amount: amount }
`);
    expect(funcs.Map!({ entries: [{ amount: 2 }] })).toEqual([{ amount: 2 }]);
    expect(() => funcs.Map!({ entries: [{}] })).toThrow("Argument 'amount' requires a value");
  });

  it('retains element types through nested collection projections', async () => {
    const funcs = await compile(`namespace test.nested
type Link:
 value string (1..1)
 scheme string (1..1)
type Party:
 links Link (0..*)
type Identifier:
 value string (1..1)
  [metadata scheme]
func Map:
 inputs: parties Party (0..*)
 output: result Identifier (0..*)
 set result: parties extract links extract Identifier {value: value with-meta {scheme: scheme}}
`);
    expect(funcs.Map!({ parties: [{ links: [{ value: 'id', scheme: 'uri' }] }, {}] })).toEqual([
      { value: { value: 'id', meta: { scheme: 'uri' } } }
    ]);
  });

  it('propagates empty arithmetic and orders absent sort keys consistently', async () => {
    const funcs = await compile(`namespace test.operators
type Entry:
 key int (0..1)
func Add:
 inputs: a int (0..*) b int (0..1)
 output: result int (0..1)
 set result: a + b
func Ordered:
 inputs: entries Entry (0..*)
 output: result Entry (0..*)
 set result: entries sort [key]
func Minimum:
 inputs: entries Entry (0..*)
 output: result Entry (0..1)
 set result: entries min [key]
func Maximum:
 inputs: entries Entry (0..*)
 output: result Entry (0..1)
 set result: entries max [key]
`);
    expect(funcs.Add!({ a: [2], b: 3 })).toBe(5);
    expect(funcs.Add!({ a: [2, 4], b: 3 })).toBeUndefined();
    expect(funcs.Add!({ a: [], b: 3 })).toBeUndefined();
    const entries = [{}, { key: 3 }, { key: 1 }];
    expect(funcs.Ordered!({ entries })).toEqual([{ key: 1 }, { key: 3 }, {}]);
    expect(funcs.Minimum!({ entries })).toEqual({ key: 1 });
    expect(funcs.Maximum!({ entries })).toEqual({ key: 3 });
  });

  it('emits inherited enums, narrowed fields, and base classes before derived classes', async () => {
    const funcs = await compile(
      `namespace test.declarations
enum BaseKind:
 Cash
enum Kind extends BaseKind:
 Credit
type Child extends Parent:
 excluded int (0..0)
type Parent:
 excluded int (0..*)
 bounded int (0..2)
func Parse:
 inputs: text string (0..1)
 output: result Kind (0..1)
 set result: text to-enum Kind
`,
      `const child: ChildShape = {};
// @ts-expect-error zero cardinality excludes populated fields
const invalid: ChildShape = {excluded: [1]};`
    );
    expect(funcs.Parse!({ text: 'Cash' })).toBe('Cash');
    expect(funcs.Parse!({ text: 'Credit' })).toBe('Credit');
    expect(funcs.Parse!({ text: 'Other' })).toBeUndefined();
    expect(Reflect.construct(funcs.Child!, [{}])).toBeInstanceOf(funcs.Parent!);
  });

  it('allocates distinct type and function exports without losing calls', async () => {
    const funcs = await compile(`namespace test.names
type Value:
 amount int (1..1)
func Value:
 output: result int (1..1)
 set result: 7
func ValueFunction:
 output: result int (1..1)
 set result: 3
func Read:
 output: result int (1..1)
 set result: Value() + ValueFunction()
`);
    expect(funcs.Read!({})).toBe(10);
    expect(funcs.ValueFunction1!({})).toBe(7);
    expect(Reflect.construct(funcs.Value!, [{ amount: 2 }])).toHaveProperty('amount', 2);
  });

  it('constructs reference-only metadata from empty without inventing payloads', async () => {
    const funcs = await compile(`namespace test.referenceOnly
type Target:
 name string (1..1)
func Reference:
 inputs: id string (1..1)
 output: result Target (0..1)
  [metadata reference]
 set result: empty with-meta {reference: id}
`);
    expect(funcs.Reference!({ id: 'party-1' })).toEqual({ value: undefined, externalReference: 'party-1' });
  });

  it('resolves explicit calls despite enum members with the same name', async () => {
    const funcs = await compile(`namespace test.calls
 enum Operation:
  Min
 library function Min(x number, y number) number
 func Pick:
  inputs: a number (1..1) b number (1..1)
  output: result number (1..1)
  set result: Min(a, b)
`);
    expect(funcs.Pick!({ a: 7, b: 3 })).toBe(3);
  });

  it('flattens extracted collections and enforces scalar assignment bounds', async () => {
    const funcs = await compile(`namespace test.collection
 type Box:
  values int (0..*)
 func Extract:
  inputs: boxes Box (0..*)
  output: result int (0..*)
  set result: boxes extract values
 func Single:
  inputs: values int (0..*)
  output: result int (0..1)
  set result: values
 func Combine:
  inputs: a int (0..*) b int (0..*)
  output: result int (0..*)
  set result: [a, b]
`);
    expect(funcs.Extract!({ boxes: [{ values: [1, 2] }, {}, { values: [3] }] })).toEqual([1, 2, 3]);
    expect(funcs.Single!({ values: [] })).toBeUndefined();
    expect(funcs.Single!({ values: [7] })).toBe(7);
    expect(() => funcs.Single!({ values: [1, 2] })).toThrow('Expected at most one value');
    expect(funcs.Combine!({ a: [1, 2], b: [3] })).toEqual([1, 2, 3]);
  });

  it('reads and constructs typed calendar records without converting model values at calls', async () => {
    const funcs = await compile(`namespace test.calendar
 recordType date { day int month int year int }
 recordType dateTime { date date time time }
 recordType zonedDateTime { date date time time timezone string }
 func Year:
  inputs: value date (0..1)
  output: result int (0..1)
  set result: value -> year
 func MakeDate:
  inputs: year int (1..1) month int (1..1) day int (1..1)
  output: date date (0..1)
  set date: date { year: year, month: month, day: day }
 func Zoned:
  inputs: day date (1..1) clock time (1..1) zone string (1..1)
  output: zonedDateTime zonedDateTime (0..1)
  set zonedDateTime: zonedDateTime {date: day, time: clock, timezone: zone}
 func Day:
  inputs: value zonedDateTime (0..1)
  output: result date (0..1)
  set result: value -> date
 type Event:
  eventDate date (1..1)
  condition Current: Year(eventDate) = 2026
`);
    expect(funcs.Year!({ value: Temporal.PlainDate.from('2024-02-29') })).toBe(2024);
    expect(funcs.Year!({})).toBeUndefined();
    expect(String(funcs.MakeDate!({ year: 2024, month: 2, day: 29 }))).toBe('2024-02-29');
    expect(() => funcs.MakeDate!({ year: 2023, month: 2, day: 29 })).toThrow();
    const zoned = funcs.Zoned!({
      day: Temporal.PlainDate.from('2026-07-01'),
      clock: Temporal.PlainTime.from('12:00:00'),
      zone: 'America/New_York'
    });
    expect(String(zoned)).toBe('2026-07-01T12:00:00-04:00[America/New_York]');
    expect(String(funcs.Day!({ value: zoned }))).toBe('2026-07-01');
    const event = Reflect.construct(funcs.Event!, [{ eventDate: Temporal.PlainDate.from('2026-01-01') }]);
    expect(event.validateCurrent().valid).toBe(true);
  });

  it('reads and compares offset-only zoned inputs without losing their local calendar', async () => {
    const funcs = await compile(`namespace test.offset
recordType date { year int month int day int }
recordType zonedDateTime { date date time time timezone string }
func Day:
 inputs: value zonedDateTime (0..1)
 output: result date (0..1)
 set result: value -> date
func Year:
 inputs: value zonedDateTime (0..1)
 output: result int (0..1)
 set result: value -> date -> year
func Clock:
 inputs: value zonedDateTime (0..1)
 output: result time (0..1)
 set result: value -> time
func Zone:
 inputs: value zonedDateTime (0..1)
 output: result string (0..1)
 set result: value -> timezone
func Before:
 inputs: left zonedDateTime (1..1) right zonedDateTime (1..1)
 output: result boolean (1..1)
 set result: left < right
func Parse:
 inputs: value string (1..1)
 output: result zonedDateTime (0..1)
 set result: value to-zoned-date-time
`);
    for (const [value, date, time, zone] of [
      ['2026-09-11T12:30:00Z', '2026-09-11', '12:30:00', 'UTC'],
      ['2026-01-01T00:30:00.123+05:30', '2026-01-01', '00:30:00.123', '+05:30'],
      ['2026-12-31T23:30:00-04:00', '2026-12-31', '23:30:00', '-04:00'],
      ['2026-07-01T12:00:00-04:00[America/New_York]', '2026-07-01', '12:00:00', 'America/New_York']
    ]) {
      const temporal = funcs.Parse!({ value });
      expect(String(funcs.Day!({ value: temporal }))).toBe(date);
      expect(funcs.Year!({ value: temporal })).toBe(2026);
      expect(String(funcs.Clock!({ value: temporal }))).toBe(time);
      expect(funcs.Zone!({ value: temporal })).toBe(zone);
      expect(String(funcs.Day!({ value: funcs.Parse!({ value }) }))).toBe(date);
    }
    expect(funcs.Day!({})).toBeUndefined();
    expect(() => funcs.Parse!({ value: '2026-02-30T12:00:00Z' })).toThrow();
    expect(
      funcs.Before!({
        left: funcs.Parse!({ value: '2026-01-01T00:30:00+05:30' }),
        right: funcs.Parse!({ value: '2025-12-31T20:00:00Z' })
      })
    ).toBe(true);
    expect(
      funcs.Before!({
        left: funcs.Parse!({ value: '2026-01-01T00:30:00+05:30' }),
        right: funcs.Parse!({ value: '2025-12-31T19:00:00Z' })
      })
    ).toBe(false);
  });

  it('compares implicit temporal pipeline operands chronologically', async () => {
    const funcs = await compile(
      [
        BASICTYPES_ROSETTA,
        `namespace test.pipeline
func AllBefore:
 inputs: values zonedDateTime (0..*) cutoff zonedDateTime (1..1)
 output: result boolean (1..1)
 set result: values then all < cutoff
func AnyAfter:
 inputs: values zonedDateTime (0..*) cutoff zonedDateTime (1..1)
 output: result boolean (1..1)
 set result: values then any > cutoff
`
      ],
      '',
      true
    );
    const values = [Temporal.ZonedDateTime.from('2026-01-01T00:30:00+05:30[+05:30]')];
    expect(funcs.AllBefore!({ values, cutoff: Temporal.ZonedDateTime.from('2025-12-31T20:00:00Z' + '[UTC]') })).toBe(
      true
    );
    expect(funcs.AllBefore!({ values, cutoff: Temporal.ZonedDateTime.from('2025-12-31T19:00:00Z' + '[UTC]') })).toBe(
      false
    );
    expect(funcs.AnyAfter!({ values, cutoff: Temporal.ZonedDateTime.from('2025-12-31T18:00:00Z' + '[UTC]') })).toBe(
      true
    );
    expect(funcs.AnyAfter!({ values, cutoff: Temporal.ZonedDateTime.from('2025-12-31T20:00:00Z' + '[UTC]') })).toBe(
      false
    );
  });

  it('narrows optional values and unwraps metadata collections in validators', async () => {
    const funcs = await compile(`namespace test.validator
type Values:
 values int (0..*)
  [metadata scheme]
 limit int (0..1)
 condition One: values count = 1
 condition Limit: if limit exists then limit <= 10
`);
    const present = Reflect.construct(funcs.Values!, [{ values: [{ value: 7, meta: {} }], limit: 8 }]);
    expect(present.validateOne().valid).toBe(true);
    expect(present.validateLimit().valid).toBe(true);
    const absent = Reflect.construct(funcs.Values!, [{}]);
    expect(absent.validateOne().valid).toBe(false);
    expect(absent.validateLimit().valid).toBe(true);
  });

  it('normalizes empty scalar branches and preserves enum types in constructors', async () => {
    const funcs = await compile(`namespace test.scalar
enum Currency:
 USD
 EUR
type Amount:
 currency Currency (1..1)
func Build:
 output: result Amount (1..1)
 set result: Amount {currency: Currency -> USD}
func Optional:
 inputs: value int (1..1)
 output: result int (0..1)
 set result: if value > 0 then value else empty
`);
    expect(funcs.Build!({})).toEqual({ currency: 'USD' });
    expect(funcs.Optional!({ value: 2 })).toBe(2);
    expect(funcs.Optional!({ value: -2 })).toBeUndefined();
  });
  it('retains metadata when narrowing data subtypes', async () => {
    const funcs = await compile(`namespace test.dataMetaNarrow
 type Base:
  name string (1..1)
 type Loan extends Base:
  amount int (1..1)
 func Pick:
  inputs: value Base (1..1)
   [metadata scheme]
  output: result Loan (0..1)
   [metadata scheme]
  set result: value as Loan
 func Plain:
  inputs: value Base (1..1)
   [metadata scheme]
  output: result int (0..1)
  set result: value as Loan -> amount
`);
    const value = { value: { name: 'L', amount: 7 }, meta: { scheme: 'urn:loan' } };
    expect(funcs.Pick!({ value })).toEqual(value);
    expect(funcs.Plain!({ value })).toBe(7);
    expect(funcs.Pick!({ value: { value: { name: 'B' }, meta: {} } })).toBeUndefined();
  });
  it('preserves selected choice metadata in scalar, collection, and headless narrowing', async () => {
    const funcs = await compile(`namespace test.metaNarrow
 typeAlias Code: string
 typeAlias Other: string
 choice Codes:
  Code
   [metadata scheme]
  Other
 func Pick:
  inputs: value Codes (1..1)
  output: result Code (0..1)
   [metadata scheme]
  set result: value as Code
 func Plain:
  inputs: value Codes (1..1)
  output: result Code (0..1)
  set result: value as Code
 func Many:
  inputs: values Codes (0..*)
  output: result Code (0..*)
   [metadata scheme]
  set result: values as Code
 func Pipe:
  inputs: value Codes (1..1)
   [metadata scheme]
  output: result Code (0..1)
   [metadata scheme]
  set result: value then as Code
`);
    const code = { value: 'A', meta: { scheme: 'urn:code' } };
    const value = { code };
    expect(funcs.Pick!({ value })).toEqual(code);
    expect(funcs.Plain!({ value })).toBe('A');
    expect(funcs.Many!({ values: [value, { other: 'B' }] })).toEqual([code]);
    expect(funcs.Pipe!({ value: { value, meta: { scheme: 'urn:outer' } } })).toEqual(code);
  });

  it('normalizes each matching Choice path before combining mixed metadata selections', async () => {
    const funcs = await compile(`${mixedChoiceSource}
func Pick:
 inputs: value Outer (0..1)
 output: result Payload (0..1)
  [metadata reference]
 set result: value as Payload
func Plain:
 inputs: value Outer (0..1)
 output: result Payload (0..1)
 set result: value as Payload
func Many:
 inputs: values Outer (0..*)
 output: result Payload (0..*)
  [metadata reference]
 set result: values as Payload
func Pipe:
 inputs: value Outer (0..1)
 output: result Payload (0..1)
 set result: value then as Payload
func Read:
 inputs: value Outer (0..1)
 output: result int (0..1)
 set result: (value as Payload) -> amount
func SwitchPlain:
 inputs: value Outer (0..1)
 output: result Payload (0..1)
 set result: value switch Payload then item, default empty
func SwitchPick:
 inputs: value Outer (0..1)
 output: result Payload (0..1)
  [metadata reference]
 set result: value switch Payload then item, default empty
`);
    for (const { input, wrapped } of mixedChoiceCases) {
      expect(funcs.Pick!({ value: input })).toEqual(wrapped);
      expect(funcs.SwitchPick!({ value: input })).toEqual(wrapped);
      expect(funcs.Plain!({ value: input })).toEqual(wrapped.value);
      expect(funcs.SwitchPlain!({ value: input })).toEqual(wrapped.value);
      expect(funcs.Pipe!({ value: input })).toEqual(wrapped.value);
      expect(funcs.Read!({ value: input })).toEqual(wrapped.value?.amount);
    }
    expect(funcs.Many!({ values: mixedChoiceCases.map(({ input }) => input) })).toEqual(
      mixedChoiceCases.map(({ wrapped }) => wrapped)
    );
    for (const value of [
      undefined,
      { other: { string: 'unmatched' } },
      { wrapped: { externalReference: 'missing intermediate' } }
    ]) {
      expect(funcs.Pick!({ value })).toBeUndefined();
      expect(funcs.SwitchPick!({ value })).toBeUndefined();
    }
  });

  it('combines raw and field-only Choice paths without reading payload value fields as metadata', async () => {
    const funcs = await compile(`${mixedChoiceSource.replace('\n Referenced\n', '\n')}
func Plain:
 inputs: value Outer (0..1)
 output: result Payload (0..1)
 set result: value as Payload
func Pick:
 inputs: value Outer (0..1)
 output: result Payload (0..1)
  [metadata scheme]
 set result: value as Payload
`);
    for (const { input, wrapped } of mixedChoiceCases.slice(0, 2)) {
      expect(funcs.Plain!({ value: input })).toEqual(wrapped.value);
      expect(funcs.Pick!({ value: input })).toEqual({ value: wrapped.value, meta: wrapped.meta ?? {} });
    }
    expect(funcs.Pick!({})).toBeUndefined();
  });

  it('narrows nested choice arms with as, filters collections, and preserves pipeline inputs', async () => {
    const funcs = await compile(`namespace test.narrow
 type Loan:
  amount int (1..1)
 type Bond:
  coupon int (1..1)
 choice Inner:
  Loan
  Bond
 choice Outer:
  Inner
  Bond
 func Pick:
  inputs: value Outer (0..1)
  output: result int (0..1)
  set result: value as Loan -> amount
 func Total:
  inputs: values Outer (0..*)
  output: result int (1..1)
  set result: values as Loan -> amount sum
 func Pipe:
  inputs: value Outer (1..1)
  output: result int (0..1)
  set result: value then as Loan -> amount
 func Pass:
  inputs: value Outer (1..1)
  output: result int (0..1)
  set result: Pick(value)
`);
    const loan = { inner: { loan: { amount: 7 } } };
    const bond = { bond: { coupon: 3 } };
    expect(funcs.Pick!({ value: loan })).toBe(7);
    expect(funcs.Pick!({ value: bond })).toBeUndefined();
    expect(funcs.Pick!({})).toBeUndefined();
    expect(funcs.Total!({ values: [loan, bond, loan] })).toBe(14);
    expect(funcs.Total!({ values: [] })).toBe(0);
    expect(funcs.Pipe!({ value: loan })).toBe(7);
    expect(funcs.Pass!({ value: loan })).toBe(7);
  });

  it('keeps same-base aliases distinct when narrowing a choice', async () => {
    const funcs = await compile(`namespace test.aliasNarrow
 typeAlias CodeA: string
 typeAlias CodeB: string
 choice Codes:
  CodeA
  CodeB
 func Pick:
  inputs: value Codes (1..1)
  output: result string (0..1)
  set result: value as CodeB
`);
    expect(funcs.Pick!({ value: { codeB: 'B' } })).toBe('B');
    expect(funcs.Pick!({ value: { codeA: 'A' } })).toBeUndefined();
  });

  it('narrows data subtypes and leaves unmatched values absent', async () => {
    const funcs = await compile(`namespace test.dataNarrow
 type Base:
  name string (1..1)
 type Loan extends Base:
  amount int (1..1)
 type Bond extends Base:
  coupon int (1..1)
 func Pick:
  inputs: value Base (1..1)
  output: result int (0..1)
  set result: value as Loan -> amount
`);
    expect(funcs.Pick!({ value: { name: 'L', amount: 7 } })).toBe(7);
    expect(funcs.Pick!({ value: { name: 'B', coupon: 3 } })).toBeUndefined();
  });

  it.each(
    ['', 'scheme', 'reference'].flatMap((annotation) =>
      (
        [
          [1, 2],
          [0, 2],
          [2, null],
          [1, 1],
          [0, 1],
          [0, 0]
        ] as const
      ).map(([lower, upper]) => ({ annotation, lower, upper }))
    )
  )(
    'trusts validated inputs and checks computed arguments lower=$lower upper=$upper ($annotation)',
    async ({ annotation, lower, upper }) => {
      const many = upper === null || upper > 1;
      const funcs = await compile(`namespace test.inputBounds
func Bounded:
 inputs: values int (${lower}..${upper ?? '*'})
 ${annotation ? `[metadata ${annotation}]` : ''}
 output: result int (1..1)
 set result: 42
func Call:
 inputs: values int (0..${many ? '*' : '1'})
 ${annotation ? `[metadata ${annotation}]` : ''}
 output: result int (1..1)
 set result: Bounded(values${many ? ' filter [item = 1]' : ''})`);
      const wrap = (value: number) =>
        annotation === 'scheme' ? { value, meta: {} } : annotation === 'reference' ? { value } : value;
      for (const name of ['Bounded', 'Call']) {
        const fn = funcs[name]!;
        if (upper === 0) {
          expect(fn({})).toBe(42);
          if (name === 'Call') expect(() => fn({ values: wrap(1) })).toThrow();
          continue;
        }
        const values = many ? Array(Math.max(lower, 1)).fill(1).map(wrap) : wrap(1);
        const input = Object.freeze({ values });
        expect(fn(input)).toBe(42);
        expect(input.values).toBe(values);
        if (lower > 0 && name === 'Call') {
          expect(() => fn({})).toThrow();
          if (many)
            expect(() =>
              fn({
                values: Array(lower - 1)
                  .fill(1)
                  .map(wrap)
              })
            ).toThrow();
        } else if (lower === 0) expect(fn({})).toBe(42);
        if (many && upper !== null && name === 'Call')
          expect(() =>
            fn({
              values: Array(upper + 1)
                .fill(1)
                .map(wrap)
            })
          ).toThrow();
      }
      if (many && lower > 0) expect(() => funcs.Call!({ values: [wrap(-1), wrap(-2)] })).toThrow();
    }
  );

  it.each(
    ['', 'scheme', 'reference'].flatMap((annotation) =>
      [
        [1, 2],
        [2, 3],
        [0, 2],
        [2, null],
        [1, 1],
        [0, 1],
        [0, 0]
      ].map(([lower, upper]) => ({ annotation, lower: lower!, upper }))
    )
  )('checks nested assignment bounds lower=$lower upper=$upper ($annotation)', async ({ annotation, lower, upper }) => {
    const many = upper === null || upper! > 1;
    const funcs = await compile(`namespace test.nestedBounds
type Result:
 values int (${lower}..${upper ?? '*'})
 ${annotation ? `[metadata ${annotation}]` : ''}
func SetValues:
 inputs: values int (0..${many ? '*' : '1'})
 output: result Result (1..1)
 set result -> values: values
${
  many
    ? `func AppendValues:
 inputs:
  initial Result (1..1)
  values int (0..*)
 output: result Result (1..1)
 set result: initial
 add result -> values: values`
    : ''
}`);
    const wrap = (value: number) =>
      annotation === 'scheme' ? { value, meta: {} } : annotation === 'reference' ? { value } : value;
    if (upper === 0) {
      expect(funcs.SetValues!({})).toEqual({ values: undefined });
      expect(() => funcs.SetValues!({ values: 1 })).toThrow();
      return;
    }
    const values = many ? Array.from({ length: Math.max(lower, 1) }, (_, i) => i + 1) : 1;
    expect(funcs.SetValues!({ values })).toEqual({ values: Array.isArray(values) ? values.map(wrap) : wrap(values) });
    if (lower > 0) {
      expect(() => funcs.SetValues!({})).toThrow();
      if (many) expect(() => funcs.SetValues!({ values: Array(lower - 1).fill(1) })).toThrow();
    } else expect(funcs.SetValues!({})).toEqual({ values: many ? [] : undefined });
    if (many) {
      const initial = { values: Array(Math.max(lower, 1)).fill(1).map(wrap) };
      expect(funcs.AppendValues!({ initial, values: [2] })).toEqual({
        values: [...Array(Math.max(lower, 1)).fill(1).map(wrap), wrap(2)]
      });
      if (upper !== null) {
        expect(() => funcs.SetValues!({ values: Array(upper! + 1).fill(1) })).toThrow();
        const full = { values: Array(upper).fill(1).map(wrap) };
        expect(() => funcs.AppendValues!({ initial: full, values: [2] })).toThrow();
        expect(full.values).toHaveLength(upper!);
      }
    }
  });

  it.each([
    ['date', '2026-09-11', 'to-date'],
    ['time', '12:30:00', 'to-time'],
    ['dateTime', '2026-09-11T12:30:00', 'to-date-time'],
    ['zonedDateTime', '2026-09-11T12:30:00Z', 'to-zoned-date-time']
  ])('uses typed Temporal values for %s fields in function data', async (type, value, conversion) => {
    const funcs = await compile(
      `namespace test.temporalWire
type Event:
 eventDate ${type} (0..1)
type Envelope:
 events Event (0..*)
func Create:
 inputs: text string (1..1)
 output: result Envelope (1..1)
 set result: Envelope {events: [Event {eventDate: text ${conversion}}]}
func Retain:
 inputs: value Envelope (1..1)
 output: result Envelope (1..1)
 set result: value`,
      `const input: Parameters<typeof Retain>[0] = {value: {events: [{eventDate: {} as Temporal.${type === 'date' ? 'PlainDate' : type === 'time' ? 'PlainTime' : type === 'dateTime' ? 'PlainDateTime' : 'ZonedDateTime'}}]}};
// @ts-expect-error ISO strings belong at the JSON boundary.
const invalid: Parameters<typeof Retain>[0] = {value: {events: [{eventDate: ${JSON.stringify(value)}}]}};`
    );
    const created = funcs.Create!({ text: value }) as { events: { eventDate: unknown }[] };
    expect(Object.prototype.toString.call(created.events[0]!.eventDate)).toContain('Temporal.');
    const expected = type === 'zonedDateTime' ? value.replace('Z', '+00:00[UTC]') : value;
    expect(String(created.events[0]!.eventDate)).toBe(expected);
    expect(funcs.Retain!({ value: created })).toBe(created);
  });

  it.each([
    'parents filter [item -> active]',
    'parents sort [item -> detail -> value]',
    'parents extract [item]',
    'parents extract',
    'parents then filter [item -> active]',
    '(parents extract [[item]]) flatten',
    'parents then',
    'parents reverse',
    'parents distinct'
  ])('navigates deeply through %s', async (operation) => {
    const funcs = await compile(`namespace test.collectionNavigation
type Detail:
 value int (1..1)
type Parent:
 active boolean (1..1)
 detail Detail (1..1)
func Read:
 inputs: parents Parent (0..*)
 output: result int (0..*)
 set result: (${operation}) ->> value`);
    const parents = [
      { active: true, detail: { value: 2 } },
      { active: false, detail: { value: 1 } }
    ];
    const expected = operation.includes('filter')
      ? [2]
      : operation.includes('sort') || operation.includes('reverse')
        ? [1, 2]
        : [2, 1];
    expect(funcs.Read!({ parents })).toEqual(expected);
    expect(funcs.Read!({ parents: [] })).toEqual([]);
  });

  it.each(['reference', 'address', 'scheme'])('projects %s metadata over collection receivers', async (key) => {
    const funcs = await compile(`namespace test.metadataNavigation
annotation metadata:
 reference string (0..1)
 address string (0..1)
 scheme string (0..1)
type Thing:
 value int (1..1)
func Read:
 inputs: values Thing (0..*)
  [metadata ${key}]
 output: result string (0..*)
 set result: values -> ${key}
func Scalar:
 inputs: value Thing (0..1)
  [metadata ${key}]
 output: result string (0..1)
 set result: value -> ${key}`);
    const wrap = (text: string) =>
      key === 'reference'
        ? { externalReference: text }
        : key === 'address'
          ? { reference: { reference: text } }
          : { value: { value: 1 }, meta: { scheme: text } };
    const empty = key === 'scheme' ? { value: { value: 2 }, meta: {} } : {};
    expect(funcs.Read!({ values: [wrap('a'), empty, wrap('b')] })).toEqual(['a', 'b']);
    expect(funcs.Read!({ values: [] })).toEqual([]);
    expect(funcs.Scalar!({ value: wrap('a') })).toBe('a');
    expect(funcs.Scalar!({})).toBeUndefined();
  });

  it.each(['', 'scheme', 'reference'])('enforces zero output cardinality (metadata=%s)', async (annotation) => {
    const metadata = annotation ? `[metadata ${annotation}]` : '';
    const funcs = await compile(`namespace test.zeroOutput
func NoResult:
 inputs: value int (0..1)
  ${metadata}
 output: result int (0..0)
  ${metadata}
 set result: value
func Empty:
 output: result int (0..0)
  ${metadata}
 set result: empty`);
    expect(funcs.NoResult!({})).toBeUndefined();
    expect(funcs.Empty!({})).toBeUndefined();
    for (const value of [0, 4]) {
      const input =
        annotation === 'scheme'
          ? { value, meta: { scheme: 'unit' } }
          : annotation === 'reference'
            ? { value, externalReference: 'id' }
            : value;
      expect(() => funcs.NoResult!({ value: input })).toThrow('too many results');
    }
  });

  it('navigates deeply through Data and Choice switch results', async () => {
    const funcs = await compile(`namespace test.switchResults
type Detail:
 amount int (1..1)
type Cash:
 detail Detail (1..1)
type Credit:
 fee int (1..1)
choice Box:
 Cash
 Credit
func Selected:
 inputs: box Box (1..1)
 output: result int (0..1)
 set result: (box switch Cash then item, default Cash {detail: Detail {amount: 0}}) ->> amount
func Converted:
 inputs: box Box (1..1)
 output: result int (0..1)
 set result: (box switch Cash then Detail {amount: 8}, default Detail {amount: 3}) ->> amount
func ChoiceResult:
 inputs: box Box (1..1)
 output: result int (0..1)
 set result: (box switch Cash then Box {Cash: item}, default Box {Cash: Cash {detail: Detail {amount: 5}}}) ->> amount`);
    const cash = { cash: { detail: { amount: 7 } } };
    const credit = { credit: { fee: 2 } };
    expect(funcs.Selected!({ box: cash })).toBe(7);
    expect(funcs.Selected!({ box: credit })).toBe(0);
    expect(funcs.Converted!({ box: cash })).toBe(8);
    expect(funcs.Converted!({ box: credit })).toBe(3);
    expect(funcs.ChoiceResult!({ box: cash })).toBe(7);
    expect(funcs.ChoiceResult!({ box: credit })).toBe(5);
  });

  it.each(['', 'scheme', 'reference'])(
    'navigates deeply through default receivers (metadata=%s)',
    async (annotation) => {
      const metadata = annotation ? `[metadata ${annotation}]` : '';
      const funcs = await compile(`namespace test.deepDefault
type Detail:
 amount int (1..1)
type Entry:
 detail Detail (1..1)
func Many:
 inputs:
  primary Entry (0..*)
   ${metadata}
  fallback Entry (0..*)
   ${metadata}
 output: result int (0..*)
 set result: (primary default fallback) ->> amount
func Scalar:
 inputs:
  primary Entry (0..1)
   ${metadata}
  fallback Entry (0..1)
   ${metadata}
 output: result int (0..1)
 set result: (primary default fallback) ->> amount`);
      const wrap = (amount: number) => {
        const value = { detail: { amount } };
        return annotation === 'scheme'
          ? { value, meta: { scheme: 'unit' } }
          : annotation === 'reference'
            ? { value, externalReference: 'id' }
            : value;
      };
      expect(funcs.Many!({ primary: [wrap(1), wrap(2)], fallback: [wrap(3)] })).toEqual([1, 2]);
      expect(funcs.Many!({ primary: [], fallback: [wrap(3)] })).toEqual([3]);
      expect(funcs.Many!({ primary: [], fallback: [] })).toEqual([]);
      expect(funcs.Scalar!({ primary: wrap(1), fallback: wrap(2) })).toBe(1);
      expect(funcs.Scalar!({ fallback: wrap(2) })).toBe(2);
      expect(funcs.Scalar!({})).toBeUndefined();
    }
  );

  it.each(
    ['scheme', 'reference'].flatMap((annotation) =>
      ['extract', 'then', 'reduce'].map((operation) => ({ annotation, operation }))
    )
  )('retains $annotation metadata in identity $operation', async ({ annotation, operation }) => {
    const funcs = await compile(`namespace test.identityExtract
func Retain:
 inputs: values int (0..*)
  [metadata ${annotation}]
 output: result int (0..*)
  [metadata ${annotation}]
 set result: values ${operation}
func Raw:
 inputs: values int (0..*)
  [metadata ${annotation}]
 output: result int (0..*)
 set result: values ${operation}
${
  operation === 'then'
    ? `func Scalar:
 inputs: value int (0..1)
  [metadata ${annotation}]
 output: result int (0..1)
  [metadata ${annotation}]
 set result: value then
func RawScalar:
 inputs: value int (0..1)
  [metadata ${annotation}]
 output: result int (0..1)
 set result: value then`
    : ''
}`);
    const item =
      annotation === 'scheme' ? { value: 4, meta: { scheme: 'unit' } } : { value: 4, externalReference: 'id' };
    const retained = funcs.Retain!({ values: [item] });
    expect(retained).toEqual([item]);
    expect((retained as unknown[])[0]).toBe(item);
    expect(funcs.Raw!({ values: [item] })).toEqual([4]);
    expect(funcs.Retain!({ values: [] })).toEqual([]);
    expect(funcs.Raw!({ values: [] })).toEqual([]);
    if (operation === 'then') {
      expect(funcs.Scalar!({ value: item })).toBe(item);
      expect(funcs.RawScalar!({ value: item })).toBe(4);
      expect(funcs.Scalar!({})).toBeUndefined();
      expect(funcs.RawScalar!({})).toBeUndefined();
    }
  });

  it.each(['constructor', 'assignment'])('uses emitted Choice keys in %s expressions', async (mode) => {
    const funcs = await compile(`namespace test.choiceKeys
type Cash:
 value int (1..1)
type XMLTrade:
 value int (1..1)
choice Box:
 Cash
 XMLTrade
func MakeCash:
 inputs: amount int (1..1)
 output: result Box (1..1)
 ${mode === 'constructor' ? 'set result: Box { Cash: Cash { value: amount } }' : 'set result -> Cash -> value: amount'}
func MakeTrade:
 inputs: amount int (1..1)
 output: result Box (1..1)
 ${mode === 'constructor' ? 'set result: Box { XMLTrade: XMLTrade { value: amount } }' : 'set result -> XMLTrade: XMLTrade { value: amount }'}
func MakeWrapped:
 inputs: amount int (1..1)
 output: result Box (0..*)
  [metadata scheme]
 ${mode === 'constructor' ? 'set result: Box { Cash: Cash { value: amount } }' : 'set result -> Cash -> value: amount'}
func Read:
 inputs: box Box (1..1)
 output: result int (1..1)
 set result: box switch Cash then item -> value, XMLTrade then item -> value, default 0`);
    const cash = funcs.MakeCash!({ amount: 7 });
    const trade = funcs.MakeTrade!({ amount: 9 });
    expect(cash).toEqual({ cash: { value: 7 } });
    expect(trade).toEqual({ xMLTrade: { value: 9 } });
    expect(funcs.MakeWrapped!({ amount: 11 })).toEqual([{ value: { cash: { value: 11 } }, meta: {} }]);
    expect(funcs.Read!({ box: cash })).toBe(7);
    expect(funcs.Read!({ box: trade })).toBe(9);
  });

  it.each(['scheme', 'reference'])('retains %s selector metadata through switch item branches', async (annotation) => {
    const funcs = await compile(`namespace test.switchSelectorMetadata
enum Kind:
 Cash
 Credit
type Entry:
 value int (1..1)
type Special extends Entry:
 extra int (0..1)
choice Box:
 Entry
func Retain:
 inputs: kind Kind (1..1)
  [metadata ${annotation}]
 output: result Kind (1..1)
  [metadata ${annotation}]
 set result: kind switch Cash then item, default item
func Nested:
 inputs: kind Kind (1..1)
  [metadata ${annotation}]
 output: result Kind (1..1)
  [metadata ${annotation}]
 set result: kind switch Cash then (item switch Cash then item, default item), default item
func Read:
 inputs: kind Kind (1..1)
  [metadata ${annotation}]
 output: result Kind (1..1)
 set result: kind switch Cash then item, default item
func RetainData:
 inputs: entry Entry (1..1)
  [metadata ${annotation}]
 output: result Entry (1..1)
  [metadata ${annotation}]
 set result: entry switch Special then item, default item
func ReadData:
 inputs: entry Entry (1..1)
  [metadata ${annotation}]
 output: result int (1..1)
 set result: entry switch Special then item -> value, default item -> value
func Project:
 inputs: box Box (1..1)
  [metadata ${annotation}]
 output: result Entry (1..1)
 set result: box switch Entry then item, default Entry {value: 0}`);
    const wrap = (value: unknown) =>
      annotation === 'scheme' ? { value, meta: { scheme: 'retained' } } : { value, externalReference: 'retained' };
    for (const value of ['Cash', 'Credit']) {
      const kind = wrap(value);
      expect(funcs.Retain!({ kind })).toBe(kind);
      expect(funcs.Nested!({ kind })).toBe(kind);
      expect(funcs.Read!({ kind })).toBe(value);
    }
    for (const value of [{ value: 4 }, { value: 5, extra: 1 }]) {
      const entry = wrap(value);
      expect(funcs.RetainData!({ entry })).toBe(entry);
      expect(funcs.ReadData!({ entry })).toBe(value.value);
    }
    const selected = { value: 6 };
    expect(funcs.Project!({ box: wrap({ entry: selected }) })).toBe(selected);
  });

  it.each(['', 'scheme', 'reference'])(
    'projects collection-valued defaults through navigation (metadata=%s)',
    async (annotation) => {
      const metadata = annotation ? `[metadata ${annotation}]` : '';
      const funcs = await compile(`namespace test.defaultNavigation
type Child:
 value int (1..1)
func Values:
 inputs:
  primary Child (0..*)
   ${metadata}
  fallback Child (0..*)
   ${metadata}
 output: result int (0..*)
 set result: (primary default fallback) -> value
func LeftMany:
 inputs:
  primary Child (0..*)
  fallback Child (0..1)
 output: result int (0..*)
 set result: (primary default fallback) -> value
func RightMany:
 inputs:
  primary Child (0..1)
  fallback Child (0..*)
 output: result int (0..*)
 set result: (primary default fallback) -> value
func Scalar:
 inputs:
  primary Child (0..1)
  fallback Child (0..1)
 output: result int (0..1)
 set result: (primary default fallback) -> value`);
      const children = [{ value: 1 }, { value: 2 }];
      const wrap = (value: { value: number }) =>
        annotation === 'scheme' ? { value, meta: {} } : annotation === 'reference' ? { value } : value;
      const primary = children.map(wrap);
      const fallback = [wrap({ value: 3 })];
      expect(funcs.Values!({ primary, fallback })).toEqual([1, 2]);
      expect(funcs.Values!({ primary: [], fallback })).toEqual([3]);
      expect(funcs.Values!({ primary: [], fallback: [] })).toEqual([]);
      expect(funcs.Scalar!({ primary: children[0], fallback: children[1] })).toBe(1);
      expect(funcs.Scalar!({ fallback: children[1] })).toBe(2);
      expect(funcs.Scalar!({})).toBeUndefined();
      expect(funcs.LeftMany!({ primary: children, fallback: { value: 3 } })).toEqual([1, 2]);
      expect(funcs.LeftMany!({ primary: [], fallback: { value: 3 } })).toEqual([3]);
      expect(funcs.RightMany!({ fallback: children })).toEqual([1, 2]);
      expect(funcs.RightMany!({ primary: { value: 3 }, fallback: children })).toEqual([3]);
    }
  );

  it.each(['scheme', 'reference'])('normalizes switch branches for %s outputs', async (annotation) => {
    const funcs = await compile(`namespace test.switchMetadata
func Select:
 inputs:
  selector int (1..1)
  field int (1..1)
   [metadata scheme]
  reference int (1..1)
   [metadata reference]
 output: result int (0..1)
  [metadata ${annotation}]
 set result: selector switch 1 then field, 2 then reference, 3 then 9, default empty
func Many:
 inputs:
  selector int (1..1)
  fields int (0..*)
   [metadata scheme]
 output: result int (0..*)
  [metadata ${annotation}]
 set result: selector switch 1 then fields, default [9]
func Raw:
 inputs:
  selector int (1..1)
  field int (1..1)
   [metadata scheme]
 output: result int (1..1)
 set result: selector switch 1 then field, default 9`);
    const field = { value: 4, meta: { scheme: 'unit' } };
    const reference = { value: 6, externalReference: 'id' };
    const input = { field, reference };
    expect(funcs.Select!({ ...input, selector: 1 })).toMatchObject({ value: 4, meta: { scheme: 'unit' } });
    expect(funcs.Select!({ ...input, selector: 2 })).toMatchObject({ value: 6 });
    expect(funcs.Select!({ ...input, selector: 3 })).toMatchObject({ value: 9 });
    expect(funcs.Select!({ ...input, selector: 4 })).toBeUndefined();
    expect(funcs.Many!({ selector: 1, fields: [field] })).toMatchObject([{ value: 4 }]);
    expect(funcs.Many!({ selector: 2, fields: [field] })).toMatchObject([{ value: 9 }]);
    expect(funcs.Raw!({ selector: 1, field })).toBe(4);
  });

  it.each([false, true])('resolves dispatch signatures across files (reverse=%s)', async (reverse) => {
    const sources = [
      `namespace test.splitDispatch
enum Kind:
 Cash
 Credit
func Retain:
 inputs:
  kind Kind (1..1)
  values int (0..*)
   [metadata scheme]
 output: result int (0..2)
  [metadata reference]
 set result: values
`,
      `namespace test.splitDispatch
func Retain(kind: Kind -> Cash):
 set result: values
`
    ];
    const funcs = await compile(reverse ? [...sources].reverse() : sources);
    const field = { value: 4, meta: { scheme: 'unit' } };
    for (const kind of ['Cash', 'Credit']) {
      expect(funcs.Retain!({ kind, values: [field] })).toMatchObject([{ value: 4, meta: { scheme: 'unit' } }]);
      expect(funcs.Retain!({ kind, values: [] })).toEqual([]);
      expect(() => funcs.Retain!({ kind, values: [field, field, field] })).toThrow('too many results');
    }
  });

  it.each(['set', 'add'])('enforces finite output bounds for %s assignments', async (operation) => {
    const funcs = await compile(`namespace test.outputBounds
func Limited:
 inputs: values int (0..*)
 output: result int (1..2)
 ${operation} result: values
func Optional:
 inputs: values int (0..*)
 output: result int (0..2)
 ${operation} result: values
func Unbounded:
 inputs: values int (0..*)
 output: result int (0..*)
 ${operation} result: values`);
    expect(funcs.Limited!({ values: [1, 2] })).toEqual([1, 2]);
    expect(() => funcs.Limited!({ values: [] })).toThrow('too few results');
    expect(() => funcs.Limited!({ values: [1, 2, 3] })).toThrow('too many results');
    expect(funcs.Optional!({ values: [] })).toEqual([]);
    expect(() => funcs.Optional!({ values: [1, 2, 3] })).toThrow('too many results');
    expect(funcs.Unbounded!({ values: [1, 2, 3] })).toEqual([1, 2, 3]);
  });

  it.each(['scheme', 'reference'])(
    'deduplicates %s collections by payload and keeps the first wrapper',
    async (annotation) => {
      const funcs = await compile(`namespace test.distinctMetadata
type Item:
 value int (1..1)
func Unique:
 inputs:
  values Item (0..*)
   [metadata ${annotation}]
 output: result Item (0..*)
  [metadata ${annotation}]
 set result: values distinct`);
      const first = {
        value: { value: 4 },
        meta: { scheme: 'first' },
        ...(annotation === 'reference' ? { externalReference: 'first' } : {})
      };
      const second = { value: { value: 4 }, meta: { scheme: 'second' } };
      const third = { value: { value: 5 }, meta: { scheme: 'third' } };
      expect(funcs.Unique!({ values: [first, second, third] })).toEqual([first, third]);
      expect((funcs.Unique!({ values: [first, second] }) as unknown[])[0]).toBe(first);
      expect(funcs.Unique!({ values: [] })).toEqual([]);
    }
  );

  it.each(['scheme', 'reference'])('normalizes each mixed list element for %s outputs', async (annotation) => {
    const funcs = await compile(`namespace test.listMetadata
func Mixed:
 inputs:
  field int (1..1)
   [metadata scheme]
  reference int (1..1)
   [metadata reference]
  raw int (1..1)
 output: result int (0..*)
  [metadata ${annotation}]
 alias saved: [field, raw, reference]
 set result: saved
func Raw:
 inputs:
  field int (1..1)
   [metadata scheme]
  raw int (1..1)
 output: result int (0..*)
 set result: [field, raw]`);
    const field = { value: 2, meta: { scheme: 'field' } };
    const reference = { value: 4, externalReference: 'ref' };
    const expected =
      annotation === 'scheme'
        ? [field, { value: 3, meta: {} }, { value: 4, meta: {} }]
        : [field, { value: 3 }, reference];
    expect(funcs.Mixed!({ field, reference, raw: 3 })).toEqual(expected);
    expect(funcs.Raw!({ field, raw: 3 })).toEqual([2, 3]);
  });

  it.each(['scheme', 'reference'])('normalizes reducer accumulators for %s outputs', async (annotation) => {
    const funcs = await compile(`namespace test.reduceMetadata
func Total:
 inputs:
  values int (0..*)
   [metadata ${annotation}]
 output: result int (0..1)
  [metadata ${annotation}]
 set result: values reduce a, b [a + b]
func Last:
 inputs:
  values int (0..*)
   [metadata ${annotation}]
 output: result int (0..1)
  [metadata ${annotation}]
 set result: values reduce a, b [b]
func Offset:
 inputs:
  values int (0..*)
   [metadata ${annotation}]
  offset int (1..1)
 output: result int (0..1)
 set result: values reduce a, b [a + b + offset]`);
    const field = (value: number) => ({ value, meta: { scheme: String(value) } });
    const wrapped = (value: number) => ({ value, ...(annotation === 'scheme' ? { meta: {} } : {}) });
    expect(funcs.Total!({ values: [field(1), field(2), field(3)] })).toEqual(wrapped(6));
    expect(funcs.Total!({ values: [field(1)] })).toEqual(wrapped(1));
    expect(funcs.Total!({ values: [] })).toBeUndefined();
    const last = annotation === 'scheme' ? field(3) : { value: 3, externalReference: 'last' };
    expect(funcs.Last!({ values: [field(1), field(2), last] })).toBe(last);
    expect(funcs.Last!({ values: [last] })).toBe(last);
    expect(funcs.Offset!({ values: [field(1), field(2), field(3)], offset: 10 })).toBe(26);
    if (annotation === 'reference') {
      expect(funcs.Total!({ values: [{ externalReference: 'unresolved' }, field(2), field(3)] })).toEqual(wrapped(5));
      expect(funcs.Total!({ values: [{ externalReference: 'unresolved' }] })).toBeUndefined();
    }
  });

  it('compares collection payloads while retaining selected metadata', async () => {
    const operations = [
      ['Sorted', 'int', '0..*', 'values sort'],
      ['SortedKey', 'int', '0..*', 'values sort x [x]'],
      ['Minimum', 'int', '0..1', 'values min'],
      ['MaximumKey', 'int', '0..1', 'values max x [x]'],
      ['Filtered', 'boolean', '0..*', 'values filter x [x]']
    ];
    const funcs = await compile(`namespace test.collectionMetadata
${operations
  .map(
    ([name, type, card, expr]) => `func ${name}:
 inputs:
  values ${type} (0..*)
   [metadata scheme]
 output: result ${type} (${card})
  [metadata scheme]
 set result: ${expr}`
  )
  .join('\n')}`);
    const field = (value: unknown) => ({ value, meta: { scheme: String(value) } });
    const values = [field(10), field(2), field(1)];
    expect(funcs.Sorted!({ values })).toEqual([values[2], values[1], values[0]]);
    expect(funcs.SortedKey!({ values })).toEqual([values[2], values[1], values[0]]);
    expect(funcs.Minimum!({ values })).toBe(values[2]);
    expect(funcs.MaximumKey!({ values })).toBe(values[0]);
    expect(funcs.Filtered!({ values: [field(false), field(true)] })).toEqual([field(true)]);
    expect(funcs.Minimum!({ values: [] })).toBeUndefined();
    expect(values).toEqual([field(10), field(2), field(1)]);
  });

  it.each(['scheme', 'reference'])('computes payloads before wrapping %s outputs', async (annotation) => {
    const operations = [
      ['Arithmetic', 'n int (1..1)', 'int', 'n + 1'],
      ['Total', 'numbers int (0..*)', 'int', 'numbers sum'],
      ['Convert', 'text string (1..1)', 'int', 'text to-int'],
      ['Compare', 'n int (1..1)', 'boolean', 'n > 0'],
      ['Logic', 'flag boolean (1..1)', 'boolean', 'flag and True'],
      ['Count', 'numbers int (0..*)', 'int', 'numbers count'],
      ['Join', 'texts string (0..*)', 'string', 'texts join "-"']
    ];
    const funcs = await compile(
      `namespace test.computedMetadata\n${operations
        .map(
          ([name, input, output, expression]) => `func ${name}:
 inputs:
  ${input}
   [metadata scheme]
 output: result ${output} (1..1)
  [metadata ${annotation}]
 set result: ${expression}`
        )
        .join('\n')}`
    );
    const field = (value: unknown) => ({ value, meta: { scheme: 'input' } });
    const wrap = (value: unknown) => ({ value, ...(annotation === 'scheme' ? { meta: {} } : {}) });
    expect(funcs.Arithmetic!({ n: field(3) })).toEqual(wrap(4));
    expect(funcs.Total!({ numbers: [field(2), field(3)] })).toEqual(wrap(5));
    expect(funcs.Convert!({ text: field('12') })).toEqual(wrap(12));
    expect(funcs.Compare!({ n: field(-1) })).toEqual(wrap(false));
    expect(funcs.Logic!({ flag: field(false) })).toEqual(wrap(false));
    expect(funcs.Count!({ numbers: [field(2), field(3)] })).toEqual(wrap(2));
    expect(funcs.Join!({ texts: [field('a'), field('b')] })).toEqual(wrap('a-b'));
  });

  it.each(
    ['scheme', 'reference'].flatMap((annotation) =>
      ['1..1', '0..1', '0..*'].map((cardinality) => ({ annotation, cardinality }))
    )
  )(
    'normalizes mixed conditional branches for $annotation $cardinality outputs',
    async ({ annotation, cardinality }) => {
      const funcs = await compile(`namespace test.conditionalMetadata
${['FieldOrRaw', 'RefOrField']
  .map(
    (name) => `func ${name}:
 inputs:
  flag boolean (1..1)
   [metadata scheme]
  raw int (${cardinality})
  field int (${cardinality})
   [metadata scheme]
  reference int (${cardinality})
   [metadata reference]
 output: result int (${cardinality})
  [metadata ${annotation}]
 set result: if flag then ${name === 'FieldOrRaw' ? 'field else raw' : 'reference else field'}`
  )
  .join('\n')}
`);
      const list = (value: unknown) => (cardinality === '0..*' ? [value] : value);
      const field = { value: 3, meta: { scheme: 'field' } };
      const reference = { value: 4, externalReference: 'key', meta: { scheme: 'ref' } };
      const args = { raw: list(5), field: list(field), reference: list(reference) };
      expect(funcs.FieldOrRaw!({ ...args, flag: { value: true, meta: {} } })).toEqual(list(field));
      expect(funcs.FieldOrRaw!({ ...args, flag: { value: false, meta: {} } })).toEqual(list({ value: 5, meta: {} }));
      expect(funcs.RefOrField!({ ...args, flag: { value: true, meta: {} } })).toEqual(
        list(annotation === 'scheme' ? { value: 4, meta: reference.meta } : reference)
      );
      expect(funcs.RefOrField!({ ...args, flag: { value: false, meta: {} } })).toEqual(list(field));
      expect(
        funcs.RefOrField!({
          ...args,
          reference: list({ externalReference: 'unresolved' }),
          flag: { value: false, meta: {} }
        })
      ).toEqual(list(field));
      if (cardinality !== '1..1') {
        const empty = cardinality === '0..*' ? [] : undefined;
        expect(funcs.FieldOrRaw!({ raw: empty, field: empty, flag: { value: false, meta: {} } })).toEqual(empty);
      }
    }
  );

  it.each(['scheme', 'reference'])('normalizes %s constructor fields from their declarations', async (annotation) => {
    const funcs = await compile(`namespace test.constructorMetadata
type Container:
 amount int (1..1)
  [metadata ${annotation}]
 values int (0..*)
  [metadata ${annotation}]
 maybeAmount int (0..1)
  [metadata ${annotation}]
 plain int (1..1)
func Build:
 inputs:
  amount int (1..1)
  maybeAmount int (0..1)
 output: result Container (1..1)
 set result: Container { amount: amount with-meta { scheme: "x" }, values: [amount], maybeAmount: maybeAmount, plain: amount with-meta { scheme: "discard" } }
`);
    expect(funcs.Build!({ amount: 4 })).toEqual({
      amount: { value: 4, meta: { scheme: 'x' } },
      values: [annotation === 'scheme' ? { value: 4, meta: {} } : { value: 4 }],
      maybeAmount: undefined,
      plain: 4
    });
    expect(funcs.Build!({ amount: 4, maybeAmount: 7 })).toMatchObject({
      maybeAmount: annotation === 'scheme' ? { value: 7, meta: {} } : { value: 7 }
    });
  });

  it.each(['scheme', 'reference'])(
    'initializes nested assignment paths through a %s output wrapper',
    async (annotation) => {
      const funcs = await compile(`namespace test.rootMetadata
type Inner:
 value int (1..1)
type Outer:
 nested Inner (1..1)
func Build:
 inputs: amount int (1..1)
 output: result Outer (1..1)
  [metadata ${annotation}]
 set result -> nested -> value: amount
`);
      expect(funcs.Build!({ amount: 4 })).toEqual({
        value: { nested: { value: 4 } },
        ...(annotation === 'scheme' ? { meta: {} } : {})
      });
    }
  );

  it('uses distinguishing optional fields for subtype switch guards', async () => {
    const funcs = await compile(`namespace test.subtypeSwitch
type Base:
 value int (1..1)
type Child extends Base:
 marker string (0..1)
type GrandChild extends Child:
 detail string (0..1)
type Sibling extends Base:
 siblingMarker string (0..1)
func Select:
 inputs: source Base (1..1)
 output: result string (1..1)
 set result: source switch GrandChild then "grandchild", Child then "child", Sibling then "sibling", default "base"
func KnownChild:
 inputs: source Child (1..1)
 output: result boolean (1..1)
 set result: source switch Child then True, default False
func KnownAncestor:
 inputs: source Child (1..1)
 output: result boolean (1..1)
 set result: source switch Base then True, default False
`);
    expect(funcs.Select!({ source: { value: 1 } })).toBe('base');
    expect(funcs.Select!({ source: { value: 1, marker: undefined } })).toBe('base');
    expect(funcs.Select!({ source: { value: 1, marker: 'x' } })).toBe('child');
    expect(funcs.Select!({ source: { value: 1, siblingMarker: 'x' } })).toBe('sibling');
    expect(funcs.Select!({ source: { value: 1, detail: 'x' } })).toBe('grandchild');
    expect(funcs.KnownChild!({ source: { value: 1 } })).toBe(true);
    expect(funcs.KnownAncestor!({ source: { value: 1 } })).toBe(true);
  });

  it.each(['scheme', 'reference'])(
    'crosses %s wrappers and collections in the same assignment path',
    async (annotation) => {
      const funcs = await compile(`namespace test.wrappedCollectionAssignment
type Leaf:
 value int (1..1)
 values int (0..*)
type Branch:
 leaves Leaf (0..*)
  [metadata ${annotation}]
type Container:
 branch Branch (1..1)
  [metadata ${annotation}]
func Build:
 inputs: amount int (1..1)
 output: result Container (0..*)
  [metadata ${annotation}]
 set result -> branch -> leaves -> value: amount
 add result -> branch -> leaves -> values: amount
`);
      const wrap = (value: unknown) => ({ value, ...(annotation === 'scheme' ? { meta: {} } : {}) });
      expect(funcs.Build!({ amount: 4 })).toEqual([
        wrap({ branch: wrap({ leaves: [wrap({ value: 4, values: [4] })] }) })
      ]);
    }
  );

  it('creates and updates the first element of collection assignment intermediates', async () => {
    const funcs = await compile(`namespace test.collectionAssignment
type Child:
 value int (1..1)
 values int (0..*)
type Parent:
 children Child (0..*)
func Build:
 inputs: amount int (1..1)
 output: result Parent (1..1)
 set result -> children -> value: amount
 add result -> children -> values: [amount, amount + 1]
func Update:
 inputs: amount int (1..1)
 output: result Parent (1..1)
 set result: Parent { children: [Child { value: 1, values: [] }, Child { value: 2, values: [] }] }
 set result -> children -> value: amount
 add result -> children -> values: amount
`);
    expect(funcs.Build!({ amount: 4 })).toEqual({ children: [{ value: 4, values: [4, 5] }] });
    expect(funcs.Update!({ amount: 4 })).toEqual({
      children: [
        { value: 4, values: [4] },
        { value: 2, values: [] }
      ]
    });
  });

  it.each(
    ['scheme', 'reference'].flatMap((annotation) =>
      ['1..1', '0..1', '0..*'].map((cardinality) => ({ annotation, cardinality }))
    )
  )(
    'preserves $annotation aliases at $cardinality wrapper and value boundaries',
    async ({ annotation, cardinality }) => {
      const funcs = await compile(`namespace test.aliasMetadata
func Echo:
 inputs:
  source int (${cardinality})
   [metadata ${annotation}]
 output:
  result int (${cardinality})
   [metadata ${annotation}]
 alias saved: source
 set result: saved
func Saved:
 inputs:
  source int (${cardinality})
   [metadata ${annotation}]
 output:
  result int (${cardinality})
   [metadata ${annotation}]
 alias saved: source
 alias chained: saved
 set result: Echo(chained)
func Plain:
 inputs:
  source int (${cardinality})
   [metadata ${annotation}]
 output: result int (${cardinality})
 alias saved: source
 alias chained: saved
 set result: chained
func PlainCall:
 inputs:
  source int (${cardinality})
   [metadata ${annotation}]
 output: result int (${cardinality})
 alias saved: source
 set result: Identity(saved)
func Identity:
 inputs: source int (${cardinality})
 output: result int (${cardinality})
 set result: source
func Positive:
 inputs:
  source int (${cardinality})
   [metadata ${annotation}]
 output: result boolean (1..1)
 alias saved: source
 set result: saved all > 0
`);
      const wrapper = {
        value: 7,
        meta: { scheme: 'unit' },
        ...(annotation === 'reference' ? { externalReference: 'key' } : {})
      };
      const source = cardinality === '0..*' ? [wrapper, { ...wrapper, value: 8 }] : wrapper;
      const expected = cardinality === '0..*' ? [7, 8] : 7;
      expect(funcs.Saved!({ source })).toEqual(source);
      expect(funcs.Plain!({ source })).toEqual(expected);
      expect(funcs.PlainCall!({ source })).toEqual(expected);
      expect(funcs.Positive!({ source })).toBe(true);
      expect(
        funcs.Positive!({ source: cardinality === '0..*' ? [{ ...wrapper, value: 0 }] : { ...wrapper, value: 0 } })
      ).toBe(false);
      if (cardinality !== '1..1') {
        const empty = cardinality === '0..*' ? [] : undefined;
        for (const name of ['Saved', 'Plain', 'PlainCall']) expect(funcs[name]!({ source: empty })).toEqual(empty);
        if (annotation === 'reference') {
          const unresolved = cardinality === '0..*' ? [{ externalReference: 'key' }] : { externalReference: 'key' };
          expect(funcs.Saved!({ source: unresolved })).toEqual(unresolved);
          expect(funcs.Plain!({ source: unresolved })).toEqual(empty);
        }
      }
    }
  );

  it('projects deep scalar features through collection intermediates', async () => {
    const funcs = await compile(`namespace test.deepCollections
type Child:
 value int (1..1)
type Parent:
 children Child (0..*)
 other Child (0..1)
type Root:
 parents Parent (0..*)
func Collect:
 inputs: parent Parent (1..1)
 output: result int (0..*)
 set result: parent ->> value
func CollectNested:
 inputs: source Root (1..1)
 output: result int (0..*)
 set result: source ->> value
func CollectRoots:
 inputs: parents Parent (0..*)
 output: result int (0..*)
 set result: parents ->> value
`);
    const parents = [{ children: [{ value: 1 }, { value: 2 }] }, { children: [] }, { children: [{ value: 3 }] }];
    expect(funcs.Collect!({ parent: parents[0] })).toEqual([1, 2]);
    expect(funcs.Collect!({ parent: parents[1] })).toEqual([]);
    expect(funcs.Collect!({ parent: { ...parents[0], other: { value: 4 } } })).toEqual([1, 2, 4]);
    expect(funcs.CollectNested!({ source: { parents } })).toEqual([1, 2, 3]);
    expect(funcs.CollectNested!({ source: { parents: [] } })).toEqual([]);
    expect(funcs.CollectRoots!({ parents })).toEqual([1, 2, 3]);
  });

  it('binds item to switch selectors in primitive cases and object defaults', async () => {
    const funcs = await compile(`namespace test.switchItem
enum Kind:
 Cash
 Credit
 Other
type Entry:
 value int (1..1)
type SpecialEntry extends Entry:
 marker string (1..1)
func EnumItem:
 inputs: kind Kind (1..1)
 output: result Kind (1..1)
 set result: kind switch Cash then item, Credit then item, default item
func LiteralItem:
 inputs: value int (1..1)
 output: result int (1..1)
 set result: value switch 1 then item, default item
func ObjectItem:
 inputs: entry Entry (1..1)
 output: result int (1..1)
 set result: entry switch SpecialEntry then item -> value, default item -> value
`);
    for (const kind of ['Cash', 'Credit', 'Other']) expect(funcs.EnumItem!({ kind })).toBe(kind);
    for (const value of [1, 2]) expect(funcs.LiteralItem!({ value })).toBe(value);
    expect(funcs.ObjectItem!({ entry: { value: 3 } })).toBe(3);
    expect(funcs.ObjectItem!({ entry: { value: 4, marker: 'special' } })).toBe(4);
  });

  it.each(['0..1', '0..*'])('distinguishes both empty from one empty in %s inequality', async (cardinality) => {
    const funcs = await compile(`namespace test.emptyInequality
func Equal:
 inputs:
  left int (${cardinality})
  right int (${cardinality})
 output: result boolean (1..1)
 set result: left = right
func Unequal:
 inputs:
  left int (${cardinality})
  right int (${cardinality})
 output: result boolean (1..1)
 set result: left <> right
`);
    const empty = cardinality === '0..*' ? [] : undefined;
    const value = cardinality === '0..*' ? [1] : 1;
    expect(funcs.Equal!({ left: empty, right: empty })).toBe(true);
    expect(funcs.Unequal!({ left: empty, right: empty })).toBe(false);
    expect(funcs.Unequal!({ left: empty, right: value })).toBe(true);
    expect(funcs.Unequal!({ left: value, right: empty })).toBe(true);
  });

  it.each(['1..1', '0..1', '0..*'])(
    'converts metadata wrappers at %s calls and assignments without nesting payloads',
    async (cardinality) => {
      const funcs = await compile(
        `namespace test.metadataConversion
func Field:
 inputs:
  source int (1..1)
   [metadata scheme]
 output:
  result int (1..1)
   [metadata scheme]
 set result: source
func FieldSuper extends Field:
 set result: super(source)
func FieldForward extends Field:
 set result: super
func RefToFieldCall:
 inputs:
  source int (1..1)
   [metadata reference]
 output:
  result int (1..1)
   [metadata scheme]
 set result: Field(source)
func RefToFieldAssign:
 inputs:
  source int (1..1)
   [metadata reference]
 output:
  result int (1..1)
   [metadata scheme]
 set result: source
func FieldToRefAssign:
 inputs:
  source int (1..1)
   [metadata scheme]
 output:
  result int (1..1)
   [metadata reference]
 set result: source
func Reference:
 inputs:
  source int (1..1)
   [metadata reference]
 output:
  result int (1..1)
   [metadata reference]
 set result: source
func FieldToRefCall:
 inputs:
  source int (1..1)
   [metadata scheme]
 output:
  result int (1..1)
   [metadata reference]
 set result: Reference(source)
`.replace(/\(1\.\.1\)/g, `(${cardinality})`)
      );
      const input = (value: unknown) => (cardinality === '0..*' ? [value] : value);
      if (cardinality !== '1..1') {
        for (const name of ['RefToFieldCall', 'RefToFieldAssign', 'FieldToRefCall', 'FieldToRefAssign']) {
          expect(funcs[name]!({})).toEqual(cardinality === '0..*' ? [] : undefined);
        }
      }
      const field = { value: 7, meta: { scheme: 'unit' } };
      const reference = { value: 7, externalReference: 'key', meta: { scheme: 'unit' } };
      for (const name of ['RefToFieldCall', 'RefToFieldAssign']) {
        expect(funcs[name]!({ source: input(reference) })).toEqual(input(field));
        expect(funcs[name]!({ source: input({ value: 0 }) })).toEqual(input({ value: 0, meta: {} }));
        expect(() => funcs[name]!({ source: input({ externalReference: 'key' }) })).toThrow(/value/i);
      }
      for (const name of ['FieldToRefCall', 'FieldToRefAssign', 'FieldSuper', 'FieldForward']) {
        expect(funcs[name]!({ source: input(field) })).toEqual(input(field));
      }
    }
  );

  it('checks only-exists allow-lists on optional parent values', async () => {
    const funcs = await compile(`namespace test.onlyExists
 type Item:
  a string (0..1)
  b string (0..1)
  c string (0..1)
 func Check:
  inputs: source Item (0..1)
  output: result boolean (1..1)
  set result: (source -> a, source -> b) only exists
`);
    expect(funcs.Check!({})).toBe(true);
    expect(funcs.Check!({ source: {} })).toBe(true);
    expect(funcs.Check!({ source: { a: 'a' } })).toBe(true);
    expect(funcs.Check!({ source: { a: 'a', b: 'b' } })).toBe(true);
    expect(funcs.Check!({ source: { c: 'c' } })).toBe(false);
  });

  it.each(['scheme', 'reference'])(
    'preserves %s metadata in implicit collection calls and pipelines',
    async (annotation) => {
      const funcs = await compile(`namespace test.implicitMetadata
func Echo:
 inputs:
  source int (1..1)
   [metadata ${annotation}]
 output:
  result int (1..1)
   [metadata ${annotation}]
 set result: source
func MapEcho:
 inputs:
  values int (0..*)
   [metadata ${annotation}]
 output:
  result int (0..*)
   [metadata ${annotation}]
 set result: values extract [Echo]
library function External(source int) int
func ExternalMap:
 inputs:
  values int (0..*)
   [metadata ${annotation}]
 output: result int (0..*)
 set result: values extract [External]
func Read:
 inputs:
  source int (1..1)
   [metadata ${annotation}]
 output: result int (1..1)
 set result: source
func Plain:
 inputs: source int (1..1)
 output: result int (1..1)
 set result: source + 1
func ReadMap:
 inputs:
  values int (0..*)
   [metadata ${annotation}]
 output: result int (0..*)
 set result: values extract [Read]
func PlainMap:
 inputs:
  values int (0..*)
   [metadata ${annotation}]
 output: result int (0..*)
 set result: values extract [Plain]
func ExplicitMap:
 inputs:
  values int (0..*)
   [metadata ${annotation}]
 output:
  result int (0..*)
   [metadata ${annotation}]
 set result: values extract v [Echo(v)]
func IdentityMap:
 inputs:
  values int (0..*)
   [metadata ${annotation}]
 output:
  result int (0..*)
   [metadata ${annotation}]
 set result: values extract [item]
func PipeEcho:
 inputs:
  source int (1..1)
   [metadata ${annotation}]
 output:
  result int (1..1)
   [metadata ${annotation}]
 set result: source then Echo
`);
      const value =
        annotation === 'scheme' ? { value: 7, meta: { scheme: 'unit' } } : { value: 7, externalReference: 'id' };
      expect(funcs.MapEcho!({ values: [value] })).toEqual([value]);
      expect(funcs.MapEcho!({ values: [] })).toEqual([]);
      expect(funcs.PipeEcho!({ source: value })).toEqual(value);
      Object.assign(funcs.External!, { implementation: (source: number) => source + 2 });
      expect(funcs.ExternalMap!({ values: [value] })).toEqual([9]);
      expect(funcs.ReadMap!({ values: [value] })).toEqual([7]);
      expect(funcs.PlainMap!({ values: [value] })).toEqual([8]);
      expect(funcs.ExplicitMap!({ values: [value] })).toEqual([value]);
      expect(funcs.IdentityMap!({ values: [value] })).toEqual([value]);
      if (annotation === 'reference') {
        expect(() => funcs.PlainMap!({ values: [{ externalReference: 'id' }] })).toThrow(/requires a value/);
      }
    }
  );

  it.each(['scheme', 'reference'])('preserves %s metadata selected by default expressions', async (annotation) => {
    const funcs = await compile(`namespace test.defaultMetadata
func Choose:
 inputs:
  primary int (0..1)
   [metadata ${annotation}]
  fallback int (1..1)
   [metadata ${annotation}]
 output:
  result int (1..1)
   [metadata ${annotation}]
 set result: primary default fallback
func RawFallback:
 inputs:
  primary int (0..1)
   [metadata ${annotation}]
  fallback int (1..1)
 output:
  result int (1..1)
   [metadata ${annotation}]
 set result: primary default fallback
func Many:
 inputs:
  primary int (0..*)
   [metadata ${annotation}]
  fallback int (0..*)
   [metadata ${annotation}]
 output:
  result int (0..*)
   [metadata ${annotation}]
 set result: primary default fallback
`);
    const primary =
      annotation === 'scheme' ? { value: 0, meta: { scheme: 'first' } } : { value: 0, externalReference: 'first' };
    const fallback =
      annotation === 'scheme' ? { value: 2, meta: { scheme: 'second' } } : { value: 2, externalReference: 'second' };
    expect(funcs.Choose!({ primary, fallback })).toEqual(primary);
    expect(funcs.Choose!({ fallback })).toEqual(fallback);
    expect(funcs.RawFallback!({ primary, fallback: 3 })).toEqual(primary);
    expect(funcs.RawFallback!({ fallback: 3 })).toEqual(
      annotation === 'scheme' ? { value: 3, meta: {} } : { value: 3 }
    );
    expect(funcs.Many!({ primary: [], fallback: [fallback] })).toEqual([fallback]);
    expect(funcs.Many!({ primary: [primary], fallback: [fallback] })).toEqual([primary]);
  });

  it.each(['scheme', 'reference'])(
    'dispatches on %s metadata values and retains the wrapper in the selected body',
    async (annotation) => {
      const funcs = await compile(`namespace test.dispatchMetadata
enum Kind:
 Cash
 Credit
func Compute:
 inputs:
  kind Kind (0..1)
   [metadata ${annotation}]
 output: result int (1..1)
 set result: 0
func Compute(kind: Kind -> Cash):
 set result: 1
func Compute(kind: Kind -> Credit):
 set result: 2
func Retain:
 inputs:
  kind Kind (1..1)
   [metadata ${annotation}]
 output:
  result Kind (1..1)
   [metadata ${annotation}]
 set result: kind
func Retain(kind: Kind -> Cash):
 set result: kind
`);
      const wrap = (value: string) =>
        annotation === 'scheme' ? { value, meta: { scheme: 'unit' } } : { value, externalReference: 'id' };
      expect(funcs.Compute!({ kind: wrap('Cash') })).toBe(1);
      expect(funcs.Compute!({ kind: wrap('Credit') })).toBe(2);
      expect(funcs.Compute!({})).toBe(0);
      const cash = wrap('Cash');
      expect(funcs.Retain!({ kind: cash })).toEqual(cash);
    }
  );

  it('executes resolved calls and both conditional branches', async () => {
    const funcs = await compile(`namespace test.runtime
func Double:
 inputs: n int (1..1)
 output: result int (1..1)
 set result: n + n
func Choose:
 inputs: n int (1..1)
 output: result int (1..1)
 set result: if n > 0 then Double(Double(n)) else 0
`);
    expect(funcs.Choose!({ n: 3 })).toBe(12);
    expect(funcs.Choose!({ n: -1 })).toBe(0);
  });

  it('enforces declared input, output, and collection types at call sites', async () => {
    await compile(
      `namespace test.runtime
func Required:
 inputs: n int (1..1)
 output: result int (1..1)
 set result: n
func Optional:
 inputs: n int (0..1)
 output: result int (0..1)
 set result: n
func Many:
 inputs: values int (0..*)
 output: result int (0..*)
 set result: values
`,
      `
const numberResult: number = Required({n: 1});
const optionalResult: number | undefined = Optional({});
const arrayResult: number[] = Many({values: [1, 2]});
// @ts-expect-error Required input is missing.
Required({});
// @ts-expect-error Rune int accepts numbers.
Required({n: '1'});
// @ts-expect-error Rune output is numeric.
const wrongOutput: string = Required({n: 1});
// @ts-expect-error Optional output may be absent.
const missingOptionality: number = Optional({});
// @ts-expect-error Collection input requires an array.
Many({values: 1});
`
    );
  });

  it('deduplicates values and checks set membership', async () => {
    const funcs = await compile(`namespace test.runtime
func Unique:
 inputs: values int (0..*)
 output: result int (0..*)
 set result: values distinct
func HasAll:
 inputs:
  values int (0..*)
  requested int (0..*)
 output: result boolean (1..1)
 set result: values contains requested
`);
    expect(funcs.Unique!({ values: [2, 1, 2, 3] })).toEqual([2, 1, 3]);
    expect(funcs.HasAll!({ values: [2, 1, 2, 3], requested: [1, 3] })).toBe(true);
    expect(funcs.HasAll!({ values: [2, 1, 2, 3], requested: [] })).toBe(false);
  });

  it('calls reporting rules and host-provided library implementations', async () => {
    const funcs = await compile(`namespace test.runtime
type Amount:
 value int (1..1)
reporting rule ReadAmount from Amount:
 value
library function Adjust(value int) int
func Compute:
 inputs: amount Amount (1..1)
 output: result int (1..1)
 set result: Adjust(ReadAmount(amount))
`);
    expect(() => funcs.Compute!({ amount: { value: 3 } })).toThrow('requires an implementation');
    Object.assign(funcs.Adjust!, { implementation: (value: number) => value + 10 });
    expect(funcs.Compute!({ amount: { value: 3 } })).toBe(13);
  });

  it('preserves library array parameters in explicit and implicit calls', async () => {
    const funcs = await compile(
      [
        BASICTYPES_ROSETTA,
        `namespace test.libraryArrays
library function Total(values number[]) number
library function WeightedTotal(scale number, values number[]) number
func Explicit:
 inputs: values number (0..*)
 output: result number (1..1)
 set result: WeightedTotal(2, values)
func Implicit:
 inputs: values number (0..*)
 output: result number (1..1)
 set result: values then Total
func Scalar:
 inputs: value number (0..1)
 output: result number (1..1)
 set result: Total(value)
`
      ],
      `Total.implementation = (values: number[]): number => values.reduce((sum, value) => sum + value, 0);
WeightedTotal.implementation = (scale: number, values: number[]): number => scale * Total(values);`,
      true
    );
    const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);
    Object.assign(funcs.Total!, { implementation: total });
    Object.assign(funcs.WeightedTotal!, {
      implementation: (scale: number, values: number[]) => scale * total(values)
    });
    for (const values of [[], [3], [3, 7]]) {
      expect(funcs.Explicit!({ values })).toBe(2 * total(values));
      expect(funcs.Implicit!({ values })).toBe(total(values));
    }
    expect(funcs.Scalar!({ value: 5 })).toBe(5);
    expect(funcs.Scalar!({})).toBe(0);
  });

  it('counts scalars and validates one-of across declared object fields', async () => {
    const funcs = await compile(`namespace test.runtime
type Alternatives:
 a int (0..1)
 b int (0..*)
func Count:
 inputs: value int (0..1)
 output: result int (1..1)
 set result: value count
func ExactlyOne:
 inputs: value Alternatives (1..1)
 output: result boolean (1..1)
 set result: value one-of
`);
    expect(funcs.Count!({ value: 7 })).toBe(1);
    expect(funcs.Count!({})).toBe(0);
    expect(funcs.ExactlyOne!({ value: { a: 1, b: [] } })).toBe(true);
    expect(funcs.ExactlyOne!({ value: { a: 1, b: [2] } })).toBe(false);
    expect(funcs.ExactlyOne!({ value: { b: [] } })).toBe(false);
  });

  it('preserves field metadata and reads its value in ordinary expressions', async () => {
    const funcs = await compile(`namespace test.runtime
func Label:
 inputs: text string (1..1)
 output: result string (1..1)
  [metadata scheme]
 set result: text with-meta {scheme: "urn:test"}
func Read:
 inputs: text string (1..1)
  [metadata scheme]
 output: result string (1..1)
 set result: text
func Relabel:
 inputs: text string (1..1)
  [metadata scheme]
 output: result string (1..1)
  [metadata scheme]
 set result: text with-meta {scheme: "urn:updated"}
`);
    expect(funcs.Label!({ text: 'A' })).toEqual({ value: 'A', meta: { scheme: 'urn:test' } });
    expect(funcs.Read!({ text: { value: 'A', meta: { scheme: 'urn:test' } } })).toBe('A');
    expect(funcs.Relabel!({ text: { value: 'A', meta: { scheme: 'urn:test', location: 'kept' } } })).toEqual({
      value: 'A',
      meta: { scheme: 'urn:updated', location: 'kept' }
    });
  });

  it('passes typed metadata arguments between functions and normalizes collection outputs', async () => {
    const funcs = await compile(`namespace test.runtime
func Echo:
 inputs: text string (1..1)
  [metadata scheme]
 output: result string (1..1)
  [metadata scheme]
 set result: text
func Call:
 inputs: text string (1..1)
  [metadata scheme]
 output: result string (1..1)
  [metadata scheme]
 set result: Echo(text)
func Implicit:
 inputs: texts string (0..*)
 output: result string (0..*)
  [metadata scheme]
 set result: texts extract [Echo]
func Labels:
 inputs: texts string (0..*)
 output: result string (0..*)
  [metadata scheme]
 set result: texts with-meta {scheme: "urn:test"}
func OptionalLabel:
 inputs: text string (0..1)
 output: result string (0..1)
  [metadata scheme]
 set result: text
`);
    const text = { value: 'A', meta: { scheme: 'urn:test' } };
    expect(funcs.Call!({ text })).toEqual(text);
    expect(funcs.Implicit!({ texts: ['A', 'B'] })).toEqual([
      { value: 'A', meta: {} },
      { value: 'B', meta: {} }
    ]);
    expect(funcs.Labels!({ texts: ['A', 'B'] })).toEqual([text, { value: 'B', meta: text.meta }]);
    expect(funcs.Labels!({})).toEqual([]);
    expect(funcs.OptionalLabel!({})).toBeUndefined();
  });

  it('types keyed data and emits reference outputs without embedding the value', async () => {
    const funcs = await compile(
      `namespace test.runtime
type Item:
 [metadata key]
 name string (1..1)
func Reference:
 inputs: source Item (1..1)
 output: result Item (1..1)
  [metadata reference]
 set result: source as-key
`,
      `
const item: Item = {name: 'A', meta: {externalKey: 'item-1'}};
const reference: RuneReferenceWithMeta<Item> = Reference({source: item});
// @ts-expect-error Reference outputs are wrappers, not direct data values.
const value: Item = Reference({source: item});
`
    );
    expect(funcs.Reference!({ source: { name: 'A', meta: { externalKey: 'item-1' } } })).toEqual({
      externalReference: 'item-1'
    });
  });

  it('collects deep collection features across populated branches', async () => {
    const funcs = await compile(`namespace test.runtime
type Branch:
 values int (0..*)
type Root:
 left Branch (0..1)
 right Branch (0..1)
func Collect:
 inputs: source Root (1..1)
 output: result int (0..*)
 set result: source ->> values
`);
    expect(funcs.Collect!({ source: { right: { values: [2, 3] } } })).toEqual([2, 3]);
    expect(funcs.Collect!({ source: { left: { values: [1] }, right: { values: [2, 3] } } })).toEqual([1, 2, 3]);
  });

  it('inherits function inputs and forwards super arguments', async () => {
    const funcs = await compile(`namespace test.runtime
func Base:
 inputs: n int (1..1)
 output: result int (1..1)
 set result: n + 1
func Derived extends Base:
 set result: super(n) + 1
func Use:
 inputs: n int (1..1)
 output: result int (1..1)
 set result: Derived(n)
`);
    expect(funcs.Use!({ n: 3 })).toBe(5);
  });

  it('returns empty for a value conditional without an else and checks the output binding', async () => {
    const funcs = await compile(`namespace test.runtime
func Positive:
 inputs: n int (1..1)
 output: result int (0..1)
 set result: if n > 0 then n
 post-condition: result is absent or result > 0
`);
    expect(funcs.Positive!({ n: 3 })).toBe(3);
    expect(funcs.Positive!({ n: -1 })).toBeUndefined();
  });
  it('passes implicit pipeline arguments and preserves array set/add values', async () => {
    const funcs = await compile(`namespace test.runtime
func Double:
 inputs: n int (1..1)
 output: result int (1..1)
 set result: n + n
func Collect:
 inputs: values int (0..*)
 output: result int (0..*)
 set result: values extract [Double]
 add result: [7, 8]
 add result: 9
`);
    expect(funcs.Collect!({ values: [1, 2] })).toEqual([2, 4, 7, 8, 9]);
  });

  it('initializes nested output assignment paths', async () => {
    const funcs = await compile(`namespace test.runtime
type Inner:
 value int (1..1)
type Outer:
 nested Inner (1..1)
func Build:
 inputs: amount int (1..1)
 output: result Outer (1..1)
 set result -> nested -> value: amount
`);
    expect(funcs.Build!({ amount: 4 })).toEqual({ nested: { value: 4 } });
  });

  it('selects dispatch implementations and keeps the base fallback', async () => {
    const funcs = await compile(`namespace test.runtime
enum Kind:
 Cash
 Credit
func Compute:
 inputs:
  kind Kind (1..1)
  amount int (1..1)
 output: result int (1..1)
 set result: amount
func Compute(kind: Kind -> Cash):
 set result: amount + 1
func Compute(kind: Kind -> Credit):
 set result: amount + 2
`);
    expect(funcs.Compute!({ kind: 'Cash', amount: 3 })).toBe(4);
    expect(funcs.Compute!({ kind: 'Credit', amount: 3 })).toBe(5);
    expect(funcs.Compute!({ kind: 'other', amount: 3 })).toBe(3);
  });
});
