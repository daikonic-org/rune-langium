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
          allNodeIds={['unrelated.Exercise', 'fpml.option.Exercise#Data']}
          onNavigateToNode={navigate}
        />
      </TypeReferenceImports.Provider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'fpml.Exercise', exact: true }));
    expect(navigate).toHaveBeenCalledWith('fpml.option.Exercise#Data');
  });
});
