// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Unit tests for TypeLink component.
 *
 * Covers:
 * - Renders nothing when typeName is undefined
 * - Renders plain span when no onNavigateToNode callback
 * - Renders clickable button when onNavigateToNode is provided and type resolves
 * - Renders disabled button when type doesn't resolve to any nodeId
 * - Calls onNavigateToNode with correct nodeId when clicked
 * - resolveNodeId matches exact IDs
 * - resolveNodeId matches .name suffix (exact last-segment, no namespace-collision)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TypeLink, TypeReferenceImports } from '../../src/components/editors/TypeLink.js';
import { TypeReferenceField } from '../../src/components/editors/TypeReferenceField.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TypeLink', () => {
  const ALL_NODE_IDS = [
    'cdm.base.math.Quantity',
    'cdm.base.datetime.AdjustableDate',
    'cdm.product.template.EconomicTerms',
    'CompareOp'
  ];

  it('renders nothing when typeName is undefined', () => {
    const { container } = render(<TypeLink typeName={undefined} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders plain span when no onNavigateToNode callback', () => {
    render(<TypeLink typeName="Quantity" />);
    const el = screen.getByText('Quantity');
    expect(el.tagName).toBe('SPAN');
  });

  it('renders clickable button when onNavigateToNode is provided and type resolves', () => {
    const onNavigate = vi.fn();
    render(<TypeLink typeName="Quantity" onNavigateToNode={onNavigate} allNodeIds={ALL_NODE_IDS} />);

    const btn = screen.getByRole('button');
    expect(btn).toBeDefined();
    expect(btn).toHaveProperty('disabled', false);
    expect(btn.title).toBe('Go to Quantity');
  });

  it('renders disabled button when type does not resolve to any nodeId', () => {
    const onNavigate = vi.fn();
    render(<TypeLink typeName="NonExistentType" onNavigateToNode={onNavigate} allNodeIds={ALL_NODE_IDS} />);

    const btn = screen.getByRole('button');
    expect(btn).toHaveProperty('disabled', true);
    expect(btn.title).toBe('NonExistentType');
  });

  it('calls onNavigateToNode with correct nodeId when clicked', () => {
    const onNavigate = vi.fn();
    render(<TypeLink typeName="Quantity" onNavigateToNode={onNavigate} allNodeIds={ALL_NODE_IDS} />);

    const btn = screen.getByRole('button');
    fireEvent.click(btn);

    expect(onNavigate).toHaveBeenCalledOnce();
    expect(onNavigate).toHaveBeenCalledWith('cdm.base.math.Quantity');
  });

  it('does not call onNavigateToNode when allNodeIds is not provided', () => {
    const onNavigate = vi.fn();
    render(<TypeLink typeName="Quantity" onNavigateToNode={onNavigate} />);

    const btn = screen.getByRole('button');
    fireEvent.click(btn);

    expect(onNavigate).not.toHaveBeenCalled();
  });

  describe('resolveNodeId', () => {
    it('matches exact IDs', () => {
      const onNavigate = vi.fn();
      render(<TypeLink typeName="CompareOp" onNavigateToNode={onNavigate} allNodeIds={ALL_NODE_IDS} />);

      fireEvent.click(screen.getByRole('button'));
      expect(onNavigate).toHaveBeenCalledWith('CompareOp');
    });

    it('matches dot-suffix pattern (e.g., "Quantity" matches "cdm.base.math.Quantity")', () => {
      const onNavigate = vi.fn();
      render(<TypeLink typeName="Quantity" onNavigateToNode={onNavigate} allNodeIds={ALL_NODE_IDS} />);

      fireEvent.click(screen.getByRole('button'));
      expect(onNavigate).toHaveBeenCalledWith('cdm.base.math.Quantity');
    });

    it('matches dot-suffix for AdjustableDate', () => {
      const onNavigate = vi.fn();
      render(<TypeLink typeName="AdjustableDate" onNavigateToNode={onNavigate} allNodeIds={ALL_NODE_IDS} />);

      fireEvent.click(screen.getByRole('button'));
      expect(onNavigate).toHaveBeenCalledWith('cdm.base.datetime.AdjustableDate');
    });

    it('exact last-segment match: "Foo" picks "a.b.Foo" not "a.Foo.Bar" (namespace-collision proof)', () => {
      // "a.Foo.Bar" has "Foo" as a namespace segment, not the name segment.
      // Naive endsWith('.Foo') would match "a.Foo.Bar" — exact nameFromNodeId must not.
      const onNavigate = vi.fn();
      const collisionIds = ['a.b.Foo', 'a.Foo.Bar'];
      render(<TypeLink typeName="Foo" onNavigateToNode={onNavigate} allNodeIds={collisionIds} />);

      fireEvent.click(screen.getByRole('button'));
      expect(onNavigate).toHaveBeenCalledWith('a.b.Foo');
    });

    it('skips a same-named function in favor of the type declaration', () => {
      const onNavigate = vi.fn();
      render(
        <TypeLink
          typeName="test.Party"
          onNavigateToNode={onNavigate}
          allNodeIds={['test.Party#RosettaFunction', 'test.Party#Data']}
        />
      );

      fireEvent.click(screen.getByRole('button'));
      expect(onNavigate).toHaveBeenCalledWith('test.Party#Data');
    });
  });
});

describe('file-local alias navigation', () => {
  it('allows keyboard navigation from a read-only Inspector reference without editing its type', async () => {
    const navigate = vi.fn();
    const select = vi.fn();
    render(
      <TypeReferenceField
        value="context.Other#Data"
        displayName="context.Other"
        allNodeIds={['context.Other#Data']}
        onSelect={select}
        onNavigateToNode={navigate}
        readOnly
      />
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Go to context.Other' }), { key: 'F10', shiftKey: true });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Go to type', exact: true }));
    expect(navigate).toHaveBeenCalledExactlyOnceWith('context.Other#Data');
    expect(select).not.toHaveBeenCalled();
  });

  it('uses the same alias-resolved destination from its context menu', async () => {
    const navigate = vi.fn();
    render(
      <TypeReferenceImports.Provider value={[{ importedNamespace: 'fpml.option.*', namespaceAlias: 'fpml' }]}>
        <TypeLink
          typeName="fpml.Exercise"
          allNodeIds={['unrelated.Exercise#Data', 'fpml.option.Exercise#Data']}
          onNavigateToNode={navigate}
        />
      </TypeReferenceImports.Provider>
    );
    fireEvent.contextMenu(screen.getByRole('button', { name: 'fpml.Exercise', exact: true }), {
      clientX: 100,
      clientY: 100
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Go to type', exact: true }));
    expect(navigate).toHaveBeenCalledExactlyOnceWith('fpml.option.Exercise#Data');
  });

  it('tries all namespaces for one alias and rejects unrelated same-name targets', () => {
    const navigate = vi.fn();
    render(
      <TypeReferenceImports.Provider
        value={[
          { importedNamespace: 'fpml.asset.*', namespaceAlias: 'fpml' },
          { importedNamespace: 'fpml.option.*', namespaceAlias: 'fpml' }
        ]}
      >
        <TypeLink
          typeName="fpml.Exercise"
          typeKind="Data"
          allNodeIds={['unrelated.Exercise', 'fpml.option.Exercise#Data']}
          onNavigateToNode={navigate}
        />
      </TypeReferenceImports.Provider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'fpml.Exercise', exact: true }));
    expect(navigate).toHaveBeenCalledWith('fpml.option.Exercise#Data');
  });
});

describe('Inspector canonical reference destinations', () => {
  it.each(['data', 'enum'] as const)('ignores a same-named function when resolving a %s reference', (kind) => {
    const navigate = vi.fn();
    const functionId = 'cdm.CalculationPeriod#RosettaFunction';
    const typeId = `cdm.CalculationPeriod#${kind === 'data' ? 'Data' : 'RosettaEnumeration'}`;
    const { container } = render(
      <TypeReferenceField
        value="CalculationPeriod"
        displayName="CalculationPeriod"
        options={[
          { value: functionId, label: 'CalculationPeriod', kind: 'func' },
          { value: typeId, label: 'CalculationPeriod', kind }
        ]}
        allNodeIds={[functionId, typeId]}
        onSelect={vi.fn()}
        onNavigateToNode={navigate}
        readOnly
      />
    );
    expect(container.querySelector('[data-slot="type-picker-trigger"]')).toHaveAttribute(
      'data-kind',
      kind === 'data' ? 'Data' : 'Enum'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go to CalculationPeriod', exact: true }));
    expect(navigate).toHaveBeenCalledExactlyOnceWith(typeId);
  });
  it.each([
    ['b.Status#Data', ['a.Status#Data', 'b.Status#Data'], false],
    ['b.Status#Data', ['a.Status#Data', 'b.Status#Data'], true],
    ['b.Status#RosettaEnumeration', ['b.Status#Data', 'b.Status#RosettaEnumeration'], true]
  ] as const)('keeps the selected %s identity for the arrow and keyboard menu', async (value, allIds, readOnly) => {
    const navigate = vi.fn();
    const select = vi.fn();
    render(
      <TypeReferenceField
        value={value}
        displayName="Status"
        allNodeIds={[...allIds]}
        onSelect={select}
        onNavigateToNode={navigate}
        readOnly={readOnly}
      />
    );
    const arrow = screen.getByRole('button', { name: 'Go to Status', exact: true });
    fireEvent.click(arrow);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(value);
    navigate.mockClear();
    fireEvent.keyDown(arrow, { key: 'F10', shiftKey: true });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Go to type', exact: true }));
    expect(navigate).toHaveBeenCalledExactlyOnceWith(value);
    expect(select).not.toHaveBeenCalled();
  });

  it('does not redirect an unavailable canonical value to a same-named declaration', () => {
    const navigate = vi.fn();
    const { container } = render(
      <TypeReferenceField
        value="b.Status#Data"
        displayName="Status"
        allNodeIds={['a.Status#Data']}
        onSelect={vi.fn()}
        onNavigateToNode={navigate}
        readOnly
      />
    );
    expect(screen.queryByRole('button', { name: 'Go to Status', exact: true })).not.toBeInTheDocument();
    fireEvent.contextMenu(container.querySelector('[data-slot="type-reference"]')!);
    expect(screen.queryByTestId('type-navigation-menu')).not.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});
