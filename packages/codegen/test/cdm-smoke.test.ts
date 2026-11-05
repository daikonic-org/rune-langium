// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

// Performance baseline (T132, SC-006):
// Target: `rune-codegen packages/curated-schema/fixtures/cdm/ --target zod` must complete in < 30s.
// CDM fixture directory (packages/curated-schema/fixtures/cdm/) does not yet exist locally;
// CDM .rosetta files must be downloaded via `bash scripts/update-fixtures.sh` in CI.
// Baseline measurement pending CDM fixture availability; < 30s gate enforced once fixtures are present.

/**
 * CDM Smoke Test Suite.
 *
 * Validates that the generator produces TypeScript-compilable Zod schemas
 * from the curated CDM schema fixtures, and that the JSON battery cases
 * parse correctly.
 *
 * Phase 3: Zod-target section activated (T046).
 * JSON battery sub-tests remain .todo until Phase 4.
 *
 * SC-002: tsc --noEmit over generated output must pass with zero errors.
 * FR-023: Generated Zod schemas must compile with tsc.
 */

import { generatedDirectory } from './helpers/generated-directory.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, describe, it, expect } from 'vitest';
import { createRuneDslServices } from '@rune-langium/core';
import { URI, type LangiumDocument } from 'langium';
import { z } from 'zod';
import { generate, generatePreviewSchemas } from '../src/export.js';
import { jsonCodec } from '../src/instances/json-codec.js';
import type { GeneratorOutput } from '../src/types.js';

const execFileAsync = promisify(execFile);

const FIXTURES_DIR = resolve(new URL('.', import.meta.url).pathname, 'fixtures');
const PKG_DIR = resolve(new URL('.', import.meta.url).pathname, '..');

/**
 * Runs `tsc --project <tsconfigPath> --noEmit` in the given working directory
 * and returns the exit code and stderr output.
 *
 * Used in Phase 3+ to verify that generated Zod schemas compile cleanly.
 * SC-002.
 *
 * @param tsconfigPath - Path to the tsconfig file to use.
 * @param cwd - Working directory for the tsc invocation.
 */
export async function runTscNoEmit(tsconfigPath: string, cwd: string): Promise<{ exitCode: number; stderr: string }> {
  try {
    await execFileAsync('tsc', ['--project', tsconfigPath, '--noEmit'], { cwd });
    return { exitCode: 0, stderr: '' };
  } catch (err) {
    const error = err as NodeJS.ErrnoException & {
      code?: number;
      stderr?: string;
      stdout?: string;
    };
    return {
      exitCode: typeof error.code === 'number' ? error.code : 1,
      stderr: [error.stderr, error.stdout].filter(Boolean).join('\n')
    };
  }
}

/**
 * Runs a JSON battery against a generated Zod schema using Zod's safeParse.
 * Returns counts of passing and failing cases.
 *
 * Used in Phase 4+ to verify condition semantics.
 *
 * @param schema - A Zod schema object (z.ZodType).
 * @param validCases - JSON payloads that should parse successfully.
 * @param invalidCases - JSON payloads that should fail to parse.
 */
export function runJsonBattery(
  schema: { safeParse: (input: unknown) => { success: boolean } },
  validCases: unknown[],
  invalidCases: unknown[]
): { pass: number; fail: number } {
  let pass = 0;
  let fail = 0;

  for (const c of validCases) {
    if (schema.safeParse(c).success) pass++;
    else fail++;
  }
  for (const c of invalidCases) {
    if (!schema.safeParse(c).success) pass++;
    else fail++;
  }

  return { pass, fail };
}

// Type alias for generator output (used in activated phases)
type GeneratorOutputArray = GeneratorOutput[];
void (null as unknown as GeneratorOutputArray); // suppress unused type warning

/**
 * Parse a fixture input.rune file and return the Langium document.
 */
async function parseFixture(
  fixtureName: string,
  services: ReturnType<typeof createRuneDslServices>
): Promise<LangiumDocument> {
  const inputPath = join(FIXTURES_DIR, fixtureName, 'input.rune');
  const content = await readFile(inputPath, 'utf-8');
  const doc = services.RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    content,
    URI.parse(`inmemory:///${fixtureName}.rosetta`)
  );
  await services.RuneDsl.shared.workspace.DocumentBuilder.build([doc]);
  return doc;
}

describe('cdm-smoke: Zod target', () => {
  /**
   * T046: Activate the Zod-target section.
   *
   * Generates Zod schemas for all six US1 fixture documents,
   * writes them to a temp directory, and verifies they compile
   * with tsc --noEmit (FR-023, SC-002).
   */
  it('generates Zod schemas for US1 fixture documents and tsc --noEmit exits 0 (FR-023)', async () => {
    const fixtureNames = ['basic-types', 'cardinality', 'enums', 'inheritance', 'circular', 'reserved-words'];

    const services = createRuneDslServices();
    const docs = await Promise.all(fixtureNames.map((name) => parseFixture(name, services)));

    const outputs = await generate(docs, { target: 'zod' });
    expect(outputs.length).toBeGreaterThan(0);

    // Write outputs to a temp dir
    const tmpDir = await generatedDirectory(join(tmpdir(), 'rune-codegen-smoke-'));

    for (const output of outputs) {
      const outPath = join(tmpDir, output.relativePath);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, output.content, 'utf-8');
    }

    // Build a tsconfig pointing at the generated files.
    // We do NOT extend the package tsconfig to avoid inheriting "types": ["node"]
    // which is unavailable in the tmp dir. Generated Zod output only needs
    // standard lib types — no node types required.
    const smokeTsconfig = {
      compilerOptions: {
        noEmit: true,
        composite: false,
        incremental: false,
        strict: true,
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ESNext',
        skipLibCheck: true,
        paths: {
          zod: [join(PKG_DIR, 'node_modules/zod/index.d.ts')]
        }
      },
      include: outputs.map((o) => join(tmpDir, o.relativePath))
    };

    const smokeTsconfigPath = join(tmpDir, 'tsconfig.smoke.json');
    await writeFile(smokeTsconfigPath, JSON.stringify(smokeTsconfig, null, 2), 'utf-8');

    // Run tsc --noEmit
    const { exitCode, stderr } = await runTscNoEmit(smokeTsconfigPath, tmpDir);
    if (exitCode !== 0) {
      throw new Error(`tsc --noEmit failed (exit ${exitCode}):\n${stderr}`);
    }
    expect(exitCode).toBe(0);
  }, 30_000);

  it('generation is deterministic: identical input produces byte-identical output (SC-007)', async () => {
    const services1 = createRuneDslServices();
    const services2 = createRuneDslServices();

    const inputPath = join(FIXTURES_DIR, 'basic-types', 'input.rune');
    const content = await readFile(inputPath, 'utf-8');

    const doc1 = services1.RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      content,
      URI.parse('inmemory:///basic-types.rosetta')
    );
    await services1.RuneDsl.shared.workspace.DocumentBuilder.build([doc1]);

    const doc2 = services2.RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      content,
      URI.parse('inmemory:///basic-types.rosetta')
    );
    await services2.RuneDsl.shared.workspace.DocumentBuilder.build([doc2]);

    const outputs1 = await generate(doc1, { target: 'zod' });
    const outputs2 = await generate(doc2, { target: 'zod' });

    expect(outputs1.length).toBe(outputs2.length);
    for (let i = 0; i < outputs1.length; i++) {
      expect(outputs1[i]!.content).toBe(outputs2[i]!.content);
    }
  });

  // CDM fixture directory (packages/curated-schema/fixtures/cdm/) does not yet exist locally.
  // These tests will be activated once CDM .rosetta files are downloaded via
  // `bash scripts/update-fixtures.sh` (or the CI fixture cache is populated).
  it.todo(
    'generates Zod schemas for the full CDM curated schema (SC-002) — pending: CDM fixtures not present at packages/curated-schema/fixtures/cdm/'
  );
  it.todo('generated Zod schemas parse valid CDM JSON payloads — pending: CDM fixtures not present');
  it.todo('generated Zod schemas reject invalid CDM JSON payloads — pending: CDM fixtures not present');
  it.todo(
    'generation completes in < 30s for the full CDM namespace set (SC-006) — pending: CDM fixtures not present at packages/curated-schema/fixtures/cdm/'
  );
});

describe('cdm-smoke: json-schema target', () => {
  /**
   * T098: Activate the JSON Schema smoke sub-test.
   *
   * Generates JSON Schema for US1 fixture documents, validates every emitted
   * .schema.json against the JSON Schema 2020-12 meta-schema using ajv.
   * tsc --noEmit is N/A for JSON output; ajv meta-validation is used instead.
   *
   * FR-019: JSON Schema 2020-12 conformance.
   */
  it('generates JSON Schema for US1 fixture documents and validates against 2020-12 meta-schema (FR-019)', async () => {
    // Inline import so the test file doesn't require ajv at the top level
    // (avoids impacting tests that don't need it)
    const { Ajv2020 } = await import('./emit/ajv-2020.js');

    const fixtureNames = ['basic-types', 'cardinality', 'enums', 'inheritance', 'circular', 'reserved-words'];

    const services = createRuneDslServices();
    const docs = await Promise.all(fixtureNames.map((name) => parseFixture(name, services)));

    const outputs = await generate(docs, { target: 'json-schema' });
    expect(outputs.length).toBeGreaterThan(0);

    const ajv = new Ajv2020({ strict: false });

    // Validate every emitted .schema.json against the 2020-12 meta-schema
    for (const output of outputs) {
      expect(output.relativePath.endsWith('.schema.json')).toBe(true);

      const schema = JSON.parse(output.content) as Record<string, unknown>;

      // The schema must declare the 2020-12 $schema URI
      expect(schema['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');

      // Validate via ajv's validateSchema (meta-validation)
      const isValid = ajv.validateSchema(schema);
      if (!isValid) {
        throw new Error(
          `JSON Schema meta-validation failed for ${output.relativePath}:\n${JSON.stringify(ajv.errors, null, 2)}`
        );
      }
      expect(isValid).toBe(true);
    }
  }, 30_000);

  // CDM fixture directory (packages/curated-schema/fixtures/cdm/) does not yet exist locally.
  it.todo(
    'generates JSON Schema for the full CDM curated schema — pending: CDM fixtures not present at packages/curated-schema/fixtures/cdm/'
  );
  it.todo('generated JSON Schema accepts valid CDM JSON payloads (ajv) — pending: CDM fixtures not present');
  it.todo('generated JSON Schema rejects invalid CDM JSON payloads (ajv) — pending: CDM fixtures not present');
});

describe('cdm-smoke: typescript target', () => {
  /**
   * T112: Activate the TypeScript-target CDM smoke section.
   *
   * Generates TypeScript classes for all US1 fixture documents,
   * writes them to a temp directory, and verifies they compile
   * with tsc --noEmit (FR-023, SC-005).
   * Also confirms zero `from 'zod'` imports in generated output.
   */
  it('generates TypeScript classes for US1 fixture documents and tsc --noEmit exits 0 (T112, SC-005)', async () => {
    const fixtureNames = ['basic-types', 'cardinality', 'enums', 'inheritance', 'circular', 'reserved-words'];

    const services = createRuneDslServices();
    const docs = await Promise.all(fixtureNames.map((name) => parseFixture(name, services)));

    const outputs = await generate(docs, { target: 'typescript' });
    expect(outputs.length).toBeGreaterThan(0);

    // Confirm zero `from 'zod'` imports in all generated files
    for (const output of outputs) {
      expect(output.content).not.toContain("from 'zod'");
      expect(output.content).not.toContain('from "zod"');
    }

    // Write outputs to a temp dir
    const tmpDir = await generatedDirectory(join(tmpdir(), 'rune-codegen-ts-smoke-'));

    for (const output of outputs) {
      const outPath = join(tmpDir, output.relativePath);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, output.content, 'utf-8');
    }

    // Build a tsconfig for TypeScript target output.
    // No zod import needed — pure TypeScript.
    // lib includes 'esnext' so the Temporal namespace is available (record types
    // emit Temporal.PlainDate / PlainTime / PlainDateTime / ZonedDateTime).
    const smokeTsconfig = {
      compilerOptions: {
        noEmit: true,
        composite: false,
        incremental: false,
        strict: true,
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ESNext',
        lib: ['ESNext'],
        skipLibCheck: true
      },
      include: outputs.map((o) => join(tmpDir, o.relativePath))
    };

    const smokeTsconfigPath = join(tmpDir, 'tsconfig.smoke.json');
    await writeFile(smokeTsconfigPath, JSON.stringify(smokeTsconfig, null, 2), 'utf-8');

    // Run tsc --noEmit
    const { exitCode, stderr } = await runTscNoEmit(smokeTsconfigPath, tmpDir);
    if (exitCode !== 0) {
      throw new Error(`tsc --noEmit failed (exit ${exitCode}):\n${stderr}`);
    }
    expect(exitCode).toBe(0);
  }, 30_000);

  it('typescript output without functions has no placeholder marker', async () => {
    const fixtureNames = ['basic-types', 'cardinality', 'enums', 'inheritance'];
    const services = createRuneDslServices();
    const docs = await Promise.all(fixtureNames.map((name) => parseFixture(name, services)));

    const outputs = await generate(docs, { target: 'typescript' });
    expect(outputs.length).toBeGreaterThan(0);

    for (const output of outputs) {
      expect(output.content).not.toContain('functions emitted by Phase 8b');
    }

    // For US1 fixtures (no funcs), funcs[] is empty
    for (const output of outputs) {
      expect(output.funcs).toBeDefined();
      expect(Array.isArray(output.funcs)).toBe(true);
    }
  });

  // Runtime func callability would require the CDM fixtures to be present and
  // the func transpiler to produce callable output. Tracked separately.
  it.todo(
    'generated TypeScript funcs are callable at runtime — pending: CDM fixtures not present; func runtime-callability test deferred'
  );
});

// ---------------------------------------------------------------------------
// T078 — JSON battery: one valid + one invalid JSON per condition kind.
// FR-024: error message must contain the condition name.
// Schemas are reconstructed to match the generated output from the
// conditions-complex fixtures (verified byte-identical by us3-expressions.test.ts).
// ---------------------------------------------------------------------------

describe('cdm-smoke: json-battery (T078, FR-024)', () => {
  // Runtime helpers (matches generated output verbatim)
  const runeCheckOneOf = (values: (unknown | undefined | null)[]): boolean =>
    values.filter((v) => v !== undefined && v !== null).length === 1;

  const runeAttrExists = (v: unknown): boolean =>
    v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);

  const runeCount = (arr: unknown[] | undefined | null): number => arr?.length ?? 0;

  const OneOfSchema = z
    .object({
      a: z.string().optional(),
      b: z.string().optional(),
      c: z.string().optional()
    })
    .refine((data) => runeCheckOneOf([data.a, data.b, data.c]), {
      message: 'OneOfCheck: condition failed in OneOf'
    });

  // literals: z.superRefine — three conditions checking score=42, name='hello', active=true
  const WithLiteralsSchema = z
    .object({
      score: z.number().int().optional(),
      name: z.string().optional(),
      active: z.boolean().optional()
    })
    .superRefine((data, ctx) => {
      if (!(data.score === 42)) {
        ctx.addIssue({
          code: 'custom',
          message: 'ScoreCheck: condition failed in WithLiterals',
          path: ['ScoreCheck']
        });
      }
      if (!(data.name === 'hello')) {
        ctx.addIssue({
          code: 'custom',
          message: 'NameCheck: condition failed in WithLiterals',
          path: ['NameCheck']
        });
      }
      if (!(data.active === true)) {
        ctx.addIssue({
          code: 'custom',
          message: 'ActiveCheck: condition failed in WithLiterals',
          path: ['ActiveCheck']
        });
      }
    });

  it('literals: valid payload passes', () => {
    const r = WithLiteralsSchema.safeParse({ score: 42, name: 'hello', active: true });
    expect(r.success).toBe(true);
  });

  it('literals: invalid payload fails — error message contains condition name (FR-024)', () => {
    const r = WithLiteralsSchema.safeParse({ score: 99, name: 'hello', active: true });
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((e) => e.message);
      expect(messages.some((m) => m.includes('ScoreCheck'))).toBe(true);
    }
  });

  it('one-of: valid payload (exactly one present) passes', () => {
    const r = OneOfSchema.safeParse({ b: 'x' });
    expect(r.success).toBe(true);
  });

  it('one-of: invalid payload (zero present) fails — error message contains condition name (FR-024)', () => {
    const r = OneOfSchema.safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((issue) => issue.message);
      expect(messages.some((message) => message.includes('OneOfCheck'))).toBe(true);
    }
  });

  it('one-of: invalid payload (two present) fails', () => {
    const r = OneOfSchema.safeParse({ a: 'x', b: 'y' });
    expect(r.success).toBe(false);
  });

  // navigation: z.refine — CityExists: address.city must exist
  const AddressSchema = z.object({ city: z.string().optional() });
  const PartySchema = z
    .object({ address: AddressSchema.optional() })
    .refine((data) => runeAttrExists(data.address?.city), 'CityExists: condition failed in Party');

  it('navigation: valid payload passes', () => {
    const r = PartySchema.safeParse({ address: { city: 'London' } });
    expect(r.success).toBe(true);
  });

  it('navigation: invalid payload fails — error message contains condition name (FR-024)', () => {
    const r = PartySchema.safeParse({ address: {} });
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((e) => e.message);
      expect(messages.some((m) => m.includes('CityExists'))).toBe(true);
    }
  });

  // arithmetic: z.superRefine — ValuePositive, ValueBelowThreshold, ValueNotZero
  const NumericCheckSchema = z
    .object({
      value: z.number().int().optional(),
      threshold: z.number().int().optional()
    })
    .superRefine((data, ctx) => {
      if (!(data.value! > 0)) {
        ctx.addIssue({
          code: 'custom',
          message: 'ValuePositive: condition failed in NumericCheck',
          path: ['ValuePositive']
        });
      }
      if (!(data.value! < data.threshold!)) {
        ctx.addIssue({
          code: 'custom',
          message: 'ValueBelowThreshold: condition failed in NumericCheck',
          path: ['ValueBelowThreshold']
        });
      }
      if (!(data.value !== 0)) {
        ctx.addIssue({
          code: 'custom',
          message: 'ValueNotZero: condition failed in NumericCheck',
          path: ['ValueNotZero']
        });
      }
    });

  it('arithmetic: valid payload passes', () => {
    const r = NumericCheckSchema.safeParse({ value: 5, threshold: 10 });
    expect(r.success).toBe(true);
  });

  it('arithmetic: invalid payload fails — error message contains condition name (FR-024)', () => {
    const r = NumericCheckSchema.safeParse({ value: 0, threshold: 10 });
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((e) => e.message);
      expect(messages.some((m) => m.includes('ValuePositive'))).toBe(true);
    }
  });

  // boolean: z.superRefine — AOrB, AAndB
  const BoolCheckSchema = z
    .object({
      a: z.string().optional(),
      b: z.string().optional(),
      c: z.string().optional()
    })
    .superRefine((data, ctx) => {
      if (!(runeAttrExists(data.a) || runeAttrExists(data.b))) {
        ctx.addIssue({
          code: 'custom',
          message: 'AOrB: condition failed in BoolCheck',
          path: ['AOrB']
        });
      }
      if (!(runeAttrExists(data.a) && runeAttrExists(data.b))) {
        ctx.addIssue({
          code: 'custom',
          message: 'AAndB: condition failed in BoolCheck',
          path: ['AAndB']
        });
      }
    });

  it('boolean: valid payload passes', () => {
    const r = BoolCheckSchema.safeParse({ a: 'x', b: 'y' });
    expect(r.success).toBe(true);
  });

  it('boolean: invalid payload fails — error message contains condition name (FR-024)', () => {
    const r = BoolCheckSchema.safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((e) => e.message);
      expect(messages.some((m) => m.includes('AOrB'))).toBe(true);
    }
  });

  // set-ops: z.refine — ItemsDisjoint
  const SetOpsCheckSchema = z
    .object({
      items: z.array(z.string()),
      allowed: z.array(z.string())
    })
    .refine(
      (data) => !(data.items ?? []).some((v) => (data.allowed ?? []).includes(v)),
      'ItemsDisjoint: condition failed in SetOpsCheck'
    );

  it('set-ops: valid payload passes', () => {
    const r = SetOpsCheckSchema.safeParse({ items: ['a', 'b'], allowed: ['c', 'd'] });
    expect(r.success).toBe(true);
  });

  it('set-ops: invalid payload fails — error message contains condition name (FR-024)', () => {
    const r = SetOpsCheckSchema.safeParse({ items: ['a', 'b'], allowed: ['b', 'c'] });
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((e) => e.message);
      expect(messages.some((m) => m.includes('ItemsDisjoint'))).toBe(true);
    }
  });

  // aggregations: z.superRefine — CountPositive, FirstExists
  const AggCheckSchema = z.object({ values: z.array(z.number().int()) }).superRefine((data, ctx) => {
    if (!(runeCount(data.values) > 0)) {
      ctx.addIssue({
        code: 'custom',
        message: 'CountPositive: condition failed in AggCheck',
        path: ['CountPositive']
      });
    }
    if (!runeAttrExists((data.values ?? [])[0])) {
      ctx.addIssue({
        code: 'custom',
        message: 'FirstExists: condition failed in AggCheck',
        path: ['FirstExists']
      });
    }
  });

  it('aggregations: valid payload passes', () => {
    const r = AggCheckSchema.safeParse({ values: [1, 2, 3] });
    expect(r.success).toBe(true);
  });

  it('aggregations: invalid payload fails — error message contains condition name (FR-024)', () => {
    const r = AggCheckSchema.safeParse({ values: [] });
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((e) => e.message);
      expect(messages.some((m) => m.includes('CountPositive'))).toBe(true);
    }
  });

  // higher-order: z.refine — NonEmpty (filter items > 0 must exist)
  const HigherOrderCheckSchema = z
    .object({ values: z.array(z.number().int()) })
    .refine(
      (data) => runeAttrExists((data.values ?? []).filter((item) => item > 0)),
      'NonEmpty: condition failed in HigherOrderCheck'
    );

  it('higher-order: valid payload passes', () => {
    const r = HigherOrderCheckSchema.safeParse({ values: [1, 2, 3] });
    expect(r.success).toBe(true);
  });

  it('higher-order: invalid payload fails — error message contains condition name (FR-024)', () => {
    const r = HigherOrderCheckSchema.safeParse({ values: [-1, -2] });
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((e) => e.message);
      expect(messages.some((m) => m.includes('NonEmpty'))).toBe(true);
    }
  });

  // conditional: z.refine — IfFlagThenValue
  const ConditionalCheckSchema = z
    .object({
      flag: z.boolean().optional(),
      value: z.string().optional()
    })
    .refine(
      (data) => (data.flag === true ? runeAttrExists(data.value) : true),
      'IfFlagThenValue: condition failed in ConditionalCheck'
    );

  it('conditional: valid payload (flag=false) passes', () => {
    const r = ConditionalCheckSchema.safeParse({ flag: false });
    expect(r.success).toBe(true);
  });

  it('conditional: valid payload (flag=true, value present) passes', () => {
    const r = ConditionalCheckSchema.safeParse({ flag: true, value: 'yes' });
    expect(r.success).toBe(true);
  });

  it('conditional: invalid payload fails — error message contains condition name (FR-024)', () => {
    const r = ConditionalCheckSchema.safeParse({ flag: true });
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((e) => e.message);
      expect(messages.some((m) => m.includes('IfFlagThenValue'))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Prototype Workspace Phase 1 (spec 023, Task 16) — CDM smoke coverage.
//
// Verifies the eager `generatePreviewSchemas` pipeline (which replaced the
// reverted lazy field-resolver design — see commit 7274b81d) terminates
// cleanly against a real, deep CDM type, and that `jsonCodec` parses
// real CDM-shaped JSON without a parse-level diagnostic.
//
// Per CLAUDE.md: tests that depend on `.resources/` are guarded with
// `describe.skipIf(!CDM_EXISTS)`, following `us12-cdm-corpus.test.ts`'s
// convention, so CI/dev environments without the corpus skip cleanly.
// ---------------------------------------------------------------------------

const CDM_DIR = resolve(new URL('.', import.meta.url).pathname, '../../../.resources/cdm');
const CDM_EXISTS = existsSync(CDM_DIR);

/**
 * Load and build all CDM .rosetta documents from `CDM_DIR` using a fresh
 * Langium service instance. Mirrors us12-cdm-corpus.test.ts's loadCdmDocs.
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

describe.skipIf(!CDM_EXISTS)('Prototype Workspace Phase 1 — CDM smoke', () => {
  let corpus: Awaited<ReturnType<typeof loadCdmDocs>>;

  beforeAll(async () => {
    corpus = await loadCdmDocs();
  }, 120_000);

  it('generates a full preview schema for a deep real CDM type without hanging', async () => {
    const [schema] = generatePreviewSchemas(corpus.docs, { targetId: 'cdm.event.common.TradeState' });
    expect(schema).toBeDefined();
    expect(schema!.fields.length).toBeGreaterThan(0);
    // The eager pipeline's own maxDepth/seenTypes cycle guard (preview-schema.ts,
    // objectField) is what keeps this from hanging on TradeState's real depth/cycles —
    // this test's job is proving that guard actually terminates cleanly against real
    // corpus data, not reimplementing depth logic here.
  }, 60_000);

  it('imports real CDM-shaped JSON via jsonCodec without a parse-level diagnostic', async () => {
    const validPath = join(FIXTURES_DIR, 'cdm-instances', 'trade-state-valid.json');
    const invalidPath = join(FIXTURES_DIR, 'cdm-instances', 'trade-state-missing-required.json');
    if (!existsSync(validPath) || !existsSync(invalidPath)) {
      // No real sample available in this environment/corpus checkout — document the gap,
      // do not fabricate one. See Task 16 correction notes.
      return;
    }
    const goodJson = await readFile(validPath, 'utf-8');
    const badJson = await readFile(invalidPath, 'utf-8');

    const good = jsonCodec.import(goodJson, 'cdm.event.common.TradeState');
    expect(good.diagnostics).toEqual([]);

    const bad = jsonCodec.import(badJson, 'cdm.event.common.TradeState');
    // jsonCodec itself only reports parse errors — schema errors are the
    // caller's job (instance-store's validate dispatch, Task 9/10), so this
    // asserts the codec parsed it (valid JSON, invalid instance is NOT a
    // codec-level diagnostic).
    expect(bad.diagnostics).toEqual([]);
    expect(bad.data).toBeDefined();
  });
});
