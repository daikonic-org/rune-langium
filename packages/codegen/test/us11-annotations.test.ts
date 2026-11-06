// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * US11 Annotation codegen — TypeScript decorator factories and Zod .meta().
 *
 * T061–T064: annotation fixtures (declaration, usage-type, usage-attr, qualifiers)
 * T065: emitAnnotationDeclaration — typed decorator factory for each annotation
 * T068–T069: Zod .meta() — appended to type schemas that have type-level annotations
 *
 * Tests:
 *   T065: declaration fixture → export interface sourceArgs + export function source(...)
 *   T068: usage-type fixture (zod) → .meta({ source: { attribute: 'system' } })
 *   T069: qualifiers fixture (zod) → .meta({ source: { attribute: ..., system: ..., version: ... } })
 *   Byte-identical fixture-diff tests for all four fixtures (both zod and typescript targets).
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { createRuneDslServices } from '@rune-langium/core';
import { URI } from 'langium';
import { generate } from '../src/export.js';

const FIXTURES_DIR = resolve(new URL('.', import.meta.url).pathname, 'fixtures/annotations');

/**
 * Parse an annotation fixture and generate output for the given target.
 */
async function runFixture(fixtureName: string, target: 'zod' | 'typescript'): Promise<string> {
  const fixtureDir = join(FIXTURES_DIR, fixtureName);
  const inputPath = join(fixtureDir, 'input.rune');
  const content = await readFile(inputPath, 'utf-8');

  const { RuneDsl } = createRuneDslServices();
  const doc = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    content,
    URI.parse(`inmemory:///annotations-${fixtureName}.rosetta`)
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([doc]);

  if (doc.parseResult.parserErrors.length > 0) {
    const msgs = doc.parseResult.parserErrors.map((e: { message: string }) => e.message).join(', ');
    throw new Error(`Parse errors in annotations/${fixtureName}/input.rune: ${msgs}`);
  }

  const outputs = await generate(doc, { target });
  if (outputs.length === 0) {
    throw new Error(`Generator produced no output for annotations/${fixtureName}`);
  }
  return outputs[0]!.content;
}

/**
 * Assert byte-identical output vs committed expected file.
 */
async function assertFixture(fixtureName: string, target: 'zod' | 'typescript'): Promise<void> {
  const ext = target === 'zod' ? 'expected.zod.ts' : 'expected.ts';
  const expectedPath = join(FIXTURES_DIR, fixtureName, ext);
  const [actual, expected] = await Promise.all([runFixture(fixtureName, target), readFile(expectedPath, 'utf-8')]);
  expect(actual).toBe(expected);
}

// ---------------------------------------------------------------------------
// T065: annotation declaration → decorator factory
// ---------------------------------------------------------------------------

describe('T065: annotation declaration emits typed decorator factory (TypeScript)', () => {
  it('emits export interface <name>Args with correct fields', async () => {
    const output = await runFixture('declaration', 'typescript');
    expect(output).toContain('export interface sourceArgs {');
    expect(output).toContain('system: string;');
    expect(output).toContain('version?: string;');
  });

  it('emits export function <name>(args: <name>Args): ClassDecorator & PropertyDecorator', async () => {
    const output = await runFixture('declaration', 'typescript');
    expect(output).toContain('export function source(args: sourceArgs): ClassDecorator & PropertyDecorator');
  });

  it('decorator factory body returns a no-op function', async () => {
    const output = await runFixture('declaration', 'typescript');
    expect(output).toContain('return (target: any, propertyKey?: any) => {};');
  });

  it('zero-attribute annotation emits zero-arg decorator factory', async () => {
    const output = await runFixture('no-attrs', 'typescript');
    expect(output).toContain('export function deprecated(): ClassDecorator & PropertyDecorator');
    expect(output).not.toContain('Args');
  });

  it('annotation declarations appear before data type declarations', async () => {
    const output = await runFixture('usage-type', 'typescript');
    const annIdx = output.indexOf('export interface sourceArgs');
    const classIdx = output.indexOf('export class Trade');
    expect(annIdx).toBeGreaterThanOrEqual(0);
    expect(classIdx).toBeGreaterThan(annIdx);
  });
});

// ---------------------------------------------------------------------------
// T068: Zod .meta() — usage-type fixture
// ---------------------------------------------------------------------------

describe('T068: Zod .meta() on type-level annotated data (usage-type)', () => {
  it('appends .meta() to the Trade schema', async () => {
    const output = await runFixture('usage-type', 'zod');
    expect(output).toContain('.meta(');
  });

  it('meta object contains annotation name as key', async () => {
    const output = await runFixture('usage-type', 'zod');
    expect(output).toContain('source:');
  });

  it('meta object includes referenced attribute name', async () => {
    const output = await runFixture('usage-type', 'zod');
    expect(output).toContain("attribute: 'system'");
  });

  it('attribute-level annotations (usage-attr) do NOT add .meta() to the type schema', async () => {
    const output = await runFixture('usage-attr', 'zod');
    // Attribute annotations are on attributes, not the type — no .meta() at type level
    expect(output).not.toContain('.meta(');
  });
});

// ---------------------------------------------------------------------------
// T069: Zod .meta() — qualifiers fixture
// ---------------------------------------------------------------------------

describe('T069: Zod .meta() includes qualifier key=value pairs', () => {
  it('meta includes qualifier keys and values', async () => {
    const output = await runFixture('qualifiers', 'zod');
    expect(output).toContain("system: 'Bloomberg'");
    expect(output).toContain("version: '3.0'");
  });

  it('meta includes the attribute name alongside qualifiers', async () => {
    const output = await runFixture('qualifiers', 'zod');
    expect(output).toContain("attribute: 'system'");
    expect(output).toContain("system: 'Bloomberg'");
  });
});

// ---------------------------------------------------------------------------
// Byte-identical fixture-diff tests
// ---------------------------------------------------------------------------

describe('US11: byte-identical fixture-diff — TypeScript target', () => {
  it('declaration: generates byte-identical output vs expected.ts', () => assertFixture('declaration', 'typescript'));

  it('usage-type: generates byte-identical output vs expected.ts', () => assertFixture('usage-type', 'typescript'));

  it('usage-attr: generates byte-identical output vs expected.ts', () => assertFixture('usage-attr', 'typescript'));

  it('qualifiers: generates byte-identical output vs expected.ts', () => assertFixture('qualifiers', 'typescript'));

  it('T064b enum-value annotation (TS)', () => assertFixture('enum-value', 'typescript'));
  it('no-attrs annotation (TS)', () => assertFixture('no-attrs', 'typescript'));
});

describe('US11: byte-identical fixture-diff — Zod target', () => {
  it('declaration: generates byte-identical output vs expected.zod.ts', () => assertFixture('declaration', 'zod'));

  it('usage-type: generates byte-identical output vs expected.zod.ts', () => assertFixture('usage-type', 'zod'));

  it('usage-attr: generates byte-identical output vs expected.zod.ts', () => assertFixture('usage-attr', 'zod'));

  it('qualifiers: generates byte-identical output vs expected.zod.ts', () => assertFixture('qualifiers', 'zod'));

  it('T064b enum-value annotation (Zod)', () => assertFixture('enum-value', 'zod'));
  it('no-attrs annotation (Zod)', () => assertFixture('no-attrs', 'zod'));
});
