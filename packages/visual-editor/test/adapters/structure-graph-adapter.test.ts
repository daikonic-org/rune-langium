// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { findByCanonicalId, findAllByCanonicalId } from '../helpers/structure-lookup.js';
import { describe, it, expect } from 'vitest';
import { buildStructureGraph } from '../../src/adapters/structure-graph-adapter.js';
import {
  type StructureBaseContainer,
  type StructureChoiceNode,
  type StructureDataNode,
  type StructureEnumNode,
  type StructureFunctionNode,
  type StructureExpansionKey,
  expansionKey
} from '../../src/types/structure-view.js';

// Minimal in-memory document representation; real adapter accepts the
// visual-editor's GraphSnapshot or LangiumDocument (see implementation).
const fixtureSimple = {
  namespaces: [{ uri: 'cdm.trade' }],
  nodes: [
    {
      id: 'cdm.trade.Trade',
      $type: 'Data' as const,
      name: 'Trade',
      namespace: 'cdm.trade',
      extends: undefined,
      attributes: [
        { name: 'tradeDate', typeCall: { type: { $refText: 'date' } }, card: { inf: 0, sup: 1, unbounded: false } },
        { name: 'tradeID', typeCall: { type: { $refText: 'string' } }, card: { inf: 0, sup: 1, unbounded: false } }
      ]
    }
  ]
};

describe('buildStructureGraph — standalone Data type', () => {
  it('produces a single root node with rows for each attribute', () => {
    const result = buildStructureGraph(fixtureSimple, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap: new Map()
    });

    expect(result.rootNodeId).toBe('cdm.trade.Trade');
    expect(result.nodes.size).toBe(1);
    const root = result.nodes.get('cdm.trade.Trade') as StructureDataNode;
    expect(root.kind).toBe('data');
    expect(root.rows).toHaveLength(2);
    expect(root.rows[0]!.attrName).toBe('tradeDate');
    expect(root.rows[0]!.typeName).toBe('date');
    expect(root.rows[0]!.typeKind).toBe('BasicType');
    expect(root.rows[0]!.isOptional).toBe(true);
    expect(root.rows[0]!.cardinality).toBe('0..1');
  });

  it('returns empty graph when focusedTypeId is unknown', () => {
    const result = buildStructureGraph(fixtureSimple, {
      focusedTypeId: 'cdm.trade.Missing',
      expansionMap: new Map()
    });

    expect(result.nodes.size).toBe(0);
  });

  it('forwards AdapterNode.deferred onto the built StructureDataNode', () => {
    const deferredFixture = {
      namespaces: [{ uri: 'cdm.trade' }],
      nodes: [
        {
          id: 'cdm.trade.Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'cdm.trade',
          deferred: true
        }
      ]
    };
    const result = buildStructureGraph(deferredFixture, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap: new Map()
    });
    const root = result.nodes.get('cdm.trade.Trade') as StructureDataNode;
    expect(root.deferred).toBe(true);
  });

  it('omits deferred (undefined) for a normally-hydrated node', () => {
    const result = buildStructureGraph(fixtureSimple, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap: new Map()
    });
    const root = result.nodes.get('cdm.trade.Trade') as StructureDataNode;
    expect(root.deferred).toBeUndefined();
  });
});

const fixtureExtends = {
  namespaces: [{ uri: 'cdm.trade' }],
  nodes: [
    {
      id: 'cdm.trade.TradeBase',
      $type: 'Data' as const,
      name: 'TradeBase',
      namespace: 'cdm.trade',
      attributes: [
        { name: 'tradeID', typeCall: { type: { $refText: 'string' } }, card: { inf: 0, sup: 1, unbounded: false } },
        { name: 'parties', typeCall: { type: { $refText: 'Party' } }, card: { inf: 2, sup: 2, unbounded: false } }
      ]
    },
    {
      id: 'cdm.trade.Trade',
      $type: 'Data' as const,
      name: 'Trade',
      namespace: 'cdm.trade',
      extends: 'TradeBase',
      attributes: [
        { name: 'tradeDate', typeCall: { type: { $refText: 'date' } }, card: { inf: 0, sup: 1, unbounded: false } }
      ]
    }
  ]
};

describe('buildStructureGraph — inheritance', () => {
  it('produces a base-type container wrapping the derived Data', () => {
    const result = buildStructureGraph(fixtureExtends, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap: new Map()
    });

    // Root is the base container, NOT the Data node directly
    const rootNode = result.nodes.get(result.rootNodeId);
    expect(rootNode?.kind).toBe('base');
    const base = rootNode as StructureBaseContainer;
    expect(base.baseTypeName).toBe('TradeBase');
    expect(base.baseRows.map((r) => r.attrName)).toEqual(['tradeID', 'parties']);
    expect(base.baseRows.every((r) => r.isInherited)).toBe(true);

    // Phase 14e: per-instance materialization. `childNodeId` now carries the
    // child's INSTANCE id (a derivation of the parent). The derived Data node
    // is found via its canonical id with the helper.
    const derived = findByCanonicalId(result.nodes, 'cdm.trade.Trade') as StructureDataNode;
    expect(derived?.kind).toBe('data');
    expect(base.childNodeId).toBe(derived.instanceId);
    expect(derived.rows.map((r) => r.attrName)).toEqual(['tradeDate']); // ONLY new additions
  });

  it('walks the full chain: Trade extends TradeBase extends TradeRoot nests yellow inside yellow', () => {
    // Spec §3.2: "Multi-level inheritance nests yellow inside yellow recursively."
    // The outermost base container (TradeRoot's) is rootNodeId; TradeBase's
    // container nests inside it; the focused Data node is innermost. Each
    // base container's baseRows hold only that level's own attributes
    // (marked isInherited), and the focused Data node holds only its own
    // additions — no row duplication across levels.
    const fixtureDeep = {
      namespaces: [{ uri: 'cdm.trade' }],
      nodes: [
        {
          id: 'cdm.trade.TradeRoot',
          $type: 'Data' as const,
          name: 'TradeRoot',
          namespace: 'cdm.trade',
          attributes: [
            {
              name: 'rootField',
              typeCall: { type: { $refText: 'string' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        },
        {
          id: 'cdm.trade.TradeBase',
          $type: 'Data' as const,
          name: 'TradeBase',
          namespace: 'cdm.trade',
          extends: 'TradeRoot',
          attributes: [
            {
              name: 'baseField',
              typeCall: { type: { $refText: 'string' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        },
        {
          id: 'cdm.trade.Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'cdm.trade',
          extends: 'TradeBase',
          attributes: [
            {
              name: 'tradeField',
              typeCall: { type: { $refText: 'string' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };

    const result = buildStructureGraph(fixtureDeep, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap: new Map()
    });

    // Three nodes: 2 base containers + 1 data node.
    expect(result.nodes.size).toBe(3);

    const outerCanonicalId = `cdm.trade.Trade::__base::cdm.trade.TradeRoot`;
    const innerCanonicalId = `cdm.trade.Trade::__base::cdm.trade.TradeBase`;

    // Phase 14e: rootNodeId is the outermost wrapper's INSTANCE id; for a
    // root placement the instance id equals the canonical id (no parent prefix).
    expect(result.rootNodeId).toBe(outerCanonicalId);

    const outer = findByCanonicalId(result.nodes, outerCanonicalId) as StructureBaseContainer;
    expect(outer.kind).toBe('base');
    expect(outer.baseTypeName).toBe('TradeRoot');
    expect(outer.baseRows.map((r) => r.attrName)).toEqual(['rootField']);
    expect(outer.baseRows.every((r) => r.isInherited)).toBe(true);

    const inner = findByCanonicalId(result.nodes, innerCanonicalId) as StructureBaseContainer;
    expect(inner.kind).toBe('base');
    expect(inner.baseTypeName).toBe('TradeBase');
    expect(inner.baseRows.map((r) => r.attrName)).toEqual(['baseField']);
    expect(inner.baseRows.every((r) => r.isInherited)).toBe(true);
    // Child links are per-instance ids; verify by lineage rather than literal.
    expect(outer.childNodeId).toBe(inner.instanceId);

    const derived = findByCanonicalId(result.nodes, 'cdm.trade.Trade') as StructureDataNode;
    expect(derived.kind).toBe('data');
    expect(inner.childNodeId).toBe(derived.instanceId);
    expect(derived.rows.map((r) => r.attrName)).toEqual(['tradeField']);
    expect(derived.rows.some((r) => r.attrName === 'rootField')).toBe(false);
    expect(derived.rows.some((r) => r.attrName === 'baseField')).toBe(false);
  });

  it('terminates on cyclic extends (A extends B extends A) without infinite recursion', () => {
    // Defensive: well-formed CDM cannot express this, but the chain walker
    // must not loop. A visited-set guard breaks the walk when an ancestor id
    // repeats; the resulting graph shape is "sensible" — finite, with the
    // valid ancestor(s) wrapping the focused Data node — but the exact shape
    // is incidental. The contract is "terminates and doesn't crash."
    const fixtureCyclicExtends = {
      namespaces: [{ uri: 'cdm.cycle' }],
      nodes: [
        {
          id: 'cdm.cycle.A',
          $type: 'Data' as const,
          name: 'A',
          namespace: 'cdm.cycle',
          extends: 'B',
          attributes: [
            { name: 'a', typeCall: { type: { $refText: 'string' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'cdm.cycle.B',
          $type: 'Data' as const,
          name: 'B',
          namespace: 'cdm.cycle',
          extends: 'A',
          attributes: [
            { name: 'b', typeCall: { type: { $refText: 'string' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        }
      ]
    };

    // The call must return — vitest will mark this test failing on timeout
    // if the walker loops.
    const result = buildStructureGraph(fixtureCyclicExtends, {
      focusedTypeId: 'cdm.cycle.A',
      expansionMap: new Map()
    });

    // Graph is finite. Focused A is present.
    const a = findByCanonicalId(result.nodes, 'cdm.cycle.A') as StructureDataNode;
    expect(a).toBeDefined();
    expect(a.kind).toBe('data');
    // The walker stops before re-entering A: B is allowed once (the direct
    // base), then B.extends → A is rejected by the visited guard. So we
    // expect exactly one base container wrapping A.
    expect(result.nodes.size).toBe(2);
    const baseCanonicalId = `cdm.cycle.A::__base::cdm.cycle.B`;
    expect(result.rootNodeId).toBe(baseCanonicalId);
    const base = findByCanonicalId(result.nodes, baseCanonicalId) as StructureBaseContainer;
    expect(base.kind).toBe('base');
    expect(base.baseTypeName).toBe('B');
    expect(base.childNodeId).toBe(a.instanceId);
  });
});

const fixtureRef = {
  namespaces: [{ uri: 'cdm.trade' }],
  nodes: [
    {
      id: 'cdm.trade.Economics',
      $type: 'Data' as const,
      name: 'Economics',
      namespace: 'cdm.trade',
      attributes: [
        { name: 'notional', typeCall: { type: { $refText: 'Money' } }, card: { inf: 1, sup: 1, unbounded: false } }
      ]
    },
    {
      id: 'cdm.trade.Trade',
      $type: 'Data' as const,
      name: 'Trade',
      namespace: 'cdm.trade',
      attributes: [
        {
          name: 'economics',
          typeCall: { type: { $refText: 'Economics' } },
          card: { inf: 0, unbounded: true }
        }
      ]
    }
  ]
};

describe('buildStructureGraph — type-reference expansion', () => {
  it('does NOT expand when the attribute is collapsed', () => {
    const result = buildStructureGraph(fixtureRef, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap: new Map()
    });
    expect(result.nodes.size).toBe(1);
    expect(result.nodes.has('cdm.trade.Economics')).toBe(false);
  });

  it('expands target type when the attribute is expanded', () => {
    // Per-instance key: Trade has no inheritance, so rootInstanceId = 'cdm.trade.Trade'.
    // Root-row instancePath = [rootInstanceId].
    const key: StructureExpansionKey = {
      namespaceUri: 'cdm.trade',
      typeId: 'Trade',
      attrName: 'economics',
      instancePath: ['cdm.trade.Trade']
    };
    const expansionMap = new Map([[expansionKey(key), true]]);

    const result = buildStructureGraph(fixtureRef, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap
    });

    // Phase 14e: lookup the expansion target by canonical id; the actual key
    // in `nodes` is the per-instance id assigned by the adapter.
    const economics = findByCanonicalId(result.nodes, 'cdm.trade.Economics') as StructureDataNode;
    expect(economics).toBeDefined();
    const trade = findByCanonicalId(result.nodes, 'cdm.trade.Trade') as StructureDataNode;
    expect(trade.expansions.get('economics')).toBe(economics.instanceId);
  });
});

const fixtureChoice = {
  namespaces: [{ uri: 'cdm.trade' }],
  nodes: [
    {
      id: 'cdm.trade.Payout',
      $type: 'Choice' as const,
      name: 'Payout',
      namespace: 'cdm.trade',
      // Real ChoiceOption shape: only typeCall, no name/card.
      choiceOptions: [{ typeCall: { type: { $refText: 'Cash' } } }]
    },
    {
      id: 'cdm.trade.Trade',
      $type: 'Data' as const,
      name: 'Trade',
      namespace: 'cdm.trade',
      attributes: [
        { name: 'payout', typeCall: { type: { $refText: 'Payout' } }, card: { inf: 1, sup: 1, unbounded: false } }
      ]
    }
  ]
};

const fixtureEnumAndUnresolved = {
  namespaces: [{ uri: 'cdm.trade' }],
  nodes: [
    {
      id: 'cdm.trade.DayCount',
      $type: 'Enum' as const,
      name: 'DayCount',
      namespace: 'cdm.trade',
      values: [{ name: 'ACT_360' }, { name: 'ACT_365' }]
    },
    {
      id: 'cdm.trade.Trade',
      $type: 'Data' as const,
      name: 'Trade',
      namespace: 'cdm.trade',
      attributes: [
        {
          name: 'dayCount',
          typeCall: { type: { $refText: 'DayCount' } },
          card: { inf: 1, sup: 1, unbounded: false }
        },
        {
          name: 'mystery',
          typeCall: { type: { $refText: 'MissingType' } },
          card: { inf: 0, sup: 1, unbounded: false }
        }
      ]
    }
  ]
};

describe('buildStructureGraph — Choice / Enum / Unresolved', () => {
  it('classifies a Choice-typed attr and expands to a choice node', () => {
    const key: StructureExpansionKey = {
      namespaceUri: 'cdm.trade',
      typeId: 'Trade',
      attrName: 'payout',
      instancePath: ['cdm.trade.Trade']
    };
    const result = buildStructureGraph(fixtureChoice, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap: new Map([[expansionKey(key), true]])
    });
    const choice = findByCanonicalId(result.nodes, 'cdm.trade.Payout');
    expect(choice?.kind).toBe('choice');
    const trade = findByCanonicalId(result.nodes, 'cdm.trade.Trade') as StructureDataNode;
    expect(trade.rows.find((r) => r.attrName === 'payout')?.typeKind).toBe('Choice');
  });

  it('classifies an Enum-typed attr and does NOT expand it (chip-only)', () => {
    const key: StructureExpansionKey = {
      namespaceUri: 'cdm.trade',
      typeId: 'Trade',
      attrName: 'dayCount'
    };
    const result = buildStructureGraph(fixtureEnumAndUnresolved, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap: new Map([[expansionKey(key), true]])
    });
    expect(result.nodes.has('cdm.trade.DayCount')).toBe(false);
    const trade = result.nodes.get('cdm.trade.Trade') as StructureDataNode;
    expect(trade.rows.find((r) => r.attrName === 'dayCount')?.typeKind).toBe('Enum');
  });

  it('marks unresolved references with kind=Unresolved', () => {
    const result = buildStructureGraph(fixtureEnumAndUnresolved, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap: new Map()
    });
    const trade = result.nodes.get('cdm.trade.Trade') as StructureDataNode;
    const row = trade.rows.find((r) => r.attrName === 'mystery')!;
    expect(row.typeKind).toBe('Unresolved');
    expect(row.targetNodeId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PR #182 round-2 Finding 1: real ChoiceOption shape (no name/card)
// ---------------------------------------------------------------------------

describe('buildStructureGraph — ChoiceOption real AST shape (no name/card)', () => {
  // The critical regression: ChoiceOption AST has only `typeCall`, not `name`
  // or `card`. The previous fix synthesized fake name/card so buildRow could
  // consume it; this test pins the architectural fix: the adapter must consume
  // AdapterChoiceOption directly via choiceOptions, never via attributes.

  it('does not throw when ChoiceOption arms have no name or card', () => {
    // The real ChoiceOption shape from the AST.
    const fixture = {
      namespaces: [{ uri: 'cdm.payment' }],
      nodes: [
        {
          id: 'cdm.payment.CashSettlement',
          $type: 'Data' as const,
          name: 'CashSettlement',
          namespace: 'cdm.payment',
          attributes: []
        },
        {
          id: 'cdm.payment.BankTransfer',
          $type: 'Data' as const,
          name: 'BankTransfer',
          namespace: 'cdm.payment',
          attributes: []
        },
        {
          id: 'cdm.payment.SettlementMethod',
          $type: 'Choice' as const,
          name: 'SettlementMethod',
          namespace: 'cdm.payment',
          // Real ChoiceOption shape: only typeCall — NO name, NO card.
          choiceOptions: [
            { typeCall: { type: { $refText: 'CashSettlement' } } },
            { typeCall: { type: { $refText: 'BankTransfer' } } }
          ]
        },
        {
          id: 'cdm.payment.Payment',
          $type: 'Data' as const,
          name: 'Payment',
          namespace: 'cdm.payment',
          attributes: [
            {
              name: 'method',
              typeCall: { type: { $refText: 'SettlementMethod' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };

    // Must not throw — previously crashed when buildRow dereferenced attr.card.inf
    // on undefined because ChoiceOption had no card field.
    const expansionKey_ = expansionKey({
      namespaceUri: 'cdm.payment',
      typeId: 'Payment',
      attrName: 'method',
      instancePath: ['cdm.payment.Payment']
    });
    expect(() =>
      buildStructureGraph(fixture, {
        focusedTypeId: 'cdm.payment.Payment',
        expansionMap: new Map([[expansionKey_, true]])
      })
    ).not.toThrow();
  });

  it('builds StructureChoiceArm entries with typeName from typeCall.$refText', () => {
    const fixture = {
      namespaces: [{ uri: 'cdm.payment' }],
      nodes: [
        {
          id: 'cdm.payment.CashSettlement',
          $type: 'Data' as const,
          name: 'CashSettlement',
          namespace: 'cdm.payment',
          attributes: []
        },
        {
          id: 'cdm.payment.BankTransfer',
          $type: 'Data' as const,
          name: 'BankTransfer',
          namespace: 'cdm.payment',
          attributes: []
        },
        {
          id: 'cdm.payment.SettlementMethod',
          $type: 'Choice' as const,
          name: 'SettlementMethod',
          namespace: 'cdm.payment',
          choiceOptions: [
            { typeCall: { type: { $refText: 'CashSettlement' } } },
            { typeCall: { type: { $refText: 'BankTransfer' } } }
          ]
        },
        {
          id: 'cdm.payment.Payment',
          $type: 'Data' as const,
          name: 'Payment',
          namespace: 'cdm.payment',
          attributes: [
            {
              name: 'method',
              typeCall: { type: { $refText: 'SettlementMethod' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };

    const expansionKey_ = expansionKey({
      namespaceUri: 'cdm.payment',
      typeId: 'Payment',
      attrName: 'method',
      instancePath: ['cdm.payment.Payment']
    });
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'cdm.payment.Payment',
      expansionMap: new Map([[expansionKey_, true]])
    });

    const choiceNode = findByCanonicalId(result.nodes, 'cdm.payment.SettlementMethod') as StructureChoiceNode;
    expect(choiceNode).toBeDefined();
    expect(choiceNode.kind).toBe('choice');
    expect(choiceNode.options).toHaveLength(2);

    // StructureChoiceArm: typeName from $refText, typeKind resolved by lookup.
    expect(choiceNode.options[0]!.typeName).toBe('CashSettlement');
    expect(choiceNode.options[0]!.typeKind).toBe('Data');
    expect(choiceNode.options[0]!.targetNodeId).toBe('cdm.payment.CashSettlement');

    expect(choiceNode.options[1]!.typeName).toBe('BankTransfer');
    expect(choiceNode.options[1]!.typeKind).toBe('Data');
    expect(choiceNode.options[1]!.targetNodeId).toBe('cdm.payment.BankTransfer');
  });

  it('marks an unresolvable arm as Unresolved (no targetNodeId)', () => {
    const fixture = {
      namespaces: [{ uri: 'cdm.payment' }],
      nodes: [
        {
          id: 'cdm.payment.SettlementMethod',
          $type: 'Choice' as const,
          name: 'SettlementMethod',
          namespace: 'cdm.payment',
          // Arm references a type that isn't in the document.
          choiceOptions: [{ typeCall: { type: { $refText: 'UnknownType' } } }]
        },
        {
          id: 'cdm.payment.Payment',
          $type: 'Data' as const,
          name: 'Payment',
          namespace: 'cdm.payment',
          attributes: [
            {
              name: 'method',
              typeCall: { type: { $refText: 'SettlementMethod' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };

    const expansionKey_ = expansionKey({
      namespaceUri: 'cdm.payment',
      typeId: 'Payment',
      attrName: 'method',
      instancePath: ['cdm.payment.Payment']
    });
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'cdm.payment.Payment',
      expansionMap: new Map([[expansionKey_, true]])
    });

    const choiceNode = findByCanonicalId(result.nodes, 'cdm.payment.SettlementMethod') as StructureChoiceNode;
    expect(choiceNode.options[0]!.typeName).toBe('UnknownType');
    expect(choiceNode.options[0]!.typeKind).toBe('Unresolved');
    expect(choiceNode.options[0]!.targetNodeId).toBeUndefined();
  });
});

describe('buildStructureGraph — BasicType classification', () => {
  // A typeRef that is neither in the canonical `BUILTIN_TYPES` list
  // (packages/visual-editor/src/types.ts) nor a resolvable node falls through
  // to the node-lookup path and resolves as Unresolved. `BUILTIN_TYPES` is the
  // adapter's single source of truth for chip-only types. (`pattern` used to be
  // the example here, but it's a real com.rosetta.model basic type and is now
  // in BUILTIN_TYPES — see the BasicType test below.)
  it('classifies an unknown type reference as Unresolved (not in BUILTIN_TYPES, no matching node)', () => {
    const fixture = {
      namespaces: [{ uri: 'cdm.misc' }],
      nodes: [
        {
          id: 'cdm.misc.Thing',
          $type: 'Data' as const,
          name: 'Thing',
          namespace: 'cdm.misc',
          attributes: [
            {
              name: 'mystery',
              typeCall: { type: { $refText: 'NotARealType' } },
              card: { inf: 0, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'cdm.misc.Thing',
      expansionMap: new Map()
    });
    const row = (result.nodes.get('cdm.misc.Thing') as StructureDataNode).rows[0]!;
    expect(row.typeName).toBe('NotARealType');
    expect(row.typeKind).toBe('Unresolved');
  });

  // `pattern` IS a com.rosetta.model basic type, now in the canonical
  // BUILTIN_TYPES list (#276) — so it classifies as a BasicType chip.
  it('classifies "pattern" as BasicType (member of canonical BUILTIN_TYPES)', () => {
    const fixture = {
      namespaces: [{ uri: 'cdm.misc' }],
      nodes: [
        {
          id: 'cdm.misc.Thing',
          $type: 'Data' as const,
          name: 'Thing',
          namespace: 'cdm.misc',
          attributes: [
            { name: 'regex', typeCall: { type: { $refText: 'pattern' } }, card: { inf: 0, sup: 1, unbounded: false } }
          ]
        }
      ]
    };
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'cdm.misc.Thing',
      expansionMap: new Map()
    });
    const row = (result.nodes.get('cdm.misc.Thing') as StructureDataNode).rows[0]!;
    expect(row.typeName).toBe('pattern');
    expect(row.typeKind).toBe('BasicType');
  });

  // `int` IS in `BUILTIN_TYPES` — pinning this because an earlier review-fix
  // pass incorrectly dropped `int` from the local set. Aligning with the
  // canonical UI list ensures the adapter stays consistent with the type
  // selectors and other consumers.
  it('classifies int as BasicType (member of canonical BUILTIN_TYPES)', () => {
    const fixture = {
      namespaces: [{ uri: 'cdm.misc' }],
      nodes: [
        {
          id: 'cdm.misc.Thing',
          $type: 'Data' as const,
          name: 'Thing',
          namespace: 'cdm.misc',
          attributes: [
            { name: 'count', typeCall: { type: { $refText: 'int' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        }
      ]
    };
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'cdm.misc.Thing',
      expansionMap: new Map()
    });
    const row = (result.nodes.get('cdm.misc.Thing') as StructureDataNode).rows[0]!;
    expect(row.typeName).toBe('int');
    expect(row.typeKind).toBe('BasicType');
  });

  // `date` is in BUILTIN_TYPES (grammar `recordType`). The adapter does not
  // distinguish basicType vs. recordType because the UI renders both the same
  // way (inline chip, no drill-down).
  it('classifies a recordType date as BasicType', () => {
    const fixture = {
      namespaces: [{ uri: 'cdm.misc' }],
      nodes: [
        {
          id: 'cdm.misc.Thing',
          $type: 'Data' as const,
          name: 'Thing',
          namespace: 'cdm.misc',
          attributes: [
            { name: 'when', typeCall: { type: { $refText: 'date' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        }
      ]
    };
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'cdm.misc.Thing',
      expansionMap: new Map()
    });
    const row = (result.nodes.get('cdm.misc.Thing') as StructureDataNode).rows[0]!;
    expect(row.typeName).toBe('date');
    expect(row.typeKind).toBe('BasicType');
  });
});

describe('buildStructureGraph — malformed typeCall', () => {
  // Silent-failure #5: `typeRefText` defaults to '' when the AST shape is off.
  // Pinning current behavior — '' is not in BASIC_TYPES and matches no node,
  // so the row classifies as Unresolved with an empty type name. Renderers
  // need to handle the empty-string chip without crashing.
  it('handles typeCall.type === undefined as Unresolved with empty typeName', () => {
    const fixture = {
      namespaces: [{ uri: 'x' }],
      nodes: [
        {
          id: 'x::Thing',
          $type: 'Data' as const,
          name: 'Thing',
          namespace: 'x',
          attributes: [{ name: 'broken', typeCall: { type: undefined }, card: { inf: 0, sup: 1, unbounded: false } }]
        }
      ]
    };
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'x::Thing',
      expansionMap: new Map()
    });
    const row = (result.nodes.get('x::Thing') as StructureDataNode).rows[0]!;
    expect(row.typeName).toBe('');
    expect(row.typeKind).toBe('Unresolved');
    expect(row.targetNodeId).toBeUndefined();
  });

  it('handles typeCall.type.$refText === undefined as Unresolved with empty typeName', () => {
    const fixture = {
      namespaces: [{ uri: 'x' }],
      nodes: [
        {
          id: 'x::Thing',
          $type: 'Data' as const,
          name: 'Thing',
          namespace: 'x',
          attributes: [
            {
              name: 'broken',
              typeCall: { type: { $refText: undefined } },
              card: { inf: 0, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'x::Thing',
      expansionMap: new Map()
    });
    const row = (result.nodes.get('x::Thing') as StructureDataNode).rows[0]!;
    expect(row.typeName).toBe('');
    expect(row.typeKind).toBe('Unresolved');
    expect(row.targetNodeId).toBeUndefined();
  });

  // Regression — surfaced by 2026-05-20 prod-smoke check.
  // A single keystroke in the source editor blanked the studio: during the
  // partial-parse window, an Attribute node arrived with `typeCall` entirely
  // undefined (not just `typeCall.type` undefined). `typeRefText` did
  // `attr.typeCall.type?.$refText` which crashed on `.type` reading from
  // undefined, killing the Structure View useMemo and bubbling to the
  // ErrorBoundary. Treat missing `typeCall` the same as the pre-existing
  // missing-`typeCall.type` case: render as Unresolved with empty typeName.
  it('handles typeCall === undefined (partial-parse) without throwing', () => {
    const fixture = {
      namespaces: [{ uri: 'x' }],
      nodes: [
        {
          id: 'x::Thing',
          $type: 'Data' as const,
          name: 'Thing',
          namespace: 'x',
          attributes: [
            // AdapterAttribute's `typeCall` is now optional (PR #219 follow-up
            // to a Copilot review — type widened to reflect partial-parse
            // tolerance), so this is a plain object literal, no cast needed.
            {
              name: 'midKeystroke',
              typeCall: undefined,
              card: { inf: 0, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };
    let result!: ReturnType<typeof buildStructureGraph>;
    expect(() => {
      result = buildStructureGraph(fixture, {
        focusedTypeId: 'x::Thing',
        expansionMap: new Map()
      });
    }).not.toThrow();
    const row = (result.nodes.get('x::Thing') as StructureDataNode).rows[0]!;
    expect(row.typeName).toBe('');
    expect(row.typeKind).toBe('Unresolved');
    expect(row.targetNodeId).toBeUndefined();
  });

  it('handles attr.card === undefined (partial-parse) without throwing', () => {
    const fixture = {
      namespaces: [{ uri: 'x' }],
      nodes: [
        {
          id: 'x::Thing',
          $type: 'Data' as const,
          name: 'Thing',
          namespace: 'x',
          attributes: [
            // AdapterAttribute's `card` is now optional (Copilot review,
            // PR #219) — no cast needed.
            {
              name: 'noCardYet',
              typeCall: { type: { $refText: 'string' } },
              card: undefined
            }
          ]
        }
      ]
    };
    let result!: ReturnType<typeof buildStructureGraph>;
    expect(() => {
      result = buildStructureGraph(fixture, {
        focusedTypeId: 'x::Thing',
        expansionMap: new Map()
      });
    }).not.toThrow();
    const row = (result.nodes.get('x::Thing') as StructureDataNode).rows[0]!;
    // Defaults to DSL `0..1` so the row still renders.
    expect(row.cardinality).toBe('0..1');
    expect(row.isOptional).toBe(true);
  });

  it('handles a null entry in attributes (partial-parse) without throwing', () => {
    const fixture = {
      namespaces: [{ uri: 'x' }],
      nodes: [
        {
          id: 'x::Thing',
          $type: 'Data' as const,
          name: 'Thing',
          namespace: 'x',
          attributes: [
            // AdapterNode.attributes is now `ReadonlyArray<AdapterAttribute |
            // null | undefined>` (Copilot review, PR #219) — null is a
            // first-class entry, no cast needed.
            null,
            { name: 'ok', typeCall: { type: { $refText: 'string' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        }
      ]
    };
    let result!: ReturnType<typeof buildStructureGraph>;
    expect(() => {
      result = buildStructureGraph(fixture, {
        focusedTypeId: 'x::Thing',
        expansionMap: new Map()
      });
    }).not.toThrow();
    const root = result.nodes.get('x::Thing') as StructureDataNode;
    // The null entry is filtered out; the well-formed row survives.
    expect(root.rows).toHaveLength(1);
    expect(root.rows[0]!.attrName).toBe('ok');
  });

  it('handles a Choice with an undefined arm typeCall (partial-parse) without throwing', () => {
    const fixture = {
      namespaces: [{ uri: 'x' }],
      nodes: [
        {
          id: 'x::Pick',
          $type: 'Choice' as const,
          name: 'Pick',
          namespace: 'x',
          choiceOptions: [
            // AdapterChoiceOption.typeCall is now optional (Copilot review,
            // PR #219) — no cast needed.
            { typeCall: undefined },
            { typeCall: { type: { $refText: 'string' } } }
          ]
        }
      ]
    };
    let result!: ReturnType<typeof buildStructureGraph>;
    expect(() => {
      result = buildStructureGraph(fixture, {
        focusedTypeId: 'x::Pick',
        expansionMap: new Map()
      });
    }).not.toThrow();
    const choice = result.nodes.get('x::Pick') as StructureChoiceNode;
    expect(choice.options).toHaveLength(2);
    // First arm: buildChoiceArm's empty-refText branch substitutes the
    // sentinel '<unresolved>' typeName.
    expect(choice.options[0]!.typeName).toBe('<unresolved>');
    expect(choice.options[0]!.typeKind).toBe('Unresolved');
    // Second arm classifies as Builtin (BUILTIN_TYPES includes 'string').
    expect(choice.options[1]!.typeName).toBe('string');
  });
});

describe('buildStructureGraph — cardinality formatting', () => {
  it('formats 0..* cardinality without a doubled max marker', () => {
    const trade = buildStructureGraph(fixtureRef, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap: new Map()
    }).nodes.get('cdm.trade.Trade') as StructureDataNode;
    const row = trade.rows.find((r) => r.attrName === 'economics')!;
    expect(row.cardinality).toBe('0..*');
  });
});

const fixtureCrossNs = {
  namespaces: [{ uri: 'cdm.trade' }, { uri: 'cdm.product' }],
  nodes: [
    {
      id: 'cdm.product.Party',
      $type: 'Data' as const,
      name: 'Party',
      namespace: 'cdm.product',
      attributes: [
        { name: 'id', typeCall: { type: { $refText: 'string' } }, card: { inf: 1, sup: 1, unbounded: false } }
      ]
    },
    {
      id: 'cdm.trade.Trade',
      $type: 'Data' as const,
      name: 'Trade',
      namespace: 'cdm.trade',
      attributes: [
        { name: 'party', typeCall: { type: { $refText: 'Party' } }, card: { inf: 1, sup: 1, unbounded: false } }
      ]
    }
  ]
};

describe('buildStructureGraph — cross-namespace references', () => {
  it('resolves a reference to a type in a different namespace and surfaces targetNamespaceUri', () => {
    const result = buildStructureGraph(fixtureCrossNs, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap: new Map()
    });
    const trade = result.nodes.get('cdm.trade.Trade') as StructureDataNode;
    const row = trade.rows.find((r) => r.attrName === 'party')!;
    expect(row.typeKind).toBe('Data');
    expect(row.targetNodeId).toBe('cdm.product.Party');
    expect(row.targetNamespaceUri).toBe('cdm.product');
  });

  it('disambiguates same-name types in different namespaces by qualified id', () => {
    const fixtureCollision = {
      namespaces: [{ uri: 'a' }, { uri: 'b' }],
      // Order matters: put the other-namespace Money FIRST so a naive
      // first-match resolver would return b::Money. The same-namespace
      // tiebreak should still prefer a::Money for the caller in 'a'.
      nodes: [
        { id: 'b::Money', $type: 'Data' as const, name: 'Money', namespace: 'b', attributes: [] },
        { id: 'a::Money', $type: 'Data' as const, name: 'Money', namespace: 'a', attributes: [] },
        {
          id: 'a::Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'a',
          attributes: [
            { name: 'amt', typeCall: { type: { $refText: 'Money' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        }
      ]
    };

    const result = buildStructureGraph(fixtureCollision, {
      focusedTypeId: 'a::Trade',
      expansionMap: new Map()
    });
    const row = (result.nodes.get('a::Trade') as StructureDataNode).rows[0]!;
    // Prefer the same-namespace match
    expect(row.targetNodeId).toBe('a::Money');
  });

  it('terminates on cyclic references (A → B → A) without infinite recursion', () => {
    const fixtureCycle = {
      namespaces: [{ uri: 'c' }],
      nodes: [
        {
          id: 'c::A',
          $type: 'Data' as const,
          name: 'A',
          namespace: 'c',
          attributes: [{ name: 'b', typeCall: { type: { $refText: 'B' } }, card: { inf: 1, sup: 1, unbounded: false } }]
        },
        {
          id: 'c::B',
          $type: 'Data' as const,
          name: 'B',
          namespace: 'c',
          attributes: [{ name: 'a', typeCall: { type: { $refText: 'A' } }, card: { inf: 1, sup: 1, unbounded: false } }]
        }
      ]
    };

    // Per-instance keys: A has no inheritance, rootInstanceId = 'c::A'.
    const aInstanceId = 'c::A';
    const bInstanceId = `${aInstanceId}::b::c::B`;
    const expansionMap = new Map<string, boolean>([
      [expansionKey({ namespaceUri: 'c', typeId: 'A', attrName: 'b', instancePath: [aInstanceId] }), true],
      [expansionKey({ namespaceUri: 'c', typeId: 'B', attrName: 'a', instancePath: [aInstanceId, bInstanceId] }), true]
    ]);

    const result = buildStructureGraph(fixtureCycle, {
      focusedTypeId: 'c::A',
      expansionMap
    });

    // Both canonical types materialize exactly once each (one A as root, one
    // B as A's expansion target); the cycle did not blow the stack.
    expect(result.nodes.size).toBe(2);
    const a = findByCanonicalId(result.nodes, 'c::A') as StructureDataNode;
    const b = findByCanonicalId(result.nodes, 'c::B') as StructureDataNode;
    // A → B is kept (B is not an ancestor of A in the recursion stack).
    expect(a.expansions.get('b')).toBe(b.instanceId);
    // B → A is dropped: A IS an ancestor of B in the recursion path, so the
    // containment edge would form a parent-cycle in Phase 3's React Flow
    // layout. The chip row remains; only the parent/child edge is suppressed.
    expect(b.expansions.size).toBe(0);
  });

  it('Phase 14e/A: materializes a Choice as the focused root with all arms visible', () => {
    const fixtureChoiceRoot = {
      namespaces: [{ uri: 'cdm.trade' }],
      nodes: [
        {
          id: 'cdm.trade.Payout',
          $type: 'Choice' as const,
          name: 'Payout',
          namespace: 'cdm.trade',
          // Real ChoiceOption shape: only typeCall, no name/card.
          choiceOptions: [{ typeCall: { type: { $refText: 'string' } } }]
        }
      ]
    };

    const result = buildStructureGraph(fixtureChoiceRoot, {
      focusedTypeId: 'cdm.trade.Payout',
      expansionMap: new Map()
    });

    // Phase 14e/A: Choice roots are now first-class — rootNodeId echoes the
    // focused id (also the root instance id) and the Choice node materializes
    // with its arm options.
    expect(result.rootNodeId).toBe('cdm.trade.Payout');
    expect(result.nodes.size).toBe(1);
    const root = result.nodes.get('cdm.trade.Payout') as StructureChoiceNode;
    expect(root.kind).toBe('choice');
    expect(root.options).toHaveLength(1);
    expect(root.options[0].typeName).toBe('string');
    // No arms expanded by default.
    expect(root.expansions.size).toBe(0);
  });

  it('resolves a fully-qualified reference like "cdm.product.Party"', () => {
    // Phase 9 source-drop path inserts qualified names for cross-namespace
    // refs (TypeCall.type and extends both use QualifiedName per
    // rune-dsl.langium). findNodeByName must split on the last dot and
    // match {name, namespace} together.
    const fixtureQualified = {
      namespaces: [{ uri: 'cdm.trade' }, { uri: 'cdm.product' }],
      nodes: [
        {
          id: 'cdm.product.Party',
          $type: 'Data' as const,
          name: 'Party',
          namespace: 'cdm.product',
          attributes: [
            { name: 'id', typeCall: { type: { $refText: 'string' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'cdm.trade.Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'cdm.trade',
          attributes: [
            {
              name: 'party',
              typeCall: { type: { $refText: 'cdm.product.Party' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };

    const result = buildStructureGraph(fixtureQualified, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap: new Map()
    });
    const trade = result.nodes.get('cdm.trade.Trade') as StructureDataNode;
    const row = trade.rows.find((r) => r.attrName === 'party')!;
    expect(row.typeKind).toBe('Data');
    expect(row.targetNodeId).toBe('cdm.product.Party');
    expect(row.targetNamespaceUri).toBe('cdm.product');
  });

  it('prefers exact qualified match over same-name unqualified collision', () => {
    // Two `Money` nodes in different namespaces. The caller is in `cdm.other`
    // — without qualification, same-namespace tiebreak would fail and the
    // first-listed (cdm.product.Money) would win. With the qualified ref
    // "cdm.trade.Money", we must resolve to cdm.trade.Money regardless of
    // caller namespace.
    const fixtureQualifiedCollision = {
      namespaces: [{ uri: 'cdm.product' }, { uri: 'cdm.trade' }, { uri: 'cdm.other' }],
      nodes: [
        { id: 'cdm.product.Money', $type: 'Data' as const, name: 'Money', namespace: 'cdm.product', attributes: [] },
        { id: 'cdm.trade.Money', $type: 'Data' as const, name: 'Money', namespace: 'cdm.trade', attributes: [] },
        {
          id: 'cdm.other.Holding',
          $type: 'Data' as const,
          name: 'Holding',
          namespace: 'cdm.other',
          attributes: [
            {
              name: 'amt',
              typeCall: { type: { $refText: 'cdm.trade.Money' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };

    const result = buildStructureGraph(fixtureQualifiedCollision, {
      focusedTypeId: 'cdm.other.Holding',
      expansionMap: new Map()
    });
    const row = (result.nodes.get('cdm.other.Holding') as StructureDataNode).rows[0]!;
    expect(row.typeKind).toBe('Data');
    expect(row.targetNodeId).toBe('cdm.trade.Money');
    expect(row.targetNamespaceUri).toBe('cdm.trade');
  });

  it('resolves a qualified `extends` reference (extends uses QualifiedName too)', () => {
    // rune-dsl.langium line 60: `extends superType=[Data:QualifiedName]`.
    // Same fix in findNodeByName must cover the inheritance path.
    const fixtureQualifiedExtends = {
      namespaces: [{ uri: 'cdm.base' }, { uri: 'cdm.trade' }],
      nodes: [
        {
          id: 'cdm.base.TradeBase',
          $type: 'Data' as const,
          name: 'TradeBase',
          namespace: 'cdm.base',
          attributes: [
            { name: 'tradeID', typeCall: { type: { $refText: 'string' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'cdm.trade.Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'cdm.trade',
          extends: 'cdm.base.TradeBase',
          attributes: [
            {
              name: 'tradeDate',
              typeCall: { type: { $refText: 'date' } },
              card: { inf: 0, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };

    const result = buildStructureGraph(fixtureQualifiedExtends, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap: new Map()
    });
    const base = result.nodes.get(result.rootNodeId) as StructureBaseContainer;
    expect(base.kind).toBe('base');
    expect(base.baseTypeName).toBe('TradeBase');
    expect(base.baseTypeNamespaceUri).toBe('cdm.base');
    expect(base.baseTypeId).toBe('cdm.base.TradeBase');
    expect(base.baseRows.map((r) => r.attrName)).toEqual(['tradeID']);
  });

  it('does NOT fall back to unqualified matching when a qualified namespace fails to resolve', () => {
    // Type names can't contain dots in the DSL, so a $refText with dots is
    // unambiguously qualified. If the namespace is wrong (typo, broken import,
    // dangling reference), the lookup must fail authoritatively — falling
    // through to unqualified matching would silently resolve a same-named
    // type in some other namespace, masking the error.
    const fixtureBrokenQualified = {
      namespaces: [{ uri: 'cdm.product' }, { uri: 'cdm.trade' }],
      nodes: [
        {
          id: 'cdm.product.Party',
          $type: 'Data' as const,
          name: 'Party',
          namespace: 'cdm.product',
          attributes: [
            { name: 'id', typeCall: { type: { $refText: 'string' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'cdm.trade.Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'cdm.trade',
          attributes: [
            // Typoed namespace: 'missing.ns.Party' instead of 'cdm.product.Party'.
            // Naive fallback to unqualified would find 'Party' in cdm.product.
            {
              name: 'party',
              typeCall: { type: { $refText: 'missing.ns.Party' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };

    const result = buildStructureGraph(fixtureBrokenQualified, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap: new Map()
    });
    const trade = result.nodes.get('cdm.trade.Trade') as StructureDataNode;
    const row = trade.rows.find((r) => r.attrName === 'party')!;
    expect(row.typeKind).toBe('Unresolved');
    expect(row.targetNodeId).toBeUndefined();
    expect(row.targetNamespaceUri).toBeUndefined();
  });

  it('mixed: same-namespace and cross-namespace refs resolve correctly from the same caller', () => {
    const fixtureMixed = {
      namespaces: [{ uri: 'a' }, { uri: 'b' }],
      nodes: [
        { id: 'a::Money', $type: 'Data' as const, name: 'Money', namespace: 'a', attributes: [] },
        { id: 'b::Money', $type: 'Data' as const, name: 'Money', namespace: 'b', attributes: [] },
        // Only one Party — lives in 'b'
        { id: 'b::Party', $type: 'Data' as const, name: 'Party', namespace: 'b', attributes: [] },
        {
          id: 'a::Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'a',
          attributes: [
            { name: 'amt', typeCall: { type: { $refText: 'Money' } }, card: { inf: 1, sup: 1, unbounded: false } },
            { name: 'party', typeCall: { type: { $refText: 'Party' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        }
      ]
    };

    const result = buildStructureGraph(fixtureMixed, {
      focusedTypeId: 'a::Trade',
      expansionMap: new Map()
    });
    const trade = result.nodes.get('a::Trade') as StructureDataNode;
    const amt = trade.rows.find((r) => r.attrName === 'amt')!;
    const party = trade.rows.find((r) => r.attrName === 'party')!;
    // Same-namespace tiebreak picks a::Money
    expect(amt.targetNodeId).toBe('a::Money');
    expect(amt.targetNamespaceUri).toBe('a');
    // No 'a' Party — cross-namespace fallback to b::Party
    expect(party.targetNodeId).toBe('b::Party');
    expect(party.targetNamespaceUri).toBe('b');
  });
});

describe('buildStructureGraph — expansion target with inheritance', () => {
  // Spec §3.2: containment is the single mechanism for both inheritance and
  // type-reference, and they must compose uniformly. An expanded Data target
  // therefore needs the same yellow base-container wrapping that the focused
  // root gets — the `materializeDataWithInheritance` helper is shared
  // between both call sites. Without it, expanded Trade would render bare
  // even though `Trade extends TradeBase`.

  it('wraps a single-level expanded target in its base container', () => {
    const fixture = {
      namespaces: [{ uri: 'cdm.trade' }],
      nodes: [
        {
          id: 'cdm.trade.TradeBase',
          $type: 'Data' as const,
          name: 'TradeBase',
          namespace: 'cdm.trade',
          attributes: [
            { name: 'tradeID', typeCall: { type: { $refText: 'string' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'cdm.trade.Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'cdm.trade',
          extends: 'TradeBase',
          attributes: [
            {
              name: 'tradeDate',
              typeCall: { type: { $refText: 'date' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        },
        {
          id: 'cdm.trade.Portfolio',
          $type: 'Data' as const,
          name: 'Portfolio',
          namespace: 'cdm.trade',
          attributes: [
            {
              name: 'trade',
              typeCall: { type: { $refText: 'Trade' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };

    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'cdm.trade.Portfolio',
      expansionMap: new Map([
        [
          expansionKey({
            namespaceUri: 'cdm.trade',
            typeId: 'Portfolio',
            attrName: 'trade',
            instancePath: ['cdm.trade.Portfolio']
          }),
          true
        ]
      ])
    });

    // Portfolio + Trade data node + TradeBase container = 3 nodes total.
    expect(result.nodes.size).toBe(3);
    expect(findByCanonicalId(result.nodes, 'cdm.trade.Portfolio')).toBeDefined();
    expect(findByCanonicalId(result.nodes, 'cdm.trade.Trade')).toBeDefined();

    const baseCanonicalId = `cdm.trade.Trade::__base::cdm.trade.TradeBase`;
    const base = findByCanonicalId(result.nodes, baseCanonicalId) as StructureBaseContainer;
    expect(base.kind).toBe('base');
    expect(base.baseTypeName).toBe('TradeBase');
    expect(base.baseRows.map((r) => r.attrName)).toEqual(['tradeID']);
    expect(base.baseRows.every((r) => r.isInherited)).toBe(true);

    const trade = findByCanonicalId(result.nodes, 'cdm.trade.Trade') as StructureDataNode;
    expect(trade.rows.map((r) => r.attrName)).toEqual(['tradeDate']);
    expect(base.childNodeId).toBe(trade.instanceId);

    // The expansion edge points at the OUTERMOST wrapper's INSTANCE id.
    const portfolio = findByCanonicalId(result.nodes, 'cdm.trade.Portfolio') as StructureDataNode;
    expect(portfolio.expansions.get('trade')).toBe(base.instanceId);
  });

  it('wraps a multi-level expanded target (Trade extends TradeBase extends TradeRoot)', () => {
    const fixture = {
      namespaces: [{ uri: 'cdm.trade' }],
      nodes: [
        {
          id: 'cdm.trade.TradeRoot',
          $type: 'Data' as const,
          name: 'TradeRoot',
          namespace: 'cdm.trade',
          attributes: [
            {
              name: 'rootField',
              typeCall: { type: { $refText: 'string' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        },
        {
          id: 'cdm.trade.TradeBase',
          $type: 'Data' as const,
          name: 'TradeBase',
          namespace: 'cdm.trade',
          extends: 'TradeRoot',
          attributes: [
            {
              name: 'baseField',
              typeCall: { type: { $refText: 'string' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        },
        {
          id: 'cdm.trade.Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'cdm.trade',
          extends: 'TradeBase',
          attributes: [
            {
              name: 'tradeField',
              typeCall: { type: { $refText: 'string' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        },
        {
          id: 'cdm.trade.Portfolio',
          $type: 'Data' as const,
          name: 'Portfolio',
          namespace: 'cdm.trade',
          attributes: [
            {
              name: 'trade',
              typeCall: { type: { $refText: 'Trade' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };

    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'cdm.trade.Portfolio',
      expansionMap: new Map([
        [
          expansionKey({
            namespaceUri: 'cdm.trade',
            typeId: 'Portfolio',
            attrName: 'trade',
            instancePath: ['cdm.trade.Portfolio']
          }),
          true
        ]
      ])
    });

    // Portfolio + Trade data + TradeBase container + TradeRoot container = 4.
    expect(result.nodes.size).toBe(4);
    const outerCanonicalId = `cdm.trade.Trade::__base::cdm.trade.TradeRoot`;
    const innerCanonicalId = `cdm.trade.Trade::__base::cdm.trade.TradeBase`;

    const outer = findByCanonicalId(result.nodes, outerCanonicalId) as StructureBaseContainer;
    const inner = findByCanonicalId(result.nodes, innerCanonicalId) as StructureBaseContainer;
    const trade = findByCanonicalId(result.nodes, 'cdm.trade.Trade') as StructureDataNode;
    expect(outer).toBeDefined();
    expect(inner).toBeDefined();
    expect(trade).toBeDefined();

    expect(outer.baseTypeName).toBe('TradeRoot');
    expect(outer.baseRows.map((r) => r.attrName)).toEqual(['rootField']);
    expect(outer.childNodeId).toBe(inner.instanceId);

    expect(inner.baseTypeName).toBe('TradeBase');
    expect(inner.baseRows.map((r) => r.attrName)).toEqual(['baseField']);
    expect(inner.childNodeId).toBe(trade.instanceId);

    // Expansion edge points at the outermost (TradeRoot's) container instance id.
    const portfolio = findByCanonicalId(result.nodes, 'cdm.trade.Portfolio') as StructureDataNode;
    expect(portfolio.expansions.get('trade')).toBe(outer.instanceId);
  });

  it('Phase 14e: two attributes expanding the same inheriting Data produce TWO per-instance subtrees', () => {
    // Pre-Phase-14e: Portfolio.trade1 + Portfolio.trade2 both expand to Trade
    // (which extends TradeBase) and the canonical-dedup cache shared ONE Trade
    // StructureNode across both edges. Per Phase 14e (full per-instance
    // materialization), each visible occurrence is its own subtree — so the
    // graph now contains TWO TradeBase containers and TWO Trade data nodes
    // for the two expansion targets, with their own (potentially divergent)
    // expansion state.
    const fixture = {
      namespaces: [{ uri: 'cdm.trade' }],
      nodes: [
        {
          id: 'cdm.trade.TradeBase',
          $type: 'Data' as const,
          name: 'TradeBase',
          namespace: 'cdm.trade',
          attributes: [
            { name: 'tradeID', typeCall: { type: { $refText: 'string' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'cdm.trade.Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'cdm.trade',
          extends: 'TradeBase',
          attributes: [
            {
              name: 'tradeDate',
              typeCall: { type: { $refText: 'date' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        },
        {
          id: 'cdm.trade.Portfolio',
          $type: 'Data' as const,
          name: 'Portfolio',
          namespace: 'cdm.trade',
          attributes: [
            {
              name: 'trade1',
              typeCall: { type: { $refText: 'Trade' } },
              card: { inf: 1, sup: 1, unbounded: false }
            },
            {
              name: 'trade2',
              typeCall: { type: { $refText: 'Trade' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };

    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'cdm.trade.Portfolio',
      expansionMap: new Map([
        [
          expansionKey({
            namespaceUri: 'cdm.trade',
            typeId: 'Portfolio',
            attrName: 'trade1',
            instancePath: ['cdm.trade.Portfolio']
          }),
          true
        ],
        [
          expansionKey({
            namespaceUri: 'cdm.trade',
            typeId: 'Portfolio',
            attrName: 'trade2',
            instancePath: ['cdm.trade.Portfolio']
          }),
          true
        ]
      ])
    });

    // Portfolio + 2 Trade data nodes + 2 TradeBase containers = 5 nodes total.
    expect(result.nodes.size).toBe(5);
    const baseInstances = findAllByCanonicalId(result.nodes, `cdm.trade.Trade::__base::cdm.trade.TradeBase`);
    expect(baseInstances).toHaveLength(2);
    const tradeInstances = findAllByCanonicalId(result.nodes, 'cdm.trade.Trade');
    expect(tradeInstances).toHaveLength(2);

    const portfolio = findByCanonicalId(result.nodes, 'cdm.trade.Portfolio') as StructureDataNode;
    // Each edge resolves to a DIFFERENT outermost-wrapper instance id (one
    // per visible occurrence).
    const trade1Id = portfolio.expansions.get('trade1');
    const trade2Id = portfolio.expansions.get('trade2');
    expect(trade1Id).toBeDefined();
    expect(trade2Id).toBeDefined();
    expect(trade1Id).not.toBe(trade2Id);
    // Both ids resolve to (different) base-container instances.
    expect(baseInstances.map((b) => b.instanceId)).toEqual(expect.arrayContaining([trade1Id, trade2Id]));
  });
});

describe('buildStructureGraph — cycle-aware expansion (ancestor edges dropped)', () => {
  // Phase 3 layout interprets `StructureNode.expansions` as React Flow
  // containment (child node `parentId` = ancestor id). A literal A → A or
  // A → B → A in the expansions chain would form a parent-cycle the layout
  // cannot resolve, so the adapter MUST drop containment edges back to any
  // ancestor in the current recursion path while preserving the row chip
  // itself. Sibling cross-references (target completed in a prior branch,
  // not currently on the recursion stack) are preserved — they render as
  // out-of-tree handles in Phase 3.

  it('drops direct self-reference: Tree.parent: Tree records no expansion edge', () => {
    const fixtureSelf = {
      namespaces: [{ uri: 'ns' }],
      nodes: [
        {
          id: 'ns::Tree',
          $type: 'Data' as const,
          name: 'Tree',
          namespace: 'ns',
          attributes: [
            {
              name: 'parent',
              typeCall: { type: { $refText: 'Tree' } },
              card: { inf: 0, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };
    const expansionMap = new Map<string, boolean>([
      [expansionKey({ namespaceUri: 'ns', typeId: 'Tree', attrName: 'parent' }), true]
    ]);

    const result = buildStructureGraph(fixtureSelf, {
      focusedTypeId: 'ns::Tree',
      expansionMap
    });

    // Only one Tree node — no self-clone or recursion explosion.
    expect(result.nodes.size).toBe(1);
    const tree = result.nodes.get('ns::Tree') as StructureDataNode;
    // Containment edge suppressed (parent is the ancestor of itself).
    expect(tree.expansions.size).toBe(0);
    // Row data is intact — the chip still references Tree by id; only the
    // parent/child layout edge is missing.
    const row = tree.rows.find((r) => r.attrName === 'parent')!;
    expect(row.typeKind).toBe('Data');
    expect(row.targetNodeId).toBe('ns::Tree');
  });

  it('drops indirect cycle A → B → A: keeps A.next, suppresses B.next', () => {
    const fixtureIndirect = {
      namespaces: [{ uri: 'ns' }],
      nodes: [
        {
          id: 'ns::A',
          $type: 'Data' as const,
          name: 'A',
          namespace: 'ns',
          attributes: [
            {
              name: 'next',
              typeCall: { type: { $refText: 'B' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        },
        {
          id: 'ns::B',
          $type: 'Data' as const,
          name: 'B',
          namespace: 'ns',
          attributes: [
            {
              name: 'next',
              typeCall: { type: { $refText: 'A' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };
    // Per-instance keys: A has no inheritance, rootInstanceId = 'ns::A'.
    const aInstanceId = 'ns::A';
    const bInstanceId = `${aInstanceId}::next::ns::B`;
    const expansionMap = new Map<string, boolean>([
      [expansionKey({ namespaceUri: 'ns', typeId: 'A', attrName: 'next', instancePath: [aInstanceId] }), true],
      [
        expansionKey({ namespaceUri: 'ns', typeId: 'B', attrName: 'next', instancePath: [aInstanceId, bInstanceId] }),
        true
      ]
    ]);

    const result = buildStructureGraph(fixtureIndirect, {
      focusedTypeId: 'ns::A',
      expansionMap
    });

    expect(result.nodes.size).toBe(2);
    const a = findByCanonicalId(result.nodes, 'ns::A') as StructureDataNode;
    const b = findByCanonicalId(result.nodes, 'ns::B') as StructureDataNode;

    // A → B kept: B is not an ancestor when we record this edge.
    expect(a.expansions.get('next')).toBe(b.instanceId);
    // B → A dropped: A IS an ancestor (we recursed A then B).
    expect(b.expansions.size).toBe(0);

    // Row data intact on both sides.
    const aRow = a.rows.find((r) => r.attrName === 'next')!;
    expect(aRow.typeKind).toBe('Data');
    expect(aRow.targetNodeId).toBe('ns::B');
    const bRow = b.rows.find((r) => r.attrName === 'next')!;
    expect(bRow.typeKind).toBe('Data');
    expect(bRow.targetNodeId).toBe('ns::A');
  });

  it('Phase 14e: Trade.party AND Trade.counterparty produce TWO per-instance Party subtrees', () => {
    // Pre-Phase-14e (canonical dedup): one shared Party StructureNode with
    // both expansion edges pointing at it.
    // Phase 14e (per-instance): each visible Party is its own StructureNode
    // with its own (potentially divergent) expansion state. Both edges still
    // resolve — they just resolve to DIFFERENT instance ids.
    const fixtureSibling = {
      namespaces: [{ uri: 'ns' }],
      nodes: [
        {
          id: 'ns::Party',
          $type: 'Data' as const,
          name: 'Party',
          namespace: 'ns',
          attributes: [
            { name: 'id', typeCall: { type: { $refText: 'string' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'ns::Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'ns',
          attributes: [
            {
              name: 'party',
              typeCall: { type: { $refText: 'Party' } },
              card: { inf: 1, sup: 1, unbounded: false }
            },
            {
              name: 'counterparty',
              typeCall: { type: { $refText: 'Party' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };
    // Per-instance keys: Trade has no inheritance, rootInstanceId = 'ns::Trade'.
    const tradeInstanceId = 'ns::Trade';
    const expansionMap = new Map<string, boolean>([
      [expansionKey({ namespaceUri: 'ns', typeId: 'Trade', attrName: 'party', instancePath: [tradeInstanceId] }), true],
      [
        expansionKey({
          namespaceUri: 'ns',
          typeId: 'Trade',
          attrName: 'counterparty',
          instancePath: [tradeInstanceId]
        }),
        true
      ]
    ]);

    const result = buildStructureGraph(fixtureSibling, {
      focusedTypeId: 'ns::Trade',
      expansionMap
    });

    // Trade + 2 Party instances = 3 nodes total (per-instance).
    expect(result.nodes.size).toBe(3);
    const parties = findAllByCanonicalId(result.nodes, 'ns::Party');
    expect(parties).toHaveLength(2);
    const trade = findByCanonicalId(result.nodes, 'ns::Trade') as StructureDataNode;
    const partyId = trade.expansions.get('party');
    const counterpartyId = trade.expansions.get('counterparty');
    expect(partyId).toBeDefined();
    expect(counterpartyId).toBeDefined();
    expect(partyId).not.toBe(counterpartyId);
    expect(parties.map((p) => p.instanceId)).toEqual(expect.arrayContaining([partyId, counterpartyId]));
  });
});

describe('buildStructureGraph — context-dependent expansion edges (per-instance Phase 14e)', () => {
  // Pre-Phase-14e: this block exercised the SuppressedEdge cache-replay
  // mechanism that promoted a suppressed edge when a target was later reached
  // through a non-cyclic sibling path. Phase 14e (full per-instance
  // materialization) makes the mechanism unnecessary: each visible occurrence
  // walks independently with its own canonical-id `path` cycle guard, so the
  // expected outcome (the originally-suppressed edge IS present on the
  // alternate-path instance) emerges naturally without a side table.
  //
  // The tests are preserved for outcome-coverage; the implementation details
  // they verified (suppressedEdges side table, replay loop) no longer exist.

  it('promotes B → A edge when B is reached via a non-cyclic path after first being materialized inside a cycle (Codex scenario)', () => {
    // Adversarial cycle from Codex review: Root.a → A, Root.b → B, A.b → B,
    // B.a → A. The first traversal (Root.a → A → B) suppresses B.a → A
    // because A is on the recursion stack. But the SECOND traversal
    // (Root.b → B) reaches B with A as a completed sibling, not an ancestor.
    // The edge must be promoted. Without the cache-replay logic, B.expansions
    // would be {} forever and Phase 3 would lose a real containment edge.
    const fixture = {
      namespaces: [{ uri: 'ns' }],
      nodes: [
        {
          id: 'ns::Root',
          $type: 'Data' as const,
          name: 'Root',
          namespace: 'ns',
          attributes: [
            { name: 'a', typeCall: { type: { $refText: 'A' } }, card: { inf: 1, sup: 1, unbounded: false } },
            { name: 'b', typeCall: { type: { $refText: 'B' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'ns::A',
          $type: 'Data' as const,
          name: 'A',
          namespace: 'ns',
          attributes: [{ name: 'b', typeCall: { type: { $refText: 'B' } }, card: { inf: 1, sup: 1, unbounded: false } }]
        },
        {
          id: 'ns::B',
          $type: 'Data' as const,
          name: 'B',
          namespace: 'ns',
          attributes: [{ name: 'a', typeCall: { type: { $refText: 'A' } }, card: { inf: 1, sup: 1, unbounded: false } }]
        }
      ]
    };
    // Per-instance keys: Root has no inheritance, rootInstanceId = 'ns::Root'.
    const rootId = 'ns::Root';
    const aUnderRootId = `${rootId}::a::ns::A`;
    const bUnderAId = `${aUnderRootId}::b::ns::B`;
    const bUnderRootId = `${rootId}::b::ns::B`;
    const expansionMap = new Map<string, boolean>([
      [expansionKey({ namespaceUri: 'ns', typeId: 'Root', attrName: 'a', instancePath: [rootId] }), true],
      [expansionKey({ namespaceUri: 'ns', typeId: 'Root', attrName: 'b', instancePath: [rootId] }), true],
      [expansionKey({ namespaceUri: 'ns', typeId: 'A', attrName: 'b', instancePath: [rootId, aUnderRootId] }), true],
      [expansionKey({ namespaceUri: 'ns', typeId: 'B', attrName: 'a', instancePath: [rootId, bUnderRootId] }), true],
      [
        expansionKey({
          namespaceUri: 'ns',
          typeId: 'B',
          attrName: 'a',
          instancePath: [rootId, aUnderRootId, bUnderAId]
        }),
        true
      ]
    ]);

    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'ns::Root',
      expansionMap
    });

    // Phase 14e: per-instance materialization creates one StructureNode per
    // visible occurrence. Root.a → A (one A), A.b → B (one B inside A),
    // Root.b → B (a second B), and that second B's expansion to A (another A
    // since A is not on the recursion path of Root.b → B).
    //
    // Visible nodes: Root + A-under-Root.a + B-inside-A + B-under-Root.b +
    // A-inside-Root.b-B = 5.
    expect(result.nodes.size).toBe(5);
    const root = findByCanonicalId(result.nodes, 'ns::Root') as StructureDataNode;
    const aInstances = findAllByCanonicalId(result.nodes, 'ns::A');
    const bInstances = findAllByCanonicalId(result.nodes, 'ns::B');
    expect(aInstances).toHaveLength(2);
    expect(bInstances).toHaveLength(2);

    // Root has both expansion edges, each resolving to a per-instance subtree.
    expect(root.expansions.get('a')).toBeDefined();
    expect(root.expansions.get('b')).toBeDefined();
    expect(root.expansions.get('a')).not.toBe(root.expansions.get('b'));

    // The B reached via Root.b carries its OWN expansion to A (its own
    // per-instance A) — the formerly-suppressed B.a → A edge is naturally
    // present here because the per-instance walk reaches it on a non-cyclic
    // path (path = {Root, B}, A not on path).
    const bUnderRoot = bInstances.find((b) => b.instanceId === root.expansions.get('b')) as StructureDataNode;
    expect(bUnderRoot).toBeDefined();
    expect((bUnderRoot.expansions as Map<string, string>).get('a')).toBeDefined();
  });

  it('still suppresses direct self-reference even with cache replay (regression)', () => {
    // Pure cycle with no alternate path. Cache-replay must NOT incorrectly
    // promote this — there's no non-cyclic route to "rescue" it.
    const fixture = {
      namespaces: [{ uri: 'ns' }],
      nodes: [
        {
          id: 'ns::Tree',
          $type: 'Data' as const,
          name: 'Tree',
          namespace: 'ns',
          attributes: [
            {
              name: 'parent',
              typeCall: { type: { $refText: 'Tree' } },
              card: { inf: 0, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'ns::Tree',
      expansionMap: new Map([[expansionKey({ namespaceUri: 'ns', typeId: 'Tree', attrName: 'parent' }), true]])
    });

    expect(result.nodes.size).toBe(1);
    const tree = result.nodes.get('ns::Tree') as StructureDataNode;
    expect(tree.expansions.size).toBe(0);
  });

  it('still suppresses A → B → A when the ONLY path to B passes through A (regression)', () => {
    // Existing cycle-aware test, restated as a guard for the cache-replay
    // logic. B is only reachable via A, so B.next → A must stay suppressed.
    const fixture = {
      namespaces: [{ uri: 'ns' }],
      nodes: [
        {
          id: 'ns::A',
          $type: 'Data' as const,
          name: 'A',
          namespace: 'ns',
          attributes: [
            { name: 'next', typeCall: { type: { $refText: 'B' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'ns::B',
          $type: 'Data' as const,
          name: 'B',
          namespace: 'ns',
          attributes: [
            { name: 'next', typeCall: { type: { $refText: 'A' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        }
      ]
    };
    const aId = 'ns::A';
    const bId = `${aId}::next::ns::B`;
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'ns::A',
      expansionMap: new Map<string, boolean>([
        [expansionKey({ namespaceUri: 'ns', typeId: 'A', attrName: 'next', instancePath: [aId] }), true],
        [expansionKey({ namespaceUri: 'ns', typeId: 'B', attrName: 'next', instancePath: [aId, bId] }), true]
      ])
    });

    expect(result.nodes.size).toBe(2);
    const a = findByCanonicalId(result.nodes, 'ns::A') as StructureDataNode;
    const b = findByCanonicalId(result.nodes, 'ns::B') as StructureDataNode;
    expect(a.expansions.get('next')).toBe(b.instanceId);
    expect(b.expansions.size).toBe(0);
  });

  it('Phase 14e: BaseRoot.b path produces per-instance B with its own A subtree (was: cache-replay promotion)', () => {
    // Inherited-row analogue of the Codex scenario. Root extends BaseRoot,
    // BaseRoot.a: A, BaseRoot.b: B, A.b: B, B.a: A. All expanded. The base
    // container's `a` expansion gets walked first (path includes A), then
    // A.b → B causes B materialization (path includes A,B), then B.a → A is
    // suppressed. When the base container's `b` row is walked, B is in cache
    // and A is a completed sibling — B.a → A must be promoted.
    const fixture = {
      namespaces: [{ uri: 'ns' }],
      nodes: [
        {
          id: 'ns::BaseRoot',
          $type: 'Data' as const,
          name: 'BaseRoot',
          namespace: 'ns',
          attributes: [
            { name: 'a', typeCall: { type: { $refText: 'A' } }, card: { inf: 1, sup: 1, unbounded: false } },
            { name: 'b', typeCall: { type: { $refText: 'B' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'ns::Root',
          $type: 'Data' as const,
          name: 'Root',
          namespace: 'ns',
          extends: 'BaseRoot',
          attributes: [
            { name: 'extra', typeCall: { type: { $refText: 'string' } }, card: { inf: 0, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'ns::A',
          $type: 'Data' as const,
          name: 'A',
          namespace: 'ns',
          attributes: [{ name: 'b', typeCall: { type: { $refText: 'B' } }, card: { inf: 1, sup: 1, unbounded: false } }]
        },
        {
          id: 'ns::B',
          $type: 'Data' as const,
          name: 'B',
          namespace: 'ns',
          attributes: [{ name: 'a', typeCall: { type: { $refText: 'A' } }, card: { inf: 1, sup: 1, unbounded: false } }]
        }
      ]
    };
    // Root extends BaseRoot, so outermostCanonicalId = 'ns::Root::__base::ns::BaseRoot'.
    // Base container rfId = outermostInstanceId = 'ns::Root::__base::ns::BaseRoot'.
    // childExpansionInstancePath for base rows = [baseRfId].
    const baseRfId = 'ns::Root::__base::ns::BaseRoot';
    const aUnderBaseId = `${baseRfId}::a::ns::A`;
    const bUnderAId = `${aUnderBaseId}::b::ns::B`;
    const bUnderBaseId = `${baseRfId}::b::ns::B`;
    const expansionMap = new Map<string, boolean>([
      [expansionKey({ namespaceUri: 'ns', typeId: 'BaseRoot', attrName: 'a', instancePath: [baseRfId] }), true],
      [expansionKey({ namespaceUri: 'ns', typeId: 'BaseRoot', attrName: 'b', instancePath: [baseRfId] }), true],
      [expansionKey({ namespaceUri: 'ns', typeId: 'A', attrName: 'b', instancePath: [baseRfId, aUnderBaseId] }), true],
      [expansionKey({ namespaceUri: 'ns', typeId: 'B', attrName: 'a', instancePath: [baseRfId, bUnderBaseId] }), true],
      [
        expansionKey({
          namespaceUri: 'ns',
          typeId: 'B',
          attrName: 'a',
          instancePath: [baseRfId, aUnderBaseId, bUnderAId]
        }),
        true
      ]
    ]);

    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'ns::Root',
      expansionMap
    });

    const baseCanonicalId = `ns::Root::__base::ns::BaseRoot`;
    const base = findByCanonicalId(result.nodes, baseCanonicalId) as StructureBaseContainer;
    const aInstances = findAllByCanonicalId(result.nodes, 'ns::A');
    const bInstances = findAllByCanonicalId(result.nodes, 'ns::B');

    // Per-instance: two A subtrees (BaseRoot.a + Root.b->B.a) and two B
    // subtrees (BaseRoot.b + BaseRoot.a->A.b).
    expect(aInstances.length).toBeGreaterThanOrEqual(2);
    expect(bInstances.length).toBeGreaterThanOrEqual(2);

    // Base container carries both inherited-row expansions; each points at a
    // distinct per-instance subtree.
    const baseAId = base.expansions.get('a');
    const baseBId = base.expansions.get('b');
    expect(baseAId).toBeDefined();
    expect(baseBId).toBeDefined();
    expect(baseAId).not.toBe(baseBId);

    // The B reached via BaseRoot.b carries its own expansion to A (a fresh A
    // sibling), reflecting the per-instance walk's natural fall-through.
    const bUnderBaseB = bInstances.find((b) => b.instanceId === baseBId) as StructureDataNode;
    expect(bUnderBaseB).toBeDefined();
    expect((bUnderBaseB.expansions as Map<string, string>).get('a')).toBeDefined();
  });
});

describe('buildStructureGraph — base container row expansion (inherited rows carry expansions)', () => {
  // Spec §3.2: containment is the uniform mechanism for both inheritance
  // and type-reference. A complex-typed inherited row owned by a base level
  // (e.g. TradeBase.party: Party, viewed via Trade) must be expandable in
  // exactly the same way as a row on the derived type — but the expansion
  // edge lives on the base container (the row's declaration owner) and the
  // expansion key uses the BASE's namespace+name so the same state applies
  // whether the user views TradeBase directly or any descendant.

  it('inherited Data ref expanded materializes target as base-owned containment edge', () => {
    // Spec §3.2: an inherited complex-typed row (e.g. TradeBase.party: Party
    // viewed via Trade) must be expandable. The expansion edge lives on the
    // base container (the row's declaration owner), NOT the derived Data node,
    // and the expansion key uses the BASE's namespace+name so the same state
    // applies whether the user views TradeBase directly or any descendant.
    const fixture = {
      namespaces: [{ uri: 'cdm.trade' }],
      nodes: [
        {
          id: 'cdm.trade.Party',
          $type: 'Data' as const,
          name: 'Party',
          namespace: 'cdm.trade',
          attributes: [
            { name: 'id', typeCall: { type: { $refText: 'string' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'cdm.trade.TradeBase',
          $type: 'Data' as const,
          name: 'TradeBase',
          namespace: 'cdm.trade',
          attributes: [
            {
              name: 'party',
              typeCall: { type: { $refText: 'Party' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        },
        {
          id: 'cdm.trade.Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'cdm.trade',
          extends: 'TradeBase',
          attributes: [
            {
              name: 'tradeDate',
              typeCall: { type: { $refText: 'date' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };

    // Trade extends TradeBase: outermostCanonicalId = 'cdm.trade.Trade::__base::cdm.trade.TradeBase'.
    // Base container rfId = outermostInstanceId. childExpansionInstancePath = [baseRfId].
    const baseRfId = 'cdm.trade.Trade::__base::cdm.trade.TradeBase';
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap: new Map([
        // Key uses the BASE's ns/name — TradeBase, not Trade.
        [
          expansionKey({ namespaceUri: 'cdm.trade', typeId: 'TradeBase', attrName: 'party', instancePath: [baseRfId] }),
          true
        ]
      ])
    });

    // 3 nodes: TradeBase container, Trade data, Party data.
    expect(result.nodes.size).toBe(3);
    const baseCanonicalId = `cdm.trade.Trade::__base::cdm.trade.TradeBase`;
    const base = findByCanonicalId(result.nodes, baseCanonicalId) as StructureBaseContainer;
    expect(base.kind).toBe('base');
    // The derived Data node has no expansion for `party` — it doesn't own
    // that attribute.
    const trade = findByCanonicalId(result.nodes, 'cdm.trade.Trade') as StructureDataNode;
    expect(trade.expansions.size).toBe(0);

    // Party itself is materialized with its own rows.
    const party = findByCanonicalId(result.nodes, 'cdm.trade.Party') as StructureDataNode;
    expect(party).toBeDefined();
    expect(party.kind).toBe('data');
    expect(party.rows.map((r) => r.attrName)).toEqual(['id']);
    // The expansion edge on the BASE container points at Party's instance id.
    expect(base.expansions.get('party')).toBe(party.instanceId);
  });

  it('inherited Choice ref expanded materializes the choice node', () => {
    const fixture = {
      namespaces: [{ uri: 'ns' }],
      nodes: [
        {
          id: 'ns::Payout',
          $type: 'Choice' as const,
          name: 'Payout',
          namespace: 'ns',
          // Real ChoiceOption shape: only typeCall, no name/card.
          choiceOptions: [{ typeCall: { type: { $refText: 'string' } } }]
        },
        {
          id: 'ns::TradeBase',
          $type: 'Data' as const,
          name: 'TradeBase',
          namespace: 'ns',
          attributes: [
            {
              name: 'payout',
              typeCall: { type: { $refText: 'Payout' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        },
        {
          id: 'ns::Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'ns',
          extends: 'TradeBase',
          attributes: [
            {
              name: 'tradeDate',
              typeCall: { type: { $refText: 'date' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };

    // ns::Trade extends ns::TradeBase: outermostCanonicalId = 'ns::Trade::__base::ns::TradeBase'.
    const baseRfId_ = 'ns::Trade::__base::ns::TradeBase';
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'ns::Trade',
      expansionMap: new Map([
        [expansionKey({ namespaceUri: 'ns', typeId: 'TradeBase', attrName: 'payout', instancePath: [baseRfId_] }), true]
      ])
    });

    const baseCanonicalId = `ns::Trade::__base::ns::TradeBase`;
    const base = findByCanonicalId(result.nodes, baseCanonicalId) as StructureBaseContainer;
    // Choices have no inheritance wrapping — the edge points at the Choice
    // instance id, no synthetic container.
    const payout = findByCanonicalId(result.nodes, 'ns::Payout');
    expect(payout?.kind).toBe('choice');
    expect(base.expansions.get('payout')).toBe(payout!.instanceId);
  });

  it('multi-level: outer base level owns its own attribute expansions', () => {
    // Trade extends TradeBase extends TradeRoot. TradeRoot.party: Party is
    // expanded. The OUTER base container (TradeRoot's) carries the
    // expansion edge — not the inner one. Pins ownership: each base level
    // is responsible for its own attribute expansions, not its descendants'.
    const fixture = {
      namespaces: [{ uri: 'cdm.trade' }],
      nodes: [
        {
          id: 'cdm.trade.Party',
          $type: 'Data' as const,
          name: 'Party',
          namespace: 'cdm.trade',
          attributes: [
            { name: 'id', typeCall: { type: { $refText: 'string' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'cdm.trade.TradeRoot',
          $type: 'Data' as const,
          name: 'TradeRoot',
          namespace: 'cdm.trade',
          attributes: [
            {
              name: 'party',
              typeCall: { type: { $refText: 'Party' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        },
        {
          id: 'cdm.trade.TradeBase',
          $type: 'Data' as const,
          name: 'TradeBase',
          namespace: 'cdm.trade',
          extends: 'TradeRoot',
          attributes: [
            {
              name: 'baseField',
              typeCall: { type: { $refText: 'string' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        },
        {
          id: 'cdm.trade.Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'cdm.trade',
          extends: 'TradeBase',
          attributes: [
            {
              name: 'tradeField',
              typeCall: { type: { $refText: 'string' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };

    // Trade extends TradeBase extends TradeRoot: outermost = 'cdm.trade.Trade::__base::cdm.trade.TradeRoot'.
    const outerBaseRfId = 'cdm.trade.Trade::__base::cdm.trade.TradeRoot';
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap: new Map([
        [
          expansionKey({
            namespaceUri: 'cdm.trade',
            typeId: 'TradeRoot',
            attrName: 'party',
            instancePath: [outerBaseRfId]
          }),
          true
        ]
      ])
    });

    const outerCanonicalId = `cdm.trade.Trade::__base::cdm.trade.TradeRoot`;
    const innerCanonicalId = `cdm.trade.Trade::__base::cdm.trade.TradeBase`;
    const outer = findByCanonicalId(result.nodes, outerCanonicalId) as StructureBaseContainer;
    const inner = findByCanonicalId(result.nodes, innerCanonicalId) as StructureBaseContainer;
    const trade = findByCanonicalId(result.nodes, 'cdm.trade.Trade') as StructureDataNode;
    const party = findByCanonicalId(result.nodes, 'cdm.trade.Party') as StructureDataNode;

    // The OUTER (TradeRoot) container owns the `party` expansion. Edge value
    // is Party's per-instance id.
    expect(party).toBeDefined();
    expect(outer.expansions.get('party')).toBe(party.instanceId);
    expect(inner.expansions.size).toBe(0);
    expect(trade.expansions.size).toBe(0);
  });

  it('inherited Data target that itself inherits chains correctly (composes with target-inheritance)', () => {
    // Structural symmetry: TradeBase.party: Party AND Party extends PartyBase.
    // Expanding `party` from TradeBase's level must produce an expansion edge
    // pointing at the OUTERMOST container of Party's chain (PartyBase's
    // container), not at the bare Party id. This composes inherited-row
    // expansion with expansion-target-inheritance.
    const fixture = {
      namespaces: [{ uri: 'ns' }],
      nodes: [
        {
          id: 'ns::PartyBase',
          $type: 'Data' as const,
          name: 'PartyBase',
          namespace: 'ns',
          attributes: [
            { name: 'partyId', typeCall: { type: { $refText: 'string' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'ns::Party',
          $type: 'Data' as const,
          name: 'Party',
          namespace: 'ns',
          extends: 'PartyBase',
          attributes: [
            { name: 'name', typeCall: { type: { $refText: 'string' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'ns::TradeBase',
          $type: 'Data' as const,
          name: 'TradeBase',
          namespace: 'ns',
          attributes: [
            {
              name: 'party',
              typeCall: { type: { $refText: 'Party' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        },
        {
          id: 'ns::Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'ns',
          extends: 'TradeBase',
          attributes: [
            {
              name: 'tradeDate',
              typeCall: { type: { $refText: 'date' } },
              card: { inf: 1, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };

    // ns::Trade extends ns::TradeBase: outermostCanonicalId = 'ns::Trade::__base::ns::TradeBase'.
    const tradeBaseRfId = 'ns::Trade::__base::ns::TradeBase';
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'ns::Trade',
      expansionMap: new Map([
        [
          expansionKey({ namespaceUri: 'ns', typeId: 'TradeBase', attrName: 'party', instancePath: [tradeBaseRfId] }),
          true
        ]
      ])
    });

    const tradeBaseCanonicalId = `ns::Trade::__base::ns::TradeBase`;
    const tradeBase = findByCanonicalId(result.nodes, tradeBaseCanonicalId) as StructureBaseContainer;

    // Outermost container of Party's chain — PartyBase's wrap.
    const partyOuterCanonicalId = `ns::Party::__base::ns::PartyBase`;
    const partyOuter = findByCanonicalId(result.nodes, partyOuterCanonicalId) as StructureBaseContainer;
    const party = findByCanonicalId(result.nodes, 'ns::Party') as StructureDataNode;
    const trade = findByCanonicalId(result.nodes, 'ns::Trade') as StructureDataNode;
    expect(tradeBase).toBeDefined();
    expect(partyOuter).toBeDefined();
    expect(party).toBeDefined();
    expect(trade).toBeDefined();

    // The base container's expansion points at PartyBase's instance id
    // (outermost wrapper of Party's chain).
    expect(tradeBase.expansions.get('party')).toBe(partyOuter.instanceId);

    expect(result.nodes.size).toBe(4);

    expect(partyOuter.baseTypeName).toBe('PartyBase');
    expect(partyOuter.childNodeId).toBe(party.instanceId);
    expect(party.rows.map((r) => r.attrName)).toEqual(['name']);
  });
});

describe('buildStructureGraph — inherited-row self-reference to descendant (cache seeding)', () => {
  // Adversarial scenario from the seventh Codex review finding on PR #173,
  // the second in the "caching strategy" sub-category (first was cache-
  // replay; this is cache-seeding). When an inherited base-container row
  // points back at the focused (descendant) type, the cycle-protection
  // `baseRowPath` set previously didn't include `focused.id`, AND the
  // `outerMostId` cache wasn't seeded before walking the inheritance chain,
  // so re-entering `materializeDataWithInheritance(focused, ...)` from a
  // base-row walk recursed indefinitely and blew the stack.
  //
  // The fix pre-seeds `outerMostId` with a sentinel (focused.id) so re-entry
  // short-circuits via the existing cache hit, AND extends `baseRowPath` to
  // include `focused.id` so the SuppressedEdge mechanism correctly drops
  // the containment edge (Phase 3 cannot lay out a parent-cycle).

  it('handles Base.child: Derived where Derived extends Base without stack overflow', () => {
    // The exact Codex scenario.
    const fixture = {
      namespaces: [{ uri: 'ns' }],
      nodes: [
        {
          id: 'ns::Base',
          $type: 'Data' as const,
          name: 'Base',
          namespace: 'ns',
          attributes: [
            // Inherited row pointing back at the descendant Derived.
            { name: 'child', typeCall: { type: { $refText: 'Derived' } }, card: { inf: 0, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'ns::Derived',
          $type: 'Data' as const,
          name: 'Derived',
          namespace: 'ns',
          extends: 'Base',
          attributes: []
        }
      ]
    };
    // ns::Derived extends ns::Base: outermostCanonicalId = 'ns::Derived::__base::ns::Base'.
    const derivedBaseRfId = 'ns::Derived::__base::ns::Base';
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'ns::Derived',
      // Expansion key uses the BASE owner (where `child` is declared).
      expansionMap: new Map([
        [expansionKey({ namespaceUri: 'ns', typeId: 'Base', attrName: 'child', instancePath: [derivedBaseRfId] }), true]
      ])
    });

    // Build completed (no stack overflow) and produced exactly two nodes:
    // the Derived data node and the synthetic Base container that wraps it.
    expect(result.nodes.size).toBe(2);
    const baseCanonicalId = `ns::Derived::__base::ns::Base`;
    const base = findByCanonicalId(result.nodes, baseCanonicalId) as StructureBaseContainer;
    const derived = findByCanonicalId(result.nodes, 'ns::Derived') as StructureDataNode;
    expect(base.kind).toBe('base');
    expect(base.childNodeId).toBe(derived.instanceId);
    // Containment edge MUST be suppressed — the only path to Derived from
    // here is the recursion we're already in, which would form a parent-
    // cycle Phase 3 cannot lay out.
    expect(base.expansions.size).toBe(0);
    // Row metadata is intact — the chip still references Derived by id;
    // only the parent/child layout edge is dropped.
    const childRow = base.baseRows.find((r) => r.attrName === 'child')!;
    expect(childRow.typeKind).toBe('Data');
    expect(childRow.targetNodeId).toBe('ns::Derived');
  });

  it('handles deeper grandparent: C.aRef: A where A extends B extends C', () => {
    // Inherited row on the outermost base loops back at the focused leaf.
    // Same self-reference shape, deeper inheritance chain.
    const fixture = {
      namespaces: [{ uri: 'ns' }],
      nodes: [
        {
          id: 'ns::C',
          $type: 'Data' as const,
          name: 'C',
          namespace: 'ns',
          attributes: [
            { name: 'aRef', typeCall: { type: { $refText: 'A' } }, card: { inf: 0, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'ns::B',
          $type: 'Data' as const,
          name: 'B',
          namespace: 'ns',
          extends: 'C',
          attributes: []
        },
        {
          id: 'ns::A',
          $type: 'Data' as const,
          name: 'A',
          namespace: 'ns',
          extends: 'B',
          attributes: []
        }
      ]
    };
    // A extends B extends C: outermostCanonicalId = 'ns::A::__base::ns::C'.
    const cBaseRfId = 'ns::A::__base::ns::C';
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'ns::A',
      expansionMap: new Map([
        [expansionKey({ namespaceUri: 'ns', typeId: 'C', attrName: 'aRef', instancePath: [cBaseRfId] }), true]
      ])
    });

    // No stack overflow. Three nodes: A data + B container + C container.
    expect(result.nodes.size).toBe(3);
    const bCanonicalId = `ns::A::__base::ns::B`;
    const cCanonicalId = `ns::A::__base::ns::C`;
    const cContainer = findByCanonicalId(result.nodes, cCanonicalId) as StructureBaseContainer;
    const bContainer = findByCanonicalId(result.nodes, bCanonicalId) as StructureBaseContainer;
    const a = findByCanonicalId(result.nodes, 'ns::A') as StructureDataNode;
    expect(cContainer.kind).toBe('base');
    // C's inherited row → A is suppressed (A is the focused descendant on
    // the current recursion path).
    expect(cContainer.expansions.size).toBe(0);
    const aRefRow = cContainer.baseRows.find((r) => r.attrName === 'aRef')!;
    expect(aRefRow.typeKind).toBe('Data');
    expect(aRefRow.targetNodeId).toBe('ns::A');
    // B container chains correctly: outermost is C, inner is B (B's childNodeId
    // = A's instance id; C's childNodeId = B's instance id).
    expect(bContainer).toBeDefined();
    expect(bContainer.childNodeId).toBe(a.instanceId);
    expect(cContainer.childNodeId).toBe(bContainer.instanceId);
  });
});

// ---------------------------------------------------------------------------
// Phase 14d — per-instance expansion semantics
// ---------------------------------------------------------------------------

describe('buildStructureGraph — per-instance expansion (Phase 14d)', () => {
  // Per-instance expansion semantics, matching XmlSpy / Altova UModel / Liquid
  // Studio / Oxygen XML conventions. Each visible occurrence of a type can be
  // expanded independently. The expansion key carries an `instancePath` of
  // ancestor React Flow instance ids, so chevrons in different visible
  // occurrences of the same type produce different keys.

  it('expanding the buyer row on Trade does not expand the seller row even though both target Party', () => {
    // Top-level independence: buyer and seller are different attrNames on Trade,
    // so their chevrons have distinct keys (`{Trade, buyer, []}` vs
    // `{Trade, seller, []}`). Expanding only buyer leaves seller collapsed.
    const fixture = {
      namespaces: [{ uri: 'cdm.trade' }],
      nodes: [
        {
          id: 'cdm.trade.Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'cdm.trade',
          attributes: [
            { name: 'buyer', typeCall: { type: { $refText: 'Party' } }, card: { inf: 1, sup: 1, unbounded: false } },
            { name: 'seller', typeCall: { type: { $refText: 'Party' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'cdm.trade.Party',
          $type: 'Data' as const,
          name: 'Party',
          namespace: 'cdm.trade',
          attributes: [
            { name: 'partyId', typeCall: { type: { $refText: 'string' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        }
      ]
    };
    // Only the buyer row is expanded. Per-instance key: Trade has no inheritance,
    // rootInstanceId = 'cdm.trade.Trade'. Root-row instancePath = [rootInstanceId].
    const buyerKey: StructureExpansionKey = {
      namespaceUri: 'cdm.trade',
      typeId: 'Trade',
      attrName: 'buyer',
      instancePath: ['cdm.trade.Trade']
    };
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap: new Map([[expansionKey(buyerKey), true]])
    });

    const trade = findByCanonicalId(result.nodes, 'cdm.trade.Trade') as StructureDataNode;
    // Buyer expansion edge present (resolves to a per-instance Party id);
    // seller is collapsed.
    expect(trade.expansions.get('buyer')).toBeDefined();
    expect(trade.expansions.has('seller')).toBe(false);
    // Phase 14e: the buyer's Party is its own per-instance subtree.
    const partyInstances = findAllByCanonicalId(result.nodes, 'cdm.trade.Party');
    expect(partyInstances).toHaveLength(1);
    expect(trade.expansions.get('buyer')).toBe(partyInstances[0].instanceId);
  });

  it('per-instance keys expand rows at both root and nested levels', () => {
    // Verifies that the per-instance key format correctly fires both the root
    // row expansion (Trade.party) and the nested row expansion (Party.address).
    //
    // Per-instance key for Trade.party: Trade's rows are checked with
    //   childInstancePath = ['cdm.trade.Trade'] (= [...[], TradeRfId])
    //
    // Per-instance key for Party.address: Party's rows are checked with
    //   childInstancePath = ['cdm.trade.Trade', 'cdm.trade.Trade::party::cdm.trade.Party']
    // This is the self-inclusive format (ancestors + self rfId).
    const fixture = {
      namespaces: [{ uri: 'cdm.trade' }],
      nodes: [
        {
          id: 'cdm.trade.Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'cdm.trade',
          attributes: [
            { name: 'party', typeCall: { type: { $refText: 'Party' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'cdm.trade.Party',
          $type: 'Data' as const,
          name: 'Party',
          namespace: 'cdm.trade',
          attributes: [
            { name: 'address', typeCall: { type: { $refText: 'Address' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'cdm.trade.Address',
          $type: 'Data' as const,
          name: 'Address',
          namespace: 'cdm.trade',
          attributes: []
        }
      ]
    };
    const tradeRfId = 'cdm.trade.Trade';
    const partyRfId = `${tradeRfId}::party::cdm.trade.Party`;
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap: new Map([
        [
          expansionKey({ namespaceUri: 'cdm.trade', typeId: 'Trade', attrName: 'party', instancePath: [tradeRfId] }),
          true
        ],
        [
          expansionKey({
            namespaceUri: 'cdm.trade',
            typeId: 'Party',
            attrName: 'address',
            instancePath: [tradeRfId, partyRfId]
          }),
          true
        ]
      ])
    });

    const party = findByCanonicalId(result.nodes, 'cdm.trade.Party') as StructureDataNode;
    const address = findByCanonicalId(result.nodes, 'cdm.trade.Address') as StructureDataNode;
    expect(party).toBeDefined();
    expect(address).toBeDefined();
    expect(party.expansions.get('address')).toBe(address.instanceId);
  });
});

describe('expansionKey — serialization contract (Phase 14d single shape)', () => {
  // Single deterministic key shape. Empty/undefined instancePath serializes
  // to `ns::Type::attr` (no suffix); non-empty path appends `::<path.join('>')>`.

  it('serializes empty instancePath and omitted instancePath to the same string (root-level form)', () => {
    const a = expansionKey({ namespaceUri: 'cdm.trade', typeId: 'Trade', attrName: 'party' });
    const b = expansionKey({ namespaceUri: 'cdm.trade', typeId: 'Trade', attrName: 'party', instancePath: [] });
    expect(a).toBe(b);
    expect(a).toBe('cdm.trade::Trade::party');
  });

  it('appends instancePath with `>` separator when non-empty', () => {
    const k = expansionKey({
      namespaceUri: 'cdm.trade',
      typeId: 'Party',
      attrName: 'address',
      instancePath: ['cdm.trade.Trade']
    });
    expect(k).toBe('cdm.trade::Party::address::cdm.trade.Trade');
  });

  it('uses `>` between path entries to keep them distinguishable from `::` field separators', () => {
    const k = expansionKey({
      namespaceUri: 'cdm.trade',
      typeId: 'Address',
      attrName: 'street',
      instancePath: ['cdm.trade.Trade', 'cdm.trade.Trade::party::cdm.trade.Party']
    });
    expect(k).toBe('cdm.trade::Address::street::cdm.trade.Trade>cdm.trade.Trade::party::cdm.trade.Party');
  });
});

// ---------------------------------------------------------------------------
// Phase 14e — full per-instance materialization (Codex PR #194 review)
// ---------------------------------------------------------------------------

describe('buildStructureGraph — full per-instance materialization (Phase 14e)', () => {
  // The Phase 14d chevron-write fix addressed only half the problem: chevrons
  // wrote per-instance keys, but the adapter's `walkAndExpand` still deduped
  // StructureNodes by canonical id, so toggling `buyer.Party.address` polluted
  // a shared Party.expansions map that the layout consulted for the seller's
  // Party too. Phase 14e completes the picture: each visible instance has its
  // own StructureNode with its own expansions map.

  const buyerSellerFixture = {
    namespaces: [{ uri: 'cdm.trade' }],
    nodes: [
      {
        id: 'cdm.trade.Trade',
        $type: 'Data' as const,
        name: 'Trade',
        namespace: 'cdm.trade',
        attributes: [
          { name: 'buyer', typeCall: { type: { $refText: 'Party' } }, card: { inf: 1, sup: 1, unbounded: false } },
          { name: 'seller', typeCall: { type: { $refText: 'Party' } }, card: { inf: 1, sup: 1, unbounded: false } }
        ]
      },
      {
        id: 'cdm.trade.Party',
        $type: 'Data' as const,
        name: 'Party',
        namespace: 'cdm.trade',
        attributes: [
          { name: 'address', typeCall: { type: { $refText: 'Address' } }, card: { inf: 1, sup: 1, unbounded: false } }
        ]
      },
      {
        id: 'cdm.trade.Address',
        $type: 'Data' as const,
        name: 'Address',
        namespace: 'cdm.trade',
        attributes: [
          { name: 'street', typeCall: { type: { $refText: 'string' } }, card: { inf: 1, sup: 1, unbounded: false } }
        ]
      }
    ]
  };

  it('expanding buyer.Party.address does NOT expand seller.Party.address (no shared expansions map)', () => {
    // Expand: Trade.buyer (root row), Trade.seller (root row),
    // AND buyer.Party.address ONLY — using the per-instance key with
    // buyer.Party's instance id in the path.
    // Trade has no inheritance, rootInstanceId = 'cdm.trade.Trade'.
    const tradeRfId = 'cdm.trade.Trade';
    const buyerPartyInstanceId = `${tradeRfId}::buyer::cdm.trade.Party`;
    const expansionMap = new Map([
      [
        expansionKey({ namespaceUri: 'cdm.trade', typeId: 'Trade', attrName: 'buyer', instancePath: [tradeRfId] }),
        true
      ],
      [
        expansionKey({ namespaceUri: 'cdm.trade', typeId: 'Trade', attrName: 'seller', instancePath: [tradeRfId] }),
        true
      ],
      [
        expansionKey({
          namespaceUri: 'cdm.trade',
          typeId: 'Party',
          attrName: 'address',
          instancePath: [tradeRfId, buyerPartyInstanceId]
        }),
        true
      ]
    ]);
    const result = buildStructureGraph(buyerSellerFixture, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap
    });

    // Both Party instances are present, each with its own expansions map.
    const partyInstances = findAllByCanonicalId(result.nodes, 'cdm.trade.Party') as StructureDataNode[];
    expect(partyInstances).toHaveLength(2);
    const buyerParty = partyInstances.find((p) => p.instanceId === buyerPartyInstanceId)!;
    const sellerParty = partyInstances.find((p) => p.instanceId !== buyerPartyInstanceId)!;
    expect(buyerParty).toBeDefined();
    expect(sellerParty).toBeDefined();

    // Buyer's Party HAS the address expansion; seller's does NOT.
    expect(buyerParty.expansions.has('address')).toBe(true);
    expect(sellerParty.expansions.has('address')).toBe(false);

    // Exactly one Address materialized (buyer's), not two.
    const addressInstances = findAllByCanonicalId(result.nodes, 'cdm.trade.Address');
    expect(addressInstances).toHaveLength(1);

    // Total: Trade + 2 Party + 1 Address = 4 nodes.
    expect(result.nodes.size).toBe(4);
  });

  it('expanding both buyer.Party.address AND seller.Party.address materializes TWO distinct Address subtrees', () => {
    const tradeRfId = 'cdm.trade.Trade';
    const buyerPartyInstanceId = `${tradeRfId}::buyer::cdm.trade.Party`;
    const sellerPartyInstanceId = `${tradeRfId}::seller::cdm.trade.Party`;
    const expansionMap = new Map([
      [
        expansionKey({ namespaceUri: 'cdm.trade', typeId: 'Trade', attrName: 'buyer', instancePath: [tradeRfId] }),
        true
      ],
      [
        expansionKey({ namespaceUri: 'cdm.trade', typeId: 'Trade', attrName: 'seller', instancePath: [tradeRfId] }),
        true
      ],
      [
        expansionKey({
          namespaceUri: 'cdm.trade',
          typeId: 'Party',
          attrName: 'address',
          instancePath: [tradeRfId, buyerPartyInstanceId]
        }),
        true
      ],
      [
        expansionKey({
          namespaceUri: 'cdm.trade',
          typeId: 'Party',
          attrName: 'address',
          instancePath: [tradeRfId, sellerPartyInstanceId]
        }),
        true
      ]
    ]);
    const result = buildStructureGraph(buyerSellerFixture, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap
    });

    // Total: Trade + 2 Party + 2 Address = 5 nodes.
    expect(result.nodes.size).toBe(5);
    const addressInstances = findAllByCanonicalId(result.nodes, 'cdm.trade.Address');
    expect(addressInstances).toHaveLength(2);
    // Each Address sits under its own Party instance.
    const addrUnderBuyer = addressInstances.find((a) => a.instanceId.startsWith(buyerPartyInstanceId));
    const addrUnderSeller = addressInstances.find((a) => a.instanceId.startsWith(sellerPartyInstanceId));
    expect(addrUnderBuyer).toBeDefined();
    expect(addrUnderSeller).toBeDefined();
  });

  it('recursive self-reference terminates safely (A.refToSelf:A expanded once)', () => {
    const fixture = {
      namespaces: [{ uri: 'ns' }],
      nodes: [
        {
          id: 'ns::A',
          $type: 'Data' as const,
          name: 'A',
          namespace: 'ns',
          attributes: [
            { name: 'refToSelf', typeCall: { type: { $refText: 'A' } }, card: { inf: 0, sup: 1, unbounded: false } }
          ]
        }
      ]
    };
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'ns::A',
      expansionMap: new Map([
        [expansionKey({ namespaceUri: 'ns', typeId: 'A', attrName: 'refToSelf', instancePath: ['ns::A'] }), true]
      ])
    });
    // Cycle detected at the first re-entry; no infinite loop. Exactly one A
    // in the graph (the root); the self-referential expansion is suppressed.
    expect(result.nodes.size).toBe(1);
    const a = findByCanonicalId(result.nodes, 'ns::A') as StructureDataNode;
    expect(a.expansions.size).toBe(0);
  });

  it('memory smoke: 3 Party expansions × 2 Address expansions each → 10 nodes (not deduped)', () => {
    const fixture = {
      namespaces: [{ uri: 'cdm.trade' }],
      nodes: [
        {
          id: 'cdm.trade.Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'cdm.trade',
          attributes: [
            { name: 'buyer', typeCall: { type: { $refText: 'Party' } }, card: { inf: 1, sup: 1, unbounded: false } },
            { name: 'seller', typeCall: { type: { $refText: 'Party' } }, card: { inf: 1, sup: 1, unbounded: false } },
            { name: 'broker', typeCall: { type: { $refText: 'Party' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'cdm.trade.Party',
          $type: 'Data' as const,
          name: 'Party',
          namespace: 'cdm.trade',
          attributes: [
            { name: 'home', typeCall: { type: { $refText: 'Address' } }, card: { inf: 1, sup: 1, unbounded: false } },
            { name: 'work', typeCall: { type: { $refText: 'Address' } }, card: { inf: 1, sup: 1, unbounded: false } }
          ]
        },
        {
          id: 'cdm.trade.Address',
          $type: 'Data' as const,
          name: 'Address',
          namespace: 'cdm.trade',
          attributes: []
        }
      ]
    };
    // Expand all three Party rows + both Address rows on each Party.
    // Per-instance keys: Trade has no inheritance, rootInstanceId = 'cdm.trade.Trade'.
    // Each Party instance has its own id; to expand address on ALL three, we
    // need per-instance keys for each Party instance's home/work rows.
    const tradeRfId = 'cdm.trade.Trade';
    const buyerPartyId = `${tradeRfId}::buyer::cdm.trade.Party`;
    const sellerPartyId = `${tradeRfId}::seller::cdm.trade.Party`;
    const brokerPartyId = `${tradeRfId}::broker::cdm.trade.Party`;
    const expansionMap = new Map([
      [
        expansionKey({ namespaceUri: 'cdm.trade', typeId: 'Trade', attrName: 'buyer', instancePath: [tradeRfId] }),
        true
      ],
      [
        expansionKey({ namespaceUri: 'cdm.trade', typeId: 'Trade', attrName: 'seller', instancePath: [tradeRfId] }),
        true
      ],
      [
        expansionKey({ namespaceUri: 'cdm.trade', typeId: 'Trade', attrName: 'broker', instancePath: [tradeRfId] }),
        true
      ],
      [
        expansionKey({
          namespaceUri: 'cdm.trade',
          typeId: 'Party',
          attrName: 'home',
          instancePath: [tradeRfId, buyerPartyId]
        }),
        true
      ],
      [
        expansionKey({
          namespaceUri: 'cdm.trade',
          typeId: 'Party',
          attrName: 'home',
          instancePath: [tradeRfId, sellerPartyId]
        }),
        true
      ],
      [
        expansionKey({
          namespaceUri: 'cdm.trade',
          typeId: 'Party',
          attrName: 'home',
          instancePath: [tradeRfId, brokerPartyId]
        }),
        true
      ],
      [
        expansionKey({
          namespaceUri: 'cdm.trade',
          typeId: 'Party',
          attrName: 'work',
          instancePath: [tradeRfId, buyerPartyId]
        }),
        true
      ],
      [
        expansionKey({
          namespaceUri: 'cdm.trade',
          typeId: 'Party',
          attrName: 'work',
          instancePath: [tradeRfId, sellerPartyId]
        }),
        true
      ],
      [
        expansionKey({
          namespaceUri: 'cdm.trade',
          typeId: 'Party',
          attrName: 'work',
          instancePath: [tradeRfId, brokerPartyId]
        }),
        true
      ]
    ]);
    const result = buildStructureGraph(fixture, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap
    });
    // Trade + 3 Party + 6 Address = 10 nodes.
    expect(result.nodes.size).toBe(10);
    expect(findAllByCanonicalId(result.nodes, 'cdm.trade.Party')).toHaveLength(3);
    expect(findAllByCanonicalId(result.nodes, 'cdm.trade.Address')).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// Phase 14e/A — Choice + Enum focused roots (single-source-of-truth tests)
// ---------------------------------------------------------------------------

describe('buildStructureGraph — Choice as focused root (Phase 14e/A)', () => {
  // Choice roots match XmlSpy / Altova UModel conventions: the Choice itself
  // is the entry point, all arms are visible, and arms whose target is Data
  // or Choice can be drilled with the same per-instance chevron contract used
  // for Data attribute rows. Arms targeting terminal types (Enum / Builtin /
  // Unresolved) remain visible but have no expansion key.

  const choiceRootFixture = {
    namespaces: [{ uri: 'cdm.payment' }],
    nodes: [
      {
        id: 'cdm.payment.SettlementMethod',
        $type: 'Choice' as const,
        name: 'SettlementMethod',
        namespace: 'cdm.payment',
        choiceOptions: [
          { typeCall: { type: { $refText: 'CashPayment' } } },
          { typeCall: { type: { $refText: 'PhysicalDelivery' } } },
          { typeCall: { type: { $refText: 'DayCount' } } }, // Enum — terminal
          { typeCall: { type: { $refText: 'string' } } } // Builtin — terminal
        ]
      },
      {
        id: 'cdm.payment.CashPayment',
        $type: 'Data' as const,
        name: 'CashPayment',
        namespace: 'cdm.payment',
        attributes: [
          { name: 'amount', typeCall: { type: { $refText: 'number' } }, card: { inf: 1, sup: 1, unbounded: false } }
        ]
      },
      {
        id: 'cdm.payment.PhysicalDelivery',
        $type: 'Data' as const,
        name: 'PhysicalDelivery',
        namespace: 'cdm.payment',
        attributes: []
      },
      {
        id: 'cdm.payment.DayCount',
        $type: 'Enum' as const,
        name: 'DayCount',
        namespace: 'cdm.payment',
        values: [{ name: 'ACT_360' }]
      }
    ]
  };

  it('materializes the focused Choice as the root with all four arms visible', () => {
    const result = buildStructureGraph(choiceRootFixture, {
      focusedTypeId: 'cdm.payment.SettlementMethod',
      expansionMap: new Map()
    });
    expect(result.rootNodeId).toBe('cdm.payment.SettlementMethod');
    expect(result.nodes.size).toBe(1);
    const root = result.nodes.get('cdm.payment.SettlementMethod') as StructureChoiceNode;
    expect(root.kind).toBe('choice');
    expect(root.options).toHaveLength(4);
    expect(root.options.map((a) => a.typeName)).toEqual(['CashPayment', 'PhysicalDelivery', 'DayCount', 'string']);
    // typeKind classification: Data, Data, Enum, Builtin.
    expect(root.options.map((a) => a.typeKind)).toEqual(['Data', 'Data', 'Enum', 'Builtin']);
    // No arms expanded by default.
    expect(root.expansions.size).toBe(0);
  });

  it('expanding a Data-targeting arm materializes the target as a child subtree', () => {
    // Arm expansion key convention: arm.typeName fills the attrName slot.
    const armKey: StructureExpansionKey = {
      namespaceUri: 'cdm.payment',
      typeId: 'SettlementMethod',
      attrName: 'CashPayment',
      instancePath: ['cdm.payment.SettlementMethod']
    };
    const result = buildStructureGraph(choiceRootFixture, {
      focusedTypeId: 'cdm.payment.SettlementMethod',
      expansionMap: new Map([[expansionKey(armKey), true]])
    });
    const root = result.nodes.get('cdm.payment.SettlementMethod') as StructureChoiceNode;
    expect(root.expansions.size).toBe(1);
    const cashInstanceId = root.expansions.get('CashPayment');
    expect(cashInstanceId).toBeDefined();
    const cash = result.nodes.get(cashInstanceId!) as StructureDataNode;
    expect(cash.kind).toBe('data');
    expect(cash.name).toBe('CashPayment');
    expect(cash.rows).toHaveLength(1);
    expect(cash.rows[0].attrName).toBe('amount');
  });

  it('does NOT expand terminal arms (Enum / Builtin / Unresolved) even with an expansion key set', () => {
    // Per the contract, terminal arm typeKinds are never written into the
    // expansions map. A stray map entry for a terminal arm is a no-op.
    const strayKey: StructureExpansionKey = {
      namespaceUri: 'cdm.payment',
      typeId: 'SettlementMethod',
      attrName: 'DayCount', // Enum arm — terminal
      instancePath: ['cdm.payment.SettlementMethod']
    };
    const result = buildStructureGraph(choiceRootFixture, {
      focusedTypeId: 'cdm.payment.SettlementMethod',
      expansionMap: new Map([[expansionKey(strayKey), true]])
    });
    const root = result.nodes.get('cdm.payment.SettlementMethod') as StructureChoiceNode;
    expect(root.expansions.size).toBe(0);
    expect(root.expansions.has('DayCount')).toBe(false);
    // No DayCount instance materialized.
    expect(findAllByCanonicalId(result.nodes, 'cdm.payment.DayCount')).toHaveLength(0);
  });
});

describe('buildStructureGraph — Enum as focused root (Phase 14e/A)', () => {
  it('materializes the focused Enum as a single read-only node listing all values', () => {
    const enumFixture = {
      namespaces: [{ uri: 'cdm.base' }],
      nodes: [
        {
          id: 'cdm.base.DayCountFraction',
          $type: 'Enum' as const,
          name: 'DayCountFraction',
          namespace: 'cdm.base',
          values: [{ name: 'ACT_360' }, { name: 'ACT_365' }, { name: 'THIRTY_360' }]
        }
      ]
    };
    const result = buildStructureGraph(enumFixture, {
      focusedTypeId: 'cdm.base.DayCountFraction',
      expansionMap: new Map()
    });
    expect(result.rootNodeId).toBe('cdm.base.DayCountFraction');
    expect(result.nodes.size).toBe(1);
    const root = result.nodes.get('cdm.base.DayCountFraction') as StructureEnumNode;
    expect(root.kind).toBe('enum');
    expect(root.name).toBe('DayCountFraction');
    expect(root.values).toEqual(['ACT_360', 'ACT_365', 'THIRTY_360']);
  });

  it('materializes an empty Enum as a single node with empty values array (no crash)', () => {
    const result = buildStructureGraph(
      {
        namespaces: [{ uri: 'cdm.base' }],
        nodes: [
          {
            id: 'cdm.base.Empty',
            $type: 'Enum' as const,
            name: 'Empty',
            namespace: 'cdm.base',
            values: []
          }
        ]
      },
      { focusedTypeId: 'cdm.base.Empty', expansionMap: new Map() }
    );
    const root = result.nodes.get('cdm.base.Empty') as StructureEnumNode;
    expect(root.kind).toBe('enum');
    expect(root.values).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 14e/B — Choice arm expansion (per-instance, mirrors Data row)
// ---------------------------------------------------------------------------

describe('buildStructureGraph — Choice arm per-instance expansion (Phase 14e/B)', () => {
  // Cross-cuts with Phase 14d's per-instance semantics. Two visible Choice
  // instances each track their arms independently; toggling an arm in ONE
  // does not expand the same arm in the OTHER.

  const tradeWithTwoChoicesFixture = {
    namespaces: [{ uri: 'cdm.trade' }],
    nodes: [
      {
        id: 'cdm.trade.Trade',
        $type: 'Data' as const,
        name: 'Trade',
        namespace: 'cdm.trade',
        attributes: [
          { name: 'primary', typeCall: { type: { $refText: 'Payment' } }, card: { inf: 1, sup: 1, unbounded: false } },
          { name: 'secondary', typeCall: { type: { $refText: 'Payment' } }, card: { inf: 1, sup: 1, unbounded: false } }
        ]
      },
      {
        id: 'cdm.trade.Payment',
        $type: 'Choice' as const,
        name: 'Payment',
        namespace: 'cdm.trade',
        choiceOptions: [
          { typeCall: { type: { $refText: 'CashPayment' } } },
          { typeCall: { type: { $refText: 'BondPayment' } } }
        ]
      },
      {
        id: 'cdm.trade.CashPayment',
        $type: 'Data' as const,
        name: 'CashPayment',
        namespace: 'cdm.trade',
        attributes: [
          { name: 'amount', typeCall: { type: { $refText: 'number' } }, card: { inf: 1, sup: 1, unbounded: false } }
        ]
      },
      {
        id: 'cdm.trade.BondPayment',
        $type: 'Data' as const,
        name: 'BondPayment',
        namespace: 'cdm.trade',
        attributes: []
      }
    ]
  };

  it('expanding payment.CashPayment when payment is a row of a Data type drills the Choice arm', () => {
    // Focus a Data type with one Choice-typed attr; expand the attr; then expand
    // one of the Choice's arms. The full per-instance chain must resolve.
    const tradeRfId = 'cdm.trade.Trade';
    const paymentInstanceId = `${tradeRfId}::primary::cdm.trade.Payment`;
    const expansionMap = new Map([
      // 1. expand Trade.primary (the Choice arm-bearer row)
      [
        expansionKey({
          namespaceUri: 'cdm.trade',
          typeId: 'Trade',
          attrName: 'primary',
          instancePath: [tradeRfId]
        }),
        true
      ],
      // 2. expand the CashPayment arm on the materialized Payment instance
      [
        expansionKey({
          namespaceUri: 'cdm.trade',
          typeId: 'Payment',
          attrName: 'CashPayment',
          instancePath: [tradeRfId, paymentInstanceId]
        }),
        true
      ]
    ]);
    const result = buildStructureGraph(tradeWithTwoChoicesFixture, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap
    });
    const payment = findByCanonicalId(result.nodes, 'cdm.trade.Payment') as StructureChoiceNode;
    expect(payment).toBeDefined();
    expect(payment.expansions.size).toBe(1);
    const cashInstanceId = payment.expansions.get('CashPayment');
    expect(cashInstanceId).toBeDefined();
    const cash = result.nodes.get(cashInstanceId!) as StructureDataNode;
    expect(cash.kind).toBe('data');
    expect(cash.name).toBe('CashPayment');
  });

  it('two Choice instances (primary + secondary) track arm expansions independently (per Phase 14d)', () => {
    // Expand BOTH primary and secondary; then expand the CashPayment arm on
    // ONLY the primary's Payment instance. The secondary's Payment must
    // remain collapsed.
    const tradeRfId = 'cdm.trade.Trade';
    const primaryPaymentId = `${tradeRfId}::primary::cdm.trade.Payment`;
    const secondaryPaymentId = `${tradeRfId}::secondary::cdm.trade.Payment`;
    const expansionMap = new Map([
      [
        expansionKey({
          namespaceUri: 'cdm.trade',
          typeId: 'Trade',
          attrName: 'primary',
          instancePath: [tradeRfId]
        }),
        true
      ],
      [
        expansionKey({
          namespaceUri: 'cdm.trade',
          typeId: 'Trade',
          attrName: 'secondary',
          instancePath: [tradeRfId]
        }),
        true
      ],
      // ONLY the primary's CashPayment is expanded.
      [
        expansionKey({
          namespaceUri: 'cdm.trade',
          typeId: 'Payment',
          attrName: 'CashPayment',
          instancePath: [tradeRfId, primaryPaymentId]
        }),
        true
      ]
    ]);
    const result = buildStructureGraph(tradeWithTwoChoicesFixture, {
      focusedTypeId: 'cdm.trade.Trade',
      expansionMap
    });
    const paymentInstances = findAllByCanonicalId(result.nodes, 'cdm.trade.Payment') as StructureChoiceNode[];
    expect(paymentInstances).toHaveLength(2);
    const primary = paymentInstances.find((p) => p.instanceId === primaryPaymentId)!;
    const secondary = paymentInstances.find((p) => p.instanceId === secondaryPaymentId)!;
    expect(primary).toBeDefined();
    expect(secondary).toBeDefined();
    // Independence: primary has the CashPayment expansion; secondary does not.
    expect(primary.expansions.size).toBe(1);
    expect(primary.expansions.has('CashPayment')).toBe(true);
    expect(secondary.expansions.size).toBe(0);
    // Only one CashPayment instance materializes (under the primary).
    expect(findAllByCanonicalId(result.nodes, 'cdm.trade.CashPayment')).toHaveLength(1);
  });

  it('Choice-as-root: expanding two arms produces two child subtrees side-by-side', () => {
    // Verifies multi-arm expansion in the same Choice (used by the layout
    // to place each child in the right-hand column aligned with its arm row).
    const result = buildStructureGraph(
      {
        namespaces: [{ uri: 'cdm.payment' }],
        nodes: [
          {
            id: 'cdm.payment.Payment',
            $type: 'Choice' as const,
            name: 'Payment',
            namespace: 'cdm.payment',
            choiceOptions: [
              { typeCall: { type: { $refText: 'CashPayment' } } },
              { typeCall: { type: { $refText: 'BondPayment' } } }
            ]
          },
          {
            id: 'cdm.payment.CashPayment',
            $type: 'Data' as const,
            name: 'CashPayment',
            namespace: 'cdm.payment',
            attributes: [
              {
                name: 'amount',
                typeCall: { type: { $refText: 'number' } },
                card: { inf: 1, sup: 1, unbounded: false }
              }
            ]
          },
          {
            id: 'cdm.payment.BondPayment',
            $type: 'Data' as const,
            name: 'BondPayment',
            namespace: 'cdm.payment',
            attributes: [
              { name: 'isin', typeCall: { type: { $refText: 'string' } }, card: { inf: 1, sup: 1, unbounded: false } }
            ]
          }
        ]
      },
      {
        focusedTypeId: 'cdm.payment.Payment',
        expansionMap: new Map([
          [
            expansionKey({
              namespaceUri: 'cdm.payment',
              typeId: 'Payment',
              attrName: 'CashPayment',
              instancePath: ['cdm.payment.Payment']
            }),
            true
          ],
          [
            expansionKey({
              namespaceUri: 'cdm.payment',
              typeId: 'Payment',
              attrName: 'BondPayment',
              instancePath: ['cdm.payment.Payment']
            }),
            true
          ]
        ])
      }
    );
    const payment = result.nodes.get('cdm.payment.Payment') as StructureChoiceNode;
    expect(payment.expansions.size).toBe(2);
    expect(payment.expansions.has('CashPayment')).toBe(true);
    expect(payment.expansions.has('BondPayment')).toBe(true);
    expect(findAllByCanonicalId(result.nodes, 'cdm.payment.CashPayment')).toHaveLength(1);
    expect(findAllByCanonicalId(result.nodes, 'cdm.payment.BondPayment')).toHaveLength(1);
    // Total: 1 Payment + 2 expanded children = 3.
    expect(result.nodes.size).toBe(3);
  });
});

describe('buildStructureGraph — Choice self-arm cycle protection (Codex P2)', () => {
  // Regression tests for the bug where a Choice with a self-referential arm
  // rendered differently depending on how it was reached:
  //
  //   - Choice-as-root: buildStructureGraph seeded path with root.id → self-arm
  //     was suppressed correctly.
  //   - Choice-as-arm-target: path contained only Data ancestors, NOT the Choice's
  //     own id → self-arm produced one bogus nested copy before terminating on
  //     the second recursion.
  //
  // The fix: expandChoiceArms now adds node.id to path BEFORE iterating arms,
  // matching walkAndExpand's convention.  Both entry paths now suppress self-arms.

  // Fixture: Data type Outer has one attribute `payment: Payment`.
  // Payment is a Choice with arms: CashPayment (Data, terminal) and Payment (self-ref).
  const selfRefChoiceFixture = {
    namespaces: [{ uri: 'cdm.trade' }],
    nodes: [
      {
        id: 'cdm.trade.Outer',
        $type: 'Data' as const,
        name: 'Outer',
        namespace: 'cdm.trade',
        attributes: [
          { name: 'payment', typeCall: { type: { $refText: 'Payment' } }, card: { inf: 1, sup: 1, unbounded: false } }
        ]
      },
      {
        id: 'cdm.trade.Payment',
        $type: 'Choice' as const,
        name: 'Payment',
        namespace: 'cdm.trade',
        choiceOptions: [
          { typeCall: { type: { $refText: 'CashPayment' } } },
          { typeCall: { type: { $refText: 'Payment' } } } // self-referential arm
        ]
      },
      {
        id: 'cdm.trade.CashPayment',
        $type: 'Data' as const,
        name: 'CashPayment',
        namespace: 'cdm.trade',
        attributes: [
          { name: 'amount', typeCall: { type: { $refText: 'number' } }, card: { inf: 1, sup: 1, unbounded: false } }
        ]
      }
    ]
  };

  it('Choice-as-arm-target: expanding the self-arm does not materialise a nested copy of the Choice', () => {
    // Step 1: expand Outer.payment so Payment materialises as a Choice node.
    // Step 2: expand the Payment self-arm on that Payment instance.
    // Expected: graph contains Outer + Payment + CashPayment; NO second Payment.
    const outerRfId = 'cdm.trade.Outer';
    const paymentInstanceId = `${outerRfId}::payment::cdm.trade.Payment`;

    const expansionMap = new Map([
      // Expand Outer.payment
      [
        expansionKey({
          namespaceUri: 'cdm.trade',
          typeId: 'Outer',
          attrName: 'payment',
          instancePath: [outerRfId]
        }),
        true as const
      ],
      // Expand the Payment self-arm on the materialised Payment instance
      [
        expansionKey({
          namespaceUri: 'cdm.trade',
          typeId: 'Payment',
          attrName: 'Payment',
          instancePath: [outerRfId, paymentInstanceId]
        }),
        true as const
      ]
    ]);

    const result = buildStructureGraph(selfRefChoiceFixture, {
      focusedTypeId: 'cdm.trade.Outer',
      expansionMap
    });

    // Payment appears exactly once — no nested second copy from the self-arm.
    const paymentInstances = findAllByCanonicalId(result.nodes, 'cdm.trade.Payment');
    expect(paymentInstances).toHaveLength(1);

    // The Payment Choice node must NOT have an expansion for the self-arm.
    const payment = result.nodes.get(paymentInstanceId) as StructureChoiceNode;
    expect(payment).toBeDefined();
    expect(payment.kind).toBe('choice');
    expect(payment.expansions.has('Payment')).toBe(false);

    // CashPayment is NOT expanded in this test (no key for it) — arms are visible
    // as chips but their expansion key is false, so no child materialises.
    expect(findAllByCanonicalId(result.nodes, 'cdm.trade.CashPayment')).toHaveLength(0);

    // Total: Outer + Payment = 2.
    expect(result.nodes.size).toBe(2);
  });

  it('Choice-as-root: expanding the self-arm does not materialise a nested copy (symmetric lock)', () => {
    // Focus Payment directly.  Expand the self-arm Payment.
    // Expected: graph contains only Payment; no nested second Payment.
    const rootInstanceId = 'cdm.trade.Payment';

    const expansionMap = new Map([
      [
        expansionKey({
          namespaceUri: 'cdm.trade',
          typeId: 'Payment',
          attrName: 'Payment',
          instancePath: [rootInstanceId]
        }),
        true as const
      ]
    ]);

    const result = buildStructureGraph(selfRefChoiceFixture, {
      focusedTypeId: 'cdm.trade.Payment',
      expansionMap
    });

    // Payment appears exactly once.
    const paymentInstances = findAllByCanonicalId(result.nodes, 'cdm.trade.Payment');
    expect(paymentInstances).toHaveLength(1);

    // Self-arm is suppressed: no expansion entry for 'Payment'.
    const payment = result.nodes.get(rootInstanceId) as StructureChoiceNode;
    expect(payment).toBeDefined();
    expect(payment.kind).toBe('choice');
    expect(payment.expansions.has('Payment')).toBe(false);

    // Total: only Payment root = 1.
    expect(result.nodes.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Record / TypeAlias attribute type-refs — display-completion of #303
// ---------------------------------------------------------------------------

describe('buildStructureGraph — Record / TypeAlias attribute classification (leaf, not expandable)', () => {
  // A user-defined record or typeAlias dropped onto a Data attribute's type
  // cell should display as the correct chip (Record / TypeAlias), NOT as
  // Enum or Unresolved.  They must remain leaves — no child node is
  // materialised even if the expansion key is set, because neither kind is
  // expandable.

  const fixtureRecordAlias = {
    namespaces: [{ uri: 'cdm.types' }],
    nodes: [
      {
        id: 'cdm.types.MyRec',
        $type: 'Record' as const,
        name: 'MyRec',
        namespace: 'cdm.types'
      },
      {
        id: 'cdm.types.MyAlias',
        $type: 'TypeAlias' as const,
        name: 'MyAlias',
        namespace: 'cdm.types'
      },
      {
        id: 'cdm.types.Foo',
        $type: 'Data' as const,
        name: 'Foo',
        namespace: 'cdm.types',
        attributes: [
          {
            name: 'd',
            typeCall: { type: { $refText: 'MyRec' } },
            card: { inf: 0, sup: 1, unbounded: false }
          },
          {
            name: 'a',
            typeCall: { type: { $refText: 'MyAlias' } },
            card: { inf: 0, sup: 1, unbounded: false }
          }
        ]
      }
    ]
  };

  it('classifies a Record-typed attribute as typeKind="Record" (was "Enum" before fix)', () => {
    const result = buildStructureGraph(fixtureRecordAlias, {
      focusedTypeId: 'cdm.types.Foo',
      expansionMap: new Map()
    });
    const foo = result.nodes.get('cdm.types.Foo') as StructureDataNode;
    const row = foo.rows.find((r) => r.attrName === 'd')!;
    expect(row.typeKind).toBe('Record');
  });

  it('classifies a TypeAlias-typed attribute as typeKind="TypeAlias" (was "Unresolved" or "Enum" before fix)', () => {
    const result = buildStructureGraph(fixtureRecordAlias, {
      focusedTypeId: 'cdm.types.Foo',
      expansionMap: new Map()
    });
    const foo = result.nodes.get('cdm.types.Foo') as StructureDataNode;
    const row = foo.rows.find((r) => r.attrName === 'a')!;
    expect(row.typeKind).toBe('TypeAlias');
  });

  it('does NOT materialise a child node for a Record-typed attribute (leaf — non-expandable)', () => {
    // Even if the expansion key is set, Record types must stay as leaves.
    const key = expansionKey({
      namespaceUri: 'cdm.types',
      typeId: 'Foo',
      attrName: 'd',
      instancePath: ['cdm.types.Foo']
    });
    const result = buildStructureGraph(fixtureRecordAlias, {
      focusedTypeId: 'cdm.types.Foo',
      expansionMap: new Map([[key, true]])
    });
    // Only the Foo Data node itself — no child for MyRec.
    expect(result.nodes.size).toBe(1);
    const foo = result.nodes.get('cdm.types.Foo') as StructureDataNode;
    expect(foo.expansions.size).toBe(0);
  });

  it('does NOT materialise a child node for a TypeAlias-typed attribute (leaf — non-expandable)', () => {
    const key = expansionKey({
      namespaceUri: 'cdm.types',
      typeId: 'Foo',
      attrName: 'a',
      instancePath: ['cdm.types.Foo']
    });
    const result = buildStructureGraph(fixtureRecordAlias, {
      focusedTypeId: 'cdm.types.Foo',
      expansionMap: new Map([[key, true]])
    });
    expect(result.nodes.size).toBe(1);
    const foo = result.nodes.get('cdm.types.Foo') as StructureDataNode;
    expect(foo.expansions.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Choice arm classification for Record / TypeAlias targets (PR #237 review)
// ---------------------------------------------------------------------------

describe('buildStructureGraph — choice arms referencing Record / TypeAlias (PR #237)', () => {
  // Before this fix, buildChoiceArm's ternary fell through to 'Enum' for any
  // $type not explicitly handled ('Data' | 'Choice'). Now that Record/TypeAlias
  // nodes appear in the adapter doc (attribute type-ref path added in #303),
  // a choice arm pointing to one would be mis-labelled. This suite pins the
  // correct classification and confirms both kinds remain leaves (isArmExpandable
  // only expands Data/Choice; no child node is materialised).

  const fixtureChoiceWithRecordAndAlias = {
    namespaces: [{ uri: 'cdm.types' }],
    nodes: [
      {
        id: 'cdm.types.MyRec',
        $type: 'Record' as const,
        name: 'MyRec',
        namespace: 'cdm.types'
      },
      {
        id: 'cdm.types.MyAlias',
        $type: 'TypeAlias' as const,
        name: 'MyAlias',
        namespace: 'cdm.types'
      },
      {
        id: 'cdm.types.Pick',
        $type: 'Choice' as const,
        name: 'Pick',
        namespace: 'cdm.types',
        choiceOptions: [{ typeCall: { type: { $refText: 'MyRec' } } }, { typeCall: { type: { $refText: 'MyAlias' } } }]
      }
    ]
  };

  it('classifies a Record arm as typeKind="Record" (not "Enum")', () => {
    const result = buildStructureGraph(fixtureChoiceWithRecordAndAlias, {
      focusedTypeId: 'cdm.types.Pick',
      expansionMap: new Map()
    });
    const pick = result.nodes.get('cdm.types.Pick') as StructureChoiceNode;
    expect(pick).toBeDefined();
    expect(pick.kind).toBe('choice');
    const arm = pick.options.find((o) => o.typeName === 'MyRec');
    expect(arm).toBeDefined();
    expect(arm!.typeKind).toBe('Record');
    expect(arm!.targetNodeId).toBe('cdm.types.MyRec');
  });

  it('classifies a TypeAlias arm as typeKind="TypeAlias" (not "Enum")', () => {
    const result = buildStructureGraph(fixtureChoiceWithRecordAndAlias, {
      focusedTypeId: 'cdm.types.Pick',
      expansionMap: new Map()
    });
    const pick = result.nodes.get('cdm.types.Pick') as StructureChoiceNode;
    const arm = pick.options.find((o) => o.typeName === 'MyAlias');
    expect(arm).toBeDefined();
    expect(arm!.typeKind).toBe('TypeAlias');
    expect(arm!.targetNodeId).toBe('cdm.types.MyAlias');
  });

  it('does NOT materialise a child node for a Record arm (leaf — isArmExpandable only expands Data/Choice)', () => {
    // Set the expansion key for the Record arm — the adapter must ignore it.
    const key = expansionKey({
      namespaceUri: 'cdm.types',
      typeId: 'Pick',
      attrName: 'MyRec',
      instancePath: ['cdm.types.Pick']
    });
    const result = buildStructureGraph(fixtureChoiceWithRecordAndAlias, {
      focusedTypeId: 'cdm.types.Pick',
      expansionMap: new Map([[key, true]])
    });
    // Only the Choice root itself — no child node for MyRec.
    expect(result.nodes.size).toBe(1);
    const pick = result.nodes.get('cdm.types.Pick') as StructureChoiceNode;
    expect(pick.expansions.size).toBe(0);
  });

  it('does NOT materialise a child node for a TypeAlias arm (leaf — isArmExpandable only expands Data/Choice)', () => {
    const key = expansionKey({
      namespaceUri: 'cdm.types',
      typeId: 'Pick',
      attrName: 'MyAlias',
      instancePath: ['cdm.types.Pick']
    });
    const result = buildStructureGraph(fixtureChoiceWithRecordAndAlias, {
      focusedTypeId: 'cdm.types.Pick',
      expansionMap: new Map([[key, true]])
    });
    expect(result.nodes.size).toBe(1);
    const pick = result.nodes.get('cdm.types.Pick') as StructureChoiceNode;
    expect(pick.expansions.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase C — Function as focused root
// ---------------------------------------------------------------------------

describe('buildStructureGraph — Function as focused root (Phase C)', () => {
  const fnFixture = {
    namespaces: [{ uri: 'cdm.calc' }],
    nodes: [
      {
        id: 'cdm.calc.FixedAmount',
        $type: 'Function' as const,
        name: 'FixedAmount',
        namespace: 'cdm.calc',
        inputs: [
          {
            name: 'notional',
            typeCall: { type: { $refText: 'number' } },
            card: { inf: 1, unbounded: false, sup: 1 }
          },
          {
            name: 'rate',
            typeCall: { type: { $refText: 'Rate' } },
            card: { inf: 0, unbounded: false, sup: 1 }
          }
        ],
        output: {
          name: 'amount',
          typeCall: { type: { $refText: 'Money' } },
          card: { inf: 1, unbounded: false, sup: 1 }
        },
        definition: 'Computes a fixed amount.',
        annotations: ['calculation'],
        conditions: [{ name: 'Positive', preview: 'amount > 0' }]
      },
      // A referenced Data node so the input/output types classify as Data (not Unresolved).
      { id: 'cdm.calc.Rate', $type: 'Data' as const, name: 'Rate', namespace: 'cdm.calc', attributes: [] },
      { id: 'cdm.calc.Money', $type: 'Data' as const, name: 'Money', namespace: 'cdm.calc', attributes: [] }
    ]
  };

  it('materializes inputs as rows and the output as a distinct row', () => {
    const result = buildStructureGraph(fnFixture, {
      focusedTypeId: 'cdm.calc.FixedAmount',
      expansionMap: new Map()
    });
    expect(result.rootNodeId).toBe('cdm.calc.FixedAmount');
    expect(result.nodes.size).toBe(1);
    const fn = result.nodes.get('cdm.calc.FixedAmount') as StructureFunctionNode;
    expect(fn.kind).toBe('function');
    expect(fn.name).toBe('FixedAmount');
    expect(fn.inputRows.map((r) => r.attrName)).toEqual(['notional', 'rate']);
    expect(fn.inputRows.map((r) => r.typeName)).toEqual(['number', 'Rate']);
    expect(fn.inputRows.map((r) => r.cardinality)).toEqual(['1..1', '0..1']);
    expect(fn.inputRows.map((r) => r.typeKind)).toEqual(['BasicType', 'Data']);
    expect(fn.outputRow?.attrName).toBe('amount');
    expect(fn.outputRow?.typeName).toBe('Money');
    expect(fn.outputRow?.cardinality).toBe('1..1');
    expect(fn.outputRow?.typeKind).toBe('Data');
  });

  it('forwards Phase-A meta (definition / annotations / conditions)', () => {
    const result = buildStructureGraph(fnFixture, {
      focusedTypeId: 'cdm.calc.FixedAmount',
      expansionMap: new Map()
    });
    const fn = result.nodes.get('cdm.calc.FixedAmount') as StructureFunctionNode;
    expect(fn.definition).toBe('Computes a fixed amount.');
    expect(fn.annotations).toEqual(['calculation']);
    expect(fn.conditions).toEqual([{ name: 'Positive', preview: 'amount > 0' }]);
  });

  it('materializes a function with no output and no inputs without crashing', () => {
    const result = buildStructureGraph(
      {
        namespaces: [{ uri: 'cdm.calc' }],
        nodes: [{ id: 'cdm.calc.Noop', $type: 'Function' as const, name: 'Noop', namespace: 'cdm.calc' }]
      },
      { focusedTypeId: 'cdm.calc.Noop', expansionMap: new Map() }
    );
    const fn = result.nodes.get('cdm.calc.Noop') as StructureFunctionNode;
    expect(fn.kind).toBe('function');
    expect(fn.inputRows).toEqual([]);
    expect(fn.outputRow).toBeUndefined();
  });

  it('filters out null input entries (partial-parse tolerance)', () => {
    const result = buildStructureGraph(
      {
        namespaces: [{ uri: 'cdm.calc' }],
        nodes: [
          {
            id: 'cdm.calc.Partial',
            $type: 'Function' as const,
            name: 'Partial',
            namespace: 'cdm.calc',
            inputs: [
              null,
              { name: 'x', typeCall: { type: { $refText: 'number' } }, card: { inf: 1, unbounded: false, sup: 1 } }
            ]
          }
        ]
      },
      { focusedTypeId: 'cdm.calc.Partial', expansionMap: new Map() }
    );
    const fn = result.nodes.get('cdm.calc.Partial') as StructureFunctionNode;
    expect(fn.inputRows.map((r) => r.attrName)).toEqual(['x']);
  });
});

describe('repeated namespace import aliases', () => {
  it('resolves separate namespaces sharing fpml without changing authored labels', () => {
    const doc = {
      namespaces: [{ uri: 'caller' }],
      nodes: [
        {
          id: 'caller.Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'caller',
          imports: [
            { importedNamespace: 'fpml.asset.*', namespaceAlias: 'fpml' },
            { importedNamespace: 'fpml.option.*', namespaceAlias: 'fpml' }
          ],
          attributes: [
            { name: 'asset', typeCall: 'fpml.Asset' },
            { name: 'exercise', typeCall: 'fpml.Exercise' }
          ]
        },
        { id: 'fpml.asset.Asset', $type: 'Data' as const, name: 'Asset', namespace: 'fpml.asset' },
        { id: 'fpml.option.Exercise', $type: 'Data' as const, name: 'Exercise', namespace: 'fpml.option' },
        { id: 'unrelated.Exercise', $type: 'Data' as const, name: 'Exercise', namespace: 'unrelated' }
      ]
    };
    const result = buildStructureGraph(doc, { focusedTypeId: 'caller.Trade', expansionMap: new Map() });
    const rows = (result.nodes.get('caller.Trade') as StructureDataNode).rows;
    expect(rows.map((row) => row.typeName)).toEqual(['fpml.Asset', 'fpml.Exercise']);
    expect(rows.map((row) => row.typeKind)).toEqual(['Data', 'Data']);
    expect(rows.map((row) => row.targetNodeId)).toEqual(['fpml.asset.Asset', 'fpml.option.Exercise']);
  });
});

describe.each(['Record', 'TypeAlias'] as const)('terminal %s reference identity', (kind) => {
  const target = { id: `model.types.Value#${kind}`, $type: kind, name: 'Value', namespace: 'model.types' };
  const attribute = {
    name: 'value',
    typeCall: { type: { $refText: 'types.Value' } },
    card: { inf: 0, sup: 1, unbounded: false }
  };
  const owner = {
    id: 'model.main.Owner#Data',
    $type: 'Data' as const,
    name: 'Owner',
    namespace: 'model.main',
    imports: [{ importedNamespace: 'model.types.*', namespaceAlias: 'types' }],
    attributes: [attribute]
  };
  const document = {
    namespaces: [{ uri: 'model.main' }, { uri: 'model.types' }],
    nodes: [{ ...target, id: 'unrelated.Value', namespace: 'unrelated' }, target, owner]
  };

  it('keeps the resolved declaration ID and namespace on an ordinary attribute', () => {
    const graph = buildStructureGraph(document, { focusedTypeId: owner.id, expansionMap: new Map() });
    const root = graph.nodes.get(graph.rootNodeId) as StructureDataNode;
    expect(root.rows[0]).toMatchObject({
      typeKind: kind,
      targetNodeId: target.id,
      targetNamespaceUri: target.namespace
    });
    expect(root.expansions.size).toBe(0);
  });

  it('keeps the target identity on inherited attributes', () => {
    const derived = {
      id: 'model.main.Child#Data',
      $type: 'Data' as const,
      name: 'Child',
      namespace: 'model.main',
      extends: 'Owner',
      attributes: []
    };
    const graph = buildStructureGraph(
      { ...document, nodes: [...document.nodes, derived] },
      { focusedTypeId: derived.id, expansionMap: new Map() }
    );
    const root = graph.nodes.get(graph.rootNodeId) as StructureBaseContainer;
    expect(root.baseRows[0]).toMatchObject({
      typeKind: kind,
      targetNodeId: target.id,
      targetNamespaceUri: target.namespace,
      isInherited: true
    });
    expect(root.expansions.size).toBe(0);
  });

  it('keeps the target identity on Function inputs and output', () => {
    const fn = {
      ...owner,
      id: 'model.main.Identity#RosettaFunction',
      $type: 'Function' as const,
      name: 'Identity',
      inputs: [attribute],
      output: { ...attribute, name: 'result' }
    };
    const graph = buildStructureGraph(
      { ...document, nodes: [...document.nodes, fn] },
      { focusedTypeId: fn.id, expansionMap: new Map() }
    );
    const root = graph.nodes.get(graph.rootNodeId) as StructureFunctionNode;
    for (const row of [...root.inputRows, root.outputRow]) {
      expect(row).toMatchObject({ typeKind: kind, targetNodeId: target.id, targetNamespaceUri: target.namespace });
    }
    expect(graph.nodes.size).toBe(1);
  });
});
