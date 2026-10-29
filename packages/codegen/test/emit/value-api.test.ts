// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { createRuneDslServices, BASICTYPES_ROSETTA, assertValidDocuments } from '@rune-langium/core';
import { URI } from 'langium';
import { generate } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { Temporal } from '@js-temporal/polyfill';

type ViewField = 'amount' | 'currency' | 'transfers' | 'payload' | 'value' | 'left' | 'right' | 'dates';
interface TestView extends Record<ViewField, TestView> {
  readonly _: Record<'asset' | 'amount' | 'currency' | 'value' | 'year', TestView>;
  unwrap(): unknown;
  toArray(): unknown[];
  toJSON(): unknown;
  count(): number;
  sum(): number;
  field(name: string): TestView;
  select(identity: string): TestView;
  first(): TestView;
  last(): TestView;
  onlyElement(): TestView;
  min<T, K>(key: (item: T) => K): TestView;
  sort(): TestView;
  map<T, U>(project: (item: T) => U): TestView;
  flat(): TestView;
  filter<T>(predicate: (item: T) => boolean): TestView;
  every(predicate: () => boolean): boolean;
}
type TestFactories = Record<string, { from(input: unknown): TestView }>;

const source = `namespace values
annotation metadata:
 scheme string (0..1)
 reference string (0..1)
type Asset:
 amount number (1..1)
 currency string (0..1)
type Transfer:
 asset Asset (0..1)
type Trade:
 transfers Transfer (0..*)
 _ string (0..1)
 map string (0..1)
type Alpha:
 amount string (1..1)
type Beta:
 amount int (1..1)
type Pair:
 a Alpha (1..1)
 b Beta (1..1)
type Payload:
 value string (1..1)
 amount int (1..1)
choice Wrapped:
 Payload
  [metadata scheme]
type Holder:
 wrapped Wrapped (0..1)
type Node:
 value int (1..1)
 next Node (0..1)
type Referenced:
 payload Payload (1..1)
  [metadata reference]
type Schedule:
 dates date (0..*)
type Batch:
 amounts number (2..3)
`;

it.each(['single-file', 'barrel'] as const)(
  'generates typed cardinality-polymorphic values and deep views (%s)',
  async (layout) => {
    const { RuneDsl } = createRuneDslServices();
    const docs = [BASICTYPES_ROSETTA, source].map((text, i) =>
      RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(text, URI.parse(`inmemory:///value-${i}.rosetta`))
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
    assertValidDocuments(docs);
    const outputs = await generate(docs, { target: 'typescript', typescript: { layout } });
    const entry = outputs.find((output) => output.content.includes('export const Trade ='))!;
    const assertions = `
const one: number = Asset.from({ amount: 3 }).amount.unwrap();
const pair: [number, number, ...number[]] = Asset.from([{ amount: 3 }, { amount: 7 }]).amount.unwrap();
const optional: string | undefined = Asset.from({ amount: 3 }).currency.unwrap();
const absent: undefined = Trade.from(undefined)._.asset.unwrap();
const sum: number = Trade.from({ transfers: { asset: { amount: 3 } } })._.amount.sum();
const literal: string | undefined = Trade.from({ _: 'literal' }).field('_').unwrap();
const nested: string | undefined = Wrapped.from({ payload: { value: { value: 'authored', amount: 1 }, meta: {} } }).payload.value.unwrap();
const unresolved: $Payload$Input | undefined = Referenced.from({ payload: { externalReference: 'p' } }).payload.unwrap();
const head: number = Asset.from([{ amount: 3 }]).first().amount.unwrap();
const mapped: number = Asset.from({ amount: 3 }).map(item => item.amount + 1).unwrap();
const flattened: number[] = Asset.from([{ amount: 3 }]).map(item => [item.amount]).flat().toArray();
const years: number | [number, ...number[]] | undefined = Schedule.from({ dates: [Temporal.PlainDate.from('2026-01-01')] })._.year.unwrap();
const reused: number = Asset.from(Asset.from({ amount: 3 })).amount.unwrap();
const bounded: [number, number] | [number, number, number] = Batch.from({ amounts: [1, 2] }).amounts.unwrap();
const selected: Asset | undefined = Asset.from({ amount: 3 }).min(item => item.currency).unwrap();
// @ts-expect-error upper bound is enforced in factory inputs
Batch.from({ amounts: [1, 2, 3, 4] });
// @ts-expect-error lower bound is enforced in factory inputs
Batch.from({ amounts: [1] });
// @ts-expect-error a choice requires a selected arm
Wrapped.from({});
const incoming: unknown = { amount: 3 };
const checked: Asset | [Asset, ...Asset[]] | undefined = Asset.from(incoming).unwrap();
// @ts-expect-error a reference need not contain a local payload
const required: $Payload$Input = Referenced.from({ payload: { externalReference: 'p' } }).payload.unwrap();
const filtered: number | [number, ...number[]] | undefined = Asset.from([{ amount: 3 }]).filter(item => item.amount > 5).amount.unwrap();
// @ts-expect-error required amount is missing
Asset.from({});
// @ts-expect-error unknown deep property
Trade.from(undefined)._.unknown;
// @ts-expect-error ambiguous feature identities need explicit selection
Pair.from({ a: { amount: 'a' }, b: { amount: 1 } })._.amount;
`;
    const api = compileGeneratedTypeScript<TestFactories>(outputs, {
      entry: entry.relativePath,
      assertions
    });
    const input = Object.freeze({
      transfers: Object.freeze([{ asset: { amount: 3, currency: 'USD' } }, { asset: { amount: 7 } }]),
      _: 'literal',
      map: 'authored'
    });
    const trade = api.Trade!.from(input);
    expect(trade._.asset.amount.sum()).toBe(10);
    expect(trade._.amount.toArray()).toEqual([3, 7]);
    expect(trade._.asset._.currency.toArray()).toEqual(['USD']);
    expect(trade.field('_').unwrap()).toBe('literal');
    expect(trade.field('map').unwrap()).toBe('authored');
    expect(trade.transfers.count()).toBe(2);
    expect(api.Trade!.from({ transfers: { asset: { amount: 3 } } })._.amount.unwrap()).toBe(3);
    expect(api.Trade!.from(undefined)._.asset.toArray()).toEqual([]);
    expect(api.Trade!.from([input, input])._.amount.toArray()).toEqual([3, 7, 3, 7]);
    expect(
      api
        .Asset!.from([{ amount: 3 }, { amount: 7 }])
        .filter((item: { amount: number }) => item.amount > 5)
        .amount.unwrap()
    ).toBe(7);
    expect(() => api.Asset!.from({ amount: [3, 7] }).amount.unwrap()).toThrow(/expected 1..1/);
    const pair = api.Pair!.from({ a: { amount: 'alpha' }, b: { amount: 1 } });
    expect(() => pair._.amount).toThrow(/ambiguous/);
    expect(pair.select('values.Alpha#amount').unwrap()).toBe('alpha');
    expect(trade._).toBe(trade._);
    expect(trade.unwrap()).toBeInstanceOf(api.Trade);
    expect(() => api.Batch!.from({ amounts: [1] })).toThrow(/expected 2..3/);
    expect(() => api.Batch!.from({ amounts: [1, 2, 3, 4] })).toThrow(/expected 2..3/);
    expect(() => api.Batch!.from({ amounts: ['one', 'two'] })).toThrow(/Invalid Rune value/);
    expect(
      api
        .Asset!.from({ amount: 3 })
        .min((item: { currency?: string }) => item.currency)
        .unwrap()
    ).toMatchObject({ amount: 3 });
    expect(trade.toJSON()).toEqual(input);
    expect(input.transfers[0]!.asset.amount).toBe(3);
    const wrapped = { payload: { value: { value: 'authored', amount: 1 }, meta: { scheme: 'urn:test' } } };
    expect(api.Wrapped!.from(wrapped).payload.value.unwrap()).toBe('authored');
    expect(api.Holder!.from({ wrapped })._.value.unwrap()).toBe('authored');
    expect(api.Wrapped!.from(wrapped).toJSON()).toEqual(wrapped);
    expect(() => api.Wrapped!.from({})).toThrow(/not a Wrapped/);
    const node: { value: number; next?: unknown } = { value: 1 };
    node.next = node;
    expect(api.Node!.from(node)._.value.unwrap()).toBe(1);
    const hydrated = api.Node!.from(node).unwrap() as { next: unknown; constructor: { name: string } };
    expect(hydrated.next).toBe(hydrated);
    expect(hydrated.constructor.name).toContain('Node');
    expect(api.Asset!.from(api.Asset!.from({ amount: 3 })).amount.unwrap()).toBe(3);
    expect(api.Asset!.from('{"amount":3}').amount.unwrap()).toBe(3);
    const grouped = api
      .Asset!.from([{ amount: 3 }, { amount: 7 }])
      .map((item: { amount: number }) => [item.amount, item.amount + 1]);
    expect(grouped.count()).toBe(2);
    expect(grouped.toArray()).toEqual([
      [3, 4],
      [7, 8]
    ]);
    expect(grouped.flat().toArray()).toEqual([3, 4, 7, 8]);
    expect(api.Trade!.from([]).every(() => true)).toBe(false);
    expect(api.Referenced!.from({ payload: { externalReference: 'p' } }).payload.unwrap()).toBeUndefined();
    expect(api.Referenced!.from({ payload: { value: { value: 'authored', amount: 1 } } }).payload.value.unwrap()).toBe(
      'authored'
    );
    expect(
      api
        .Asset!.from([{ amount: 3 }, { amount: 7 }])
        .first()
        .amount.unwrap()
    ).toBe(3);
    expect(
      api
        .Asset!.from([{ amount: 3 }, { amount: 7 }])
        .last()
        .amount.unwrap()
    ).toBe(7);
    expect(
      api
        .Asset!.from([{ amount: 3 }, { amount: 7 }])
        .min((item: { amount: number }) => item.amount)
        .amount.unwrap()
    ).toBe(3);
    expect(
      api
        .Asset!.from([{ amount: 3 }, { amount: 7 }])
        .onlyElement()
        .amount.unwrap()
    ).toBeUndefined();
    const schedule = api.Schedule!.from({
      dates: [Temporal.PlainDate.from('2026-01-01'), Temporal.PlainDate.from('2025-12-31')]
    });
    expect(schedule._.year.toArray()).toEqual([2026, 2025]);
    expect(api.Schedule!.from('{"dates":["2026-01-01"]}')._.year.unwrap()).toBe(2026);
    expect(() => trade._.toString).toThrow(/Unknown or ambiguous/);
    expect(String(schedule.dates.sort().first().unwrap())).toBe('2025-12-31');
  }
);

it.each(['single-file', 'barrel'] as const)(
  'links public value descriptors across namespaces and duplicate names (%s)',
  async (layout) => {
    const { RuneDsl } = createRuneDslServices();
    const texts = [
      BASICTYPES_ROSETTA,
      `namespace east\nenum Kind:\n A\ntype Leaf:\n kind Kind (1..1)\n value string (1..1)`,
      `namespace west\ntype Leaf:\n value int (1..1)`,
      `namespace aggregate\nimport east.*\nimport west.*\ntype Box:\n left east.Leaf (1..1)\n right west.Leaf (1..1)`
    ];
    const docs = texts.map((text, i) =>
      RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
        text,
        URI.parse(`inmemory:///cross-value-${i}.rosetta`)
      )
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
    assertValidDocuments(docs);
    const outputs = await generate(docs, { target: 'typescript', typescript: { layout } });
    const entry = outputs.find((output) => output.content.includes('export const Box ='))!;
    const api = compileGeneratedTypeScript<TestFactories>(outputs, {
      entry: entry.relativePath,
      assertions: `const text: string = Box.from({ left: { kind: 'A', value: 'a' }, right: { value: 1 } }).left.value.unwrap();`
    });
    const box = api.Box!.from({ left: { kind: 'A', value: 'a' }, right: { value: 1 } });
    expect(box.left.value.unwrap()).toBe('a');
    expect(box.right.value.unwrap()).toBe(1);
    expect(box.select('east.Leaf#value').unwrap()).toBe('a');
    expect(() => box._.value).toThrow(/ambiguous/);
  }
);

it.each(['single-file', 'barrel'] as const)(
  'escapes view helpers and proxy globals in model bindings (%s)',
  async (layout) => {
    const { RuneDsl } = createRuneDslServices();
    const source = ['Proxy', 'Reflect', 'RuneValue', 'RuneFactoryInput', 'RuneDeepView']
      .map((name) => `type ${name}:\n amount int (1..1)`)
      .join('\n');
    const docs = [BASICTYPES_ROSETTA, `namespace collisions\n${source}`].map((text, index) =>
      RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
        text,
        URI.parse(`inmemory:///value-collision-${index}.rosetta`)
      )
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
    assertValidDocuments(docs);
    const outputs = await generate(docs, { target: 'typescript', typescript: { layout } });
    const entry = outputs.find((output) => output.content.includes('export const ProxyData ='))!;
    const api = compileGeneratedTypeScript<Record<string, { from(input: unknown): { count(): number } }>>(outputs, {
      entry: entry.relativePath
    });
    for (const name of ['Proxy', 'Reflect', 'RuneValue', 'RuneFactoryInput', 'RuneDeepView'])
      expect(api[`${name}Data`]!.from({ amount: 3 }).count()).toBe(1);
  }
);

it('compiles deep cyclic descriptor graphs without recursive runtime-shape comparisons', async () => {
  const { RuneDsl } = createRuneDslServices();
  const count = 64;
  const declarations = Array.from(
    { length: count },
    (_, index) => `type Layer${index}:\n next Layer${(index + 1) % count} (0..1)\n amount${index} int (1..1)`
  ).join('\n');
  const docs = [BASICTYPES_ROSETTA, `namespace cyclic\n${declarations}`].map((text, index) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      text,
      URI.parse(`inmemory:///value-cycle-${index}.rosetta`)
    )
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
  assertValidDocuments(docs);
  const outputs = await generate(docs, { target: 'typescript', typescript: { layout: 'barrel' } });
  const entry = outputs.find((output) => output.content.includes('export const Layer0 ='))!;
  compileGeneratedTypeScript(outputs, {
    entry: entry.relativePath,
    assertions: 'const absent: undefined = Layer0.from(undefined)._.amount63.unwrap();'
  });
});
