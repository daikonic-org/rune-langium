// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect } from 'vitest';
import { renderNode, type RenderChild } from '../../../src/emit/rosetta/rosetta-render-core.js';

// Child policy for tests: always regenerate; throw if a child is unimplemented
// (the tests below only use implemented children).
const regen: RenderChild = (c) => {
  const t = renderNode(c, regen);
  if (t === null) throw new Error(`unimplemented child ${(c as { $type: string }).$type}`);
  return t;
};

describe('renderNode — implemented scalars', () => {
  it('preserves schema documentation when regenerating upstream declarations', () => {
    expect(
      regen({
        $type: 'Schema',
        name: 'FpML',
        format: { $refText: 'XML' },
        definition: 'Schema serialization guidance',
        annotations: []
      } as never)
    ).toBe('schema FpML XML\n  <"Schema serialization guidance">');
  });
  it('renders schema declarations and their annotations', () => {
    expect(
      regen({
        $type: 'Schema',
        name: 'FpML',
        format: { $refText: 'XML' },
        annotations: [{ $type: 'AnnotationRef', annotation: { $refText: 'namespace' }, qualifiers: [] }]
      } as never)
    ).toBe('schema FpML XML\n  [namespace]');
  });
  it('emits a Data header with extends and definition', () => {
    const node = {
      $type: 'Data',
      name: 'Foo',
      superType: { $refText: 'Bar' },
      definition: 'a foo',
      annotations: [],
      references: [],
      synonyms: [],
      conditions: [],
      attributes: [
        {
          $type: 'Attribute',
          name: 'bar',
          override: false,
          typeCall: { type: { $refText: 'string' } },
          card: { $type: 'RosettaCardinality', inf: 0, sup: 1, unbounded: false },
          annotations: [],
          references: [],
          synonyms: [],
          labels: [],
          ruleReferences: [],
          typeCallArgs: []
        }
      ]
    } as never;

    expect(renderNode(node, regen)).toBe('type Foo extends Bar:\n' + '  <"a foo">\n' + '  bar string (0..1)');
  });

  it('emits an unbounded cardinality as (n..*)', () => {
    const attr = {
      $type: 'Attribute',
      name: 'xs',
      override: false,
      typeCall: { type: { $refText: 'string' } },
      card: { $type: 'RosettaCardinality', inf: 1, sup: undefined, unbounded: true },
      annotations: [],
      references: [],
      synonyms: [],
      labels: [],
      ruleReferences: [],
      typeCallArgs: []
    } as never;
    expect(renderNode(attr, regen)).toBe('xs string (1..*)');
  });

  it('emits override and a missing definition', () => {
    const attr = {
      $type: 'Attribute',
      name: 'y',
      override: true,
      typeCall: { type: { $refText: 'int' } },
      card: { $type: 'RosettaCardinality', inf: 0, sup: 0, unbounded: false },
      annotations: [],
      references: [],
      synonyms: [],
      labels: [],
      ruleReferences: [],
      typeCallArgs: []
    } as never;
    expect(renderNode(attr, regen)).toBe('override y int (0..0)');
  });

  it('preserves inline type-call args on an attribute via the child policy', () => {
    // Driver-like policy: an unchanged TypeCallArgument rides its CST slice.
    const slice: RenderChild = (c) => {
      const n = c as { $type: string; $cstText?: string };
      if (n.$type === 'TypeCallArgument') return n.$cstText ?? '';
      const t = renderNode(c, slice);
      if (t === null) throw new Error(`unimplemented child ${n.$type}`);
      return t;
    };
    const attr = {
      $type: 'Attribute',
      name: 'amount',
      override: false,
      typeCall: { type: { $refText: 'number' } },
      card: { $type: 'RosettaCardinality', inf: 1, sup: 1, unbounded: false },
      annotations: [],
      references: [],
      synonyms: [],
      labels: [],
      ruleReferences: [],
      typeCallArgs: [{ $type: 'TypeCallArgument', $cstText: 'digits: 18' }]
    } as never;
    expect(renderNode(attr, slice)).toBe('amount number(digits: 18) (1..1)');
  });

  it('preserves type-call args on a choice option via the child policy', () => {
    const slice: RenderChild = (c) => {
      const n = c as { $type: string; $cstText?: string };
      if (n.$type === 'TypeCallArgument') return n.$cstText ?? '';
      const t = renderNode(c, slice);
      if (t === null) throw new Error(`unimplemented child ${n.$type}`);
      return t;
    };
    const opt = {
      $type: 'ChoiceOption',
      typeCall: { type: { $refText: 'Money' }, arguments: [{ $type: 'TypeCallArgument', $cstText: 'ccy: "USD"' }] },
      annotations: [],
      references: [],
      synonyms: [],
      labels: [],
      ruleReferences: []
    } as never;
    expect(renderNode(opt, slice)).toBe('Money(ccy: "USD")');
  });

  it('emits a choice with options', () => {
    const node = {
      $type: 'Choice',
      name: 'Pick',
      annotations: [],
      synonyms: [],
      attributes: [
        {
          $type: 'ChoiceOption',
          typeCall: { type: { $refText: 'A' } },
          annotations: [],
          references: [],
          synonyms: [],
          labels: [],
          ruleReferences: []
        },
        {
          $type: 'ChoiceOption',
          typeCall: { type: { $refText: 'B' } },
          annotations: [],
          references: [],
          synonyms: [],
          labels: [],
          ruleReferences: []
        }
      ]
    } as never;
    expect(renderNode(node, regen)).toBe('choice Pick:\n  A\n  B');
  });

  it('emits an enum with extends, displayName and values', () => {
    const node = {
      $type: 'RosettaEnumeration',
      name: 'Color',
      parent: { $refText: 'BaseColor' },
      definition: undefined,
      annotations: [],
      references: [],
      synonyms: [],
      enumValues: [
        {
          $type: 'RosettaEnumValue',
          name: 'RED',
          display: 'Red',
          definition: undefined,
          annotations: [],
          references: [],
          enumSynonyms: []
        },
        {
          $type: 'RosettaEnumValue',
          name: 'GREEN',
          display: undefined,
          definition: undefined,
          annotations: [],
          references: [],
          enumSynonyms: []
        }
      ]
    } as never;
    expect(renderNode(node, regen)).toBe('enum Color extends BaseColor:\n' + '  RED displayName "Red"\n' + '  GREEN');
  });

  it('renders a minimal RosettaFunction with no children', () => {
    const fn = { $type: 'RosettaFunction', name: 'DoIt' } as never;
    expect(renderNode(fn, regen)).toBe('func DoIt:');
  });
});
