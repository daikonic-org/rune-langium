// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { createRef } from 'react';
import { expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { z } from 'zod';
import { translateValidationIssues } from '@rune-langium/codegen/instances';
import { WorkflowValidation } from '../../src/components/WorkflowValidation.js';

it('leads with the field and retains canonical alternatives and full path on demand', async () => {
  const user = userEvent.setup();
  render(
    <WorkflowValidation
      name="input"
      root={createRef()}
      validation={{
        state: 'invalid',
        diagnostics: [
          {
            path: 'trades[0].payout',
            message: 'Invalid input',
            alternatives: [
              [{ path: 'trades[0].payout.cash', message: 'Required number' }],
              [{ path: 'trades[0].payout.asset', message: 'Required string' }]
            ]
          }
        ]
      }}
    />
  );
  await user.click(screen.getByRole('button', { name: /input: 1 issue/ }));
  expect(screen.getByRole('button', { name: /payout: Does not match an accepted form/ })).toBeVisible();
  const alternatives = screen.getByText('Accepted forms · 2 alternatives');
  await user.click(alternatives);
  expect(screen.getByText('trades[0].payout.cash: Required number')).toBeVisible();
  expect(screen.getByText('trades[0].payout.asset: Required string')).toBeVisible();
  await user.click(screen.getByText('Technical details'));
  expect(screen.getByText('trades[0].payout: Invalid input')).toBeVisible();
});

it('keeps nested accepted forms as separate choices without adding top-level issues', async () => {
  const user = userEvent.setup();
  const result = z
    .object({
      settlement: z.union([
        z.object({
          payout: z.union([z.object({ cash: z.number() }), z.object({ asset: z.string() })]),
          currency: z.string()
        }),
        z.object({ transfer: z.string() })
      ])
    })
    .safeParse({ settlement: { payout: {} } });
  if (result.success) throw new Error('Expected invalid settlement');
  render(
    <WorkflowValidation
      name="input"
      root={createRef()}
      validation={{
        state: 'invalid',
        diagnostics: translateValidationIssues(result.error.issues)
      }}
    />
  );
  await user.click(screen.getByRole('button', { name: /input: 1 issue/ }));
  const [outer, nested] = screen.getAllByText('Accepted forms · 2 alternatives');
  await user.click(outer!);
  expect(nested).toBeVisible();
  expect(screen.getByText(/settlement.currency: Invalid input/)).toBeVisible();
  const cash = screen.getByText(/settlement.payout.cash: Invalid input/);
  const asset = screen.getByText(/settlement.payout.asset: Invalid input/);
  expect(cash).not.toBeVisible();
  expect(asset).not.toBeVisible();
  await user.click(nested!);
  expect(cash).toBeVisible();
  expect(asset).toBeVisible();
  const cashBranch = cash.closest('ul')!.parentElement!;
  expect(within(cashBranch).getByText('Alternative 1')).toBeVisible();
  expect(within(cashBranch).queryByText(/settlement.payout.asset:/)).not.toBeInTheDocument();
  const assetBranch = asset.closest('ul')!.parentElement!;
  expect(within(assetBranch).getByText('Alternative 2')).toBeVisible();
  expect(within(assetBranch).queryByText(/settlement.payout.cash:/)).not.toBeInTheDocument();
});
