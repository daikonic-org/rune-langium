// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Unit tests for the degraded-reparse guard (source-corruption fix).
 *
 * When the parse worker is unavailable a reparse can return the same types with
 * their attributes stripped (and no `errors`). Applying that to the live graph
 * lets `useModelSourceSync` re-serialize the truncated graph over the real
 * source file and corrupt it. `isDegradedReparse` is the detector `loadModels`
 * uses to REJECT such a result.
 *
 * Key property: it compares against the CURRENT graph, so a legitimate user
 * deletion (which the live graph already reflects) is NOT mistaken for
 * degradation — only a worker-down collective strip trips it.
 */

import { describe, it, expect } from 'vitest';
import { createEditorStore, isDegradedReparse } from '../../src/store/editor-store.js';
import { parse } from '@rune-langium/core';
import type { TypeGraphNode } from '../../src/types.js';

// Minimal node shape the guard reads: id + data.attributes length.
function node(id: string, attrCount: number): TypeGraphNode {
  return {
    id,
    data: { attributes: Array.from({ length: attrCount }, () => ({})) }
  } as unknown as TypeGraphNode;
}

describe('isDegradedReparse', () => {
  it('flags a worker-down strip (shared nodes lose >50% of their attributes)', () => {
    const current = [node('ns.Alpha', 3), node('ns.Beta', 2)]; // 5 attrs
    const degraded = [node('ns.Alpha', 0), node('ns.Beta', 0)]; // 0 attrs → "No attributes"
    expect(isDegradedReparse(degraded, current)).toBe(true);
  });

  it('does NOT flag a legitimate single-attribute deletion', () => {
    const current = [node('ns.Alpha', 3), node('ns.Beta', 2)]; // 5 attrs
    const afterDelete = [node('ns.Alpha', 3), node('ns.Beta', 1)]; // 4 attrs (user removed one)
    expect(isDegradedReparse(afterDelete, current)).toBe(false);
  });

  it('does NOT flag hydration that ADDS a node (no shared-node shrinkage)', () => {
    const current = [node('ns.Alpha', 3), node('ns.Beta', 2)];
    const hydrated = [node('ns.Alpha', 3), node('ns.Beta', 2), node('ns.Gamma', 4)];
    expect(isDegradedReparse(hydrated, current)).toBe(false);
  });

  it('does NOT flag the initial load (no current baseline)', () => {
    expect(isDegradedReparse([node('ns.Alpha', 3)], [])).toBe(false);
  });

  it('does NOT judge an attribute-light baseline (avoids false positives on tiny graphs)', () => {
    // currentTotal < 3 → not enough signal to call it degraded.
    expect(isDegradedReparse([node('ns.Alpha', 0)], [node('ns.Alpha', 1)])).toBe(false);
  });

  it('does NOT flag a legit multi-type source clear (would wedge the graph; only content, no worker signal)', () => {
    // A user clears all attributes from 2+ types in the source editor → a HEALTHY
    // parse with the same ids and zero attributes. This is byte-identical to a
    // worker-down strip, so a total-wipe rejecter would wedge the graph here. The
    // ratio test deliberately does NOT reject it (small totals fall under the
    // currentTotal<3 floor; larger ones are the documented residual).
    const current = [node('ns.Alpha', 1), node('ns.Beta', 1)];
    const cleared = [node('ns.Alpha', 0), node('ns.Beta', 0)];
    expect(isDegradedReparse(cleared, current)).toBe(false);
  });

  it('does NOT flag a node that disappears entirely (possible legit delete, judged elsewhere)', () => {
    // Beta is gone from incoming — only shared nodes are compared, and Alpha is intact.
    const current = [node('ns.Alpha', 4), node('ns.Beta', 3)];
    const incoming = [node('ns.Alpha', 4)];
    expect(isDegradedReparse(incoming, current)).toBe(false);
  });

  it('allows intentional deferred placeholders but still rejects stripped concrete source peers', () => {
    const current = [node('reference.Parent', 5), node('local.Child', 3)];
    const placeholder = { ...node('reference.Parent', 0), meta: { deferred: true } } as TypeGraphNode;
    expect(isDegradedReparse([placeholder, node('local.Child', 3)], current)).toBe(false);
    expect(isDegradedReparse([placeholder, node('local.Child', 0)], current)).toBe(true);
  });

  it('replaces an attributed reference with a deferred inventory and then accepts the new capture', async () => {
    const store = createEditorStore();
    const previous = await parse(
      'namespace pinned\ntype Payment:\n oldA string (1..1)\n oldB string (1..1)\n oldC string (1..1)'
    );
    store.getState().loadModels(previous.value);
    const id = store.getState().nodes[0]!.id;
    store.getState().selectNode(id);
    const epoch = store.getState().parseEpoch;
    store
      .getState()
      .loadDeferredExports([
        { filePath: '[cdm]/payment.rosetta', namespace: 'pinned', exports: [{ type: 'Data', name: 'Payment' }] }
      ]);
    store.getState().loadModels([]);
    expect(store.getState().nodes[0]!.meta.deferred).toBe(true);
    expect(store.getState().parseEpoch).toBe(epoch + 1);
    expect(store.getState().selectedNodeId).toBe(id);
    const next = await parse(
      'namespace pinned\ntype Payment:\n nextA string (1..1)\n nextB string (1..1)\n nextC string (1..1)'
    );
    store.getState().loadModels(next.value);
    expect(store.getState().nodes[0]!.meta.deferred).not.toBe(true);
    expect(
      (store.getState().nodes[0]!.data as { attributes: Array<{ name: string }> }).attributes.map((field) => field.name)
    ).toEqual(['nextA', 'nextB', 'nextC']);
  });
});
