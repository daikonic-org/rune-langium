// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Unit tests for buildMergedAttributeList and buildMergedEnumValueList helpers.
 */

import { describe, it, expect } from 'vitest';
import { buildMergedAttributeList, buildMergedEnumValueList } from '../../src/hooks/useInheritedMembers.js';
import { parseCardinality } from '../../src/adapters/model-helpers.js';
import type { InheritedGroup } from '../../src/hooks/useInheritedMembers.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAttrMember(name: string, type = 'string', card = '(1..1)'): Record<string, unknown> {
  const parsed = parseCardinality(card);
  return {
    $type: 'Attribute',
    name,
    typeCall: { $type: 'TypeCall', type: { $refText: type } },
    card: { inf: parsed.inf, sup: parsed.sup, unbounded: parsed.unbounded },
    override: false
  };
}

function makeEnumMember(name: string, display = ''): Record<string, unknown> {
  return { $type: 'RosettaEnumValue', name, display };
}

function makeGroup(ancestorName: string, members: unknown[]): InheritedGroup {
  return { ancestorName, namespace: 'test', kind: 'data', members };
}

// ---------------------------------------------------------------------------
// buildMergedAttributeList
// ---------------------------------------------------------------------------

describe('buildMergedAttributeList', () => {
  it('returns only local entries when no inherited groups', () => {
    const local = [
      { id: 'f1', name: 'amount' },
      { id: 'f2', name: 'currency' }
    ];
    const result = buildMergedAttributeList(local, []);
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.isLocal)).toBe(true);
  });

  it('appends inherited entries after local entries', () => {
    const local = [{ id: 'f1', name: 'amount' }];
    const groups = [makeGroup('Parent', [makeAttrMember('tradeDate')])];
    const result = buildMergedAttributeList(local, groups);
    expect(result).toHaveLength(2);
    expect(result[0]?.isLocal).toBe(true);
    expect(result[1]?.isLocal).toBe(false);
    if (!result[1]?.isLocal) {
      expect(result[1]?.name).toBe('tradeDate');
      expect(result[1]?.inheritedFrom.ancestorName).toBe('Parent');
      expect(result[1]?.inheritedFrom.inheritanceDepth).toBe(1);
    }
  });

  it('shadows inherited member when local has same name', () => {
    const local = [{ id: 'f1', name: 'tradeDate' }];
    const groups = [makeGroup('Parent', [makeAttrMember('tradeDate')])];
    const result = buildMergedAttributeList(local, groups);
    expect(result).toHaveLength(1);
    expect(result[0]?.isLocal).toBe(true);
  });

  it('assigns incrementing inheritanceDepth across ancestors', () => {
    const local: { id: string; name: string }[] = [];
    const groups = [makeGroup('Parent', [makeAttrMember('a')]), makeGroup('Grandparent', [makeAttrMember('b')])];
    const result = buildMergedAttributeList(local, groups);
    const depths = result.filter((e) => !e.isLocal).map((e) => (!e.isLocal ? e.inheritedFrom.inheritanceDepth : -1));
    expect(depths).toEqual([1, 2]);
  });

  it('deeper ancestor does not re-introduce name already shadowed by nearer ancestor', () => {
    const local: { id: string; name: string }[] = [];
    const groups = [
      makeGroup('Parent', [makeAttrMember('shared')]),
      makeGroup('Grandparent', [makeAttrMember('shared')])
    ];
    const result = buildMergedAttributeList(local, groups);
    const sharedRows = result.filter((e) => !e.isLocal && e.name === 'shared');
    expect(sharedRows).toHaveLength(1);
  });

  it('preserves fieldIndex correctly for local entries', () => {
    const local = [
      { id: 'f0', name: 'a' },
      { id: 'f1', name: 'b' },
      { id: 'f2', name: 'c' }
    ];
    const result = buildMergedAttributeList(local, []);
    result.forEach((e, i) => {
      if (e.isLocal) {
        expect(e.fieldIndex).toBe(i);
      }
    });
  });

  it('empty local and empty groups returns empty array', () => {
    expect(buildMergedAttributeList([], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildMergedEnumValueList
// ---------------------------------------------------------------------------

describe('buildMergedEnumValueList', () => {
  it('returns only local entries when no inherited groups', () => {
    const local = [{ id: 'v1', name: 'USD' }];
    const result = buildMergedEnumValueList(local, []);
    expect(result).toHaveLength(1);
    expect(result[0]?.isLocal).toBe(true);
  });

  it('appends inherited values after local values', () => {
    const local = [{ id: 'v1', name: 'USD' }];
    const groups = [makeGroup('ParentEnum', [makeEnumMember('EUR', 'Euro')])];
    const result = buildMergedEnumValueList(local, groups);
    expect(result).toHaveLength(2);
    expect(result[1]?.isLocal).toBe(false);
    if (!result[1]?.isLocal) {
      expect(result[1]?.name).toBe('EUR');
      expect(result[1]?.displayName).toBe('Euro');
      expect(result[1]?.inheritedFrom.ancestorName).toBe('ParentEnum');
    }
  });

  it('local value shadows inherited value with same name', () => {
    const local = [{ id: 'v1', name: 'EUR' }];
    const groups = [makeGroup('ParentEnum', [makeEnumMember('EUR', 'Euro')])];
    const result = buildMergedEnumValueList(local, groups);
    expect(result).toHaveLength(1);
    expect(result[0]?.isLocal).toBe(true);
  });

  it('generates stable ids for inherited entries', () => {
    const local: { id: string; name: string }[] = [];
    const groups = [makeGroup('ParentEnum', [makeEnumMember('EUR')])];
    const result = buildMergedEnumValueList(local, groups);
    expect(result[0]?.id).toBe('inherited:ParentEnum:EUR');
  });
});

// ---------------------------------------------------------------------------
// useEffectiveMembers
// ---------------------------------------------------------------------------

import { renderHook } from '@testing-library/react';
import { useEffectiveMembers, useInheritedMembers } from '../../src/hooks/useInheritedMembers.js';
import type { AnyGraphNode, TypeGraphNode } from '../../src/types.js';
import { testMeta } from '../helpers/node-meta.js';
import { selectNodeRepository } from '../../src/store/node-repository.js';

function makeDataNode(name: string, superType: string | undefined, attrs: Record<string, unknown>[]) {
  const data = {
    $type: 'Data',
    name,
    namespace: 'test',
    superType: superType ? { $refText: superType } : undefined,
    attributes: attrs,
    position: { x: 0, y: 0 },
    errors: [],
    isReadOnly: false,
    hasExternalRefs: false
  };
  return {
    id: `test.${name}`,
    type: 'data',
    position: { x: 0, y: 0 },
    data,
    meta: testMeta('test')
  } as unknown as TypeGraphNode;
}

function makeEnumNode(name: string, parent: string | undefined, values: Record<string, unknown>[]) {
  const data = {
    $type: 'RosettaEnumeration',
    name,
    namespace: 'test',
    parent: parent ? { $refText: parent } : undefined,
    enumValues: values,
    position: { x: 0, y: 0 },
    errors: [],
    isReadOnly: false,
    hasExternalRefs: false
  };
  return {
    id: `test.${name}`,
    type: 'enum',
    position: { x: 0, y: 0 },
    data,
    meta: testMeta('test')
  } as unknown as TypeGraphNode;
}

describe('useEffectiveMembers', () => {
  function renderEffective(nodeData: unknown, allNodes: unknown[]) {
    const { result } = renderHook(() => useEffectiveMembers(nodeData as AnyGraphNode, allNodes as TypeGraphNode[]));
    return result.current;
  }

  it('returns empty effective list for null node', () => {
    const { effective } = renderEffective(null, []);
    expect(effective).toEqual([]);
  });

  it('returns local-only entries when no parent', () => {
    const node = makeDataNode('Foo', undefined, [makeAttrMember('x', 'string')]);
    const { effective } = renderEffective(node.data, [node]);
    expect(effective).toHaveLength(1);
    expect(effective[0]!.source).toBe('local');
    expect(effective[0]!.name).toBe('x');
    expect(effective[0]!.isOverride).toBe(false);
  });

  it('merges inherited members after local', () => {
    const parent = makeDataNode('Parent', undefined, [makeAttrMember('a', 'int')]);
    const child = makeDataNode('Child', 'Parent', [makeAttrMember('b', 'string')]);
    const { effective } = renderEffective(child.data, [child, parent]);
    expect(effective).toHaveLength(2);
    expect(effective[0]).toMatchObject({ name: 'b', source: 'local' });
    expect(effective[1]).toMatchObject({ name: 'a', source: 'inherited', ancestorName: 'Parent' });
  });

  it('marks local member as override when it shadows inherited', () => {
    const parent = makeDataNode('Parent', undefined, [makeAttrMember('x', 'int')]);
    const child = makeDataNode('Child', 'Parent', [makeAttrMember('x', 'string')]);
    const { effective, overrideNames } = renderEffective(child.data, [child, parent]);
    expect(effective).toHaveLength(1);
    expect(effective[0]).toMatchObject({ name: 'x', source: 'local', isOverride: true });
    expect(overrideNames.has('x')).toBe(true);
  });

  it('tracks inheritedNames including shadowed ones', () => {
    const parent = makeDataNode('Parent', undefined, [makeAttrMember('x', 'int')]);
    const child = makeDataNode('Child', 'Parent', [makeAttrMember('x', 'string')]);
    const { inheritedNames } = renderEffective(child.data, [child, parent]);
    expect(inheritedNames.has('x')).toBe(true);
  });

  it('works for enum types', () => {
    const parent = makeEnumNode('ParentEnum', undefined, [makeEnumMember('A'), makeEnumMember('B')]);
    const child = makeEnumNode('ChildEnum', 'ParentEnum', [makeEnumMember('C')]);
    const { effective } = renderEffective(child.data, [child, parent]);
    expect(effective).toHaveLength(3);
    expect(effective[0]).toMatchObject({ name: 'C', source: 'local' });
    expect(effective[1]).toMatchObject({ name: 'A', source: 'inherited' });
    expect(effective[2]).toMatchObject({ name: 'B', source: 'inherited' });
  });

  it('revert: removing local override reveals inherited member', () => {
    const parent = makeDataNode('Parent', undefined, [makeAttrMember('x', 'int')]);

    const childWithOverride = makeDataNode('Child', 'Parent', [makeAttrMember('x', 'string')]);
    const r1 = renderEffective(childWithOverride.data, [childWithOverride, parent]);
    expect(r1.effective).toHaveLength(1);
    expect(r1.effective[0]!.source).toBe('local');

    const childWithoutOverride = makeDataNode('Child', 'Parent', []);
    const r2 = renderEffective(childWithoutOverride.data, [childWithoutOverride, parent]);
    expect(r2.effective).toHaveLength(1);
    expect(r2.effective[0]!.source).toBe('inherited');
    expect(r2.effective[0]!.name).toBe('x');
  });
});

// ---------------------------------------------------------------------------
// useInheritedMembers — qualified-name byId resolution
// ---------------------------------------------------------------------------

describe('useInheritedMembers — qualified-name byId resolution', () => {
  it('resolves parent via repository.byId when $refText is a fully-qualified name', () => {
    // parent has qualified id "test.Parent"; child $refText is "test.Parent"
    const parent = makeDataNode('Parent', undefined, [makeAttrMember('a', 'string')]);
    const child = makeDataNode('Child', 'test.Parent', [makeAttrMember('b', 'number')]);
    const allNodes = [child, parent];
    const repo = selectNodeRepository(new Map(allNodes.map((n) => [n.id, n])));

    const { result } = renderHook(() => useInheritedMembers(child.data as AnyGraphNode, allNodes, 20, repo));
    const groups = result.current;
    expect(groups).toHaveLength(1);
    expect(groups[0]!.ancestorName).toBe('Parent');
    expect(groups[0]!.members).toHaveLength(1);
  });

  it('falls back to bare-name scan when $refText has no namespace prefix', () => {
    // child $refText is bare "Parent" — byId misses, array scan catches it
    const parent = makeDataNode('Parent', undefined, [makeAttrMember('c', 'boolean')]);
    const child = makeDataNode('Child2', 'Parent', []);
    const allNodes = [child, parent];
    const repo = selectNodeRepository(new Map(allNodes.map((n) => [n.id, n])));

    const { result } = renderHook(() => useInheritedMembers(child.data as AnyGraphNode, allNodes, 20, repo));
    const groups = result.current;
    expect(groups).toHaveLength(1);
    expect(groups[0]!.ancestorName).toBe('Parent');
  });

  it('resolves parent via qualified makeNodeId match when called WITHOUT a repository', () => {
    // Regression: Task 4 byId cutover dropped the makeNodeId arm from the
    // array fallback, causing cross-namespace supertypes to silently vanish
    // when useInheritedMembers is called without a repository (e.g. from
    // useEffectiveMembers, DataTypeForm, EnumForm).
    // Parent lives in namespace "a" with bare name "Parent" → id "a.Parent".
    // Child's $refText is the fully-qualified "a.Parent".
    // With no repository the fix must resolve via makeNodeId.
    const parent = makeDataNode('Parent', undefined, [makeAttrMember('inherited', 'string')]);
    // Override the id/meta so the parent lives in namespace "a"
    const parentInNsA = {
      ...parent,
      id: 'a.Parent',
      meta: { ...parent.meta, namespace: 'a' }
    } as unknown as TypeGraphNode;

    const child = makeDataNode('Child', 'a.Parent', []);
    const allNodes = [child, parentInNsA];

    // Called WITHOUT a repository — exercises the array-scan makeNodeId arm
    const { result } = renderHook(() => useInheritedMembers(child.data as AnyGraphNode, allNodes));
    const groups = result.current;
    expect(groups).toHaveLength(1);
    expect(groups[0]!.ancestorName).toBe('Parent');
    expect(groups[0]!.namespace).toBe('a');
    expect(groups[0]!.members).toHaveLength(1);
  });
});

it('retains each ancestor file alias scope across an inheritance chain', () => {
  const child = makeDataNode('Child', 'base.Parent', []);
  child.meta.imports = [{ importedNamespace: 'middle.*', namespaceAlias: 'base' }];
  const parent = makeDataNode('Parent', 'base.Grandparent', [makeAttrMember('near', 'item.Near')]);
  parent.id = 'middle.Parent';
  parent.meta.namespace = 'middle';
  parent.meta.imports = [
    { importedNamespace: 'root.*', namespaceAlias: 'base' },
    { importedNamespace: 'near.*', namespaceAlias: 'item' }
  ];
  const grandparent = makeDataNode('Grandparent', undefined, [makeAttrMember('far', 'item.Far')]);
  grandparent.id = 'root.Grandparent';
  grandparent.meta.namespace = 'root';
  grandparent.meta.imports = [{ importedNamespace: 'far.*', namespaceAlias: 'item' }];
  const nodes = [child, parent, grandparent];
  const { result } = renderHook(() => useEffectiveMembers(child.data as AnyGraphNode, nodes));
  expect(result.current.effective.map((entry) => [entry.name, entry.imports])).toEqual([
    ['near', parent.meta.imports],
    ['far', grandparent.meta.imports]
  ]);
});
