// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { describe, it, expect } from 'vitest';
import { parseExpression } from '../../src/api/parse-expression.js';

describe('parseExpression', () => {
  it('parses a binary expression into the correct tree', () => {
    const r = parseExpression('quantity > 0 and price exists');
    expect(r.hasErrors).toBe(false);
    expect(r.value.$type).toBe('LogicalOperation');
    const op = r.value as unknown as { operator: string; left: { $type: string }; right: { $type: string } };
    expect(op.operator).toBe('and');
    expect(op.left.$type).toBe('ComparisonOperation');
    expect(op.right.$type).toBe('RosettaExistsExpression');
  });

  it.each(['0.033', '.0001', '-00.0070', '0.01e-03'])('preserves the digits in %s', (text) => {
    const result = parseExpression(text);
    expect(result.hasErrors).toBe(false);
    expect(result.value).toMatchObject({ $type: 'RosettaNumberLiteral', value: text });
  });

  it('preserves integer digits before conversion to bigint', () => {
    const result = parseExpression('9007199254740993');
    expect(result.hasErrors).toBe(false);
    expect(result.value).toMatchObject({ $type: 'RosettaIntLiteral', value: 9007199254740993n });
  });

  it('parses the as-key suffix (ExpressionWithAsKey superset)', () => {
    const r = parseExpression('reference as-key');
    expect(r.hasErrors).toBe(false);
    expect(r.value.$type).toBe('AsKeyOperation');
  });

  it('reports errors with a best-effort value still present', () => {
    const r = parseExpression('quantity > and');
    expect(r.hasErrors).toBe(true);
    expect(r.parserErrors.length).toBeGreaterThan(0);
    expect(r.value).toBeDefined();
  });

  it('never resolves cross-references (no scope for a bare snippet)', () => {
    const r = parseExpression('someSymbol -> someFeature');
    expect(r.hasErrors).toBe(false);
    const fc = r.value as unknown as { feature?: { ref?: unknown; $refText: string } };
    expect(fc.feature?.$refText).toBe('someFeature');
    expect(fc.feature?.ref).toBeUndefined();
  });

  it('flags empty input as an error', () => {
    expect(parseExpression('').hasErrors).toBe(true);
  });
});
