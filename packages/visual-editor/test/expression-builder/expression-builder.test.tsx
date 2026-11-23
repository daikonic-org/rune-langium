// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Tests for ExpressionBuilder root component — mode toggle, rendering.
 *
 * @module
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { parseExpressionDraft } from '@rune-langium/core';
import { ExpressionBuilder } from '../../src/components/editors/expression-builder/ExpressionBuilder.js';
import type { FunctionScope } from '../../src/store/expression-store.js';

const testScope: FunctionScope = {
  inputs: [{ name: 'trade', typeName: 'Trade', cardinality: '1..1' }],
  output: { name: 'result', typeName: 'number' },
  aliases: []
};

describe('ExpressionBuilder', () => {
  it('retains typed text when the captured operand changes', () => {
    const change = vi.fn();
    const { rerender } = render(
      <ExpressionBuilder value="a + 1" onChange={change} scope={testScope} presentation="inline" />
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Edit 1' }), { key: '2' });
    rerender(<ExpressionBuilder value="a + 3" onChange={change} scope={testScope} presentation="inline" />);
    fireEvent.click(screen.getByRole('button', { name: 'Done', exact: true }));
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('2');
    expect(screen.getByRole('alert')).toHaveTextContent('source changed');
  });

  it('groups an operand that starts with a nested parenthesized expression', async () => {
    const change = vi.fn();
    render(<ExpressionBuilder value="10 / x" onChange={change} scope={testScope} presentation="inline" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit x', exact: true }));
    fireEvent.click(await screen.findByRole('option', { name: 'Edit Rune', exact: true }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Rune expression' }), { target: { value: '(2 + 3) * 4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done', exact: true }));
    expect(change).toHaveBeenCalledWith('10 / ((2 + 3) * 4)');
  });

  it('wraps one operand in a conditional while keeping its value in the then branch', async () => {
    const change = vi.fn();
    render(<ExpressionBuilder value="base + value" onChange={change} scope={testScope} presentation="inline" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit value', exact: true }));
    fireEvent.click(await screen.findByRole('option', { name: 'Wrap in if / then / else', exact: true }));
    expect(change).toHaveBeenCalledWith('base + (if (<?>) then value else (<?>))');
  });

  it('keeps the next call argument when switching on a nested operand', async () => {
    const change = vi.fn<(text: string) => void>();
    render(<ExpressionBuilder value="Choose(trade, 5)" onChange={change} scope={testScope} presentation="inline" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit trade', exact: true }));
    fireEvent.click(await screen.findByRole('option', { name: 'Wrap in switch', exact: true }));
    expect(change).toHaveBeenCalledTimes(1);
    const { parsed } = parseExpressionDraft(change.mock.calls[0]?.[0] ?? '');
    expect(parsed.hasErrors).toBe(false);
    expect(parsed.value).toMatchObject({
      $type: 'RosettaSymbolReference',
      rawArgs: [
        { $type: 'SwitchOperation', argument: { $type: 'RosettaSymbolReference' } },
        { $type: 'RosettaIntLiteral', value: 5n }
      ]
    });
  });

  it.each([
    ['values sort', 'SortOperation', undefined],
    ['values sort [item]', 'SortOperation', 'callback'],
    ['values distinct', 'DistinctOperation', undefined],
    ['values flatten', 'FlattenOperation', undefined],
    ['values count', 'RosettaCountOperation', undefined],
    ['values sum', 'SumOperation', undefined],
    ['values then item count', 'ThenOperation', 'callback']
  ])('groups %s at its parsed boundary', (value, type, body) => {
    const { container } = render(
      <ExpressionBuilder value={value} onChange={vi.fn()} scope={testScope} presentation="inline" />
    );
    const group = container.querySelector('[data-expression-group="' + type + '"]');
    expect(group).toBeVisible();
    expect(group?.querySelector(':scope > [data-expression-body]')?.getAttribute('data-expression-body')).toBe(body);
  });

  it.each([
    ['Constant()', 'Constant call'],
    ['Value { amount: 1 }', 'constructor'],
    ['[1, 2]', 'list'],
    ['x + 1 + 2', '+ expression'],
    ['values count', 'count expression'],
    ['if flag then 1 else 0', 'if expression']
  ])('clears the %s construct through its own section', (value, label) => {
    const onChange = vi.fn();
    render(<ExpressionBuilder value={value} onChange={onChange} scope={testScope} presentation="inline" />);
    const group = screen.getByRole('group', { name: label, exact: true });
    fireEvent.click(within(group).getByRole('button', { name: 'Remove ' + label, exact: true }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('(<?>)');
  });

  it('fills a named argument placeholder in place', async () => {
    const scope: FunctionScope = {
      inputs: [{ name: 'upperX', typeName: 'number', cardinality: '(1..1)' }],
      aliases: [],
      output: null,
      references: [
        {
          kind: 'callable',
          name: 'InterpolateLinear',
          argumentCount: 5,
          argumentNames: ['lowerX', 'upperX', 'lowerY', 'upperY', 'x']
        }
      ]
    };
    const onChange = vi.fn();
    const initial = 'InterpolateLinear(0, 1, 0, 1, (<?>))';
    const { rerender } = render(
      <ExpressionBuilder value={initial} onChange={onChange} scope={scope} presentation="inline" />
    );
    const placeholder = screen.getByRole('button', { name: /^x argument/ });
    expect(placeholder.textContent).toBe('x');
    expect(placeholder).toHaveClass('text-caption');
    fireEvent.click(placeholder);
    const choice = await screen.findByRole('option', { name: /upperX/ });
    fireEvent.click(choice);
    const next = 'InterpolateLinear(0, 1, 0, 1, upperX)';
    expect(onChange).toHaveBeenLastCalledWith(next);
    rerender(<ExpressionBuilder value={next} onChange={onChange} scope={scope} presentation="inline" />);
    expect(screen.getByRole('button', { name: /^x argument.*upperX/ }).textContent).toBe('upperX');
  });

  it('changes one comparison operator without rewriting its operands or surrounding text', async () => {
    const onChange = vi.fn();
    render(
      <ExpressionBuilder
        value={'flag and (price  /* retained */ <  limit or other)'}
        onChange={onChange}
        scope={testScope}
        presentation="inline"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change <', exact: true }));
    fireEvent.click(await screen.findByRole('option', { name: '<= Less or equal' }));
    expect(onChange).toHaveBeenLastCalledWith('flag and (price  /* retained */ <=  limit or other)');
  });

  it.each([
    ['(Pair)', 'first', '(Pair(trade, (<?>)))'],
    ['((Pair(1)))', 'second', '((Pair(1, trade)))'],
    ['(Pair(/* keep */))', 'first', '(Pair(/* keep */trade, (<?>)))']
  ])('fills a missing argument inside the call in %s', async (source, argument, expected) => {
    const onChange = vi.fn();
    const scope: FunctionScope = {
      ...testScope,
      references: [{ kind: 'callable', name: 'Pair', argumentCount: 2, argumentNames: ['first', 'second'] }]
    };
    render(<ExpressionBuilder value={source} onChange={onChange} scope={scope} presentation="inline" />);
    fireEvent.click(screen.getByRole('button', { name: argument + ' argument', exact: true }));
    fireEvent.click(await screen.findByRole('option', { name: /^trade Trade/ }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it('browses linked object members and swaps a collection operation in place', async () => {
    const onChange = vi.fn();
    const loadPicker = vi.fn(async (_, trail) => ({
      entries: [
        { name: 'default', referenceText: '^default', declarationId: 'note', kind: 'input' as const, canBrowse: true }
      ],
      members: trail.length
        ? [
            {
              name: 'type',
              declarationId: 'payout',
              expressionText: '^default -> ^type',
              canBrowse: false,
              compatibility: 'compatible' as const
            }
          ]
        : []
    }));
    const { rerender } = render(
      <ExpressionBuilder
        value="fallbackPayout"
        onChange={onChange}
        scope={testScope}
        presentation="inline"
        loadPicker={loadPicker}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit fallbackPayout' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Use default', exact: true }));
    expect(onChange).toHaveBeenLastCalledWith('^default');
    fireEvent.click(screen.getByRole('button', { name: 'Edit fallbackPayout' }));
    fireEvent.click(await screen.findByRole('option', { name: 'default · Browse', exact: true }));
    fireEvent.click(await screen.findByRole('option', { name: 'type', exact: true }));
    expect(onChange).toHaveBeenLastCalledWith('^default -> ^type');
    rerender(
      <ExpressionBuilder
        value="periods filter [startDate < asOf] then last"
        onChange={onChange}
        scope={testScope}
        presentation="inline"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change filter', exact: true }));
    fireEvent.click(await screen.findByRole('option', { name: 'map / extract', exact: true }));
    expect(onChange).toHaveBeenLastCalledWith('periods extract [startDate < asOf] then last');
  });

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

it('exposes and fills every argument of a selected call without replacing its surrounding condition', async () => {
  const names = ['lowerX', 'upperX', 'lowerY', 'upperY', 'x'];
  const onChange = vi.fn();
  const scope: FunctionScope = {
    inputs: names.map((name) => ({ name, typeName: 'number' })),
    aliases: [],
    output: null,
    references: [{ name: 'InterpolateLinear', kind: 'callable', argumentCount: 5, argumentNames: names }]
  };
  const view = render(
    <ExpressionBuilder value="lowerX < upperX and x >= lowerX and x <= upperX" scope={scope} onChange={onChange} />
  );
  fireEvent.click(view.getAllByRole('button', { name: 'Edit reference lowerX' })[0]!);
  const callable = await screen.findByTestId('ref-option-InterpolateLinear');
  fireEvent.pointerDown(callable, { pointerType: 'mouse' });
  fireEvent.click(callable);
  expect(view.container.querySelectorAll('[data-block="placeholder"]')).toHaveLength(5);
  for (const name of names) {
    const argument = view.getByRole('group', { name: `InterpolateLinear argument ${name}`, exact: true });
    fireEvent.click(within(argument).getByRole('button', { name: 'Add expression', exact: true }));
    fireEvent.click(await screen.findByTestId('palette-open-reference'));
    const variable = await screen.findByTestId(`ref-option-${name}`);
    fireEvent.pointerDown(variable, { pointerType: 'mouse' });
    fireEvent.click(variable);
  }
  const completed = 'InterpolateLinear(lowerX, upperX, lowerY, upperY, x) < upperX and x >= lowerX and x <= upperX';
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(completed));
  expect(view.container.querySelectorAll('[data-block="placeholder"]')).toHaveLength(0);
  fireEvent.keyDown(view.getByTestId('expression-builder'), { key: 'z', ctrlKey: true });
  await waitFor(() => expect(view.container.querySelectorAll('[data-block="placeholder"]')).toHaveLength(1));
});

it('renders existing nested call arguments while keeping zero-input calls distinct from variables', () => {
  const view = render(<ExpressionBuilder value="Wrap(value + 1, Today())" scope={testScope} onChange={vi.fn()} />);
  expect(view.container.querySelectorAll('[data-block="call"]')).toHaveLength(2);
  expect(view.getByRole('group', { name: 'Wrap argument 1', exact: true })).toHaveTextContent('value');
  expect(view.getByRole('group', { name: 'Wrap argument 2', exact: true })).toHaveTextContent('Today()');
  expect(view.container.querySelectorAll('[data-block="placeholder"]')).toHaveLength(0);
});
