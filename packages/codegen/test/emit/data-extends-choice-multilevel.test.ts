// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Data-extends-Choice — multi-level chain acceptance.
 *
 * Per docs/superpowers/specs/2026-07-02-data-extends-choice-design.md
 * (Semantics: "Chains may be multi-level (`Data extends Data extends
 * Choice`): extras accumulate down to the Choice ancestor.") and the
 * Acceptance gate's "multi-level chain test (synthetic fixture — the
 * corpus has no multi-level case; parse-first validate the fixture)".
 *
 * Fixture: `BasketConstituent extends ObservableItem extends Asset` (a
 * `choice`) — test/fixtures/data-extends-choice-multilevel/input.rune.
 * Parse-validated separately (hasErrors: false) before authoring this
 * suite, per the spec's instruction (the real corpus has no 3-level case
 * to cross-check against, unlike the single-level BasketConstituent-
 * extends-Observable case, which IS real corpus).
 *
 * Exercises all three fixed surfaces end-to-end against the SAME fixture:
 *  1. Transpiler (buildAttributeTypesMap resolves Cash/Commodity through
 *     the intermediate Data parent to the Choice ancestor).
 *  2. Zod (runeExtendChoice derivation + emitted-runtime behavior).
 *  3. TypeScript (generic child class + emitted-runtime behavior).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { mkdtempWithNodeModules } from './emitted-module-dir.js';
import { pathToFileURL } from 'node:url';
import { createRuneDslServices, isRosettaModel } from '@rune-langium/core';
import { URI } from 'langium';
import { describe, it, expect } from 'vitest';
// TypeScript 7's default export dropped the classic synchronous Compiler
// API (createProgram/getPreEmitDiagnostics/etc.) in favor of the new
// typescript/unstable/sync RPC-style API. This oracle test needs the
// classic API to compile+typecheck the codegen's own generated output,
// so it imports a scoped legacy 'typescript-classic' alias (see
// package.json) instead of the workspace-wide TS7 'typescript'.
import ts from 'typescript-classic';
import { walkNamespace } from '../../src/emit/namespace-walker.js';
import { emitNamespace as emitTs } from '../../src/emit/ts-emitter.js';
import { emitNamespace as emitZod } from '../../src/emit/zod-emitter.js';
import { generate } from '../../src/export.js';

const FIXTURE_DIR = resolve(new URL('.', import.meta.url).pathname, '../fixtures/data-extends-choice-multilevel');

/**
 * Real `tsc --strict` type-check — mirrors ts-data-extends-choice.test.ts's
 * `typeCheckFile` helper. Used here to prove the MULTI-LEVEL alias chain
 * (`BasketConstituentShape<T> = ObservableItemShape<T> & {...}`) actually
 * typechecks, not just that it string-matches the expected template.
 */
function typeCheckFile(filePath: string, source: string): readonly string[] {
  const compilerOptions: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true
  };
  const host = ts.createCompilerHost(compilerOptions);
  const originalReadFile = host.readFile.bind(host);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.readFile = (fileName) => (fileName === filePath ? source : originalReadFile(fileName));
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    fileName === filePath
      ? ts.createSourceFile(fileName, source, languageVersion, true)
      : originalGetSourceFile(fileName, languageVersion, ...rest);

  const program = ts.createProgram([filePath], compilerOptions, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  return diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

async function parseFixture() {
  const content = await readFile(join(FIXTURE_DIR, 'input.rune'), 'utf-8');
  const { RuneDsl } = createRuneDslServices();
  const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    content,
    URI.parse('inmemory:///data-extends-choice-multilevel.rosetta')
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);
  expect(doc.parseResult.parserErrors, 'fixture must parse without errors').toHaveLength(0);
  const model = doc.parseResult?.value;
  if (!model || !isRosettaModel(model)) {
    throw new Error('expected a RosettaModel');
  }
  return doc;
}

describe('Data-extends-Choice — multi-level chain (synthetic fixture, parse-validated)', () => {
  it('parses with zero errors (ground-truth check before any assertion depends on the fixture)', async () => {
    const doc = await parseFixture();
    expect(doc.parseResult.parserErrors).toHaveLength(0);
  });

  it('zod: both links derive directly from AssetSchema via runeExtendChoice — never a .extend() chain on a union', async () => {
    const doc = await parseFixture();
    const model = walkNamespace([doc], 'test.dataExtendsChoiceMultilevel');
    const output = emitZod(model, {});
    // Intermediate Data-extends-Choice link (ObservableItem) derives via runeExtendChoice.
    expect(output.content).toContain('export const ObservableItemSchema = runeExtendChoice(AssetSchema, {');
    // Leaf (BasketConstituent extends ObservableItem, itself Choice-derived):
    // ObservableItemSchema IS a z.union(...) result (no .extend() method) —
    // BasketConstituentSchema must derive directly from the Choice ANCESTOR
    // (AssetSchema), folding in BOTH ObservableItem's own attrs (identifier)
    // and BasketConstituent's own attrs (weight), not chain .extend() on
    // top of ObservableItemSchema.
    expect(output.content).toContain('export const BasketConstituentSchema = runeExtendChoice(AssetSchema, {');
    expect(output.content).toContain('identifier: z.string().optional()');
    expect(output.content).toContain('weight: z.number().optional()');
    expect(output.content).not.toContain('ObservableItemSchema.extend');
    expect(output.content).not.toContain('DIAGNOSTIC');
  });

  it("zod: the leaf's condition (CashIsAbsent) resolves through the multi-level chain to the REAL field key (data.cash), no DIAGNOSTIC", async () => {
    const doc = await parseFixture();
    const model = walkNamespace([doc], 'test.dataExtendsChoiceMultilevel');
    const output = emitZod(model, {});
    // `Cash` is the DSL-text pseudo-attribute name (buildAttributeTypesMap's
    // key, matching what the author literally wrote); `cash` is the REAL
    // emitted field key (choiceOptionFieldName) — see
    // zod-data-extends-choice.test.ts's single-level equivalent for the
    // full rationale. Multi-level must resolve the SAME remap even though
    // the Choice is 2 links away (ObservableItem, then the Choice).
    expect(output.content).toContain('data.cash == null');
    expect(output.content).not.toContain('data.Cash');
    expect(output.content).not.toContain('DIAGNOSTIC');
  });

  it('ts: ObservableItemShape is the generic intersection alias (direct Choice link); BasketConstituentShape threads the SAME T through it (transitive Choice ancestor)', async () => {
    const doc = await parseFixture();
    const model = walkNamespace([doc], 'test.dataExtendsChoiceMultilevel');
    const output = emitTs(model, {});
    // The Choice's SHAPE-level union exists alongside the class-armed one
    // (user-directed correction: generic constraints bind on the Shape
    // world, not the class-armed W2 union).
    expect(output.content).toContain('export type AssetShape = { cash: CashShape } | { commodity: CommodityShape };');
    // ObservableItem extends the Choice (Asset) directly — its Shape is the
    // generic intersection type alias, not a plain interface, constrained
    // on the SHAPE-level Choice union.
    expect(output.content).toContain(
      'export type ObservableItemShape<T extends AssetShape = AssetShape> = T & {\n  identifier?: string;\n};'
    );
    expect(output.content).not.toContain('export interface ObservableItemShape');
    // BasketConstituent extends a Data (ObservableItem) at the leaf, and
    // ObservableItem's OWN chain reaches the Choice — so a plain `interface
    // … extends ObservableItemShape` would fail to compile (bare
    // ObservableItemShape defaults T=AssetShape, a union; TS2312). Instead
    // BasketConstituentShape is ALSO a generic alias, threading the same T
    // through the parent's generic Shape rather than `extends`.
    expect(output.content).toContain(
      'export type BasketConstituentShape<T extends AssetShape = AssetShape> = ObservableItemShape<T> & {\n  weight?: number;\n};'
    );
    expect(output.content).not.toContain('export interface BasketConstituentShape');
  });

  it('ts: ObservableItem (the Data-extends-Choice link) is a generic class over AssetShape — no `implements` (union-typed Shape)', async () => {
    const doc = await parseFixture();
    const model = walkNamespace([doc], 'test.dataExtendsChoiceMultilevel');
    const output = emitTs(model, {});
    expect(output.content).toContain('export class ObservableItem<T extends AssetShape = AssetShape> {');
    expect(output.content).not.toContain('implements ObservableItemShape');
    expect(output.content).toContain('constructor(data: ObservableItemShape<T>) {');
    expect(output.content).toContain('validateAsset(): { valid: boolean; errors: string[] } {');
  });

  it('ts: BasketConstituent (Data-extends-Data at the leaf) extends ObservableItem ordinarily — no generic param, no `implements` (Shape is generic transitively)', async () => {
    const doc = await parseFixture();
    const model = walkNamespace([doc], 'test.dataExtendsChoiceMultilevel');
    const output = emitTs(model, {});
    expect(output.content).toContain('export class BasketConstituent extends ObservableItem {');
    expect(output.content).not.toContain('implements BasketConstituentShape');
    expect(output.content).not.toContain('class BasketConstituent<T');
  });

  it('ts: the full multi-level chain (both the direct-Choice alias and the chained alias) typechecks clean under real tsc --strict', async () => {
    const doc = await parseFixture();
    const model = walkNamespace([doc], 'test.dataExtendsChoiceMultilevel');
    const output = emitTs(model, {});
    const diagnostics = typeCheckFile(new URL('./multilevel.ts', import.meta.url).pathname, output.content);
    expect(diagnostics).toEqual([]);
  });
});

describe('Data-extends-Choice — multi-level chain (emitted-runtime behavior, real execution)', () => {
  async function loadEmittedZodModule(): Promise<Record<string, unknown>> {
    const doc = await parseFixture();
    const outputs = await generate(doc, { target: 'zod' });
    const tmpDir = await mkdtempWithNodeModules('rune-codegen-multilevel-zod-');
    let modulePath = '';
    for (const output of outputs) {
      const outPath = join(tmpDir, output.relativePath);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, output.content, 'utf-8');
      if (output.relativePath.includes('dataExtendsChoiceMultilevel')) modulePath = outPath;
    }
    expect(modulePath).not.toBe('');
    return (await import(/* @vite-ignore */ pathToFileURL(modulePath).toString())) as Record<string, unknown>;
  }

  async function loadEmittedTsModule(): Promise<Record<string, unknown>> {
    const doc = await parseFixture();
    const outputs = await generate(doc, { target: 'typescript' });
    const tmpDir = await mkdtempWithNodeModules('rune-codegen-multilevel-ts-');
    let modulePath = '';
    for (const output of outputs) {
      const outPath = join(tmpDir, output.relativePath);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, output.content, 'utf-8');
      if (output.relativePath.includes('dataExtendsChoiceMultilevel')) modulePath = outPath;
    }
    expect(modulePath).not.toBe('');
    return (await import(/* @vite-ignore */ pathToFileURL(modulePath).toString())) as Record<string, unknown>;
  }

  it('zod: BasketConstituentSchema accepts a valid payload distributed through both links', async () => {
    const mod = await loadEmittedZodModule();
    const schema = mod['BasketConstituentSchema'] as { safeParse: (v: unknown) => { success: boolean } };
    // Zod arm keys are camelCase-first-letter of the option TYPE name
    // (choiceOptionFieldName: `Commodity` -> `commodity`) — a DIFFERENT
    // naming domain from the transpiler's pseudo-attribute keys (which use
    // the bare option type name, e.g. `Cash`, `Commodity` — see the TS
    // suite below, which correctly uses the capitalized form for the same
    // reason `buildAttributeTypesMap`'s Choice-parent walk does).
    const result = schema.safeParse({ commodity: { quantity: 3 }, identifier: 'x1', weight: 2 });
    expect(result.success).toBe(true);
  });

  it('zod: BasketConstituentSchema rejects a multi-option payload (exactly-one-of preserved through both links)', async () => {
    const mod = await loadEmittedZodModule();
    const schema = mod['BasketConstituentSchema'] as { safeParse: (v: unknown) => { success: boolean } };
    const result = schema.safeParse({
      cash: { amount: 1 },
      commodity: { quantity: 3 },
      identifier: 'x1',
      weight: 2
    });
    expect(result.success).toBe(false);
  });

  it("zod: BasketConstituentSchema's own condition (CashIsAbsent) still enforces", async () => {
    const mod = await loadEmittedZodModule();
    const schema = mod['BasketConstituentSchema'] as { safeParse: (v: unknown) => { success: boolean } };
    const result = schema.safeParse({ cash: { amount: 1 }, identifier: 'x1', weight: 2 });
    expect(result.success).toBe(false);
  });

  it('ts: constructing a BasketConstituent through both links carries the Choice option + intermediate + own attrs', async () => {
    const mod = await loadEmittedTsModule();
    const ObservableItem = mod['ObservableItem'] as new (data: unknown) => Record<string, unknown>;
    const BasketConstituent = mod['BasketConstituent'] as new (data: unknown) => Record<string, unknown>;

    // camelCase keys (`commodity`) — the REAL emitted union member key, not
    // the bare option type name.
    const observable = new ObservableItem({ commodity: { quantity: 3 }, identifier: 'x1' });
    expect(observable['identifier']).toBe('x1');
    expect(observable['commodity']).toEqual({ quantity: 3 });

    // BasketConstituent extends ObservableItem (Data-extends-Data at the
    // leaf) via `super(data)` per the ordinary (unchanged) convention —
    // the ctor param type is plain BasketConstituentShape (no generic),
    // so the Choice-carrying fields flow through structurally (data is a
    // superset object), not via a generic parameter at this level.
    const bc = new BasketConstituent({ commodity: { quantity: 3 }, identifier: 'x1', weight: 2 } as any);
    expect(bc['weight']).toBe(2);
  });

  it("ts: ObservableItem's validateAsset() enforces exactly-one-of even when reached through the intermediate link", async () => {
    const mod = await loadEmittedTsModule();
    const ObservableItem = mod['ObservableItem'] as new (data: unknown) => {
      validateAsset(): { valid: boolean; errors: string[] };
    };
    const valid = new ObservableItem({ cash: { amount: 1 }, identifier: 'x1' });
    expect(valid.validateAsset().valid).toBe(true);

    const invalid = new ObservableItem({ cash: { amount: 1 }, commodity: { quantity: 2 }, identifier: 'x1' });
    expect(invalid.validateAsset().valid).toBe(false);
  });
});
