// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * W1 Tier 4 (SwitchOperation) + the deliberate RosettaSuperCall diagnostic,
 * plus P4-noted missing regression tests (chained same-tier comparisons,
 * nested `or` grouping) that pin CURRENT (already-verified-correct)
 * transpiler precedence behavior — not new behavior.
 *
 * See docs/superpowers/specs/2026-07-02-transpiler-expression-parity-design.md
 * §Tier 4 and §"The one exception".
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
      ['a', 'number'],
      ['b', 'number'],
      ['c', 'number'],
      ['color', 'string']
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

function execute(expr: ReturnType<typeof parse>, data: unknown, ctx = makeCtx()): unknown {
  const code = transpileExpression(expr, ctx);
  return Function(ctx.selfName, `${RUNTIME_HELPER_JS_SOURCE}\nreturn ${code}`)(data);
}

function fakeEnumeration(name: string, memberNames: string[]): RosettaEnumeration {
  const enumValues = memberNames.map(
    (n) =>
      ({
        $type: 'RosettaEnumValue',
        name: n
      }) as unknown as RosettaEnumValue
  );
  return { $type: 'RosettaEnumeration', name, enumValues } as unknown as RosettaEnumeration;
}

describe('W1 Tier 4 — SwitchOperation', () => {
  it('literal guards: chained ternaries with a default else', () => {
    const expr = parse('a switch 1 then "one", 2 then "two", default "other"');
    const ctx = makeCtx();
    expect(execute(expr, { a: 1 }, ctx)).toBe('one');
    expect(execute(expr, { a: 2 }, ctx)).toBe('two');
    expect(execute(expr, { a: 3 }, ctx)).toBe('other');
  });

  it('no default case: final else is undefined', () => {
    const expr = parse('a switch 1 then "one", 2 then "two"');
    const ctx = makeCtx();
    expect(execute(expr, { a: 2 }, ctx)).toBe('two');
    expect(execute(expr, { a: 3 }, ctx)).toBeUndefined();
  });

  it('reference guard resolves against the emitted enum member (string value)', () => {
    const expr = parse('color switch Red then 1, default 0');
    const colorEnum = fakeEnumeration('Color', ['Red', 'Green', 'Blue']);
    const cases = (expr as unknown as { cases: Array<{ guard?: { referenceGuard?: unknown } }> }).cases;
    const firstGuard = cases[0]?.guard as { referenceGuard?: { ref: unknown; $refText: string } } | undefined;
    if (firstGuard) {
      firstGuard.referenceGuard = { ref: colorEnum.enumValues[0], $refText: 'Red' };
    }
    const ctx = makeCtx();
    expect(execute(expr, { color: 'Red' }, ctx)).toBe(1);
    expect(execute(expr, { color: 'Blue' }, ctx)).toBe(0);
  });

  it('argument-less switch uses ctx.selfName (implicit item), matching sibling argument-less conventions', () => {
    const expr = parse('switch 1 then "one", default "other"');
    const ctx = makeCtx({ selfName: 'item' });
    expect(execute(expr, 1, ctx)).toBe('one');
    expect(execute(expr, 2, ctx)).toBe('other');
  });

  it('does not fall through to DIAGNOSTIC', () => {
    const expr = parse('a switch 1 then "one", default "other"');
    const ctx = makeCtx();
    expect(transpileExpression(expr, ctx)).not.toContain('DIAGNOSTIC');
  });
});

describe('RosettaSuperCall — deliberate loud diagnostic (NOT silent fall-through)', () => {
  it('emits its own diagnostic message, distinct from the generic unknown-type fallback', () => {
    const expr = parse('super');
    const ctx = makeCtx();
    const out = transpileExpression(expr, ctx);
    expect(() => Function(`return ${out}`)()).toThrow('calls super()');
  });

  it('pushes a diagnostic to ctx.diagnostics with a super-specific code', () => {
    const expr = parse('super');
    const ctx = makeCtx();
    transpileExpression(expr, ctx);
    expect(ctx.diagnostics).toHaveLength(1);
    expect(ctx.diagnostics[0]?.code).toBe('unsupported-super-call');
    expect(ctx.diagnostics[0]?.message).toContain('super()');
  });
});

describe('P4 regression debt — chained same-tier comparisons', () => {
  it('(a > b) = c: different-tier LEFT child needs no parens (comparison binds tighter than equality)', () => {
    const expr = parse('(a > b) = c');
    const ctx = makeCtx();
    expect(execute(expr, { a: 2, b: 1, c: true }, ctx)).toBe(true);
    expect(execute(expr, { a: 0, b: 1, c: true }, ctx)).toBe(false);
  });

  it('a = (b = c): same-tier RIGHT child of a non-associative operator (=) MUST keep parens — dropping them silently changes meaning ((a===b)===c vs a===(b===c))', () => {
    const expr = parse('a = (b = c)');
    const ctx = makeCtx();
    expect(execute(expr, { a: true, b: 1, c: 1 }, ctx)).toBe(true);
    expect(execute(expr, { a: true, b: 1, c: 2 }, ctx)).toBe(false);
  });

  it('(a = b) = (a = c): same-tier LEFT child needs no parens, RIGHT child keeps parens', () => {
    const expr = parse('(a = b) = (a = c)');
    const ctx = makeCtx();
    expect(execute(expr, { a: 1, b: 1, c: 1 }, ctx)).toBe(true);
    expect(execute(expr, { a: 1, b: 1, c: 2 }, ctx)).toBe(false);
  });

  it('a > (b > c): same-tier RIGHT child of a non-associative comparison operator keeps parens', () => {
    const expr = parse('a > (b > c)');
    const ctx = makeCtx();
    const code = transpileExpression(expr, ctx);
    expect(code).not.toContain('rune.compare');
    const run = Function('data', `return ${code};`);
    expect(run({ a: 2, b: 5, c: 3 })).toBe(true);
    expect(run({ a: 1, b: 5, c: 3 })).toBe(false);
    expect(run({ a: 1, b: 1, c: 3 })).toBe(true);
  });
});

describe('P4 regression debt — nested or grouping', () => {
  it('a or (b or c): "or" is left-associative in both Rune and JS, so right-side parens are semantically redundant and safely dropped — pins current behavior', () => {
    const expr = parse('a or (b or c)');
    const ctx = makeCtx();
    expect(transpileExpression(expr, ctx)).toBe('data.a || data.b || data.c');
  });

  it('(a or b) or c: left-associative chain needs no parens (matches JS default assoc)', () => {
    const expr = parse('(a or b) or c');
    const ctx = makeCtx();
    expect(transpileExpression(expr, ctx)).toBe('data.a || data.b || data.c');
  });

  it('a and (b or c): and/or are different tiers, or-child requires parens under and', () => {
    const expr = parse('a and (b or c)');
    const ctx = makeCtx();
    expect(transpileExpression(expr, ctx)).toBe('data.a && (data.b || data.c)');
  });
});
