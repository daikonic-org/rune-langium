// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { NamespaceTreePicker } from '../../src/components/editors/NamespaceTreePicker.js';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: (i: number) => number }) => {
    let offset = 0;
    const items = Array.from({ length: count }, (_, index) => {
      const size = estimateSize(index);
      const start = offset;
      offset += size;
      return { index, key: index, start, size };
    });
    return { getVirtualItems: () => items, getTotalSize: () => offset };
  }
}));

const options = [
  { value: 'a', label: 'Trade', kind: 'data' as const, namespace: 'cdm.product.model' },
  { value: 'b', label: 'Trade', kind: 'data' as const, namespace: 'fpml.model' }
];

describe('shared namespace type picker', () => {
  it('qualifies collisions and selects the original ID', () => {
    const onSelect = vi.fn();
    render(<NamespaceTreePicker options={options} value="b" onSelect={onSelect} autoFocusSearch={false} />);
    fireEvent.change(screen.getByTestId('nstp-search'), { target: { value: 'Trade' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trade product.model', exact: true }));
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(screen.getByTestId('nstp-type-b')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('nstp-type-b').parentElement).toHaveStyle({ height: '44px' });
  });
  it('focuses a compressed ancestor and returns through the shared breadcrumb', () => {
    render(<NamespaceTreePicker options={options} value={null} onSelect={vi.fn()} autoFocusSearch={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Focus namespace cdm.product.model', exact: true }));
    expect(screen.queryByTestId('nstp-seg-fpml.model')).not.toBeInTheDocument();
    const breadcrumb = screen.getByRole('navigation', { name: 'Namespace location' });
    fireEvent.click(within(breadcrumb).getByRole('button', { name: 'cdm', exact: true }));
    expect(screen.getByTestId('nstp-seg-cdm.product.model')).toHaveTextContent('product.model');
    fireEvent.click(within(breadcrumb).getByRole('button', { name: 'All', exact: true }));
    expect(screen.getByTestId('nstp-seg-fpml.model')).toBeInTheDocument();
  });
});
