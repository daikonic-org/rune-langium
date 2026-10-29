// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * TS emitter — cross-namespace Data-extends-Data (item 2 of
 * docs/superpowers/specs/2026-07-02-emitter-crossns-hardening-design.md).
 *
 * `ts-emitter.ts` gates all supertype emission on `parentInNamespace =
 * parentRef && isData(parentRef) && this.ctx.dataByName.has(name)` at three
 * sites (emitInterface, emitClass, emitTypeGuard) — a parent Data in
 * ANOTHER namespace fails `dataByName.has` (that map only holds THIS
 * namespace's own Data nodes), so the interface silently loses `extends
 * <Parent>Shape`, the class loses `extends <Parent>`, and the guard loses
 * the parent chain. Meanwhile `collectCrossNamespaceImports` already
 * tracks and emits `import { <Parent>Shape, <Parent> }` for exactly this
 * case — so those imports were unused before this fix (assert one is now
 * load-bearing).
 *
 * Fixture: `Dog extends Animal` where `Animal` lives in
 * test.dedxns.base and `Dog` in test.dedxns.product (test/fixtures/
 * data-extends-data-crossns/).
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

const FIXTURE_DIR = resolve(new URL('.', import.meta.url).pathname, '../fixtures/data-extends-data-crossns');

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
      URI.parse(`inmemory:///data-extends-data-crossns/${baseName}.rosetta`)
    );
    docs.push(doc);
  }
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
  for (const doc of docs) {
    expect(doc.parseResult.parserErrors, 'fixture must parse without errors').toHaveLength(0);
  }
  return docs;
}

describe('TS emitter — cross-namespace Data extends Data', () => {
  it('parses with zero errors', async () => {
    await parseFixtureFiles();
  });

  it('the interface extends the cross-namespace parent Shape (not silently dropped)', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    const productOutput = outputs.find((o) => o.relativePath.includes('product'));
    expect(productOutput).toBeDefined();
    expect(productOutput!.content).toContain('export interface DogShape extends AnimalShape');
  });

  it('the class extends the cross-namespace parent (not silently dropped)', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    const productOutput = outputs.find((o) => o.relativePath.includes('product'));
    expect(productOutput).toBeDefined();
    expect(productOutput!.content).toContain('export class $Dog$Data extends $Animal$Data implements DogShape');
  });

  it('the type guard overload set includes the cross-namespace parent chain (not silently dropped)', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    const productOutput = outputs.find((o) => o.relativePath.includes('product'));
    expect(productOutput).toBeDefined();
    expect(productOutput!.content).toContain('export function isDog(x: Animal): x is Dog;');
  });

  it('the previously-unused cross-namespace import is now load-bearing', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    const productOutput = outputs.find((o) => o.relativePath.includes('product'));
    expect(productOutput).toBeDefined();
    const imports = productOutput!.content
      .match(/import \{([^}]+)\} from '\.\/base.js';/)![1]!
      .split(',')
      .map((name) => name.trim());
    expect(imports).toEqual(expect.arrayContaining(['$Animal$Data', 'Animal', 'AnimalShape']));
  });

  it('MULTI-FILE compile check: both emitted namespaces typecheck together under real tsc --strict', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    expect(outputs.length).toBeGreaterThanOrEqual(2);

    const tmpDir = await generatedDirectory(join(tmpdir(), 'rune-codegen-ded-crossns-'));
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
