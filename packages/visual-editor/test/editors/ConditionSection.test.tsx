// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExpressionBuilder } from '../../src/components/editors/expression-builder/ExpressionBuilder.js';
import { ConditionSection } from '../../src/components/editors/ConditionSection.js';

const first = { $type: 'Condition', name: 'First', expression: { text: 'x > 0' } };
const second = { $type: 'Condition', name: 'Second', expression: { text: 'x < 10' } };

describe('compact data rules', () => {
  it('mounts one editor with an explicit target and keeps the selected rule across reorder', () => {
    const editor = vi.fn((props) => (
      <div data-testid="active-expression">
        {props.target.index}:{props.value}
      </div>
    ));
    const props = { nodeId: 'test.Trade', compact: true, renderExpressionEditor: editor, onReorder: vi.fn() };
    const { rerender } = render(<ConditionSection {...props} conditions={[first, second]} />);
    expect(screen.getAllByTestId('active-expression')).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Second' }));
    expect(editor).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: { nodeId: 'test.Trade', kind: 'precondition', index: 1 } })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Move condition up' }));
    expect(props.onReorder).toHaveBeenCalledWith(1, 0);
    rerender(<ConditionSection {...props} conditions={[second, first]} />);
    expect(screen.getByLabelText('Condition name')).toHaveValue('Second');
    expect(screen.getAllByTestId('active-expression')).toHaveLength(1);
  });

  it('keeps metadata collapsed after the expression and preserves metadata editing', () => {
    const onUpdate = vi.fn();
    const { container } = render(
      <ConditionSection
        nodeId="test.Trade"
        compact
        conditions={[first]}
        onUpdate={onUpdate}
        renderExpressionEditor={() => <div data-testid="active-expression">x &gt; 0</div>}
      />
    );
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    const expression = screen.getByTestId('active-expression');
    expect(expression.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    details.open = true;
    fireEvent.change(screen.getByLabelText('Condition name'), { target: { value: 'Renamed' } });
    expect(onUpdate).toHaveBeenCalledWith(0, { name: 'Renamed' });
    fireEvent.change(screen.getByLabelText('Condition description'), { target: { value: 'Positive amount' } });
    expect(onUpdate).toHaveBeenCalledWith(0, { definition: 'Positive amount' });
  });

  it('selects a remaining rule after removing the active one', () => {
    const editor = (props: { value: string }) => <div data-testid="active-expression">{props.value}</div>;
    const props = { nodeId: 'test.Trade', compact: true, renderExpressionEditor: editor, onRemove: vi.fn() };
    const { rerender } = render(<ConditionSection {...props} conditions={[first, second]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove condition First' }));
    rerender(<ConditionSection {...props} conditions={[second]} />);
    expect(screen.getByLabelText('Condition name')).toHaveValue('Second');
    expect(screen.getAllByTestId('active-expression')).toHaveLength(1);
  });
});

it('starts a condition in the shared builder with an empty private draft and commits only on Add', () => {
  const onAdd = vi.fn();
  const editor = vi.fn((props) => <ExpressionBuilder {...props} scope={{ inputs: [], output: null, aliases: [] }} />);
  render(
    <ConditionSection nodeId="test.Trade" compact conditions={[]} onAdd={onAdd} renderExpressionEditor={editor} />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
  expect(editor).toHaveBeenLastCalledWith(
    expect.objectContaining({
      value: '',
      draftCondition: { nodeId: 'test.Trade', kind: 'precondition' }
    })
  );
  expect(screen.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  fireEvent.click(screen.getByTestId('tab-text'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Expression draft' }), {
    target: { value: 'currency = "USD"' }
  });
  expect(onAdd).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
  expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ expressionText: 'currency = "USD"' }));
});

it('discards a new condition builder draft on Cancel', () => {
  const onAdd = vi.fn();
  render(
    <ConditionSection
      conditions={[]}
      onAdd={onAdd}
      renderExpressionEditor={(props) => (
        <ExpressionBuilder {...props} scope={{ inputs: [], output: null, aliases: [] }} />
      )}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
  fireEvent.click(screen.getByTestId('tab-text'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Expression draft' }), { target: { value: 'True' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onAdd).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
  expect(screen.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
});
