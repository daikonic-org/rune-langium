// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * W1 tiers 1-3: unit tests for the 14 mechanical transpiler cases that were
 * previously falling through to the unknown-type diagnostic fallback.
 *
 * Tier 1 (passthrough): AsKeyOperation, WithMetaOperation.
 * Tier 2 (simple mappings): DefaultOperation, JoinOperation, RosettaOnlyElement,
 *   ReduceOperation.
 * Tier 3 (conversions): ToStringOperation, ToNumberOperation, ToIntOperation,
 *   ToEnumOperation, ToDateOperation, ToTimeOperation, ToDateTimeOperation,
 *   ToZonedDateTimeOperation.
 *
 * See docs/superpowers/specs/2026-07-02-transpiler-expression-parity-design.md
 * for the per-type semantics table this file pins.
 *
 * Each case is parsed from real Rune DSL source via parseExpression (not
 * hand-built fake AST nodes) so the fixtures exercise the actual grammar.
 */

import { RUNTIME_HELPER_JS_SOURCE } from '../../src/helpers.js';
import { describe, it, expect } from 'vitest';
import { parseExpression, type RosettaEnumeration, type RosettaEnumValue } from '@rune-langium/core';
import { transpileExpression, type ExpressionTranspilerContext } from '../../src/expr/transpiler.js';
import type { GeneratorDiagnostic } from '../../src/types.js';

function makeCtx(overrides?: Partial<ExpressionTranspilerContext>): ExpressionTranspilerContext {
  const diagnostics: GeneratorDiagnostic[] = [];
  return {
    selfName: 'data',
    emitMode: 'zod-refine',
    conditionName: 'Cond',
    typeName: 'TestType',
    attributeTypes: new Map([
      ['a', 'string'],
      ['b', 'string'],
      ['reference', 'string'],
      ['value', 'string'],
      ['scheme', 'string'],
      ['items', 'number[]'],
      ['item', 'number'],
      ['code', 'string']
    ]),
    diagnostics,
    ...overrides
  };
}

/** Parse a Rune expression snippet and assert it parsed cleanly. */
function parse(src: string) {
  const result = parseExpression(src);
  expect(result.hasErrors, `expected '${src}' to parse without errors`).toBe(false);
  return result.value;
}

/** Build a minimal fake RosettaEnumeration for ToEnumOperation/enum-resolution tests. */
function fakeEnumeration(name: string, memberNames: string[]): RosettaEnumeration {
  const enumValues = memberNames.map(
    (n) =>
      ({
        $type: 'RosettaEnumValue',
        name: n
      }) as unknown as RosettaEnumValue
  );
  return {
    $type: 'RosettaEnumeration',
    name,
    enumValues
  } as unknown as RosettaEnumeration;
}

describe('W1 Tier 1 — passthrough', () => {
  it('AsKeyOperation: transpiles argument and returns it unchanged (key annotation has no runtime meaning)', () => {
    const expr = parse('reference as-key');
    const ctx = makeCtx();
    expect(transpileExpression(expr, ctx)).toBe('data.reference');
    expect(ctx.diagnostics).toHaveLength(0);
  });

  it('WithMetaOperation: transpiles argument and returns it unchanged (meta entries have no runtime meaning)', () => {
    const expr = parse('value with-meta { scheme: "urn:x" }');
    const ctx = makeCtx();
    expect(transpileExpression(expr, ctx)).toBe('data.value');
    expect(ctx.diagnostics).toHaveLength(0);
  });

  it('WithMetaOperation: passthrough works with no entries', () => {
    const expr = parse('value with-meta');
    const ctx = makeCtx();
    expect(transpileExpression(expr, ctx)).toBe('data.value');
  });
});

describe('W1 Tier 2 — simple mappings', () => {
  it('DefaultOperation falls back for null and empty collections', () => {
    const expr = parse('a default b');
    const ctx = makeCtx();
    const evaluate = Function('data', `${RUNTIME_HELPER_JS_SOURCE}\nreturn ${transpileExpression(expr, ctx)}`);
    expect(evaluate({ a: [], b: [2] })).toEqual([2]);
    expect(evaluate({ a: 0, b: 2 })).toBe(0);
    expect(evaluate({ a: null, b: 2 })).toBe(2);
  });

  it('JoinOperation: (L ?? []).join(R) when right is present', () => {
    const expr = parse('items join ","');
    const ctx = makeCtx();
    expect(transpileExpression(expr, ctx)).toBe("(data.items ?? []).join(',')");
  });

  it('JoinOperation: right is optional per grammar — defaults to empty-string join', () => {
    const expr = parse('items join');
    const ctx = makeCtx();
    expect(transpileExpression(expr, ctx)).toBe("(data.items ?? []).join('')");
  });

  it('RosettaOnlyElement: single-element extraction, mirrors first/last guard style', () => {
    const expr = parse('items only-element');
    const ctx = makeCtx();
    expect(transpileExpression(expr, ctx)).toBe(
      '((__oe) => (__oe.length === 1 ? __oe[0] : undefined))(((value) => value == null ? [] : [value].flat())(data.items))'
    );
  });

  it('ReduceOperation: .reduce with two-parameter lambda plumbing', () => {
    const expr = parse('items reduce a, b [a + b]');
    const ctx = makeCtx();
    const evaluate = Function('data', `${RUNTIME_HELPER_JS_SOURCE}\nreturn ${transpileExpression(expr, ctx)}`);
    expect(evaluate({ items: [1, 2, 3] })).toBe(6);
    expect(evaluate({ items: [] })).toBeUndefined();
  });
});

describe('W1 Tier 3 — conversions', () => {
  it('ToStringOperation: String(arg), undefined-guarded', () => {
    const expr = parse('a to-string');
    const ctx = makeCtx();
    // IIFE-bound once (PR #364 review): a non-trivial arg (switch IIFE, call)
    // must not be evaluated twice.
    expect(transpileExpression(expr, ctx)).toBe('((__s) => (__s === undefined ? undefined : String(__s)))(data.a)');
  });

  it('ToNumberOperation: Number(arg) with NaN -> undefined', () => {
    const expr = parse('a to-number');
    const ctx = makeCtx();
    expect(transpileExpression(expr, ctx)).toBe(
      '((__n) => (__n === undefined ? undefined : Number.isNaN(Number(__n)) ? undefined : Number(__n)))(data.a)'
    );
  });

  it('ToIntOperation: integer parse, fraction/NaN -> undefined (Number.isInteger gate)', () => {
    const expr = parse('a to-int');
    const ctx = makeCtx();
    expect(transpileExpression(expr, ctx)).toBe(
      '((__i) => (__i === undefined ? undefined : Number.isInteger(Number(__i)) ? Number(__i) : undefined))(data.a)'
    );
  });

  describe('ToEnumOperation', () => {
    it('resolves against the emitted string-union enum shape (member name === value)', () => {
      const expr = parse('code to-enum Color');
      // Fake the cross-reference resolution the transpiler needs (enumeration.ref).
      const colorEnum = fakeEnumeration('Color', ['Red', 'Green', 'Blue']);
      (expr as unknown as { enumeration: { ref: RosettaEnumeration; $refText: string } }).enumeration = {
        ref: colorEnum,
        $refText: 'Color'
      };
      const ctx = makeCtx();
      expect(transpileExpression(expr, ctx)).toBe(
        "((__e) => (['Red', 'Green', 'Blue']).find((value) => value === __e))(data.code)"
      );
    });
  });

  it('ToDateOperation: validate-shape-and-passthrough (YYYY-MM-DD)', () => {
    const expr = parse('a to-date');
    const ctx = makeCtx();
    expect(transpileExpression(expr, ctx)).toBe('rune.toDate(data.a)');
  });

  it('ToTimeOperation: validate-shape-and-passthrough (HH:MM:SS)', () => {
    const expr = parse('a to-time');
    const ctx = makeCtx();
    expect(transpileExpression(expr, ctx)).toBe('rune.toTime(data.a)');
  });

  it('ToDateTimeOperation: validate-shape-and-passthrough (ISO-8601 local)', () => {
    const expr = parse('a to-date-time');
    const ctx = makeCtx();
    expect(transpileExpression(expr, ctx)).toBe('rune.toDateTime(data.a)');
  });

  it('ToZonedDateTimeOperation: validate-shape-and-passthrough (ISO-8601 with zone)', () => {
    const expr = parse('a to-zoned-date-time');
    const ctx = makeCtx();
    expect(transpileExpression(expr, ctx)).toBe('rune.toZonedDateTime(data.a)');
  });
});

describe('W1 tiers 1-3 — no DIAGNOSTIC fallback for any of the 14 cases', () => {
  const cases = [
    'reference as-key',
    'value with-meta { scheme: "urn:x" }',
    'a default b',
    'items join ","',
    'items only-element',
    'items reduce a, b [a + b]',
    'a to-string',
    'a to-number',
    'a to-int',
    'a to-date',
    'a to-time',
    'a to-date-time',
    'a to-zoned-date-time'
  ];

  for (const src of cases) {
    it(`'${src}' does not fall through to DIAGNOSTIC`, () => {
      const expr = parse(src);
      const ctx = makeCtx();
      const out = transpileExpression(expr, ctx);
      expect(out).not.toContain('DIAGNOSTIC');
    });
  }

  it("'code to-enum Color' does not fall through to DIAGNOSTIC", () => {
    const expr = parse('code to-enum Color');
    const colorEnum = fakeEnumeration('Color', ['Red', 'Green', 'Blue']);
    (expr as unknown as { enumeration: { ref: RosettaEnumeration; $refText: string } }).enumeration = {
      ref: colorEnum,
      $refText: 'Color'
    };
    const ctx = makeCtx();
    expect(transpileExpression(expr, ctx)).not.toContain('DIAGNOSTIC');
  });
});
