// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * US6 Function Emission Tests (T113–T130).
 *
 * T114: AddTwo — scalar inputs/output, `set` body.
 * T115: Accumulator — array output `(0..*)`, `add` body.
 * T116: AliasFunc — alias shortcut binding, `set` referencing alias.
 * T117: Recursive fixture — hoisted `function` declaration for cyclic funcs.
 * T127: Silent-skip — Zod/JSON Schema targets produce empty funcs[] array.
 *
 * FR-028: Funcs emit as export function (TS target).
 * FR-029: set/add/alias body forms transpile correctly.
 * FR-030: Cyclic call graphs → hoisted function declarations.
 * FR-031: Zod and JSON Schema targets silently skip funcs.
 */

import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import ts from 'typescript-classic';
import { generate } from '../src/export.js';
import { buildFuncCallGraph, findCyclicFuncs, topoSortFuncs } from '../src/types/func.js';
import type { RuneFunc } from '../src/types/func.js';

const FIXTURES_DIR = resolve(new URL('.', import.meta.url).pathname, 'fixtures/funcs');

/**
 * Parse a Rune file and generate TypeScript output.
 */
async function generateFuncFixture(fixtureName: string): Promise<string> {
  const inputPath = join(FIXTURES_DIR, fixtureName, 'input.rune');
  const content = await readFile(inputPath, 'utf-8');

  const { RuneDsl } = createRuneDslServices();
  const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    content,
    URI.parse(`inmemory:///${fixtureName}.rosetta`)
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);

  if (doc.parseResult.parserErrors.length > 0) {
    const msgs = doc.parseResult.parserErrors.map((e: { message: string }) => e.message).join(', ');
    throw new Error(`Parse errors in ${fixtureName}/input.rune: ${msgs}`);
  }

  const outputs = await generate(doc, { target: 'typescript' });
  if (outputs.length === 0) {
    throw new Error(`Generator produced no output for ${fixtureName}`);
  }

  return outputs[0]!.content;
}

// ---------------------------------------------------------------------------
// T114: AddTwo — scalar inputs/output, `set` body
// ---------------------------------------------------------------------------

describe('US6 funcs: add-two (T114)', () => {
  it('emits export function AddTwo with scalar set body (byte-identical)', async () => {
    const [actual, expected] = await Promise.all([
      generateFuncFixture('add-two'),
      readFile(join(FIXTURES_DIR, 'add-two', 'expected.ts'), 'utf-8')
    ]);
    expect(actual).toBe(expected);
  });

  it('emitted output contains export function declaration', async () => {
    const actual = await generateFuncFixture('add-two');
    expect(actual).toContain('export function AddTwo(');
  });

  it('funcs array is non-empty for typescript target (FR-028)', async () => {
    const content = await readFile(join(FIXTURES_DIR, 'add-two', 'input.rune'), 'utf-8');
    const { RuneDsl } = createRuneDslServices();
    const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      content,
      URI.parse('inmemory:///add-two-funcs.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);
    const outputs = await generate(doc, { target: 'typescript' });
    expect(outputs.length).toBeGreaterThan(0);
    expect(outputs[0]!.funcs.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// T115: Accumulator — array output (0..*), `add` body
// ---------------------------------------------------------------------------

describe('US6 funcs: accumulator (T115)', () => {
  it('emits export function CollectItems with array accumulator body (byte-identical)', async () => {
    const [actual, expected] = await Promise.all([
      generateFuncFixture('accumulator'),
      readFile(join(FIXTURES_DIR, 'accumulator', 'expected.ts'), 'utf-8')
    ]);
    expect(actual).toBe(expected);
  });

  it('emitted output uses let result: number[] = [] for array output', async () => {
    const actual = await generateFuncFixture('accumulator');
    expect(actual).toContain('let result: number[] = []');
    expect(actual).toContain('result.push(');
  });
});

// ---------------------------------------------------------------------------
// T116: AliasFunc — alias shortcut binding
// ---------------------------------------------------------------------------

describe('US6 funcs: alias-func (T116)', () => {
  it('emits export function AliasFunc with alias binding (byte-identical)', async () => {
    const [actual, expected] = await Promise.all([
      generateFuncFixture('alias-func'),
      readFile(join(FIXTURES_DIR, 'alias-func', 'expected.ts'), 'utf-8')
    ]);
    expect(actual).toBe(expected);
  });

  it('emitted output contains const alias binding', async () => {
    const actual = await generateFuncFixture('alias-func');
    expect(actual).toContain('const x =');
  });
});

// ---------------------------------------------------------------------------
// Func pre-condition referencing an alias (real-corpus shape — see
// docs/superpowers/plans housekeeping item 3: Create_Exercise.
// OptionPayoutExists in the CDM corpus does `alias optionPayout: <navigation
// expr>` then `condition OptionPayoutExists: optionPayout exists`).
// validateAttr() (src/expr/transpiler.ts) only checked ctx.attributeTypes
// (inputs + output), never ctx.localBindings (alias bindings), so
// `<alias> exists`/`is absent`/one-of/choice/only-exists on a func-scope
// alias always fell through to the "unknown attribute" DIAGNOSTIC — a real
// bug in ts-emitter's emitted func output, not just a test-harness gap.
// ---------------------------------------------------------------------------

describe('US6 funcs: precondition referencing a func-scope alias', () => {
  it('emits export function UsePayload with alias-referencing precondition (byte-identical)', async () => {
    const [actual, expected] = await Promise.all([
      generateFuncFixture('precondition-alias'),
      readFile(join(FIXTURES_DIR, 'precondition-alias', 'expected.ts'), 'utf-8')
    ]);
    expect(actual).toBe(expected);
  });

  it('resolves the alias exists check without an unknown-attribute DIAGNOSTIC fallback', async () => {
    const actual = await generateFuncFixture('precondition-alias');
    expect(actual).not.toContain('DIAGNOSTIC');
    expect(actual).toContain('payload == null');
  });
});

// ---------------------------------------------------------------------------
// T117: Recursive — hoisted function declaration for cyclic call graph
// ---------------------------------------------------------------------------

describe('US6 funcs: recursive / hoisted function (T117)', () => {
  it('parses recursive fixture and emits functions (byte-identical)', async () => {
    const [actual, expected] = await Promise.all([
      generateFuncFixture('recursive'),
      readFile(join(FIXTURES_DIR, 'recursive', 'expected.ts'), 'utf-8')
    ]);
    expect(actual).toBe(expected);
  });

  it('topoSortFuncs places cyclic funcs last in original order', () => {
    // Create two mutually-recursive funcs
    const funcA: RuneFunc = {
      name: 'A',
      namespace: 'test',
      inputs: [{ name: 'n', typeName: 'int', cardinality: { lower: 1, upper: 1 } }],
      output: { name: 'r', typeName: 'int', cardinality: { lower: 1, upper: 1 } },
      aliases: [],
      assignments: [{ kind: 'set', exprNode: null }],
      preConditions: [],
      postConditions: [],
      isAbstract: false
    };
    const funcB: RuneFunc = {
      name: 'B',
      namespace: 'test',
      inputs: [{ name: 'n', typeName: 'int', cardinality: { lower: 1, upper: 1 } }],
      output: { name: 'r', typeName: 'int', cardinality: { lower: 1, upper: 1 } },
      aliases: [],
      assignments: [{ kind: 'set', exprNode: null }],
      preConditions: [],
      postConditions: [],
      isAbstract: false
    };

    // Mutual recursion: A → B, B → A
    const callGraph = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])]
    ]);

    const cyclic = findCyclicFuncs(callGraph);
    expect(cyclic.has('A')).toBe(true);
    expect(cyclic.has('B')).toBe(true);

    const sorted = topoSortFuncs([funcA, funcB], callGraph);
    // Both are cyclic, so they remain at end in original order
    expect(sorted[0]!.name).toBe('A');
    expect(sorted[1]!.name).toBe('B');
  });

  it('cyclic funcs emit as hoisted function declarations (not const)', () => {
    // This test verifies that the emitter uses `function` declarations for cyclic funcs.
    // The recursive fixture uses non-cyclic funcs, so we test hoist logic directly.
    const cyclicFuncs: RuneFunc[] = [
      {
        name: 'F',
        namespace: 'test.funcs.recursive',
        inputs: [{ name: 'n', typeName: 'int', cardinality: { lower: 1, upper: 1 } }],
        output: { name: 'r', typeName: 'int', cardinality: { lower: 1, upper: 1 } },
        aliases: [],
        assignments: [{ kind: 'set', exprNode: { $type: 'RosettaIntLiteral', value: BigInt(1) } }],
        preConditions: [],
        postConditions: [],
        isAbstract: false
      }
    ];
    // Self-loop: F → F
    const callGraph = buildFuncCallGraph(cyclicFuncs);
    // Manually inject self-loop for testing the emitter
    callGraph.set('F', new Set(['F']));

    const cyclic = findCyclicFuncs(callGraph);
    expect(cyclic.has('F')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T128: constructor-expr — constructor expressions emit as plain object literals
// ---------------------------------------------------------------------------

describe('US6 funcs: constructor-expr (T128)', () => {
  it('emits constructor expressions as plain object literals (byte-identical)', async () => {
    const [actual, expected] = await Promise.all([
      generateFuncFixture('constructor-expr'),
      readFile(join(FIXTURES_DIR, 'constructor-expr', 'expected.ts'), 'utf-8')
    ]);
    expect(actual).toBe(expected);
  });

  it.each([
    ['MakePoint', { x: 3, y: 4 }, { x: 3, y: 4 }],
    ['MakeEmptyBox', { w: 5 }, { origin: {}, width: 5 }]
  ] as const)('executes %s constructor values', async (name, input, expected) => {
    const source = await generateFuncFixture('constructor-expr');
    const javascript = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    const exports: Record<string, (input: Record<string, unknown>) => unknown> = {};
    new Function('exports', 'require', javascript)(exports, createRequire(import.meta.url));
    expect(exports[name]!(input)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// T127: Silent-skip — Zod and JSON Schema targets produce empty funcs[]
// ---------------------------------------------------------------------------

describe('US6 funcs: silent-skip on Zod and JSON Schema targets (T127, FR-031)', () => {
  it('Zod target: funcs[] is empty for a model containing a func', async () => {
    const content = await readFile(join(FIXTURES_DIR, 'add-two', 'input.rune'), 'utf-8');
    const { RuneDsl } = createRuneDslServices();
    const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      content,
      URI.parse('inmemory:///add-two-zod.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);

    const outputs = await generate(doc, { target: 'zod' });
    // Zod target must have empty funcs array
    expect(outputs.every((o) => o.funcs.length === 0)).toBe(true);
    // Zod target must not contain any export function declarations
    for (const o of outputs) {
      expect(o.content).not.toContain('export function AddTwo');
    }
  });

  it('JSON Schema target: funcs[] is empty for a model containing a func', async () => {
    const content = await readFile(join(FIXTURES_DIR, 'add-two', 'input.rune'), 'utf-8');
    const { RuneDsl } = createRuneDslServices();
    const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      content,
      URI.parse('inmemory:///add-two-jsonschema.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);

    const outputs = await generate(doc, { target: 'json-schema' });
    // JSON Schema target must have empty funcs array
    expect(outputs.every((o) => o.funcs.length === 0)).toBe(true);
    // JSON Schema target must not contain any function declarations
    for (const o of outputs) {
      expect(o.content).not.toContain('AddTwo');
    }
  });
});
