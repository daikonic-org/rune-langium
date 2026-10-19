// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

// Mock the popover primitive so the trigger and content render flat and
// deterministically (no portal / open-state plumbing) — the same testing
// strategy the previous Select-based picker used. `render` is the trigger
// element; we render it as-is. Content is always rendered so we can assert on
// the preset list and the custom-input flow without driving the open state.
vi.mock('@rune-langium/design-system/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div data-testid="popover">{children}</div>,
  PopoverTrigger: ({ render }: { render: ReactElement }) => render,
  PopoverContent: ({ children }: { children: ReactNode }) => <div data-testid="popover-content">{children}</div>
}));

import { CardinalityPicker } from '../../../src/components/editors/CardinalityPicker.js';

describe('CardinalityPicker', () => {
  it('renders an empty value as muted placeholder text instead of a selected custom value', () => {
    render(<CardinalityPicker value="" onChange={vi.fn()} />);

    const trigger = screen.getByRole('button', { name: /^Cardinality / });
    expect(trigger).toHaveTextContent('1..1');
    expect(trigger.querySelector('[data-slot="cardinality-value"]')).toHaveClass('text-muted-foreground');
  });

  it('marks the matching preset as selected', () => {
    render(<CardinalityPicker value="(0..*)" onChange={vi.fn()} />);

    expect(screen.getByRole('option', { name: '0..*' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: '1..1' })).toHaveAttribute('aria-selected', 'false');
  });

  it('commits a preset immediately on click', () => {
    const onChange = vi.fn();
    render(<CardinalityPicker value="(0..1)" onChange={onChange} />);

    fireEvent.click(screen.getByRole('option', { name: '1..*' }));

    expect(onChange).toHaveBeenCalledWith('(1..*)');
  });

  it('commits a custom value with canonical parentheses', () => {
    const onChange = vi.fn();

    render(<CardinalityPicker value="(0..1)" onChange={onChange} />);

    fireEvent.click(screen.getByRole('option', { name: 'Custom…' }));

    const input = screen.getByLabelText('Custom cardinality');
    fireEvent.change(input, { target: { value: '2..3' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('(2..3)');
  });

  it('uses inline-variant focus and disabled styling for the custom cardinality input', () => {
    render(<CardinalityPicker value="(0..1)" onChange={vi.fn()} disabled />);

    fireEvent.click(screen.getByRole('option', { name: 'Custom…' }));

    const input = screen.getByLabelText('Custom cardinality');
    // inline variant: focus uses border-primary + 1px primary shadow (not focus-visible ring)
    expect(input).toHaveClass('focus:border-primary');
    // disabled classes from inline variant + call-site className
    expect(input).toHaveClass('disabled:opacity-50');
    expect(input).toHaveClass('disabled:cursor-not-allowed');
    // data-slot and data-variant from <Input variant="inline">
    expect(input).toHaveAttribute('data-slot', 'input');
    expect(input).toHaveAttribute('data-variant', 'inline');
  });
});
