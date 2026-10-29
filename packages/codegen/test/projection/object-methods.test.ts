// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { AstUtils } from 'langium';
import { expect, it } from 'vitest';
import { generate } from '../../src/export.js';
import { RUNTIME_HELPER_JS_SOURCE } from '../../src/helpers.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { linkedFunctions } from './python-test-utils.js';

it('displays purpose-built object equality while JSON exports retain canonical structural equality', async () => {
  const funcs = await linkedFunctions(`namespace projection.objects
type Value:
 amount number (0..1)
func Same:
 inputs: left Value (0..1) right Value (0..1)
 output: result boolean (1..1)
 set result: left = right
func Different:
 inputs: left Value (0..1) right Value (0..1)
 output: result boolean (1..1)
 set result: left <> right
`);
  const outputs = await generate([AstUtils.getDocument(funcs[0]!)], { target: 'typescript' });
  const rune = new Function(RUNTIME_HELPER_JS_SOURCE + '\nreturn rune;')() as {
    equals(left: unknown, right: unknown): boolean;
  };
  const runtime = compileGeneratedTypeScript(outputs);
  for (const func of funcs) {
    const projection = outputs
      .flatMap((output) => output.projections ?? [])
      .find((entry) => entry.kind === 'function' && entry.code.startsWith(`export function ${func.name}(`))!;
    expect(projection.code).toContain('rune.valueKey(');
    expect(projection.body!.code).toContain(func.name === 'Same' ? 'left == right' : 'left != right');
    expect(projection.body!.code).not.toMatch(/rune\.|\bas\b/);
    const predicate = runtime[func.name]!;
    for (const [left, right] of [
      [undefined, undefined],
      [{ amount: 1 }, undefined],
      [undefined, { amount: 1 }],
      [{ amount: 1 }, { amount: 1 }],
      [{ amount: 1 }, { amount: 2 }],
      [{}, {}]
    ]) {
      expect(predicate(left, right)).toBe(func.name === 'Same' ? rune.equals(left, right) : !rune.equals(left, right));
    }
  }
});
