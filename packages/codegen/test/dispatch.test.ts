// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Contract-dispatch tests for `runGenerate` (018 Phase 0 Task 0.4).
 *
 * Locks in:
 * - Unknown / not-yet-registered targets return a single
 *   not-implemented diagnostic (one per request, not per namespace).
 * - The registered targets (zod, typescript, json-schema) still produce
 *   one output per namespace via the NamespaceEmitter dispatch path.
 * - generate() is async and returns Promise<GeneratorOutput[]>.
 */

import { describe, it, expect } from 'vitest';
import { createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import { generate, GeneratorError, IMPLEMENTED_TARGETS } from '../src/export.js';

const RUNE_SOURCE = `namespace cdm.base.math

type Quantity:
  amount number (1..1)
  currency string (0..1)
`;

async function parseInput() {
  const { RuneDsl } = createRuneDslServices();
  const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    RUNE_SOURCE,
    URI.parse('inmemory:///dispatch-test.rosetta')
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([doc], { validation: false });
  return doc;
}

describe('runGenerate dispatch (018 Task 0.4)', () => {
  it('rejects targets without a registered emitter with a not-implemented diagnostic', async () => {
    const doc = await parseInput();
    const outputs = await generate(doc, { target: 'markdown' });
    // Phase 2 shipped the SQL emitter; markdown (also P2) + graphql (P3) remain unregistered.
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.diagnostics.some((d) => d.code === 'not-implemented')).toBe(true);
    expect(outputs[0]?.diagnostics[0]?.message).toContain("'markdown'");
  });

  it('produces one output per namespace for registered NamespaceEmitter targets', async () => {
    const doc = await parseInput();
    const outputs = await generate(doc, { target: 'zod' });
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.relativePath).toMatch(/cdm\/base\/math\.zod\.ts$/);
    expect(outputs[0]?.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('produces one .sql output per namespace for the sql target (Phase 2)', async () => {
    const doc = await parseInput();
    const outputs = await generate(doc, { target: 'sql' });
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.relativePath).toBe('cdm/base/math.sql');
    expect(outputs[0]?.content).toContain('CREATE TABLE "Quantity"');
    expect(outputs[0]?.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('generate() returns a Promise<GeneratorOutput[]>', async () => {
    const doc = await parseInput();
    // Capture the call inside a wrapper so an over-eager auto-fixer
    // doesn't insert `await` between us and the Promise we want to
    // poke at directly.
    const callOnce = (): unknown => generate(doc, { target: 'zod' });
    const result = callOnce();
    expect(typeof (result as Promise<unknown>).then).toBe('function');
    const resolved = await result;
    expect(Array.isArray(resolved)).toBe(true);
  });

  // 018 Task 0.7 follow-up — IMPLEMENTED_TARGETS must reflect every
  // target whose emitter is registered, and only those. Phase 1/2/3
  // commits will add to this list as emitters land.
  it('IMPLEMENTED_TARGETS lists exactly the targets with a registered emitter', () => {
    // 019 Phase 1 added 'excel'; Phase 2 added 'sql'; 021 Phase 2b added
    // 'openapi'; 021 Phase 3 added 'xsd'. markdown (P2) + graphql (P3) pending.
    expect([...IMPLEMENTED_TARGETS].sort()).toEqual([
      'excel',
      'json-schema',
      'openapi',
      'python',
      'sql',
      'typescript',
      'xsd',
      'zod'
    ]);
  });

  it('IMPLEMENTED_TARGETS is frozen so callers cannot mutate it', () => {
    expect(Object.isFrozen(IMPLEMENTED_TARGETS)).toBe(true);
  });

  // Codex review on PR #165 — the not-implemented short-circuit used to
  // return early and bypass the strict-mode GeneratorError check below.
  // This locks the new behavior: strict: true throws on unimplemented
  // targets so callers like the CLI can fail fast.
  it('throws GeneratorError when strict: true and the target is not implemented', async () => {
    const doc = await parseInput();
    await expect(generate(doc, { target: 'markdown', strict: true })).rejects.toBeInstanceOf(GeneratorError);
  });

  // 019 Phase 0.5.1 + Copilot review on PR #166 — dispatch on
  // options.<target>.layout. Library default is 'per-namespace';
  // 'barrel' / 'single-file' route through GenericModelEmitter when
  // a Profile is registered; unknown layouts produce an invalid-layout
  // diagnostic.

  it('library default (`options.zod.layout` unset) returns per-namespace output unchanged', async () => {
    const doc = await parseInput();
    const outputs = await generate(doc, { target: 'zod' });
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.relativePath).toMatch(/cdm\/base\/math\.zod\.ts$/);
  });

  it("explicit `layout: 'barrel'` returns per-namespace + index + runtime sidecar", async () => {
    const doc = await parseInput();
    const outputs = await generate(doc, { target: 'zod', zod: { layout: 'barrel' } });
    const paths = outputs.map((o) => o.relativePath).sort();
    expect(paths).toContain('index.zod.ts');
    expect(paths).toContain('runtime.zod.ts');
  });

  it("explicit `layout: 'single-file'` returns one model.zod.ts plus the runtime sidecar", async () => {
    const doc = await parseInput();
    const outputs = await generate(doc, { target: 'zod', zod: { layout: 'single-file' } });
    const paths = outputs.map((o) => o.relativePath).sort();
    expect(paths).toEqual(['model.zod.ts', 'runtime.zod.ts']);
  });

  it('invalid layout produces an `invalid-layout` fatal diagnostic', async () => {
    const doc = await parseInput();
    const outputs = await generate(doc, {
      target: 'zod',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zod: { layout: 'totally-bogus' as any }
    });
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'invalid-layout'
    });
  });

  it('strict-mode invalid layout throws GeneratorError', async () => {
    const doc = await parseInput();
    await expect(
      generate(doc, {
        target: 'zod',
        strict: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        zod: { layout: 'totally-bogus' as any }
      })
    ).rejects.toBeInstanceOf(GeneratorError);
  });
});
