// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { createRef } from 'react';
import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
