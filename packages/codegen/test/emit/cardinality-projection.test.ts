// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { createRuneDslServices, BASICTYPES_ROSETTA, assertValidDocuments } from '@rune-langium/core';
import { URI } from 'langium';
import { generate } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

const source = `namespace projection
type Quote:
 amount number (1..1)
 currency string (1..1)
type Portfolio:
 quotes Quote (0..*)
type Batch:
 amounts number (2..3)
func Copy:
 inputs: quote Quote (1..1)
 output: result Quote (1..1)
 set result: quote
func Count:
 inputs: quotes Quote (0..*)
 output: result int (1..1)
 set result: quotes count
func Many:
 inputs: value int (1..1)
 output: result int (1..1)
 set result: value
`;

it.each(
  (['runtime', 'zod'] as const).flatMap((serialization) =>
    (['per-namespace', 'barrel', 'single-file', 'inline'] as const).map((layout) => ({ serialization, layout }))
  )
)(
  'projects private RuneValue storage to cardinality-shaped public values ($serialization, $layout)',
  async ({ serialization, layout }) => {
    const { RuneDsl } = createRuneDslServices();
    const docs = [BASICTYPES_ROSETTA, source].map((text, index) =>
      RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
        text,
        URI.parse(`inmemory:///projection-${index}.rosetta`)
      )
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
    assertValidDocuments(docs);
    const outputs = await generate(docs, {
      target: 'typescript',
      typescript: { serialization, ...(layout === 'inline' ? { inlineHelpers: true } : { layout }) }
    });
    const model = outputs.find((output) => output.content.includes('export class Quote '))!;
    type Shape = { amount: number; currency: string };
    type Quote = Shape & { toJSON(options?: { format: 'RUNE_JSON' }): unknown };
    type Portfolio = { quotes?: Shape | Shape[]; _: { amount?: number | number[] }; toJSON(): unknown };
    const api = compileGeneratedTypeScript<{
      Quote: { new (value: object): Quote; from(value: unknown): Quote | Quote[] | undefined };
      Portfolio: { from(value: unknown): Portfolio };
      RuneList: { new (value: unknown[]): object; from(...values: number[]): number[] };
      Copy(value: Quote): Quote;
    }>(outputs, {
      entry: model.relativePath,
      assertions: `
import type { OneOrMore as PublicOneOrMore, ZeroOrMore as PublicZeroOrMore } from './${model.relativePath.split('/').at(-1)!.replace(/\.ts$/, '.js')}';
const publicMany: PublicOneOrMore<Quote> = Quote.from([{ amount: 1, currency: 'USD' }, { amount: 2, currency: 'USD' }]);
const publicEmpty: PublicZeroOrMore<Quote> = undefined;
const authoredMany: number = Many(1);
const quote: Quote = Quote.from({ amount: 100, currency: 'USD' });
const copied: Quote.Shape = Copy(Quote.from({ amount: 100, currency: 'USD' }));
const count: number = Count(Quote.from([{ amount: 100, currency: 'USD' }]));
const amount: number = Quote.from({ amount: 100, currency: 'USD' }).amount;
const quotes: [Quote, Quote] = Quote.from([{ amount: 1, currency: 'USD' }, { amount: 2, currency: 'EUR' }]);
const total: number = quotes.reduce((sum, item) => sum + item.amount, 0);
const labels: string = quotes.reduce((text, item) => text + item.currency, '');
const sorted: Quote[] = quotes.sort((left, right) => left.amount - right.amount);
const selected: Quote[] = publicMany.sort(item => item.amount);
const explicitComparator: Quote[] = publicMany.sort(undefined, (left: Quote, right = left) => left.amount - right.amount);
const selectedStrings: Quote[] = publicMany.sort(item => item.currency);
const helperTotal: number = RuneList.from(1, 2).reduce((sum, item) => sum + item, 0);
const absent: undefined = Quote.from([]);
const oneFromArray: Quote = Quote.from([{ amount: 1, currency: 'USD' }]);
const values: RunePayload<number, 0, null> = Portfolio.from({ quotes: [{ amount: 1, currency: 'USD' }] })._.amount;
// @ts-expect-error cardinality lower bound remains enforced
Batch.from({ amounts: [1] });
// @ts-expect-error required fields remain enforced
Quote.from({ amount: 1 });
`
    });
    const quote = api.Quote.from({ amount: 100, currency: 'USD' });
    expect(quote).toBeInstanceOf(api.Quote);
    expect(quote).toMatchObject({ amount: 100, currency: 'USD' });
    if (!quote || Array.isArray(quote)) throw new Error('Expected a single Quote');
    expect('unwrap' in quote).toBe(false);
    expect(api.Copy(quote)).toMatchObject({ amount: 100, currency: 'USD' });
    expect(api.Quote.from([])).toBeUndefined();
    expect(api.Quote.from([{ amount: 1, currency: 'USD' }])).toBeInstanceOf(api.Quote);
    const list = api.Quote.from([
      { amount: 1, currency: 'USD' },
      { amount: 2, currency: 'EUR' }
    ]);
    expect(Array.isArray(list)).toBe(true);
    expect(list).toBeInstanceOf(api.RuneList);
    const portfolio = api.Portfolio.from({ quotes: [{ amount: 1, currency: 'USD' }] });
    expect(portfolio.quotes).toBeInstanceOf(api.Quote);
    expect(portfolio._.amount).toBe(1);
    expect(portfolio.toJSON()).toEqual({ quotes: [{ amount: 1, currency: 'USD' }] });
    portfolio.quotes = [
      { amount: 2, currency: 'EUR' },
      { amount: 3, currency: 'USD' }
    ];
    expect(portfolio._.amount).toEqual([2, 3]);
    const stored = portfolio.quotes;
    expect(portfolio.quotes).toBe(stored);
    if (!Array.isArray(stored)) throw new Error('Expected two quotes');
    stored.pop();
    expect(portfolio.quotes).toBeInstanceOf(api.Quote);
    expect(portfolio._.amount).toBe(2);
    expect(portfolio.toJSON()).toEqual({ quotes: [{ amount: 2, currency: 'EUR' }] });
    expect(() => {
      Reflect.set(portfolio, 'quotes', [{ amount: 'bad', currency: 'USD' }]);
    }).toThrow();
    expect(portfolio._.amount).toBe(2);
    portfolio.quotes = { amount: 9, currency: 'USD' };
    stored.push({ amount: 4, currency: 'EUR' });
    expect(portfolio._.amount).toBe(9);
    expect(portfolio.toJSON()).toEqual({ quotes: [{ amount: 9, currency: 'USD' }] });
    portfolio.quotes = undefined;
    expect(portfolio.quotes).toBeUndefined();
    portfolio.quotes = [];
    expect(portfolio.quotes).toBeUndefined();
    expect(portfolio.toJSON()).toEqual({ quotes: [] });
    expect(Array.isArray(list) && list.length).toBe(2);
    if (!Array.isArray(list)) throw new Error('Expected list');
    const context = { factor: 2 };
    expect(
      list.map(function (this: typeof context, item, index, array) {
        expect(this).toBe(context);
        expect(array).toBe(list);
        expect(index).toBeGreaterThanOrEqual(0);
        return this.factor * item.amount;
      }, context)
    ).toEqual([2, 4]);
    expect(
      list.flatMap(function (this: typeof context, item) {
        return [this.factor * item.amount];
      }, context)
    ).toEqual([2, 4]);
    expect(
      list
        .filter(function (this: typeof context, item) {
          return item.amount >= this.factor;
        }, context)
        .map((item) => item.amount)
    ).toEqual([2]);
    expect(
      list.every(function (this: typeof context, item) {
        return item.amount <= this.factor;
      }, context)
    ).toBe(true);
    expect(
      list.some(function (this: typeof context, item) {
        return item.amount === this.factor;
      }, context)
    ).toBe(true);
    expect(list.reduce((sum, item) => sum + item.amount, 0)).toBe(3);
    expect(list.reduce((sum, item) => sum + item.amount, 10)).toBe(13);
    expect(list.reduce((text, item) => text + item.currency, '')).toBe('USDEUR');
    expect(list.reduce<number | undefined>((sum, item) => (sum ?? 0) + item.amount, undefined)).toBe(3);
    const visited: number[] = [];
    list.reduce((sum, item, index, array) => {
      expect(array).toBe(list);
      visited.push(index);
      return sum + item.amount;
    }, 0);
    expect(visited).toEqual([0, 1]);
    expect(list.reduce((previous, current) => ({ ...previous, amount: previous.amount + current.amount })).amount).toBe(
      3
    );
    const empty = list.filter(() => false);
    expect(JSON.parse(JSON.stringify({ quotes: empty }))).toEqual({ quotes: [] });
    const single = list.filter((item) => item.amount === 1);
    expect(JSON.parse(JSON.stringify({ quotes: single }))).toEqual({ quotes: [{ amount: 1, currency: 'USD' }] });
    expect(JSON.parse(JSON.stringify(list.map((item) => item)))).toEqual([
      { amount: 1, currency: 'USD' },
      { amount: 2, currency: 'EUR' }
    ]);
    const singleJson = Reflect.get(single, 'toJSON');
    expect(Reflect.apply(singleJson, single, [{ format: 'RUNE_JSON' }])).toEqual([
      { '@type': 'projection.Quote', amount: 1, currency: 'USD' }
    ]);
    const emptyJson = Reflect.get(empty, 'toJSON');
    expect(Reflect.apply(emptyJson, empty, [{ format: 'RUNE_JSON' }])).toEqual([]);
    expect(empty.reduce((sum, item) => sum + item.amount, 7)).toBe(7);
    expect(() => empty.reduce((previous) => previous)).toThrow(TypeError);
    expect(api.RuneList.from(1, 2).reduce((sum, item) => sum + item, 10)).toBe(13);
    expect(() => list.pop()).toThrow(/expected 2/);
    expect(list.length).toBe(2);
    expect(() => list.map((_item, _index, array) => array.pop())).toThrow(/expected 2/);
    expect(list.length).toBe(2);
    expect(() => Reflect.set(list, 0, { amount: 'bad', currency: 'USD' })).toThrow();
    expect(list[0]).toMatchObject({ amount: 1 });
    expect(Reflect.get(list, 'unwrap')).toBeUndefined();
    expect(() =>
      list.sort((left) => {
        Reflect.set(left, 'amount', 'bad');
        return 0;
      })
    ).toThrow();
    const nativeOrder = list.map((item) => (item.amount === 2 ? 2 : 10));
    expect(nativeOrder.sort()).toBe(nativeOrder);
    expect(nativeOrder).toEqual([10, 2]);
    const byAmount = list.sort((item) => -item.amount);
    expect(byAmount).not.toBe(list);
    expect(byAmount.map((item) => item.amount)).toEqual([2, 1]);
    expect(list.map((item) => item.amount)).toEqual([1, 2]);
    const constantKey = list.sort(() => 1);
    expect(constantKey).not.toBe(list);
    expect(constantKey.map((item) => item.amount)).toEqual([1, 2]);
    const sort = Reflect.get(list, 'sort');
    const byCurrency = Reflect.apply(sort, list, [
      (item: Shape) => item.currency,
      (left: string, right: string) => right.localeCompare(left)
    ]);
    expect(byCurrency).not.toBe(list);
    expect(byCurrency.map((item: Shape) => item.currency)).toEqual(['USD', 'EUR']);
    expect(list.sort((left, right) => right.amount - left.amount)).toBe(list);
    expect(list.map((item) => item.amount)).toEqual([2, 1]);
    expect(Reflect.apply(sort, list, [undefined, (left: Shape, right = left) => left.amount - right.amount])).toBe(
      list
    );
    expect(list.map((item) => item.amount)).toEqual([1, 2]);
    expect(Reflect.apply(sort, list, [undefined, (...items: Shape[]) => items[1]!.amount - items[0]!.amount])).toBe(
      list
    );
    expect(list.map((item) => item.amount)).toEqual([2, 1]);
    const amounts = list.map((item) => item.amount);
    expect(amounts.sort()).toBe(amounts);
    expect(amounts).toEqual([1, 2]);
    expect(() =>
      list.sort(() => {
        throw new Error('Comparator failed');
      })
    ).toThrow('Comparator failed');
    expect(list.map((item) => item.amount)).toEqual([2, 1]);
    expect(list.reverse()).toBe(list);
    expect(list.map((item) => item.amount)).toEqual([1, 2]);
    expect(list.reverse()).toBe(list);
    expect(list.map((item) => item.amount)).toEqual([2, 1]);
    const direct = new api.Quote({ amount: 1, currency: 'USD' });
    direct.amount = 2;
    expect(direct.amount).toBe(2);
    expect(() => Reflect.set(direct, 'amount', 'invalid')).toThrow();
    expect(direct.amount).toBe(2);
    class Quoted extends api.Quote {
      get doubled() {
        return this.amount * 2;
      }
      set doubled(value: number) {
        this.amount = value / 2;
      }
    }
    const computed = new Quoted({ amount: 5, currency: 'USD' });
    expect(computed.doubled).toBe(10);
    computed.doubled = 20;
    expect(computed.amount).toBe(10);
    expect(computed.toJSON()).toEqual({ amount: 10, currency: 'USD' });
  }
);
