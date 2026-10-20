// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ExpressionScopeEntry } from '@rune-langium/core';
import { DraftConditionEditor } from '../../src/components/editing/DraftConditionEditor.js';
import { requestExpressionScope } from '../../src/services/workspace.js';

vi.mock('../../src/services/workspace.js', () => ({ requestExpressionScope: vi.fn() }));

it('ignores late scope from a previous owner while preserving the new local draft', async () => {
  let oldScope!: (entries: ExpressionScopeEntry[]) => void;
  let currentScope!: (entries: ExpressionScopeEntry[]) => void;
  vi.mocked(requestExpressionScope)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          oldScope = resolve;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          currentScope = resolve;
        })
    );
  const onChange = vi.fn();
  const files: [] = [];
  const props = { value: '', onChange, onBlur: vi.fn(), filePath: '/draft.rosetta', files };
  const view = render(
    <DraftConditionEditor {...props} draftCondition={{ nodeId: 'First#Data', kind: 'precondition' }} />
  );
  view.rerender(<DraftConditionEditor {...props} draftCondition={{ nodeId: 'Second#Data', kind: 'precondition' }} />);
  fireEvent.click(screen.getByTestId('tab-text'));
  fireEvent.change(screen.getByTestId('text-editor'), { target: { value: 'currency exists' } });
  await act(async () => currentScope([{ name: 'currency', kind: 'attribute', declarationId: 'current' }]));
  await act(async () => oldScope([{ name: 'stale', kind: 'attribute', declarationId: 'previous' }]));
  expect(screen.getByTestId('text-editor')).toHaveValue('currency exists');
  fireEvent.click(screen.getByTestId('tab-builder'));
  fireEvent.click(screen.getByRole('button', { name: 'Edit reference currency' }));
  expect(await screen.findByTestId('ref-option-currency')).toBeVisible();
  expect(screen.queryByTestId('ref-option-stale')).toBeNull();
  expect(onChange).toHaveBeenLastCalledWith('currency exists');
});
