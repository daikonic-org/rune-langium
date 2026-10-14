// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Data-extends-Choice — zod-emitter surface.
 *
 * Per docs/superpowers/specs/2026-07-02-data-extends-choice-design.md
 * ("Zod — runeExtendChoice runtime helper" section): a `Data` whose
 * `superType` is a `Choice` (real corpus case: `BasketConstituent extends
 * Observable`) is derived from the Choice's emitted union at module-init via
 * a `runeExtendChoice` runtime helper — NOT statically decomposed into a
 * hand-unrolled union. `ObservableSchema` (the Choice) remains the runtime
 * source of truth; distribution across every arm happens in one shared
 * helper.
 *
 * Two kinds of tests here:
 *  1. Unit tests on the EMITTED SOURCE TEXT (string assertions against
 *     `emitNamespace` output) — mirrors zod-choice.test.ts's conventions.
 *  2. Emitted-runtime behavior tests (spec's Verification point 1) — write
 *     the ACTUAL emitted output to a temp dir and dynamic-`import()` it,
 *     then exercise the real zod schema with safeParse. This is the
 *     ground-truth check for whether zod v4's `.extend()` preserves
 *     `strictObject` strictness through the helper (verified manually
 *     against a standalone repro during design-time; this test locks that
 *     behavior in against the ACTUAL generator output, not a hand-written
 *     analogue).
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { mkdtempWithNodeModules } from './emitted-module-dir.js';
import { pathToFileURL } from 'node:url';
import { createRuneDslServices, isRosettaModel } from '@rune-langium/core';
import { URI } from 'langium';
import { describe, it, expect } from 'vitest';
import { walkNamespace } from '../../src/emit/namespace-walker.js';
import { emitNamespace } from '../../src/emit/zod-emitter.js';
import { generate } from '../../src/export.js';

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
namespace test.dataExtendsChoice
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

describe('zod-emitter — Data extends Choice (emitted source text)', () => {
  it('emits a runeExtendChoice(...) call deriving from the Choice schema, not a hand-unrolled union', async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.dataExtendsChoice');
    const output = emitNamespace(model, {});
    expect(output.content).toContain('export const BasketConstituentSchema = runeExtendChoice(AssetSchema, {');
    expect(output.content).toContain('weight: z.number().optional()');
  });

  it('emits the runeExtendChoice runtime helper exactly once', async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.dataExtendsChoice');
    const output = emitNamespace(model, {});
    const occurrences = output.content.split('const runeExtendChoice = ').length - 1;
    expect(occurrences).toBe(1);
  });

  it('emits a z.infer type alias for the child, same as any other Data', async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.dataExtendsChoice');
    const output = emitNamespace(model, {});
    expect(output.content).toContain('export type BasketConstituent = z.infer<typeof BasketConstituentSchema>;');
  });

  it('the emitted condition (CashIsAbsent) reads the REAL emitted field key (data.cash), not the DSL-text name (data.Cash)', async () => {
    const doc = await parseSource(FIXTURE);
    const model = walkNamespace([doc], 'test.dataExtendsChoice');
    const output = emitNamespace(model, {});
    expect(output.content).not.toContain('DIAGNOSTIC');
    // `Cash is absent` is the author-facing condition text (matches the
    // Choice option's Data-type name, capitalized) — buildAttributeTypesMap
    // keys its pseudo-attribute map that way so validateAttr's lookup
    // matches the condition's own AST text. But the REAL emitted Zod field
    // key at that position is camelCase (choiceOptionFieldName: `Cash` ->
    // `cash`), matching the arm shape `z.strictObject({ cash: CashSchema })`
    // — so the transpiled predicate MUST read `data.cash`, not `data.Cash`
    // (which would always be undefined at runtime — a silent false-negative
    // this exact assertion caught on first implementation).
    expect(output.content).toContain('data.cash == null');
    expect(output.content).not.toContain('data.Cash');
  });
});

describe('zod-emitter — Data extends Choice (emitted-runtime behavior, real zod evaluation)', () => {
  /**
   * Generates the FULL namespace via the public `generate()` entry point
   * (not the lower-level `emitNamespace` used by the string-assertion tests
   * above), writes the actual output to a temp dir, and dynamic-imports it
   * so the zod schema under test is the literal emitted artifact — not a
   * hand-transcribed analogue.
   */
  async function loadEmittedModule(): Promise<Record<string, unknown>> {
    const doc = await parseSource(FIXTURE);
    const outputs = await generate(doc, { target: 'zod' });
    expect(outputs.length).toBeGreaterThan(0);

    const tmpDir = await mkdtempWithNodeModules('rune-codegen-data-extends-choice-');
    let modulePath = '';
    for (const output of outputs) {
      // Keep the .ts extension (not .mjs) — the emitted file has TS type
      // annotations (RUNTIME_HELPER_SOURCE's parameter/return types, the
      // `z.infer` type alias); vitest's Vite-powered dynamic `import()`
      // transforms .ts on the fly, so importing the LITERAL emitted output
      // (byte-for-byte, no hand-stripping) is the true ground-truth check.
      const outPath = join(tmpDir, output.relativePath);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, output.content, 'utf-8');
      if (output.relativePath.includes('dataExtendsChoice')) {
        modulePath = outPath;
      }
    }
    expect(modulePath).not.toBe('');
    const mod = (await import(/* @vite-ignore */ pathToFileURL(modulePath).toString())) as Record<string, unknown>;
    return mod;
  }

  // NOTE: the FIXTURE's BasketConstituent also carries `condition
  // CashIsAbsent: Cash is absent` — so a payload with `cash` present is
  // ALWAYS invalid end-to-end (rejected by CashIsAbsent), even though the
  // base structural (Choice-derivation) shape alone would accept it. Cases
  // that want to isolate the pure structural-derivation behavior use
  // `commodity` (the OTHER option, unaffected by CashIsAbsent); the
  // dedicated "still enforces" test below isolates CashIsAbsent itself
  // using `cash`.

  it('case 1: single option (not the one CashIsAbsent forbids) + own extras -> PASSES', async () => {
    const mod = await loadEmittedModule();
    const schema = mod['BasketConstituentSchema'] as { safeParse: (v: unknown) => { success: boolean } };
    const result = schema.safeParse({ commodity: { quantity: 1 }, weight: 2 });
    expect(result.success).toBe(true);
  });

  it('case 2: multiple option keys present -> FAILS (exactly-one-of structurally enforced)', async () => {
    const mod = await loadEmittedModule();
    const schema = mod['BasketConstituentSchema'] as { safeParse: (v: unknown) => { success: boolean } };
    const result = schema.safeParse({ cash: { amount: 5 }, commodity: { quantity: 1 }, weight: 2 });
    expect(result.success).toBe(false);
  });

  it('case 3: extras only, no option key -> FAILS', async () => {
    const mod = await loadEmittedModule();
    const schema = mod['BasketConstituentSchema'] as { safeParse: (v: unknown) => { success: boolean } };
    const result = schema.safeParse({ weight: 2 });
    expect(result.success).toBe(false);
  });

  it('case 4: extras validate per their own schema (wrong type) -> FAILS', async () => {
    const mod = await loadEmittedModule();
    const schema = mod['BasketConstituentSchema'] as { safeParse: (v: unknown) => { success: boolean } };
    const result = schema.safeParse({ commodity: { quantity: 1 }, weight: 'not-a-number' });
    expect(result.success).toBe(false);
  });

  it('case 5: unknown key on the distributed arm -> FAILS (strictness preserved through .extend())', async () => {
    const mod = await loadEmittedModule();
    const schema = mod['BasketConstituentSchema'] as { safeParse: (v: unknown) => { success: boolean } };
    const result = schema.safeParse({ commodity: { quantity: 1 }, weight: 2, bogus: 'x' });
    expect(result.success).toBe(false);
  });

  it("the child's own condition (CashIsAbsent) enforces after distribution — this is the accessor-naming fix's ground-truth check", async () => {
    const mod = await loadEmittedModule();
    const schema = mod['BasketConstituentSchema'] as {
      safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ message: string }> } };
    };
    // Cash IS present -> CashIsAbsent condition must reject this payload
    // even though the base structural shape (exactly-one-of + extras) is
    // otherwise valid (case 1's shape, just with `cash` instead of
    // `commodity`). This is the exact case that silently passed as a
    // false positive before the attrAccessorNames fix (the condition read
    // `data.Cash`, always undefined, so `!rune.exists(undefined)` was
    // always true and the condition never fired).
    const result = schema.safeParse({ cash: { amount: 5 }, weight: 2 });
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.message.includes('CashIsAbsent'))).toBe(true);
  });
});
