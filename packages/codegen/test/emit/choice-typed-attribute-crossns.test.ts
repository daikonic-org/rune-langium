// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Both emitters — Choice-TYPED attribute cross-namespace import tracking
 * (item 3 of docs/superpowers/specs/2026-07-02-emitter-crossns-hardening-
 * design.md, item 4's zod multi-file guard folded in per the design doc's
 * "this may fold into item 3's test work naturally").
 *
 * `collectCrossNamespaceImports`'s attribute loop in BOTH ts-emitter.ts and
 * zod-emitter.ts only tracks `isData`/`isRosettaEnumeration` attribute
 * types — a Choice-typed attribute resolves to the bare Choice union name
 * (ts) / `<Choice>Schema` (zod) via `resolveTypeExprAsTs`/`resolveTypeExpr`
 * (both already consult `isChoice`, per W2), but the symbol is never
 * imported cross-namespace, producing a broken reference the moment the
 * Choice lives in another namespace.
 *
 * Fixture: `Holder` (ns test.ctaxns.holder) has an attribute `asset Asset
 * (0..1)` where `Asset` is a choice declared in ns test.ctaxns.base
 * (test/fixtures/choice-typed-attribute-crossns/).
 */

import { generatedDirectory } from '../helpers/generated-directory.js';
import { readFileSync, readdirSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
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
import { mkdtempWithNodeModules } from './emitted-module-dir.js';
import { generate } from '../../src/export.js';

const FIXTURE_DIR = resolve(new URL('.', import.meta.url).pathname, '../fixtures/choice-typed-attribute-crossns');

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
      URI.parse(`inmemory:///choice-typed-attribute-crossns/${baseName}.rosetta`)
    );
    docs.push(doc);
  }
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
  for (const doc of docs) {
    expect(doc.parseResult.parserErrors, 'fixture must parse without errors').toHaveLength(0);
  }
  return docs;
}

describe('TS emitter — Choice-typed attribute cross-namespace import', () => {
  it('parses with zero errors', async () => {
    await parseFixtureFiles();
  });

  it('imports the bare Choice union name used by the attribute type', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    const holderOutput = outputs.find((o) => o.relativePath.includes('holder'));
    expect(holderOutput).toBeDefined();
    expect(holderOutput!.content).toContain("import { Asset } from './base.js';");
    expect(holderOutput!.content).toContain('asset?: Asset;');
  });

  it('MULTI-FILE compile check: both namespaces typecheck together under real tsc --strict', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    expect(outputs.length).toBeGreaterThanOrEqual(2);

    const tmpDir = await generatedDirectory(join(tmpdir(), 'rune-codegen-choice-attr-crossns-'));
    let holderPath = '';
    for (const output of outputs) {
      const outPath = join(tmpDir, output.relativePath);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, output.content, 'utf-8');
      if (output.relativePath.includes('holder')) holderPath = outPath;
    }
    expect(holderPath).not.toBe('');

    const compilerOptions: ts.CompilerOptions = {
      strict: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      skipLibCheck: true
    };
    const program = ts.createProgram([holderPath], compilerOptions, ts.createCompilerHost(compilerOptions));
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(diagnostics).toEqual([]);
  });
});

describe('zod emitter — Choice-typed attribute cross-namespace import', () => {
  it('imports <Choice>Schema used by the attribute type', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'zod' });
    const holderOutput = outputs.find((o) => o.relativePath.includes('holder'));
    expect(holderOutput).toBeDefined();
    expect(holderOutput!.content).toContain("import { AssetSchema } from './base.zod.js';");
    expect(holderOutput!.content).toContain('asset: AssetSchema.optional()');
  });

  it('MULTI-FILE dynamic-import guard: the emitted holder module actually imports/executes AssetSchema across namespaces (item 4)', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'zod' });
    const tmpDir = await mkdtempWithNodeModules('rune-codegen-choice-attr-crossns-zod-');
    let holderPath = '';
    for (const output of outputs) {
      const outPath = join(tmpDir, output.relativePath);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, output.content, 'utf-8');
      if (output.relativePath.includes('holder')) holderPath = outPath;
    }
    expect(holderPath).not.toBe('');

    // Dynamic-import the REAL emitted holder module — the exact failure
    // mode the missing import produces is a ReferenceError at module-init
    // (`AssetSchema is not defined`), which a single-file virtual check
    // cannot catch.
    const mod = (await import(/* @vite-ignore */ pathToFileURL(holderPath).toString())) as Record<string, unknown>;
    const schema = mod['HolderSchema'] as { safeParse: (v: unknown) => { success: boolean } };
    expect(schema).toBeDefined();
    expect(schema.safeParse({ name: 'x', asset: { cash: { amount: 5 } } }).success).toBe(true);
    expect(schema.safeParse({ name: 'x', asset: { cash: { amount: 5 }, commodity: { quantity: 1 } } }).success).toBe(
      false
    );
  });
});
