// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { parseExpression } from '@rune-langium/core';
import { renderSourceTypeScriptExpression } from '../../src/projection/source-typescript-expression.js';
import { rebaseProjectionOrigin } from '../../src/projection/rebase-origin.js';
import { parseSourceTs } from '../../src/lens/typescript/source-lens.js';
import { renderExpression } from '../../src/emit/rosetta/render-expression.js';

it.each([false, true])('rebases Rune trivia without replacing linked spellings (legacy=%s)', async (legacy) => {
  const projected = renderSourceTypeScriptExpression(parseExpression('values filter [item > 0]').value).origin;
  if (legacy) delete projected.fragmentPaths;
  const captured = 'values /* keep */ filter [ item > 0 ]';
  const origin = rebaseProjectionOrigin(parseExpression(captured).value, structuredClone(projected));
  expect(origin.rune).toBe(captured);
  expect(origin.code).toBe(projected.code);
  const result = await parseSourceTs(origin.code.replace('> 0', '> 2'), undefined, origin);
  expect(result.ok && renderExpression(result.node)).toBe('values filter [item > 2]');
});

it('refuses stale Rune, invalid paths and mismatched node kinds', () => {
  const expression = parseExpression('amount + 1').value;
  const origin = renderSourceTypeScriptExpression(expression).origin;
  expect(() => rebaseProjectionOrigin(parseExpression('other + 1').value, origin)).toThrow('no longer matches');
  for (const invalid of [{ path: '/missing' }, { kind: 'RosettaStringLiteral' }]) {
    const stale = structuredClone(origin);
    Object.assign(stale.fragmentPaths![0]!, invalid);
    expect(() => rebaseProjectionOrigin(expression, stale)).toThrow('fragment no longer matches');
  }
});

it('retains linked fragment paths when worker rendering skips CST coordinates', async () => {
  const expression = parseExpression('values filter [item > 0]').value;
  const projected = renderSourceTypeScriptExpression(expression, { trackOrigins: false }).origin;
  expect(projected.fragments).toEqual([]);
  expect(projected.fragmentPaths?.length).toBeGreaterThan(0);
  const origin = rebaseProjectionOrigin(expression, structuredClone(projected));
  const result = await parseSourceTs(origin.code.replace('> 0', '> 2'), undefined, origin);
  expect(result.ok && renderExpression(result.node)).toBe('values filter [item > 2]');
});

it('retains ambiguity refusals for repeated subexpressions', async () => {
  const origin = renderSourceTypeScriptExpression(parseExpression('amount + amount').value).origin;
  const rebased = rebaseProjectionOrigin(parseExpression('amount /* repeated */ + amount').value, origin);
  expect(await parseSourceTs('other + amount', undefined, rebased)).toMatchObject({
    ok: false,
    reason: { message: expect.stringContaining('ambiguous Rune origins') }
  });
});
