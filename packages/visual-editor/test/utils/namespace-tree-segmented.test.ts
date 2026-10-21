// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Unit tests for buildSegmentedNamespaceTree + flattenSegmentedTree.
 *
 * The makeNode helper reuses the same shape as namespace-tree.test.ts so that
 * both builders see identical node objects and we can assert that entry
 * extraction produces the same nodeId/name/kind values in both builders.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSegmentedNamespaceTree,
  buildSegmentedNamespaceTreeFromOptions,
  compactSegmentedNamespaceTree,
  flattenSegmentedTree,
  filterSegmentedTree,
  filterSegmentedTreeByKind,
  countEntriesByKind,
  ancestorPathsForMatches,
  collectSegmentSubtreePaths,
  type SegmentNode,
  type FlatTreeRow
} from '../../src/utils/namespace-tree.js';
import type { TypeGraphNode, TypeKind, TypeOption } from '../../src/types.js';
import { testMeta } from '../helpers/node-meta.js';
import { selectNodeRepository } from '../../src/store/node-repository.js';

// Build a repo from an array of TypeGraphNode for the builder tests.
const repoOf = (nodes: TypeGraphNode[]) => selectNodeRepository(new Map(nodes.map((n) => [n.id, n])));

// ---------------------------------------------------------------------------
// Helpers (mirror the pattern from namespace-tree.test.ts)
// ---------------------------------------------------------------------------

const KIND_TO_AST_TYPE: Record<string, string> = {
  data: 'Data',
  choice: 'Choice',
  enum: 'RosettaEnumeration',
  func: 'RosettaFunction'
};

function makeNode(ns: string, name: string, kind: string = 'data'): TypeGraphNode {
  return {
    id: `${ns}.${name}`,
    type: kind,
    position: { x: 0, y: 0 },
    data: {
      $type: KIND_TO_AST_TYPE[kind] ?? 'Data',
      name,
      namespace: ns,
      hasExternalRefs: false,
      errors: []
    } as any,
    meta: testMeta(ns)
  };
}

/** Recursively find a SegmentNode by its fullPath. */
function findByPath(roots: SegmentNode[], fullPath: string): SegmentNode | undefined {
  for (const node of roots) {
    if (node.fullPath === fullPath) return node;
    const found = findByPath(node.children, fullPath);
    if (found) return found;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Fixture nodes
// ---------------------------------------------------------------------------

// Namespaces present in the fixture:
//   com.rosetta.model         — 2 direct types (Trade, Event)
//   com.rosetta.model.base    — 1 direct type (Date)
//   com.rosetta.party         — 1 direct type (Party)
//   (empty namespace)         — 1 direct type (Orphan)
//
// Expected structure:
//   "" (root segment for empty ns)  ← totalCount = 1
//   com                             ← totalCount = 5 (no direct types)
//     rosetta                       ← totalCount = 5 (no direct types)
//       model                       ← totalCount = 3 (2 direct + 1 in base)
//         base                      ← totalCount = 1 (1 direct)
//       party                       ← totalCount = 1 (1 direct)

const FIXTURE_NODES: TypeGraphNode[] = [
  makeNode('com.rosetta.model', 'Trade', 'data'),
  makeNode('com.rosetta.model', 'Event', 'choice'),
  makeNode('com.rosetta.model.base', 'Date', 'data'),
  makeNode('com.rosetta.party', 'Party', 'data'),
  makeNode('', 'Orphan', 'enum')
];

// ---------------------------------------------------------------------------
// buildSegmentedNamespaceTree — basic tests
// ---------------------------------------------------------------------------

describe('buildSegmentedNamespaceTree', () => {
  it('returns [] for empty input', () => {
    expect(buildSegmentedNamespaceTree(repoOf([]))).toEqual([]);
  });

  it('produces two root segments: "" and "com"', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    // "" sorts before "com" in locale order
    expect(roots).toHaveLength(2);
    expect(roots[0]!.segment).toBe('');
    expect(roots[0]!.fullPath).toBe('');
    expect(roots[1]!.segment).toBe('com');
    expect(roots[1]!.fullPath).toBe('com');
  });

  it('nests com → rosetta → { model → base, party }', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const com = roots.find((r) => r.segment === 'com')!;
    expect(com.children).toHaveLength(1);
    const rosetta = com.children[0]!;
    expect(rosetta.segment).toBe('rosetta');
    expect(rosetta.fullPath).toBe('com.rosetta');

    const childSegments = rosetta.children.map((c) => c.segment).sort();
    expect(childSegments).toEqual(['model', 'party']);
  });

  it('model has 2 direct types AND a "base" child', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const model = findByPath(roots, 'com.rosetta.model')!;
    expect(model).toBeDefined();
    expect(model.types).toHaveLength(2);
    expect(model.children).toHaveLength(1);
    expect(model.children[0]!.segment).toBe('base');
  });

  it('model.base has 1 direct type and no children', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const base = findByPath(roots, 'com.rosetta.model.base')!;
    expect(base).toBeDefined();
    expect(base.types).toHaveLength(1);
    expect(base.types[0]!.name).toBe('Date');
    expect(base.children).toHaveLength(0);
  });

  it('party has 1 direct type and no children', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const party = findByPath(roots, 'com.rosetta.party')!;
    expect(party).toBeDefined();
    expect(party.types).toHaveLength(1);
    expect(party.types[0]!.name).toBe('Party');
    expect(party.children).toHaveLength(0);
  });

  it('intermediate segments (com, rosetta) have no direct types', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const com = findByPath(roots, 'com')!;
    const rosetta = findByPath(roots, 'com.rosetta')!;
    expect(com.types).toHaveLength(0);
    expect(rosetta.types).toHaveLength(0);
  });

  it('no-namespace type goes under the "" root segment', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const defaultSeg = roots.find((r) => r.segment === '')!;
    expect(defaultSeg).toBeDefined();
    expect(defaultSeg.fullPath).toBe('');
    expect(defaultSeg.types).toHaveLength(1);
    expect(defaultSeg.types[0]!.name).toBe('Orphan');
    expect(defaultSeg.types[0]!.kind).toBe('enum');
    expect(defaultSeg.children).toHaveLength(0);
  });

  it('handles nodes with only a no-namespace type', () => {
    const roots = buildSegmentedNamespaceTree(repoOf([makeNode('', 'Solo', 'data')]));
    expect(roots).toHaveLength(1);
    expect(roots[0]!.segment).toBe('');
    expect(roots[0]!.types[0]!.name).toBe('Solo');
  });

  // -------------------------------------------------------------------------
  // totalCount
  // -------------------------------------------------------------------------

  it('totalCount aggregates self + all descendants', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const com = findByPath(roots, 'com')!;
    const rosetta = findByPath(roots, 'com.rosetta')!;
    const model = findByPath(roots, 'com.rosetta.model')!;
    const base = findByPath(roots, 'com.rosetta.model.base')!;
    const party = findByPath(roots, 'com.rosetta.party')!;

    expect(base.totalCount).toBe(1);
    expect(party.totalCount).toBe(1);
    expect(model.totalCount).toBe(3); // 2 direct + 1 in base
    expect(rosetta.totalCount).toBe(4); // 3 (model subtree) + 1 (party)
    expect(com.totalCount).toBe(4); // same as rosetta (com has no direct types)
  });

  it('totalCount for "" segment equals its direct type count', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const empty = roots.find((r) => r.segment === '')!;
    expect(empty.totalCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Sorting
  // -------------------------------------------------------------------------

  it('children are sorted by segment name (locale, case-insensitive)', () => {
    const roots = buildSegmentedNamespaceTree(
      repoOf([makeNode('z.alpha', 'ZA'), makeNode('z.beta', 'ZB'), makeNode('z.Gamma', 'ZG')])
    );
    const z = roots.find((r) => r.segment === 'z')!;
    expect(z.children.map((c) => c.segment.toLowerCase())).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('types within a node are sorted by name', () => {
    const roots = buildSegmentedNamespaceTree(
      repoOf([makeNode('ns', 'Zebra'), makeNode('ns', 'Apple'), makeNode('ns', 'Mango')])
    );
    const ns = roots[0]!;
    expect(ns.types.map((t) => t.name)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('root segments are sorted (locale, case-insensitive)', () => {
    const roots = buildSegmentedNamespaceTree(
      repoOf([makeNode('z.ns', 'TypeZ'), makeNode('a.ns', 'TypeA'), makeNode('m.ns', 'TypeM')])
    );
    expect(roots.map((r) => r.segment.toLowerCase())).toEqual(['a', 'm', 'z']);
  });

  // -------------------------------------------------------------------------
  // Entry extraction parity
  // -------------------------------------------------------------------------

  it('produces nodeId = "<ns>.<name>"', () => {
    const roots = buildSegmentedNamespaceTree(repoOf([makeNode('com.example', 'MyType')]));
    const ns = findByPath(roots, 'com.example')!;
    expect(ns.types[0]!.nodeId).toBe('com.example.MyType');
  });

  it('correctly resolves kind for all four node kinds', () => {
    const roots = buildSegmentedNamespaceTree(
      repoOf([
        makeNode('ns', 'D', 'data'),
        makeNode('ns', 'C', 'choice'),
        makeNode('ns', 'E', 'enum'),
        makeNode('ns', 'F', 'func')
      ])
    );
    const types = roots[0]!.types;
    const byName = Object.fromEntries(types.map((t) => [t.name, t.kind]));
    expect(byName).toMatchObject({ D: 'data', C: 'choice', E: 'enum', F: 'func' });
  });
});

// ---------------------------------------------------------------------------
// flattenSegmentedTree — non-compressed
// ---------------------------------------------------------------------------

describe('flattenSegmentedTree (no compression)', () => {
  it('returns [] for empty roots', () => {
    expect(flattenSegmentedTree([], new Set())).toEqual([]);
  });

  it('emits only segment rows for all-collapsed roots', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const rows = flattenSegmentedTree(roots, new Set());
    // Only the two root segments should appear (all collapsed)
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === 'segment')).toBe(true);
    // "" comes before "com"
    expect(rows[0]).toMatchObject({ kind: 'segment', segment: '', fullPath: '', depth: 0, expanded: false });
    expect(rows[1]).toMatchObject({ kind: 'segment', segment: 'com', fullPath: 'com', depth: 0, expanded: false });
  });

  it('segment row carries correct typeCount and childCount', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const rows = flattenSegmentedTree(roots, new Set());
    const comRow = rows.find((r) => r.kind === 'segment' && r.fullPath === 'com')!;
    expect(comRow).toMatchObject({ kind: 'segment', typeCount: 0, childCount: 1 });
  });

  it('expanding "com" reveals "rosetta" at depth 1', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const rows = flattenSegmentedTree(roots, new Set(['com']));
    // "" (depth 0, collapsed) + com (depth 0, expanded) + rosetta (depth 1, collapsed)
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ kind: 'segment', segment: 'rosetta', depth: 1, expanded: false });
  });

  it('expanding down to "model" shows model segment at depth 3', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const expanded = new Set(['com', 'com.rosetta']);
    const rows = flattenSegmentedTree(roots, expanded);
    const modelRow = rows.find((r) => r.kind === 'segment' && r.fullPath === 'com.rosetta.model');
    expect(modelRow).toMatchObject({ kind: 'segment', segment: 'model', depth: 2, expanded: false });
  });

  it('expanding "com.rosetta.model" emits its types AFTER its children', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const expanded = new Set(['com', 'com.rosetta', 'com.rosetta.model']);
    const rows = flattenSegmentedTree(roots, expanded);

    // Find model row and what follows it
    const modelIdx = rows.findIndex((r) => r.kind === 'segment' && r.fullPath === 'com.rosetta.model');
    expect(modelIdx).toBeGreaterThan(-1);

    // "base" child comes before model's direct types
    const baseRow = rows[modelIdx + 1]!;
    expect(baseRow).toMatchObject({ kind: 'segment', segment: 'base', depth: 3 });

    // Then the 2 direct types of model appear at depth 3
    const modelTypes = rows.slice(modelIdx + 2).filter((r) => r.kind === 'type' && r.namespace === 'com.rosetta.model');
    expect(modelTypes).toHaveLength(2);
    expect(modelTypes.map((r) => (r as any).name)).toEqual(['Event', 'Trade']); // sorted
    modelTypes.forEach((r) => expect((r as any).depth).toBe(3));
  });

  it('type rows carry depth, nodeId, name, typeKind, namespace, hidden=false', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const expanded = new Set(['com', 'com.rosetta', 'com.rosetta.party']);
    const rows = flattenSegmentedTree(roots, expanded);
    const partyType = rows.find((r) => r.kind === 'type' && (r as any).name === 'Party')!;
    expect(partyType).toMatchObject({
      kind: 'type',
      nodeId: 'com.rosetta.party.Party',
      name: 'Party',
      typeKind: 'data',
      namespace: 'com.rosetta.party',
      hidden: false,
      depth: 3
    });
  });

  it('collapsed segments hide their entire subtree', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    // Expand nothing — only the two roots are visible
    const rows = flattenSegmentedTree(roots, new Set());
    expect(rows.every((r) => r.kind === 'segment')).toBe(true);
    expect(rows.some((r) => r.kind === 'type')).toBe(false);
  });

  it('expanded field reflects the expanded set', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const rows = flattenSegmentedTree(roots, new Set(['com']));
    const comRow = rows.find((r) => r.kind === 'segment' && r.fullPath === 'com')!;
    expect((comRow as any).expanded).toBe(true);
    const emptyRow = rows.find((r) => r.kind === 'segment' && r.fullPath === '')!;
    expect((emptyRow as any).expanded).toBe(false);
  });

  it('expands "" (default namespace) and shows its types', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const rows = flattenSegmentedTree(roots, new Set(['']));
    const orphanRow = rows.find((r) => r.kind === 'type' && (r as any).name === 'Orphan');
    expect(orphanRow).toBeDefined();
    expect((orphanRow as any).depth).toBe(1);
    expect((orphanRow as any).namespace).toBe('');
  });

  it('full expansion emits all 5 types', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const allPaths = new Set([
      '',
      'com',
      'com.rosetta',
      'com.rosetta.model',
      'com.rosetta.model.base',
      'com.rosetta.party'
    ]);
    const rows = flattenSegmentedTree(roots, allPaths);
    const typeRows = rows.filter((r) => r.kind === 'type');
    expect(typeRows).toHaveLength(5);
    const names = typeRows.map((r) => (r as any).name).sort();
    expect(names).toEqual(['Date', 'Event', 'Orphan', 'Party', 'Trade']);
  });
});

// ---------------------------------------------------------------------------
// flattenSegmentedTree — compressSingleChild
// ---------------------------------------------------------------------------

describe('compactSegmentedNamespaceTree', () => {
  it('groups sibling math and model namespaces under their shared com.rosetta prefix', () => {
    const compact = compactSegmentedNamespaceTree(
      buildSegmentedNamespaceTree(repoOf([makeNode('com.rosetta.math', 'Sum'), makeNode('com.rosetta.model', 'Trade')]))
    );
    expect(compact).toHaveLength(1);
    expect(compact[0]).toMatchObject({ segment: 'com.rosetta', fullPath: 'com.rosetta' });
    expect(compact[0]!.children.map(({ segment, fullPath }) => ({ segment, fullPath }))).toEqual([
      { segment: 'math', fullPath: 'com.rosetta.math' },
      { segment: 'model', fullPath: 'com.rosetta.model' }
    ]);
  });

  it('retains declarations and meaningful branches without mutating the original tree', () => {
    const nodes = [
      makeNode('com.rosetta', 'Root'),
      makeNode('com.rosetta.model.deep', 'Trade'),
      makeNode('com.rosetta.party.deep', 'Party')
    ];
    const roots = buildSegmentedNamespaceTree(repoOf(nodes));
    const compact = compactSegmentedNamespaceTree(roots);
    expect(compact[0]).toMatchObject({ fullPath: 'com.rosetta', segment: 'com.rosetta', totalCount: 3 });
    expect(compact[0]!.types.map((type) => type.nodeId)).toEqual(['com.rosetta.Root']);
    expect(compact[0]!.children.map((child) => child.fullPath)).toEqual([
      'com.rosetta.model.deep',
      'com.rosetta.party.deep'
    ]);
    expect(roots[0]!.fullPath).toBe('com');
    expect(roots[0]!.children[0]!.children[0]!.fullPath).toBe('com.rosetta.model');
    const expanded = new Set(collectSegmentSubtreePaths(compact, 'com.rosetta'));
    expect(
      flattenSegmentedTree(compact, expanded)
        .filter((row) => row.kind === 'type')
        .map((row) => row.nodeId)
        .sort()
    ).toEqual(nodes.map((node) => node.id).sort());
  });

  it('keeps the branch boundary after filtering one of its children out', () => {
    const compact = compactSegmentedNamespaceTree(
      buildSegmentedNamespaceTree(
        repoOf([makeNode('com.rosetta.model', 'Trade'), makeNode('com.rosetta.party', 'Party')])
      )
    );
    const filtered = filterSegmentedTree(compact, 'Trade');
    expect(filtered[0]!.fullPath).toBe('com.rosetta');
    expect(filtered[0]!.children.map((child) => child.fullPath)).toEqual(['com.rosetta.model']);
    expect(ancestorPathsForMatches(filtered, 'Trade')).toEqual(new Set(['com.rosetta', 'com.rosetta.model']));
  });
});

describe('flattenSegmentedTree (compressSingleChild: true)', () => {
  it('collapses "com > rosetta" into a single "com.rosetta" row when com has no direct types', () => {
    // Build a fixture where com → rosetta → model (no party, so rosetta has 1 child)
    const nodes = [makeNode('com.rosetta.model', 'Trade'), makeNode('com.rosetta.model.base', 'Date')];
    const roots = buildSegmentedNamespaceTree(repoOf(nodes));
    const rows = flattenSegmentedTree(roots, new Set(), { compressSingleChild: true });

    // com + rosetta both have no direct types, rosetta has 1 child (model)
    // → should compress into a single row labelled "com.rosetta"? Let's check:
    // Actually com has 1 child (rosetta), rosetta has 1 child (model), model has 1 child (base)
    // model DOES have 2 direct types → stop compression at model
    // So chain: com → rosetta → model  all single-child with no types → compress to "com.rosetta.model"
    // Wait: model has types (Trade), so compression STOPS at model.
    // Chain: com (no types, 1 child rosetta) → rosetta (no types, 1 child model) → model HAS types → stop
    // Compressed label = "com.rosetta.model", fullPath = "com.rosetta.model"
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'segment',
      segment: 'com.rosetta.model',
      fullPath: 'com.rosetta.model',
      depth: 0
    });
  });

  it('expands the compressed row using the terminal fullPath', () => {
    const nodes = [makeNode('com.rosetta.model', 'Trade'), makeNode('com.rosetta.model', 'Event')];
    const roots = buildSegmentedNamespaceTree(repoOf(nodes));
    // Compress stops at model (has types); expand by "com.rosetta.model"
    const rows = flattenSegmentedTree(roots, new Set(['com.rosetta.model']), { compressSingleChild: true });
    expect(rows[0]).toMatchObject({ kind: 'segment', segment: 'com.rosetta.model', expanded: true });
    const typeRows = rows.filter((r) => r.kind === 'type');
    expect(typeRows).toHaveLength(2);
  });

  it('does NOT compress a node that has direct types', () => {
    // com.rosetta has a direct type → compression must not merge com into it
    const nodes = [makeNode('com.rosetta', 'Root'), makeNode('com.rosetta.model', 'Trade')];
    const roots = buildSegmentedNamespaceTree(repoOf(nodes));
    const rows = flattenSegmentedTree(roots, new Set(), { compressSingleChild: true });
    // com has no direct types, 1 child (rosetta) BUT rosetta HAS types → stop at rosetta
    // Compressed label = "com.rosetta", fullPath = "com.rosetta"
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'segment', segment: 'com.rosetta', fullPath: 'com.rosetta' });
  });

  it('does NOT compress a node with multiple children', () => {
    // com.rosetta has two children (model, party) → no compression at rosetta
    const nodes = [makeNode('com.rosetta.model', 'Trade'), makeNode('com.rosetta.party', 'Party')];
    const roots = buildSegmentedNamespaceTree(repoOf(nodes));
    const rows = flattenSegmentedTree(roots, new Set(), { compressSingleChild: true });
    // com (no types, 1 child rosetta) → rosetta has 2 children → compress "com" → "com.rosetta"
    // then rosetta's children are emitted normally when expanded
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'segment',
      segment: 'com.rosetta',
      fullPath: 'com.rosetta',
      childCount: 2
    });
  });

  it('false (default) does not compress anything', () => {
    const nodes = [makeNode('com.rosetta.model', 'Trade')];
    const roots = buildSegmentedNamespaceTree(repoOf(nodes));

    const compressed = flattenSegmentedTree(roots, new Set(), { compressSingleChild: true });
    const uncompressed = flattenSegmentedTree(roots, new Set(), { compressSingleChild: false });
    const defaultBehavior = flattenSegmentedTree(roots, new Set());

    // Compressed: single row "com.rosetta.model"
    expect(compressed).toHaveLength(1);
    // Uncompressed: just the "com" root row
    expect(uncompressed).toHaveLength(1);
    expect(uncompressed[0]).toMatchObject({ segment: 'com', fullPath: 'com' });
    // Default matches uncompressed
    expect(defaultBehavior).toEqual(uncompressed);
  });

  it('full fixture: top-level has "" and a compressed "com.rosetta" chain', () => {
    // Use full fixture which has com.rosetta.{model,party} so rosetta has 2 children
    // → chain com → rosetta stops (rosetta has 2 children) → compressed to "com.rosetta"
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const rows = flattenSegmentedTree(roots, new Set(), { compressSingleChild: true });
    // Should be: "" row + "com.rosetta" row
    expect(rows).toHaveLength(2);
    const comRow = rows.find((r) => r.kind === 'segment' && (r as any).fullPath === 'com.rosetta')!;
    expect(comRow).toMatchObject({ kind: 'segment', segment: 'com.rosetta', depth: 0, childCount: 2 });
  });

  it('expanding compressed row emits children at depth 1', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const rows = flattenSegmentedTree(roots, new Set(['com.rosetta']), { compressSingleChild: true });
    // "com.rosetta" expanded → model (depth 1), party (depth 1)
    const childRows = rows.filter((r) => r.kind === 'segment' && (r as any).depth === 1);
    const childSegments = childRows.map((r) => (r as any).segment).sort();
    expect(childSegments).toEqual(['model', 'party']);
  });
});

// ---------------------------------------------------------------------------
// filterSegmentedTree
// ---------------------------------------------------------------------------

describe('filterSegmentedTree', () => {
  it('returns full tree for empty/whitespace query', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    expect(filterSegmentedTree(roots, '')).toBe(roots);
    expect(filterSegmentedTree(roots, '   ')).toBe(roots);
  });

  it('returns [] when nothing matches', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    expect(filterSegmentedTree(roots, 'zzzznonexistent')).toHaveLength(0);
  });

  it('type name match: only matching type is kept, siblings pruned', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const filtered = filterSegmentedTree(roots, 'Trade');

    // Only the "com" root should survive (Trade lives in com.rosetta.model)
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.segment).toBe('com');

    // Walk down to com.rosetta.model — it must have only Trade, not Event
    const rosetta = filtered[0]!.children[0]!;
    expect(rosetta.segment).toBe('rosetta');
    const model = rosetta.children.find((c) => c.segment === 'model')!;
    expect(model).toBeDefined();
    expect(model.types).toHaveLength(1);
    expect(model.types[0]!.name).toBe('Trade');
  });

  it('fullPath match: includes entire subtree unchanged', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    // "rosetta" matches com.rosetta's fullPath → entire subtree kept intact
    const filtered = filterSegmentedTree(roots, 'rosetta');

    expect(filtered).toHaveLength(1);
    const com = filtered[0]!;
    expect(com.segment).toBe('com');

    // The matched rosetta node is returned as-is (all types/children present)
    const rosetta = com.children[0]!;
    expect(rosetta.segment).toBe('rosetta');
    // model + party still present
    const childSegments = rosetta.children.map((c) => c.segment).sort();
    expect(childSegments).toEqual(['model', 'party']);
  });

  it('case-insensitive match', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const upper = filterSegmentedTree(roots, 'TRADE');
    const lower = filterSegmentedTree(roots, 'trade');
    // Both should produce the same structure
    expect(upper).toHaveLength(lower.length);
    const findTrade = (arr: SegmentNode[]): boolean => {
      for (const n of arr) {
        if (n.types.some((t) => t.name === 'Trade')) return true;
        if (findTrade(n.children)) return true;
      }
      return false;
    };
    expect(findTrade(upper)).toBe(true);
    expect(findTrade(lower)).toBe(true);
  });

  it('regex metacharacters in query are treated as literals (no crash)', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    expect(() => filterSegmentedTree(roots, '[')).not.toThrow();
    expect(() => filterSegmentedTree(roots, '.*')).not.toThrow();
    expect(() => filterSegmentedTree(roots, '(test)')).not.toThrow();
  });

  it('prunes empty intermediate segments (no stale ancestors)', () => {
    // Party is "com.rosetta.party.Party". Searching "Party" should NOT
    // include the model branch (model has no matching types).
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const filtered = filterSegmentedTree(roots, 'Party');

    const rosetta = filtered[0]!.children[0]!;
    // model branch must be pruned
    const modelBranch = rosetta.children.find((c) => c.segment === 'model');
    expect(modelBranch).toBeUndefined();
    // party branch present with Party type
    const partyBranch = rosetta.children.find((c) => c.segment === 'party');
    expect(partyBranch).toBeDefined();
    expect(partyBranch!.types[0]!.name).toBe('Party');
  });

  it('does not mutate the original tree', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const originalModelTypes = [
      ...(roots.find((r) => r.segment === 'com')?.children[0]?.children.find((c) => c.segment === 'model')?.types ?? [])
    ];

    filterSegmentedTree(roots, 'Trade');

    const modelAfter = roots.find((r) => r.segment === 'com')?.children[0]?.children.find((c) => c.segment === 'model');
    expect(modelAfter?.types).toHaveLength(originalModelTypes.length);
  });

  it('totalCount on filtered nodes reflects only matching content', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    // Searching "Trade" → only 1 type matches in com subtree
    const filtered = filterSegmentedTree(roots, 'Trade');
    const com = filtered[0]!;
    // Filtered totalCount = 1 (just Trade)
    expect(com.totalCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ancestorPathsForMatches
// ---------------------------------------------------------------------------

describe('ancestorPathsForMatches', () => {
  it('returns empty set for empty/whitespace query', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    expect(ancestorPathsForMatches(roots, '')).toEqual(new Set());
    expect(ancestorPathsForMatches(roots, '   ')).toEqual(new Set());
  });

  it('returns empty set when nothing matches', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    expect(ancestorPathsForMatches(roots, 'zzzznonexistent')).toEqual(new Set());
  });

  it('includes the leaf segment and all its ancestors for a type-name match', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    // "Trade" is in com.rosetta.model — ancestors: com, com.rosetta, com.rosetta.model
    const paths = ancestorPathsForMatches(roots, 'Trade');
    expect(paths.has('com')).toBe(true);
    expect(paths.has('com.rosetta')).toBe(true);
    expect(paths.has('com.rosetta.model')).toBe(true);
  });

  it('does NOT include paths for non-matching branches', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    // "Trade" is only in com.rosetta.model — com.rosetta.party should NOT appear
    const paths = ancestorPathsForMatches(roots, 'Trade');
    expect(paths.has('com.rosetta.party')).toBe(false);
  });

  it('match on fullPath includes that node and its ancestors', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    // "party" matches fullPath "com.rosetta.party"
    const paths = ancestorPathsForMatches(roots, 'party');
    expect(paths.has('com')).toBe(true);
    expect(paths.has('com.rosetta')).toBe(true);
    expect(paths.has('com.rosetta.party')).toBe(true);
  });

  it('search that matches types in two branches includes ancestors for both', () => {
    // Both com.rosetta.model.Trade and cdm.trade.Trade — use a fixture with both
    const nodes = [makeNode('com.rosetta.model', 'Trade'), makeNode('cdm.trade', 'Trade')];
    const roots = buildSegmentedNamespaceTree(repoOf(nodes));
    const paths = ancestorPathsForMatches(roots, 'Trade');
    // com branch
    expect(paths.has('com')).toBe(true);
    expect(paths.has('com.rosetta')).toBe(true);
    expect(paths.has('com.rosetta.model')).toBe(true);
    // cdm branch
    expect(paths.has('cdm')).toBe(true);
    expect(paths.has('cdm.trade')).toBe(true);
  });

  it('returned set contains enough paths to reveal all matching type rows', () => {
    // The explorer uses ancestorPathsForMatches as the full expanded set during
    // search. Every path in the set must be expanded so matched types are visible.
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    const paths = ancestorPathsForMatches(roots, 'Date'); // Date is in com.rosetta.model.base
    // To see Date, we need com, com.rosetta, com.rosetta.model, com.rosetta.model.base all expanded
    expect(paths.has('com')).toBe(true);
    expect(paths.has('com.rosetta')).toBe(true);
    expect(paths.has('com.rosetta.model')).toBe(true);
    expect(paths.has('com.rosetta.model.base')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildSegmentedNamespaceTreeFromOptions — the inspector-picker entry point.
// Must produce the SAME tree as the graph-node builder for equivalent input,
// since both delegate to the shared buildSegmentsFromEntries core.
// ---------------------------------------------------------------------------

describe('buildSegmentedNamespaceTreeFromOptions', () => {
  function opt(namespace: string | undefined, label: string, kind: TypeOption['kind'] = 'data'): TypeOption {
    return { value: `${namespace ?? ''}.${label}`, label, kind, namespace };
  }

  it('returns [] for empty options', () => {
    expect(buildSegmentedNamespaceTreeFromOptions([])).toEqual([]);
  });

  it('produces the same tree shape as the node builder for equivalent input', () => {
    const nodes = [
      makeNode('com.rosetta.model', 'Trade', 'data'),
      makeNode('com.rosetta.model.base', 'Date', 'data'),
      makeNode('cdm.event', 'Event', 'choice')
    ];
    const options: TypeOption[] = [
      opt('com.rosetta.model', 'Trade', 'data'),
      opt('com.rosetta.model.base', 'Date', 'data'),
      opt('cdm.event', 'Event', 'choice')
    ];
    const fromNodes = buildSegmentedNamespaceTree(repoOf(nodes));
    const fromOptions = buildSegmentedNamespaceTreeFromOptions(options);
    // nodeId is `${ns}.${name}` in both fixtures, so the trees are deep-equal.
    expect(fromOptions).toEqual(fromNodes);
  });

  it('nests sub-namespaces into segment chains', () => {
    const roots = buildSegmentedNamespaceTreeFromOptions([opt('cdm.base.datetime', 'BusinessCenters', 'data')]);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.fullPath).toBe('cdm');
    expect(roots[0]!.children[0]!.fullPath).toBe('cdm.base');
    expect(roots[0]!.children[0]!.children[0]!.fullPath).toBe('cdm.base.datetime');
    expect(roots[0]!.children[0]!.children[0]!.types.map((t) => t.name)).toEqual(['BusinessCenters']);
  });

  it('groups builtin types under a synthetic "Built-in" namespace with basicType kind', () => {
    const roots = buildSegmentedNamespaceTreeFromOptions([
      { value: 'string', label: 'string', kind: 'builtin' },
      { value: 'int', label: 'int', kind: 'builtin' }
    ]);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.fullPath).toBe('Built-in');
    expect(roots[0]!.types.map((t) => t.name).sort()).toEqual(['int', 'string']);
    // builtin → basicType so the type-row dot/badge resolves to a real TypeKind.
    expect(roots[0]!.types.every((t) => t.kind === 'basicType')).toBe(true);
  });

  it('sorts types within a namespace by name and roots by segment', () => {
    const roots = buildSegmentedNamespaceTreeFromOptions([
      opt('zeta', 'Zebra', 'data'),
      opt('alpha', 'Beta', 'data'),
      opt('alpha', 'Apple', 'data')
    ]);
    expect(roots.map((r) => r.segment)).toEqual(['alpha', 'zeta']);
    expect(roots[0]!.types.map((t) => t.name)).toEqual(['Apple', 'Beta']);
  });
});

// ---------------------------------------------------------------------------
// Nameless entries (un-hydrated/malformed node data) — must be dropped, not
// crash the sort. Reproduces "Cannot read properties of undefined (reading
// 'localeCompare')" thrown from buildSegmentsFromEntries when a node's
// `data.name` is absent (e.g. a not-yet-hydrated curated stub).
// ---------------------------------------------------------------------------

describe('nodes/options with a missing name', () => {
  function namelessNode(ns: string): TypeGraphNode {
    return {
      id: `${ns}.__nameless__`,
      type: 'data',
      position: { x: 0, y: 0 },
      data: {
        $type: 'Data',
        namespace: ns,
        hasExternalRefs: false,
        errors: []
        // `name` intentionally absent.
      } as any,
      meta: testMeta(ns)
    };
  }

  it('buildSegmentedNamespaceTree drops a nameless node instead of throwing', () => {
    const nodes = [makeNode('com.rosetta.model', 'Trade', 'data'), namelessNode('com.rosetta.model')];
    expect(() => buildSegmentedNamespaceTree(repoOf(nodes))).not.toThrow();
    const roots = buildSegmentedNamespaceTree(repoOf(nodes));
    const model = findByPath(roots, 'com.rosetta.model')!;
    expect(model.types.map((t) => t.name)).toEqual(['Trade']);
  });
  it('buildSegmentedNamespaceTreeFromOptions drops an option with an empty label instead of throwing', () => {
    const options: TypeOption[] = [
      { value: 'com.rosetta.model.Trade', label: 'Trade', kind: 'data', namespace: 'com.rosetta.model' },
      { value: 'com.rosetta.model.__nameless__', label: '', kind: 'data', namespace: 'com.rosetta.model' }
    ];
    expect(() => buildSegmentedNamespaceTreeFromOptions(options)).not.toThrow();
    const roots = buildSegmentedNamespaceTreeFromOptions(options);
    const model = findByPath(roots, 'com.rosetta.model')!;
    expect(model.types.map((t) => t.name)).toEqual(['Trade']);
  });

  it('buildSegmentedNamespaceTree omits a namespace left with zero entries after dropping its only (nameless) node', () => {
    const nodes = [makeNode('com.rosetta.model', 'Trade', 'data'), namelessNode('com.rosetta.empty')];
    const roots = buildSegmentedNamespaceTree(repoOf(nodes));
    expect(findByPath(roots, 'com.rosetta.model')).toBeDefined();
    expect(findByPath(roots, 'com.rosetta.empty')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// collectSegmentSubtreePaths — recursive expand/collapse support
// ---------------------------------------------------------------------------

describe('collectSegmentSubtreePaths', () => {
  it('follows only single-child chains for expansion and still collects the whole subtree for collapse', () => {
    const roots = buildSegmentedNamespaceTree(
      repoOf([
        makeNode('root', 'Root', 'data'),
        makeNode('root.child', 'Child', 'data'),
        makeNode('root.child.left', 'Left', 'data'),
        makeNode('root.child.right', 'Right', 'data')
      ])
    );
    expect(collectSegmentSubtreePaths(roots, 'root', { singleChildOnly: true })).toEqual(['root', 'root.child']);
    expect(new Set(collectSegmentSubtreePaths(roots, 'root'))).toEqual(
      new Set(['root', 'root.child', 'root.child.left', 'root.child.right'])
    );
  });
  it('collects a namespace plus every descendant segment fullPath', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    // "com" subtree = com, com.rosetta, com.rosetta.model, com.rosetta.model.base,
    // com.rosetta.party — opening "com" should reveal them all.
    expect(new Set(collectSegmentSubtreePaths(roots, 'com'))).toEqual(
      new Set(['com', 'com.rosetta', 'com.rosetta.model', 'com.rosetta.model.base', 'com.rosetta.party'])
    );
  });

  it('collects a mid-tree segment and only its own descendants', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    expect(new Set(collectSegmentSubtreePaths(roots, 'com.rosetta.model'))).toEqual(
      new Set(['com.rosetta.model', 'com.rosetta.model.base'])
    );
  });

  it('returns just the leaf for a segment with no children', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    expect(collectSegmentSubtreePaths(roots, 'com.rosetta.party')).toEqual(['com.rosetta.party']);
  });

  it('degrades to the requested path when it is not in the tree (no-op safety)', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(FIXTURE_NODES));
    expect(collectSegmentSubtreePaths(roots, 'does.not.exist')).toEqual(['does.not.exist']);
  });
});

// ---------------------------------------------------------------------------
// Gap 2: per-kind counts + kind filter
// ---------------------------------------------------------------------------

describe('countEntriesByKind', () => {
  it('counts per kind and omits zero kinds', () => {
    const entries = [
      { nodeId: 'a', name: 'A', kind: 'data' as TypeKind },
      { nodeId: 'b', name: 'B', kind: 'data' as TypeKind },
      { nodeId: 'c', name: 'C', kind: 'choice' as TypeKind }
    ];
    expect(countEntriesByKind(entries)).toEqual({ data: 2, choice: 1 });
  });

  it('returns an empty object for no entries', () => {
    expect(countEntriesByKind([])).toEqual({});
  });
});

describe('flattenSegmentedTree — kindCounts on segment rows', () => {
  const NODES = [
    makeNode('pkg', 'A', 'data'),
    makeNode('pkg', 'B', 'data'),
    makeNode('pkg', 'C', 'choice'),
    makeNode('pkg', 'E', 'enum')
  ];

  it('emits per-kind breakdown for the segment’s own direct types', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(NODES));
    const expanded = new Set(['pkg']);
    const rows = flattenSegmentedTree(roots, expanded);
    const seg = rows.find(
      (r): r is Extract<FlatTreeRow, { kind: 'segment' }> => r.kind === 'segment' && r.fullPath === 'pkg'
    );
    expect(seg?.kindCounts).toEqual({ data: 2, choice: 1, enum: 1 });
  });

  it('emits an empty kindCounts for a parent segment with no direct types', () => {
    const roots = buildSegmentedNamespaceTree(repoOf([makeNode('a.b', 'Leaf', 'data')]));
    const rows = flattenSegmentedTree(roots, new Set(['a', 'a.b']));
    const parent = rows.find(
      (r): r is Extract<FlatTreeRow, { kind: 'segment' }> => r.kind === 'segment' && r.fullPath === 'a'
    );
    expect(parent?.kindCounts).toEqual({});
  });
});

describe('filterSegmentedTreeByKind', () => {
  const NODES = [
    makeNode('pkg', 'A', 'data'),
    makeNode('pkg', 'C', 'choice'),
    makeNode('pkg', 'E', 'enum'),
    makeNode('pkg', 'F', 'func')
  ];

  it('keeps only types whose kind is in the active set', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(NODES));
    const filtered = filterSegmentedTreeByKind(roots, new Set<TypeKind>(['data', 'enum']));
    const pkg = findByPath(filtered, 'pkg');
    expect(pkg?.types.map((t) => t.name).sort()).toEqual(['A', 'E']);
    expect(pkg?.totalCount).toBe(2);
  });

  it('prunes a namespace whose every type is filtered out', () => {
    const roots = buildSegmentedNamespaceTree(repoOf(NODES));
    const filtered = filterSegmentedTreeByKind(roots, new Set<TypeKind>(['record']));
    expect(filtered).toEqual([]);
  });

  it('prunes now-empty parent segments while keeping matching descendants', () => {
    const roots = buildSegmentedNamespaceTree(
      repoOf([makeNode('a.keep', 'K', 'data'), makeNode('a.drop', 'D', 'choice')])
    );
    const filtered = filterSegmentedTreeByKind(roots, new Set<TypeKind>(['data']));
    expect(findByPath(filtered, 'a.keep')).toBeDefined();
    expect(findByPath(filtered, 'a.drop')).toBeUndefined();
  });
});
