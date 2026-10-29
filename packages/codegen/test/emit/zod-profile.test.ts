// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Fixture-based tests for `zodProfile` (019 Phase 0.5.2) — exercises
 * `runGenerate` end-to-end against a real 2-namespace model and checks
 * the output structure for each Zod layout.
 *
 * Per-namespace layout (today's library default): no behavior change.
 * Barrel layout: per-namespace files (with import from runtime sidecar
 * instead of inline helpers), one `index.zod.ts`, one `runtime.zod.ts`.
 * Single-file layout: one `model.zod.ts` containing all schemas plus
 * the inlined helpers; the size-limit branch is exercised separately.
 */

import { writeFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript-classic';
import { join, dirname } from 'node:path';
import { mkdtempWithNodeModules } from './emitted-module-dir.js';
import { pathToFileURL } from 'node:url';
import { describe, it, expect } from 'vitest';
import { createRuneDslServices, assertValidDocuments } from '@rune-langium/core';
import { URI } from 'langium';
import { z } from 'zod';
import { generate } from '../../src/export.js';

const SOURCE_A = `namespace foo

type Trade:
  tradeId string (1..1)
  quantity number (1..1)
`;

const SOURCE_B = `namespace bar

type Party:
  name string (1..1)
`;

async function parseTwoNamespaces() {
  const { RuneDsl } = createRuneDslServices();
  const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
  const builder = RuneDsl.shared.workspace.DocumentBuilder;
  const docA = factory.fromString(SOURCE_A, URI.parse('inmemory:///foo.rosetta'));
  const docB = factory.fromString(SOURCE_B, URI.parse('inmemory:///bar.rosetta'));
  await builder.build([docA, docB], { validation: false });
  return [docA, docB];
}

describe('Zod LanguageProfile (019 Phase 0.5.2)', () => {
  it('per-namespace layout (library default) is unchanged: one file per namespace, inlined helpers', async () => {
    const docs = await parseTwoNamespaces();
    const outputs = await generate(docs, { target: 'zod' });

    const paths = outputs.map((o) => o.relativePath).sort();
    expect(paths).toEqual(['bar.zod.ts', 'foo.zod.ts']);

    // Each per-namespace file still inlines the helper block.
    for (const out of outputs) {
      expect(out.content).toContain('const runeCheckOneOf = (values:');
      expect(out.content).toContain(`import { z } from 'zod';`);
      // And does NOT pull from a sidecar.
      expect(out.content).not.toContain(`from './runtime.zod.js'`);
    }
  });

  it('barrel layout emits per-namespace files + index.zod.ts + runtime.zod.ts', async () => {
    const docs = await parseTwoNamespaces();
    const outputs = await generate(docs, { target: 'zod', zod: { layout: 'barrel' } });

    const paths = outputs.map((o) => o.relativePath).sort();
    expect(paths).toEqual(['bar.zod.ts', 'foo.zod.ts', 'index.zod.ts', 'runtime.zod.ts']);

    // Per-namespace files no longer inline the helper block — they
    // import it from the sidecar.
    const fooOutput = outputs.find((o) => o.relativePath === 'foo.zod.ts');
    expect(fooOutput?.content).toContain(
      `import { rune, type RuneFuncData, runeExtendChoice } from './runtime.zod.js';`
    );
    expect(fooOutput?.content).not.toContain('// --- rune-codegen runtime helpers (inlined) ---');

    // index.zod.ts re-exports each namespace module.
    const indexOutput = outputs.find((o) => o.relativePath === 'index.zod.ts');
    expect(indexOutput?.content).toContain(`export * from './foo.zod.js';`);
    expect(indexOutput?.content).toContain(`export * from './bar.zod.js';`);

    // runtime.zod.ts ships the helpers as `export const`.
    const runtimeOutput = outputs.find((o) => o.relativePath === 'runtime.zod.ts');
    expect(runtimeOutput?.content).toContain(`export const runeCheckOneOf`);
    expect(runtimeOutput?.content).toContain(`export const runeCount`);
    expect(runtimeOutput?.content).toContain(`export const runeAttrExists`);
    // ...including runeExtendChoice, which is the sidecar's ONLY
    // z-dependent helper — the sidecar header must therefore import z.
    // (PR-review finding: the header had no `import { z } from 'zod';`,
    // so every barrel/single-file bundle's runtime.zod.ts failed
    // typecheck and threw ReferenceError at module-init.)
    expect(runtimeOutput?.content).toContain(`export const runeExtendChoice`);
    expect(runtimeOutput?.content).toContain(`import { z } from 'zod';`);
  });

  it('resolves the shared runtime from a nested namespace', async () => {
    const { RuneDsl } = createRuneDslServices();
    const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      SOURCE_A.replace('namespace foo', 'namespace foo.bar'),
      URI.parse('inmemory:///nested.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);
    const outputs = await generate(doc, { target: 'zod', zod: { layout: 'barrel' } });
    expect(outputs.find((output) => output.relativePath === 'foo/bar.zod.ts')?.content).toContain(
      "from '../runtime.zod.js'"
    );
  });

  it('the runtime.zod.ts sidecar actually executes: runeExtendChoice works when imported (no ReferenceError on z)', async () => {
    const docs = await parseTwoNamespaces();
    const outputs = await generate(docs, { target: 'zod', zod: { layout: 'barrel' } });
    const runtimeOutput = outputs.find((o) => o.relativePath === 'runtime.zod.ts');
    expect(runtimeOutput).toBeDefined();

    // Write the REAL sidecar to disk and dynamic-import it — module-init
    // evaluates `export const runeExtendChoice = ...`, and CALLING it
    // executes `z.union(...)`: both steps threw `ReferenceError: z is not
    // defined` before the header imported z. Mirrors the emitted-runtime
    // pattern of zod-data-extends-choice.test.ts.
    const tmpDir = await mkdtempWithNodeModules('rune-codegen-zod-sidecar-');
    const sidecarPath = join(tmpDir, 'runtime.zod.ts');
    await writeFile(sidecarPath, runtimeOutput!.content, 'utf-8');
    const mod = (await import(/* @vite-ignore */ pathToFileURL(sidecarPath).toString())) as Record<string, unknown>;

    const runeExtendChoice = mod['runeExtendChoice'] as (
      choice: unknown,
      shape: unknown
    ) => {
      safeParse: (v: unknown) => { success: boolean };
    };
    expect(typeof runeExtendChoice).toBe('function');

    const choice = z.union([z.strictObject({ cash: z.number() }), z.strictObject({ stock: z.string() })]);
    const extended = runeExtendChoice(choice, { weight: z.number().optional() });
    expect(extended.safeParse({ cash: 1, weight: 2 }).success).toBe(true);
    expect(extended.safeParse({ weight: 2 }).success).toBe(false);
  });

  it('single-file layout emits one model.zod.ts (no helpers in the sidecar slot for single-file)', async () => {
    const docs = await parseTwoNamespaces();
    const outputs = await generate(docs, { target: 'zod', zod: { layout: 'single-file' } });

    const paths = outputs.map((o) => o.relativePath).sort();
    // Single-file still ships the runtime sidecar (Profile's
    // `makeSharedArtifacts` always returns it). The model file is the
    // canonical artifact; the sidecar is informational.
    expect(paths).toEqual(['model.zod.ts', 'runtime.zod.ts']);

    const model = outputs.find((o) => o.relativePath === 'model.zod.ts');
    // One canonical header, one Zod import, one inlined helpers block.
    expect((model?.content.match(/import \{ z \} from 'zod';/g) ?? []).length).toBe(1);
    expect((model?.content.match(/const runeCheckOneOf = \(values:/g) ?? []).length).toBe(1);
    expect((model?.content.match(/const runeExtendChoice = /g) ?? []).length).toBe(1);
    // Both namespace bodies present, with stripped per-namespace headers.
    expect(model?.content).toContain('TradeSchema');
    expect(model?.content).toContain('PartySchema');
    // No leftover per-namespace header lines after strip.
    expect((model?.content.match(/^\/\/ Source namespace:/gm) ?? []).length).toBe(0);
  });

  it('single-file layout fires the size guardrail when maxNamespaces is exceeded', async () => {
    // Build a 51-namespace model to trip the maxNamespaces=50 default.
    const { RuneDsl } = createRuneDslServices();
    const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
    const builder = RuneDsl.shared.workspace.DocumentBuilder;
    const docs = [];
    for (let i = 0; i < 51; i++) {
      docs.push(
        factory.fromString(
          `namespace ns${i}\n\ntype T${i}:\n  x string (1..1)\n`,
          URI.parse(`inmemory:///ns${i}.rosetta`)
        )
      );
    }
    await builder.build(docs, { validation: false });

    const outputs = await generate(docs, {
      target: 'zod',
      zod: { layout: 'single-file' }
    });

    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'single-file-too-large'
    });
    expect(outputs[0]?.diagnostics[0]?.message).toContain('51 > 50');
  });
});

it.each(['per-namespace', 'barrel', 'single-file'] as const)(
  'compiles and executes calendar conditions in the %s Zod layout',
  async (layout) => {
    const { RuneDsl } = createRuneDslServices();
    await RuneDsl.shared.workspace.WorkspaceManager.initializeWorkspace([]);
    const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      `namespace calendar.compare

type DateWindow:
  start date (1..1)
  end date (1..1)
  condition Ordered: start < end

type TimeWindow:
  start time (1..1)
  end time (1..1)
  condition Ordered: start < end

type ZonedWindow:
  start zonedDateTime (1..1)
  end zonedDateTime (1..1)
  condition Ordered: start < end
`,
      URI.parse('inmemory:///calendar.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);
    assertValidDocuments([doc]);
    const outputs = await generate(doc, { target: 'zod', zod: { layout } });
    expect(outputs.flatMap((output) => output.diagnostics.filter((d) => d.severity === 'error'))).toEqual([]);
    const directory = await mkdtempWithNodeModules('rune-zod-calendar-');
    try {
      await writeFile(join(directory, 'package.json'), '{"type":"commonjs"}');
      const files = await Promise.all(
        outputs.map(async (output) => {
          const file = join(directory, output.relativePath);
          await mkdir(dirname(file), { recursive: true });
          await writeFile(file, output.content);
          return file;
        })
      );
      const program = ts.createProgram(files, {
        strict: true,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        skipLibCheck: true,
        types: []
      });
      expect(
        ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      ).toEqual([]);
      program.emit();
      const entry = layout === 'single-file' ? 'model' : layout === 'barrel' ? 'index' : 'calendar/compare';
      const schemas = createRequire(join(directory, 'entry.js'))(`./${entry}.zod.js`);
      for (const [name, start, end] of [
        ['DateWindowSchema', '2025-12-31', '2026-01-01'],
        ['TimeWindowSchema', '09:30:00', '10:30:00'],
        ['ZonedWindowSchema', '2026-01-01T00:30:00+05:30', '2025-12-31T20:00:00Z']
      ] as const) {
        expect(schemas[name].safeParse({ start, end }).success).toBe(true);
        expect(schemas[name].safeParse({ start: end, end: start }).success).toBe(false);
        expect(schemas[name].safeParse({ start, end: start }).success).toBe(false);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);
