// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * TS emitter — multi-level cross-namespace Data-extends-Choice chain
 * (item 2 follow-up of docs/superpowers/specs/2026-07-02-emitter-crossns-
 * hardening-design.md): "Verify the generic-Shape threading path
 * (findChoiceAncestor through a cross-ns intermediate) composes: a chain
 * C(ns c) extends B(ns b) extends Choice(ns a) must emit B and C both as
 * generic aliases threading T."
 *
 * Reuses the SAME fixture zod-data-extends-choice-crossns.test.ts already
 * exercises (test/fixtures/data-extends-choice-crossns-multilevel/):
 * BasketConstituent (ns c) extends ObservableItem (ns b) extends Asset
 * (choice, ns a).
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

const FIXTURE_DIR = resolve(
  new URL('.', import.meta.url).pathname,
  '../fixtures/data-extends-choice-crossns-multilevel'
);

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
      URI.parse(`inmemory:///data-extends-choice-crossns-multilevel/${baseName}.rosetta`)
    );
    docs.push(doc);
  }
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
  for (const doc of docs) {
    expect(doc.parseResult.parserErrors, 'fixture must parse without errors').toHaveLength(0);
  }
  return docs;
}

describe('TS emitter — multi-level cross-namespace Data-extends-Choice chain', () => {
  it('B (ObservableItem, the intermediate) threads its generic Shape alias on the imported AssetShape', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    const bOutput = outputs.find((o) => o.relativePath.includes('/b'));
    expect(bOutput).toBeDefined();
    expect(bOutput!.content).toContain('export type ObservableItemShape<T extends AssetShape = AssetShape> = T & {');
    const imports = bOutput!.content
      .match(/import \{([^}]+)\} from '\.\/a.js';/)![1]!
      .split(',')
      .map((name) => name.trim());
    expect(imports).toEqual(expect.arrayContaining(['Asset', 'AssetShape', 'Cash', '$Cash$Type', '$Cash$Input']));
  });

  it('C (BasketConstituent, the leaf) threads the SAME T through the intermediate B, importing AssetShape across the 2-hop chain', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    const cOutput = outputs.find((o) => o.relativePath.includes('/c'));
    expect(cOutput).toBeDefined();
    expect(cOutput!.content).toContain(
      'export type BasketConstituentShape<T extends AssetShape = AssetShape> = ObservableItemShape<T> & {'
    );
    // AssetShape lives 2 links up (ns a), imported directly into c's file
    // even though c's own document only imports ns b.
    expect(cOutput!.content).toContain('AssetShape');
  });

  it('MULTI-FILE compile check: all three namespaces typecheck together under real tsc --strict', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    expect(outputs.length).toBeGreaterThanOrEqual(3);

    const tmpDir = await generatedDirectory(join(tmpdir(), 'rune-codegen-ded-crossns-multilevel-'));
    let cPath = '';
    for (const output of outputs) {
      const outPath = join(tmpDir, output.relativePath);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, output.content, 'utf-8');
      if (output.relativePath.includes('/c')) cPath = outPath;
    }
    expect(cPath).not.toBe('');

    const compilerOptions: ts.CompilerOptions = {
      strict: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      skipLibCheck: true
    };
    const program = ts.createProgram([cPath], compilerOptions, ts.createCompilerHost(compilerOptions));
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(diagnostics).toEqual([]);
  });
});
