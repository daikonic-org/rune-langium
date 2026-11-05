// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SourceSaveControl } from '../../src/components/editing/SourceSaveControl.js';

afterEach(cleanup);
it('waits for the shared save barrier and retains a visible retry after failure', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('Disk is full')).mockResolvedValue(undefined);
  const host = render(<SourceSaveControl state="pending" save={save} />);
  expect(host.getByRole('status')).toHaveTextContent('Unsaved changes');
  fireEvent.click(host.getByRole('button', { name: 'Save source' }));
  await waitFor(() => expect(host.getByRole('alert')).toHaveTextContent('Save failed'));
  expect(host.getByRole('alert')).toHaveAttribute('title', 'Disk is full');
  fireEvent.click(host.getByRole('button', { name: 'Save source' }));
  await waitFor(() => expect(host.queryByRole('alert')).toBeNull());
  host.rerender(<SourceSaveControl state="saved" save={save} />);
  expect(host.getByRole('status')).toHaveTextContent('Saved locally');
  expect(save).toHaveBeenCalledTimes(2);
});

it('clears a failed manual save when a later autosave succeeds', async () => {
  const save = vi.fn().mockRejectedValue(new Error('Disk is full'));
  const host = render(<SourceSaveControl state="pending" save={save} />);
  fireEvent.click(host.getByRole('button', { name: 'Save source' }));
  await waitFor(() => expect(host.getByRole('alert')).toHaveAttribute('title', 'Disk is full'));
  for (const state of ['error', 'pending', 'saving'] as const) {
    host.rerender(<SourceSaveControl state={state} save={save} />);
    expect(host.getByRole('alert')).toHaveTextContent('Save failed');
  }
  host.rerender(<SourceSaveControl state="saved" save={save} />);
  await waitFor(() => expect(host.queryByRole('alert')).toBeNull());
  expect(host.getByRole('status')).toHaveTextContent('Saved locally');
  expect(host.getByRole('status')).not.toHaveAttribute('title', 'Disk is full');
  host.rerender(<SourceSaveControl state="pending" save={save} />);
  expect(host.getByRole('status')).toHaveTextContent('Unsaved changes');
  expect(save).toHaveBeenCalledTimes(1);
});
