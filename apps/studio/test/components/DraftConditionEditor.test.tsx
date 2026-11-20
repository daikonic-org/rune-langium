// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ExpressionScopeEntry } from '@rune-langium/core';
import { DraftConditionEditor } from '../../src/components/editing/DraftConditionEditor.js';
import { ExpressionDocument } from '../../src/services/expression-document.js';
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
  const documents = new ExpressionDocument({
    getGeneration: () => 1,
    getFile: () => undefined,
    onContentChange: vi.fn()
  });
  const props = { value: '', onChange, onBlur: vi.fn(), filePath: '/draft.rosetta', files, documents };
  const view = render(
    <DraftConditionEditor {...props} draftCondition={{ nodeId: 'First#Data', kind: 'precondition' }} />
  );
  view.rerender(<DraftConditionEditor {...props} draftCondition={{ nodeId: 'Second#Data', kind: 'precondition' }} />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Add expression' }), { key: 'c' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Add expression' }), { target: { value: 'currency exists' } });
  await act(async () => currentScope([{ name: 'currency', kind: 'attribute', declarationId: 'current' }]));
  await act(async () => oldScope([{ name: 'stale', kind: 'attribute', declarationId: 'previous' }]));
  expect(screen.getByRole('textbox', { name: 'Add expression' })).toHaveValue('currency exists');
  fireEvent.click(screen.getByRole('button', { name: 'Done', exact: true }));
  expect(onChange).toHaveBeenLastCalledWith('currency exists');
  view.rerender(
    <DraftConditionEditor
      {...props}
      value="currency exists"
      draftCondition={{ nodeId: 'Second#Data', kind: 'precondition' }}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit currency', exact: true }));
  expect(await screen.findByRole('option', { name: 'currency', exact: true })).toBeVisible();
  expect(screen.queryByRole('option', { name: 'stale', exact: true })).toBeNull();
});
