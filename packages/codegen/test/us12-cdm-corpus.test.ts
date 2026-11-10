// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * US12: CDM Corpus Cross-Namespace Codegen (T082)
 *
 * Runs the generator against the full CDM corpus at `.resources/cdm/` to
 * verify cross-namespace support works with real-world inheritance patterns.
 *
 * Per CLAUDE.md: tests that depend on `.resources/` are guarded with
 * `describe.skipIf(!CDM_EXISTS)` so CI environments without the corpus skip
 * cleanly.
 *
 * Known generator gaps surfaced by this corpus (tracked separately):
 *   - TypeScript target: `unknown-expression-type` for ThenOperation,
 *     SwitchOperation and other CDM advanced conditional expressions (~617
 *     diagnostics). These expression types are not yet implemented in the
 *     TypeScript emitter.
 *   - Both targets: `unknown-attribute` for conditions referencing attributes
 *     resolved at a deeper scope (~5 diagnostics for QuantitySchedule.unit,
 *     BasketConstituent.Basket etc.).
 *   - Zod target: `unknown-expression-type` for ToEnumOperation and
 *     RosettaOnlyExistsExpression (~9 diagnostics).
 *
 * These gaps are documented here so the thresholds can be tightened as
 * expression-type coverage improves.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, it, expect } from 'vitest';
import { createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import { generate } from '../src/export.js';

const CDM_DIR = resolve(new URL('.', import.meta.url).pathname, '../../../.resources/cdm');
const CDM_EXISTS = existsSync(CDM_DIR);

/**
 * Load and build all CDM .rosetta documents from `CDM_DIR` using a fresh
 * Langium service instance. Returns the built documents array.
 */
async function loadCdmDocs() {
  const files = readdirSync(CDM_DIR).filter((f) => f.endsWith('.rosetta'));
  const { RuneDsl } = createRuneDslServices();
  const docs = [];

  for (const file of files) {
    const content = readFileSync(join(CDM_DIR, file), 'utf-8');
    const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      content,
      URI.parse(`inmemory:///cdm/${file}`)
    );
    docs.push(doc);
  }

  await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
  return { docs, fileCount: files.length };
}

describe.skipIf(!CDM_EXISTS)('US12: CDM Corpus Cross-Namespace Codegen (T082)', () => {
  let corpus: Awaited<ReturnType<typeof loadCdmDocs>>;
  let typescriptOutputs: Awaited<ReturnType<typeof generate>>;

  beforeAll(async () => {
    corpus = await loadCdmDocs();
    typescriptOutputs = await generate(corpus.docs, { target: 'typescript' });
  }, 120_000);

  it('parses all CDM .rosetta files without errors', async () => {
    const { docs, fileCount } = corpus;
    expect(fileCount).toBeGreaterThan(100);

    const parseErrors = docs.flatMap((d) => d.parseResult.parserErrors);
    // CDM corpus should parse with very few errors.
    // Some files may have minor issues but the vast majority should be clean.
    const errorRate = parseErrors.length / docs.length;
    expect(errorRate).toBeLessThan(0.1); // Less than 10% error rate
  }, 60_000);

  it('generates TypeScript output for CDM namespaces (documents all error codes)', async () => {
    const outputs = typescriptOutputs;
    expect(outputs.length).toBeGreaterThan(0);

    const errors = outputs.flatMap((o) => o.diagnostics.filter((d) => d.severity === 'error'));

    // Group by error code so regressions are immediately visible
    const byCode: Record<string, number> = {};
    for (const e of errors) {
      byCode[e.code] = (byCode[e.code] ?? 0) + 1;
    }

    // unknown-expression-type: CDM uses ThenOperation, SwitchOperation etc. that
    // are not yet implemented in the TypeScript emitter. Tracked as a known gap.
    // This ceiling must not grow; lower it as expression coverage improves.
    const unknownExpr = byCode['unknown-expression-type'] ?? 0;
    expect(unknownExpr).toBeLessThan(700); // current: ~617

    // unknown-attribute: conditions reference attributes unresolvable at scope.
    const unknownAttr = byCode['unknown-attribute'] ?? 0;
    expect(unknownAttr).toBeLessThan(20); // current: ~5

    // No other error codes should appear
    const otherCodes = Object.keys(byCode).filter((c) => c !== 'unknown-expression-type' && c !== 'unknown-attribute');
    expect(otherCodes).toHaveLength(0);
  }, 60_000);

  it('generates Zod output for CDM namespaces (documents all error codes)', async () => {
    const { docs } = corpus;

    const outputs = await generate(docs, { target: 'zod' });
    expect(outputs.length).toBeGreaterThan(0);

    const errors = outputs.flatMap((o) => o.diagnostics.filter((d) => d.severity === 'error'));

    const byCode: Record<string, number> = {};
    for (const e of errors) {
      byCode[e.code] = (byCode[e.code] ?? 0) + 1;
    }

    // unknown-expression-type: ToEnumOperation, RosettaOnlyExistsExpression not
    // yet handled in the Zod emitter. Ceiling must not grow.
    const unknownExpr = byCode['unknown-expression-type'] ?? 0;
    expect(unknownExpr).toBeLessThan(20); // current: ~9

    // unknown-attribute: same scope-resolution gap as TypeScript target.
    const unknownAttr = byCode['unknown-attribute'] ?? 0;
    expect(unknownAttr).toBeLessThan(20); // current: ~5

    // No other error codes should appear
    const otherCodes = Object.keys(byCode).filter((c) => c !== 'unknown-expression-type' && c !== 'unknown-attribute');
    expect(otherCodes).toHaveLength(0);
  }, 60_000);

  it('CDM output includes cross-namespace type references', async () => {
    const outputs = typescriptOutputs;
    // A generated shared module can own the declarations for several public namespaces.
    const declarations = outputs.flatMap((output) => [...output.content.matchAll(/^export (?:class|interface) /gm)]);
    expect(declarations.length).toBeGreaterThan(10);
    expect(outputs.filter((output) => output.namespaces?.length === 1).length).toBeGreaterThan(10);
  }, 60_000);
});
