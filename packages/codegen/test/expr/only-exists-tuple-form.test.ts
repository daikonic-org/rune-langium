// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * `(a, b) only exists` — the paren-tuple form of RosettaOnlyExistsExpression.
 *
 * Grammar (`PrimaryExpression`): `'(' Expression (',' args+=Expression)+ ')' 'only' 'exists'`
 * populates `args`, a SEPARATE field from `argument` (the bracket-list form
 * `[a, b] only exists` populates `argument` with a ListLiteral instead).
 * transpileCondition's top-level dispatcher previously only read `argument`,
 * so the tuple form fell all the way through to the unknown-expression-type
 * DIAGNOSTIC fallback — found via the corpus gate (packages/codegen/test/
 * expr/condition-transpile-corpus.test.ts), e.g. ReturnTerms.ReturnTermsExists
 * in the CDM corpus: `(priceReturnTerms, dividendReturnTerms) only exists`.
 *
 * Also covers the NESTED case (RosettaOnlyExistsExpression as a sub-expression,
 * e.g. the consequent of an if/then) via transpileExpression's dispatcher,
 * which had no RosettaOnlyExistsExpression case at all before this fix.
 */

import { describe, it, expect } from 'vitest';
import { parseExpression } from '@rune-langium/core';
import { transpileExpression, type ExpressionTranspilerContext } from '../../src/expr/transpiler.js';
import { runeAttrExists } from '../../src/helpers.js';
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
      ['c', 'string']
    ]),
    diagnostics,
    ...overrides
  };
}

function parse(src: string) {
  const result = parseExpression(src);
  expect(result.hasErrors, `expected '${src}' to parse without errors`).toBe(false);
  return result.value;
}

describe('RosettaOnlyExistsExpression — paren-tuple form `(a, b) only exists`', () => {
  it('allows absent listed fields and rejects other populated fields', () => {
    const expr = parse('(a, b) only exists');
    const ctx = makeCtx();
    const evaluate = Function('data', 'rune', `return ${transpileExpression(expr, ctx)}`);
    expect(evaluate({ a: 1, b: 2 }, { exists: runeAttrExists })).toBe(true);
    expect(evaluate({ a: 1 }, { exists: runeAttrExists })).toBe(true);
    expect(evaluate({ a: 1, b: 2, c: 3 }, { exists: runeAttrExists })).toBe(false);
  });

  it('reads forbidden Choice arms using their emitted field names', () => {
    const expr = parse('(a, b) only exists');
    const ctx = makeCtx({
      attributeTypes: new Map([
        ['a', 'string'],
        ['b', 'string'],
        ['Cash', 'Cash']
      ]),
      attrAccessorNames: new Map([['Cash', 'cash']])
    });
    const evaluate = Function('data', 'rune', `return ${transpileExpression(expr, ctx)}`);
    expect(evaluate({}, { exists: runeAttrExists })).toBe(true);
    expect(evaluate({ cash: {} }, { exists: runeAttrExists })).toBe(false);
  });

  it('does not fall through to DIAGNOSTIC', () => {
    const expr = parse('(a, b) only exists');
    const ctx = makeCtx();
    expect(transpileExpression(expr, ctx)).not.toContain('DIAGNOSTIC');
  });

  it('all attrs listed: no fields are required', () => {
    const expr = parse('(a, b, c) only exists');
    const ctx = makeCtx();
    const evaluate = Function('data', 'rune', `return ${transpileExpression(expr, ctx)}`);
    expect(evaluate({}, { exists: runeAttrExists })).toBe(true);
    expect(evaluate({ a: 1, b: 2, c: 3 }, { exists: runeAttrExists })).toBe(true);
  });

  it('allows absent fields when no declared fields are forbidden', () => {
    const expr = parse('(a, b) only exists');
    const ctx = makeCtx({
      attributeTypes: new Map([
        ['a', 'string'],
        ['b', 'string']
      ])
    });
    const evaluate = Function('data', 'rune', `return ${transpileExpression(expr, ctx)}`);
    expect(evaluate({}, { exists: runeAttrExists })).toBe(true);
    expect(evaluate({ a: 1, b: 2, c: 3 }, { exists: runeAttrExists })).toBe(true);
  });

  it('multiple forbidden attrs are ANDed together', () => {
    const expr = parse('(a, b, c) only exists');
    const ctx = makeCtx({
      attributeTypes: new Map([
        ['a', 'string'],
        ['b', 'string'],
        ['c', 'string'],
        ['d', 'string'],
        ['e', 'string']
      ])
    });
    const evaluate = Function('data', 'rune', `return ${transpileExpression(expr, ctx)}`);
    expect(evaluate({ a: 1, b: 2, c: 3 }, { exists: runeAttrExists })).toBe(true);
    expect(evaluate({ a: 1, b: 2, c: 3, d: 4 }, { exists: runeAttrExists })).toBe(false);
    expect(evaluate({ a: 1, b: 2, c: 3, e: 4 }, { exists: runeAttrExists })).toBe(false);
  });
});

describe('RosettaOnlyExistsExpression — nested (non-top-level) position', () => {
  it('as the consequent of an if/then, transpiles to a boolean expression (not a DIAGNOSTIC)', () => {
    const expr = parse('if a exists then (a, b) only exists else True');
    const ctx = makeCtx();
    const out = transpileExpression(expr, ctx);
    expect(out).not.toContain('DIAGNOSTIC');
    expect(out).not.toContain('rune.exists');
    expect(Function('data', `return ${out}`)({ a: 1 })).toBe(true);
    expect(Function('data', `return ${out}`)({ a: 1, c: 2 })).toBe(false);
  });
});
