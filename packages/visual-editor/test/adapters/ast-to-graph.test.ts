// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Unit tests for the AST → model adapter.
 *
 * Verifies correct mapping of Data, Choice, and Enum AST types
 * to ReactFlow nodes and edges.
 */

import { describe, it, expect } from 'vitest';
import { parse, createRuneDslServices, serializeRuneModel } from '@rune-langium/core';
import { astToModel } from '../../src/adapters/ast-to-model.js';
import { AST_TYPE_TO_NODE_TYPE } from '../../src/adapters/model-helpers.js';
import type { Dehydrated } from '../../src/types.js';
import type { Data, RosettaEnumeration } from '@rune-langium/core';
import {
  SIMPLE_INHERITANCE_SOURCE,
  CHOICE_MODEL_SOURCE,
  ENUM_MODEL_SOURCE,
  COMBINED_MODEL_SOURCE,
  DEEP_INHERITANCE_SOURCE,
  EMPTY_MODEL_SOURCE
} from '../helpers/fixture-loader.js';

describe('astToModel', () => {
  it.each([false, true])(
    'uses the unique split dispatch base regardless of file order, serialized=%s',
    async (serialized) => {
      const { RuneDsl } = createRuneDslServices();
      const sources = [
        'namespace test\nfunc Compute(kind: Kind -> Cash):\n set result: amount + 1',
        'namespace test\nfunc Compute:\n inputs: amount int (1..1)\n output: result int (1..1)\n set result: amount'
      ];
      const models = await Promise.all(
        sources.map(async (source) => {
          const { value, parserErrors } = await parse(source);
          expect(parserErrors).toEqual([]);
          return serialized ? JSON.parse(serializeRuneModel(RuneDsl.serializer.JsonSerializer, value)) : value;
        })
      );
      for (const order of [models, [...models].reverse()]) {
        const functions = astToModel(order).nodes.filter((node) => node.data.$type === 'RosettaFunction');
        expect(functions).toHaveLength(1);
        expect(functions[0]!.data).not.toHaveProperty('dispatchAttribute');
        expect(functions[0]!.data).not.toHaveProperty('$container');
        expect(functions[0]!.data).toMatchObject({ inputs: [{ name: 'amount' }] });
      }
      expect(astToModel([models[0]]).nodes[0]!.data).toHaveProperty('dispatchAttribute');
    }
  );

  describe('Data types', () => {
    it('creates nodes for Data types', async () => {
      const result = await parse(SIMPLE_INHERITANCE_SOURCE);
      const { nodes } = astToModel(result.value);

      const dataNodes = nodes.filter((n) => n.data.$type === 'Data');
      expect(dataNodes.length).toBeGreaterThanOrEqual(2);

      const tradeNode = dataNodes.find((n) => n.data.name === 'Trade');
      expect(tradeNode).toBeDefined();
      expect(tradeNode!.type).toBe('data');
      expect(tradeNode!.meta.namespace).toBe('test.model');
    });

    it('maps attributes with type and cardinality', async () => {
      const result = await parse(SIMPLE_INHERITANCE_SOURCE);
      const { nodes } = astToModel(result.value);

      const tradeNode = nodes.find((n) => n.data.name === 'Trade');
      expect(tradeNode).toBeDefined();

      const data = tradeNode!.data as Dehydrated<Data>;
      const tradeDateAttr = data.attributes.find((m) => m.name === 'tradeDate');
      expect(tradeDateAttr).toBeDefined();
      expect(tradeDateAttr!.typeCall?.type?.$refText).toBe('date');
      expect(tradeDateAttr!.card.inf).toBe(1);
    });

    it('creates extends edges for Data inheritance', async () => {
      const result = await parse(SIMPLE_INHERITANCE_SOURCE);
      const { edges } = astToModel(result.value);

      const extendsEdges = edges.filter((e) => e.data?.kind === 'extends');
      expect(extendsEdges.length).toBeGreaterThanOrEqual(1);

      // Trade extends Event
      const tradeExtendsEdge = extendsEdges.find((e) => e.id.includes('Trade') && e.id.includes('Event'));
      expect(tradeExtendsEdge).toBeDefined();
    });

    it('creates extends edges from Data types to Choice parents', async () => {
      const result = await parse(`
        namespace "test.choice-parent"
        version "1"

        choice AssetChoice:
          equity Equity (1..1)

        type Equity:
          ticker string (1..1)

        type Basket extends AssetChoice:
          name string (1..1)
      `);
      const { edges } = astToModel(result.value);

      expect(edges).toContainEqual(
        expect.objectContaining({
          source: 'test.choice-parent.Basket#Data',
          target: 'test.choice-parent.AssetChoice#Choice',
          data: { kind: 'extends' }
        })
      );
    });

    it('strips runtime-only AST fields from graph node data', async () => {
      const result = await parse(SIMPLE_INHERITANCE_SOURCE);
      const { nodes } = astToModel(result.value);

      const tradeNode = nodes.find((n) => n.data.name === 'Trade');
      expect(tradeNode).toBeDefined();

      expect(() => JSON.stringify(tradeNode!.data)).not.toThrow();
      expect(tradeNode!.data).not.toHaveProperty('$container');
      expect(tradeNode!.data.attributes[0]).not.toHaveProperty('$container');
      expect(tradeNode!.data.attributes[0]?.typeCall?.type).not.toHaveProperty('ref');
    });

    it('creates attribute-ref edges for type references', async () => {
      const result = await parse(SIMPLE_INHERITANCE_SOURCE);
      const { edges } = astToModel(result.value);

      const refEdges = edges.filter((e) => e.data?.kind === 'attribute-ref');
      // Trade.product -> Product should create a ref edge
      const productRefEdge = refEdges.find((e) => e.data?.label === 'product');
      expect(productRefEdge).toBeDefined();
    });
  });

  describe('Choice types', () => {
    it('creates nodes for Choice types', async () => {
      const result = await parse(CHOICE_MODEL_SOURCE);
      const { nodes } = astToModel(result.value);

      const choiceNodes = nodes.filter((n) => n.data.$type === 'Choice');
      expect(choiceNodes.length).toBe(1);

      const paymentChoice = choiceNodes[0];
      expect(paymentChoice!.data.name).toBe('PaymentType');
      expect(paymentChoice!.type).toBe('choice');
    });

    it('creates choice-option edges', async () => {
      const result = await parse(CHOICE_MODEL_SOURCE);
      const { edges } = astToModel(result.value);

      const optionEdges = edges.filter((e) => e.data?.kind === 'choice-option');
      expect(optionEdges.length).toBe(2);
    });
  });

  describe('Enum types', () => {
    it('creates nodes for Enumeration types', async () => {
      const result = await parse(ENUM_MODEL_SOURCE);
      const { nodes } = astToModel(result.value);

      const enumNodes = nodes.filter((n) => n.data.$type === 'RosettaEnumeration');
      expect(enumNodes.length).toBe(1);

      const currencyEnum = enumNodes[0];
      expect(currencyEnum!.data.name).toBe('CurrencyEnum');
      expect(currencyEnum!.type).toBe('enum');
    });

    it('maps enum values', async () => {
      const result = await parse(ENUM_MODEL_SOURCE);
      const { nodes } = astToModel(result.value);

      const currencyEnum = nodes.find((n) => n.data.name === 'CurrencyEnum');
      expect(currencyEnum).toBeDefined();

      const data = currencyEnum!.data as Dehydrated<RosettaEnumeration>;
      expect(data.enumValues).toHaveLength(3);

      const valueNames = data.enumValues.map((v) => v.name);
      expect(valueNames).toContain('USD');
      expect(valueNames).toContain('EUR');
      expect(valueNames).toContain('GBP');
    });
  });

  describe('Combined model', () => {
    it('creates nodes for all type kinds', async () => {
      const result = await parse(COMBINED_MODEL_SOURCE);
      const { nodes } = astToModel(result.value);

      const dataNodes = nodes.filter((n) => n.data.$type === 'Data');
      const choiceNodes = nodes.filter((n) => n.data.$type === 'Choice');
      const enumNodes = nodes.filter((n) => n.data.$type === 'RosettaEnumeration');

      expect(dataNodes.length).toBe(2); // Trade, Product
      expect(choiceNodes.length).toBe(1); // PaymentType
      expect(enumNodes.length).toBe(1); // CurrencyEnum
    });

    it('creates edges across type kinds', async () => {
      const result = await parse(COMBINED_MODEL_SOURCE);
      const { edges } = astToModel(result.value);

      // Trade.currency -> CurrencyEnum should be an attribute-ref edge
      const currencyEdge = edges.find((e) => e.data?.kind === 'attribute-ref' && e.data.label === 'currency');
      expect(currencyEdge).toBeDefined();

      // PaymentType -> Trade and PaymentType -> Product are choice-option edges
      const optionEdges = edges.filter((e) => e.data?.kind === 'choice-option');
      expect(optionEdges.length).toBe(2);
    });
  });

  describe('Deep inheritance', () => {
    it('creates chain of extends edges', async () => {
      const result = await parse(DEEP_INHERITANCE_SOURCE);
      const { edges } = astToModel(result.value);

      const extendsEdges = edges.filter((e) => e.data?.kind === 'extends');
      expect(extendsEdges.length).toBe(2); // Middle->Base, Leaf->Middle
    });
  });

  describe('Empty model', () => {
    it('returns empty nodes and edges', async () => {
      const result = await parse(EMPTY_MODEL_SOURCE);
      const { nodes, edges } = astToModel(result.value);

      expect(nodes).toHaveLength(0);
      expect(edges).toHaveLength(0);
    });
  });

  describe('Filters', () => {
    it('filters by type kind', async () => {
      const result = await parse(COMBINED_MODEL_SOURCE);
      const { nodes } = astToModel(result.value, {
        filters: { kinds: ['data'] }
      });

      expect(nodes.every((n) => AST_TYPE_TO_NODE_TYPE[n.data.$type] === 'data')).toBe(true);
    });

    it('filters by name pattern', async () => {
      const result = await parse(COMBINED_MODEL_SOURCE);
      const { nodes } = astToModel(result.value, {
        filters: { namePattern: 'Trade' }
      });

      expect(nodes.length).toBe(1);
      expect(nodes[0]!.data.name).toBe('Trade');
    });

    it('hides orphan nodes when hideOrphans is true', async () => {
      const result = await parse(COMBINED_MODEL_SOURCE);
      const { nodes: allNodes } = astToModel(result.value);
      const { nodes: filteredNodes } = astToModel(result.value, {
        filters: { hideOrphans: true }
      });

      expect(filteredNodes.length).toBeLessThanOrEqual(allNodes.length);
    });
  });

  describe('Multiple models', () => {
    it('merges nodes from multiple models', async () => {
      const result1 = await parse(SIMPLE_INHERITANCE_SOURCE);
      const result2 = await parse(ENUM_MODEL_SOURCE);
      const { nodes } = astToModel([result1.value, result2.value]);

      const dataNodes = nodes.filter((n) => n.data.$type === 'Data');
      const enumNodes = nodes.filter((n) => n.data.$type === 'RosettaEnumeration');

      expect(dataNodes.length).toBeGreaterThanOrEqual(2);
      expect(enumNodes.length).toBe(1);
    });
  });

  it('retains declarations that share a Rune name but have different kinds', async () => {
    const result = await parse(`
      namespace test
      type Shared:
        value string (1..1)
      type UsesShared:
        shared Shared (1..1)
      func Shared:
        inputs:
          value string (1..1)
        output: result Shared (1..1)
    `);

    const graph = astToModel(result.value);

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'test.Shared#Data', data: expect.objectContaining({ $type: 'Data' }) }),
        expect.objectContaining({
          id: 'test.Shared#RosettaFunction',
          data: expect.objectContaining({ $type: 'RosettaFunction' })
        })
      ])
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'test.UsesShared#Data', target: 'test.Shared#Data' }),
        expect.objectContaining({
          source: 'test.Shared#RosettaFunction',
          target: 'test.Shared#Data',
          data: expect.objectContaining({ label: 'output' })
        })
      ])
    );
  });

  describe('TypeAlias types', () => {
    it('creates a typeAlias node and a type-alias-ref edge to the target type', async () => {
      const source = `
        namespace test.aliases
        version "1.0.0"

        basicType string

        typeAlias ShortText: string
      `;
      const result = await parse(source);
      const { nodes, edges } = astToModel(result.value);

      const aliasNode = nodes.find((n) => n.data.$type === 'RosettaTypeAlias');
      expect(aliasNode).toBeDefined();
      expect(aliasNode!.data.name).toBe('ShortText');
      expect(aliasNode!.type).toBe('typeAlias');

      const aliasEdge = edges.find((e) => e.data?.kind === 'type-alias-ref');
      expect(aliasEdge).toBeDefined();
      expect(aliasEdge!.type).toBe('type-alias-ref');
      expect(aliasEdge!.source).toBe(aliasNode!.id);
      // Edge id should consistently use --type-alias-ref-- segment
      expect(aliasEdge!.id).toContain('--type-alias-ref--');
    });
  });

  describe('isReadOnly from document URI', () => {
    it('marks nodes as isReadOnly when model has a system:// URI', async () => {
      const result = await parse(
        `
        namespace com.rosetta.model
        version "1.0.0"

        basicType string
        basicType number
        basicType boolean
        basicType date
        basicType dateTime
        `,
        'system://com.rosetta.model/basictypes.rosetta'
      );
      const { nodes } = astToModel(result.value);

      expect(nodes.length).toBeGreaterThan(0);
      expect(nodes.every((n) => n.meta.isReadOnly === true)).toBe(true);
    });

    it('marks nodes as NOT isReadOnly when model has a regular URI', async () => {
      const result = await parse(SIMPLE_INHERITANCE_SOURCE, 'file:///workspace/model.rosetta');
      const { nodes } = astToModel(result.value);

      const dataNodes = nodes.filter((n) => n.data.$type === 'Data');
      expect(dataNodes.length).toBeGreaterThan(0);
      expect(dataNodes.every((n) => n.meta.isReadOnly === false)).toBe(true);
    });
  });
});

describe('file-local namespace aliases', () => {
  it('keeps different import bindings for declarations in the same namespace', async () => {
    const sources = [
      'namespace caller\nimport left.* as ref\ntype First:\n value ref.Target (0..1)\n',
      'namespace caller\nimport right.* as ref\ntype Second:\n value ref.Target (0..1)\n',
      'namespace left\ntype Target:\n value string (0..1)\n',
      'namespace right\ntype Target:\n value int (0..1)\n'
    ];
    const models = await Promise.all(sources.map(async (source) => (await parse(source)).value));
    const result = astToModel(models);
    expect(result.nodes.find((node) => node.id === 'caller.First#Data')?.meta.imports).toEqual([
      { importedNamespace: 'left.*', namespaceAlias: 'ref' }
    ]);
    expect(result.nodes.find((node) => node.id === 'caller.Second#Data')?.meta.imports).toEqual([
      { importedNamespace: 'right.*', namespaceAlias: 'ref' }
    ]);
    expect(
      result.edges.filter((edge) => edge.data?.kind === 'attribute-ref').map((edge) => [edge.source, edge.target])
    ).toEqual([
      ['caller.First#Data', 'left.Target#Data'],
      ['caller.Second#Data', 'right.Target#Data']
    ]);
  });
});
