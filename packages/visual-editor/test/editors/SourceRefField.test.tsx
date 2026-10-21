// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SourceRefField } from '../../src/components/editors/SourceRefField.js';

const options = [
  { value: 'ns.FpML', label: 'FpML', namespace: 'ns' },
  { value: 'ns.FIX', label: 'FIX', namespace: 'ns' }
];

describe('SourceRefField', () => {
  it('shows the selected label and opens a picker listing options', () => {
    const onSelect = vi.fn();
    render(<SourceRefField value="ns.FpML" options={options} onSelect={onSelect} />);
    expect(screen.getByText('FpML')).toBeInTheDocument();
    fireEvent.click(screen.getByText('FpML'));
    expect(screen.getByText('FIX')).toBeInTheDocument();
    fireEvent.click(screen.getByText('FIX'));
    expect(onSelect).toHaveBeenCalledWith('ns.FIX');
  });

  it('renders a placeholder when no value is selected', () => {
    render(<SourceRefField value={null} options={options} onSelect={() => {}} placeholder="Pick source…" />);
    expect(screen.getByText('Pick source…')).toBeInTheDocument();
  });
});

it('retains the written reference while its options are unavailable', () => {
  render(<SourceRefField value="address" options={[]} disabled onSelect={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'address' })).toBeDisabled();
});
