// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { buildSourceForNamespaces, useModelSourceSync } from '../../src/hooks/useModelSourceSync.js';
import type { Patches } from 'mutative';
import type { TypeGraphNode } from '../../src/types.js';

describe('buildSourceForNamespaces', () => {
  it('returns one entry per namespace, reusing source when clean', () => {
    const src = 'namespace test\nversion "1.0.0"\n\ntype Foo:\n  bar string (0..1)\n';
    const node = {
      id: 'test.Foo',
      meta: { namespace: 'test', deferred: false },
      data: {
        $type: 'Data',
        name: 'Foo',
        $cstRange: { offset: src.indexOf('type Foo'), end: src.length - 1 },
        attributes: [],
        conditions: [],
        annotations: [],
        references: [],
        synonyms: []
      }
    } as unknown as TypeGraphNode;

    const out = buildSourceForNamespaces({
      nodes: [node],
      edges: [],
      originalSourceByNamespace: new Map([['test', src]]),
      patches: [] as unknown as Patches
    });

    expect(out.get('test')).toBe(src);
  });
});

describe('useModelSourceSync — deleting the LAST node in the whole graph', () => {
  it('still emits the removal (does not bail on nodes.length === 0)', () => {
    const src = 'namespace test\nversion "1.0.0"\n\ntype Foo:\n  bar string (0..1)\n';
    const range = { offset: src.indexOf('type Foo'), end: src.length - 1 };
    const node = {
      id: 'test.Foo',
      meta: { namespace: 'test', deferred: false },
      data: {
        $type: 'Data',
        name: 'Foo',
        $cstRange: range,
        attributes: [],
        conditions: [],
        annotations: [],
        references: [],
        synonyms: []
      }
    } as unknown as TypeGraphNode;
    // Inverse patch of `draft.nodes.delete('test.Foo')` — carries the deleted
    // node (with its $cstRange + namespace) so the renderer can drop its range.
    const removal = [{ op: 'add', path: ['nodes', 'test.Foo'], value: node }] as unknown as Patches;
    const original = new Map([['test', src]]);
    const onChanged = vi.fn();

    // Render 1 (mount): the node is present — establishes the serialize baseline
    // (the hook intentionally suppresses the first emission).
    const { rerender } = renderHook(
      ({ nodes, patches, inverse }) => useModelSourceSync(nodes, [], onChanged, 0, patches, original, inverse),
      { initialProps: { nodes: [node], patches: [] as unknown as Patches, inverse: [] as unknown as Patches } }
    );
    expect(onChanged).not.toHaveBeenCalled();

    // Render 2: the sole node is deleted → nodes is empty, but the inverse patch
    // carries the removal. The handler MUST fire with the namespace emptied.
    rerender({ nodes: [], patches: removal, inverse: removal });

    expect(onChanged).toHaveBeenCalledTimes(1);
    const emitted = onChanged.mock.calls[0]![0] as Map<string, string>;
    const text = emitted.get('test')!;
    expect(text).toContain('namespace test');
    expect(text).toContain('version "1.0.0"');
    expect(text).not.toContain('type Foo:');
  });
});

it('does not serialize reference data into the writable source fingerprint', () => {
  const referenceJson = vi.fn(() => ({ name: 'Reference' }));
  const reference = {
    id: 'reference.Type',
    meta: { namespace: 'reference', deferred: false },
    data: { $type: 'Data', name: 'Reference', toJSON: referenceJson }
  } as unknown as TypeGraphNode;
  const handler = vi.fn();
  const source = new Map([['local', 'namespace local\n']]);
  const { rerender } = renderHook(({ nodes }) => useModelSourceSync(nodes, [], handler, 0, [], source, []), {
    initialProps: { nodes: [reference] }
  });
  rerender({ nodes: [{ ...reference, data: { ...reference.data, name: 'Changed reference' } } as TypeGraphNode] });
  expect(referenceJson).not.toHaveBeenCalled();
  expect(handler).not.toHaveBeenCalled();
});
