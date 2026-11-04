// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { createRuneDslServices, BASICTYPES_ROSETTA, assertValidDocuments } from '@rune-langium/core';
import { URI } from 'langium';
import { generate } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

type JsonOptions = { format: 'RUNE_JSON' };
interface ModelView extends Record<'quote' | 'selected' | 'amount', ModelView> {
  unwrap(): unknown;
  toJSON(options?: JsonOptions): unknown;
}
type ModelClass = {
  new (input: unknown): { toJSON(options?: JsonOptions): unknown };
  from(input: unknown): ModelView;
  fromJSON(input: unknown, options?: JsonOptions): ModelView;
};
type PublicApi = Record<'Quote' | 'Base' | 'Child' | 'Tagged' | 'Reference' | 'Selection', ModelClass> & {
  isQuote(input: unknown): boolean;
  isBase(input: unknown): boolean;
  isChild(input: unknown): boolean;
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
type Base:
 value int (1..1)
type Child extends Base:
 extra string (1..1)
type Reference:
 quote Quote (1..1)
  [metadata reference]
choice Selected:
 Quote
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
    expect(model.content).toContain('Copy(quote: Quote.Shape): Quote.Shape');
    expect(model.content.includes('runtime helpers (inlined)')).toBe(layout === 'inline');
    if (layout !== 'inline') expect(outputs.some((output) => /helpers.*\.ts$/.test(output.relativePath))).toBe(true);
    const api = compileGeneratedTypeScript<PublicApi>(outputs, {
      entry: model.relativePath,
      assertions: `
const quote: Quote.Shape = { amount: 5, currency: 'USD' };
const copied: Quote.Shape = Copy(quote);
const portfolio: Portfolio.Shape = { quotes: [quote] };
const inherited: Base = new Child({ value: 1, extra: 'child' });
const one: number = Quote.from(quote).amount.unwrap();
const many: [number, number, ...number[]] = Quote.from([quote, quote]).amount.unwrap();
// @ts-expect-error required currency remains enforced
Quote.from({ amount: 1 });
// @ts-expect-error child factory cannot accept a parent without its fields
Child.from({ value: 1 });
`
    });
    const input = { amount: 5, currency: 'USD' };
    const quote = new api.Quote(input);
    expect(quote.constructor.name).toBe('Quote');
    expect(api.isQuote(quote)).toBe(true);
    expect(api.isQuote({ '@type': 'publicApi.Quote', ...input })).toBe(true);
    expect(api.isQuote({ '@type': 'other.Quote', ...input })).toBe(false);
    expect(api.isQuote({ '@type': 'publicApi.Quote' })).toBe(false);
    expect(api.isQuote({ '@type': 'publicApi.Quote', amount: '5', currency: 'USD' })).toBe(false);
    expect(api.isBase({ '@type': 'publicApi.Base' })).toBe(false);
    expect(api.isChild({ '@type': 'publicApi.Child', value: 1, extra: 2 })).toBe(false);
    expect(api.isChild({ '@type': 'publicApi.Child', value: 1, extra: 'child' })).toBe(true);
    expect(api.Quote.from(input).unwrap()).toBeInstanceOf(api.Quote);
    expect(api.Child.from({ value: 1, extra: 'child' }).unwrap()).toBeInstanceOf(api.Base);
    expect(JSON.parse(JSON.stringify(quote))).toEqual(input);
    const wire = quote.toJSON({ format: 'RUNE_JSON' });
    expect(wire).toEqual({ '@type': 'publicApi.Quote', ...input });
    expect(api.Quote.fromJSON(JSON.stringify(wire), { format: 'RUNE_JSON' }).toJSON()).toMatchObject(input);
    expect(() => api.Quote.fromJSON({ '@type': 'other.Quote', ...input }, { format: 'RUNE_JSON' })).toThrow(
      /not assignable/
    );
    const reference = api.Reference.from({ quote: { value: input, meta: {}, externalReference: 'q1' } });
    const referenceWire = reference.toJSON({ format: 'RUNE_JSON' });
    expect(referenceWire).toMatchObject({ quote: { '@type': 'publicApi.Quote', '@ref:external': 'q1', amount: 5 } });
    expect(api.Reference.fromJSON(referenceWire, { format: 'RUNE_JSON' }).quote.amount.unwrap()).toBe(5);
    expect(api.Tagged.from({ quote: input }).unwrap()).toBeInstanceOf(api.Tagged);
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
    const selected = api.Selection.from({ selected: { quote: input } });
    const selectionWire = selected.toJSON({ format: 'RUNE_JSON' });
    expect(selectionWire).toMatchObject({ selected: { '@type': 'publicApi.Quote', amount: 5 } });
    expect(api.Selection.fromJSON(selectionWire, { format: 'RUNE_JSON' }).selected.quote.amount.unwrap()).toBe(5);
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
    expect(restored.selected.unwrap()).toMatchObject({
      '@model': 'outer-model',
      '@version': '1',
      meta: { globalKey: 'choice-key' }
    });
    expect(restored.selected.quote.amount.unwrap()).toBe(5);
    expect(restored.toJSON({ format: 'RUNE_JSON' })).toEqual(wrappedWire);
  }
);
