// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DiscoveringFiles, NamespaceLinking } from './previews/Progress';

afterEach(cleanup);

it('announces completed work in namespace units', () => {
  render(<NamespaceLinking />);
  const bar = screen.getByRole('progressbar', { name: 'Namespaces' });
  expect(bar).toHaveAttribute('aria-valuenow', '2');
  expect(bar).toHaveAttribute('aria-valuemax', '5');
  expect(bar).toHaveAttribute('aria-valuetext', '2 of 5 namespaces');
});

it('does not invent a completed count while discovering files', () => {
  render(<DiscoveringFiles />);
  const bar = screen.getByRole('progressbar', { name: 'Discovering model files' });
  expect(bar).not.toHaveAttribute('aria-valuenow');
  expect(bar).toHaveAttribute('data-indeterminate');
});
