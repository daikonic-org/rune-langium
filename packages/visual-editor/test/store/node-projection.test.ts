// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect } from 'vitest';
import { makeNodeId, nameFromNodeId, qualifiedNameFromNodeId, splitNodeId } from '../../src/store/node-projection.js';
import { makeEdgeId, parseEdgeId } from '../../src/store/node-projection.js';
import { astRelevantProjection } from '../../src/store/node-projection.js';
import { getMemberArray, ensureMemberArray } from '../../src/store/node-projection.js';
import { toNodesById, nodesFromMap, toEdgesById, edgesFromMap } from '../../src/store/node-projection.js';

describe('node-projection id builders (V1, dot form)', () => {
  it('makeNodeId joins namespace and name with a dot (via qualifiedExportPath)', () => {
    expect(makeNodeId('cdm.base', 'Foo')).toBe('cdm.base.Foo');
    expect(makeNodeId('', 'Foo')).toBe('Foo'); // empty namespace → no leading dot
    expect(makeNodeId('cdm.base', 'Foo', 'Data')).toBe('cdm.base.Foo#Data');
  });
  it('nameFromNodeId returns the trailing name via last-dot split', () => {
    expect(nameFromNodeId('cdm.base.Foo')).toBe('Foo');
    expect(nameFromNodeId('Foo')).toBe('Foo'); // no dot → whole string
    expect(nameFromNodeId('cdm.base.Foo#Data')).toBe('Foo');
  });
  it('splitNodeId returns namespace + name via last-dot split', () => {
    expect(splitNodeId('cdm.base.Foo')).toEqual({ namespace: 'cdm.base', name: 'Foo' });
    expect(splitNodeId('Foo')).toEqual({ namespace: '', name: 'Foo' });
    expect(splitNodeId('cdm.base.Foo#Data')).toEqual({ namespace: 'cdm.base', name: 'Foo' });
    expect(qualifiedNameFromNodeId('cdm.base.Foo#Data')).toBe('cdm.base.Foo');
  });
});

describe('node-projection edge-id builders (V3)', () => {
  it('builds and parses a label-bearing edge id (attribute-ref)', () => {
    const id = makeEdgeId('attribute-ref', { source: 'ns.A', target: 'ns.B', label: 'foo' });
    expect(id).toBe('ns.A--attribute-ref--foo--ns.B');
    expect(parseEdgeId(id)).toEqual({ kind: 'attribute-ref', source: 'ns.A', target: 'ns.B', label: 'foo' });
  });
  it('builds and parses a label-less edge id (extends)', () => {
    const id = makeEdgeId('extends', { source: 'ns.Child', target: 'ns.Parent' });
    expect(id).toBe('ns.Child--extends--ns.Parent');
    expect(parseEdgeId(id)).toEqual({ kind: 'extends', source: 'ns.Child', target: 'ns.Parent' });
  });
  it('returns null for a non-edge string', () => {
    expect(parseEdgeId('ns.A')).toBeNull();
  });
  it('makeEdgeId is kind-driven: a stray label on a label-less kind is ignored', () => {
    // extends is label-less → label ignored → 3-segment, round-trips
    const id = makeEdgeId('extends', { source: 'ns.A', target: 'ns.B', label: 'ignored' } as never);
    expect(id).toBe('ns.A--extends--ns.B');
    expect(parseEdgeId(id)).toEqual({ kind: 'extends', source: 'ns.A', target: 'ns.B' });
  });
  it('parseEdgeId rejects an unknown kind segment', () => {
    expect(parseEdgeId('ns.A--bogus--ns.B')).toBeNull();
  });
  it('parseEdgeId rejects a label-less kind with an extra (4th) segment', () => {
    expect(parseEdgeId('ns.A--extends--x--ns.B')).toBeNull();
  });
  it('parseEdgeId rejects a label-bearing kind missing its label (3 segments)', () => {
    expect(parseEdgeId('ns.A--attribute-ref--ns.B')).toBeNull();
  });
});

describe('node-projection content-fingerprint projection (V2)', () => {
  it('astRelevantProjection passes pure domain data through unchanged', () => {
    const data = { $type: 'Data', name: 'Foo', attributes: [], definition: 'd' } as Record<string, unknown>;
    expect(astRelevantProjection(data as never)).toEqual(data);
  });
  it('astRelevantProjection tolerates stale legacy view-state keys (position/errors/hasExternalRefs)', () => {
    // Phase 3 step 3: data is the pure domain payload, so these keys can no
    // longer occur — the exclusion set is a tolerance guard against a stale
    // producer re-introducing view-state churn into the fingerprint.
    const stale = {
      $type: 'Data',
      name: 'Foo',
      attributes: [],
      position: { x: 1, y: 2 },
      errors: [],
      hasExternalRefs: false
    } as Record<string, unknown>;
    const out = astRelevantProjection(stale as never) as Record<string, unknown>;
    expect('position' in out).toBe(false);
    expect('errors' in out).toBe(false);
    expect('hasExternalRefs' in out).toBe(false);
    expect(out.name).toBe('Foo');
  });
});

describe('node-projection member accessors (V4)', () => {
  it('maps each kind to its member field', () => {
    expect(getMemberArray({ $type: 'Data', attributes: [1] } as never)).toEqual({ field: 'attributes', members: [1] });
    expect(getMemberArray({ $type: 'Annotation', attributes: [5] } as never)).toEqual({
      field: 'attributes',
      members: [5]
    });
    expect(getMemberArray({ $type: 'Choice', attributes: [] } as never)).toEqual({ field: 'attributes', members: [] });
    expect(getMemberArray({ $type: 'RosettaEnumeration', enumValues: [2] } as never)).toEqual({
      field: 'enumValues',
      members: [2]
    });
    expect(getMemberArray({ $type: 'RosettaFunction', inputs: [3] } as never)).toEqual({
      field: 'inputs',
      members: [3]
    });
    expect(getMemberArray({ $type: 'RosettaRecordType', features: [4] } as never)).toEqual({
      field: 'features',
      members: [4]
    });
  });
  it('returns null for a kind with no member container', () => {
    expect(getMemberArray({ $type: 'RosettaTypeAlias' } as never)).toBeNull();
  });
  it('ensureMemberArray initializes a missing array and returns it', () => {
    const node = { $type: 'Data' } as Record<string, unknown>;
    const arr = ensureMemberArray(node as never);
    expect(arr).toEqual([]);
    expect(node.attributes).toBe(arr);
  });
});

describe('node-projection array↔Map derivation (V5/V6)', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }] as never[];
  const edges = [{ id: 'e1' }] as never[];
  it('toNodesById / nodesFromMap round-trip preserving order', () => {
    const map = toNodesById(nodes);
    expect(map.get('a')).toBe(nodes[0]);
    expect(nodesFromMap(map)).toEqual(nodes);
  });
  it('toEdgesById / edgesFromMap round-trip', () => {
    const map = toEdgesById(edges);
    expect(map.get('e1')).toBe(edges[0]);
    expect(edgesFromMap(map)).toEqual(edges);
  });
});
