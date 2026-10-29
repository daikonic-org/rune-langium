// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * PR #470 live review finding (2026-08-04): `topoSort` always places cyclic
 * types after every non-cyclic one, even when a non-cyclic type depends on a
 * cyclic one — and `zod-emitter.ts` previously only wrapped a cyclic type's
 * OWN declaration in `z.lazy()`, never a reference TO it from elsewhere.
 * Reproduced directly against the real, unmodified per-namespace pipeline
 * (`namespace-walker.ts` + `zod-emitter.ts`, no standalone-extraction
 * involved): a self-referencing `Node` plus an acyclic `Root` with an
 * `n: Node` attribute produced `RootSchema` referencing `NodeSchema` before
 * its `const` declaration — a genuine TDZ `ReferenceError` at evaluation
 * time, since `RootSchema`'s own declaration is never itself lazy-wrapped.
 *
 * Fixed via `schemaRefExpr(name, ownerName)`: wraps a reference in
 * `z.lazy(() => ...)` only when the referenced type IS cyclic AND the
 * CURRENT declaration being built (`ownerName`) is NOT itself cyclic — a
 * reference from within a cyclic type's own body (self-reference, or
 * between two members of the same mutual cycle) is already safe, since its
 * OWN declaration is already inside a `z.lazy()` closure; wrapping it too
 * would be harmless but changes byte-identical output
 * (`test/us1-structural.test.ts`'s existing golden fixture asserts the
 * unwrapped form for exactly this case — this file complements it, it does
 * not replace it).
 *
 * Two related sub-findings, discovered and fixed alongside the same root
 * cause:
 * - `.extend()` on a cyclic parent's schema doesn't just have a TDZ
 *   problem — `ZodLazy` (what a cyclic type's own declaration produces)
 *   has NO `.extend()` method at all, confirmed at real runtime via
 *   `TypeError: NodeSchema.extend is not a function`, wrap or no wrap.
 *   Fixed by folding the cyclic parent's own attributes inline into a flat
 *   `z.object({...})` instead of using `.extend()` at all.
 * - `emitChoiceSchema`'s own declaration (unlike `emitTypeSchema`'s) is
 *   NEVER itself wrapped in `z.lazy()`, so a Choice option referencing a
 *   cyclic type — including the Choice referencing itself — always needs
 *   wrapping, with no "already inside my own lazy closure" exemption.
 *
 * The `extends` case below is deliberately SAME-namespace: a genuine,
 * SEPARATE, pre-existing bug was found while investigating this (a Data
 * extending a CROSS-namespace parent leaks that parent into the child
 * namespace's own `dataByName`/`emitOrder`, producing both a cross-ns
 * `import` AND a duplicate local re-declaration of the same schema name —
 * invalid ES module syntax regardless of cyclic-ness, reproducible against
 * the already-committed `test/fixtures/data-extends-data-crossns` fixture).
 * That bug is out of scope here (it's a `namespace-walker.ts`-level
 * cross-namespace concern, unrelated to cyclic ordering) and is reported
 * separately rather than fixed inline.
 */

import { createRuneDslServices, isRosettaModel } from '@rune-langium/core';
import { URI } from 'langium';
import { describe, it, expect } from 'vitest';
import ts from 'typescript-classic';
import { walkNamespace } from '../../src/emit/namespace-walker.js';
import { emitNamespace } from '../../src/emit/zod-emitter.js';

async function parseSource(source: string, uri: string) {
  const { RuneDsl } = createRuneDslServices();
  const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(source, URI.parse(uri));
  await RuneDsl.shared.workspace.DocumentBuilder.build([doc], { validation: true });
  const model = doc.parseResult?.value;
  if (!model || !isRosettaModel(model)) throw new Error('expected a RosettaModel');
  expect(doc.parseResult.parserErrors).toEqual([]);
  return doc;
}

/**
 * Real per-namespace output (unlike `emitStandaloneZodSchema`'s
 * `suppressBoilerplate: true` output) always inlines the runtime helpers
 * directly — no separate `RUNTIME_HELPER_JS_SOURCE` prepend needed or
 * wanted here (prepending it too would duplicate the same `const` names).
 */
function toEvaluableJs(tsCode: string): string {
  const withoutBoilerplate = tsCode
    .split('\n')
    .filter((line) => !/^import .*;$/.test(line))
    .map((line) => line.replace(/^export\s+/, ''))
    .join('\n');
  return ts.transpileModule(withoutBoilerplate, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ESNext }
  }).outputText;
}

describe('zod-emitter — cyclic-reference wrapping (real per-namespace pipeline)', () => {
  it('an acyclic Data referencing a cyclic Data is wrapped, and genuinely evaluates', async () => {
    const doc = await parseSource(
      `
namespace test.acyclicDependsOnCyclic
version "0.0.0"

type Node:
    child Node (0..1)

type Root:
    n Node (0..1)
`,
      'inmemory:///acyclicDependsOnCyclic.rosetta'
    );
    const model = walkNamespace([doc], 'test.acyclicDependsOnCyclic');
    expect(Array.from(model.cyclicTypes)).toEqual(['Node']);
    const output = emitNamespace(model, {});
    expect(output.content).toContain('n: z.lazy(() => NodeSchema).optional()');

    const { z } = await import('zod');
    const js = toEvaluableJs(output.content);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const { RootSchema, NodeSchema } = new Function('z', `${js}\nreturn { RootSchema, NodeSchema };`)(z);
    expect(RootSchema.safeParse({ n: { child: {} } }).success).toBe(true);
    expect(RootSchema.safeParse({ n: 'not-an-object' }).success).toBe(false);
    expect(NodeSchema.safeParse({ child: {} }).success).toBe(true);
  });

  it('a Choice option referencing itself (Choice <-> Data mutual cycle) is wrapped, and genuinely evaluates', async () => {
    const doc = await parseSource(
      `
namespace test.cyclicChoice
version "0.0.0"

choice Wrapper:
    Holder

type Holder:
    w Wrapper (0..1)
`,
      'inmemory:///cyclicChoice.rosetta'
    );
    const model = walkNamespace([doc], 'test.cyclicChoice');
    expect(Array.from(model.cyclicTypes).sort()).toEqual(['Holder', 'Wrapper']);
    const output = emitNamespace(model, {});
    // The Choice's own declaration is never itself wrapped (unlike a Data's),
    // so its self-referencing option must be — with no exemption.
    expect(output.content).toContain(
      'export const WrapperSchema = z.union([z.strictObject({ holder: z.lazy(() => HolderSchema) })]);'
    );

    const { z } = await import('zod');
    const js = toEvaluableJs(output.content);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const { WrapperSchema } = new Function('z', `${js}\nreturn { WrapperSchema };`)(z);
    expect(WrapperSchema.safeParse({ holder: { w: { holder: {} } } }).success).toBe(true);
    expect(WrapperSchema.safeParse({ holder: 'not-an-object' }).success).toBe(false);
  });

  it('a Data extending a cyclic parent (same namespace) folds attributes inline, no .extend() on ZodLazy, and genuinely evaluates', async () => {
    const doc = await parseSource(
      `
namespace test.extendsCyclicSameNs
version "0.0.0"

type Node:
    child Node (0..1)

type Special extends Node:
    note string (0..1)
`,
      'inmemory:///extendsCyclicSameNs.rosetta'
    );
    const model = walkNamespace([doc], 'test.extendsCyclicSameNs');
    const output = emitNamespace(model, {});
    // NOT a bare `.extend(` check: the always-inlined `runeExtendChoice`
    // runtime helper itself contains `arm.extend(shape)`, an unrelated
    // match. Check specifically for `.extend(` chained off NodeSchema.
    expect(output.content).not.toContain('NodeSchema.extend(');
    expect(output.content).toContain('child: z.lazy(() => NodeSchema).optional()');
    expect(output.content).toContain('note: z.string().optional()');

    const { z } = await import('zod');
    const js = toEvaluableJs(output.content);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const { SpecialSchema } = new Function('z', `${js}\nreturn { SpecialSchema };`)(z);
    expect(SpecialSchema.safeParse({ note: 'x', child: { child: {} } }).success).toBe(true);
    expect(SpecialSchema.safeParse({ note: 123 }).success).toBe(false);
  });

  /**
   * PR #469 final-review finding (2026-08-04): the fold above only copied
   * the IMMEDIATE cyclic parent's (`superRef`'s) own attributes — if
   * `superRef` itself extends a FURTHER ancestor (here `Grandparent`, a
   * non-cyclic Data), that further ancestor's own attributes were silently
   * omitted from the fold. `Grandparent <- Node (self-referential) <-
   * Special`: `Node` is the cyclic immediate parent of `Special`, and
   * `Node` itself extends the non-cyclic `Grandparent`.
   */
  it('a Data extending a cyclic parent that itself extends a further ancestor folds the FULL ancestry, and genuinely evaluates', async () => {
    const doc = await parseSource(
      `
namespace test.extendsCyclicMultiLevel
version "0.0.0"

type Grandparent:
    gpField string (0..1)

type Node extends Grandparent:
    child Node (0..1)

type Special extends Node:
    note string (0..1)
`,
      'inmemory:///extendsCyclicMultiLevel.rosetta'
    );
    const model = walkNamespace([doc], 'test.extendsCyclicMultiLevel');
    expect(Array.from(model.cyclicTypes)).toEqual(['Node']);
    const output = emitNamespace(model, {});
    expect(output.content).not.toContain('NodeSchema.extend(');
    expect(output.content).toContain('gpField: z.string().optional()');
    expect(output.content).toContain('child: z.lazy(() => NodeSchema).optional()');
    expect(output.content).toContain('note: z.string().optional()');

    const { z } = await import('zod');
    const js = toEvaluableJs(output.content);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const { SpecialSchema } = new Function('z', `${js}\nreturn { SpecialSchema };`)(z);
    expect(SpecialSchema.safeParse({ note: 'x', gpField: 'g', child: { gpField: 'g2', child: {} } }).success).toBe(
      true
    );
    // Without the fix, `gpField` is silently dropped from the schema shape —
    // a non-strict z.object() would still accept an EXTRA gpField key, so
    // the real regression signal is that omitting the (unenforced) field
    // does NOT fail — assert the field is actually round-tripped instead.
    const parsed = SpecialSchema.safeParse({ note: 'x', gpField: 'g', child: {} });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ gpField: 'g' });
    expect(SpecialSchema.safeParse({ note: 123, gpField: 'g' }).success).toBe(false);
  });
});
