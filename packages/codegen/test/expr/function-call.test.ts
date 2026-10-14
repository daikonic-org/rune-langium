// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import { isRosettaSymbolReference, parseExpression } from '@rune-langium/core';
import { renderResolvedFunctionCall } from '../../src/expr/function-call.js';

function parsed(source: string): Record<string, unknown> {
  const result = parseExpression(source);
  expect(result.hasErrors, source).toBe(false);
  return result.value as unknown as Record<string, unknown>;
}

function resolve(node: Record<string, unknown>, name: string, inputs: string[]) {
  node.symbol = {
    $refText: name,
    ref: { $type: 'RosettaFunction', name, inputs: inputs.map((input) => ({ name: input })) }
  };
  return node as never;
}

describe('resolved Rosetta function call rendering', () => {
  it('keeps parsed arguments in declared positional order', () => {
    const node = resolve(parsed('Foo(a, b)'), 'Foo', ['left', 'right']);
    expect(renderResolvedFunctionCall(node, (arg) => (isRosettaSymbolReference(arg) ? arg.symbol.$refText : ''))).toBe(
      'Foo(a, b)'
    );
  });

  it('renders a bare zero-input function reference as a zero-argument call', () => {
    const node = resolve(parsed('Foo'), 'Foo', []);
    expect(renderResolvedFunctionCall(node, () => 'ignored')).toBe('Foo()');
  });

  it('supports nested call rendering through the argument callback', () => {
    const node = resolve(parsed('Outer(Inner)'), 'Outer', ['value']);
    expect(renderResolvedFunctionCall(node, () => 'Inner()')).toBe('Outer(Inner())');
  });

  it('reports explicit-call arity mismatches instead of guessing', () => {
    const node = resolve(parsed('Foo(a)'), 'Foo', ['left', 'right']);
    const messages: string[] = [];
    expect(
      renderResolvedFunctionCall(
        node,
        () => 'a',
        (message) => messages.push(message)
      )
    ).toBeUndefined();
    expect(messages[0]).toContain('expected 2');
  });
});
