// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Unit tests for the id-keyed Mutative reconcile foundation (edit-reconcile.ts).
 *
 * The headline property: a captured user edit replays onto a fresh parse BY
 * NODE ID, so it survives a reparse that REORDERS the node array — the exact
 * case where naive index-addressed patches would corrupt the wrong node.
 */

import { describe, it, expect } from 'vitest';
import type { Patch } from 'mutative';
import {
  commitGraphEdit,
  reconcileParse,
  projectGraph,
  patchAlreadySatisfied
} from '../../src/store/edit-reconcile.js';
import { nodesFromMap } from '../../src/store/node-projection.js';
import type { TypeGraphNode, TypeGraphEdge } from '../../src/types.js';

function dataNode(id: string, name: string, attrs: Array<{ name: string; type: string }>): TypeGraphNode {
  return {
    id,
    type: 'data',
    position: { x: 0, y: 0 },
    data: { $type: 'Data', name, namespace: 'ns', attributes: attrs }
  } as unknown as TypeGraphNode;
}

type AttrWithCard = {
  name: string;
  type: string;
  card: { $type: string; inf: number; sup: number; unbounded: boolean };
};

function dataNodeWithCard(id: string, name: string, attrs: AttrWithCard[]): TypeGraphNode {
  return {
    id,
    type: 'data',
    position: { x: 0, y: 0 },
    data: { $type: 'Data', name, namespace: 'ns', attributes: attrs }
  } as unknown as TypeGraphNode;
}

const NO_EDGES: TypeGraphEdge[] = [];

describe('edit-reconcile', () => {
  it('captures id-ROOTED patches (path starts with the node id, not an array index)', () => {
    const nodes = [dataNode('ns.Alpha', 'Alpha', [{ name: 'x', type: 'string' }])];
    const { patches } = commitGraphEdit(nodes, NO_EDGES, (draft) => {
      const n = draft.nodes.get('ns.Alpha')!;
      (n.data as { attributes: Array<{ name: string }> }).attributes[0].name = 'renamed';
    });
    expect(patches.length).toBeGreaterThan(0);
    // path[0] = 'nodes' (the GraphDraft key), path[1] = the NODE ID (stable),
    // NOT a numeric array index.
    const p = patches[0] as Patch;
    expect(p.path[0]).toBe('nodes');
    expect(p.path[1]).toBe('ns.Alpha');
  });

  it('replays an in-flight edit onto a REORDERED reparse by id (no wrong-node corruption)', () => {
    // Live graph: Alpha(attr x), Beta(attr y), in that order.
    const live = [
      dataNode('ns.Alpha', 'Alpha', [{ name: 'x', type: 'string' }]),
      dataNode('ns.Beta', 'Beta', [{ name: 'y', type: 'string' }])
    ];
    // User renames Alpha.x -> z (in flight; source not yet round-tripped).
    const { patches } = commitGraphEdit(live, NO_EDGES, (draft) => {
      (draft.nodes.get('ns.Alpha')!.data as { attributes: Array<{ name: string }> }).attributes[0].name = 'z';
    });

    // A reparse lands with the nodes in REVERSED order and the OLD content
    // (Alpha still has x) — index 0 is now Beta. Naive index replay would
    // corrupt Beta; id-keyed replay must target Alpha.
    const reparse = [
      dataNode('ns.Beta', 'Beta', [{ name: 'y', type: 'string' }]),
      dataNode('ns.Alpha', 'Alpha', [{ name: 'x', type: 'string' }])
    ];

    const { nodesById, remainingPatches } = reconcileParse(reparse, NO_EDGES, patches);
    const alphaAttrs = (nodesById.get('ns.Alpha')!.data as { attributes: Array<{ name: string }> }).attributes;
    const betaAttrs = (nodesById.get('ns.Beta')!.data as { attributes: Array<{ name: string }> }).attributes;

    expect(alphaAttrs[0].name).toBe('z'); // edit applied to the RIGHT node
    expect(betaAttrs[0].name).toBe('y'); // Beta untouched (would be 'z' under index replay)
    expect(remainingPatches.length).toBeGreaterThan(0); // still pending (source hasn't caught up)
  });

  it('drops a patch the parse already satisfies (edit round-tripped through source)', () => {
    const live = [dataNode('ns.Alpha', 'Alpha', [{ name: 'x', type: 'string' }])];
    const { patches } = commitGraphEdit(live, NO_EDGES, (draft) => {
      (draft.nodes.get('ns.Alpha')!.data as { attributes: Array<{ name: string }> }).attributes[0].name = 'z';
    });

    // The reparse now REFLECTS the edit (source caught up: attr is already 'z').
    const caughtUp = [dataNode('ns.Alpha', 'Alpha', [{ name: 'z', type: 'string' }])];
    const parse = projectGraph(caughtUp, NO_EDGES);
    expect(patchAlreadySatisfied(parse, patches[0] as Patch)).toBe(true);

    const { nodesById, remainingPatches } = reconcileParse(caughtUp, NO_EDGES, patches);
    const nodes = nodesFromMap(nodesById);
    expect((nodes[0]!.data as { attributes: Array<{ name: string }> }).attributes[0]!.name).toBe('z');
    expect(remainingPatches.length).toBe(0); // cleared — no longer pending
  });

  it('ignores parser coordinates while still requiring exact authored object fields', () => {
    const path = ['nodes', 'ns.Alpha', 'data', 'attributes', 0, 'card'];
    const card = { $type: 'RosettaCardinality', inf: 0, sup: 1, unbounded: false };
    const patch: Patch = { op: 'replace', path, value: { ...card, $cstRange: { offset: 10, end: 16 } } };
    const graph = (parsedCard: AttrWithCard['card']) =>
      projectGraph(
        [dataNodeWithCard('ns.Alpha', 'Alpha', [{ name: 'x', type: 'string', card: parsedCard }])],
        NO_EDGES
      );
    const fresh = { ...card, $cstRange: { offset: 30, end: 36 } };
    expect(patchAlreadySatisfied(graph(fresh), patch)).toBe(true);
    expect(patchAlreadySatisfied(graph({ ...card, inf: 1 }), patch)).toBe(false);
    const otherAuthoredField = { ...card, extra: 'authored' };
    expect(patchAlreadySatisfied(graph(otherAuthoredField), patch)).toBe(false);
  });

  it.each(['add', 'replace'] as const)('recognizes an absent optional property as an undefined %s', (op) => {
    const graph = projectGraph([dataNode('ns.Alpha', 'Alpha', [{ name: 'x', type: 'string' }])], NO_EDGES);
    const path = ['nodes', 'ns.Alpha', 'data', 'attributes', 0, 'definition'];
    expect(patchAlreadySatisfied(graph, { op, path, value: undefined })).toBe(true);
    for (const value of [null, false, '']) {
      expect(patchAlreadySatisfied(graph, { op, path, value })).toBe(false);
    }
    expect(
      patchAlreadySatisfied(graph, { op, path: ['nodes', 'ns.Alpha', 'data', 'attributes', 1], value: undefined })
    ).toBe(false);
  });

  it('does not duplicate an added attribute renamed before its source reparse', () => {
    const initial = [dataNode('ns.Alpha', 'Alpha', [{ name: 'quantity', type: 'number' }])];
    const added = commitGraphEdit(initial, NO_EDGES, (draft) => {
      (draft.nodes.get('ns.Alpha')!.data as { attributes: Array<{ name: string; type: string }> }).attributes.push({
        name: '',
        type: 'string'
      });
    });
    const renamed = commitGraphEdit(added.nodes, NO_EDGES, (draft) => {
      (draft.nodes.get('ns.Alpha')!.data as { attributes: Array<{ name: string }> }).attributes[1]!.name = 'notes';
    });

    const parsed = [
      dataNode('ns.Alpha', 'Alpha', [
        { name: 'quantity', type: 'number' },
        { name: 'notes', type: 'string', $cstRange: { start: 20, end: 42 } }
      ])
    ];
    const { nodesById } = reconcileParse(parsed, NO_EDGES, [...added.patches, ...renamed.patches]);
    const attributes = (nodesById.get('ns.Alpha')!.data as { attributes: Array<{ name: string }> }).attributes;
    expect(attributes.map((attribute) => attribute.name)).toEqual(['quantity', 'notes']);
  });

  it('is a no-op when there are no pending patches', () => {
    const parse = [dataNode('ns.Alpha', 'Alpha', [{ name: 'x', type: 'string' }])];
    const { nodesById, remainingPatches } = reconcileParse(parse, NO_EDGES, []);
    // No patches → returns the projected parse Maps; data must match.
    expect(nodesById).toBeInstanceOf(Map);
    expect(nodesById.has('ns.Alpha')).toBe(true);
    expect(remainingPatches.length).toBe(0);
  });

  it('survives a removal edit replayed onto a reparse (deletes the right attribute by id)', () => {
    const live = [
      dataNode('ns.Alpha', 'Alpha', [
        { name: 'keep', type: 'string' },
        { name: 'drop', type: 'string' }
      ])
    ];
    const { patches } = commitGraphEdit(live, NO_EDGES, (draft) => {
      const d = draft.nodes.get('ns.Alpha')!.data as { attributes: Array<{ name: string }> };
      d.attributes = d.attributes.filter((a) => a.name !== 'drop');
    });
    // Stale reparse still has both attributes.
    const reparse = [
      dataNode('ns.Alpha', 'Alpha', [
        { name: 'keep', type: 'string' },
        { name: 'drop', type: 'string' }
      ])
    ];
    const { nodesById } = reconcileParse(reparse, NO_EDGES, patches);
    const attrs = (nodesById.get('ns.Alpha')!.data as { attributes: Array<{ name: string }> }).attributes;
    expect(attrs.map((a) => a.name)).toEqual(['keep']); // deletion preserved
  });

  it('reorder-safety with object-valued patch (cardinality card): edit lands on the CORRECT node after reorder', () => {
    // Object-valued edits must replay against the right node when its authored
    // value has not caught up, even if the parse reorders the node array.
    const cardOneOne: AttrWithCard['card'] = { $type: 'RosettaCardinality', inf: 1, sup: 1, unbounded: false };
    const live = [
      dataNodeWithCard('ns.Alpha', 'Alpha', [{ name: 'x', type: 'string', card: cardOneOne }]),
      dataNodeWithCard('ns.Beta', 'Beta', [{ name: 'y', type: 'string', card: cardOneOne }])
    ];

    // Edit: set Alpha.x cardinality to 0..1 (object-valued patch).
    const { patches } = commitGraphEdit(live, NO_EDGES, (draft) => {
      const d = draft.nodes.get('ns.Alpha')!.data as { attributes: AttrWithCard[] };
      d.attributes[0]!.card = { $type: 'RosettaCardinality', inf: 0, sup: 1, unbounded: false };
    });

    // Reparse comes back with REVERSED order (Beta first) and stale cardinality on Alpha (1..1).
    const cardOneOneParse: AttrWithCard['card'] = { $type: 'RosettaCardinality', inf: 1, sup: 1, unbounded: false };
    const reparse = [
      dataNodeWithCard('ns.Beta', 'Beta', [{ name: 'y', type: 'string', card: cardOneOneParse }]),
      dataNodeWithCard('ns.Alpha', 'Alpha', [{ name: 'x', type: 'string', card: cardOneOneParse }])
    ];

    const { nodesById, remainingPatches } = reconcileParse(reparse, NO_EDGES, patches);

    const alphaCard = (nodesById.get('ns.Alpha')!.data as { attributes: AttrWithCard[] }).attributes[0]!.card;
    const betaCard = (nodesById.get('ns.Beta')!.data as { attributes: AttrWithCard[] }).attributes[0]!.card;

    // The edit (0..1) must have landed on Alpha, NOT Beta (which would be wrong under index replay).
    expect(alphaCard.inf).toBe(0); // edit applied to the right node
    expect(alphaCard.sup).toBe(1);
    expect(betaCard.inf).toBe(1); // Beta untouched (would be corrupted under index replay)

    // The patch is still pending (object-valued patches are never `patchAlreadySatisfied`
    // against a stale reparse, so they remain in remainingPatches).
    expect(remainingPatches.length).toBeGreaterThan(0);
  });
});
