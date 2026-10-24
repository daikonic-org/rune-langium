// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StarterWorkspacePicker } from '../../src/components/StarterWorkspacePicker.js';
const catalog = [
  {
    id: 'model',
    name: 'Model authoring',
    description: 'Define types and save examples.',
    repository: 'example/long-starter-repository-name',
    ref: 'v1',
    examples: ['Money'],
    requiredCapabilities: ['Rune execution'],
    status: 'available' as const
  }
];
it('clears filtered-out details and restores the selected example after clearing search', async () => {
  const user = userEvent.setup();
  render(<StarterWorkspacePicker catalog={catalog} open={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /Model authoring/ }));
  expect(screen.getByRole('heading', { name: 'Model authoring' })).toBeVisible();
  await user.type(screen.getByRole('textbox', { name: 'Search example projects' }), 'missing');
  expect(screen.queryByRole('heading', { name: 'Model authoring' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByRole('heading', { name: 'Model authoring' })).toBeVisible();
});
it('opens without authentication, keeps errors recoverable and never offers standalone Maven import', async () => {
  const open = vi.fn().mockRejectedValue(new Error('Network unavailable. Try again.'));
  const user = userEvent.setup();
  render(<StarterWorkspacePicker catalog={catalog} open={open} />);
  await user.click(screen.getByRole('button', { name: /Model authoring/ }));
  await user.click(screen.getByRole('button', { name: 'Use example' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable'));
  expect(screen.getByRole('button', { name: 'Use example' })).toBeEnabled();
  expect(open).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: /Maven/ })).toBeNull();
});
it('discloses unpublished examples and disables opening them', async () => {
  const user = userEvent.setup();
  render(<StarterWorkspacePicker catalog={[{ ...catalog[0]!, status: 'unavailable' }]} open={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /Model authoring/ }));
  expect(screen.getByText(/This proposed example is not published/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Use example' })).toBeDisabled();
});
