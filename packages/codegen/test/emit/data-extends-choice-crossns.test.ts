// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Data-extends-Choice — CROSS-NAMESPACE supertype (Data in ns A extends a
 * Choice in ns B).
 *
 * Real corpus template: `TransferableProduct extends Asset`
 * (.resources/cdm/product-template-type.rosetta:23) and `SpecificAsset
 * extends Asset` (.resources/cdm/product-collateral-type.rosetta:362),
 * with the `Asset` choice living in cdm.base.staticdata.asset.common.
 *
 * Closes a reviewer Important finding: `collectCrossNamespaceImports`
 * (ts-emitter.ts) tracks `${parentRef.name}Shape` for the supertype
 * UNGATED on isData — so for a cross-namespace Choice supertype it emits
 * `import { Asset, AssetShape }`. Before Choices emitted a Shape-level
 * union, `AssetShape` did not exist → TS2305 broken import (pre-existing
 * at the branch base, latent for the two real corpus decls above). Now
 * that emitChoiceShapeTypeDeclaration emits `<Choice>Shape`, the same
 * ungated tracking resolves to a real symbol — this suite pins that with
 * a MULTI-FILE compile check (the single-file compile checks in
 * ts-data-extends-choice.test.ts structurally cannot catch a cross-ns
 * import break: the import line only errors when the imported module is
 * actually resolved and its exports checked).
 */

import { generatedDirectory } from '../helpers/generated-directory.js';
import { readFileSync, readdirSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import { describe, it, expect } from 'vitest';
// TypeScript 7's default export dropped the classic synchronous Compiler
// API (createProgram/getPreEmitDiagnostics/etc.) in favor of the new
// typescript/unstable/sync RPC-style API. This oracle test needs the
// classic API to compile+typecheck the codegen's own generated output,
// so it imports a scoped legacy 'typescript-classic' alias (see
// package.json) instead of the workspace-wide TS7 'typescript'.
import ts from 'typescript-classic';
import { generate } from '../../src/export.js';

const FIXTURE_DIR = resolve(new URL('.', import.meta.url).pathname, '../fixtures/data-extends-choice-crossns');

async function parseFixtureFiles() {
  const runeFiles = readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.rune'))
    .sort();
  const { RuneDsl } = createRuneDslServices();
  const docs = [];
  for (const file of runeFiles) {
    const content = readFileSync(join(FIXTURE_DIR, file), 'utf-8');
    const baseName = file.replace(/\.rune$/, '');
    const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      content,
      URI.parse(`inmemory:///data-extends-choice-crossns/${baseName}.rosetta`)
    );
    docs.push(doc);
  }
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
  for (const doc of docs) {
    expect(doc.parseResult.parserErrors, 'fixture must parse without errors').toHaveLength(0);
  }
  return docs;
}

describe('Data-extends-Choice — cross-namespace Choice supertype', () => {
  it('parses with zero errors (ground-truth check before any assertion depends on the fixture)', async () => {
    await parseFixtureFiles();
  });

  it('imports BOTH the bare Choice union and its Shape-level union from the supertype namespace', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    const productOutput = outputs.find((o) => o.relativePath.includes('product'));
    expect(productOutput).toBeDefined();
    // `AssetShape` must be a REAL exported symbol of the base namespace
    // (emitChoiceShapeTypeDeclaration) — this import line was a TS2305
    // broken import before Choices emitted a Shape-level union. The path
    // is `./base.js` (sibling FILES in the same directory per
    // getTargetRelativePath's layout) — previously emitted as the
    // unresolvable `../base.js` (resolveImportPath's off-by-one, fixed
    // alongside this suite).
    expect(productOutput!.content).toMatch(/import \{[^}]*\bAsset, AssetShape\b[^}]*\} from '\.\/base.js';/);
  });

  it('the child constrains its generic Shape alias and class on the imported <Choice>Shape', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    const productOutput = outputs.find((o) => o.relativePath.includes('product'));
    expect(productOutput).toBeDefined();
    expect(productOutput!.content).toContain(
      'export type TransferableProductShape<T extends AssetShape = AssetShape> = T & {\n  weight?: number;\n};'
    );
    expect(productOutput!.content).toContain(
      'export class $TransferableProduct$Data<T extends AssetShape = AssetShape>'
    );
  });

  it('MULTI-FILE compile check: both emitted namespaces typecheck together under real tsc --strict (imports actually resolved)', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    expect(outputs.length).toBeGreaterThanOrEqual(2);

    // Write the REAL emitted files to disk preserving the relativePath
    // layout (so the emitted `./base.js` specifier resolves), then run a
    // real ts.createProgram over the importing file — TS's NodeNext
    // resolution maps the emitted `.js` specifiers back to the on-disk
    // `.ts` sources, so a nonexistent imported symbol (the old TS2305
    // break) fails HERE, where a single-file virtual check cannot see it.
    const tmpDir = await generatedDirectory(join(tmpdir(), 'rune-codegen-dec-crossns-'));
    let productPath = '';
    for (const output of outputs) {
      const outPath = join(tmpDir, output.relativePath);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, output.content, 'utf-8');
      if (output.relativePath.includes('product')) productPath = outPath;
    }
    expect(productPath).not.toBe('');

    const compilerOptions: ts.CompilerOptions = {
      strict: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      skipLibCheck: true
    };
    const program = ts.createProgram([productPath], compilerOptions, ts.createCompilerHost(compilerOptions));
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(diagnostics).toEqual([]);
  });
});
