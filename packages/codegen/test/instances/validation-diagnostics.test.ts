// SPDX-License-Identifier: MIT
import { expect, it } from 'vitest';
import { z } from 'zod';
import { formatIssuePath, translateValidationIssues } from '../../src/instances/validation-diagnostics.js';

it('retains nested union reasons and absolute array paths without inflating issue counts', () => {
  const schema = z.object({
    trades: z.array(z.object({ payout: z.union([z.object({ cash: z.number() }), z.object({ asset: z.string() })]) }))
  });
  const result = schema.safeParse({ trades: [{ payout: {} }] });
  expect(result.success).toBe(false);
  if (result.success) throw new Error('Expected invalid payout');
  const diagnostics = translateValidationIssues(result.error.issues);
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]).toMatchObject({
    path: 'trades[0].payout',
    alternatives: [
      [{ path: 'trades[0].payout.cash', message: expect.stringContaining('number') }],
      [{ path: 'trades[0].payout.asset', message: expect.stringContaining('string') }]
    ]
  });
});

it('keeps structural errors distinct from actual named Rune conditions', () => {
  expect(
    translateValidationIssues(
      [
        { code: 'custom', path: [], message: 'Positive is not satisfied.' },
        { code: 'custom', path: ['amount'], message: 'Required' }
      ],
      ['Positive']
    )
  ).toEqual([
    { path: 'Positive', message: 'Positive is not satisfied.', conditionName: 'Positive' },
    { path: 'amount', message: 'Required' }
  ]);
});

it('keeps every array index and ignores non-field symbol segments', () => {
  expect(formatIssuePath(['trades', 0, 'amounts', 1, Symbol('internal'), 'value'])).toBe('trades[0].amounts[1].value');
});
