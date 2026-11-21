// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect, vi } from 'vitest';
import { URI, EmptyFileSystem, AstUtils } from 'langium';
import {
  type RuneDslIndexManager,
  createRuneDslServices,
  getExpressionScope,
  getExpressionPickerContext,
  BASICTYPES_ROSETTA,
  type RosettaModel
} from '../../src/index.js';

async function scope(source: string | string[], name: string, aliasIndex?: number) {
  const { RuneDsl } = createRuneDslServices();
  const shared = RuneDsl.shared;
  const docs = (Array.isArray(source) ? source : [source]).map((text, i) =>
    shared.workspace.LangiumDocumentFactory.fromString<RosettaModel>(text, URI.parse(`file:///scope-${i}.rosetta`))
  );
  for (const doc of docs) shared.workspace.LangiumDocuments.addDocument(doc);
  await shared.workspace.DocumentBuilder.build(docs, { validation: false, eagerLinking: true });
  const doc = docs.at(-1)!;
  expect(doc.parseResult.parserErrors).toEqual([]);
  const owner = doc.parseResult.value.elements.find(
    (e) => (e.$type === 'RosettaFunction' || e.$type === 'Data') && e.name === name
  )!;
  if (owner.$type !== 'RosettaFunction' && owner.$type !== 'Data') throw new Error('fixture owner');
  const expression =
    owner.$type === 'RosettaFunction'
      ? aliasIndex === undefined
        ? owner.operations[0]!.expression
        : owner.shortcuts[aliasIndex]!.expression
      : owner.conditions[0]!.expression;
  return getExpressionScope(expression, RuneDsl);
}

describe('authoritative expression scope descriptions', () => {
  it.each(['period', 'item'])('offers the scoped filter element %s and its inherited members', async (parameter) => {
    const { RuneDsl } = createRuneDslServices();
    const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString<RosettaModel>(
      `namespace filters
type Term:
 endDate date (1..1)
type Period extends Term:
 rate number (1..1)
func Active:
 inputs:
  period date (1..1)
  periods Period (0..*)
 output: result Period (0..*)
 set result: periods filter ${parameter === 'item' ? '' : parameter} [${parameter} -> endDate exists]
`,
      URI.parse('file:///filters.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([doc], { validation: false, eagerLinking: true });
    expect(doc.parseResult.parserErrors).toEqual([]);
    const owner = doc.parseResult.value.elements.find((node) => node.name === 'Active');
    if (owner?.$type !== 'RosettaFunction') throw new Error('fixture function');
    const filter = owner.operations[0]!.expression;
    if (filter.$type !== 'FilterOperation' || !filter.function?.body) throw new Error('fixture filter');
    const slot = filter.function.body;
    const context = getExpressionPickerContext(slot, RuneDsl, []);
    const local = context.entries.find((entry) => entry.name === parameter);
    expect(local).toMatchObject({ kind: 'local', canBrowse: true });
    if (parameter !== 'item') {
      const declaration = filter.function.parameters[0]!;
      expect(local?.declarationId).toBe(
        `${AstUtils.getDocument(declaration).uri.toString()}#${RuneDsl.workspace.AstNodeLocator.getAstNodePath(declaration)}`
      );
    }
    const members = getExpressionPickerContext(slot, RuneDsl, [local!.declarationId]).members;
    expect(members).toContainEqual(
      expect.objectContaining({ expressionText: `${parameter} -> endDate`, cardinality: '(1..1)' })
    );
  });
  it.each(['eligibility', 'reporting'])('links %s rule predicates to their inherited input fields', async (kind) => {
    const { RuneDsl } = createRuneDslServices();
    const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
    const basics = factory.fromString(BASICTYPES_ROSETTA, URI.parse('file:///basics.rosetta'));
    const doc = factory.fromString<RosettaModel>(
      `namespace test.rule_scope
type Parent:
 scalar number (0..1)
type Terms extends Parent:
 flag boolean (0..1)
type Decoy:
 scalar number (0..1)
 flag boolean (0..1)
${kind} rule Choose from Terms: required choice scalar, flag
${kind} rule OnlyFlag from Terms: flag only exists
reporting rule Shadow from Terms: [1, 2] extract flag [flag]
`,
      URI.parse('file:///rules.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([basics, doc]);
    expect(doc.parseResult.parserErrors).toEqual([]);
    expect(doc.references.filter((reference) => reference.error)).toEqual([]);
    const parent = doc.parseResult.value.elements.find((node) => node.name === 'Parent');
    const terms = doc.parseResult.value.elements.find((node) => node.name === 'Terms');
    for (const reference of doc.references.filter((reference) => ['scalar', 'flag'].includes(reference.$refText))) {
      if (reference.ref?.$type === 'ClosureParameter') expect(reference.ref.$container.$type).toBe('InlineFunction');
      else expect(reference.ref?.$container).toBe(reference.$refText === 'scalar' ? parent : terms);
    }
    const flags = doc.references.filter((reference) => reference.$refText === 'flag');
    expect(flags.some((reference) => reference.ref?.$type === 'ClosureParameter')).toBe(true);
    expect(doc.references.filter((reference) => ['scalar', 'flag'].includes(reference.$refText))).toHaveLength(4);
  });

  it.each(['functions', 'rules'])(
    'materializes unreferenced deferred %s once before describing their signatures',
    async (kind) => {
      const models = new Map<string, string>();
      const getModel = vi.fn((uri: string) => {
        const json = models.get(uri);
        return json === undefined ? undefined : RuneDsl.serializer.JsonSerializer.deserialize(json);
      });
      const consume = vi.fn((uri: string) => models.delete(uri));
      const { RuneDsl } = createRuneDslServices(EmptyFileSystem, { getModel, consume });
      const {
        LangiumDocumentFactory: factory,
        LangiumDocuments: documents,
        DocumentBuilder: builder
      } = RuneDsl.shared.workspace;
      const uri = URI.parse('file:///helpers.rosetta');
      const cacheServices = createRuneDslServices().RuneDsl;
      const cached = cacheServices.shared.workspace.LangiumDocumentFactory.fromString<RosettaModel>(
        kind === 'rules'
          ? `namespace helpers
eligibility rule IsPresent from int: item exists
reporting rule ReadAmount from int: item
eligibility rule AlwaysEligible: True
reporting rule ConstantFlag: True`
          : `namespace helpers
version "test"
library function Native(a int, b int) int
func Parent:
 inputs:
  a int (1..1)
  b int (1..1)
 output: result int (1..1)
 set result: a + b
func Derived extends Parent:
 set result: a`,
        uri
      );
      expect(cached.parseResult.parserErrors).toEqual([]);
      cacheServices.shared.workspace.LangiumDocuments.addDocument(cached);
      await cacheServices.shared.workspace.DocumentBuilder.build([cached], { validation: false, eagerLinking: true });
      models.set(uri.toString(), cacheServices.serializer.JsonSerializer.serialize(cached.parseResult.value));
      (RuneDsl.shared.workspace.IndexManager as RuneDslIndexManager).registerExports(
        uri,
        cached.parseResult.value.elements.map((node) => ({
          name: `helpers.${node.name}`,
          type: node.$type,
          path: RuneDsl.workspace.AstNodeLocator.getAstNodePath(node),
          documentUri: uri
        }))
      );
      const unusedUri = URI.parse('file:///unused.rosetta');
      (RuneDsl.shared.workspace.IndexManager as RuneDslIndexManager).registerExports(unusedUri, [
        { name: 'helpers.Unused', type: 'Data', path: '/elements@0', documentUri: unusedUri }
      ]);
      const doc = factory.fromString<RosettaModel>(
        `namespace test
version "test"
import helpers.*
func Use:
 output: result int (1..1)
 set result: 1`,
        URI.parse('file:///use.rosetta')
      );
      documents.addDocument(doc);
      await builder.build([doc], { validation: false, eagerLinking: true });
      expect(doc.parseResult.parserErrors).toEqual([]);
      expect(getModel).not.toHaveBeenCalled();
      expect(documents.hasDocument(uri)).toBe(false);
      const owner = doc.parseResult.value.elements[0]!;
      if (owner.$type !== 'RosettaFunction') throw new Error('fixture owner');
      const entries = getExpressionScope(owner.operations[0]!.expression, RuneDsl);
      const signatures =
        kind === 'rules'
          ? ([
              ['IsPresent', 1],
              ['ReadAmount', 1],
              ['AlwaysEligible', 0],
              ['ConstantFlag', 0]
            ] as const)
          : ([
              ['Native', 2],
              ['Parent', 2],
              ['Derived', 2]
            ] as const);
      for (const [name, argumentCount] of signatures) {
        expect(entries).toContainEqual(
          expect.objectContaining({ name: `helpers.${name}`, kind: 'callable', argumentCount })
        );
      }
      expect(getModel).toHaveBeenCalledExactlyOnceWith(uri.toString());
      expect(consume).toHaveBeenCalledExactlyOnceWith(uri.toString());
      expect(getExpressionScope(owner.operations[0]!.expression, RuneDsl)).toEqual(entries);
      expect(getModel).toHaveBeenCalledTimes(1);
      expect(documents.hasDocument(unusedUri)).toBe(false);
    }
  );

  it('uses the actual output name and exposes earlier aliases', async () => {
    const entries = await scope(
      'namespace test\nversion "test"\nfunc Convert:\n inputs: date int (1..1)\n output: adjustableOrRelativeDate int (1..1)\n alias earlier: date\n set adjustableOrRelativeDate: earlier',
      'Convert'
    );
    expect(entries).toContainEqual(expect.objectContaining({ name: 'adjustableOrRelativeDate', kind: 'output' }));
    expect(entries).toContainEqual(expect.objectContaining({ name: 'date', kind: 'input', cardinality: '(1..1)' }));
    expect(entries).toContainEqual(expect.objectContaining({ name: 'earlier', kind: 'alias' }));
  });

  it('uses the language service scope for inherited Data attributes', async () => {
    const entries = await scope(
      'namespace test\nversion "test"\ntype Base:\n inherited int (1..1)\ntype Child extends Base:\n own int (1..1)\n condition Valid: inherited = own',
      'Child'
    );
    expect(entries).toContainEqual(expect.objectContaining({ name: 'inherited', kind: 'attribute' }));
    expect(entries).toContainEqual(expect.objectContaining({ name: 'own', kind: 'attribute' }));
    expect(entries.every((e) => e.declarationId.length > 0)).toBe(true);
  });
  it('offers canonically resolved imported callables with their argument counts', async () => {
    const entries = await scope(
      [
        'namespace helpers\nversion "test"\nfunc Combine:\n inputs:\n  a int (1..1)\n  b int (1..1)\n output: total int (1..1)\n set total: a + b',
        'namespace test\nversion "test"\nimport helpers.*\nfunc Use:\n output: result int (1..1)\n set result: Combine(1, 2)'
      ],
      'Use'
    );
    expect(entries).toContainEqual(
      expect.objectContaining({ name: 'Combine', kind: 'callable', argumentCount: 2, argumentNames: ['a', 'b'] })
    );
  });

  it('includes Choice symbols from the authoritative language-service scope', async () => {
    const entries = await scope(
      `namespace test
version "test"
type Cash:
 amount int (1..1)
type Security:
 units int (1..1)
choice Asset:
 Cash
 Security
func Use:
 inputs: asset Asset (1..1)
 output: result Asset (1..1)
 set result: asset`,
      'Use'
    );
    expect(entries).toContainEqual(expect.objectContaining({ name: 'Asset', kind: 'choice' }));
  });

  it('counts external parameters and inherited inputs', async () => {
    const entries = await scope(
      `namespace test
version "test"
library function Native(a int, b int) int
func Parent:
 inputs:
  a int (1..1)
  b int (1..1)
 output: result int (1..1)
 set result: a + b
func Derived extends Parent:
 set result: a
func Use:
 output: result int (1..1)
 set result: Derived(1, 2)`,
      'Use'
    );
    expect(entries).toContainEqual(
      expect.objectContaining({ name: 'Native', kind: 'callable', argumentCount: 2, argumentNames: ['a', 'b'] })
    );
    expect(entries).toContainEqual(
      expect.objectContaining({ name: 'Derived', kind: 'callable', argumentCount: 2, argumentNames: ['a', 'b'] })
    );
  });

  it('resolves a dispatch signature from its declaration and scopes enum members', async () => {
    const entries = await scope(
      [
        'namespace split\nversion "test"\nenum Kind:\n Cash\n Credit\nfunc Compute:\n inputs:\n  kind Kind (1..1)\n  amount int (1..1)\n output: computed int (1..1)\n set computed: amount',
        'namespace split\nversion "test"\nfunc Compute(kind: Kind -> Cash):\n set computed: amount + 1'
      ],
      'Compute'
    );
    expect(entries).toContainEqual(expect.objectContaining({ name: 'amount', kind: 'input' }));
    expect(entries).toContainEqual(expect.objectContaining({ name: 'computed', kind: 'output' }));
  });

  it('does not offer the current alias or later aliases', async () => {
    const entries = await scope(
      'namespace test\nversion "test"\nfunc Use:\n output: result int (1..1)\n alias alphaAlias: 1\n alias betaAlias: alphaAlias + 1\n alias gammaAlias: betaAlias + 1\n set result: gammaAlias',
      'Use',
      1
    );
    expect(entries.filter((e) => e.kind === 'alias').map((e) => e.name)).toEqual(['alphaAlias']);
  });

  it('includes the expected enum members in a Data equality condition', async () => {
    const entries = await scope(
      'namespace test\nversion "test"\nenum Kind:\n Cash\n Credit\ntype Deal:\n kind Kind (1..1)\n condition Valid: kind = Cash',
      'Deal'
    );
    expect(entries).toContainEqual(expect.objectContaining({ name: 'Cash', kind: 'enum' }));
    expect(entries).toContainEqual(expect.objectContaining({ name: 'Credit', kind: 'enum' }));
  });
});
