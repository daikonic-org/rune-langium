// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { assertValidDocuments, BASICTYPES_ROSETTA, createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import { generate } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';

const source = `namespace codecs
annotation metadata:
 reference string (0..1)
type Quote:
 amount number (1..1)
 date date (1..1)
 time time (1..1)
 pattern pattern (0..1)
 end date (0..1)
 condition Positive: amount > 0
 condition Ordered: if end exists then date <= end
type Special extends Quote:
 note string (1..1)
 extraDate date (1..1)
 condition SpecialAmount: amount > 1
 condition ExtraAfter: extraDate > date
choice Selected:
 Quote
type Tagged extends Selected:
 note string (0..1)
type Portfolio:
 quote Quote (1..1)
 quotes Quote (0..*)
 selected Selected (0..1)
 reference Quote (0..1)
  [metadata reference]
type Node:
 quote Quote (1..1)
 next Node (0..1)
type NestedChecks:
 quote Quote (1..1)
 cutoff date (1..1)
 expected pattern (1..1)
 condition NestedDate: quote -> date <= cutoff
 condition NestedPattern: quote -> pattern = expected
`;

async function documents() {
  const { RuneDsl } = createRuneDslServices();
  const foreign = `namespace codecExtras
import codecs.*
type Foreign extends Quote:
 note string (1..1)
 condition ForeignAmount: amount > 2
`;
  const docs = [BASICTYPES_ROSETTA, source, foreign].map((text, index) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(text, URI.parse(`inmemory:///codecs-${index}.rosetta`))
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
  assertValidDocuments(docs);
  return docs;
}

type View = { [key: string]: unknown; toJSON(options?: { format: 'RUNE_JSON' }): unknown };
type Model = { from(input: unknown): View; fromJSON(input: unknown, options?: { format: 'RUNE_JSON' }): View };
type SchemaCounter = { _zod: { run(...args: unknown[]): unknown } };

it.each(['per-namespace', 'barrel', 'single-file', 'inline'] as const)(
  'imports generated Zod codecs for optional serialization (%s)',
  async (layout) => {
    const outputs = await generate(await documents(), {
      target: 'typescript',
      typescript: { serialization: 'zod', ...(layout === 'inline' ? { inlineHelpers: true } : { layout }) }
    });
    const model = outputs.find((output) => output.content.includes('export class Quote '))!;
    const foreign = outputs.find((output) => output.content.includes('export class Foreign '))!;
    expect(model.content).toContain('.QuoteCodec');
    expect(outputs.some((output) => output.relativePath === 'codecs.zod.ts')).toBe(true);
    const api = compileGeneratedTypeScript<
      Record<'Quote' | 'Special' | 'Portfolio' | 'Tagged' | 'Node' | 'Selected' | 'NestedChecks' | 'Foreign', Model> & {
        NodeCodec: SchemaCounter & { parse(value: unknown): unknown; node?: SchemaCounter };
      }
    >(
      outputs.map((output) =>
        output === model
          ? {
              ...output,
              content: `${output.content}\nexport { NodeCodec } from './codecs.zod.js';${foreign === model ? '' : "\nexport { Foreign } from './codecExtras.js';"}`
            }
          : output
      ),
      { entry: model.relativePath }
    );
    const plain = { amount: 2, date: '2026-11-04', time: '12:30:00', pattern: '^a+$' };
    const quote = api.Quote.fromJSON(plain);
    const value = quote;
    expect(Object.prototype.toString.call(value.date)).toBe('[object Temporal.PlainDate]');
    expect(Object.prototype.toString.call(value.time)).toBe('[object Temporal.PlainTime]');
    expect(value.pattern).toBeInstanceOf(RegExp);
    expect(quote.toJSON()).toEqual(plain);
    expect(() => api.Quote.fromJSON({ ...plain, amount: -1 })).toThrow();
    expect(() => api.Quote.fromJSON({ ...plain, date: '2026-02-30' })).toThrow();
    expect(() => api.Quote.fromJSON({ ...plain, end: '2026-11-03' })).toThrow();
    expect(() => api.Quote.fromJSON({ ...plain, pattern: '[' })).toThrow();
    expect(() =>
      api.Quote.from({
        ...plain,
        date: Temporal.PlainDate.from(plain.date),
        time: Temporal.PlainTime.from(plain.time),
        pattern: /a/i
      }).toJSON()
    ).toThrow(/flags/);
    const options = { format: 'RUNE_JSON' as const };
    const wire = { '@type': 'codecs.Special', ...plain, note: 'special', extraDate: '2026-11-05' };
    const portfolio = {
      '@type': 'codecs.Portfolio',
      quote: wire,
      quotes: [wire],
      selected: wire,
      reference: { ...wire, '@ref:external': 'q1' }
    };
    expect(api.Portfolio.fromJSON(portfolio, options).toJSON(options)).toEqual(portfolio);
    for (const invalid of [
      { ...wire, amount: 1 },
      { ...wire, extraDate: '2026-11-03' }
    ]) {
      expect(() => api.Special.fromJSON(invalid, options)).toThrow();
      for (const field of ['quote', 'quotes', 'selected', 'reference']) {
        const value =
          field === 'quotes' ? [invalid] : field === 'reference' ? { ...invalid, '@ref:external': 'q1' } : invalid;
        expect(() => api.Portfolio.fromJSON({ ...portfolio, [field]: value }, options)).toThrow();
      }
      expect(() => api.Portfolio.fromJSON({ quote: invalid })).toThrow();
    }
    const nested = api.Portfolio.fromJSON({ quote: wire }, options);
    expect(nested.toJSON()).toMatchObject({ quote: { extraDate: '2026-11-05' } });
    const nativeSpecial = api.Special.from({
      ...plain,
      date: Temporal.PlainDate.from(plain.date),
      time: Temporal.PlainTime.from(plain.time),
      pattern: /^a+$/,
      note: 'special',
      extraDate: Temporal.PlainDate.from('2026-11-05')
    });
    const nativePortfolio = api.Portfolio.from({ quote: nativeSpecial });
    expect(nativePortfolio.toJSON()).toMatchObject({ quote: { extraDate: '2026-11-05' } });
    Reflect.set(nativeSpecial, 'amount', 1);
    expect(() => nativePortfolio.toJSON()).toThrow();
    expect(api.Quote.fromJSON([wire, wire], options).toJSON(options)).toEqual([wire, wire]);
    expect(api.Selected.fromJSON(wire, options).toJSON(options)).toEqual(wire);
    expect(() => api.Selected.fromJSON({ ...wire, amount: -1 }, options)).toThrow();
    const tagged = { '@type': 'codecs.Tagged', quote: wire, note: 'tag' };
    expect(api.Tagged.fromJSON(tagged, options).toJSON(options)).toEqual(tagged);
    const recursive = { quote: plain, next: { quote: plain } };
    expect(api.Node.fromJSON(recursive).toJSON()).toEqual(recursive);
    const checks = { quote: plain, cutoff: plain.date, expected: plain.pattern };
    expect(api.NestedChecks.fromJSON(checks).toJSON()).toEqual(checks);
    expect(() => api.NestedChecks.fromJSON({ ...checks, cutoff: '2026-11-03' })).toThrow();
    expect(() => api.NestedChecks.fromJSON({ ...checks, expected: '^different$' })).toThrow();
    const foreignWire = { ...plain, '@type': 'codecExtras.Foreign', amount: 3, note: 'foreign' };
    expect(api.Portfolio.fromJSON({ quote: foreignWire }, options).toJSON(options)).toEqual({
      '@type': 'codecs.Portfolio',
      quote: foreignWire
    });
    expect(() => api.Portfolio.fromJSON({ quote: { ...foreignWire, amount: 2 } }, options)).toThrow();
    expect(() => api.Node.fromJSON({ quote: plain, next: { quote: { ...plain, amount: -1 } } })).toThrow();
    expect(() => api.NodeCodec.parse({ quote: plain, next: { quote: { ...plain, amount: -1 } } })).toThrow();
    expect(() => api.Node.fromJSON({ quote: plain, next: null })).toThrow();
    const cyclic: { quote: typeof plain; next?: unknown } = { quote: plain };
    cyclic.next = cyclic;
    expect(() => api.Node.fromJSON(cyclic)).toThrow(/cyclic/);
    const schemaRuns = [api.NodeCodec, ...(api.NodeCodec.node ? [api.NodeCodec.node] : [])].map((schema) =>
      vi.spyOn(schema._zod, 'run')
    );
    const count = () => schemaRuns.reduce((total, run) => total + run.mock.calls.length, 0);
    const clear = () => schemaRuns.forEach((run) => run.mockClear());
    try {
      for (const format of [undefined, options])
        for (const depth of [8, 16, 32]) {
          let input: { quote: typeof plain & { '@type'?: string }; next?: unknown; '@type'?: string } | undefined;
          for (let index = 0; index < depth; index++)
            input = {
              quote: format ? { ...plain, '@type': 'codecs.Quote' } : plain,
              ...(format ? { '@type': 'codecs.Node' } : {}),
              ...(input ? { next: input } : {})
            };
          clear();
          api.NodeCodec.parse(input);
          expect(count()).toBe(depth);
          clear();
          const decoded = api.Node.fromJSON(input, format);
          expect(count()).toBeLessThanOrEqual(4 * depth);
          clear();
          expect(decoded.toJSON(format)).toEqual(input);
          expect(count()).toBeLessThanOrEqual(4 * depth);
        }
    } finally {
      schemaRuns.forEach((run) => run.mockRestore());
    }
  }
);

it('keeps default TypeScript output independent of Zod', async () => {
  const outputs = await generate(await documents(), { target: 'typescript' });
  expect(outputs.some((output) => output.relativePath.endsWith('.zod.ts'))).toBe(false);
  expect(outputs.some((output) => /from ['"].*\.zod\.js/.test(output.content))).toBe(false);
});

it.each(['per-namespace', 'barrel', 'single-file'] as const)('exposes standalone Zod codecs (%s)', async (layout) => {
  const outputs = await generate(await documents(), { target: 'zod', zod: { codecs: true, layout } });
  const model = outputs.find((output) => output.content.includes('export const QuoteCodec'))!;
  const api = compileGeneratedTypeScript<{
    QuoteCodec: { parse(value: unknown): unknown; encode(value: unknown): unknown };
  }>(outputs, { entry: model.relativePath });
  const plain = { amount: 2, date: '2026-11-04', time: '12:30:00' };
  expect(api.QuoteCodec.encode(api.QuoteCodec.parse(plain))).toEqual(plain);
});
