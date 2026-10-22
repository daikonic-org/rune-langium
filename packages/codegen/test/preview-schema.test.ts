// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import { expandPreviewField, generatePreviewSchemas } from '../src/export.js';
import type { PreviewField } from '../src/types.js';

const skipIfNodeLt22 = it.skipIf(Number(process.versions.node.split('.')[0]) < 22);
const REAL_CDM_ADJUSTABLE_DATE_FIXTURES = [
  new URL('../../../.resources/cdm/base-datetime-enum.rosetta', import.meta.url),
  new URL('../../../.resources/cdm/base-datetime-type.rosetta', import.meta.url)
] as const;
const skipIfAdjustableDateFixturesUnavailable = it.skipIf(
  Number(process.versions.node.split('.')[0]) < 22 ||
    !REAL_CDM_ADJUSTABLE_DATE_FIXTURES.every((fixtureUrl) => existsSync(fixtureUrl))
);

async function parseModel(source: string) {
  const { RuneDsl } = createRuneDslServices();
  const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    source,
    URI.parse('inmemory:///preview-schema.rosetta')
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);
  const parseErrors = doc.parseResult.parserErrors.map((error) => error.message);
  expect(parseErrors).toEqual([]);
  return doc;
}

async function parseFixture(relativePath: string) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  return parseModel(source);
}

async function parseModels(sources: readonly string[]) {
  const { RuneDsl } = createRuneDslServices();
  const docs = sources.map((source, i) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      source,
      URI.parse(`inmemory:///preview-schema-${i}.rosetta`)
    )
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
  for (const doc of docs) {
    expect(doc.parseResult.parserErrors.map((error) => error.message)).toEqual([]);
  }
  return docs;
}

describe('FormPreviewSchema generation', () => {
  it('reports missing executable bodies without blocking implemented dispatch branches', async () => {
    const doc = await parseModel(`namespace test.capability
enum Kind: One
func External:
 inputs: amount number (1..1)
 output: result number (1..1)
func Ordinary:
 inputs: amount number (1..1)
 output: result number (1..1)
 set result: amount
func Dispatch:
 inputs: kind Kind (1..1)
 output: result number (1..1)
func Dispatch(kind: Kind -> One):
 set result: 1`);
    const schemas = generatePreviewSchemas(doc);
    expect(schemas.find((schema) => schema.title === 'External')?.executionUnavailable).toMatch(
      /No Rune implementation/
    );
    expect(schemas.find((schema) => schema.title === 'Ordinary')?.executionUnavailable).toBeUndefined();
    expect(schemas.find((schema) => schema.title === 'Dispatch')?.executionUnavailable).toBeUndefined();
  });

  it('recognizes unavailable implementations for segmented namespace names', async () => {
    const doc = await parseModel('namespace segmented.example\nfunc External:\n output: result number (1..1)\n');
    Object.assign(doc.parseResult.value, { name: { segments: ['segmented', 'example'] } });
    expect(generatePreviewSchemas(doc).find((schema) => schema.title === 'External')?.executionUnavailable).toMatch(
      /No Rune implementation/
    );
  });

  it('preserves declared symbol identities across namespaces, alias chains, collections and deferred bodies', async () => {
    const docs = await parseModels([
      `namespace symbols.a
typeAlias Amount: number
typeAlias Price: Amount
type Item: amount Price (1..1)
type Book: items Item (0..*)
choice Value: Price`,
      `namespace symbols.b
typeAlias Amount: number
type Item: amount Amount (1..1)`
    ]);
    const schemas = generatePreviewSchemas(docs, { maxDepth: 0 });
    const a = schemas.find((schema) => schema.targetId === 'symbols.a.Item')!;
    const b = schemas.find((schema) => schema.targetId === 'symbols.b.Item')!;
    expect(a.fields[0]?.typeSymbol).toBe('typeAlias:symbols.a.Price');
    expect(b.fields[0]?.typeSymbol).toBe('typeAlias:symbols.b.Amount');
    expect(schemas.find((schema) => schema.targetId === 'symbols.a.Price')!.fields[0]?.typeSymbol).toBe(
      'typeAlias:symbols.a.Price'
    );
    expect(schemas.find((schema) => schema.targetId === 'symbols.a.Value')!.fields[0]?.typeSymbol).toBe(
      'typeAlias:symbols.a.Price'
    );
    const book = schemas.find((schema) => schema.targetId === 'symbols.a.Book')!;
    const list = book.fields[0]!;
    if (list.kind !== 'array') throw new Error('Expected collection');
    const item = expandPreviewField(list.children[0], book.definitions);
    expect(item.typeSymbol).toBe('data:symbols.a.Item');
    expect(item.kind === 'object' && item.children[0]?.typeSymbol).toBe('typeAlias:symbols.a.Price');
  });

  it('preserves ISO date controls through aliases, collections, Choices and deferred objects', async () => {
    const doc = await parseModel(`namespace test.dates
typeAlias CalendarDate:
  date
type Schedule:
  day date (1..1)
  aliasDay CalendarDate (0..1)
  days CalendarDate (0..*)
  timestamp dateTime (0..1)
  next Schedule (0..1)
choice DateChoice:
  date
  string
`);
    const schemas = generatePreviewSchemas(doc);
    const schedule = schemas.find((schema) => schema.targetId === 'test.dates.Schedule')!;
    expect(schedule.fields[0]).toMatchObject({ kind: 'string', format: 'date' });
    expect(schedule.fields[1]).toMatchObject({ kind: 'string', format: 'date', required: false });
    expect(schedule.fields[2]).toMatchObject({ kind: 'array', children: [{ kind: 'string', format: 'date' }] });
    expect(schedule.fields[3]).toMatchObject({ format: 'dateTime' });
    const nested = expandPreviewField(schedule.fields[4]!, schedule.definitions);
    expect(nested.kind).toBe('object');
    if (nested.kind !== 'object') throw new Error('Expected Schedule object');
    expect(nested.children[0]).toMatchObject({ kind: 'string', format: 'date' });
    expect(schemas.find((schema) => schema.targetId === 'test.dates.CalendarDate')?.fields[0]).toMatchObject({
      kind: 'string',
      format: 'date'
    });
    expect(schemas.find((schema) => schema.targetId === 'test.dates.DateChoice')?.fields[0]).toMatchObject({
      kind: 'string',
      format: 'date',
      required: false
    });
  });
  it('carries all canonical temporal formats into function inputs, aliases and array elements', async () => {
    const doc = await parseModel(`namespace test.temporal
 typeAlias LocalStamp: dateTime
 func Echo:
  inputs:
   day date (1..1)
   clock time (1..1)
   local LocalStamp (0..1)
   zoned zonedDateTime (0..*)
  output: result date (1..1)
  set result: day
 `);
    const schema = generatePreviewSchemas(doc).find((entry) => entry.targetId === 'test.temporal.Echo')!;
    expect(schema.fields).toMatchObject([
      { format: 'date' },
      { format: 'time' },
      { format: 'dateTime' },
      { kind: 'array', children: [{ format: 'zonedDateTime' }] }
    ]);
  });
  it('expands serializable recursive definitions one level at a time without losing siblings', async () => {
    const doc = await parseModel(`namespace test.lazy
type Node:
 name string (1..1)
 child Node (0..1)
 children Node (0..*)
func Identity:
 inputs: node Node (1..1)
 output: result Node (1..1)
 set result: node
`);
    const schemas = generatePreviewSchemas(doc);
    for (const targetId of ['test.lazy.Node', 'test.lazy.Identity']) {
      const schema = structuredClone(schemas.find((s) => s.targetId === targetId)!);
      expect(schema.status).toBe('ready');
      expect(Object.keys(schema.definitions!)).toEqual(['test.lazy.Node']);
      let field = schema.fields.find((f) => f.path === 'child') ?? schema.fields[0]!;
      for (let depth = 0; depth < 8; depth++) {
        field = expandPreviewField(field, schema.definitions);
        expect(field.kind).toBe('object');
        if (field.kind !== 'object') throw new Error('Expected Node object');
        expect(field.children.map((child) => child.label)).toEqual(['Name', 'Child', 'Children']);
        const children = field.children[2]!;
        expect(children.kind).toBe('array');
        if (children.kind !== 'array') throw new Error('Expected Node collection');
        const item = expandPreviewField(children.children[0], schema.definitions);
        expect(item.kind === 'object' && item.children[0]?.path).toBe(`${field.path}.children[].name`);
        field = field.children[1]!;
      }
      expect(JSON.stringify(schema).length).toBeLessThan(16000);
    }
  });

  it('keeps nonrecursive objects beyond the eager depth cap available for expansion', async () => {
    const doc = await parseModel(`namespace test.deep
type A: b B (1..1)
type B: c C (1..1)
type C: d D (1..1)
type D: next Fifth (1..1)
type Fifth: f F (1..1)
type F: value string (1..1)
`);
    const [schema] = generatePreviewSchemas(doc, { targetId: 'test.deep.A', maxDepth: 0 });
    let field = schema!.fields[0]!;
    for (const path of ['b', 'b.c', 'b.c.d', 'b.c.d.next', 'b.c.d.next.f']) {
      expect(field.path).toBe(path);
      field = expandPreviewField(field, schema!.definitions);
      if (field.kind !== 'object') throw new Error('Expected nested object');
      field = field.children[0]!;
    }
    expect(field).toMatchObject({ path: 'b.c.d.next.f.value', kind: 'string' });
    expect(schema!.status).toBe('ready');
  });

  it('expands output-only recursive definitions in a serialized function schema', async () => {
    const doc = await parseModel(`namespace test.results
type Node:
 name string (1..1)
 child Node (0..1)
func Create:
 inputs: name string (1..1)
 output: result Node (1..1)
 set result: Node { name: name }
`);
    const [generated] = generatePreviewSchemas(doc, { targetId: 'test.results.Create' });
    const schema = JSON.parse(JSON.stringify(generated)) as NonNullable<typeof generated>;
    expect(schema.definitions?.['test.results.Node']).toBeDefined();
    let field = schema.result!;
    for (let depth = 0; depth < 5; depth++) {
      const expanded = expandPreviewField(field, schema.definitions);
      if (expanded.kind !== 'object') throw new Error('Expected output Node');
      expect(expanded.children[0]).toMatchObject({ path: `${field.path}.name`, kind: 'string' });
      field = expanded.children[1]!;
    }
  });

  it.each([false, true])(
    'uses inherited and dispatch signatures regardless of document order (reverse=%s)',
    async (reverse) => {
      const sources = [
        `namespace preview.base
enum Mode:
 First
 Second
func Base:
 inputs:
  amount int (1..1)
   [metadata scheme]
  values int (0..*)
   [metadata reference]
 output: result int (1..1)
 set result: amount
func Dispatch:
 inputs:
  mode Mode (1..1)
  amount int (1..1)
 output: result int (1..1)
 set result: amount
`,
        `namespace preview.base
func Dispatch(mode: Mode -> First):
 set result: amount + 1
`,
        `namespace preview.child
import preview.base.*
func Derived extends Base:
 set result: super(amount, values)
`
      ];
      const docs = await parseModels(reverse ? [...sources].reverse() : sources);
      const schemas = generatePreviewSchemas(docs);
      const derived = schemas.find((schema) => schema.targetId === 'preview.child.Derived')!;
      expect(derived.fields.map((field) => field.path)).toEqual(['amount', 'values']);
      expect(derived.fields[0]).toMatchObject({ kind: 'number', required: true });
      expect(derived.fields[1]).toMatchObject({ kind: 'array', children: [{ kind: 'number' }] });
      const baseUri = docs[reverse ? 2 : 0]!.uri.toString();
      expect(derived.sourceMap?.find((entry) => entry.fieldPath === 'amount')?.sourceUri).toBe(baseUri);
      const dispatch = schemas.find((schema) => schema.targetId === 'preview.base.Dispatch')!;
      expect(dispatch.fields.map((field) => field.path)).toEqual(['mode', 'amount']);
      expect(dispatch.fields[0]).toMatchObject({ kind: 'enum', enumValues: [{ value: 'First' }, { value: 'Second' }] });
    }
  );

  skipIfNodeLt22('serializes scalar, optional, array, enum, and nested fields', async () => {
    const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      enum Side:
        Buy displayName "Buy side"
        Sell

      type Party:
        name string (1..1)

      type Trade:
        id string (1..1)
        quantity int (0..1)
        tags string (0..*)
        side Side (1..1)
        party Party (1..1)
    `);

    const schemas = generatePreviewSchemas([doc]);
    const trade = schemas.find((schema) => schema.targetId === 'test.preview.Trade');

    expect(trade).toMatchObject({
      schemaVersion: 1,
      targetId: 'test.preview.Trade',
      title: 'Trade',
      status: 'ready'
    });
    expect(trade?.sourceMap).toEqual([
      {
        fieldPath: 'id',
        sourceUri: 'inmemory:/preview-schema.rosetta',
        sourceLine: 13,
        sourceChar: 9
      },
      {
        fieldPath: 'quantity',
        sourceUri: 'inmemory:/preview-schema.rosetta',
        sourceLine: 14,
        sourceChar: 9
      },
      {
        fieldPath: 'tags',
        sourceUri: 'inmemory:/preview-schema.rosetta',
        sourceLine: 15,
        sourceChar: 9
      },
      {
        fieldPath: 'side',
        sourceUri: 'inmemory:/preview-schema.rosetta',
        sourceLine: 16,
        sourceChar: 9
      },
      {
        fieldPath: 'party',
        sourceUri: 'inmemory:/preview-schema.rosetta',
        sourceLine: 17,
        sourceChar: 9
      },
      {
        fieldPath: 'party.name',
        sourceUri: 'inmemory:/preview-schema.rosetta',
        sourceLine: 10,
        sourceChar: 9
      }
    ]);
    expect(trade?.fields).toEqual([
      { path: 'id', label: 'Id', kind: 'string', required: true, typeSymbol: 'builtin:string' },
      {
        path: 'quantity',
        label: 'Quantity',
        typeSymbol: 'builtin:int',
        kind: 'number',
        required: false,
        cardinality: { min: 0, max: 1 }
      },
      {
        path: 'tags',
        label: 'Tags',
        kind: 'array',
        required: false,
        cardinality: { min: 0, max: 'unbounded' },
        children: [{ path: 'tags[]', label: 'Tags item', kind: 'string', required: true, typeSymbol: 'builtin:string' }]
      },
      {
        path: 'side',
        label: 'Side',
        typeSymbol: 'enum:test.preview.Side',
        kind: 'enum',
        required: true,
        enumValues: [
          { value: 'Buy', label: 'Buy side' },
          { value: 'Sell', label: 'Sell' }
        ]
      },
      {
        path: 'party',
        label: 'Party',
        typeSymbol: 'data:test.preview.Party',
        kind: 'object',
        referencedTypeFqn: 'test.preview.Party',
        required: true,
        children: [{ path: 'party.name', label: 'Name', kind: 'string', required: true, typeSymbol: 'builtin:string' }]
      }
    ]);
  });

  skipIfNodeLt22('preserves recursive objects as finite expandable references', async () => {
    const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Node:
        value string (1..1)
        child Node (0..1)
    `);

    const [node] = generatePreviewSchemas([doc], { maxDepth: 1 });

    expect(node?.targetId).toBe('test.preview.Node');
    expect(node?.status).toBe('ready');
    expect(node?.definitions?.['test.preview.Node']?.fields).toHaveLength(2);
    expect(node?.fields).toEqual([
      { path: 'value', label: 'Value', kind: 'string', required: true, typeSymbol: 'builtin:string' },
      {
        path: 'child',
        label: 'Child',
        typeSymbol: 'data:test.preview.Node',
        kind: 'object',
        definitionId: 'test.preview.Node',
        referencedTypeFqn: 'test.preview.Node',
        children: [],
        required: false,
        cardinality: { min: 0, max: 1 }
      }
    ]);
  });

  skipIfNodeLt22(
    'detects a cross-namespace mutual reference cycle from BOTH entry points, not just whichever side happens to revisit itself in its own walk',
    async () => {
      // Party <-> Identifier is exactly the shape found live in production
      // (task #34 follow-up): two types in DIFFERENT namespaces reference
      // each other, and Form Preview generates each as its OWN top-level
      // target (a separate options.targetId call per user selection), so
      // each walk starts with a FRESH seenTypes containing only itself and
      // never revisits the other side within the SAME walk. The local
      // seenTypes guard alone can never catch this — it only fires when a
      // walk revisits a type it has ALREADY passed through, and neither
      // walk here ever passes through itself twice. Before this fix, one
      // (or both) sides fell through to `unresolved-reference` instead of
      // any cycle-aware tag purely because of which type happened to be
      // generated first — a whole-graph precomputed cyclicTypes set
      // (Tarjan's SCC via cycle-detector.ts, reused from the real emitter
      // pipeline) is required to catch it consistently from both sides.
      // `cyclic-type:<name>` (not `recursive-reference:<name>`) is the tag
      // that reflects this whole-graph knowledge — see FieldContext.
      // cyclicTypes' doc comment: `recursive-reference` is reserved for an
      // occurrence that was ACTUALLY truncated (a real `seenTypes` repeat),
      // which for a top-level Identifier/Party walk is always the type's
      // own SECOND encounter (Identifier's `issuedBy` grandchild, or
      // Party's respectively) — not the other side.
      const docs = await parseModels([
        `
          namespace test.mutualcycle.a
          version "1"

          import test.mutualcycle.b.*

          type Identifier:
            issuerReference test.mutualcycle.b.Party (0..1)
        `,
        `
          namespace test.mutualcycle.b
          version "1"

          import test.mutualcycle.a.*

          type Party:
            issuedBy test.mutualcycle.a.Identifier (0..1)
        `
      ]);

      const [identifierSchema] = generatePreviewSchemas(docs, { targetId: 'test.mutualcycle.a.Identifier' });
      const [partySchema] = generatePreviewSchemas(docs, { targetId: 'test.mutualcycle.b.Party' });

      expect(identifierSchema?.unsupportedFeatures).toContain('cyclic-type:Party');
      expect(identifierSchema?.unsupportedFeatures).not.toContain('unresolved-reference:Party');
      expect(partySchema?.unsupportedFeatures).toContain('cyclic-type:Identifier');
      expect(partySchema?.unsupportedFeatures).not.toContain('unresolved-reference:Identifier');
    }
  );

  skipIfNodeLt22(
    "preserves a cyclic type's first, still-safe-to-expand fields instead of cutting expansion on mere cycle membership (Codex PR #459 review)",
    async () => {
      // A.b -> B, B.bValue (a plain field) + B.a -> A (the actual cycle).
      // cyclicTypes correctly flags BOTH A and B as cycle members (see the
      // cross-namespace test above), but that set must only ADD the
      // informational `cyclic-type` diagnostic — never gate expansion by
      // itself. Gating on cyclicTypes membership cut `b` entirely on its
      // FIRST, still-safe encounter (before B was ever added to
      // `seenTypes`), silently dropping the legitimate sibling field
      // `b.bValue`. Only an ACTUAL path-local repeat (`seenTypes`) or the
      // depth cap may cut expansion and add the DISTINCT
      // `recursive-reference` tag; `b.a` — the real repeat — is the one
      // that gets cut, while `b` itself only ever earns the informational
      // `cyclic-type:B` tag (round 2 of this same Codex review: conflating
      // the two tags made Studio's summary falsely report a fully-expanded
      // `b` as "skipped").
      const docs = await parseModels([
        `
          namespace test.cyclicexpansion
          version "1"

          type A:
            b B (0..1)

          type B:
            bValue string (0..1)
            a A (0..1)
        `
      ]);

      const [schema] = generatePreviewSchemas(docs, { targetId: 'test.cyclicexpansion.A' });
      const bField = schema?.fields.find((f) => f.path === 'b');

      expect(bField?.kind).toBe('object');
      const bChildren = bField && 'children' in bField ? bField.children : undefined;
      expect(bChildren?.map((c) => c.path)).toContain('b.bValue');
      const bValueField = bChildren?.find((c) => c.path === 'b.bValue');
      expect(bValueField?.kind).toBe('string');
      const bAField = bChildren?.find((c) => c.path === 'b.a');
      expect(bAField).toMatchObject({ kind: 'object', definitionId: 'test.cyclicexpansion.A' });
      expect(schema?.unsupportedFeatures).toContain('cyclic-type:B');
      expect(schema?.unsupportedFeatures).not.toContain('recursive-reference:B');
      expect(schema?.status).toBe('ready');
    }
  );

  skipIfNodeLt22(
    'an inheritance-only cycle (A extends B, B extends A) does not falsely flip status to unsupported (Codex PR #459 review, round 3)',
    async () => {
      // `buildTypeReferenceGraph` adds an edge for EVERY `extends` clause,
      // so a circular extends chain (malformed, but Studio builds
      // documents with validation disabled, so it can still reach Form
      // Preview) makes cyclicTypes flag both A and B even though
      // `collectInheritedAttributes`'s own extends-chain `visited` guard
      // resolves it silently — nothing is ever actually truncated. `A`'s
      // sole unsupportedFeatures entry is the informational `cyclic-type:A`
      // tag; `hasReportableUnsupportedFeature` must exclude it from the
      // 'ready'/'unsupported' status determination, or a fully-successful
      // schema reads as broken.
      const docs = await parseModels([
        `
          namespace test.extendscycle
          version "1"

          type Container:
            contained A (0..1)

          type A extends B:
            aValue string (0..1)

          type B extends A:
            bValue string (0..1)
        `
      ]);

      const [schema] = generatePreviewSchemas(docs, { targetId: 'test.extendscycle.Container' });

      expect(schema?.status).toBe('ready');
      expect(schema?.unsupportedFeatures ?? []).toEqual(
        (schema?.unsupportedFeatures ?? []).filter((f) => f.startsWith('cyclic-type:'))
      );
      const containedField = schema?.fields.find((f) => f.path === 'contained');
      const containedChildren = containedField && 'children' in containedField ? containedField.children : undefined;
      expect(containedChildren?.map((c) => c.path).sort()).toEqual(['contained.aValue', 'contained.bValue']);
    }
  );

  skipIfNodeLt22(
    'does not spuriously block expansion when two DIFFERENT types in different namespaces share a bare simple name (issue #436)',
    async () => {
      // The `seenTypes` recursion guard previously keyed by bare `.name`
      // alone. `trade.Observable` referencing the UNRELATED
      // `asset.Observable` (same simple name, different namespace, no
      // actual cycle) used to trip the guard the moment the outer schema
      // being generated was ALSO named `Observable` — the guard seeds
      // itself with the outer type's own bare name, so a same-named nested
      // reference reads as "already seen" even though it's a distinct type.
      const docs = await parseModels([
        `
          namespace test.crossns.asset
          version "1"

          type Observable:
            value number (1..1)
        `,
        `
          namespace test.crossns.trade
          version "1"

          import test.crossns.asset.*

          type Observable:
            name string (1..1)
            linked test.crossns.asset.Observable (0..1)
        `
      ]);

      const schemas = generatePreviewSchemas(docs);
      const tradeObservable = schemas.find((s) => s.targetId === 'test.crossns.trade.Observable');

      expect(tradeObservable?.status).toBe('ready');
      expect(tradeObservable?.unsupportedFeatures).toBeUndefined();
      expect(tradeObservable?.fields.find((f) => f.path === 'linked')).toMatchObject({
        kind: 'object',
        children: [{ path: 'linked.value', label: 'Value', kind: 'number', required: true }]
      });
    }
  );

  skipIfNodeLt22(
    "does not stop early walking an 'extends' chain through a same-simple-name ancestor in a different namespace (issue #436 follow-up)",
    async () => {
      // collectInheritedAttributes has its OWN separate `visited` cycle
      // guard (distinct from buildDataSchema/etc.'s `seenTypes`), which had
      // the identical bare-name-collision bug: `derived.Observable extends
      // base.Observable` (same simple name, different namespace) stopped
      // the walk after the FIRST link, silently dropping the base type's
      // inherited attributes — a structurally-invalid sample (missing a
      // required parent field) would have passed preview validation.
      const docs = await parseModels([
        `
          namespace test.crossns2.base
          version "1"

          type Observable:
            value number (1..1)
        `,
        `
          namespace test.crossns2.derived
          version "1"

          import test.crossns2.base.*

          type Observable extends test.crossns2.base.Observable:
            extra string (1..1)
        `
      ]);

      const schemas = generatePreviewSchemas(docs);
      const derivedObservable = schemas.find((s) => s.targetId === 'test.crossns2.derived.Observable');

      expect(derivedObservable?.status).toBe('ready');
      expect(derivedObservable?.fields.map((f) => f.path)).toEqual(['value', 'extra']);
    }
  );

  skipIfNodeLt22('can return one fully-qualified target schema by id', async () => {
    const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Same:
        value string (1..1)

      type Container:
        same Same (1..1)
    `);

    const schemas = generatePreviewSchemas([doc], { targetId: 'test.preview.Container' });

    expect(schemas.map((schema) => schema.targetId)).toEqual(['test.preview.Container']);
  });

  skipIfNodeLt22('covers all supported preview field kinds plus unknown fallback', async () => {
    const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      enum Side:
        Buy
        Sell

      type Party:
        name string (1..1)

      type Trade:
        tradeId string (1..1)
        quantity int (0..1)
        active boolean (0..1)
        side Side (1..1)
        party Party (1..1)
        aliases string (0..*)
        missing MissingType (0..1)
    `);

    const [trade] = generatePreviewSchemas([doc], { targetId: 'test.preview.Trade' });
    const kinds = new Set<string>();
    for (const field of trade?.fields ?? []) {
      kinds.add(field.kind);
      // Only 'object'/'array' PreviewField variants carry `children`.
      if (field.kind === 'object' || field.kind === 'array') {
        for (const child of field.children) {
          kinds.add(child.kind);
        }
      }
    }

    expect(Array.from(kinds).sort()).toEqual(['array', 'boolean', 'enum', 'number', 'object', 'string', 'unknown']);
    expect(trade?.unsupportedFeatures).toContain('unresolved-reference:MissingType');
  });

  skipIfNodeLt22('marks duplicate target ids as unsupported instead of silently overwriting', async () => {
    const first = await parseModel(`
      namespace "test.preview"
      version "1"

      type Trade:
        tradeId string (1..1)
    `);
    const second = await parseModel(`
      namespace "test.preview"
      version "1"

      type Trade:
        settlementDate string (0..1)
    `);

    const [trade] = generatePreviewSchemas([first, second], { targetId: 'test.preview.Trade' });

    expect(trade).toMatchObject({
      targetId: 'test.preview.Trade',
      status: 'unsupported',
      fields: [],
      unsupportedFeatures: ['duplicate-target:test.preview.Trade']
    });
  });

  /**
   * PR #470 final-review finding (2026-08-04) — `duplicateDataNames`
   * covered only the `Data` branch of `buildNamespaceIndexes`; a second
   * same-named `Choice` declaration silently overwrote the first in
   * `choiceByName`, with no diagnostic, unlike the `Data` case just above.
   */
  skipIfNodeLt22('marks duplicate Choice target ids as unsupported instead of silently overwriting', async () => {
    const first = await parseModel(`
      namespace "test.previewChoice"
      version "1"

      type Cash:
        amount number (0..1)

      choice Asset:
        Cash
    `);
    const second = await parseModel(`
      namespace "test.previewChoice"
      version "1"

      type Commodity:
        quantity number (0..1)

      choice Asset:
        Commodity
    `);

    const [asset] = generatePreviewSchemas([first, second], { targetId: 'test.previewChoice.Asset' });

    expect(asset).toMatchObject({
      targetId: 'test.previewChoice.Asset',
      status: 'unsupported',
      fields: [],
      unsupportedFeatures: ['duplicate-target:test.previewChoice.Asset']
    });
  });

  skipIfAdjustableDateFixturesUnavailable(
    'generates a stable preview schema for the real CDM AdjustableDate type',
    async () => {
      const enumDoc = await parseFixture('../../../.resources/cdm/base-datetime-enum.rosetta');
      const typeDoc = await parseFixture('../../../.resources/cdm/base-datetime-type.rosetta');

      const [adjustableDate] = generatePreviewSchemas([enumDoc, typeDoc], {
        targetId: 'cdm.base.datetime.AdjustableDate'
      });

      expect(adjustableDate).toMatchObject({
        targetId: 'cdm.base.datetime.AdjustableDate',
        title: 'AdjustableDate'
      });
      expect(adjustableDate?.fields.map((field) => field.path)).toEqual([
        'unadjustedDate',
        'dateAdjustments',
        'dateAdjustmentsReference',
        'adjustedDate'
      ]);
      expect(adjustableDate?.fields.find((field) => field.path === 'dateAdjustments')).toMatchObject({
        kind: 'object'
      });
    }
  );

  // ── T037: Type Alias Preview ─────────────────────────────────────────────

  skipIfNodeLt22('generates a scalar field for a primitive type alias (typeAlias)', async () => {
    const doc = await parseModel(`
        namespace "test.preview"
        version "1"

        typeAlias ProductCode:
          string
      `);

    const schemas = generatePreviewSchemas([doc]);
    const alias = schemas.find((s) => s.targetId === 'test.preview.ProductCode');

    expect(alias).toMatchObject({
      schemaVersion: 1,
      kind: 'typeAlias',
      targetId: 'test.preview.ProductCode',
      title: 'ProductCode',
      status: 'ready'
    });
    expect(alias?.fields).toEqual([
      {
        path: 'value',
        label: 'Product Code',
        kind: 'string',
        required: true,
        typeSymbol: 'typeAlias:test.preview.ProductCode'
      }
    ]);
  });

  skipIfNodeLt22('generates object fields for a data-type alias (typeAlias referencing a type)', async () => {
    const doc = await parseModel(`
        namespace "test.preview"
        version "1"

        type Address:
          street string (1..1)
          city string (1..1)

        typeAlias BillingAddress:
          Address
      `);

    const schemas = generatePreviewSchemas([doc]);
    const alias = schemas.find((s) => s.targetId === 'test.preview.BillingAddress');

    expect(alias).toMatchObject({
      schemaVersion: 1,
      kind: 'typeAlias',
      targetId: 'test.preview.BillingAddress',
      title: 'BillingAddress',
      status: 'ready'
    });
    expect(alias?.fields.map((f) => f.path)).toEqual(['street', 'city']);
    expect(alias?.fields[0]).toMatchObject({ kind: 'string', required: true });
  });

  // ── T038: Choice Preview ─────────────────────────────────────────────────

  // ── T054: Function Preview ───────────────────────────────────────────────

  skipIfNodeLt22('generates a function schema with input fields (T054)', async () => {
    const doc = await parseModel(`
      namespace "test.funcpreview"
      version "1"

      func AddTwo:
        inputs:
          a number (1..1)
          b number (1..1)
        output:
          result number (1..1)
    `);

    const schemas = generatePreviewSchemas(doc);
    const funcSchema = schemas.find((s) => s.kind === 'function');

    expect(funcSchema).toBeDefined();
    expect(funcSchema!.title).toBe('AddTwo');
    expect(funcSchema!.targetId).toBe('test.funcpreview.AddTwo');
    expect(funcSchema!.status).toBe('ready');
    expect(funcSchema!.fields).toHaveLength(2);
    expect(funcSchema!.fields[0]!.label).toBe('A');
    expect(funcSchema!.fields[1]!.label).toBe('B');
  });

  skipIfNodeLt22('retains the referenced type identity for function object inputs', async () => {
    const doc = await parseModel(`
      namespace "test.funcidentity"
      version "1"

      type Party:
        name string (1..1)

      type CorporateParty extends Party:
        lei string (1..1)

      func Build:
        inputs:
          party Party (1..1)
          parties Party (0..*)
        output:
          result Party (1..1)
    `);

    const schema = generatePreviewSchemas([doc]).find((candidate) => candidate.targetId === 'test.funcidentity.Build');

    expect(schema?.fields).toMatchObject([
      {
        path: 'party',
        kind: 'object',
        referencedTypeFqn: 'test.funcidentity.Party',
        assignableTypeFqns: ['test.funcidentity.CorporateParty', 'test.funcidentity.Party']
      },
      {
        path: 'parties',
        kind: 'array',
        children: [
          {
            path: 'parties[]',
            kind: 'object',
            referencedTypeFqn: 'test.funcidentity.Party',
            assignableTypeFqns: ['test.funcidentity.CorporateParty', 'test.funcidentity.Party']
          }
        ]
      }
    ]);
    expect(schema?.functionOutput).toEqual({
      typeFqn: 'test.funcidentity.Party',
      kind: 'data',
      cardinality: { min: 1, max: 1 }
    });
  });

  skipIfNodeLt22('generates a choice schema with one field per option', async () => {
    const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Cash:
        amount number (1..1)

      type Securities:
        isin string (1..1)

      choice Collateral:
        Cash
        Securities
    `);

    const schemas = generatePreviewSchemas([doc]);
    const choice = schemas.find((s) => s.targetId === 'test.preview.Collateral');

    expect(choice).toMatchObject({
      schemaVersion: 1,
      kind: 'choice',
      targetId: 'test.preview.Collateral',
      title: 'Collateral',
      status: 'ready'
    });
    // `path` is the REAL emitted object key (lower-camel-cased, matching
    // `choiceOptionFieldName` — the same rule zod/json-schema/ts emitters
    // use for a Choice's actual generated schema), while `label` keeps the
    // original DSL casing for display.
    expect(choice?.fields.map((f) => f.path)).toEqual(['cash', 'securities']);
    expect(choice?.fields.map((f) => f.label)).toEqual(['Cash', 'Securities']);
    // Each option is required: false because only one may be chosen
    expect(choice?.fields.every((f) => f.required === false)).toBe(true);
    expect(choice?.fields.find((f) => f.path === 'cash')).toMatchObject({
      kind: 'object',
      label: 'Cash'
    });
    expect(choice?.fields.find((f) => f.path === 'securities')).toMatchObject({
      kind: 'object',
      label: 'Securities'
    });
  });

  skipIfNodeLt22(
    "choice option field 'path' uses the real emitted key (lower-camel), not the raw DSL casing",
    async () => {
      // Regression test (Codex round-3 finding #1): buildChoiceOptionField
      // previously set `path` from the raw DSL type-reference text
      // (`Cash`), which does NOT match what the real generated Zod/JSON
      // Schema/TypeScript emitters accept as the Choice arm's object key
      // (`cash`, per `choiceOptionFieldName` in base-namespace-emitter.ts).
      // An instance authored via the Prototype perspective and keyed by the
      // old `path` would fail to validate against the real generated
      // schema for the same model.
      const doc = await parseModel(`
        namespace "test.preview"
        version "1"

        type Cash:
          amount number (1..1)

        choice Collateral:
          Cash
      `);

      const schemas = generatePreviewSchemas([doc]);
      const choice = schemas.find((s) => s.targetId === 'test.preview.Collateral');

      expect(choice?.fields).toHaveLength(1);
      expect(choice?.fields[0]).toMatchObject({ path: 'cash', label: 'Cash' });
    }
  );

  skipIfNodeLt22(
    'choice option with a namespace-qualified type reference uses the RESOLVED node name for path/label, not the raw qualified $refText (issue #437)',
    async () => {
      // buildChoiceOptionField previously preferred the raw `$refText` over
      // the resolved node's bare `.name`. For an unqualified reference the
      // two coincide, masking the bug — a namespace-qualified reference
      // (`test.preview.Cash`) exposes it: the real emitters
      // (`emitChoiceSchema`'s `optionTypeRef?.ref?.name ?? ...`) always key
      // off the resolved node's bare name, so the preview must match.
      const doc = await parseModel(`
        namespace "test.preview"
        version "1"

        type Cash:
          amount number (1..1)

        choice Collateral:
          test.preview.Cash
      `);

      const schemas = generatePreviewSchemas([doc]);
      const choice = schemas.find((s) => s.targetId === 'test.preview.Collateral');

      expect(choice?.fields).toHaveLength(1);
      expect(choice?.fields[0]).toMatchObject({ path: 'cash', label: 'Cash' });
    }
  );

  skipIfNodeLt22('choice with unresolved option type produces unsupported status', async () => {
    const doc = await parseModel(`
        namespace "test.preview"
        version "1"

        choice Instrument:
          Bond
          Equity
      `);
    const schemas = generatePreviewSchemas(doc);
    const instrument = schemas.find((s) => s.targetId === 'test.preview.Instrument');
    expect(instrument).toBeDefined();
    expect(instrument!.fields.length).toBeGreaterThanOrEqual(0);
  });

  skipIfNodeLt22(
    'includes inherited fields from a Data supertype chain, not just the subtype own attributes',
    async () => {
      const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Base:
        id string (1..1)

      type Middle extends Base:
        note string (1..1)

      type Sub extends Middle:
        quantity int (0..1)
    `);

      const schemas = generatePreviewSchemas([doc], { targetId: 'test.preview.Sub' });
      const sub = schemas.find((schema) => schema.targetId === 'test.preview.Sub');

      expect(sub).toBeDefined();
      // Inherited fields (from Base and Middle) must be present alongside Sub's
      // own attribute — a bug here would silently pass validation on required
      // parent fields that were missing from an instance.
      expect(sub?.fields.map((field) => field.path).sort()).toEqual(['id', 'note', 'quantity']);
      expect(sub?.fields.find((field) => field.path === 'id')).toMatchObject({ kind: 'string', required: true });
      expect(sub?.fields.find((field) => field.path === 'note')).toMatchObject({ kind: 'string', required: true });
      // A plain Data-only schema (no Choice ancestor) must NOT carry
      // `choiceArmPaths` — round-9 finding #1 regression guard.
      expect(sub?.choiceArmPaths).toBeUndefined();
    }
  );

  skipIfNodeLt22(
    'includes Choice-ancestor option fields when a Data type extends a Choice (round-5 finding #1)',
    async () => {
      // Regression test: buildDataSchema previously only walked Data-to-Data
      // `extends` chains, silently dropping a Choice ancestor's options from
      // the generated FormPreviewSchema. Combined with preview-validator.ts's
      // `.strict()` validators (round-2 finding #1), a real, schema-valid
      // payload keyed by a Choice-derived field was rejected as an
      // "unrecognized key". `Commodity` (capitalized DSL name) intentionally
      // differs in casing from its real emitted field key (`commodity`, per
      // `choiceOptionFieldName`) so the test also proves the option field's
      // `path` is lower-camel-cased, not the raw DSL type-reference text.
      const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Commodity:
        name string (1..1)

      type Cash:
        amount number (1..1)

      choice Observable:
        Commodity
        Cash

      type BasketConstituent extends Observable:
        weight number (1..1)
    `);

      const schemas = generatePreviewSchemas([doc], { targetId: 'test.preview.BasketConstituent' });
      const basketConstituent = schemas.find((schema) => schema.targetId === 'test.preview.BasketConstituent');

      expect(basketConstituent).toBeDefined();
      // Both BasketConstituent's own attribute AND each Choice option's
      // (lower-camel) field must be present.
      expect(basketConstituent?.fields.map((field) => field.path).sort()).toEqual(['cash', 'commodity', 'weight']);
      expect(basketConstituent?.fields.find((field) => field.path === 'weight')).toMatchObject({
        kind: 'number',
        required: true
      });
      const commodityField = basketConstituent?.fields.find((field) => field.path === 'commodity');
      expect(commodityField).toMatchObject({ path: 'commodity', label: 'Commodity', kind: 'object', required: false });
      const cashField = basketConstituent?.fields.find((field) => field.path === 'cash');
      expect(cashField).toMatchObject({ path: 'cash', label: 'Cash', kind: 'object', required: false });
      // round-9 finding #1: `choiceArmPaths` marks which of `fields` are
      // Choice-ancestor-derived arms, so preview-validator.ts's "exactly one
      // arm present" enforcement can run for a Data-extends-Choice schema
      // (whose `kind` is NOT `'choice'`).
      expect(basketConstituent?.choiceArmPaths).toEqual(['commodity', 'cash']);
    }
  );

  skipIfNodeLt22(
    "a Data-extends-Choice schema's own attribute wins over a colliding inherited Choice option, flagged as unsupported (issue #435)",
    async () => {
      // Same collision as the typeAlias/nested-objectField regression tests
      // below, but exercised directly at buildDataSchema's own call site —
      // this is the exact scenario from the issue text: `Basket extends
      // Innermost` declares its own `cash string` attribute while
      // `Innermost` has a `Cash` option whose real emitted field key
      // (`choiceOptionFieldName('Cash')`) is also `cash`.
      const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Cash:
        amount number (1..1)

      type Commodity:
        symbol string (1..1)

      choice Innermost:
        Cash
        Commodity

      type Basket extends Innermost:
        cash string (1..1)
    `);

      const schemas = generatePreviewSchemas([doc], { targetId: 'test.preview.Basket' });
      const basket = schemas.find((schema) => schema.targetId === 'test.preview.Basket');

      expect(basket).toBeDefined();
      // The non-colliding Commodity option survives; the colliding Cash
      // option is dropped in favor of Basket's own `cash string` attribute.
      expect(basket?.fields.map((field) => field.path).sort()).toEqual(['cash', 'commodity']);
      expect(basket?.fields.find((field) => field.path === 'cash')).toMatchObject({
        kind: 'string',
        required: true
      });
      expect(basket?.choiceArmPaths).toEqual(['commodity']);
      expect(basket?.status).toBe('unsupported');
      expect(basket?.unsupportedFeatures).toContain('choice-arm-collision:cash');
    }
  );

  skipIfNodeLt22(
    'expands a Choice-typed attribute (as distinct from Data-extends-Choice) into one field per option (issue #394)',
    async () => {
      // Regression test for issue #394: buildBaseField had no branch for a
      // DIRECT Choice type reference (an attribute typed `variant:
      // Observable (1..1)`, not a Data type EXTENDING a Choice) — it fell
      // through to the unresolved-reference case and reported status
      // 'unsupported' with kind 'unknown', even though the Choice itself
      // was fully resolved and navigable elsewhere in the app. Mirrors
      // zod-emitter.ts's own prior "W2" fix for the identical gap in
      // resolveTypeExpr's isChoice branch.
      const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Commodity:
        name string (1..1)

      type Cash:
        amount number (1..1)

      choice Observable:
        Commodity
        Cash

      type Trade:
        variant Observable (1..1)
    `);

      const schemas = generatePreviewSchemas([doc], { targetId: 'test.preview.Trade' });
      const trade = schemas.find((schema) => schema.targetId === 'test.preview.Trade');

      expect(trade).toBeDefined();
      expect(trade?.status).toBe('ready');
      expect(trade?.unsupportedFeatures).toBeUndefined();
      const variantField = trade?.fields.find((field) => field.path === 'variant');
      expect(variantField).toMatchObject({ path: 'variant', label: 'Variant', kind: 'object', required: true });
      expect(variantField && 'children' in variantField ? variantField.children.map((c) => c.path).sort() : []).toEqual(
        ['variant.cash', 'variant.commodity']
      );
      // choiceArmPaths marks both arms so preview-validator.ts can enforce
      // "exactly one of variant.commodity / variant.cash present" — the
      // same enforcement the Data-extends-Choice case above gets.
      expect(variantField && 'choiceArmPaths' in variantField ? variantField.choiceArmPaths : undefined).toEqual([
        'variant.commodity',
        'variant.cash'
      ]);
    }
  );

  skipIfNodeLt22(
    'rewrites choiceArmPaths and Data-arm grandchild paths for a Choice-typed attribute with array cardinality (Codex review, PR #433)',
    async () => {
      // Regression test, round 1: asArrayItem rewrote a Choice-typed array
      // item's `children[].path` from `variant.arm` to `variant[].arm` but
      // left `choiceArmPaths` (spread via `...field`) pointing at the stale
      // pre-rewrite paths. preview-validator.ts's "exactly one arm present"
      // lookup then found no children matching the stale arm paths and
      // rejected every array item as if no arm were selected.
      //
      // Regression test, round 2: fixing round 1 with a one-level-only
      // children rewrite still left a Data-typed arm's OWN nested
      // attributes (a grandchild of the array item) at the stale
      // pre-rewrite path — `variants.commodity.name` instead of
      // `variants[].commodity.name` — pointing outside the rewritten array
      // item's subtree entirely and making that field impossible to
      // populate correctly. `Commodity`'s `name` attribute below is exactly
      // that grandchild.
      const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Commodity:
        name string (1..1)

      type Cash:
        amount number (1..1)

      choice Observable:
        Commodity
        Cash

      type Trade:
        variants Observable (0..*)
    `);

      const schemas = generatePreviewSchemas([doc], { targetId: 'test.preview.Trade' });
      const trade = schemas.find((schema) => schema.targetId === 'test.preview.Trade');

      expect(trade).toBeDefined();
      expect(trade?.status).toBe('ready');
      const variantsField = trade?.fields.find((field) => field.path === 'variants');
      expect(variantsField).toMatchObject({ path: 'variants', kind: 'array' });
      const item =
        variantsField && 'children' in variantsField ? (variantsField.children?.[0] as PreviewField) : undefined;
      expect(item).toMatchObject({ path: 'variants[]', kind: 'object' });
      const itemChildPaths = item && 'children' in item ? item.children?.map((c) => c.path).sort() : [];
      expect(itemChildPaths).toEqual(['variants[].cash', 'variants[].commodity']);
      // The round-1 bug: choiceArmPaths must match children[].path exactly,
      // not the pre-array-rewrite `variants.*` form.
      const itemArmPaths = item && 'choiceArmPaths' in item ? item.choiceArmPaths : undefined;
      expect(itemArmPaths?.slice().sort()).toEqual(['variants[].cash', 'variants[].commodity']);
      // The round-2 bug: the Commodity arm's OWN `name` attribute (a
      // grandchild of the array item) must also be rewritten.
      const commodityArm =
        item && 'children' in item ? item.children?.find((c) => c.path === 'variants[].commodity') : undefined;
      const commodityGrandchildPaths =
        commodityArm && 'children' in commodityArm ? commodityArm.children?.map((c) => c.path) : undefined;
      expect(commodityGrandchildPaths).toEqual(['variants[].commodity.name']);
    }
  );

  skipIfNodeLt22(
    'rewrites a Choice arm’s OWN nested array descendant through both container kinds (Codex review, PR #433 round 3)',
    async () => {
      // Regression test, round 3: rewritePathPrefix's round-2 fix recursed
      // through 'object' fields but explicitly stopped at 'array' fields —
      // a Data-typed Choice arm with its OWN nested array attribute
      // (`Commodity.legs (0..*)` below) had its array field's own path
      // rewritten (`variants.commodity.legs` → `variants[].commodity.legs`)
      // but never descended into the array's single item field, leaving
      // the deeper `[]`-suffixed path (`variants.commodity.legs[].price`)
      // stale — pointing outside the rewritten array item's subtree.
      const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Leg:
        price number (1..1)

      type Commodity:
        name string (1..1)
        legs Leg (0..*)

      choice Observable:
        Commodity

      type Trade:
        variants Observable (0..*)
    `);

      const schemas = generatePreviewSchemas([doc], { targetId: 'test.preview.Trade' });
      const trade = schemas.find((schema) => schema.targetId === 'test.preview.Trade');

      expect(trade).toBeDefined();
      expect(trade?.status).toBe('ready');
      const variantsField = trade?.fields.find((field) => field.path === 'variants');
      const item =
        variantsField && 'children' in variantsField ? (variantsField.children?.[0] as PreviewField) : undefined;
      const commodityArm =
        item && 'children' in item ? item.children?.find((c) => c.path === 'variants[].commodity') : undefined;
      const legsField =
        commodityArm && 'children' in commodityArm
          ? commodityArm.children?.find((c) => c.path === 'variants[].commodity.legs')
          : undefined;
      expect(legsField).toMatchObject({ path: 'variants[].commodity.legs', kind: 'array' });
      const legItem = legsField && 'children' in legsField ? (legsField.children?.[0] as PreviewField) : undefined;
      expect(legItem).toMatchObject({ path: 'variants[].commodity.legs[]', kind: 'object' });
      const legItemChildPaths = legItem && 'children' in legItem ? legItem.children?.map((c) => c.path) : undefined;
      expect(legItemChildPaths).toEqual(['variants[].commodity.legs[].price']);
    }
  );

  skipIfNodeLt22(
    'expands a doubly-nested Choice — a Choice option whose Data type itself extends another Choice (Codex review, PR #433 round 5)',
    async () => {
      // Regression test: this was a documented, deferred gap that predates
      // this PR — buildChoiceOptionField's Data-option branch discarded
      // collectInheritedAttributes' `choiceAncestor`, silently dropping the
      // inherited arms whenever a Choice OPTION's Data type itself extends
      // a DIFFERENT Choice. A preview sample could validate as complete
      // while the real emitted `runeExtendChoice` Zod schema rejects it for
      // missing the inherited arm, with no field offered to supply it.
      // Mirrors objectField's own choiceAncestor expansion.
      const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Commodity:
        name string (1..1)

      type Cash:
        amount number (1..1)

      choice Innermost:
        Commodity
        Cash

      type BasketConstituent extends Innermost:
        weight number (1..1)

      choice Observable:
        BasketConstituent

      type Trade:
        variant Observable (1..1)
    `);

      const schemas = generatePreviewSchemas([doc], { targetId: 'test.preview.Trade' });
      const trade = schemas.find((schema) => schema.targetId === 'test.preview.Trade');

      expect(trade).toBeDefined();
      expect(trade?.status).toBe('ready');
      const variantField = trade?.fields.find((field) => field.path === 'variant');
      const constituentArm =
        variantField && 'children' in variantField
          ? variantField.children?.find((c) => c.path === 'variant.basketConstituent')
          : undefined;
      expect(constituentArm).toMatchObject({ path: 'variant.basketConstituent', kind: 'object' });
      const constituentChildPaths =
        constituentArm && 'children' in constituentArm ? constituentArm.children?.map((c) => c.path).sort() : [];
      // BasketConstituent's own `weight` PLUS the inherited Innermost arms
      // (`commodity`/`cash`), all prefixed under `variant.basketConstituent`.
      expect(constituentChildPaths).toEqual([
        'variant.basketConstituent.cash',
        'variant.basketConstituent.commodity',
        'variant.basketConstituent.weight'
      ]);
      const constituentArmPaths =
        constituentArm && 'choiceArmPaths' in constituentArm ? constituentArm.choiceArmPaths : undefined;
      expect(constituentArmPaths?.slice().sort()).toEqual([
        'variant.basketConstituent.cash',
        'variant.basketConstituent.commodity'
      ]);
    }
  );

  skipIfNodeLt22(
    'marks an empty Choice-typed attribute as unsupported instead of a trivially-satisfiable object (Codex review, PR #433 round 6)',
    async () => {
      // Regression test: a Choice with zero options parses (the Rune
      // validator only warns), but the real emitted schema
      // (zod-emitter.ts's emitChoiceSchema) is `z.never()` for one — an
      // uninhabited type NO value can ever satisfy. Without this guard,
      // `children`/`choiceArmPaths` both came out empty and the field read
      // as a trivially-satisfiable required object accepting `{}`, the
      // opposite of "no valid value exists".
      const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      choice Impossible:

      type Trade:
        variant Impossible (1..1)
    `);

      const schemas = generatePreviewSchemas([doc], { targetId: 'test.preview.Trade' });
      const trade = schemas.find((schema) => schema.targetId === 'test.preview.Trade');

      expect(trade).toBeDefined();
      expect(trade?.status).toBe('unsupported');
      expect(trade?.unsupportedFeatures).toContain('empty-choice:Impossible');
      const variantField = trade?.fields.find((field) => field.path === 'variant');
      expect(variantField).toMatchObject({ path: 'variant', kind: 'unknown' });
    }
  );

  skipIfNodeLt22('marks an empty top-level Choice schema as unsupported (Codex review, PR #433 round 6)', async () => {
    const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      choice Impossible:
    `);

    const schemas = generatePreviewSchemas([doc], { targetId: 'test.preview.Impossible' });
    const impossible = schemas.find((schema) => schema.targetId === 'test.preview.Impossible');

    expect(impossible).toBeDefined();
    expect(impossible?.status).toBe('unsupported');
    expect(impossible?.fields).toEqual([]);
    expect(impossible?.unsupportedFeatures).toContain('empty-choice:Impossible');
  });

  skipIfNodeLt22(
    'includes Choice-ancestor option fields when a typeAlias resolves to a Data-extends-Choice type',
    async () => {
      // Regression test (follow-up to round-5 finding #1): buildTypeAliasSchema's
      // data-alias branch only destructured `.attributes` from
      // collectInheritedAttributes, silently dropping a Choice ancestor's
      // options — the same bug buildDataSchema had, but for a `typeAlias`
      // pointing at a Data-extends-Choice type instead of the Data type
      // itself. Both sit `fields` directly at the schema root, so the same
      // expansion applies unmodified.
      const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Commodity:
        name string (1..1)

      type Cash:
        amount number (1..1)

      choice Observable:
        Commodity
        Cash

      type BasketConstituent extends Observable:
        weight number (1..1)

      typeAlias BasketConstituentAlias:
        BasketConstituent
    `);

      const schemas = generatePreviewSchemas([doc], { targetId: 'test.preview.BasketConstituentAlias' });
      const alias = schemas.find((schema) => schema.targetId === 'test.preview.BasketConstituentAlias');

      expect(alias).toBeDefined();
      expect(alias?.fields.map((field) => field.path).sort()).toEqual(['cash', 'commodity', 'weight']);
      expect(alias?.fields.find((field) => field.path === 'weight')).toMatchObject({
        kind: 'number',
        required: true
      });
      const commodityField = alias?.fields.find((field) => field.path === 'commodity');
      expect(commodityField).toMatchObject({ path: 'commodity', label: 'Commodity', kind: 'object', required: false });
      const cashField = alias?.fields.find((field) => field.path === 'cash');
      expect(cashField).toMatchObject({ path: 'cash', label: 'Cash', kind: 'object', required: false });
      // round-9 finding #1: same `choiceArmPaths` expansion as buildDataSchema,
      // applied to the typeAlias data-alias branch.
      expect(alias?.choiceArmPaths).toEqual(['commodity', 'cash']);
    }
  );

  skipIfNodeLt22(
    "a typeAlias's Data-extends-Choice expansion keeps the Data type's own attribute on a name collision, and flags the collision as unsupported (issue #435)",
    async () => {
      // Mirrors buildDataSchema's collision precedence (round-5 finding #1
      // comment at its call site): when a Choice option's real emitted field
      // key collides with one of the Data type's own attribute names, the
      // Data type's own (more-derived) attribute wins and the Choice option
      // is dropped from `fields`/`choiceArmPaths`. The real emitted
      // `runeExtendChoice` schema merges the Data type's own attributes into
      // EVERY arm via `.extend()`, which replaces the colliding arm's
      // distinguishing type entirely — that arm no longer conveys "the Cash
      // option was selected" at all, so preview-validator.ts's "exactly one
      // arm present" check would silently under-constrain if the collision
      // weren't surfaced. `dropCollidingChoiceArmFields` now marks it
      // `unsupported` instead of dropping it silently.
      const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Cash:
        amount number (1..1)

      choice Observable:
        Cash

      type BasketConstituent extends Observable:
        cash string (1..1)

      typeAlias BasketConstituentAlias:
        BasketConstituent
    `);

      const schemas = generatePreviewSchemas([doc], { targetId: 'test.preview.BasketConstituentAlias' });
      const alias = schemas.find((schema) => schema.targetId === 'test.preview.BasketConstituentAlias');

      expect(alias).toBeDefined();
      expect(alias?.fields.map((field) => field.path)).toEqual(['cash']);
      // BasketConstituent's own `cash string` attribute wins over the Choice
      // option's `cash` object field.
      expect(alias?.fields.find((field) => field.path === 'cash')).toMatchObject({
        kind: 'string',
        required: true
      });
      expect(alias?.status).toBe('unsupported');
      expect(alias?.unsupportedFeatures).toContain('choice-arm-collision:cash');
    }
  );

  skipIfNodeLt22(
    'includes Choice-ancestor option fields, prefixed with the ambient path, on a NESTED Data-extends-Choice attribute',
    async () => {
      // Regression test (further follow-up to round-5 finding #1): objectField
      // (reached via buildBaseField for a nested Data-type attribute) only
      // destructured `.attributes` from collectInheritedAttributes, silently
      // dropping a Choice ancestor's options for a NESTED reference — unlike
      // buildDataSchema/buildTypeAliasSchema, whose `fields` sit at the schema
      // root, objectField's children must have the Choice option's `path`
      // prefixed with the ambient field path (e.g. `constituent.commodity`,
      // not bare `commodity`), or the option is mis-keyed against the real
      // generated (runeExtendChoice) schema for `Trade.constituent`.
      const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Commodity:
        name string (1..1)

      type Cash:
        amount number (1..1)

      choice Observable:
        Commodity
        Cash

      type BasketConstituent extends Observable:
        weight number (1..1)

      type Trade:
        constituent BasketConstituent (1..1)
    `);

      const schemas = generatePreviewSchemas([doc], { targetId: 'test.preview.Trade' });
      const trade = schemas.find((schema) => schema.targetId === 'test.preview.Trade');

      expect(trade).toBeDefined();
      const constituentField = trade?.fields.find((field) => field.path === 'constituent');
      expect(constituentField).toMatchObject({ path: 'constituent', kind: 'object', required: true });
      // Only 'object'/'array' PreviewField variants carry `children`.
      if (constituentField?.kind !== 'object') throw new Error('expected constituent field to be an object');
      expect(constituentField.children.map((child) => child.path).sort()).toEqual([
        'constituent.cash',
        'constituent.commodity',
        'constituent.weight'
      ]);
      const commodityChild = constituentField.children.find((child) => child.path === 'constituent.commodity');
      expect(commodityChild).toMatchObject({
        path: 'constituent.commodity',
        label: 'Commodity',
        kind: 'object',
        required: false
      });
      const cashChild = constituentField.children.find((child) => child.path === 'constituent.cash');
      expect(cashChild).toMatchObject({ path: 'constituent.cash', label: 'Cash', kind: 'object', required: false });
    }
  );

  skipIfNodeLt22('sets choiceArmPaths on a NESTED Data-extends-Choice object field (round-10 finding B)', async () => {
    // objectField already expands a Choice ancestor's options into
    // `children` (see the previous test), but the returned object field
    // carried no equivalent to FormPreviewSchema.choiceArmPaths — so
    // preview-validator.ts had no metadata to enforce "exactly one arm
    // present" for a NESTED object field the way it already does for a
    // top-level Data-extends-Choice schema (round-9 finding #1). Mirrors
    // that same pattern, scoped to the object field's own children.
    const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Commodity:
        name string (1..1)

      type Cash:
        amount number (1..1)

      choice Observable:
        Commodity
        Cash

      type BasketConstituent extends Observable:
        weight number (1..1)

      type Trade:
        constituent BasketConstituent (1..1)
    `);

    const schemas = generatePreviewSchemas([doc], { targetId: 'test.preview.Trade' });
    const trade = schemas.find((schema) => schema.targetId === 'test.preview.Trade');

    expect(trade).toBeDefined();
    const constituentField = trade?.fields.find((field) => field.path === 'constituent');
    // Only 'object'/'array' PreviewField variants carry `children`/`choiceArmPaths`.
    if (constituentField?.kind !== 'object') throw new Error('expected constituent field to be an object');
    expect(constituentField.choiceArmPaths?.slice().sort()).toEqual(['constituent.cash', 'constituent.commodity']);
  });

  skipIfNodeLt22(
    "a NESTED Data-extends-Choice expansion keeps the Data type's own attribute on a name collision",
    async () => {
      // Mirrors buildDataSchema's/buildTypeAliasSchema's collision precedence,
      // at the nested objectField call site: when a Choice option's real
      // emitted field key collides with one of the Data type's own attribute
      // names, the Data type's own (more-derived) attribute wins.
      const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Cash:
        amount number (1..1)

      choice Observable:
        Cash

      type BasketConstituent extends Observable:
        cash string (1..1)

      type Trade:
        constituent BasketConstituent (1..1)
    `);

      const schemas = generatePreviewSchemas([doc], { targetId: 'test.preview.Trade' });
      const trade = schemas.find((schema) => schema.targetId === 'test.preview.Trade');

      expect(trade).toBeDefined();
      const constituentField = trade?.fields.find((field) => field.path === 'constituent');
      // Only 'object'/'array' PreviewField variants carry `children`.
      if (constituentField?.kind !== 'object') throw new Error('expected constituent field to be an object');
      expect(constituentField.children.map((child) => child.path)).toEqual(['constituent.cash']);
      // BasketConstituent's own `cash string` attribute wins over the Choice
      // option's `cash` object field.
      expect(constituentField.children.find((child) => child.path === 'constituent.cash')).toMatchObject({
        kind: 'string',
        required: true
      });
      // The collision is flagged (issue #435) even though it's nested —
      // `ctx.unsupportedFeatures` is the SAME Set threaded through the
      // whole recursive expansion, so it surfaces on the top-level Trade
      // schema too, not just the constituent field.
      expect(trade?.status).toBe('unsupported');
      expect(trade?.unsupportedFeatures).toContain('choice-arm-collision:constituent.cash');
    }
  );

  skipIfNodeLt22(
    'rewrites a choice-arm-collision diagnostic path when the collision is nested inside an array-valued attribute (issue #435 round 2)',
    async () => {
      // rewritePathPrefix (used by asArrayItem to convert an array item's
      // whole subtree from `positions.constituent.cash` to
      // `positions[].constituent.cash`) only rewrites the returned FIELD
      // tree — the collision diagnostic was recorded separately into
      // ctx.unsupportedFeatures BEFORE that rewrite ran, so without
      // rewriteCollisionDiagnostics it would still name the stale,
      // non-array path, pointing consumers at a path that doesn't exist in
      // the returned schema.
      const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Cash:
        amount number (1..1)

      type Commodity:
        symbol string (1..1)

      choice Innermost:
        Cash
        Commodity

      type Basket extends Innermost:
        cash string (1..1)

      type Holder:
        constituent Basket (1..1)

      type Trade:
        positions Holder (0..*)
    `);

      const schemas = generatePreviewSchemas([doc], { targetId: 'test.preview.Trade' });
      const trade = schemas.find((schema) => schema.targetId === 'test.preview.Trade');

      expect(trade?.status).toBe('unsupported');
      expect(trade?.unsupportedFeatures).toContain('choice-arm-collision:positions[].constituent.cash');
      expect(trade?.unsupportedFeatures).not.toContain('choice-arm-collision:positions.constituent.cash');
    }
  );

  skipIfNodeLt22(
    'removes a descendant choice-arm-collision diagnostic when the whole subtree containing it is dropped by an OUTER collision (issue #435 round 3)',
    async () => {
      // Doubly-nested collision: the outer Choice option "Cash" resolves to
      // a Data type that itself extends ANOTHER Choice and has its OWN
      // inner collision ("foo" vs. InnerChoice's "Foo" option) — building
      // that "cash" object field records `choice-arm-collision:cash.foo`.
      // Then the OUTER Basket's own `cash string` attribute collides with
      // the outer "Cash" option itself, dropping the ENTIRE "cash" object
      // field (foo collision and all). Without removing the now-stale
      // descendant diagnostic, the returned schema would report a
      // collision at `cash.foo` even though nothing at that path exists —
      // the final `fields` only has Basket's own scalar `cash`.
      const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Foo:
        value string (1..1)

      choice InnerChoice:
        Foo

      type Cash extends InnerChoice:
        foo string (1..1)

      type Commodity:
        symbol string (1..1)

      choice Innermost:
        Cash
        Commodity

      type Basket extends Innermost:
        cash string (1..1)
    `);

      const schemas = generatePreviewSchemas([doc], { targetId: 'test.preview.Basket' });
      const basket = schemas.find((schema) => schema.targetId === 'test.preview.Basket');

      expect(basket?.status).toBe('unsupported');
      expect(basket?.fields.map((field) => field.path).sort()).toEqual(['cash', 'commodity']);
      expect(basket?.fields.find((field) => field.path === 'cash')).toMatchObject({ kind: 'string', required: true });
      expect(basket?.unsupportedFeatures).toContain('choice-arm-collision:cash');
      expect(basket?.unsupportedFeatures).not.toContain('choice-arm-collision:cash.foo');
    }
  );

  skipIfNodeLt22(
    "keeps a RETAINED field's own choice-arm-collision diagnostic when a DIFFERENT, discarded arm collides at the same path (issue #435 round 4)",
    async () => {
      // Distinct from round 3: there, the diagnostic under the dropped path
      // belonged to the discarded arm itself (a doubly-nested collision
      // inside the arm being thrown away). Here, Basket's OWN "cash"
      // attribute (type Wrapper, which extends InnerChoice and has its own
      // "foo" vs. InnerChoice's "Foo" option collision) records
      // `choice-arm-collision:cash.foo` FIRST, while attributeFields are
      // built — before OuterChoice's "Cash" option is even built. When that
      // outer "Cash" option (unrelated to Wrapper) then also collides with
      // Basket's own "cash" attribute name and gets dropped, a path-prefix
      // removal (the round-3 approach) can't tell "cash.foo" belongs to the
      // RETAINED Wrapper subtree apart from anything the discarded "Cash"
      // option itself might have recorded — and would incorrectly delete
      // it. Only diagnostics newly recorded while building the SPECIFIC
      // discarded option should be removed.
      const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Foo:
        value string (1..1)

      choice InnerChoice:
        Foo

      type Wrapper extends InnerChoice:
        foo string (1..1)

      type Cash:
        amount number (1..1)

      type Commodity:
        symbol string (1..1)

      choice OuterChoice:
        Cash
        Commodity

      type Basket extends OuterChoice:
        cash Wrapper (1..1)
    `);

      const schemas = generatePreviewSchemas([doc], { targetId: 'test.preview.Basket' });
      const basket = schemas.find((schema) => schema.targetId === 'test.preview.Basket');

      expect(basket?.status).toBe('unsupported');
      expect(basket?.fields.map((field) => field.path).sort()).toEqual(['cash', 'commodity']);
      expect(basket?.unsupportedFeatures).toContain('choice-arm-collision:cash');
      expect(basket?.unsupportedFeatures).toContain('choice-arm-collision:cash.foo');

      const cashField = basket?.fields.find((field) => field.path === 'cash');
      if (cashField?.kind !== 'object') throw new Error('expected cash field to be an object');
      expect(cashField.children.map((child) => child.path)).toEqual(['cash.foo']);
      expect(cashField.children.find((child) => child.path === 'cash.foo')).toMatchObject({
        kind: 'string',
        required: true
      });
    }
  );

  skipIfNodeLt22(
    "keeps a RETAINED field's own choice-arm-collision diagnostic when a discarded arm's UNRELATED array attribute happens to rewrite the same path prefix (issue #435 round 5)",
    async () => {
      // Distinct from round 4: there, the discarded arm's OWN build never
      // touched the retained diagnostic at all. Here, Basket's own "cash"
      // attribute (type Wrapper) has a nested Data-extends-Choice
      // collision at "cash.items.foo" — recorded while building
      // attributeFields, before the choice-options loop even starts. The
      // discarded "Cash" option ALSO happens to declare its own
      // array-valued, OBJECT-typed "items" attribute (nothing to do with
      // Wrapper's) — building it calls asArrayItem's `field.kind ===
      // 'object'` branch (the only branch that rewrites diagnostics; a
      // scalar array item can't itself contain a nested collision, so
      // asArrayItem doesn't bother rewriting for that case), which
      // rewrites any choice-arm-collision diagnostic under "cash.items" to
      // "cash.items[]". If that rewrite (or anything else the discarded
      // option's build does) can reach the RETAINED diagnostic at all —
      // e.g. by sharing the ambient unsupportedFeatures set instead of an
      // isolated one per option — the retained diagnostic gets renamed
      // away and then swept up as "new" when the option is dropped, with
      // nothing to restore it.
      const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Foo:
        value string (1..1)

      choice InnerChoice:
        Foo

      type ItemThing extends InnerChoice:
        foo string (1..1)

      type Wrapper:
        items ItemThing (1..1)

      type ItemsHolder:
        note string (1..1)

      type Cash:
        items ItemsHolder (0..*)

      type Commodity:
        symbol string (1..1)

      choice OuterChoice:
        Cash
        Commodity

      type Basket extends OuterChoice:
        cash Wrapper (1..1)
    `);

      const schemas = generatePreviewSchemas([doc], { targetId: 'test.preview.Basket' });
      const basket = schemas.find((schema) => schema.targetId === 'test.preview.Basket');

      expect(basket?.status).toBe('unsupported');
      expect(basket?.fields.map((field) => field.path).sort()).toEqual(['cash', 'commodity']);
      expect(basket?.unsupportedFeatures).toContain('choice-arm-collision:cash');
      expect(basket?.unsupportedFeatures).toContain('choice-arm-collision:cash.items.foo');
      expect(basket?.unsupportedFeatures).not.toContain('choice-arm-collision:cash.items[].foo');

      const cashField = basket?.fields.find((field) => field.path === 'cash');
      if (cashField?.kind !== 'object') throw new Error('expected cash field to be an object');
      const itemsField = cashField.children.find((child) => child.path === 'cash.items');
      if (itemsField?.kind !== 'object') throw new Error('expected cash.items field to be an object');
      expect(itemsField.children.map((child) => child.path)).toEqual(['cash.items.foo']);
    }
  );

  // ── Task 8: unified type-reference resolution ───────────────────────────

  skipIfNodeLt22(
    'resolves a field typed via a type-alias-to-primitive (the SignatureType/HMACOutputLengthType production bug)',
    async () => {
      const doc = await parseModel(`
        namespace "test.preview"
        version "1"

        typeAlias HMACOutputLengthType:
          int

        type SignatureMethodType:
          hmacOutputLength HMACOutputLengthType (0..1)
      `);

      const schemas = generatePreviewSchemas([doc]);
      const schema = schemas.find((s) => s.targetId === 'test.preview.SignatureMethodType')!;
      const field = schema.fields.find((f) => f.path === 'hmacOutputLength')!;

      expect(field.kind).toBe('number');
      expect(schema.status).toBe('ready');
      expect(schema.unsupportedFeatures).toBeUndefined();
    }
  );

  skipIfNodeLt22('resolves a field typed via a 2-hop type-alias chain to a Data type', async () => {
    const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type DigestValueType:
        x string (0..1)

      typeAlias DigestAliasInner:
        DigestValueType

      typeAlias DigestAlias:
        DigestAliasInner

      type Foo:
        bar DigestAlias (0..1)
    `);

    const schemas = generatePreviewSchemas([doc]);
    const schema = schemas.find((s) => s.targetId === 'test.preview.Foo')!;
    const field = schema.fields.find((f) => f.path === 'bar')!;

    expect(field.kind).toBe('object');
    expect(schema.status).toBe('ready');
  });

  skipIfNodeLt22('resolves a Choice option typed via a type-alias-to-primitive', async () => {
    const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      typeAlias AmountAlias:
        number

      choice Collateral:
        AmountAlias
    `);

    const schemas = generatePreviewSchemas([doc]);
    const choice = schemas.find((s) => s.targetId === 'test.preview.Collateral')!;

    expect(choice.status).toBe('ready');
    expect(choice.fields).toEqual([
      {
        path: 'amountAlias',
        label: 'AmountAlias',
        kind: 'number',
        required: false,
        typeSymbol: 'typeAlias:test.preview.AmountAlias'
      }
    ]);
  });

  skipIfNodeLt22('resolves a Choice option typed via a type-alias-to-Data', async () => {
    const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type DigestValueType:
        x string (0..1)

      typeAlias DigestAlias:
        DigestValueType

      choice Collateral:
        DigestAlias
    `);

    const schemas = generatePreviewSchemas([doc]);
    const choice = schemas.find((s) => s.targetId === 'test.preview.Collateral')!;

    expect(choice.status).toBe('ready');
    const field = choice.fields.find((f) => f.path === 'digestAlias');
    expect(field).toMatchObject({ kind: 'object', required: false });
    expect(field && 'children' in field ? field.children.map((c) => c.path) : []).toEqual(['digestAlias.x']);
  });

  skipIfNodeLt22(
    'resolves a Choice option typed as a namespace-qualified RosettaRecordType reference (buildChoiceOptionField previously only checked isRosettaBasicType)',
    async () => {
      // Unlike a bare `date` reference (whose raw $refText happens to
      // coincide with a BUILTIN_KIND_MAP key even when unlinked), a
      // namespace-qualified reference to a locally-declared recordType
      // forces Langium to actually LINK typeRef to the RosettaRecordType
      // node while $refText carries the full qualified path
      // ('test.preview.date'), which does NOT match any BUILTIN_KIND_MAP
      // key — so this only resolves if the isRosettaRecordType gap in
      // buildChoiceOptionField's typeRef-resolved branch is fixed.
      const doc = await parseModel(`
        namespace "test.preview"
        version "1"

        recordType date {
          value string
        }

        choice Collateral:
          test.preview.date
      `);

      const schemas = generatePreviewSchemas([doc]);
      const choice = schemas.find((s) => s.targetId === 'test.preview.Collateral')!;

      expect(choice.status).toBe('ready');
      expect(choice.fields).toEqual([
        { path: 'date', label: 'date', kind: 'string', format: 'date', required: false, typeSymbol: 'builtin:date' }
      ]);
    }
  );

  skipIfNodeLt22('resolves a Choice option typed as another named Choice', async () => {
    const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Leaf:
        value string (1..1)

      choice Inner:
        Leaf

      choice Outer:
        Inner
    `);

    const schemas = generatePreviewSchemas([doc]);
    const outer = schemas.find((s) => s.targetId === 'test.preview.Outer')!;

    expect(outer.status).toBe('ready');
    const innerField = outer.fields.find((f) => f.path === 'inner');
    expect(innerField).toMatchObject({ path: 'inner', label: 'Inner', kind: 'object', required: false });
    if (innerField?.kind !== 'object') throw new Error('expected inner field to be an object');
    expect(innerField.children.map((c) => c.path)).toEqual(['inner.leaf']);
    expect(innerField.children[0]).toMatchObject({ path: 'inner.leaf', label: 'Leaf', kind: 'object' });
    expect(innerField.choiceArmPaths).toEqual(['inner.leaf']);
  });

  skipIfNodeLt22(
    'cuts a mutual Choice-to-Choice cycle through the new onChoice branch instead of recursing forever',
    async () => {
      // CycleA's sole option is CycleB, CycleB's sole option is CycleA —
      // a genuine 2-hop cycle reachable ONLY through buildChoiceOptionField's
      // new onChoice branch (the previous test above exercises the same
      // branch but on a non-cyclic Outer->Inner->Leaf chain). Mirrors the
      // Data branch's own cycle-cut contract (lines ~159-184 above): the
      // SECOND encounter of a type already in `seenTypes` is cut with a
      // `kind: 'unknown'` field and a `recursive-reference:<name>` tag,
      // while the whole-graph `cyclicTypes` set additionally tags BOTH
      // members with the non-cutting, informational `cyclic-type:<name>`
      // tag (Codex PR #459 review) — same two-tag split as the Data branch.
      const doc = await parseModel(`
        namespace "test.preview"
        version "1"

        choice CycleA:
          CycleB

        choice CycleB:
          CycleA
      `);

      const schemas = generatePreviewSchemas([doc]);
      const cycleA = schemas.find((s) => s.targetId === 'test.preview.CycleA')!;

      // The call actually returns instead of stack-overflowing — a genuine
      // cycle through the new onChoice branch is cut, not infinitely walked.
      expect(cycleA.status).toBe('ready');
      expect(Object.keys(cycleA.definitions ?? {})).toEqual(
        expect.arrayContaining(['test.preview.CycleA', 'test.preview.CycleB'])
      );
      expect(cycleA.unsupportedFeatures).toContain('cyclic-type:CycleA');
      expect(cycleA.unsupportedFeatures).toContain('cyclic-type:CycleB');
      expect(cycleA.unsupportedFeatures).not.toContain('recursive-reference:CycleB');
      expect(cycleA.fields).toEqual([
        {
          path: 'cycleB',
          label: 'CycleB',
          typeSymbol: 'choice:test.preview.CycleB',
          kind: 'object',
          referencedTypeFqn: 'test.preview.CycleB',
          required: false,
          children: [
            {
              path: 'cycleB.cycleA',
              label: 'CycleA',
              typeSymbol: 'choice:test.preview.CycleA',
              kind: 'object',
              definitionId: 'test.preview.CycleA',
              referencedTypeFqn: 'test.preview.CycleA',
              children: [],
              required: false
            }
          ],
          choiceArmPaths: ['cycleB.cycleA']
        }
      ]);
    }
  );

  skipIfNodeLt22(
    'generates an enum-value field for a typeAlias resolving to an Enum (top-level navigation target)',
    async () => {
      const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      enum Side:
        Buy
        Sell

      typeAlias SideAlias:
        Side
    `);

      const schemas = generatePreviewSchemas([doc]);
      const alias = schemas.find((s) => s.targetId === 'test.preview.SideAlias')!;

      expect(alias).toMatchObject({ kind: 'typeAlias', status: 'ready' });
      expect(alias.fields).toEqual([
        {
          path: 'value',
          label: 'Side Alias',
          typeSymbol: 'typeAlias:test.preview.SideAlias',
          kind: 'enum',
          required: true,
          enumValues: [
            { value: 'Buy', label: 'Buy' },
            { value: 'Sell', label: 'Sell' }
          ]
        }
      ]);
    }
  );

  skipIfNodeLt22(
    "generates the Choice's own arm fields for a typeAlias resolving to a Choice (top-level navigation target)",
    async () => {
      const doc = await parseModel(`
        namespace "test.preview"
        version "1"

        type Cash:
          amount number (1..1)

        type Securities:
          isin string (1..1)

        choice Collateral:
          Cash
          Securities

        typeAlias CollateralAlias:
          Collateral
      `);

      const schemas = generatePreviewSchemas([doc]);
      const alias = schemas.find((s) => s.targetId === 'test.preview.CollateralAlias')!;

      expect(alias).toMatchObject({ kind: 'typeAlias', status: 'ready' });
      expect(alias.fields.map((f) => f.path)).toEqual(['cash', 'securities']);
      expect(alias.choiceArmPaths).toEqual(['cash', 'securities']);
    }
  );

  skipIfNodeLt22('resolves a 2-hop type-alias chain as the top-level navigation target itself', async () => {
    const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      type Address:
        street string (1..1)

      typeAlias AddressAliasInner:
        Address

      typeAlias AddressAlias:
        AddressAliasInner
    `);

    const schemas = generatePreviewSchemas([doc]);
    const alias = schemas.find((s) => s.targetId === 'test.preview.AddressAlias')!;

    expect(alias).toMatchObject({ kind: 'typeAlias', status: 'ready' });
    expect(alias.fields.map((f) => f.path)).toEqual(['street']);
  });

  skipIfNodeLt22(
    'a primitive resolved without a BUILTIN_KIND_MAP entry does not flip status to unsupported (diagnostic-parity subtlety)',
    async () => {
      // 'pattern' is a real Rosetta basic-type name (ROSETTA_BASIC_TYPE_NAMES
      // in type-ref-resolver.ts) but has no BUILTIN_KIND_MAP entry in this
      // file (a pre-existing, unrelated gap left untouched by this
      // migration). buildBaseField's onPrimitive callback must NOT call
      // unsupportedFeatures.add for this case — only the genuinely-
      // unresolved catch-all does — so a field merely missing a kind
      // mapping still reads as 'ready', matching pre-migration behavior.
      const doc = await parseModel(`
        namespace "test.preview"
        version "1"

        type Foo:
          bar pattern (0..1)
      `);

      const schemas = generatePreviewSchemas([doc]);
      const schema = schemas.find((s) => s.targetId === 'test.preview.Foo')!;
      const field = schema.fields.find((f) => f.path === 'bar')!;

      expect(field.kind).toBe('unknown');
      expect(schema.status).toBe('ready');
      expect(schema.unsupportedFeatures).toBeUndefined();
    }
  );

  skipIfNodeLt22('buildChoiceOptionField preserves its own unresolved-reference diagnostic wording', async () => {
    const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      choice Instrument:
        Bond
    `);

    const schemas = generatePreviewSchemas([doc]);
    const instrument = schemas.find((s) => s.targetId === 'test.preview.Instrument')!;

    expect(instrument.status).toBe('unsupported');
    expect(instrument.unsupportedFeatures).toContain('unresolved-reference:Bond');
    expect(instrument.fields).toEqual([
      {
        path: 'bond',
        label: 'Bond',
        kind: 'unknown',
        required: false,
        description: 'Type reference Bond could not be resolved for form preview.'
      }
    ]);
  });

  skipIfNodeLt22('buildTypeAliasSchema preserves its own unresolved-reference diagnostic wording', async () => {
    const doc = await parseModel(`
      namespace "test.preview"
      version "1"

      typeAlias GhostAlias:
        GhostType
    `);

    const schemas = generatePreviewSchemas([doc]);
    const alias = schemas.find((s) => s.targetId === 'test.preview.GhostAlias')!;

    expect(alias).toMatchObject({ kind: 'typeAlias', status: 'unsupported' });
    expect(alias.unsupportedFeatures).toEqual(['unresolved-reference:GhostType']);
    expect(alias.fields).toEqual([
      {
        path: 'value',
        label: 'Ghost Alias',
        kind: 'unknown',
        required: true,
        description: 'Type reference GhostType could not be resolved for form preview.'
      }
    ]);
  });
});
