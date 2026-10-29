// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Data-extends-Choice — ts-emitter surface.
 *
 * Per docs/superpowers/specs/2026-07-02-data-extends-choice-design.md
 * (AMENDED "TS type — generic intersection" and "TS class — generic child
 * class" sections): a `Data` whose `superType` is a `Choice` (real corpus
 * case: `BasketConstituent extends Observable`) emits:
 *  - a SHAPE-level Choice union alongside the class-armed W2 one:
 *    `export type <Choice>Shape = { cash: CashShape } | ...` — each arm's
 *    value type is the option's Shape when the option is a Data (the type
 *    a construction payload actually carries), bare name otherwise.
 *  - `<Name>Shape` as a GENERIC INTERSECTION TYPE ALIAS (not a plain
 *    interface): `export type <Name>Shape<T extends <Choice>Shape =
 *    <Choice>Shape> = T & { ...own attrs };`. A plain `interface …
 *    extends` is not expressible here (interfaces cannot extend a union);
 *    the spec's own "TS type — generic intersection" surface is this
 *    `T & {...extras}` shape. Constraint/default is the SHAPE-level
 *    Choice union (user-directed correction) — `T extends <Choice>` would
 *    world-mix the plain-data Shape world with the class-armed union.
 *    Naming: the spec's literal snippet names the alias after the
 *    Data itself (`BasketConstituent<T> = T & {...}`), but the CLASS
 *    already owns that bare name — so the alias is `<Name>Shape` (the
 *    collision-free resolution recorded in the spec doc). Bare
 *    `<Name>Shape` (no type argument) still typechecks at every existing
 *    reference site because the default type param is the full Shape-level
 *    union.
 *  - a generic CLASS threading the arm type parameter through the
 *    constructor: `constructor(data: <Name>Shape<T>)` +
 *    `Object.assign(this, data)` for the T-surface, own attributes still
 *    assigned explicitly afterward (existing convention, unchanged) — per
 *    the spec's amended encoding. The class does NOT `implements
 *    <Name>Shape` for this case — a class cannot implement a union-typed
 *    alias (bare `<Name>Shape` resolves to `<Choice> & {...}`, union-
 *    rooted). NOT a mixin, NOT a competing static `of<T>()` factory;
 *    `static from`/`new <Name>(...)` remain the only construction paths.
 *
 * Before this fix: emitInterface/emitClass only ever checked
 * `isData(parentRef)` for the extends/inheritance branch — a Choice
 * supertype silently fell through to the "no parent" branch, so the child
 * lost ALL inherited option fields and emitted as if it had no supertype
 * at all (own attributes only, `implements <Name>Shape` with no `extends`,
 * no generic parameter, no exactly-one-of validator for the inherited
 * options). A later fix added the generic CLASS but still left `<Name>Shape`
 * as a plain own-attrs-only interface — this file's TYPE-surface tests
 * close that remaining gap.
 */

import { generatedDirectory } from '../helpers/generated-directory.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
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
import { emitNamespace } from '../../src/emit/ts-emitter.js';
import { generate } from '../../src/export.js';

/**
 * Real `tsc --strict` type-check of an emitted `.ts` file — no shortcuts
 * (not `transpileModule`, which only strips types and never reports
 * type errors). Used to prove the "TS type — generic intersection" surface
 * (`<Name>Shape<T>`) actually typechecks, including narrowed-arm usage
 * that only exists at the type level (never constructed), which the
 * emitted-runtime execution tests below cannot exercise.
 */
function typeCheckFile(filePath: string, source: string): readonly string[] {
  const compilerOptions: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ESNext,
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

async function parseSource(source: string) {
  const { RuneDsl } = createRuneDslServices();
  const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    source,
    URI.parse('inmemory:///model.rosetta')
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);
  const model = doc.parseResult?.value;
  if (!model || !isRosettaModel(model)) {
    throw new Error('expected a RosettaModel');
  }
  return doc;
}

const FIXTURE = `
namespace test.tsDataExtendsChoice
version "0.0.0"

type Cash:
    amount number (0..1)

type Commodity:
    quantity number (0..1)

choice Asset:
    Cash
    Commodity

type BasketConstituent extends Asset:
    weight number (0..1)

    condition CashIsAbsent:
        Cash is absent
`;

describe('ts-emitter — Data extends Choice: TYPE surface (generic intersection type alias)', () => {
  it('emits a SHAPE-level Choice union alongside the class-armed one — arms reference <Option>Shape for Data options', async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.tsDataExtendsChoice');
    const output = emitNamespace(model, {});
    // The original W2 class-armed union is UNCHANGED (non-goal)...
    expect(output.content).toContain('export type Asset = { cash: Cash } | { commodity: Commodity };');
    // ...and the new Shape-level union sits alongside it: each arm's value
    // type is the option's Shape (the type a construction payload actually
    // carries at that key), not the class.
    expect(output.content).toContain('export type AssetShape = { cash: CashShape } | { commodity: CommodityShape };');
  });

  it('emits <Name>Shape as a generic intersection type alias — T constrained/defaulted on the SHAPE-level Choice union, own attrs in the extras block', async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.tsDataExtendsChoice');
    const output = emitNamespace(model, {});
    // `T extends AssetShape` (the Shape-level union), NOT `T extends Asset`
    // (whose arms are the CLASS types — world-mixing: a `{ cash: { amount:
    // 5 } }` construction payload is not a `Cash` class instance).
    expect(output.content).toContain(
      'export type BasketConstituentShape<T extends AssetShape = AssetShape> = T & {\n  weight?: number;\n};'
    );
    expect(output.content).not.toContain('T extends Asset =');
    expect(output.content).not.toContain('export interface BasketConstituentShape');
    expect(output.content).not.toContain('BasketConstituentShape extends');
  });
});

describe('ts-emitter — Data extends Choice: CLASS surface (generic child class)', () => {
  it('emits a class generic over the Choice arm, constrained/defaulted on the SHAPE-level Choice union', async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.tsDataExtendsChoice');
    const output = emitNamespace(model, {});
    expect(output.content).toContain('export class BasketConstituent<T extends AssetShape = AssetShape>');
  });

  it("the constructor threads the generic (data: <Name>Shape<T>) and Object.assign's the T-surface", async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.tsDataExtendsChoice');
    const output = emitNamespace(model, {});
    expect(output.content).toContain('constructor(data: BasketConstituentShape<T>) {');
    expect(output.content).toContain('Object.assign(this, data);');
  });

  it('does NOT emit `implements <Name>Shape` for a Choice-extending Data — a class cannot implement a union-typed alias', async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.tsDataExtendsChoice');
    const output = emitNamespace(model, {});
    expect(output.content).not.toContain('implements BasketConstituentShape');
  });

  it('own attributes are still assigned explicitly in the constructor (existing convention preserved)', async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.tsDataExtendsChoice');
    const output = emitNamespace(model, {});
    expect(output.content).toContain('this.weight = data.weight;');
  });

  it('does NOT emit a mixin factory (ObservableMixin-shaped export) — superseded design', async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.tsDataExtendsChoice');
    const output = emitNamespace(model, {});
    expect(output.content).not.toMatch(/Mixin\s*=\s*</);
    expect(output.content).not.toContain('Constructor');
  });

  it('static from(...) still delegates to `new <Name>(...)` — single construction path preserved', async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.tsDataExtendsChoice');
    const output = emitNamespace(model, {});
    expect(output.content).toContain('static from(json: unknown): BasketConstituent {');
    // Cast through `unknown` first: bare `BasketConstituentShape` (default
    // `T=Asset`, a union) does not structurally overlap with `json`
    // (typed `unknown`) closely enough for a direct `as` under real `tsc
    // --strict` (TS2352) — see emitFromFactory's `castThroughUnknown` doc
    // comment. Plain Data-extends-Data keeps the direct cast, unaffected.
    expect(output.content).toContain('return new BasketConstituent(json as unknown as BasketConstituentShape);');
  });

  it('emits an exactly-one-of validate method reading the REAL (camelCase) field keys, not the DSL-text option names', async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.tsDataExtendsChoice');
    const output = emitNamespace(model, {});
    expect(output.content).toContain('validateAsset(): { valid: boolean; errors: string[] } {');
    // `cash`/`commodity` (camelCase) are the REAL populated fields
    // (Object.assign(this, data) from a `{ cash: Cash }`-shaped union
    // member) — NOT `Cash`/`Commodity` (the bare option type names, which
    // is what the ERROR MESSAGE still uses for readability, but is never a
    // real property on the instance). The read is cast via `(this as
    // unknown as Record<string, unknown>)` because the class does not
    // statically declare Choice option keys as members (real `tsc
    // --strict` rejects a direct `this.cash` — TS2339).
    expect(output.content).toContain(
      'rune.checkOneOf([(this as unknown as Record<string, unknown>).cash, (this as unknown as Record<string, unknown>).commodity])'
    );
    expect(output.content).toContain("errors.push('Asset: exactly one of [Cash, Commodity] must be present");
  });

  it("the child's own condition (CashIsAbsent) is still emitted", async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.tsDataExtendsChoice');
    const output = emitNamespace(model, {});
    expect(output.content).toContain('validateCashIsAbsent(): { valid: boolean; errors: string[] } {');
    expect(output.content).not.toContain('DIAGNOSTIC');
  });
});

describe('ts-emitter — Data extends Choice: TYPE surface compiles under real tsc --strict', () => {
  it('the emitted output alone typechecks clean (no errors) under strict mode', async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.tsDataExtendsChoice');
    const output = emitNamespace(model, {});
    const diagnostics = typeCheckFile(new URL('./basket-constituent.ts', import.meta.url).pathname, output.content);
    expect(diagnostics).toEqual([]);
  });

  it('a type-only reference using <Name>Shape<T> keeps arm narrowing — the exact gap the class encoding cannot close', async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.tsDataExtendsChoice');
    const output = emitNamespace(model, {});

    // A consumer holding a known arm can type-annotate a function parameter
    // as `BasketConstituentShape<{ cash: CashShape }>` and access that
    // arm's fields directly on the declared TYPE — no cast required. This
    // is exactly the capability the spec's type-alias surface exists to
    // provide and the generic CLASS (constructor-only generic) cannot: TS
    // classes can't declare members from a type parameter, so a narrowed
    // `new BasketConstituent<...>(...)` instance still needs a cast to
    // read arm-specific fields (see the class-surface tests above). The
    // arm is written in the SHAPE world (`CashShape`, matching the
    // `T extends AssetShape` constraint) — plain construction-payload
    // types, not class instances.
    const probe = `
function readNarrowed(x: BasketConstituentShape<{ cash: CashShape }>): number {
  return x.cash.amount ?? 0;
}
function readBare(x: BasketConstituentShape): number {
  return x.weight ?? 0;
}
`;
    const diagnostics = typeCheckFile(
      new URL('./basket-constituent-probe.ts', import.meta.url).pathname,
      output.content + probe
    );
    expect(diagnostics).toEqual([]);
  });
});

describe('ts-emitter — Data extends Choice (emitted-runtime behavior, real execution)', () => {
  /**
   * Generates the FULL namespace via the public `generate()` entry point,
   * writes the ACTUAL emitted output to a temp dir, and dynamic-imports it
   * — exercising the literal generator output (not a hand-written
   * analogue) at runtime. Mirrors zod-data-extends-choice.test.ts's
   * loadEmittedModule pattern for the Zod surface.
   */
  async function loadEmittedModule(): Promise<Record<string, unknown>> {
    const doc = await parseSource(FIXTURE);
    const outputs = await generate(doc, { target: 'typescript' });
    expect(outputs.length).toBeGreaterThan(0);

    const tmpDir = await generatedDirectory(join(tmpdir(), 'rune-codegen-ts-data-extends-choice-'));
    let modulePath = '';
    for (const output of outputs) {
      const outPath = join(tmpDir, output.relativePath);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, output.content, 'utf-8');
      if (output.relativePath.includes('tsDataExtendsChoice')) {
        modulePath = outPath;
      }
    }
    expect(modulePath).not.toBe('');
    const mod = (await import(/* @vite-ignore */ pathToFileURL(modulePath).toString())) as Record<string, unknown>;
    return mod;
  }

  // Payloads use camelCase keys (`cash`/`commodity`) — matching the REAL
  // emitted union member keys (`export type Asset = { cash: Cash } | {
  // commodity: Commodity }`), NOT the bare option type names.

  it('bare `new BasketConstituent(data)` (non-generic default) constructs and exposes the T-surface + own attrs', async () => {
    const mod = await loadEmittedModule();
    const BasketConstituent = mod['BasketConstituent'] as new (data: unknown) => Record<string, unknown>;
    const bc = new BasketConstituent({ cash: { amount: 5 }, weight: 2 });
    expect(bc['weight']).toBe(2);
    expect(bc['cash']).toEqual({ amount: 5 });
  });

  it('a narrowed generic instantiation `new BasketConstituent<{ commodity: ... }>(data)` also constructs correctly', async () => {
    const mod = await loadEmittedModule();
    const BasketConstituent = mod['BasketConstituent'] as new (data: unknown) => Record<string, unknown>;
    const bc = new BasketConstituent({ commodity: { quantity: 9 }, weight: 3 });
    expect(bc['weight']).toBe(3);
    expect(bc['commodity']).toEqual({ quantity: 9 });
  });

  it('validateAsset() passes for exactly one option present', async () => {
    const mod = await loadEmittedModule();
    const BasketConstituent = mod['BasketConstituent'] as new (data: unknown) => {
      validateAsset(): { valid: boolean; errors: string[] };
    };
    // Use commodity here (not cash) so this test is independent of
    // CashIsAbsent's own semantics — see the dedicated test below.
    const bc = new BasketConstituent({ commodity: { quantity: 1 }, weight: 2 });
    expect(bc.validateAsset()).toEqual({ valid: true, errors: [] });
  });

  it('validateAsset() fails when multiple option keys are present', async () => {
    const mod = await loadEmittedModule();
    const BasketConstituent = mod['BasketConstituent'] as new (data: unknown) => {
      validateAsset(): { valid: boolean; errors: string[] };
    };
    const bc = new BasketConstituent({ cash: { amount: 5 }, commodity: { quantity: 1 }, weight: 2 });
    const result = bc.validateAsset();
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Asset');
  });

  it('validateAsset() fails when no option key is present', async () => {
    const mod = await loadEmittedModule();
    const BasketConstituent = mod['BasketConstituent'] as new (data: unknown) => {
      validateAsset(): { valid: boolean; errors: string[] };
    };
    const bc = new BasketConstituent({ weight: 2 });
    expect(bc.validateAsset().valid).toBe(false);
  });

  it("the child's own condition (validateCashIsAbsent) still enforces post-construction — this is the accessor-naming fix's ground-truth check", async () => {
    const mod = await loadEmittedModule();
    const BasketConstituent = mod['BasketConstituent'] as new (data: unknown) => {
      validateCashIsAbsent(): { valid: boolean; errors: string[] };
    };
    // `cash` present -> CashIsAbsent must reject. This is the exact case
    // that silently passed as a false positive before the
    // attrAccessorNames/choiceOptionFieldName fix in
    // emitChoiceParentValidateMethod (the check read `this.Cash`, always
    // undefined since Object.assign only ever populates `this.cash`).
    const withCash = new BasketConstituent({ cash: { amount: 5 }, weight: 2 });
    expect(withCash.validateCashIsAbsent().valid).toBe(false);

    const withoutCash = new BasketConstituent({ commodity: { quantity: 1 }, weight: 2 });
    expect(withoutCash.validateCashIsAbsent().valid).toBe(true);
  });

  it('static from(json) delegates to `new BasketConstituent(...)` and round-trips', async () => {
    const mod = await loadEmittedModule();
    const BasketConstituent = mod['BasketConstituent'] as {
      from(json: unknown): { weight?: number };
    };
    const bc = BasketConstituent.from({ cash: { amount: 1 }, weight: 7 });
    expect(bc.weight).toBe(7);
  });
});
