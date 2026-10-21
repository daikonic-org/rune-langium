// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Tests for ExpressionBuilder root component — mode toggle, rendering.
 *
 * @module
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { ExpressionBuilder } from '../../src/components/editors/expression-builder/ExpressionBuilder.js';
import type { FunctionScope } from '../../src/store/expression-store.js';

const testScope: FunctionScope = {
  inputs: [{ name: 'trade', typeName: 'Trade', cardinality: '1..1' }],
  output: { name: 'result', typeName: 'number' },
  aliases: []
};

describe('ExpressionBuilder', () => {
  it('renders with builder mode by default', () => {
    const { container } = render(<ExpressionBuilder value="" onChange={vi.fn()} scope={testScope} />);
    expect(container.querySelector('[data-testid="expression-builder"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="tab-builder"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="tab-text"]')).toBeTruthy();
  });

  it('shows BlockRenderer in builder mode', () => {
    const { container } = render(<ExpressionBuilder value="" onChange={vi.fn()} scope={testScope} />);
    // Should show placeholder block in builder mode
    expect(container.querySelector('[data-block="placeholder"]')).toBeTruthy();
  });

  it('switches to text mode on tab click', () => {
    const { container } = render(<ExpressionBuilder value="" onChange={vi.fn()} scope={testScope} />);
    const textTab = container.querySelector('[data-testid="tab-text"]')!;
    fireEvent.click(textTab);
    expect(container.querySelector('[data-testid="text-editor"]')).toBeTruthy();
    expect(container.querySelector('[data-block="placeholder"]')).toBeNull();
  });

  it('switches back to builder mode', () => {
    const { container } = render(<ExpressionBuilder value="" onChange={vi.fn()} scope={testScope} />);
    // Switch to text
    fireEvent.click(container.querySelector('[data-testid="tab-text"]')!);
    expect(container.querySelector('[data-testid="text-editor"]')).toBeTruthy();

    // Switch back to builder
    fireEvent.click(container.querySelector('[data-testid="tab-builder"]')!);
    expect(container.querySelector('[data-block="placeholder"]')).toBeTruthy();
  });

  it('starts in text mode when defaultMode is text', () => {
    const { container } = render(
      <ExpressionBuilder value="" onChange={vi.fn()} scope={testScope} defaultMode="text" />
    );
    expect(container.querySelector('[data-testid="text-editor"]')).toBeTruthy();
  });

  it('shows scope inputs', () => {
    const { container } = render(<ExpressionBuilder value="" onChange={vi.fn()} scope={testScope} />);
    expect(container.textContent).toContain('trade');
    expect(container.textContent).toContain('Trade');
  });

  it('shows scope output', () => {
    const { container } = render(<ExpressionBuilder value="" onChange={vi.fn()} scope={testScope} />);
    expect(container.textContent).toContain('result');
    expect(container.textContent).toContain('number');
  });

  it('shows error message', () => {
    const { container } = render(
      <ExpressionBuilder value="" onChange={vi.fn()} scope={testScope} error="Parse error" />
    );
    expect(container.textContent).toContain('Parse error');
  });

  it('shows DSL preview in builder mode', () => {
    const { container } = render(<ExpressionBuilder value="" onChange={vi.fn()} scope={testScope} />);
    expect(container.querySelector('[data-testid="dsl-preview"]')).toBeTruthy();
  });

  it('reseeds the tree after text editing so switching modes cannot restore stale logic', () => {
    const host = render(<ExpressionBuilder value="1 + 2" onChange={vi.fn()} scope={testScope} />);
    fireEvent.click(host.getByTestId('tab-text'));
    fireEvent.change(host.getByTestId('text-editor'), { target: { value: '3 + 4' } });
    fireEvent.click(host.getByTestId('tab-builder'));
    fireEvent.click(host.getByTestId('tab-text'));
    expect((host.getByTestId('text-editor') as HTMLTextAreaElement).value).toBe('3 + 4');
  });

  it('preserves unchanged expression bytes including comments through mode switching', () => {
    const raw = '1 /* explain */ + 2';
    const host = render(<ExpressionBuilder value={raw} onChange={vi.fn()} scope={testScope} />);
    fireEvent.click(host.getByTestId('tab-text'));
    expect((host.getByTestId('text-editor') as HTMLTextAreaElement).value).toBe(raw);
  });

  it('calls onChange on text blur', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ExpressionBuilder value="" onChange={onChange} scope={testScope} defaultMode="text" />
    );
    const textarea = container.querySelector('[data-testid="text-editor"]') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'trade -> price + 1' } });
    fireEvent.blur(textarea);
    expect(onChange).toHaveBeenCalledWith('trade -> price + 1');
  });
});

it('changes an existing nested reference using the scoped picker without replacing its surrounding expression', async () => {
  const onChange = vi.fn();
  const scope = { ...testScope, attributes: [{ name: 'currency' }, { name: 'settlementCurrency' }] };
  const view = render(<ExpressionBuilder value='currency = "USD"' scope={scope} onChange={onChange} />);
  fireEvent.click(view.getByRole('button', { name: 'Edit reference currency' }));
  const replacement = await screen.findByTestId('ref-option-settlementCurrency');
  fireEvent.pointerDown(replacement, { pointerType: 'mouse' });
  fireEvent.click(replacement);
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('settlementCurrency = "USD"'));
  fireEvent.keyDown(view.getByTestId('expression-builder'), { key: 'z', ctrlKey: true });
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('currency = "USD"'));
});

it('keeps the placeholder destination across the operator-to-reference picker handoff', async () => {
  const onChange = vi.fn();
  const view = render(<ExpressionBuilder value="" scope={testScope} onChange={onChange} />);
  fireEvent.click(view.container.querySelector('[data-block="placeholder"]')!);
  fireEvent.click(await screen.findByTestId('palette-open-reference'));
  const replacement = await screen.findByTestId('ref-option-trade');
  fireEvent.pointerDown(replacement, { pointerType: 'mouse' });
  fireEvent.click(replacement);
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('trade'));
});

it('cancels a reference picker without changing the draft', async () => {
  const onChange = vi.fn();
  const view = render(<ExpressionBuilder value="trade" scope={testScope} onChange={onChange} />);
  fireEvent.click(view.getByRole('button', { name: 'Edit reference trade' }));
  await screen.findByTestId('reference-picker');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onChange).not.toHaveBeenCalled();
});
