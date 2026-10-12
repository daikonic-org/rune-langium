// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect } from 'vitest';
import { parse, parsedAdapter } from '@rune-langium/core';
import { renderNode, type RenderChild } from '../../../src/emit/rosetta/rosetta-render-core.js';
const regen: RenderChild = (c) => renderNode(c, regen) ?? '';

describe('renderNode — annotations & synonyms', () => {
  it('renders an annotation ref (annotation + attribute)', () => {
    const a = {
      $type: 'AnnotationRef',
      annotation: { $refText: 'metadata' },
      attribute: { $refText: 'scheme' },
      qualifiers: []
    } as never;
    expect(renderNode(a, regen)).toBe('[metadata scheme]');
  });
  it('renders an annotation ref (annotation only)', () => {
    const a = {
      $type: 'AnnotationRef',
      annotation: { $refText: 'rootType' },
      attribute: undefined,
      qualifiers: []
    } as never;
    expect(renderNode(a, regen)).toBe('[rootType]');
  });
  it('renders a class synonym (the inspector-produced source shape)', () => {
    const s = {
      $type: 'RosettaClassSynonym',
      sources: [{ $refText: 'FpML' }],
      value: undefined,
      metaValue: undefined
    } as never;
    expect(renderNode(s, regen)).toBe('[synonym FpML]');
  });
  it('renders a class synonym with an optional value (escaped)', () => {
    const s = {
      $type: 'RosettaClassSynonym',
      sources: [{ $refText: 'FpML' }],
      value: { name: 'a "quoted" v' }
    } as never;
    expect(renderNode(s, regen)).toBe('[synonym FpML value "a \\"quoted\\" v"]');
  });
  it('renders a cross-namespace qualified class synonym verbatim (plan L15 serialize half)', () => {
    // The UI picker writes the qualified id (`other.FIX`) as $refText for cross-ns sources.
    // renderClassSynonym must emit it verbatim — no further qualify / strip.
    const s = { $type: 'RosettaClassSynonym', sources: [{ $refText: 'other.FIX' }], value: undefined } as never;
    expect(renderNode(s, regen)).toBe('[synonym other.FIX]');
  });
  it('renders an enum-level RosettaSynonym (source + value body)', () => {
    const s = {
      $type: 'RosettaSynonym',
      sources: [{ $refText: 'FpML' }],
      body: { values: [{ name: 'tradeDate' }] }
    } as never;
    expect(renderNode(s, regen)).toBe('[synonym FpML value "tradeDate"]');
  });
  it('returns null for a non-value-body RosettaSynonym (hint/meta/mappingLogic → CST fallback)', () => {
    // RosettaSynonymBody has alternatives beyond value (hint, mappingLogic, meta, etc.).
    // When body.values is absent/empty, renderSynonym returns null so renderNode falls
    // back to CST and preserves the original body rather than emitting `[synonym src value ]`.
    const s = { $type: 'RosettaSynonym', sources: [{ $refText: 'FpML' }], body: {} } as never;
    expect(renderNode(s, regen)).toBeNull();
  });
  it('escapes the enum-value synonym STRING', () => {
    const s = { $type: 'RosettaEnumSynonym', sources: [{ $refText: 'FIX' }], synonymValue: 'a"b\\c' } as never;
    expect(renderNode(s, regen)).toBe('[synonym FIX value "a\\"b\\\\c"]');
  });
  it('quotes and escapes annotation qualifier name/value', () => {
    const a = {
      $type: 'AnnotationRef',
      annotation: { $refText: 'metadata' },
      attribute: { $refText: 'scheme' },
      qualifiers: [{ qualName: 'k"1', qualValue: 'v\\2' }]
    } as never;
    expect(renderNode(a, regen)).toBe('[metadata scheme "k\\"1"="v\\\\2"]');
  });
});

it('round-trips parsed annotation qualifier paths and empty STRING names', async () => {
  const source = `namespace demo
version "1"
annotation marking:
  scheme string (1..1)
type Person:
  name string (1..1)
    [marking scheme ""="" "path"=Person -> name]
`;
  const result = await parse(source);
  expect(result.hasErrors).toBe(false);
  const data = result.value.elements.find((element) => element.$type === 'Data');
  if (!data || data.$type !== 'Data') throw new Error('Missing fixture type');
  const annotation = data.attributes[0]!.annotations[0]!;
  const rendered = regen(parsedAdapter.dehydrate(annotation));
  expect(rendered).toBe('[marking scheme ""="" "path"=Person -> name]');
  const reparsed = await parse(source.replace('[marking scheme ""="" "path"=Person -> name]', rendered));
  expect(reparsed.hasErrors).toBe(false);
});
