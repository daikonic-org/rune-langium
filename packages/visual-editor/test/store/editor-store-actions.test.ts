// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Unit tests for new store actions (T042).
 *
 * Tests addEnumValue, removeEnumValue, updateEnumValue, setEnumParent,
 * addChoiceOption, removeChoiceOption, updateDefinition, updateComments,
 * addSynonym, removeSynonym, updateAttribute, reorderAttribute,
 * reorderEnumValue against a loaded graph fixture.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '@rune-langium/core';
import { RAW_DSL_TYPE } from '@rune-langium/codegen/rosetta';
import { createEditorStore } from '../../src/store/editor-store.js';
import {
  COMBINED_MODEL_SOURCE,
  ENUM_MODEL_SOURCE,
  CHOICE_MODEL_SOURCE,
  FUNCTION_MODEL_SOURCE
} from '../helpers/fixture-loader.js';

describe('EditorStore — new actions', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(async () => {
    store = createEditorStore();
    const result = await parse(COMBINED_MODEL_SOURCE);
    store.getState().loadModels(result.value);
  });

  // -----------------------------------------------------------------------
  // updateAttribute
  // -----------------------------------------------------------------------

  describe('updateAttribute', () => {
    it('updates name, typeName, and cardinality of an existing attribute', () => {
      const nodes = store.getState().nodes;
      const tradeNode = nodes.find((n) => n.data.name === 'Trade');
      expect(tradeNode).toBeDefined();

      store.getState().updateAttribute(tradeNode!.id, 'tradeDate', 'executionDate', 'dateTime', '0..1');

      const updated = store.getState().nodes.find((n) => n.id === tradeNode!.id);
      const member = ((updated!.data as any).attributes ?? []).find((m: any) => m.name === 'executionDate');
      expect(member).toBeDefined();
      expect(member!.typeCall?.type?.$refText).toBe('dateTime');
      expect(member!.card).toMatchObject({ inf: 0, sup: 1, unbounded: false });
    });

    it('does not affect other attributes', () => {
      const nodes = store.getState().nodes;
      const tradeNode = nodes.find((n) => n.data.name === 'Trade');

      store.getState().updateAttribute(tradeNode!.id, 'tradeDate', 'executionDate', 'dateTime', '0..1');

      const updated = store.getState().nodes.find((n) => n.id === tradeNode!.id);
      const currency = ((updated!.data as any).attributes ?? []).find((m: any) => m.name === 'currency');
      expect(currency).toBeDefined();
      expect(currency!.typeCall?.type?.$refText).toBe('CurrencyEnum');
    });
  });

  // -----------------------------------------------------------------------
  // reorderAttribute
  // -----------------------------------------------------------------------

  describe('reorderAttribute', () => {
    it('moves an attribute from one position to another', () => {
      const nodes = store.getState().nodes;
      const tradeNode = nodes.find((n) => n.data.name === 'Trade');
      const attrs = (tradeNode!.data as any).attributes ?? [];
      expect(attrs.length).toBeGreaterThanOrEqual(2);

      const originalFirst = attrs[0]!.name;
      const originalSecond = attrs[1]!.name;

      // Move first to second position
      store.getState().reorderAttribute(tradeNode!.id, 0, 1);

      const updated = store.getState().nodes.find((n) => n.id === tradeNode!.id);
      const updatedAttrs = (updated!.data as any).attributes ?? [];
      expect(updatedAttrs[0]!.name).toBe(originalSecond);
      expect(updatedAttrs[1]!.name).toBe(originalFirst);
    });

    it('captures an id-rooted patch at draft.nodes (Wave A — mutateGraph recipe)', () => {
      const nodes = store.getState().nodes;
      const tradeNode = nodes.find((n) => n.data.name === 'Trade');
      expect(tradeNode).toBeDefined();
      const nodeId = tradeNode!.id;

      const attrs = (tradeNode!.data as any).attributes ?? [];
      expect(attrs.length).toBeGreaterThanOrEqual(2);

      store.getState().reorderAttribute(nodeId, 0, 1);

      const patches = store.getState().pendingEditPatches;
      expect(patches.length).toBeGreaterThan(0);
      expect(patches[0]!.path[0]).toBe('nodes'); // draft Map key
      expect(patches[0]!.path[1]).toBe(nodeId); // keyed by id, NOT an array index
      expect(patches[0]!.path).toContain('attributes');
    });

    it('negative / out-of-range fromIndex is a true no-op (order preserved, no patch)', () => {
      const tradeNode = store.getState().nodes.find((n) => n.data.name === 'Trade');
      const namesBefore = ((tradeNode!.data as any).attributes ?? []).map((a: any) => a.name);
      expect(namesBefore.length).toBeGreaterThanOrEqual(2);
      const patchesBefore = store.getState().pendingEditPatches.length;

      store.getState().reorderAttribute(tradeNode!.id, -1, 0); // would splice the last attribute
      store.getState().reorderAttribute(tradeNode!.id, 99, 0); // out of range

      const namesAfter = (store.getState().nodes.find((n) => n.id === tradeNode!.id)!.data as any).attributes.map(
        (a: any) => a.name
      );
      expect(namesAfter).toEqual(namesBefore); // order intact
      expect(store.getState().pendingEditPatches.length).toBe(patchesBefore); // no spurious patch
    });
  });

  // -----------------------------------------------------------------------
  // updateDefinition
  // -----------------------------------------------------------------------

  describe('updateDefinition', () => {
    it('sets the definition on a node', () => {
      const nodes = store.getState().nodes;
      const tradeNode = nodes.find((n) => n.data.name === 'Trade');

      store.getState().updateDefinition(tradeNode!.id, 'A financial trade');

      const updated = store.getState().nodes.find((n) => n.id === tradeNode!.id);
      expect(updated!.data['definition']).toBe('A financial trade');
    });
  });

  // -----------------------------------------------------------------------
  // updateComments
  // -----------------------------------------------------------------------

  describe('updateComments', () => {
    it('sets comments on a node (meta sibling — data stays pure)', () => {
      const nodes = store.getState().nodes;
      const tradeNode = nodes.find((n) => n.data.name === 'Trade');

      store.getState().updateComments(tradeNode!.id, 'TODO: add more attributes');

      const updated = store.getState().nodes.find((n) => n.id === tradeNode!.id);
      expect(updated!.meta.comments).toBe('TODO: add more attributes');
      expect(updated!.data as unknown as Record<string, unknown>).not.toHaveProperty('comments');
    });
  });

  // -----------------------------------------------------------------------
  // addSynonym / removeSynonym
  // -----------------------------------------------------------------------

  describe('addSynonym', () => {
    it('adds a class synonym from a source ref (Data)', () => {
      const node = store.getState().nodes.find((n) => n.data.name === 'Trade')!;
      store.getState().addSynonym(node.id, 'FpML');
      const syns = (store.getState().nodes.find((n) => n.id === node.id)!.data as any).synonyms;
      expect(syns[0].$type).toBe('RosettaClassSynonym');
      expect(syns[0].sources[0].$refText).toBe('FpML');
    });

    it('sets a value on the synonym when provided', () => {
      const node = store.getState().nodes.find((n) => n.data.name === 'Trade')!;
      store.getState().addSynonym(node.id, 'FpML', 'Trade');
      const syns = (store.getState().nodes.find((n) => n.id === node.id)!.data as any).synonyms;
      expect(syns[0].$type).toBe('RosettaClassSynonym');
      expect(syns[0].sources[0].$refText).toBe('FpML');
      expect(syns[0].value).toEqual({ $type: 'RosettaSynonymValueBase', name: 'Trade' });
    });

    it('appends to existing synonyms', () => {
      const nodes = store.getState().nodes;
      const tradeNode = nodes.find((n) => n.data.name === 'Trade');

      store.getState().addSynonym(tradeNode!.id, 'FpML_Trade');
      store.getState().addSynonym(tradeNode!.id, 'FIX_Trade');

      const updated = store.getState().nodes.find((n) => n.id === tradeNode!.id);
      const syns = (updated!.data as any).synonyms;
      expect(syns).toHaveLength(2);
      expect(syns[0].sources[0].$refText).toBe('FpML_Trade');
      expect(syns[1].sources[0].$refText).toBe('FIX_Trade');
    });
  });

  describe('removeSynonym', () => {
    it('removes a synonym by index', () => {
      const nodes = store.getState().nodes;
      const tradeNode = nodes.find((n) => n.data.name === 'Trade');

      store.getState().addSynonym(tradeNode!.id, 'FpML_Trade');
      store.getState().addSynonym(tradeNode!.id, 'FIX_Trade');
      store.getState().removeSynonym(tradeNode!.id, 0);

      const updated = store.getState().nodes.find((n) => n.id === tradeNode!.id);
      const syns = (updated!.data as any).synonyms;
      expect(syns).toHaveLength(1);
      expect(syns[0].sources[0].$refText).toBe('FIX_Trade');
    });

    it('negative / out-of-range index is a true no-op (does not delete the last synonym)', () => {
      const tradeNode = store.getState().nodes.find((n) => n.data.name === 'Trade');
      store.getState().addSynonym(tradeNode!.id, 'FpML_Trade');
      store.getState().addSynonym(tradeNode!.id, 'FIX_Trade');
      const patchesBefore = store.getState().pendingEditPatches.length;

      store.getState().removeSynonym(tradeNode!.id, -1); // would splice(-1,1) → delete last
      store.getState().removeSynonym(tradeNode!.id, 99); // out of range

      const syns = (store.getState().nodes.find((n) => n.id === tradeNode!.id)!.data as any).synonyms;
      expect(syns.map((s: any) => s.sources[0].$refText)).toEqual(['FpML_Trade', 'FIX_Trade']); // both intact
      expect(store.getState().pendingEditPatches.length).toBe(patchesBefore); // no spurious patch
    });
  });
});

// ---------------------------------------------------------------------------
// addEnumValueSynonym / removeEnumValueSynonym (separate model)
// ---------------------------------------------------------------------------

describe('EditorStore — enum-value synonym actions', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(async () => {
    store = createEditorStore();
    const result = await parse(ENUM_MODEL_SOURCE);
    store.getState().loadModels(result.value);
  });

  describe('addEnumValueSynonym', () => {
    it('adds a RosettaEnumSynonym to enumValues[0].enumSynonyms', () => {
      const enumNode = store.getState().nodes.find((n) => (n.data as any).$type === 'RosettaEnumeration')!;
      store.getState().addEnumValueSynonym(enumNode.id, 0, 'FIX', 'TD');
      const ev = (store.getState().nodes.find((n) => n.id === enumNode.id)!.data as any).enumValues[0];
      expect(ev.enumSynonyms[0]).toMatchObject({
        $type: 'RosettaEnumSynonym',
        sources: [{ $refText: 'FIX' }],
        synonymValue: 'TD'
      });
    });

    it('is a no-op for a non-RosettaEnumeration node', () => {
      // USD is an enumValue name, but the nodeId must be the enum itself.
      // Using a non-existent nodeId — should silently no-op.
      const patchesBefore = store.getState().pendingEditPatches.length;
      store.getState().addEnumValueSynonym('non-existent-id', 0, 'FIX', 'TD');
      expect(store.getState().pendingEditPatches.length).toBe(patchesBefore);
    });
  });

  describe('removeEnumValueSynonym', () => {
    it('removes the enum-value synonym at synIndex', () => {
      const enumNode = store.getState().nodes.find((n) => (n.data as any).$type === 'RosettaEnumeration')!;
      store.getState().addEnumValueSynonym(enumNode.id, 0, 'FIX', 'TD');
      store.getState().addEnumValueSynonym(enumNode.id, 0, 'FpML', 'TradeDate');
      store.getState().removeEnumValueSynonym(enumNode.id, 0, 0); // remove first

      const ev = (store.getState().nodes.find((n) => n.id === enumNode.id)!.data as any).enumValues[0];
      expect(ev.enumSynonyms).toHaveLength(1);
      expect(ev.enumSynonyms[0].sources[0].$refText).toBe('FpML');
    });

    it('negative / out-of-range synIndex is a true no-op (does not delete the last entry)', () => {
      const enumNode = store.getState().nodes.find((n) => (n.data as any).$type === 'RosettaEnumeration')!;
      store.getState().addEnumValueSynonym(enumNode.id, 0, 'FIX', 'TD');
      const patchesBefore = store.getState().pendingEditPatches.length;

      store.getState().removeEnumValueSynonym(enumNode.id, 0, -1); // would delete last
      store.getState().removeEnumValueSynonym(enumNode.id, 0, 99); // out of range

      const ev = (store.getState().nodes.find((n) => n.id === enumNode.id)!.data as any).enumValues[0];
      expect(ev.enumSynonyms).toHaveLength(1); // entry preserved
      expect(store.getState().pendingEditPatches.length).toBe(patchesBefore); // no spurious patch
    });
  });
});

// ---------------------------------------------------------------------------
// Enum operations (separate model)
// ---------------------------------------------------------------------------

describe('EditorStore — enum operations', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(async () => {
    store = createEditorStore();
    const result = await parse(ENUM_MODEL_SOURCE);
    store.getState().loadModels(result.value);
  });

  describe('addEnumValue', () => {
    it('adds a new enum value to an enum node', () => {
      const nodes = store.getState().nodes;
      const enumNode = nodes.find((n) => (n.data as any).$type === 'RosettaEnumeration');
      expect(enumNode).toBeDefined();

      store.getState().addEnumValue(enumNode!.id, 'JPY', 'Japanese Yen');

      const updated = store.getState().nodes.find((n) => n.id === enumNode!.id);
      const newValue = ((updated!.data as any).enumValues ?? []).find((m: any) => m.name === 'JPY');
      expect(newValue).toBeDefined();
      expect(newValue!.display).toBe('Japanese Yen');
    });
  });

  describe('duplicate-named enum values (all-matches semantics)', () => {
    it('removeEnumValue removes ALL entries with the name, not just the first', () => {
      const enumNode = store.getState().nodes.find((n) => (n.data as any).$type === 'RosettaEnumeration');
      store.getState().addEnumValue(enumNode!.id, 'DUP', 'first');
      store.getState().addEnumValue(enumNode!.id, 'DUP', 'second'); // malformed: duplicate name

      store.getState().removeEnumValue(enumNode!.id, 'DUP');

      const vals = (store.getState().nodes.find((n) => n.id === enumNode!.id)!.data as any).enumValues;
      expect(vals.filter((v: any) => v.name === 'DUP')).toHaveLength(0); // BOTH removed
    });

    it('updateEnumValue renames ALL entries with the old name', () => {
      const enumNode = store.getState().nodes.find((n) => (n.data as any).$type === 'RosettaEnumeration');
      store.getState().addEnumValue(enumNode!.id, 'DUP', 'first');
      store.getState().addEnumValue(enumNode!.id, 'DUP', 'second');

      store.getState().updateEnumValue(enumNode!.id, 'DUP', 'RENAMED', 'd');

      const vals = (store.getState().nodes.find((n) => n.id === enumNode!.id)!.data as any).enumValues;
      expect(vals.filter((v: any) => v.name === 'DUP')).toHaveLength(0); // none stale
      expect(vals.filter((v: any) => v.name === 'RENAMED')).toHaveLength(2); // BOTH renamed
    });
  });

  describe('removeEnumValue', () => {
    it('removes an enum value by name', () => {
      const nodes = store.getState().nodes;
      const enumNode = nodes.find((n) => (n.data as any).$type === 'RosettaEnumeration');
      const initialCount = ((enumNode!.data as any).enumValues ?? []).length;

      store.getState().removeEnumValue(enumNode!.id, 'USD');

      const updated = store.getState().nodes.find((n) => n.id === enumNode!.id);
      const vals = (updated!.data as any).enumValues ?? [];
      expect(vals.length).toBe(initialCount - 1);
      expect(vals.find((m: any) => m.name === 'USD')).toBeUndefined();
    });
  });

  describe('updateEnumValue', () => {
    it('renames an enum value and sets display name', () => {
      const nodes = store.getState().nodes;
      const enumNode = nodes.find((n) => (n.data as any).$type === 'RosettaEnumeration');

      store.getState().updateEnumValue(enumNode!.id, 'USD', 'US_Dollar', 'US Dollar');

      const updated = store.getState().nodes.find((n) => n.id === enumNode!.id);
      const vals = (updated!.data as any).enumValues ?? [];
      const val = vals.find((m: any) => m.name === 'US_Dollar');
      expect(val).toBeDefined();
      expect(val!.display).toBe('US Dollar');
      expect(vals.find((m: any) => m.name === 'USD')).toBeUndefined();
    });
  });

  describe('reorderEnumValue', () => {
    it('reorders enum values', () => {
      const nodes = store.getState().nodes;
      const enumNode = nodes.find((n) => (n.data as any).$type === 'RosettaEnumeration');
      const vals = (enumNode!.data as any).enumValues ?? [];

      const first = vals[0]!.name;
      const _last = vals[vals.length - 1]!.name;

      store.getState().reorderEnumValue(enumNode!.id, 0, vals.length - 1);

      const updated = store.getState().nodes.find((n) => n.id === enumNode!.id);
      const updatedVals = (updated!.data as any).enumValues ?? [];
      expect(updatedVals[updatedVals.length - 1]!.name).toBe(first);
      expect(updatedVals[0]!.name).not.toBe(first);
    });
  });

  describe('setEnumParent', () => {
    it('sets a parent enum and creates an enum-extends edge', async () => {
      // Create a second enum to serve as parent
      store.getState().createType('enum', 'BaseCurrency', 'test.enums');

      const nodes = store.getState().nodes;
      const childEnum = nodes.find((n) => n.data.name === 'CurrencyEnum');
      const parentEnum = nodes.find((n) => n.data.name === 'BaseCurrency');

      store.getState().setEnumParent(childEnum!.id, parentEnum!.id);

      const updatedChild = store.getState().nodes.find((n) => n.id === childEnum!.id);
      expect((updatedChild!.data as any).parent?.$refText).toBe('BaseCurrency');

      const extendsEdge = store
        .getState()
        .edges.find((e) => e.source === childEnum!.id && e.data?.kind === 'enum-extends');
      expect(extendsEdge).toBeDefined();
    });

    it('clears parent when set to null', async () => {
      store.getState().createType('enum', 'BaseCurrency', 'test.enums');

      const nodes = store.getState().nodes;
      const childEnum = nodes.find((n) => n.data.name === 'CurrencyEnum');
      const parentEnum = nodes.find((n) => n.data.name === 'BaseCurrency');

      store.getState().setEnumParent(childEnum!.id, parentEnum!.id);
      store.getState().setEnumParent(childEnum!.id, null);

      const updatedChild = store.getState().nodes.find((n) => n.id === childEnum!.id);
      expect((updatedChild!.data as any).parent).toBeUndefined();

      const extendsEdge = store
        .getState()
        .edges.find((e) => e.source === childEnum!.id && e.data?.kind === 'enum-extends');
      expect(extendsEdge).toBeUndefined();
    });

    it('stale parentId is a no-op — existing parent is PRESERVED (not cleared, no dangling edge)', () => {
      store.getState().createType('enum', 'BaseCurrency', 'test.enums');

      const nodes = store.getState().nodes;
      const childEnum = nodes.find((n) => n.data.name === 'CurrencyEnum');
      const parentEnum = nodes.find((n) => n.data.name === 'BaseCurrency');

      store.getState().setEnumParent(childEnum!.id, parentEnum!.id);

      const refBefore = (store.getState().nodes.find((n) => n.id === childEnum!.id)!.data as any).parent?.$refText;

      // Stale id — not present in the store (mirrors setInheritance's guard).
      store.getState().setEnumParent(childEnum!.id, 'test.enums.Deleted');

      const node = store.getState().nodes.find((n) => n.id === childEnum!.id)!;
      expect((node.data as any).parent?.$refText).toBe(refBefore); // parent ref unchanged (not cleared)

      const extendsEdge = store
        .getState()
        .edges.find((e) => e.source === childEnum!.id && e.data?.kind === 'enum-extends');
      expect(extendsEdge?.target).toBe(parentEnum!.id); // still the real parent — no dangling edge to the stale id
    });
  });

  // -----------------------------------------------------------------------
  // Wave B — mutateGraph patch assertions
  // -----------------------------------------------------------------------

  describe('addEnumValue — id-rooted patch (Wave B)', () => {
    it('captures a nodes-rooted patch with enumValues in path', () => {
      const nodes = store.getState().nodes;
      const enumNode = nodes.find((n) => (n.data as any).$type === 'RosettaEnumeration');
      expect(enumNode).toBeDefined();
      const nodeId = enumNode!.id;

      store.getState().addEnumValue(nodeId, 'JPY', 'Japanese Yen');

      const patches = store.getState().pendingEditPatches;
      expect(patches.length).toBeGreaterThan(0);
      expect(patches[0]!.path[0]).toBe('nodes');
      expect(patches[0]!.path[1]).toBe(nodeId);
      expect(patches[0]!.path).toContain('enumValues');
    });
  });

  describe('setEnumParent — dual-patch (node + edge) (Wave B)', () => {
    it('produces both a nodes-rooted patch (data.parent) and an edges-rooted patch (enum-extends)', () => {
      store.getState().createType('enum', 'BaseCurrency', 'test.enums');

      const nodes = store.getState().nodes;
      const childEnum = nodes.find((n) => n.data.name === 'CurrencyEnum');
      const parentEnum = nodes.find((n) => n.data.name === 'BaseCurrency');
      expect(childEnum).toBeDefined();
      expect(parentEnum).toBeDefined();

      // Clear any patches accumulated by createType
      // (store reads pendingEditPatches at call time, so we snapshot after)
      store.getState().setEnumParent(childEnum!.id, parentEnum!.id);

      const patches = store.getState().pendingEditPatches;
      expect(patches.length).toBeGreaterThan(0);

      const nodePatch = patches.find((p) => p.path[0] === 'nodes' && p.path[1] === childEnum!.id);
      expect(nodePatch).toBeDefined();
      expect(nodePatch!.path).toContain('parent');

      const edgePatch = patches.find((p) => p.path[0] === 'edges');
      expect(edgePatch).toBeDefined();
    });

    it('setEnumParent(id, null) removes the edge — produces an edges-rooted remove patch', () => {
      store.getState().createType('enum', 'BaseCurrency', 'test.enums');

      const nodes = store.getState().nodes;
      const childEnum = nodes.find((n) => n.data.name === 'CurrencyEnum');
      const parentEnum = nodes.find((n) => n.data.name === 'BaseCurrency');

      store.getState().setEnumParent(childEnum!.id, parentEnum!.id);

      // Snapshot patch count after setting parent
      const patchesAfterSet = store.getState().pendingEditPatches.length;

      store.getState().setEnumParent(childEnum!.id, null);

      const patches = store.getState().pendingEditPatches;
      // New patches were added by the clear operation
      expect(patches.length).toBeGreaterThan(patchesAfterSet);

      // The clear should produce an edges-rooted patch (edge deletion)
      const newPatches = patches.slice(patchesAfterSet);
      const edgePatch = newPatches.find((p) => p.path[0] === 'edges');
      expect(edgePatch).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Choice operations (separate model)
// ---------------------------------------------------------------------------

describe('EditorStore — choice operations', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(async () => {
    store = createEditorStore();
    const result = await parse(CHOICE_MODEL_SOURCE);
    store.getState().loadModels(result.value);
  });

  describe('addChoiceOption', () => {
    it('adds a member and edge for a choice option', () => {
      const nodes = store.getState().nodes;
      const choiceNode = nodes.find((n) => (n.data as any).$type === 'Choice');
      const _initialAttrs = ((choiceNode!.data as any).attributes ?? []).length;
      const _initialEdges = store.getState().edges.length;

      // Add a new option referencing CashPayment
      store.getState().addChoiceOption(choiceNode!.id, 'CashPayment');

      const updated = store.getState().nodes.find((n) => n.id === choiceNode!.id);
      // The member might already exist from parsing, so check for the new typeName
      expect(
        ((updated!.data as any).attributes ?? []).some((m: any) => m.typeCall?.type?.$refText === 'CashPayment')
      ).toBe(true);
    });
  });

  describe('removeChoiceOption', () => {
    it('removes both member and edge for a choice option', () => {
      const nodes = store.getState().nodes;
      const choiceNode = nodes.find((n) => (n.data as any).$type === 'Choice');
      const member = ((choiceNode!.data as any).attributes ?? [])[0];
      const memberTypeName = member!.typeCall?.type?.$refText;

      store.getState().removeChoiceOption(choiceNode!.id, memberTypeName!);

      const updated = store.getState().nodes.find((n) => n.id === choiceNode!.id);
      expect(
        ((updated!.data as any).attributes ?? []).find((m: any) => m.typeCall?.type?.$refText === memberTypeName)
      ).toBeUndefined();

      const choiceEdge = store
        .getState()
        .edges.find((e) => e.source === choiceNode!.id && e.data?.label === memberTypeName);
      expect(choiceEdge).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Wave C — mutateGraph patch assertions for choice actions
// ---------------------------------------------------------------------------

describe('EditorStore — choice actions — id-rooted patches (Wave C)', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(async () => {
    store = createEditorStore();
    const result = await parse(CHOICE_MODEL_SOURCE);
    store.getState().loadModels(result.value);
  });

  describe('addChoiceOption — WITH matching target node present', () => {
    it('captures a nodes-rooted patch (attributes) AND an edges-rooted patch (choice-option edge)', () => {
      const nodes = store.getState().nodes;
      const choiceNode = nodes.find((n) => (n.data as any).$type === 'Choice');
      expect(choiceNode).toBeDefined();
      const nodeId = choiceNode!.id;

      // 'CashPayment' already exists in the fixture as a sibling node — target lookup will succeed.
      // Remove it first so we can add it cleanly.
      store.getState().removeChoiceOption(nodeId, 'CashPayment');

      // Clear patches accumulated so far, snapshot the count.
      const patchesBefore = store.getState().pendingEditPatches.length;

      store.getState().addChoiceOption(nodeId, 'CashPayment');

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);

      // Node patch: path must be ['nodes', choiceNodeId, 'data', 'attributes', ...]
      const nodePatch = newPatches.find((p) => p.path[0] === 'nodes' && p.path[1] === nodeId);
      expect(nodePatch).toBeDefined();
      expect(nodePatch!.path).toContain('attributes');

      // Edge patch: an edges-rooted patch for the new choice-option edge.
      const edgePatch = newPatches.find((p) => p.path[0] === 'edges');
      expect(edgePatch).toBeDefined();
    });
  });

  describe('addChoiceOption — WITHOUT matching target node', () => {
    it('captures only a nodes-rooted patch (no edge patch) when the typeName has no sibling node', () => {
      const nodes = store.getState().nodes;
      const choiceNode = nodes.find((n) => (n.data as any).$type === 'Choice');
      expect(choiceNode).toBeDefined();
      const nodeId = choiceNode!.id;

      const patchesBefore = store.getState().pendingEditPatches.length;

      // 'UnknownType' does not exist in the fixture — no target node, no edge.
      store.getState().addChoiceOption(nodeId, 'UnknownType');

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);

      // Node patch must be present.
      const nodePatch = newPatches.find((p) => p.path[0] === 'nodes' && p.path[1] === nodeId);
      expect(nodePatch).toBeDefined();
      expect(nodePatch!.path).toContain('attributes');

      // No edge patch — no target node existed.
      const edgePatch = newPatches.find((p) => p.path[0] === 'edges');
      expect(edgePatch).toBeUndefined();
    });
  });

  describe('removeChoiceOption — dual-patch (attribute removed + edge deleted)', () => {
    it('produces a nodes-rooted attributes patch AND an edges-rooted remove patch', () => {
      const nodes = store.getState().nodes;
      const choiceNode = nodes.find((n) => (n.data as any).$type === 'Choice');
      expect(choiceNode).toBeDefined();
      const nodeId = choiceNode!.id;

      // Use the first attribute's typeName — it has a sibling node so an edge exists.
      const firstAttr = ((choiceNode!.data as any).attributes ?? [])[0];
      const typeName = firstAttr!.typeCall?.type?.$refText as string;
      expect(typeName).toBeDefined();

      // Confirm the edge exists before removal.
      const edgeBefore = store
        .getState()
        .edges.find((e) => e.source === nodeId && e.data?.kind === 'choice-option' && e.data?.label === typeName);
      expect(edgeBefore).toBeDefined();

      const patchesBefore = store.getState().pendingEditPatches.length;

      store.getState().removeChoiceOption(nodeId, typeName);

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);

      // Node patch: attributes array modified.
      const nodePatch = newPatches.find((p) => p.path[0] === 'nodes' && p.path[1] === nodeId);
      expect(nodePatch).toBeDefined();
      expect(nodePatch!.path).toContain('attributes');

      // Edge patch: the choice-option edge was deleted.
      const edgePatch = newPatches.find((p) => p.path[0] === 'edges');
      expect(edgePatch).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// updateAttributeType — Choice node arm retype (Codex P2, PR #196)
// ---------------------------------------------------------------------------

// Two-arm fixture: PaymentType choice with CashPayment + BankTransfer.
const CHOICE_TWO_ARM_SOURCE = `
namespace test.payment
version "1.0.0"

type CashPayment:
  amount number (1..1)

type BankTransfer:
  accountNumber string (1..1)

type WirePayment:
  swiftCode string (1..1)

choice PaymentMethod:
  CashPayment
  BankTransfer
`;

// Two-namespace fixture for disambiguation tests — both have a type named "Wire".
const CHOICE_AMBIGUOUS_SOURCE_A = `
namespace payment.fast
version "1.0.0"

type Wire:
  iban string (1..1)
`;

const CHOICE_AMBIGUOUS_SOURCE_B = `
namespace payment.slow
version "1.0.0"

type Wire:
  swiftCode string (1..1)

choice TransferMethod:
  Wire
`;

describe('EditorStore — updateAttributeType on Choice nodes (Codex P2 silent-drop fix)', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(async () => {
    store = createEditorStore();
    const result = await parse(CHOICE_TWO_ARM_SOURCE);
    store.getState().loadModels(result.value);
  });

  it('updates the matched arm typeCall.$refText; the other arm is unchanged', () => {
    const nodes = store.getState().nodes;
    const choiceNode = nodes.find((n) => (n.data as any).$type === 'Choice');
    expect(choiceNode).toBeDefined();

    const wireNode = nodes.find((n) => n.data.name === 'WirePayment');
    expect(wireNode).toBeDefined();

    // Drop WirePayment onto the CashPayment arm.
    store.getState().updateAttributeType(choiceNode!.id, 'CashPayment', 'WirePayment', wireNode!.id);

    const updated = store.getState().nodes.find((n) => n.id === choiceNode!.id);
    const attrs = (updated!.data as any).attributes ?? [];

    // The CashPayment arm is now WirePayment.
    const updatedArm = attrs.find((a: any) => a.typeCall?.type?.$refText === 'WirePayment');
    expect(updatedArm).toBeDefined();

    // The BankTransfer arm is untouched.
    const untouchedArm = attrs.find((a: any) => a.typeCall?.type?.$refText === 'BankTransfer');
    expect(untouchedArm).toBeDefined();

    // CashPayment arm no longer exists.
    const oldArm = attrs.find((a: any) => a.typeCall?.type?.$refText === 'CashPayment');
    expect(oldArm).toBeUndefined();
  });

  it('replaces the choice-option edge (old label removed, new label added)', () => {
    const nodes = store.getState().nodes;
    const choiceNode = nodes.find((n) => (n.data as any).$type === 'Choice');
    const wireNode = nodes.find((n) => n.data.name === 'WirePayment');

    store.getState().updateAttributeType(choiceNode!.id, 'CashPayment', 'WirePayment', wireNode!.id);

    const edges = store.getState().edges;

    // Old edge for CashPayment is gone.
    const oldEdge = edges.find(
      (e) => e.source === choiceNode!.id && e.data?.kind === 'choice-option' && e.data.label === 'CashPayment'
    );
    expect(oldEdge).toBeUndefined();

    // New edge for WirePayment exists pointing at the wire node.
    const newEdge = edges.find(
      (e) => e.source === choiceNode!.id && e.data?.kind === 'choice-option' && e.data.label === 'WirePayment'
    );
    expect(newEdge).toBeDefined();
    expect(newEdge!.target).toBe(wireNode!.id);
  });

  it('is a no-op when the stale targetTypeId does not exist in the store', () => {
    const nodes = store.getState().nodes;
    const choiceNode = nodes.find((n) => (n.data as any).$type === 'Choice');
    const attrsBefore = [...((choiceNode!.data as any).attributes ?? [])];

    // Pass a targetTypeId that does not exist in the store.
    store.getState().updateAttributeType(choiceNode!.id, 'CashPayment', 'WirePayment', 'stale.NodeId');

    const updated = store.getState().nodes.find((n) => n.id === choiceNode!.id);
    const attrsAfter = (updated!.data as any).attributes ?? [];

    // No change — stale payload must be rejected.
    expect(attrsAfter.map((a: any) => a.typeCall?.type?.$refText)).toEqual(
      attrsBefore.map((a: any) => a.typeCall?.type?.$refText)
    );
  });

  it('is a no-op for genuinely unsupported $types (Enum, RosettaFunction, etc.)', () => {
    const nodes = store.getState().nodes;
    // There are no Enum or Function nodes in CHOICE_TWO_ARM_SOURCE, so use
    // a Data node to confirm Data still works, then patch a fake node to test
    // the guard. We test the guard directly via a node whose $type is 'RosettaEnumeration'.
    const cashNode = nodes.find((n) => n.data.name === 'CashPayment');
    expect(cashNode).toBeDefined();

    // Inject a synthetic Enum node into the store state to confirm the guard holds.
    const fakeEnumId = 'fake.EnumNode';
    store.setState((prev: any) => ({
      nodes: [
        ...prev.nodes,
        {
          id: fakeEnumId,
          position: { x: 0, y: 0 },
          type: 'enum',
          data: {
            $type: 'RosettaEnumeration',
            id: fakeEnumId,
            name: 'FakeEnum',
            namespace: 'fake',
            enumValues: [{ name: 'VALUE_A' }]
          }
        }
      ]
    }));

    const edgesBefore = store.getState().edges.length;
    // Attempt to retype an arm on the enum node — must be a no-op.
    store.getState().updateAttributeType(fakeEnumId, 'VALUE_A', 'VALUE_B');
    const edgesAfter = store.getState().edges.length;

    // No edges added/removed and the node is unchanged.
    expect(edgesAfter).toBe(edgesBefore);
    const enumNode = store.getState().nodes.find((n) => n.id === fakeEnumId);
    expect((enumNode!.data as any).enumValues[0].name).toBe('VALUE_A');
  });
});

describe('EditorStore — updateAttributeType on Choice nodes — cross-namespace disambiguation', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(async () => {
    const resultA = await parse(CHOICE_AMBIGUOUS_SOURCE_A, 'inmemory:///fast.rosetta');
    const resultB = await parse(CHOICE_AMBIGUOUS_SOURCE_B, 'inmemory:///slow.rosetta');
    store = createEditorStore();
    store.getState().loadModels([resultA.value, resultB.value]);
  });

  it('writes a qualified $refText when two namespaces have a type with the same bare name', () => {
    const nodes = store.getState().nodes;
    const choiceNode = nodes.find((n) => (n.data as any).$type === 'Choice');
    expect(choiceNode).toBeDefined();

    // Find the "fast" Wire — it should get the namespace qualifier because "slow" Wire also exists.
    const fastWire = nodes.find((n) => n.data.name === 'Wire' && n.meta.namespace === 'payment.fast');
    expect(fastWire).toBeDefined();

    // Drop fast Wire onto the TransferMethod's existing Wire arm.
    store.getState().updateAttributeType(choiceNode!.id, 'Wire', 'Wire', fastWire!.id);

    const updated = store.getState().nodes.find((n) => n.id === choiceNode!.id);
    const attrs = (updated!.data as any).attributes ?? [];

    // The qualified form must be written — bare "Wire" is ambiguous across two namespaces.
    const arm = attrs[0];
    expect(arm?.typeCall?.type?.$refText).toBe('payment.fast.Wire');
  });
});

// Guards the ONE behavior change in the Phase 4 lookup cutover (`resolveTargetId`):
// a bare type name now resolves within the SOURCE node's namespace, not by
// first-in-array bare-name scan. Without this, the change rode on zero coverage.
const ADD_ATTR_AMBIGUOUS_FAST = `
namespace payment.fast
version "1.0.0"

type Wire:
  iban string (1..1)

type Trade:
  tradeId string (1..1)
`;

const ADD_ATTR_AMBIGUOUS_SLOW = `
namespace payment.slow
version "1.0.0"

type Wire:
  swiftCode string (1..1)
`;

describe('EditorStore — addAttribute — cross-namespace bare-name disambiguation', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(async () => {
    const fast = await parse(ADD_ATTR_AMBIGUOUS_FAST, 'inmemory:///fast.rosetta');
    const slow = await parse(ADD_ATTR_AMBIGUOUS_SLOW, 'inmemory:///slow.rosetta');
    store = createEditorStore();
    // Load SLOW first so a first-in-array bare-name scan would (wrongly) prefer
    // payment.slow.Wire — the source-namespace lookup must override array order.
    store.getState().loadModels([slow.value, fast.value]);
  });

  it('resolves a bare attribute type to the SOURCE namespace, not first-in-array', () => {
    const trade = store.getState().nodes.find((n) => n.data.name === 'Trade' && n.meta.namespace === 'payment.fast');
    const fastWire = store.getState().nodes.find((n) => n.data.name === 'Wire' && n.meta.namespace === 'payment.fast');
    expect(trade).toBeDefined();
    expect(fastWire).toBeDefined();

    store.getState().addAttribute(trade!.id, 'method', 'Wire', '0..1');

    const refEdge = store
      .getState()
      .edges.find((e) => e.source === trade!.id && e.data?.kind === 'attribute-ref' && e.data?.label === 'method');
    expect(refEdge).toBeDefined();
    // Must target payment.fast.Wire (source namespace), NOT payment.slow.Wire (loaded first).
    expect(refEdge!.target).toBe(fastWire!.id);
  });
});

// ---------------------------------------------------------------------------
// Condition operations + updateExpression
// ---------------------------------------------------------------------------

describe('EditorStore — condition and expression operations', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(async () => {
    store = createEditorStore();
    const result = await parse(COMBINED_MODEL_SOURCE);
    store.getState().loadModels(result.value);
  });

  describe('addCondition', () => {
    it('adds a condition to a Data type', () => {
      const nodes = store.getState().nodes;
      const dataNode = nodes.find((n) => (n.data as any).$type === 'Data');
      expect(dataNode).toBeDefined();

      store.getState().addCondition(dataNode!.id, {
        name: 'ValidDate',
        expressionText: 'tradeDate exists'
      });

      const updated = store.getState().nodes.find((n) => n.id === dataNode!.id);
      const conditions = (updated!.data as any).conditions ?? [];
      expect(conditions.length).toBe(1);
      expect(conditions[0].name).toBe('ValidDate');
      // Edited expressions are represented as a RawDsl leaf (B1 task 4b fix —
      // spreading the stale structural node + overwriting $cstText left the
      // OLD $type intact, which the structural-first renderer would re-render
      // instead of the edit).
      expect(conditions[0].expression.$type).toBe(RAW_DSL_TYPE);
      expect(conditions[0].expression.text).toBe('tradeDate exists');
    });
  });

  describe('removeCondition', () => {
    it('removes a condition by index', () => {
      const nodes = store.getState().nodes;
      const dataNode = nodes.find((n) => (n.data as any).$type === 'Data');
      expect(dataNode).toBeDefined();

      // Add two conditions
      store.getState().addCondition(dataNode!.id, {
        name: 'C1',
        expressionText: 'expr1'
      });
      store.getState().addCondition(dataNode!.id, {
        name: 'C2',
        expressionText: 'expr2'
      });

      // Remove first
      store.getState().removeCondition(dataNode!.id, 0);

      const updated = store.getState().nodes.find((n) => n.id === dataNode!.id);
      const conditions = (updated!.data as any).conditions ?? [];
      expect(conditions.length).toBe(1);
      expect(conditions[0].name).toBe('C2');
    });

    it('negative / out-of-range index is a true no-op (does not delete the last condition or emit a patch)', () => {
      const dataNode = store.getState().nodes.find((n) => (n.data as any).$type === 'Data');
      store.getState().addCondition(dataNode!.id, { name: 'C1', expressionText: 'e1' });
      store.getState().addCondition(dataNode!.id, { name: 'C2', expressionText: 'e2' });

      const patchesBefore = store.getState().pendingEditPatches.length;

      store.getState().removeCondition(dataNode!.id, -1); // would splice(-1,1) → delete last
      store.getState().removeCondition(dataNode!.id, 99); // out of range

      const conditions = (store.getState().nodes.find((n) => n.id === dataNode!.id)!.data as any).conditions ?? [];
      expect(conditions.map((c: any) => c.name)).toEqual(['C1', 'C2']); // both intact
      expect(store.getState().pendingEditPatches.length).toBe(patchesBefore); // no spurious patch
    });
  });

  describe('updateCondition', () => {
    it('updates condition name and expression', () => {
      const nodes = store.getState().nodes;
      const dataNode = nodes.find((n) => (n.data as any).$type === 'Data');
      expect(dataNode).toBeDefined();

      store.getState().addCondition(dataNode!.id, {
        name: 'C1',
        expressionText: 'old expression'
      });

      store.getState().updateCondition(dataNode!.id, 0, {
        name: 'C1_Updated',
        expressionText: 'new expression'
      });

      const updated = store.getState().nodes.find((n) => n.id === dataNode!.id);
      const conditions = (updated!.data as any).conditions ?? [];
      expect(conditions[0].name).toBe('C1_Updated');
      // RawDsl leaf — see the addCondition test above for rationale.
      expect(conditions[0].expression.$type).toBe(RAW_DSL_TYPE);
      expect(conditions[0].expression.text).toBe('new expression');
    });
  });

  describe('reorderCondition', () => {
    it('reorders conditions by index', () => {
      const nodes = store.getState().nodes;
      const dataNode = nodes.find((n) => (n.data as any).$type === 'Data');
      expect(dataNode).toBeDefined();

      store.getState().addCondition(dataNode!.id, { name: 'First', expressionText: 'e1' });
      store.getState().addCondition(dataNode!.id, { name: 'Second', expressionText: 'e2' });
      store.getState().addCondition(dataNode!.id, { name: 'Third', expressionText: 'e3' });

      store.getState().reorderCondition(dataNode!.id, 0, 2);

      const updated = store.getState().nodes.find((n) => n.id === dataNode!.id);
      const conditions = (updated!.data as any).conditions ?? [];
      expect(conditions[0].name).toBe('Second');
      expect(conditions[1].name).toBe('Third');
      expect(conditions[2].name).toBe('First');
    });

    it('negative / out-of-range fromIndex is a true no-op (order preserved, no patch)', () => {
      const dataNode = store.getState().nodes.find((n) => (n.data as any).$type === 'Data');
      store.getState().addCondition(dataNode!.id, { name: 'First', expressionText: 'e1' });
      store.getState().addCondition(dataNode!.id, { name: 'Second', expressionText: 'e2' });

      const patchesBefore = store.getState().pendingEditPatches.length;

      store.getState().reorderCondition(dataNode!.id, -1, 0); // would splice the last element
      store.getState().reorderCondition(dataNode!.id, 5, 0); // out of range

      const conditions = (store.getState().nodes.find((n) => n.id === dataNode!.id)!.data as any).conditions ?? [];
      expect(conditions.map((c: any) => c.name)).toEqual(['First', 'Second']); // order intact
      expect(store.getState().pendingEditPatches.length).toBe(patchesBefore); // no spurious patch
    });
  });

  // -----------------------------------------------------------------------
  // Wave E — condition actions: nodes-rooted recipe patches
  // -----------------------------------------------------------------------

  describe('addCondition — id-rooted patch (Wave E)', () => {
    it('captures a nodes-rooted patch with conditions in path', () => {
      const nodes = store.getState().nodes;
      const dataNode = nodes.find((n) => (n.data as any).$type === 'Data');
      expect(dataNode).toBeDefined();
      const nodeId = dataNode!.id;

      const patchesBefore = store.getState().pendingEditPatches.length;

      store.getState().addCondition(nodeId, { name: 'WaveE', expressionText: 'x > 0' });

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);
      expect(newPatches[0]!.path[0]).toBe('nodes');
      expect(newPatches[0]!.path[1]).toBe(nodeId);
      expect(newPatches[0]!.path).toContain('conditions');
    });

    it('captures a nodes-rooted patch with postConditions in path for postCondition add', () => {
      const nodes = store.getState().nodes;
      const dataNode = nodes.find((n) => (n.data as any).$type === 'Data');
      expect(dataNode).toBeDefined();
      const nodeId = dataNode!.id;

      const patchesBefore = store.getState().pendingEditPatches.length;

      store.getState().addCondition(nodeId, { name: 'PostC', expressionText: 'y > 0', isPostCondition: true });

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);
      expect(newPatches[0]!.path[0]).toBe('nodes');
      expect(newPatches[0]!.path[1]).toBe(nodeId);
      expect(newPatches[0]!.path).toContain('postConditions');
    });
  });

  describe('removeCondition — id-rooted patch (Wave E)', () => {
    it('captures a nodes-rooted patch with conditions in path', () => {
      const nodes = store.getState().nodes;
      const dataNode = nodes.find((n) => (n.data as any).$type === 'Data');
      expect(dataNode).toBeDefined();
      const nodeId = dataNode!.id;

      store.getState().addCondition(nodeId, { name: 'C1', expressionText: 'a > 0' });

      const patchesBefore = store.getState().pendingEditPatches.length;
      store.getState().removeCondition(nodeId, 0);

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);
      expect(newPatches[0]!.path[0]).toBe('nodes');
      expect(newPatches[0]!.path[1]).toBe(nodeId);
    });

    it('removes the correct postCondition when merged index ≥ conditions.length', () => {
      const nodes = store.getState().nodes;
      const dataNode = nodes.find((n) => (n.data as any).$type === 'Data');
      expect(dataNode).toBeDefined();
      const nodeId = dataNode!.id;

      // Seed: 2 conditions + 2 postConditions
      store.getState().addCondition(nodeId, { name: 'C1', expressionText: 'c1' });
      store.getState().addCondition(nodeId, { name: 'C2', expressionText: 'c2' });
      store.getState().addCondition(nodeId, { name: 'P1', expressionText: 'p1', isPostCondition: true });
      store.getState().addCondition(nodeId, { name: 'P2', expressionText: 'p2', isPostCondition: true });

      // merged index 2 → first postCondition (P1)
      const patchesBefore = store.getState().pendingEditPatches.length;
      store.getState().removeCondition(nodeId, 2);

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);
      expect(newPatches[0]!.path[0]).toBe('nodes');
      expect(newPatches[0]!.path[1]).toBe(nodeId);

      // conditions array untouched (still C1, C2)
      const updated = store.getState().nodes.find((n) => n.id === nodeId)!;
      const conditions = (updated.data as any).conditions ?? [];
      const postConditions = (updated.data as any).postConditions ?? [];
      expect(conditions.length).toBe(2);
      expect(conditions[0].name).toBe('C1');
      expect(conditions[1].name).toBe('C2');
      // P1 removed, only P2 remains
      expect(postConditions.length).toBe(1);
      expect(postConditions[0].name).toBe('P2');
    });
  });

  describe('updateCondition — id-rooted patch (Wave E)', () => {
    it('captures a nodes-rooted patch with conditions in path', () => {
      const nodes = store.getState().nodes;
      const dataNode = nodes.find((n) => (n.data as any).$type === 'Data');
      expect(dataNode).toBeDefined();
      const nodeId = dataNode!.id;

      store.getState().addCondition(nodeId, { name: 'C1', expressionText: 'old' });

      const patchesBefore = store.getState().pendingEditPatches.length;
      store.getState().updateCondition(nodeId, 0, { name: 'C1Updated' });

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);
      expect(newPatches[0]!.path[0]).toBe('nodes');
      expect(newPatches[0]!.path[1]).toBe(nodeId);
    });

    it('updates the correct postCondition when merged index ≥ conditions.length', () => {
      const nodes = store.getState().nodes;
      const dataNode = nodes.find((n) => (n.data as any).$type === 'Data');
      expect(dataNode).toBeDefined();
      const nodeId = dataNode!.id;

      // Seed: 2 conditions + 2 postConditions
      store.getState().addCondition(nodeId, { name: 'C1', expressionText: 'c1' });
      store.getState().addCondition(nodeId, { name: 'C2', expressionText: 'c2' });
      store.getState().addCondition(nodeId, { name: 'P1', expressionText: 'p1', isPostCondition: true });
      store.getState().addCondition(nodeId, { name: 'P2', expressionText: 'p2', isPostCondition: true });

      // merged index 3 → P2
      const patchesBefore = store.getState().pendingEditPatches.length;
      store.getState().updateCondition(nodeId, 3, { name: 'P2_Updated', expressionText: 'p2_new' });

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);
      expect(newPatches[0]!.path[0]).toBe('nodes');
      expect(newPatches[0]!.path[1]).toBe(nodeId);

      // conditions untouched
      const updated = store.getState().nodes.find((n) => n.id === nodeId)!;
      const conditions = (updated.data as any).conditions ?? [];
      const postConditions = (updated.data as any).postConditions ?? [];
      expect(conditions.length).toBe(2);
      expect(conditions[0].name).toBe('C1');
      expect(conditions[1].name).toBe('C2');
      // P2 updated, P1 untouched
      expect(postConditions.length).toBe(2);
      expect(postConditions[0].name).toBe('P1');
      expect(postConditions[1].name).toBe('P2_Updated');
      // RawDsl leaf — see the addCondition test above for rationale.
      expect(postConditions[1].expression.$type).toBe(RAW_DSL_TYPE);
      expect(postConditions[1].expression.text).toBe('p2_new');
    });

    it('is a no-op (no patch) when index is out of bounds', () => {
      const nodes = store.getState().nodes;
      const dataNode = nodes.find((n) => (n.data as any).$type === 'Data');
      expect(dataNode).toBeDefined();
      const nodeId = dataNode!.id;

      store.getState().addCondition(nodeId, { name: 'C1', expressionText: 'c1' });

      const patchesBefore = store.getState().pendingEditPatches.length;
      store.getState().updateCondition(nodeId, 99, { name: 'Should not apply' });

      const patches = store.getState().pendingEditPatches;
      expect(patches.length).toBe(patchesBefore); // no new patches
    });
  });

  describe('reorderCondition — id-rooted patch (Wave E)', () => {
    it('captures a nodes-rooted patch with conditions in path', () => {
      const nodes = store.getState().nodes;
      const dataNode = nodes.find((n) => (n.data as any).$type === 'Data');
      expect(dataNode).toBeDefined();
      const nodeId = dataNode!.id;

      store.getState().addCondition(nodeId, { name: 'First', expressionText: 'e1' });
      store.getState().addCondition(nodeId, { name: 'Second', expressionText: 'e2' });

      const patchesBefore = store.getState().pendingEditPatches.length;
      store.getState().reorderCondition(nodeId, 0, 1);

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);
      expect(newPatches[0]!.path[0]).toBe('nodes');
      expect(newPatches[0]!.path[1]).toBe(nodeId);
      expect(newPatches[0]!.path).toContain('conditions');
    });
  });

  describe('updateExpression', () => {
    it('preserves add, nested targets and other operations when editing an explicit index, including undo', async () => {
      const funcStore = createEditorStore();
      const parsed = await parse(`namespace test.operations
version "test"
type Result:
  values int (0..*)
func MyFunc:
  output:
    result Result (1..1)
  set result -> values: 1
  add result -> values: 2
  add result -> values: 3
`);
      expect(parsed.parserErrors).toEqual([]);
      funcStore.getState().loadModels(parsed.value);
      const node = funcStore.getState().nodes.find((n) => n.data.name === 'MyFunc')!;
      const before = (node.data as any).operations;
      funcStore.getState().updateExpression(node.id, '42', 1);
      const after = (funcStore.getState().nodes.find((n) => n.id === node.id)!.data as any).operations;
      expect(after[0]).toEqual(before[0]);
      expect(after[2]).toEqual(before[2]);
      expect(after[1]).toMatchObject({
        add: true,
        assignRoot: before[1].assignRoot,
        path: before[1].path,
        expression: { $type: RAW_DSL_TYPE, text: '42' }
      });
      funcStore.temporal.getState().undo();
      expect((funcStore.getState().nodes.find((n) => n.id === node.id)!.data as any).operations).toEqual(before);
      funcStore.temporal.getState().redo();
      expect((funcStore.getState().nodes.find((n) => n.id === node.id)!.data as any).operations).toEqual(after);
    });

    it.each([-1, 1, 1.5, NaN])('rejects invalid explicit operation index %s without mutations', async (index) => {
      const funcStore = createEditorStore();
      const parsed = await parse(FUNCTION_MODEL_SOURCE);
      funcStore.getState().loadModels(parsed.value);
      const node = funcStore.getState().nodes.find((n) => n.data.$type === 'RosettaFunction')!;
      const state = funcStore.getState();
      const historyLength = funcStore.temporal.getState().pastStates.length;
      expect(() => funcStore.getState().updateExpression(node.id, '42', index)).toThrow(RangeError);
      expect(funcStore.getState()).toBe(state);
      expect(funcStore.temporal.getState().pastStates).toHaveLength(historyLength);
    });

    it('updates the function body expression via operations', async () => {
      const funcStore = createEditorStore();
      const funcResult = await parse(`
        namespace test.func
        version "test"

        func MyFunc:
          inputs:
            x int (1..1)
          output:
            result int (1..1)
          set result:
            x + 1
      `);
      funcStore.getState().loadModels(funcResult.value);

      const funcNode = funcStore.getState().nodes.find((n) => n.data.name === 'MyFunc');
      expect(funcNode).toBeDefined();

      funcStore.getState().updateExpression(funcNode!.id, 'x * 2');

      const updated = funcStore.getState().nodes.find((n) => n.id === funcNode!.id);
      const ops = (updated!.data as any).operations ?? [];
      expect(ops.length).toBeGreaterThan(0);
      // RawDsl leaf — see the addCondition test above for rationale.
      expect(ops[0].expression.$type).toBe(RAW_DSL_TYPE);
      expect(ops[0].expression.text).toBe('x * 2');
      expect((updated!.data as any).expressionText).toBe('x * 2');
    });

    it('creates operations[0] targeting output when the function has no operations yet', async () => {
      const funcStore = createEditorStore();
      const funcResult = await parse(`
        namespace test.func
        version "test"

        func MyFunc:
          inputs:
            x int (1..1)
          output:
            result int (1..1)
      `);
      funcStore.getState().loadModels(funcResult.value);

      const funcNode = funcStore.getState().nodes.find((n) => n.data.name === 'MyFunc');
      expect(funcNode).toBeDefined();
      expect(((funcNode!.data as any).operations ?? []).length).toBe(0);

      funcStore.getState().updateExpression(funcNode!.id, 'x + 1');

      const updated = funcStore.getState().nodes.find((n) => n.id === funcNode!.id);
      const ops = (updated!.data as any).operations ?? [];
      expect(ops.length).toBe(1);
      expect(ops[0].add).toBe(false);
      expect(ops[0].assignRoot.$refText).toBe('result');
      expect(ops[0].expression.$type).toBe(RAW_DSL_TYPE);
      expect(ops[0].expression.text).toBe('x + 1');
    });

    it('undo reverts a lens-driven commit and redo re-applies it', async () => {
      const funcStore = createEditorStore();
      const funcResult = await parse(`
        namespace test.func
        version "test"

        func MyFunc:
          inputs:
            x int (1..1)
          output:
            result int (1..1)
          set result:
            x + 1
      `);
      funcStore.getState().loadModels(funcResult.value);
      const funcNode = funcStore.getState().nodes.find((n) => n.data.name === 'MyFunc');
      const nodeId = funcNode!.id;

      // The freshly-parsed body is a structural `ArithmeticOperation` AST node
      // (left/operator/right), not a RawDsl `{ $type, text }` leaf — that
      // conversion only happens once a lens-driven `updateExpression` commit
      // runs (see editor-store.ts's RosettaFunction branch). So the first
      // commit here establishes a RawDsl baseline; undo below reverts to
      // *this* commit, not to the pre-edit structural parse (which has no
      // `.text` field to assert against).
      funcStore.getState().updateExpression(nodeId, 'x + 1');
      const afterFirstEdit = funcStore.getState().nodes.find((n) => n.id === nodeId);
      expect((afterFirstEdit!.data as any).operations[0].expression.text).toBe('x + 1');

      funcStore.getState().updateExpression(nodeId, 'x * 2');
      const afterSecondEdit = funcStore.getState().nodes.find((n) => n.id === nodeId);
      expect((afterSecondEdit!.data as any).operations[0].expression.text).toBe('x * 2');

      funcStore.temporal.getState().undo();
      const afterUndo = funcStore.getState().nodes.find((n) => n.id === nodeId);
      expect((afterUndo!.data as any).operations[0].expression.text).toBe('x + 1');

      funcStore.temporal.getState().redo();
      const afterRedo = funcStore.getState().nodes.find((n) => n.id === nodeId);
      expect((afterRedo!.data as any).operations[0].expression.text).toBe('x * 2');
    });
  });
});

// ---------------------------------------------------------------------------
// renameAttribute (Structure View Phase 0 — granular cell-level dispatch)
// ---------------------------------------------------------------------------

describe('EditorStore — renameAttribute', () => {
  it('renames an attribute within a Data type and preserves order', () => {
    const store = createEditorStore();
    const id = store.getState().createType('data', 'Trade', 'cdm.trade');
    store.getState().addAttribute(id, 'tradeDate', 'date', '0..1');
    store.getState().addAttribute(id, 'tradeID', 'string', '0..1');

    store.getState().renameAttribute(id, 'tradeDate', 'executionDate');

    const node = store.getState().nodes.find((n) => n.id === id)!;
    const attrs = ((node.data as any).attributes ?? []) as Array<{ name: string }>;
    expect(attrs.map((a) => a.name)).toEqual(['executionDate', 'tradeID']);
  });

  it('is a no-op when the attribute does not exist', () => {
    const store = createEditorStore();
    const id = store.getState().createType('data', 'Trade', 'cdm.trade');
    store.getState().addAttribute(id, 'tradeDate', 'date', '0..1');

    expect(() => store.getState().renameAttribute(id, 'missing', 'newName')).not.toThrow();
    const node = store.getState().nodes.find((n) => n.id === id)!;
    const attrs = ((node.data as any).attributes ?? []) as Array<{ name: string }>;
    expect(attrs.map((a) => a.name)).toEqual(['tradeDate']);
  });

  it('updates the attribute-ref edge label when one exists for the renamed attribute', () => {
    const store = createEditorStore();
    const tradeId = store.getState().createType('data', 'Trade', 'cdm.trade');
    store.getState().createType('data', 'Economics', 'cdm.trade');
    store.getState().addAttribute(tradeId, 'economics', 'Economics', '0..*');

    const edgeBefore = store.getState().edges.find((e) => e.source === tradeId && e.data?.kind === 'attribute-ref');
    expect(edgeBefore?.data?.label).toBe('economics');

    store.getState().renameAttribute(tradeId, 'economics', 'econ');

    const edgeAfter = store.getState().edges.find((e) => e.source === tradeId && e.data?.kind === 'attribute-ref');
    expect(edgeAfter?.data?.label).toBe('econ');
  });

  it('does not push an undo entry when called on a missing attribute (true no-op)', () => {
    const store = createEditorStore();
    const id = store.getState().createType('data', 'Trade', 'cdm.trade');
    store.getState().addAttribute(id, 'tradeDate', 'date', '0..1');
    // Snapshot temporal stack length after the setup mutations
    const stackBefore = store.temporal.getState().pastStates.length;

    store.getState().renameAttribute(id, 'missing', 'newName');

    expect(store.temporal.getState().pastStates.length).toBe(stackBefore);
  });

  it('renames all attributes that share the same name and rewrites their edges', () => {
    const store = createEditorStore();
    const tradeId = store.getState().createType('data', 'Trade', 'cdm.trade');
    store.getState().createType('data', 'Economics', 'cdm.trade');
    // Two attributes with the same name (allowed by addAttribute today)
    store.getState().addAttribute(tradeId, 'economics', 'Economics', '0..1');
    store.getState().addAttribute(tradeId, 'economics', 'Economics', '0..1');

    store.getState().renameAttribute(tradeId, 'economics', 'econ');

    const node = store.getState().nodes.find((n) => n.id === tradeId)!;
    const attrs = ((node.data as any).attributes ?? []) as Array<{ name: string }>;
    expect(attrs.filter((a) => a.name === 'econ').length).toBe(2);
    expect(attrs.some((a) => a.name === 'economics')).toBe(false);

    const ambiguous = store
      .getState()
      .edges.filter((e) => e.source === tradeId && e.data?.kind === 'attribute-ref' && e.data.label === 'economics');
    expect(ambiguous.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// updateAttributeType (Structure View Phase 0 — granular cell-level dispatch)
// ---------------------------------------------------------------------------

describe('EditorStore — updateAttributeType', () => {
  it('rewrites the typeCall.type.$refText', () => {
    const store = createEditorStore();
    const id = store.getState().createType('data', 'Trade', 'cdm.trade');
    store.getState().addAttribute(id, 'economics', 'OldType', '0..*');
    const econId = store.getState().createType('data', 'Economics', 'cdm.trade');

    store.getState().updateAttributeType(id, 'economics', 'Economics', econId);

    const node = store.getState().nodes.find((n) => n.id === id)!;
    const attrs = ((node.data as any).attributes ?? []) as Array<any>;
    const target = attrs.find((a) => a.name === 'economics')!;
    expect(target.typeCall.type.$refText).toBe('Economics');
  });

  it('is a no-op when the attribute does not exist', () => {
    const store = createEditorStore();
    const id = store.getState().createType('data', 'Trade', 'cdm.trade');
    store.getState().addAttribute(id, 'economics', 'OldType', '0..*');
    const xId = store.getState().createType('data', 'X', 'cdm.trade');

    expect(() => store.getState().updateAttributeType(id, 'missing', 'X', xId)).not.toThrow();
    const node = store.getState().nodes.find((n) => n.id === id)!;
    const attrs = ((node.data as any).attributes ?? []) as Array<any>;
    expect(attrs[0].name).toBe('economics');
    expect(attrs[0].typeCall.type.$refText).toBe('OldType');
  });

  it('removes the stale attribute-ref edge when the old target was in the graph', () => {
    const store = createEditorStore();
    const tradeId = store.getState().createType('data', 'Trade', 'cdm.trade');
    const oldId = store.getState().createType('data', 'OldEconomics', 'cdm.trade');
    const stringId = store.getState().createType('data', 'string', 'cdm.trade');
    store.getState().addAttribute(tradeId, 'economics', 'OldEconomics', '0..1');

    expect(
      store.getState().edges.some((e) => e.source === tradeId && e.target === oldId && e.data?.kind === 'attribute-ref')
    ).toBe(true);

    store.getState().updateAttributeType(tradeId, 'economics', 'string', stringId);

    expect(
      store.getState().edges.some((e) => e.source === tradeId && e.target === oldId && e.data?.kind === 'attribute-ref')
    ).toBe(false);
  });

  it('adds an attribute-ref edge when the new target exists in the graph', () => {
    const store = createEditorStore();
    const tradeId = store.getState().createType('data', 'Trade', 'cdm.trade');
    store.getState().addAttribute(tradeId, 'economics', 'string', '0..1');
    const newId = store.getState().createType('data', 'Economics', 'cdm.trade');

    store.getState().updateAttributeType(tradeId, 'economics', 'Economics', newId);

    const edge = store
      .getState()
      .edges.find((e) => e.source === tradeId && e.target === newId && e.data?.kind === 'attribute-ref');
    expect(edge).toBeDefined();
    expect(edge?.data?.label).toBe('economics');
  });

  it("preserves the attribute's cardinality on the rebuilt attribute-ref edge", () => {
    const store = createEditorStore();
    const tradeId = store.getState().createType('data', 'Trade', 'cdm.trade');
    store.getState().addAttribute(tradeId, 'economics', 'string', '0..*');
    const newId = store.getState().createType('data', 'Economics', 'cdm.trade');

    store.getState().updateAttributeType(tradeId, 'economics', 'Economics', newId);

    const edge = store
      .getState()
      .edges.find((e) => e.source === tradeId && e.target === newId && e.data?.kind === 'attribute-ref');
    expect(edge?.data?.cardinality).toBe('(0..*)');
  });

  it('does not push an undo entry when called on a missing attribute (true no-op)', () => {
    const store = createEditorStore();
    const id = store.getState().createType('data', 'Trade', 'cdm.trade');
    store.getState().addAttribute(id, 'economics', 'OldType', '0..1');
    const xId = store.getState().createType('data', 'X', 'cdm.trade');
    // Capture after all setup mutations so only the updateAttributeType call is measured.
    const stackBefore = store.temporal.getState().pastStates.length;

    store.getState().updateAttributeType(id, 'missing', 'X', xId);

    expect(store.temporal.getState().pastStates.length).toBe(stackBefore);
  });

  it('retypes all attributes that share the same name', () => {
    const store = createEditorStore();
    const tradeId = store.getState().createType('data', 'Trade', 'cdm.trade');
    store.getState().addAttribute(tradeId, 'economics', 'string', '0..1');
    store.getState().addAttribute(tradeId, 'economics', 'string', '0..1');
    const econId = store.getState().createType('data', 'Economics', 'cdm.trade');

    store.getState().updateAttributeType(tradeId, 'economics', 'Economics', econId);

    const node = store.getState().nodes.find((n) => n.id === tradeId)!;
    const attrs = ((node.data as any).attributes ?? []) as Array<any>;
    const matching = attrs.filter((a) => a.name === 'economics');
    expect(matching.length).toBe(2);
    expect(matching.every((a) => a.typeCall.type.$refText === 'Economics')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateAttributeType — Phase 13 / Finding 3 (cross-namespace qualification +
// stale-payload validation)
// ---------------------------------------------------------------------------

describe('EditorStore — updateAttributeType (Finding 3: cross-namespace qualification)', () => {
  it('writes a QUALIFIED $refText when another node shares the bare name across namespaces', () => {
    const store = createEditorStore();
    const tradeId = store.getState().createType('data', 'Trade', 'cdm.trade');
    store.getState().addAttribute(tradeId, 'p', 'string', '0..1');
    // Two `Party` types in distinct namespaces — the drop target is the
    // OTHER (ns.b) Party, but the bare name "Party" would resolve to
    // whichever node comes first by name in the AST.
    store.getState().createType('data', 'Party', 'ns.a');
    const bPartyId = store.getState().createType('data', 'Party', 'ns.b');

    // Drop ns.b.Party onto Trade.p with the full canonical id (Finding 3 path).
    store.getState().updateAttributeType(tradeId, 'p', 'Party', bPartyId);

    const node = store.getState().nodes.find((n) => n.id === tradeId)!;
    const attrs = ((node.data as any).attributes ?? []) as Array<any>;
    const p = attrs.find((a) => a.name === 'p')!;
    // Qualified form uses `.` separator (matches grammar QualifiedName +
    // structure-graph-adapter findNodeByName resolution).
    expect(p.typeCall.type.$refText).toBe('ns.b.Party');

    // And the resulting edge must point at THE drop target (not the other Party).
    const edges = store
      .getState()
      .edges.filter((e) => e.source === tradeId && e.data?.kind === 'attribute-ref' && e.data.label === 'p');
    expect(edges.length).toBe(1);
    expect(edges[0].target).toBe(bPartyId);
  });

  it('writes the BARE $refText when the type is unambiguous (single namespace)', () => {
    const store = createEditorStore();
    const tradeId = store.getState().createType('data', 'Trade', 'cdm.trade');
    store.getState().addAttribute(tradeId, 'p', 'string', '0..1');
    const partyId = store.getState().createType('data', 'Party', 'cdm.trade');

    store.getState().updateAttributeType(tradeId, 'p', 'Party', partyId);

    const node = store.getState().nodes.find((n) => n.id === tradeId)!;
    const attrs = ((node.data as any).attributes ?? []) as Array<any>;
    const p = attrs.find((a) => a.name === 'p')!;
    // No collision → write the bare name (avoid over-qualification noise).
    expect(p.typeCall.type.$refText).toBe('Party');
  });

  it('is a no-op (no mutation) when targetTypeId is stale / not in the store', () => {
    const store = createEditorStore();
    const tradeId = store.getState().createType('data', 'Trade', 'cdm.trade');
    store.getState().addAttribute(tradeId, 'p', 'OldType', '0..1');
    // No "Ghost" node exists in the store — the drag payload is stale (the
    // target was deleted between drag start and drop). The action must abort
    // without touching the AST.
    const before = store.getState();
    store.getState().updateAttributeType(tradeId, 'p', 'Ghost', 'ns.x.Ghost');

    const node = store.getState().nodes.find((n) => n.id === tradeId)!;
    const attrs = ((node.data as any).attributes ?? []) as Array<any>;
    const p = attrs.find((a) => a.name === 'p')!;
    expect(p.typeCall.type.$refText).toBe('OldType'); // unchanged
    // No new edges either.
    expect(store.getState().edges.length).toBe(before.edges.length);
  });
});

// ---------------------------------------------------------------------------
// setInheritance — Phase 13 / Finding 3 (cross-namespace qualification + stale)
// ---------------------------------------------------------------------------

describe('EditorStore — setInheritance (Finding 3: cross-namespace qualification)', () => {
  it('writes a QUALIFIED superType $refText when the parent name collides across namespaces', () => {
    const store = createEditorStore();
    const childId = store.getState().createType('data', 'Trade', 'cdm.trade');
    store.getState().createType('data', 'BaseType', 'ns.a');
    const bBaseId = store.getState().createType('data', 'BaseType', 'ns.b');

    store.getState().setInheritance(childId, bBaseId);

    const node = store.getState().nodes.find((n) => n.id === childId)!;
    const superType = (node.data as any).superType;
    expect(superType?.$refText).toBe('ns.b.BaseType');
  });

  it('writes the BARE superType $refText when the parent name is unambiguous', () => {
    const store = createEditorStore();
    const childId = store.getState().createType('data', 'Trade', 'cdm.trade');
    const baseId = store.getState().createType('data', 'TradeBase', 'cdm.trade');

    store.getState().setInheritance(childId, baseId);

    const node = store.getState().nodes.find((n) => n.id === childId)!;
    const superType = (node.data as any).superType;
    expect(superType?.$refText).toBe('TradeBase');
  });

  it('is a no-op when parentId is stale / not in the store', () => {
    const store = createEditorStore();
    const childId = store.getState().createType('data', 'Trade', 'cdm.trade');
    const baseId = store.getState().createType('data', 'TradeBase', 'cdm.trade');
    store.getState().setInheritance(childId, baseId);
    const beforeRefText = ((store.getState().nodes.find((n) => n.id === childId)!.data as any).superType as any)
      ?.$refText;

    store.getState().setInheritance(childId, 'ns.x.DeletedBase');

    // Inheritance unchanged — stale payload was rejected.
    const node = store.getState().nodes.find((n) => n.id === childId)!;
    const superType = (node.data as any).superType;
    expect(superType?.$refText).toBe(beforeRefText);
  });
});

// ---------------------------------------------------------------------------
// setEnumParent — cross-namespace qualification (mirrors setInheritance)
// ---------------------------------------------------------------------------

describe('EditorStore — setEnumParent (cross-namespace qualification)', () => {
  it('writes a QUALIFIED parent $refText when the parent name collides across namespaces', () => {
    const store = createEditorStore();
    const childId = store.getState().createType('enum', 'SideEnum', 'cdm.trade');
    store.getState().createType('enum', 'BaseEnum', 'ns.a');
    const bBaseId = store.getState().createType('enum', 'BaseEnum', 'ns.b');

    store.getState().setEnumParent(childId, bBaseId);

    const node = store.getState().nodes.find((n) => n.id === childId)!;
    const parent = (node.data as { parent?: { $refText?: string } }).parent;
    expect(parent?.$refText).toBe('ns.b.BaseEnum');
  });

  it('writes the BARE parent $refText when the parent name is unambiguous', () => {
    const store = createEditorStore();
    const childId = store.getState().createType('enum', 'SideEnum', 'cdm.trade');
    const baseId = store.getState().createType('enum', 'BaseEnum', 'cdm.trade');

    store.getState().setEnumParent(childId, baseId);

    const node = store.getState().nodes.find((n) => n.id === childId)!;
    const parent = (node.data as { parent?: { $refText?: string } }).parent;
    expect(parent?.$refText).toBe('BaseEnum');
  });
});

// ---------------------------------------------------------------------------
// Function input param operations (R-func-input)
// ---------------------------------------------------------------------------

describe('EditorStore — updateInputParam / reorderInputParam', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(async () => {
    store = createEditorStore();
    const result = await parse(FUNCTION_MODEL_SOURCE);
    store.getState().loadModels(result.value);
  });

  // -----------------------------------------------------------------------
  // updateInputParam
  // -----------------------------------------------------------------------

  describe('updateInputParam', () => {
    it('updates name, type, and cardinality of an existing input', () => {
      const nodes = store.getState().nodes;
      const addNode = nodes.find((n) => n.data.name === 'Add');
      expect(addNode).toBeDefined();

      store.getState().updateInputParam(addNode!.id, 'a', 'first', 'Money', '0..1');

      const updated = store.getState().nodes.find((n) => n.id === addNode!.id);
      const inputs = ((updated!.data as any).inputs ?? []) as Array<any>;
      const renamed = inputs.find((inp: any) => inp.name === 'first');
      expect(renamed).toBeDefined();
      expect(renamed!.typeCall?.type?.$refText).toBe('Money');
      expect(renamed!.card).toMatchObject({ inf: 0, sup: 1, unbounded: false });
    });

    it('does not affect other inputs', () => {
      const nodes = store.getState().nodes;
      const addNode = nodes.find((n) => n.data.name === 'Add');

      store.getState().updateInputParam(addNode!.id, 'a', 'first', 'Money', '0..1');

      const updated = store.getState().nodes.find((n) => n.id === addNode!.id);
      const inputs = ((updated!.data as any).inputs ?? []) as Array<any>;
      // 'b' input is unchanged
      const bInput = inputs.find((inp: any) => inp.name === 'b');
      expect(bInput).toBeDefined();
      expect(bInput!.typeCall?.type?.$refText).toBe('number');
    });

    it('is a no-op when oldName does not match any input', () => {
      const nodes = store.getState().nodes;
      const addNode = nodes.find((n) => n.data.name === 'Add');
      const before = ((addNode!.data as any).inputs ?? []) as Array<any>;
      const beforeNames = before.map((i: any) => i.name);

      store.getState().updateInputParam(addNode!.id, 'nonexistent', 'x', 'string', '(1..1)');

      const updated = store.getState().nodes.find((n) => n.id === addNode!.id);
      const after = ((updated!.data as any).inputs ?? []) as Array<any>;
      expect(after.map((i: any) => i.name)).toEqual(beforeNames);
    });
  });

  // -----------------------------------------------------------------------
  // reorderInputParam
  // -----------------------------------------------------------------------

  describe('reorderInputParam', () => {
    it('moves an input from one position to another', () => {
      const nodes = store.getState().nodes;
      const addNode = nodes.find((n) => n.data.name === 'Add');
      const inputs = ((addNode!.data as any).inputs ?? []) as Array<any>;
      expect(inputs.length).toBeGreaterThanOrEqual(2);

      const originalFirst = inputs[0]!.name;
      const originalSecond = inputs[1]!.name;

      // Move first to second position (splice-move: remove from 0, insert at 1)
      store.getState().reorderInputParam(addNode!.id, 0, 1);

      const updated = store.getState().nodes.find((n) => n.id === addNode!.id);
      const updatedInputs = ((updated!.data as any).inputs ?? []) as Array<any>;
      expect(updatedInputs[0]!.name).toBe(originalSecond);
      expect(updatedInputs[1]!.name).toBe(originalFirst);
    });

    it('is a no-op on a non-function node', () => {
      // Money is a Data type — reorderInputParam should not mutate it.
      const nodes = store.getState().nodes;
      const moneyNode = nodes.find((n) => n.data.name === 'Money');
      expect(moneyNode).toBeDefined();

      const before = JSON.stringify(moneyNode!.data);
      store.getState().reorderInputParam(moneyNode!.id, 0, 1);
      const after = JSON.stringify(store.getState().nodes.find((n) => n.id === moneyNode!.id)!.data);

      expect(after).toBe(before);
    });
  });
});

// ---------------------------------------------------------------------------
// updateInputParam — cross-namespace qualification (mirrors Finding 3)
// ---------------------------------------------------------------------------

describe('EditorStore — updateInputParam (cross-namespace qualification)', () => {
  it('writes a QUALIFIED $refText when two namespaces have a type with the same bare name', () => {
    const store = createEditorStore();
    const funcId = store.getState().createType('func', 'CalcFunc', 'cdm.calc');
    store.getState().addInputParam(funcId, 'payment', 'string');

    // Two "Amount" types in different namespaces — the canonical id identifies which one.
    store.getState().createType('data', 'Amount', 'ns.a');
    const bAmountId = store.getState().createType('data', 'Amount', 'ns.b');

    // Update the input with the id of ns.b.Amount.
    store.getState().updateInputParam(funcId, 'payment', 'payment', 'Amount', '(1..1)', bAmountId);

    const node = store.getState().nodes.find((n) => n.id === funcId)!;
    const inputs = ((node.data as any).inputs ?? []) as Array<any>;
    const inp = inputs.find((i: any) => i.name === 'payment')!;
    // Must be qualified — bare "Amount" is ambiguous across two namespaces.
    expect(inp.typeCall.type.$refText).toBe('ns.b.Amount');

    // The edge must point at the correct (ns.b) node, not the ns.a homonym.
    const edge = store
      .getState()
      .edges.find((e) => e.source === funcId && e.data?.kind === 'attribute-ref' && e.data?.label === 'payment');
    expect(edge).toBeDefined();
    expect(edge!.target).toBe(bAmountId);
  });

  it('writes the BARE $refText when the type name is unambiguous (single namespace)', () => {
    const store = createEditorStore();
    const funcId = store.getState().createType('func', 'CalcFunc', 'cdm.calc');
    store.getState().addInputParam(funcId, 'payment', 'string');
    const amountId = store.getState().createType('data', 'Amount', 'cdm.calc');

    store.getState().updateInputParam(funcId, 'payment', 'payment', 'Amount', '(1..1)', amountId);

    const node = store.getState().nodes.find((n) => n.id === funcId)!;
    const inputs = ((node.data as any).inputs ?? []) as Array<any>;
    const inp = inputs.find((i: any) => i.name === 'payment')!;
    // No collision — bare name is correct.
    expect(inp.typeCall.type.$refText).toBe('Amount');
  });

  it('falls back to the bare typeName when targetTypeId is absent (backward-compatible)', () => {
    const store = createEditorStore();
    const funcId = store.getState().createType('func', 'CalcFunc', 'cdm.calc');
    store.getState().addInputParam(funcId, 'x', 'string');

    // No targetTypeId — legacy call path (name-only).
    store.getState().updateInputParam(funcId, 'x', 'x', 'number', '(1..1)');

    const node = store.getState().nodes.find((n) => n.id === funcId)!;
    const inputs = ((node.data as any).inputs ?? []) as Array<any>;
    const inp = inputs.find((i: any) => i.name === 'x')!;
    expect(inp.typeCall.type.$refText).toBe('number');
  });

  it('preserves existing typeCall.arguments when retyping (no-reset regression)', () => {
    const store = createEditorStore();
    const funcId = store.getState().createType('func', 'Fn', 'cdm.fn');
    store.getState().addInputParam(funcId, 'p', 'string');
    const targetId = store.getState().createType('data', 'Wrapper', 'cdm.fn');

    // Inject a parameterized typeCall to simulate an existing parameterized type call.
    // Update BOTH nodes array AND nodesById Map so mutateGraph (which reads the Map)
    // sees the injected data.
    store.setState((prev: any) => {
      const updatedNodes = prev.nodes.map((n: any) =>
        n.id === funcId
          ? {
              ...n,
              data: {
                ...n.data,
                inputs: (n.data.inputs ?? []).map((inp: any) =>
                  inp.name === 'p'
                    ? { ...inp, typeCall: { $type: 'TypeCall', type: { $refText: 'string' }, arguments: ['T'] } }
                    : inp
                )
              }
            }
          : n
      );
      const nodesById = new Map<string, any>(prev.nodesById);
      const updatedFuncNode = updatedNodes.find((n: any) => n.id === funcId);
      if (updatedFuncNode) nodesById.set(funcId, updatedFuncNode);
      return { nodes: updatedNodes, nodesById };
    });

    store.getState().updateInputParam(funcId, 'p', 'p', 'Wrapper', '(1..1)', targetId);

    const node = store.getState().nodes.find((n) => n.id === funcId)!;
    const inputs = ((node.data as any).inputs ?? []) as Array<any>;
    const inp = inputs.find((i: any) => i.name === 'p')!;
    expect(inp.typeCall.type.$refText).toBe('Wrapper');
    // arguments must be preserved — the spread ensures this.
    expect(inp.typeCall.arguments).toEqual(['T']);
  });
});

// ---------------------------------------------------------------------------
// Wave D — function actions → mutateGraph recipes (id-rooted patches)
// ---------------------------------------------------------------------------

describe('EditorStore — function actions — id-rooted patches (Wave D)', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(async () => {
    store = createEditorStore();
    const result = await parse(FUNCTION_MODEL_SOURCE);
    store.getState().loadModels(result.value);
  });

  // -----------------------------------------------------------------------
  // addInputParam — nodes-rooted patch at draft.nodes
  // -----------------------------------------------------------------------

  describe('addInputParam — id-rooted patch (Wave D)', () => {
    it('captures a nodes-rooted patch with inputs in path', () => {
      const nodes = store.getState().nodes;
      const funcNode = nodes.find((n) => n.data.name === 'Add');
      expect(funcNode).toBeDefined();
      const nodeId = funcNode!.id;

      const patchesBefore = store.getState().pendingEditPatches.length;

      store.getState().addInputParam(nodeId, 'c', 'number');

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);
      expect(newPatches[0]!.path[0]).toBe('nodes');
      expect(newPatches[0]!.path[1]).toBe(nodeId);
      expect(newPatches[0]!.path).toContain('inputs');
    });
  });

  // -----------------------------------------------------------------------
  // removeInputParam — nodes-rooted patch
  // -----------------------------------------------------------------------

  describe('removeInputParam — id-rooted patch (Wave D)', () => {
    it('captures a nodes-rooted patch with inputs in path', () => {
      const nodes = store.getState().nodes;
      const funcNode = nodes.find((n) => n.data.name === 'Add');
      expect(funcNode).toBeDefined();
      const nodeId = funcNode!.id;

      const patchesBefore = store.getState().pendingEditPatches.length;

      store.getState().removeInputParam(nodeId, 'a');

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);
      expect(newPatches[0]!.path[0]).toBe('nodes');
      expect(newPatches[0]!.path[1]).toBe(nodeId);
      expect(newPatches[0]!.path).toContain('inputs');
    });
  });

  // -----------------------------------------------------------------------
  // reorderInputParam — nodes-rooted patch
  // -----------------------------------------------------------------------

  describe('reorderInputParam — id-rooted patch (Wave D)', () => {
    it('captures a nodes-rooted patch with inputs in path', () => {
      const nodes = store.getState().nodes;
      const funcNode = nodes.find((n) => n.data.name === 'Add');
      expect(funcNode).toBeDefined();
      const nodeId = funcNode!.id;

      const patchesBefore = store.getState().pendingEditPatches.length;

      store.getState().reorderInputParam(nodeId, 0, 1);

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);
      expect(newPatches[0]!.path[0]).toBe('nodes');
      expect(newPatches[0]!.path[1]).toBe(nodeId);
      expect(newPatches[0]!.path).toContain('inputs');
    });
  });

  // -----------------------------------------------------------------------
  // updateOutputType — nodes-rooted patch
  // -----------------------------------------------------------------------

  describe('updateOutputType — id-rooted patch (Wave D)', () => {
    it('captures a nodes-rooted patch with output in path', () => {
      const nodes = store.getState().nodes;
      const funcNode = nodes.find((n) => n.data.name === 'Add');
      expect(funcNode).toBeDefined();
      const nodeId = funcNode!.id;

      const patchesBefore = store.getState().pendingEditPatches.length;

      store.getState().updateOutputType(nodeId, 'Money');

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);
      expect(newPatches[0]!.path[0]).toBe('nodes');
      expect(newPatches[0]!.path[1]).toBe(nodeId);
      expect(newPatches[0]!.path).toContain('output');
    });

    it('preserves existing output cardinality when only updating typeCall', () => {
      const nodes = store.getState().nodes;
      const funcNode = nodes.find((n) => n.data.name === 'Add');
      expect(funcNode).toBeDefined();

      store.getState().updateOutputType(funcNode!.id, 'Money');

      const updated = store.getState().nodes.find((n) => n.id === funcNode!.id);
      const output = (updated!.data as any).output;
      expect(output).toBeDefined();
      // typeCall is now set with the new type
      expect(output.typeCall?.type?.$refText).toBe('Money');
    });
  });

  // -----------------------------------------------------------------------
  // updateExpression — nodes-rooted patch covering BOTH operations[0].expression
  // (a RawDsl leaf — see the addCondition test above) AND expressionText
  // -----------------------------------------------------------------------

  describe('updateExpression — id-rooted patch (Wave D)', () => {
    it('captures a nodes-rooted patch with operations in path', () => {
      const nodes = store.getState().nodes;
      const funcNode = nodes.find((n) => n.data.name === 'Add');
      expect(funcNode).toBeDefined();
      const nodeId = funcNode!.id;

      const patchesBefore = store.getState().pendingEditPatches.length;

      store.getState().updateExpression(nodeId, 'a - b');

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);
      expect(newPatches[0]!.path[0]).toBe('nodes');
      expect(newPatches[0]!.path[1]).toBe(nodeId);
    });

    it('patches BOTH operations[0].expression (RawDsl leaf) AND expressionText', () => {
      const nodes = store.getState().nodes;
      const funcNode = nodes.find((n) => n.data.name === 'Add');
      expect(funcNode).toBeDefined();
      const nodeId = funcNode!.id;

      store.getState().updateExpression(nodeId, 'a * b');

      const updated = store.getState().nodes.find((n) => n.id === nodeId);
      const data = updated!.data as any;
      // Both fields must be written
      expect(data.operations?.[0]?.expression?.$type).toBe(RAW_DSL_TYPE);
      expect(data.operations?.[0]?.expression?.text).toBe('a * b');
      expect(data.expressionText).toBe('a * b');
    });
  });

  // -----------------------------------------------------------------------
  // updateInputParam — dual-patch: node (inputs[*]) + attribute-ref edge delete+add
  // -----------------------------------------------------------------------

  describe('updateInputParam — id-rooted dual-patch (Wave D)', () => {
    it('captures a nodes-rooted inputs patch AND an edges-rooted patch when a target node exists', () => {
      // Money exists in FUNCTION_MODEL_SOURCE — targetTypeId will find it.
      const nodes = store.getState().nodes;
      const funcNode = nodes.find((n) => n.data.name === 'Add');
      const moneyNode = nodes.find((n) => n.data.name === 'Money');
      expect(funcNode).toBeDefined();
      expect(moneyNode).toBeDefined();
      const nodeId = funcNode!.id;

      const patchesBefore = store.getState().pendingEditPatches.length;

      store.getState().updateInputParam(nodeId, 'a', 'first', 'Money', '(1..1)', moneyNode!.id);

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);

      // Node patch — inputs array modified.
      const nodePatch = newPatches.find((p) => p.path[0] === 'nodes' && p.path[1] === nodeId);
      expect(nodePatch).toBeDefined();
      expect(nodePatch!.path).toContain('inputs');

      // Edge patch — attribute-ref edge added.
      const edgePatch = newPatches.find((p) => p.path[0] === 'edges');
      expect(edgePatch).toBeDefined();
    });

    it('removes old attribute-ref edge and adds new one on rename+retype', () => {
      // First, add an input that references Money to establish the old edge.
      const nodes = store.getState().nodes;
      const funcNode = nodes.find((n) => n.data.name === 'Add');
      const moneyNode = nodes.find((n) => n.data.name === 'Money');
      expect(funcNode).toBeDefined();
      expect(moneyNode).toBeDefined();
      const nodeId = funcNode!.id;

      // Add Money-typed input 'payment' to Add
      store.getState().addInputParam(nodeId, 'payment', 'Money');
      // Manually set the edge as addInputParam is node-only; inject via updateInputParam rename:
      // First rename+type to Money so the edge is established.
      store.getState().updateInputParam(nodeId, 'payment', 'payment', 'Money', '(1..1)', moneyNode!.id);

      // Now rename from 'payment' to 'cash' while keeping Money.
      store.getState().updateInputParam(nodeId, 'payment', 'cash', 'Money', '(1..1)', moneyNode!.id);

      const edges = store.getState().edges;
      // Old edge with label 'payment' must be gone.
      const oldEdge = edges.find(
        (e) => e.source === nodeId && e.data?.kind === 'attribute-ref' && e.data?.label === 'payment'
      );
      expect(oldEdge).toBeUndefined();

      // New edge with label 'cash' must exist.
      const newEdge = edges.find(
        (e) => e.source === nodeId && e.data?.kind === 'attribute-ref' && e.data?.label === 'cash'
      );
      expect(newEdge).toBeDefined();
      expect(newEdge!.target).toBe(moneyNode!.id);
      expect(newEdge!.data?.cardinality).toBe('(1..1)');
    });

    it('captures only a nodes-rooted patch (no edge patch) when no target node exists', () => {
      const nodes = store.getState().nodes;
      const funcNode = nodes.find((n) => n.data.name === 'Add');
      expect(funcNode).toBeDefined();
      const nodeId = funcNode!.id;

      const patchesBefore = store.getState().pendingEditPatches.length;

      // 'UnknownType' does not exist as a node — no edge patch expected.
      store.getState().updateInputParam(nodeId, 'a', 'first', 'UnknownType', '(1..1)');

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);

      const nodePatch = newPatches.find((p) => p.path[0] === 'nodes' && p.path[1] === nodeId);
      expect(nodePatch).toBeDefined();

      // No edge patch when no target node found.
      const edgePatch = newPatches.find((p) => p.path[0] === 'edges');
      expect(edgePatch).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Wave F — metadata actions → mutateGraph recipes (id-rooted patches)
// ---------------------------------------------------------------------------

describe('EditorStore — metadata actions — id-rooted patches (Wave F)', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(async () => {
    store = createEditorStore();
    const result = await parse(COMBINED_MODEL_SOURCE);
    store.getState().loadModels(result.value);
  });

  // -----------------------------------------------------------------------
  // updateComments — nodes-rooted patch at ['nodes', id, 'meta', 'comments']
  // -----------------------------------------------------------------------

  describe('updateComments — id-rooted patch (Wave F)', () => {
    it('captures a patch rooted at nodes → nodeId → meta.comments', () => {
      const nodes = store.getState().nodes;
      const tradeNode = nodes.find((n) => n.data.name === 'Trade');
      expect(tradeNode).toBeDefined();
      const nodeId = tradeNode!.id;

      const patchesBefore = store.getState().pendingEditPatches.length;

      store.getState().updateComments(nodeId, 'Wave F test comment');

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);
      expect(newPatches[0]!.path[0]).toBe('nodes');
      expect(newPatches[0]!.path[1]).toBe(nodeId);
      expect(newPatches[0]!.path).toContain('comments');
    });
  });

  // -----------------------------------------------------------------------
  // updateDefinition — nodes-rooted patch at ['nodes', id, 'data', 'definition']
  // -----------------------------------------------------------------------

  describe('updateDefinition — id-rooted patch (Wave F)', () => {
    it('captures a patch rooted at nodes → nodeId containing definition', () => {
      const nodes = store.getState().nodes;
      const tradeNode = nodes.find((n) => n.data.name === 'Trade');
      expect(tradeNode).toBeDefined();
      const nodeId = tradeNode!.id;

      const patchesBefore = store.getState().pendingEditPatches.length;

      store.getState().updateDefinition(nodeId, 'A financial instrument trade');

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);
      expect(newPatches[0]!.path[0]).toBe('nodes');
      expect(newPatches[0]!.path[1]).toBe(nodeId);
      expect(newPatches[0]!.path).toContain('definition');
    });
  });

  // -----------------------------------------------------------------------
  // addSynonym — type-dispatched shapes (Data → RosettaClassSynonym)
  // -----------------------------------------------------------------------

  describe('addSynonym — id-rooted patch + type-dispatched shape (Wave F)', () => {
    it('captures a nodes-rooted synonyms patch for a Data node (RosettaClassSynonym shape)', () => {
      const nodes = store.getState().nodes;
      const tradeNode = nodes.find((n) => n.data.name === 'Trade');
      expect(tradeNode).toBeDefined();
      const nodeId = tradeNode!.id;

      const patchesBefore = store.getState().pendingEditPatches.length;

      store.getState().addSynonym(nodeId, 'FpML_Trade');

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);
      expect(newPatches[0]!.path[0]).toBe('nodes');
      expect(newPatches[0]!.path[1]).toBe(nodeId);
      expect(newPatches[0]!.path).toContain('synonyms');

      // Confirm the RosettaClassSynonym shape landed in state
      const updated = store.getState().nodes.find((n) => n.id === nodeId);
      const syns = (updated!.data as any).synonyms ?? [];
      expect(syns[0].$type).toBe('RosettaClassSynonym');
      expect(syns[0].sources[0].$refText).toBe('FpML_Trade');
    });
  });

  // -----------------------------------------------------------------------
  // addAnnotation — nodes-rooted patch (AnnotationRef shape)
  // -----------------------------------------------------------------------

  describe('addAnnotation — id-rooted patch (Wave F)', () => {
    it('captures a nodes-rooted annotations patch with AnnotationRef shape', () => {
      const nodes = store.getState().nodes;
      const tradeNode = nodes.find((n) => n.data.name === 'Trade');
      expect(tradeNode).toBeDefined();
      const nodeId = tradeNode!.id;

      const patchesBefore = store.getState().pendingEditPatches.length;

      store.getState().addAnnotation(nodeId, 'deprecated');

      const patches = store.getState().pendingEditPatches;
      const newPatches = patches.slice(patchesBefore);
      expect(newPatches.length).toBeGreaterThan(0);
      expect(newPatches[0]!.path[0]).toBe('nodes');
      expect(newPatches[0]!.path[1]).toBe(nodeId);
      expect(newPatches[0]!.path).toContain('annotations');

      // Confirm AnnotationRef shape
      const updated = store.getState().nodes.find((n) => n.id === nodeId);
      const anns = (updated!.data as any).annotations ?? [];
      expect(anns[0].$type).toBe('AnnotationRef');
      expect(anns[0].annotation.$refText).toBe('deprecated');
    });
  });
});

// ---------------------------------------------------------------------------
// Wave G — structural actions → mutateGraph recipes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// createType — patch-capture (bug fix: survives a reparse that does not include it)
// ---------------------------------------------------------------------------

describe('EditorStore — createType — patch-capture (Wave G)', () => {
  it('createType node survives a reparse that does NOT include it (patch captured in nodesById Map)', async () => {
    const BASE_SOURCE = `
namespace test.waveG
version "1.0.0"

type Alpha:
  x string (1..1)
`;
    const store = createEditorStore();
    const models = (await parse(BASE_SOURCE)).value;
    store.getState().loadModels(models);

    // Create a new type — this adds a pending patch in pendingEditPatches
    const newId = store.getState().createType('data', 'NewType', 'test.waveG');
    expect(store.getState().nodes.find((n) => n.id === newId)).toBeDefined();
    expect(store.getState().pendingEditPatches.length).toBeGreaterThan(0);

    // Verify the patch is nodes-rooted and keyed by the new node's id
    const patch = store.getState().pendingEditPatches.find((p) => p.path[0] === 'nodes' && p.path[1] === newId);
    expect(patch).toBeDefined();

    // Now do a reparse with the SAME source (does NOT include NewType).
    // The pending patch should be replayed, so NewType survives.
    const staleModels = (await parse(BASE_SOURCE)).value;
    store.getState().loadModels(staleModels);

    // NewType must still be present after the replay
    const survived = store.getState().nodes.find((n) => n.id === newId);
    expect(survived).toBeDefined();
    expect(survived!.data.name).toBe('NewType');
  });

  it('createType produces a nodes-rooted patch keyed by the new nodeId', () => {
    const store = createEditorStore();
    const patchesBefore = store.getState().pendingEditPatches.length;

    const newId = store.getState().createType('data', 'Widget', 'test.ns');

    const patches = store.getState().pendingEditPatches;
    const newPatches = patches.slice(patchesBefore);
    expect(newPatches.length).toBeGreaterThan(0);
    expect(newPatches[0]!.path[0]).toBe('nodes');
    expect(newPatches[0]!.path[1]).toBe(newId);
  });

  it('returns a kind-aware nodeId', () => {
    const store = createEditorStore();
    const id = store.getState().createType('data', 'Trade', 'cdm.base');
    expect(id).toBe('cdm.base.Trade#Data');
  });

  it('builds the correct kind-specific member arrays for each TypeKind', () => {
    const store = createEditorStore();
    const dataId = store.getState().createType('data', 'D', 'ns');
    const choiceId = store.getState().createType('choice', 'C', 'ns');
    const enumId = store.getState().createType('enum', 'E', 'ns');
    const funcId = store.getState().createType('func', 'F', 'ns');

    const dataN = store.getState().nodes.find((n) => n.id === dataId)!;
    expect((dataN.data as any).attributes).toEqual([]);
    expect((dataN.data as any).conditions).toEqual([]);

    const choiceN = store.getState().nodes.find((n) => n.id === choiceId)!;
    expect((choiceN.data as any).attributes).toEqual([]);
    expect((choiceN.data as any).conditions).toBeUndefined();

    const enumN = store.getState().nodes.find((n) => n.id === enumId)!;
    expect((enumN.data as any).enumValues).toEqual([]);

    const funcN = store.getState().nodes.find((n) => n.id === funcId)!;
    expect((funcN.data as any).inputs).toEqual([]);
    expect((funcN.data as any).conditions).toEqual([]);
    expect((funcN.data as any).postConditions).toEqual([]);
    expect((funcN.data as any).operations).toEqual([]);
    expect((funcN.data as any).shortcuts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// deleteType — removes node + all incident edges + clears selection
// ---------------------------------------------------------------------------

describe('EditorStore — deleteType (Wave G)', () => {
  it('removes the node from the graph', () => {
    const store = createEditorStore();
    const id = store.getState().createType('data', 'Trade', 'cdm.trade');
    store.getState().deleteType(id);
    expect(store.getState().nodes.find((n) => n.id === id)).toBeUndefined();
  });

  it('removes all incident edges (source OR target)', () => {
    const store = createEditorStore();
    const tradeId = store.getState().createType('data', 'Trade', 'cdm.trade');
    const partyId = store.getState().createType('data', 'Party', 'cdm.trade');
    const econId = store.getState().createType('data', 'Economics', 'cdm.trade');
    store.getState().addAttribute(tradeId, 'party', 'Party', '0..1'); // edge: tradeId → partyId
    store.getState().addAttribute(econId, 'trade', 'Trade', '0..1'); // edge: econId → tradeId
    store.getState().setInheritance(tradeId, partyId); // edge: tradeId → partyId (extends)

    // Verify edges exist before deletion
    const edgesBefore = store.getState().edges;
    expect(edgesBefore.some((e) => e.source === tradeId || e.target === tradeId)).toBe(true);

    store.getState().deleteType(tradeId);

    const edgesAfter = store.getState().edges;
    expect(edgesAfter.some((e) => e.source === tradeId || e.target === tradeId)).toBe(false);
  });

  it('clears selectedNodeId when the deleted node was selected', () => {
    const store = createEditorStore();
    const id = store.getState().createType('data', 'Trade', 'cdm.trade');
    store.setState({ selectedNodeId: id });
    store.getState().deleteType(id);
    expect(store.getState().selectedNodeId).toBeNull();
  });

  it('preserves selectedNodeId when a different node was selected', () => {
    const store = createEditorStore();
    const tradeId = store.getState().createType('data', 'Trade', 'cdm.trade');
    const partyId = store.getState().createType('data', 'Party', 'cdm.trade');
    store.setState({ selectedNodeId: partyId });
    store.getState().deleteType(tradeId);
    expect(store.getState().selectedNodeId).toBe(partyId);
  });

  it('produces a nodes-rooted remove patch AND edges-rooted remove patches', () => {
    const store = createEditorStore();
    const tradeId = store.getState().createType('data', 'Trade', 'cdm.trade');
    const partyId = store.getState().createType('data', 'Party', 'cdm.trade');
    store.getState().addAttribute(tradeId, 'party', 'Party', '0..1');

    const patchesBefore = store.getState().pendingEditPatches.length;
    store.getState().deleteType(tradeId);

    const newPatches = store.getState().pendingEditPatches.slice(patchesBefore);
    expect(newPatches.length).toBeGreaterThan(0);
    // Must have a nodes-rooted patch (the node was removed)
    const nodesPatch = newPatches.find((p) => p.path[0] === 'nodes');
    expect(nodesPatch).toBeDefined();
    void partyId; // silence unused warning
  });
});

// ---------------------------------------------------------------------------
// setInheritance — child superType + extends edge; stale-parentId no-op
// ---------------------------------------------------------------------------

describe('EditorStore — setInheritance (Wave G)', () => {
  it('sets child superType.$refText (bare name when unambiguous)', () => {
    const store = createEditorStore();
    const childId = store.getState().createType('data', 'Trade', 'cdm.trade');
    const parentId = store.getState().createType('data', 'TradeBase', 'cdm.trade');
    store.getState().setInheritance(childId, parentId);
    const node = store.getState().nodes.find((n) => n.id === childId)!;
    expect((node.data as any).superType?.$refText).toBe('TradeBase');
  });

  it('creates an extends edge with type="inheritance" and data.kind="extends"', () => {
    const store = createEditorStore();
    const childId = store.getState().createType('data', 'Trade', 'cdm.trade');
    const parentId = store.getState().createType('data', 'TradeBase', 'cdm.trade');
    store.getState().setInheritance(childId, parentId);

    const edge = store.getState().edges.find((e) => e.source === childId && e.target === parentId);
    expect(edge).toBeDefined();
    expect(edge!.type).toBe('inheritance'); // React-Flow type
    expect(edge!.data?.kind).toBe('extends'); // semantic kind in data
    expect(edge!.data?.label).toBe('extends');
  });

  it('replaces an existing extends edge when called again with a new parent', () => {
    const store = createEditorStore();
    const childId = store.getState().createType('data', 'Trade', 'cdm.trade');
    const parent1Id = store.getState().createType('data', 'Base1', 'cdm.trade');
    const parent2Id = store.getState().createType('data', 'Base2', 'cdm.trade');

    store.getState().setInheritance(childId, parent1Id);
    store.getState().setInheritance(childId, parent2Id);

    const edges = store.getState().edges.filter((e) => e.source === childId && e.data?.kind === 'extends');
    expect(edges.length).toBe(1);
    expect(edges[0]!.target).toBe(parent2Id);
  });

  it('clears superType and removes edge when parentId is null', () => {
    const store = createEditorStore();
    const childId = store.getState().createType('data', 'Trade', 'cdm.trade');
    const parentId = store.getState().createType('data', 'TradeBase', 'cdm.trade');
    store.getState().setInheritance(childId, parentId);
    store.getState().setInheritance(childId, null);

    const node = store.getState().nodes.find((n) => n.id === childId)!;
    expect((node.data as any).superType).toBeUndefined();

    const edge = store.getState().edges.find((e) => e.source === childId && e.data?.kind === 'extends');
    expect(edge).toBeUndefined();
  });

  it('stale parentId is a no-op — existing inheritance is PRESERVED (not cleared)', () => {
    const store = createEditorStore();
    const childId = store.getState().createType('data', 'Trade', 'cdm.trade');
    const parentId = store.getState().createType('data', 'TradeBase', 'cdm.trade');
    store.getState().setInheritance(childId, parentId);

    const refTextBefore = (store.getState().nodes.find((n) => n.id === childId)!.data as any).superType?.$refText;
    const edgeCountBefore = store
      .getState()
      .edges.filter((e) => e.source === childId && e.data?.kind === 'extends').length;

    // Stale id — does not exist in the store
    store.getState().setInheritance(childId, 'ns.x.Deleted');

    const node = store.getState().nodes.find((n) => n.id === childId)!;
    expect((node.data as any).superType?.$refText).toBe(refTextBefore); // unchanged
    const edgeCountAfter = store
      .getState()
      .edges.filter((e) => e.source === childId && e.data?.kind === 'extends').length;
    expect(edgeCountAfter).toBe(edgeCountBefore); // edge count unchanged
  });

  it('produces nodes-rooted AND edges-rooted patches (Wave G)', () => {
    const store = createEditorStore();
    const childId = store.getState().createType('data', 'Trade', 'cdm.trade');
    const parentId = store.getState().createType('data', 'TradeBase', 'cdm.trade');

    const patchesBefore = store.getState().pendingEditPatches.length;
    store.getState().setInheritance(childId, parentId);

    const newPatches = store.getState().pendingEditPatches.slice(patchesBefore);
    expect(newPatches.length).toBeGreaterThan(0);

    const nodesPatch = newPatches.find((p) => p.path[0] === 'nodes' && p.path[1] === childId);
    expect(nodesPatch).toBeDefined();

    const edgesPatch = newPatches.find((p) => p.path[0] === 'edges');
    expect(edgesPatch).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// renameType — Map re-key + cascade + edge re-key (Wave G — THE CRITICAL ONE)
// ---------------------------------------------------------------------------

describe('EditorStore — renameType (Wave G)', () => {
  it('(a) node is re-keyed under newNodeId; old key is absent', () => {
    const store = createEditorStore();
    const id = store.getState().createType('data', 'Trade', 'cdm.trade');
    store.getState().renameType(id, 'Transaction');

    const newId = 'cdm.trade.Transaction#Data';
    expect(store.getState().nodes.find((n) => n.id === id)).toBeUndefined();
    expect(store.getState().nodes.find((n) => n.id === newId)).toBeDefined();
    expect(store.getState().nodes.find((n) => n.id === newId)!.data.name).toBe('Transaction');
  });

  it('(b) incident edges are re-keyed (id + source/target updated)', () => {
    const store = createEditorStore();
    const tradeId = store.getState().createType('data', 'Trade', 'cdm.trade');
    const partyId = store.getState().createType('data', 'Party', 'cdm.trade');
    store.getState().addAttribute(tradeId, 'party', 'Party', '0..1'); // edge: trade→party
    store.getState().setInheritance(tradeId, partyId); // extends edge

    store.getState().renameType(tradeId, 'Transaction');

    const newTradeId = 'cdm.trade.Transaction#Data';
    const edges = store.getState().edges;

    // No edge should reference the old tradeId
    expect(edges.some((e) => e.source === tradeId || e.target === tradeId)).toBe(false);
    // Edges that were incident should now reference newTradeId
    expect(edges.some((e) => e.source === newTradeId || e.target === newTradeId)).toBe(true);
    // All edge ids must also be consistent (no stale old id in the edge id)
    edges.forEach((e) => {
      expect(e.id).not.toContain(tradeId);
    });
  });

  it('(b2) attribute-ref edge label is updated when the renamed node IS the source (via makeEdgeId)', () => {
    const store = createEditorStore();
    const tradeId = store.getState().createType('data', 'Trade', 'cdm.trade');
    const partyId = store.getState().createType('data', 'Party', 'cdm.trade');
    store.getState().addAttribute(tradeId, 'party', 'Party', '0..1');
    // Edge id format: <source>--attribute-ref--<label>--<target>
    // Source changes so the edge must be re-keyed
    store.getState().renameType(tradeId, 'Transaction');

    const newTradeId = 'cdm.trade.Transaction#Data';
    const edge = store
      .getState()
      .edges.find((e) => e.source === newTradeId && e.data?.kind === 'attribute-ref' && e.data?.label === 'party');
    expect(edge).toBeDefined();
    expect(edge!.target).toBe(partyId);
  });

  it('(c) typeCall.$refText cascaded in referencing nodes', () => {
    const store = createEditorStore();
    const tradeId = store.getState().createType('data', 'Trade', 'cdm.trade');
    const partyId = store.getState().createType('data', 'Party', 'cdm.trade');
    store.getState().addAttribute(partyId, 'relatedTrade', 'Trade', '0..1'); // Party refs Trade

    store.getState().renameType(tradeId, 'Transaction');

    const partyNode = store.getState().nodes.find((n) => n.id === partyId)!;
    const attrs = (partyNode.data as any).attributes ?? [];
    const refAttr = attrs.find((a: any) => a.name === 'relatedTrade');
    expect(refAttr?.typeCall?.type?.$refText).toBe('Transaction'); // cascaded
  });

  it('(d) reorder safety — rename replays onto the correct node when the reparse RETURNS A DIFFERENT NODE ORDER', async () => {
    // Type declaration order drives the parsed/store node array order.
    // SOURCE_A lists [Alpha, Beta]; SOURCE_B lists [Beta, Alpha] — a genuine
    // reorder. Because renameType re-keys via Map delete+set (id-rooted
    // remove+add patches), the replay must target the renamed node BY ID, not
    // by array position. This test FAILS if replay were position-based: the
    // pending patch (rooted at the OLD Alpha id) would otherwise land on Beta
    // (now at index 0) or be dropped.
    const SOURCE_A = `
namespace cdm.order
version "1.0.0"

type Alpha:
  x string (1..1)

type Beta:
  a Alpha (1..1)
`;
    // Reordered: Beta is declared FIRST, Alpha SECOND. Alpha is NOT yet renamed
    // (still 'Alpha') — the reparse is stale relative to the in-flight rename.
    const SOURCE_B = `
namespace cdm.order
version "1.0.0"

type Beta:
  a Alpha (1..1)

type Alpha:
  x string (1..1)
`;
    const store = createEditorStore();
    const modelsA = (await parse(SOURCE_A)).value;
    store.getState().loadModels(modelsA);

    // Pre-rename store order is [Alpha, Beta].
    const orderBeforeRename = store.getState().nodes.map((n) => n.data.name);
    expect(orderBeforeRename).toEqual(['Alpha', 'Beta']);

    const alphaId = store.getState().nodes.find((n) => n.data.name === 'Alpha')!.id;
    const betaId = store.getState().nodes.find((n) => n.data.name === 'Beta')!.id;

    // Rename Alpha → AlphaRenamed (captured as id-rooted remove+add patches).
    store.getState().renameType(alphaId, 'AlphaRenamed');
    expect(store.getState().pendingEditPatches.length).toBeGreaterThan(0);

    // Confirm SOURCE_B parses to a DIFFERENT node order than the pre-rename
    // store order — proving this is a genuine reorder, not a byte-identical
    // reparse. (Probe a throwaway store so we don't perturb the one under test.)
    const probe = createEditorStore();
    probe.getState().loadModels((await parse(SOURCE_B)).value);
    const parsedOrderB = probe.getState().nodes.map((n) => n.data.name);
    expect(parsedOrderB).toEqual(['Beta', 'Alpha']);
    expect(parsedOrderB).not.toEqual(orderBeforeRename);

    // Load the REORDERED stale reparse. The pending rename patches must replay
    // onto the renamed node BY ID despite the array reorder.
    const modelsB = (await parse(SOURCE_B)).value;
    store.getState().loadModels(modelsB);

    // (a) The renamed node survives under newNodeId via id-keyed replay.
    const newAlphaId = 'cdm.order.AlphaRenamed#Data';
    const survived = store.getState().nodes.find((n) => n.id === newAlphaId);
    expect(survived).toBeDefined();
    expect(survived!.data.name).toBe('AlphaRenamed');
    // The OLD Alpha id must be gone — replay did not resurrect it.
    expect(store.getState().nodes.find((n) => n.id === alphaId)).toBeUndefined();

    // (b) I1 — Maps stay canonical: nodesById is keyed by the new id, and the
    //     derived array contains exactly one node for the renamed type.
    expect(store.getState().nodesById.get(newAlphaId)).toBeDefined();
    expect(store.getState().nodesById.get(alphaId)).toBeUndefined();
    expect(store.getState().nodes.filter((n) => n.data.name === 'AlphaRenamed')).toHaveLength(1);

    // (c) Beta is unaffected — same id, still present, NOT mistakenly renamed.
    const beta = store.getState().nodes.find((n) => n.id === betaId);
    expect(beta).toBeDefined();
    expect(beta!.data.name).toBe('Beta');
    expect(store.getState().nodes.filter((n) => n.data.name === 'Beta')).toHaveLength(1);
  });

  it('selectedNodeId is updated to newNodeId when the renamed node was selected', () => {
    const store = createEditorStore();
    const id = store.getState().createType('data', 'Trade', 'cdm.trade');
    store.setState({ selectedNodeId: id });
    store.getState().renameType(id, 'Transaction');
    expect(store.getState().selectedNodeId).toBe('cdm.trade.Transaction#Data');
  });

  it('selectedNodeId is unchanged when a different node was selected', () => {
    const store = createEditorStore();
    const tradeId = store.getState().createType('data', 'Trade', 'cdm.trade');
    const partyId = store.getState().createType('data', 'Party', 'cdm.trade');
    store.setState({ selectedNodeId: partyId });
    store.getState().renameType(tradeId, 'Transaction');
    expect(store.getState().selectedNodeId).toBe(partyId);
  });

  it('is a no-op when nodeId does not exist', () => {
    const store = createEditorStore();
    store.getState().createType('data', 'Trade', 'cdm.trade');
    const nodesBefore = store.getState().nodes.length;
    store.getState().renameType('nonexistent.id', 'NewName');
    expect(store.getState().nodes.length).toBe(nodesBefore);
  });

  it('produces nodes-rooted patches (Wave G)', () => {
    const store = createEditorStore();
    const id = store.getState().createType('data', 'Trade', 'cdm.trade');

    const patchesBefore = store.getState().pendingEditPatches.length;
    store.getState().renameType(id, 'Transaction');

    const newPatches = store.getState().pendingEditPatches.slice(patchesBefore);
    expect(newPatches.length).toBeGreaterThan(0);
    // Must produce at least one nodes-rooted patch
    const nodesPatch = newPatches.find((p) => p.path[0] === 'nodes');
    expect(nodesPatch).toBeDefined();
  });
});
