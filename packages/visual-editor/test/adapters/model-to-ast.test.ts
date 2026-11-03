// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Unit tests for the model → AST adapter (`modelsToAst`).
 *
 * Cross-namespace inheritance seam (X/X⁻¹ pair): parse/edit stores a
 * namespace-QUALIFIED `$refText` (e.g. `"ns.a.Base"`) on `node.data` when the
 * parent lives in another namespace (or a bare-name collision exists).
 * Serialization must re-emit that qualified ref VERBATIM — re-deriving a bare
 * name from the inheritance edge mislinks (or fails to link) on reparse.
 */

import { describe, it, expect } from 'vitest';
import { modelsToAst } from '../../src/adapters/model-to-ast.js';
import type { TypeGraphNode, TypeGraphEdge, GraphNodeMeta } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeta(namespace: string, extra?: Partial<GraphNodeMeta>): GraphNodeMeta {
  return { namespace, errors: [], hasExternalRefs: false, ...extra };
}

function makeNode(
  namespace: string,
  name: string,
  data: Record<string, unknown>,
  extraMeta?: Partial<GraphNodeMeta>
): TypeGraphNode {
  return {
    id: `${namespace}.${name}`,
    type: 'data',
    position: { x: 0, y: 0 },
    data: { name, ...data } as unknown as TypeGraphNode['data'],
    meta: makeMeta(namespace, extraMeta)
  };
}

function makeInheritanceEdge(kind: 'extends' | 'enum-extends', source: string, target: string): TypeGraphEdge {
  return {
    id: `${kind}:${source}->${target}`,
    source,
    target,
    type: 'inheritance',
    data: { kind, label: 'extends' }
  } as TypeGraphEdge;
}

function elementsOf(models: ReturnType<typeof modelsToAst>, namespace: string): Record<string, unknown>[] {
  const model = models.find((m) => m.name === namespace);
  expect(model).toBeDefined();
  return model!.elements as Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Cross-namespace inheritance qualification (Finding 1a)
// ---------------------------------------------------------------------------

describe('modelsToAst — cross-namespace inheritance qualification', () => {
  it('preserves the native namespace marker when exporting an override graph', () => {
    const node = makeNode('upstream', 'Value', { $type: 'Data', attributes: [] }, { namespaceOverride: true });
    expect(modelsToAst([node], [])[0]).toMatchObject({ name: 'upstream', overridden: true });
  });
  it('preserves a QUALIFIED Data superType $refText from node.data (does not re-derive bare name from edge)', () => {
    const parent = makeNode('ns.a', 'Base', { $type: 'Data', attributes: [] });
    const child = makeNode('ns.b', 'Child', {
      $type: 'Data',
      attributes: [],
      superType: { $refText: 'ns.a.Base' }
    });
    const edges = [makeInheritanceEdge('extends', child.id, parent.id)];

    const models = modelsToAst([parent, child], edges);
    const childOut = elementsOf(models, 'ns.b').find((e) => e.name === 'Child')!;

    expect((childOut.superType as { $refText?: string }).$refText).toBe('ns.a.Base');
  });

  it('preserves a QUALIFIED RosettaEnumeration parent $refText from node.data', () => {
    const parent = makeNode('ns.a', 'BaseEnum', { $type: 'RosettaEnumeration', enumValues: [] });
    const child = makeNode('ns.b', 'ChildEnum', {
      $type: 'RosettaEnumeration',
      enumValues: [],
      parent: { $refText: 'ns.a.BaseEnum' }
    });
    const edges = [makeInheritanceEdge('enum-extends', child.id, parent.id)];

    const models = modelsToAst([parent, child], edges);
    const childOut = elementsOf(models, 'ns.b').find((e) => e.name === 'ChildEnum')!;

    expect((childOut.parent as { $refText?: string }).$refText).toBe('ns.a.BaseEnum');
  });

  it('preserves a QUALIFIED RosettaFunction superFunction $refText from node.data', () => {
    const parent = makeNode('ns.a', 'BaseFunc', { $type: 'RosettaFunction', inputs: [] });
    const child = makeNode('ns.b', 'ChildFunc', {
      $type: 'RosettaFunction',
      inputs: [],
      superFunction: { $refText: 'ns.a.BaseFunc' }
    });
    const edges = [makeInheritanceEdge('extends', child.id, parent.id)];

    const models = modelsToAst([parent, child], edges);
    const childOut = elementsOf(models, 'ns.b').find((e) => e.name === 'ChildFunc')!;

    expect((childOut.superFunction as { $refText?: string }).$refText).toBe('ns.a.BaseFunc');
  });

  it('excludes deferred placeholder nodes from serialization (never user-authored source)', () => {
    // Curated deferred-export placeholders (`meta.deferred === true`) are
    // `{ $type, name }` stubs for namespaces the user did NOT author. They
    // must never produce serialized elements — through ANY caller of
    // modelsToAst (useModelSourceSync, exportRosetta, future call sites).
    const authored = makeNode('ns.a', 'Real', { $type: 'Data', attributes: [] });
    const stub = makeNode('other.curated', 'Stub', { $type: 'Data' }, { deferred: true });

    const models = modelsToAst([authored, stub], []);

    expect(models.map((m) => m.name)).toEqual(['ns.a']);
    expect(models.find((m) => m.name === 'other.curated')).toBeUndefined();
  });

  it('falls back to the edge-derived bare name when node.data lacks the ref', () => {
    // e.g. an inheritance edge created without the data-side ref (legacy path):
    // serialization must still reflect the edge so the relationship isn't lost.
    const parent = makeNode('ns.a', 'Base', { $type: 'Data', attributes: [] });
    const child = makeNode('ns.a', 'Child', { $type: 'Data', attributes: [] });
    const edges = [makeInheritanceEdge('extends', child.id, parent.id)];

    const models = modelsToAst([parent, child], edges);
    const childOut = elementsOf(models, 'ns.a').find((e) => e.name === 'Child')!;

    expect((childOut.superType as { $refText?: string }).$refText).toBe('Base');
  });
});
