// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Regression coverage for the cross-namespace import-tracking gap fixed
 * alongside the unified type-reference-resolution migration: both
 * ts-emitter.ts and zod-emitter.ts's `collectCrossNamespaceImports` scanned
 * attribute/type-alias/Choice-option type references DIRECTLY
 * (`typeCall?.type?.ref`, `isData`/`isRosettaEnumeration`/`isChoice`
 * checks), never chasing through a `RosettaTypeAlias` and never scanning
 * Choice options at all — while the VALUE-emitting code
 * (resolveTypeExprAsTs/resolveTypeExpr, emitTypeAliasDeclaration/
 * emitTypeAliasSchema, emitChoiceTypeDeclaration/
 * emitChoiceShapeTypeDeclaration/emitChoiceSchema) already chased alias
 * chains via the shared `resolveTypeCallTarget` resolver. Net effect: an
 * attribute or Choice option typed via a type alias that resolves to a
 * cross-namespace Data type got a CORRECT value reference but NO matching
 * `import` line — the generated module fails to compile/load.
 *
 * Fixture (test/fixtures/crossns-alias-and-choice-import/): `Target` (a
 * Data type) lives in ns `test.xnsalias.base`. `test.xnsalias.holder`
 * declares `typeAlias AliasToTarget: Target` (1-hop) and
 * `typeAlias AliasOfAlias: AliasToTarget` (2-hop chain to the same
 * cross-namespace Data), a `Holder` type with attributes exercising all
 * three (direct/1-hop/2-hop), and `choice AssetChoice` with one option
 * typed directly as `Target` and one typed via the 1-hop alias
 * `AliasToTarget` — this exercises both the Choice-option-import gap
 * (previously: no import at all) and the field-key-vs-resolved-value split
 * (the `AliasToTarget` option's field key must stay `aliasToTarget`, not
 * become `target`).
 */

import { generatedDirectory } from '../helpers/generated-directory.js';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import { describe, it, expect } from 'vitest';
import { generate } from '../../src/export.js';

const FIXTURE_DIR = resolve(new URL('.', import.meta.url).pathname, '../fixtures/crossns-alias-and-choice-import');

async function parseFixtureFiles() {
  const runeFiles = readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.rune'))
    .sort();
  const { RuneDsl } = createRuneDslServices();
  const docs = [];
  for (const file of runeFiles) {
    const content = readFileSync(resolve(FIXTURE_DIR, file), 'utf-8');
    const baseName = file.replace(/\.rune$/, '');
    const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      content,
      URI.parse(`inmemory:///crossns-alias-and-choice-import/${baseName}.rosetta`)
    );
    docs.push(doc);
  }
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs);
  for (const doc of docs) {
    expect(doc.parseResult.parserErrors, 'fixture must parse without errors').toHaveLength(0);
  }
  return docs;
}

describe('ts-emitter — cross-namespace alias-chased & Choice-option import tracking', () => {
  it('parses with zero errors', async () => {
    await parseFixtureFiles();
  });

  it('item 1+3: a Data attribute typed directly as a cross-ns Data type imports the bare name', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    const holderOutput = outputs.find((o) => o.relativePath.includes('holder'));
    expect(holderOutput).toBeDefined();
    expect(holderOutput!.content).toContain('direct?: Target;');
  });

  it('item 1: an attribute typed via a 1-hop type alias to a cross-ns Data type produces the correct value ref AND the matching import', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    const holderOutput = outputs.find((o) => o.relativePath.includes('holder'));
    expect(holderOutput).toBeDefined();
    // Value ref: resolveTypeExprAsTs already chases the alias to the
    // terminal Data type's bare name.
    expect(holderOutput!.content).toContain('viaAlias?: Target;');
    // Import: this is the actual regression — Target must be imported once
    // for the whole file (attribute loop's fix).
    expect(holderOutput!.content).toMatch(/import \{[^}]*\bTarget\b[^}]*\} from '\.\/base\.js';/);
  });

  it('item 2: a 2-hop alias chain used as an attribute type resolves to and imports the terminal cross-ns Data type', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    const holderOutput = outputs.find((o) => o.relativePath.includes('holder'));
    expect(holderOutput).toBeDefined();
    expect(holderOutput!.content).toContain('viaChain?: Target;');
    expect(holderOutput!.content).toMatch(/import \{[^}]*\bTarget\b[^}]*\} from '\.\/base\.js';/);
  });

  it('item 3: a Choice option typed directly as a cross-ns Data type — used ONLY in the Choice (no attribute references it, so nothing else could accidentally cause the import) — imports both the bare name and the Shape name', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    const holderOutput = outputs.find((o) => o.relativePath.includes('holder'));
    expect(holderOutput).toBeDefined();
    expect(holderOutput!.content).toContain(
      'export type AssetChoice = { target: Target } | { aliasToTarget: Target } | { onlyInChoice: OnlyInChoice };'
    );
    expect(holderOutput!.content).toContain(
      'export type AssetChoiceShape = { target: TargetShape } | { aliasToTarget: TargetShape } | { onlyInChoice: OnlyInChoiceShape };'
    );
    expect(holderOutput!.content).toMatch(/import \{[^}]*\bTargetShape\b[^}]*\} from '\.\/base\.js';/);
    expect(holderOutput!.content).toMatch(/import \{[^}]*\bOnlyInChoice\b[^}]*\} from '\.\/base\.js';/);
    expect(holderOutput!.content).toMatch(/import \{[^}]*\bOnlyInChoiceShape\b[^}]*\} from '\.\/base\.js';/);
  });

  it('item 4+5: a Choice option typed via an alias to a cross-ns Data type chases the value ref through the alias but keeps the alias-derived field key', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    const holderOutput = outputs.find((o) => o.relativePath.includes('holder'));
    expect(holderOutput).toBeDefined();
    // FIELD KEY regression: `AliasToTarget` resolves to `Target`, but the
    // union arm key must stay `aliasToTarget` (alias-derived), never
    // `target` (the resolved terminal type's derived key) — that would be a
    // severe runtime-key regression for every already-working Choice.
    expect(holderOutput!.content).toContain(
      'export type AssetChoice = { target: Target } | { aliasToTarget: Target } | { onlyInChoice: OnlyInChoice };'
    );
  });

  it('MULTI-FILE compile check: holder.ts typechecks against base.ts under real tsc --strict', async () => {
    const { readdirSync: rd } = await import('node:fs');
    void rd;
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'typescript' });
    expect(outputs.length).toBeGreaterThanOrEqual(2);

    const { writeFile, mkdir } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { tmpdir } = await import('node:os');
    // TypeScript 7's default export dropped the classic synchronous
    // Compiler API — this oracle test needs the classic API, imported via
    // the scoped 'typescript-classic' alias (see package.json), matching
    // choice-typed-attribute-crossns.test.ts's precedent.
    const ts = (await import('typescript-classic')).default;

    const tmpDir = await generatedDirectory(join(tmpdir(), 'rune-codegen-crossns-alias-choice-'));
    let holderPath = '';
    for (const output of outputs) {
      const outPath = join(tmpDir, output.relativePath);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, output.content, 'utf-8');
      if (output.relativePath.includes('holder')) holderPath = outPath;
    }
    expect(holderPath).not.toBe('');

    const compilerOptions = {
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

describe('zod-emitter — cross-namespace alias-chased & Choice-option import tracking', () => {
  it('item 1: an attribute typed via a 1-hop type alias to a cross-ns Data type produces the correct value ref AND the matching import', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'zod' });
    const holderOutput = outputs.find((o) => o.relativePath.includes('holder'));
    expect(holderOutput).toBeDefined();
    expect(holderOutput!.content).toContain('viaAlias: TargetSchema.optional()');
    expect(holderOutput!.content).toMatch(/import \{[^}]*\bTargetSchema\b[^}]*\} from '\.\/base\.zod\.js';/);
  });

  it('item 2: a 2-hop alias chain used as an attribute type resolves to and imports the terminal cross-ns schema', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'zod' });
    const holderOutput = outputs.find((o) => o.relativePath.includes('holder'));
    expect(holderOutput).toBeDefined();
    expect(holderOutput!.content).toContain('viaChain: TargetSchema.optional()');
    expect(holderOutput!.content).toMatch(/import \{[^}]*\bTargetSchema\b[^}]*\} from '\.\/base\.zod\.js';/);
  });

  it('item 3+4+5: Choice options (direct, alias-typed, and choice-only) reference and import their schemas, keeping alias-derived field keys', async () => {
    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'zod' });
    const holderOutput = outputs.find((o) => o.relativePath.includes('holder'));
    expect(holderOutput).toBeDefined();
    expect(holderOutput!.content).toContain(
      'export const AssetChoiceSchema = z.union([z.strictObject({ target: TargetSchema }), z.strictObject({ aliasToTarget: TargetSchema }), z.strictObject({ onlyInChoice: OnlyInChoiceSchema })]);'
    );
    expect(holderOutput!.content).toMatch(/import \{[^}]*\bTargetSchema\b[^}]*\} from '\.\/base\.zod\.js';/);
    // item 3 isolation: OnlyInChoiceSchema is referenced ONLY by this Choice
    // option (no attribute anywhere in the fixture uses OnlyInChoice) — the
    // choice-option-scanning loop is the only thing that can produce this
    // import, so its presence directly proves that loop runs.
    expect(holderOutput!.content).toMatch(/import \{[^}]*\bOnlyInChoiceSchema\b[^}]*\} from '\.\/base\.zod\.js';/);
  });

  it('MULTI-FILE dynamic-import guard: the emitted holder module actually imports/executes TargetSchema across namespaces', async () => {
    const { mkdtempWithNodeModules } = await import('./emitted-module-dir.js');
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { pathToFileURL } = await import('node:url');

    const docs = await parseFixtureFiles();
    const outputs = await generate(docs, { target: 'zod' });
    const tmpDir = await mkdtempWithNodeModules('rune-codegen-crossns-alias-choice-zod-');
    let holderPath = '';
    for (const output of outputs) {
      const outPath = join(tmpDir, output.relativePath);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, output.content, 'utf-8');
      if (output.relativePath.includes('holder')) holderPath = outPath;
    }
    expect(holderPath).not.toBe('');

    const mod = (await import(/* @vite-ignore */ pathToFileURL(holderPath).toString())) as Record<string, unknown>;
    const schema = mod['HolderSchema'] as { safeParse: (v: unknown) => { success: boolean } };
    expect(schema).toBeDefined();
    expect(
      schema.safeParse({
        direct: { value: 1 },
        viaAlias: { value: 2 },
        viaChain: { value: 3 }
      }).success
    ).toBe(true);
  });
});
