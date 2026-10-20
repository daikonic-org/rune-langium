// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Phase C — FunctionNode renders a focused RosettaFunction as a structure card:
 * Func kind badge + name + Phase-A meta indicators in the header, input
 * parameters as stacked rows, and a distinct output row marked with a `→` glyph.
 *
 * The popover primitive is mocked (same strategy as StructureMetaIndicators.test)
 * so the meta indicators render flat without portal plumbing.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavigationContext } from '../../../src/components/nodes/NavigationContext.js';
import { ReactFlowProvider } from '@xyflow/react';
import type { ReactElement, ReactNode } from 'react';

vi.mock('@rune-langium/design-system/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div data-testid="popover">{children}</div>,
  PopoverTrigger: ({ render }: { render: ReactElement }) => render,
  PopoverContent: ({ children }: { children: ReactNode }) => <div data-testid="popover-content">{children}</div>
}));

import { FunctionNode } from '../../../src/components/nodes/FunctionNode.js';
import type { StructureRow } from '../../../src/types/structure-view.js';

const inputRows: StructureRow[] = [
  {
    attrName: 'notional',
    typeName: 'number',
    typeKind: 'BasicType',
    cardinality: '1..1',
    isOptional: false,
    isInherited: false
  },
  {
    attrName: 'rate',
    typeName: 'Rate',
    typeKind: 'Data',
    cardinality: '0..1',
    isOptional: true,
    isInherited: false
  }
];

const outputRow: StructureRow = {
  attrName: 'amount',
  typeName: 'Money',
  typeKind: 'Data',
  cardinality: '1..1',
  isOptional: false,
  isInherited: false
};

const data = {
  id: 'cdm.calc.FixedAmount',
  kind: 'function',
  name: 'FixedAmount',
  namespaceUri: 'cdm.calc',
  inputRows,
  outputRow,
  definition: 'Computes a fixed amount.',
  annotations: ['calculation'],
  conditions: [{ name: 'Positive', preview: 'amount > 0' }],
  variant: 'structure'
};

function renderInFlow(jsx: React.ReactNode) {
  return render(<ReactFlowProvider>{jsx}</ReactFlowProvider>);
}

describe('FunctionNode — structure variant (Phase C)', () => {
  it('renders the function name and a Func kind badge', () => {
    renderInFlow(<FunctionNode data={data as any} selected={false} id="cdm.calc.FixedAmount" type="function" />);
    expect(screen.getByText('FixedAmount')).toBeInTheDocument();
    // KindBadge for func renders its label.
    expect(screen.getByText(/Function/i)).toBeInTheDocument();
  });

  it('renders each input parameter as a row (name + type + cardinality)', () => {
    renderInFlow(<FunctionNode data={data as any} selected={false} id="cdm.calc.FixedAmount" type="function" />);
    expect(screen.getByText('notional')).toBeInTheDocument();
    expect(screen.getByText('rate')).toBeInTheDocument();
    expect(screen.getByText('number')).toBeInTheDocument();
    expect(screen.getByText('Rate')).toBeInTheDocument();
    // cardinality pills
    expect(screen.getAllByText('1..1').length).toBeGreaterThan(0);
    expect(screen.getByText('0..1')).toBeInTheDocument();
  });

  it('renders a distinct, marked output row', () => {
    const { container } = renderInFlow(
      <FunctionNode data={data as any} selected={false} id="cdm.calc.FixedAmount" type="function" />
    );
    expect(screen.getByText('amount')).toBeInTheDocument();
    expect(screen.getByText('Money')).toBeInTheDocument();
    // The output row is flagged with the --output modifier and a → glyph.
    const outputRowEl = container.querySelector('.rune-node-row--output');
    expect(outputRowEl).not.toBeNull();
    expect(outputRowEl?.querySelector('.rune-node-row__output-arrow')?.textContent).toBe('→');
    // The input→output separator is present.
    expect(container.querySelector('.rune-node-func-output-sep')).not.toBeNull();
  });

  it('forwards Phase-A meta to StructureMetaIndicators', () => {
    renderInFlow(<FunctionNode data={data as any} selected={false} id="cdm.calc.FixedAmount" type="function" />);
    expect(screen.getByRole('button', { name: 'Documentation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Conditions/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Annotations/ })).toBeInTheDocument();
  });

  it('renders inputs only (no separator / output row) when the function has no output', () => {
    const noOutput = { ...data, outputRow: undefined };
    const { container } = renderInFlow(
      <FunctionNode data={noOutput as any} selected={false} id="cdm.calc.FixedAmount" type="function" />
    );
    expect(container.querySelector('.rune-node-row--output')).toBeNull();
    expect(container.querySelector('.rune-node-func-output-sep')).toBeNull();
    expect(screen.getByText('notional')).toBeInTheDocument();
  });
});

describe('Function reference keyboard navigation', () => {
  it.each([
    ['rate', 'Rate', 'cdm.calc.Rate#Data', 'F10', true, 'Go to type'],
    ['amount', 'Money', 'cdm.calc.Money#Data', 'ContextMenu', false, 'Inspect type']
  ])(
    'reaches %s by Tab and opens its resolved reference actions',
    async (name, typeName, target, key, shiftKey, action) => {
      const user = userEvent.setup();
      const navigate = vi.fn();
      const inspect = vi.fn();
      const resolvedData = {
        ...data,
        inputRows: inputRows.map((row) =>
          row.attrName === 'rate' ? { ...row, targetNodeId: 'cdm.calc.Rate#Data' } : row
        ),
        outputRow: { ...outputRow, targetNodeId: 'cdm.calc.Money#Data' }
      };
      renderInFlow(
        <NavigationContext.Provider
          value={{
            allNodeIds: new Set(),
            layoutDirection: 'TB',
            pendingHydrationNamespaces: [],
            onNavigateToType: navigate,
            onInspectType: inspect
          }}
        >
          <FunctionNode data={resolvedData as any} selected={false} id="cdm.calc.FixedAmount" type="function" />
        </NavigationContext.Provider>
      );
      const row = screen.getByRole('group', { name: `${name}: ${typeName}` });
      for (let i = 0; i < 10 && document.activeElement !== row; i++) await user.tab();
      expect(row).toHaveFocus();
      fireEvent.keyDown(row, { key, shiftKey });
      fireEvent.click(await screen.findByRole('menuitem', { name: action, exact: true }));
      expect(action === 'Go to type' ? navigate : inspect).toHaveBeenCalledExactlyOnceWith(target);
      expect(row).toHaveFocus();
      expect(screen.getByText('notional').closest('[data-attr]')).not.toHaveAttribute('tabindex');
    }
  );
});
