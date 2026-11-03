// SPDX-License-Identifier: MIT
import { expect, it } from 'vitest';
import { z } from 'zod';
import { parseInstanceRecord } from '../../src/instances/bundle.js';
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

it('preserves choices nested within an outer union as separate alternatives through record persistence', () => {
  const schema = z.object({
    trades: z.array(
      z.object({
        settlement: z.union([
          z.object({
            payout: z.union([z.object({ cash: z.number() }), z.object({ asset: z.string() })]),
            currency: z.string()
          }),
          z.object({ transfer: z.string() })
        ])
      })
    )
  });
  for (const payout of [{ cash: 1 }, { asset: 'bond' }])
    expect(schema.safeParse({ trades: [{ settlement: { payout, currency: 'USD' } }] }).success).toBe(true);
  const result = schema.safeParse({ trades: [{ settlement: { payout: {} } }] });
  if (result.success) throw new Error('Expected invalid settlement');
  const diagnostics = translateValidationIssues(result.error.issues);
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]).toMatchObject({
    path: 'trades[0].settlement',
    alternatives: [
      [
        {
          path: 'trades[0].settlement.payout',
          alternatives: [
            [{ path: 'trades[0].settlement.payout.cash', message: expect.stringContaining('number') }],
            [{ path: 'trades[0].settlement.payout.asset', message: expect.stringContaining('string') }]
          ]
        },
        { path: 'trades[0].settlement.currency' }
      ],
      [{ path: 'trades[0].settlement.transfer' }]
    ]
  });
  const record = parseInstanceRecord(
    JSON.stringify({
      id: 'nested',
      name: 'Nested choice',
      typeFqn: 'review.Trade',
      data: {},
      createdAt: 0,
      modifiedAt: 0,
      stale: { reason: 'Current validation failed', diagnostics }
    })
  );
  expect(record.stale!.diagnostics).toEqual(diagnostics);
});
