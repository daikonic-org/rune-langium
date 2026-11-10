// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { createRuneDslServices, BASICTYPES_ROSETTA, assertValidDocuments } from '@rune-langium/core';
import { parseProjectPayload } from '@rune-langium/core/serialization';
import { URI } from 'langium';
import { generate } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

type JsonOptions = { format?: 'RUNE_JSON'; preserveNumberText?: boolean };
type ProjectedNumberList = number[] & { toJSON(options?: JsonOptions): unknown };
interface ModelView extends Record<'quote' | 'selected' | 'amount', ModelView> {
  field(name: string): ModelView;
  toJSON(options?: JsonOptions): unknown;
}
type ModelClass = {
  new (input: unknown): { toJSON(options?: JsonOptions): unknown };
  from(input: unknown): ModelView;
  fromJSON(input: unknown, options?: JsonOptions): ModelView;
  is(input: unknown): boolean;
};
type PublicApi = Record<
  'Quote' | 'Lookalike' | 'Base' | 'Child' | 'Tagged' | 'Reference' | 'Selection' | 'Selected',
  ModelClass
> & {
  is: Record<'Quote' | 'Base', (value: unknown) => boolean>;
  serializeListForTest(value: unknown, type?: undefined, options?: JsonOptions): unknown;
  Series: {
    fromJSON(
      input: string,
      options?: JsonOptions
    ): { amounts: number | ProjectedNumberList; toJSON(options?: JsonOptions): unknown };
  };
};

const source = `namespace publicApi
annotation metadata:
 scheme string (0..1)
 reference string (0..1)
type Quote:
 amount number (1..1)
 currency string (1..1)
type Portfolio:
 quotes Quote (1..*)
type Series:
 amounts number (1..*)
type Lookalike:
 amount number (1..1)
 currency string (1..1)
type Base:
 value int (1..1)
type Child extends Base:
 extra string (1..1)
type Reference:
 quote Quote (1..1)
  [metadata reference]
choice Selected:
 Quote
 Base
type Selection:
 selected Selected (1..1)
type Tagged extends Selected:
 extra string (0..1)
func Copy:
 inputs:
  quote Quote (1..1)
 output:
  result Quote (1..1)
 set result: quote
`;

it.each(['per-namespace', 'barrel', 'single-file', 'inline'] as const)(
  'exposes one data class, structural signatures and optional Rune JSON (%s)',
  async (layout) => {
    const { RuneDsl } = createRuneDslServices();
    const docs = [BASICTYPES_ROSETTA, source].map((text, i) =>
      RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(text, URI.parse(`inmemory:///public-${i}.rosetta`))
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
    assertValidDocuments(docs);
    const outputs = await generate(docs, {
      target: 'typescript',
      typescript: layout === 'inline' ? { layout: 'per-namespace', inlineHelpers: true } : { layout }
    });
    for (const output of outputs) expect(output.content).not.toMatch(/\bas unknown as\b|\bas any\b/);
    const model = outputs.find((output) => output.content.includes('export class Quote '))!;
    expect(model.content).not.toContain('$Quote$Data');
    expect(model.content).not.toContain('export const Quote =');
    expect(model.content).not.toMatch(/\$Quote\$|QuoteShape|export function isQuote/);
    expect(model.content).not.toContain('static readonly Type:');
    expect(model.content).toContain('export interface Shape');
    expect(model.content).toContain('Copy(quote: Quote.Shape): Quote.Shape');
    expect(model.content.includes('runtime helpers (inlined)')).toBe(layout === 'inline');
    if (layout !== 'inline') expect(outputs.some((output) => /helpers.*\.ts$/.test(output.relativePath))).toBe(true);
    const runtimeExports = outputs.map((output) =>
      output === model
        ? { ...output, content: output.content + '\nexport { runeValueJSON as serializeListForTest };' }
        : output
    );
    const api = compileGeneratedTypeScript<PublicApi>(runtimeExports, {
      entry: model.relativePath,
      erasableSyntaxOnly: true,
      assertions: `
const quote: Quote.Shape = { amount: 5, currency: 'USD' };
const copied: Quote.Shape = Copy(quote);
const portfolio: Portfolio.Shape = { quotes: [quote] };
const structural: unknown = {};
if (is.Quote(structural)) { const shape: Quote.Shape = structural;
// @ts-expect-error shapes are not instances
const instance: Quote = structural; }
const known: RuneObject = new Child({ value: 1, extra: 'child' });
if (is.Quote(known)) { const instance: Quote = known; }
const inherited: Base = new Child({ value: 1, extra: 'child' });
const one: number = Quote.from(quote).amount;
const many: [number, number, ...number[]] = Quote.from([quote, quote])._.amount;
// @ts-expect-error required currency remains enforced
Quote.from({ amount: 1 });
// @ts-expect-error child factory cannot accept a parent without its fields
Child.from({ value: 1 });
`
    });
    const input = { amount: 5, currency: 'USD' };
    const quote = new api.Quote(input);
    expect(quote.constructor.name).toBe('Quote');
    expect(Object.getOwnPropertyNames(api.Quote)).not.toEqual(expect.arrayContaining(['Type']));
    for (const name of ['is', 'from', 'fromJSON']) expect(Object.hasOwn(api.Quote, name)).toBe(false);
    expect(Object.keys(api).some((name) => name.startsWith('$Quote$') || name === 'isQuote')).toBe(false);
    expect(api.Quote.is(quote)).toBe(true);
    expect(api.is.Quote(quote)).toBe(true);
    expect(api.is.Quote(input)).toBe(true);
    expect(api.is.Quote(new api.Lookalike(input))).toBe(false);
    expect(api.is.Base(new api.Child({ value: 1, extra: 'child' }))).toBe(true);
    expect(api.is.Quote([input])).toBe(false);
    expect(api.is.Quote({ amount: 5, currency: null })).toBe(false);
    expect(api.Quote.is({ '@type': 'publicApi.Quote', ...input })).toBe(true);
    expect(api.Quote.is({ '@type': 'other.Quote', ...input })).toBe(false);
    expect(api.Quote.is({ '@type': 'publicApi.Quote' })).toBe(false);
    expect(api.Quote.is({ '@type': 'publicApi.Quote', amount: '5', currency: 'USD' })).toBe(false);
    expect(api.Base.is({ '@type': 'publicApi.Base' })).toBe(false);
    expect(api.Child.is({ '@type': 'publicApi.Child', value: 1, extra: 2 })).toBe(false);
    expect(api.Child.is({ '@type': 'publicApi.Child', value: 1, extra: 'child' })).toBe(true);
    expect(api.Quote.from(input)).toBeInstanceOf(api.Quote);
    expect(api.Child.from({ value: 1, extra: 'child' })).toBeInstanceOf(api.Base);
    expect(JSON.parse(JSON.stringify(quote))).toEqual(input);
    const wire = quote.toJSON({ format: 'RUNE_JSON' });
    expect(wire).toEqual({ '@type': 'publicApi.Quote', ...input });
    expect(api.Quote.fromJSON(JSON.stringify(wire), { format: 'RUNE_JSON' }).toJSON()).toMatchObject(input);
    const exact = api.Quote.fromJSON('{"@type":"publicApi.Quote","amount":5.00,"currency":"USD"}', {
      format: 'RUNE_JSON',
      preserveNumberText: true
    });
    expect(exact.amount).toBe(5);
    expect(exact.toJSON()).toMatchObject(input);
    expect(exact.toJSON()).not.toHaveProperty('@numberText');
    expect(JSON.stringify(exact.toJSON({ format: 'RUNE_JSON', preserveNumberText: true }))).toContain('"amount":5.00');
    expect(Reflect.set(exact, 'amount', 5)).toBe(true);
    expect(JSON.stringify(exact.toJSON({ preserveNumberText: true }))).not.toContain('5.00');
    const numberOptions = { preserveNumberText: true };
    const rootNumbers = '[1.0,9007199254740993,1.00]';
    const original = `{"amounts":${rootNumbers}}`;
    const exactList = parseProjectPayload(rootNumbers, 'JSON', numberOptions);
    expect(JSON.stringify(api.serializeListForTest(exactList, undefined, numberOptions))).toBe(rootNumbers);
    const edits: [string, (items: number[]) => unknown, string][] = [
      ['index', (items) => (items[0] = 2), '[2,9007199254740993,1.00]'],
      ['push', (items) => items.push(2), '[1.0,9007199254740993,1.00,2]'],
      ['pop', (items) => items.pop(), '[1.0,9007199254740993]'],
      ['shift', (items) => items.shift(), '[9007199254740993,1.00]'],
      ['unshift', (items) => items.unshift(2), '[2,1.0,9007199254740993,1.00]'],
      ['splice', (items) => items.splice(0, 1, 1, 2), '[1,2,9007199254740993,1.00]'],
      ['fill', (items) => items.fill(1, 0, 1), '[1,9007199254740993,1.00]'],
      ['copyWithin', (items) => items.copyWithin(1, 0, 1), '[1.0,1.0,1.00]'],
      ['reverse', (items) => items.reverse(), '[1.00,9007199254740993,1.0]'],
      ['sort', (items) => items.sort((a, b) => a - b), '[1.0,1.00,9007199254740993]'],
      ['default sort', (items) => items.sort(), '[1.0,1.00,9007199254740993]'],
      ['length', (items) => (items.length = 2), '[1.0,9007199254740993]']
    ];
    for (const [name, edit, expected] of edits) {
      const series = api.Series.fromJSON(original, numberOptions);
      const items = series.amounts;
      if (!Array.isArray(items)) throw new Error('Expected a projected list');
      edit(items);
      expect(JSON.stringify(series.toJSON(numberOptions)), name).toBe(`{"amounts":${expected}}`);
      expect(JSON.stringify(api.serializeListForTest(items, undefined, numberOptions)), name).toBe(expected);
      expect(JSON.stringify(items.toJSON({ ...numberOptions, format: 'RUNE_JSON' })), name).toBe(expected);
    }
    const bounded = api.Series.fromJSON(original, numberOptions);
    const amounts = bounded.amounts;
    if (!Array.isArray(amounts)) throw new Error('Expected a projected list');
    expect(() => amounts.splice(0)).toThrow(/expected 1/);
    expect(JSON.stringify(bounded.toJSON(numberOptions))).toBe(original);
    expect(JSON.stringify(amounts)).toBe('[1,9007199254740992,1]');
    Reflect.set(bounded, 'amounts', [1, 2]);
    expect(JSON.stringify(bounded.toJSON(numberOptions))).toBe('{"amounts":[1,2]}');
    expect(JSON.stringify(amounts.toJSON(numberOptions))).toBe(rootNumbers);
    expect(() => api.Quote.fromJSON({ '@type': 'other.Quote', ...input }, { format: 'RUNE_JSON' })).toThrow(
      /not assignable/
    );
    const reference = api.Reference.from({ quote: { value: input, meta: {}, externalReference: 'q1' } });
    const referenceWire = reference.toJSON({ format: 'RUNE_JSON' });
    expect(referenceWire).toMatchObject({ quote: { '@type': 'publicApi.Quote', '@ref:external': 'q1', amount: 5 } });
    expect(api.Reference.fromJSON(referenceWire, { format: 'RUNE_JSON' }).field('quote').amount).toBe(5);
    expect(api.Tagged.from({ quote: input })).toBeInstanceOf(api.Tagged);
    for (const extra of [undefined, 'tag']) {
      const tagged = api.Tagged.from({ quote: input, ...(extra ? { extra } : {}) });
      const taggedWire = tagged.toJSON({ format: 'RUNE_JSON' });
      expect(taggedWire).toEqual({
        '@type': 'publicApi.Tagged',
        quote: { '@type': 'publicApi.Quote', ...input },
        ...(extra ? { extra } : {})
      });
      expect(api.Tagged.fromJSON(taggedWire, { format: 'RUNE_JSON' }).toJSON({ format: 'RUNE_JSON' })).toEqual(
        taggedWire
      );
    }
    for (const invalid of [{}, { quote: input, base: { value: 1 } }]) {
      expect(api.Selected.is(invalid)).toBe(false);
      expect(() => api.Selected.from(invalid)).toThrow(/exactly one/);
      expect(() => api.Selected.fromJSON(invalid)).toThrow(/exactly one/);
      expect(() => api.Selection.fromJSON({ selected: invalid })).toThrow(/exactly one/);
    }
    const mutated = api.Selected.from({ quote: input });
    Reflect.set(mutated, 'base', { value: 1 });
    expect(() => api.Selected.from(mutated)).toThrow(/exactly one/);
    const mutatedData = api.Tagged.from({ quote: input });
    Reflect.set(mutatedData, 'base', { value: 1 });
    expect(() => api.Tagged.from(mutatedData)).toThrow(/exactly one/);
    const selected = api.Selection.from({ selected: { quote: input } });
    const selectionWire = selected.toJSON({ format: 'RUNE_JSON' });
    expect(selectionWire).toMatchObject({ selected: { '@type': 'publicApi.Quote', amount: 5 } });
    expect(api.Selection.fromJSON(selectionWire, { format: 'RUNE_JSON' }).selected.field('quote').amount).toBe(5);
    const wrappedWire = {
      '@type': 'publicApi.Selection',
      selected: {
        '@type': 'publicApi.Selected',
        '@model': 'outer-model',
        '@version': '1',
        '@key': 'choice-key',
        '@data': { '@type': 'publicApi.Quote', '@model': 'inner-model', '@version': '2', ...input }
      }
    };
    const restored = api.Selection.fromJSON(wrappedWire, { format: 'RUNE_JSON' });
    expect(restored.selected).toMatchObject({
      '@model': 'outer-model',
      '@version': '1',
      meta: { globalKey: 'choice-key' }
    });
    expect(restored.selected.field('quote').amount).toBe(5);
    expect(restored.toJSON({ format: 'RUNE_JSON' })).toEqual(wrappedWire);
  }
);
