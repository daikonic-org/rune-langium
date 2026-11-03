// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect } from 'vitest';
import { renderNode, renderModel, type RenderChild } from '../../../src/emit/rosetta/rosetta-render-core.js';
const regen: RenderChild = (c) => renderNode(c, regen) ?? '';

describe('renderNode — RosettaTypeAlias', () => {
  it('renders typeAlias name: wrappedType', () => {
    const ta = {
      $type: 'RosettaTypeAlias',
      name: 'MyNum',
      definition: undefined,
      parameters: [],
      conditions: [],
      typeCall: { type: { $refText: 'number' } }
    } as never;
    expect(renderNode(ta, regen)).toBe('typeAlias MyNum: number');
  });
  it('renders a definition line', () => {
    const ta = {
      $type: 'RosettaTypeAlias',
      name: 'X',
      definition: 'an alias',
      parameters: [],
      conditions: [],
      typeCall: { type: { $refText: 'string' } }
    } as never;
    expect(renderNode(ta, regen)).toBe('typeAlias X:\n  <"an alias">\n  string');
  });
  it('renders generic type parameters before the colon', () => {
    const ta = {
      $type: 'RosettaTypeAlias',
      name: 'Bounded',
      definition: undefined,
      conditions: [],
      parameters: [
        { $type: 'TypeParameter', name: 'min', typeCall: { type: { $refText: 'int' } } },
        { $type: 'TypeParameter', name: 'max', typeCall: { type: { $refText: 'int' } } }
      ],
      typeCall: { type: { $refText: 'number' } }
    } as never;
    expect(renderNode(ta, regen)).toBe('typeAlias Bounded(min int, max int): number');
  });
  it('preserves wrapped-type call arguments via the child policy', () => {
    // Driver-like child policy: an unchanged TypeCallArgument rides its CST slice.
    const slice: RenderChild = (c) => {
      const n = c as { $type: string; $cstText?: string };
      return n.$type === 'TypeCallArgument' ? (n.$cstText ?? '') : (renderNode(c, slice) ?? '');
    };
    const ta = {
      $type: 'RosettaTypeAlias',
      name: 'Px',
      definition: undefined,
      parameters: [],
      conditions: [],
      typeCall: { type: { $refText: 'number' }, arguments: [{ $type: 'TypeCallArgument', $cstText: 'digits: 18' }] }
    } as never;
    expect(renderNode(ta, slice)).toBe('typeAlias Px: number(digits: 18)');
  });
});

describe('renderModel — QualifiedName support', () => {
  it('retains the native namespace override marker', () => {
    expect(renderModel({ name: 'upstream', overridden: true, elements: [] })).toMatch(/^override namespace upstream\n/);
  });
  it('renders namespace from a segments-based QualifiedName', () => {
    const result = renderModel({ name: { segments: ['a', 'b'] }, version: '1.0.0', elements: [] });
    expect(result.startsWith('namespace a.b')).toBe(true);
  });
});
