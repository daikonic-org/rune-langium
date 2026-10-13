// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Unit tests for AttributeRow component (T046).
 *
 * Covers:
 * - Name/type/cardinality rendering
 * - Auto-save debounce on name change
 * - Remove callback
 * - Drag reorder callback
 * - Override badge display
 *
 * AST-shape note (013/follow-up): the row reads canonical AST paths
 * (`attributes.${i}.{name, typeCall.type.$refText, card, override}`) per R11
 * of `specs/013-z2f-editor-migration/research.md`. The fixtures below seed
 * that shape directly — there is no projection layer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useForm, FormProvider } from 'react-hook-form';
import { AttributeRow, InheritedAttributeRow } from '../../src/components/editors/AttributeRow.js';
import { InheritedMembersSection } from '../../src/components/editors/InheritedMembersSection.js';
import type { TypeOption } from '../../src/types.js';

const AVAILABLE_TYPES: TypeOption[] = [
  { value: 'builtin::string', label: 'string', kind: 'builtin' },
  { value: 'builtin::number', label: 'number', kind: 'builtin' },
  { value: 'builtin::date', label: 'date', kind: 'builtin' }
];

it.each([
  ['Identifier', 'Data'],
  ['string', 'BasicType'],
  ['Status', 'Enum'],
  ['Missing', 'Unresolved']
])('keeps inherited %s references in their canonical %s kind', (typeName, kind) => {
  const { container } = render(
    <InheritedAttributeRow
      name="identifier"
      typeName={typeName}
      cardinality="(1..1)"
      ancestorName="Base"
      disabled
      onOverride={vi.fn()}
      availableTypes={[
        ...AVAILABLE_TYPES,
        { value: 'test.Identifier', label: 'Identifier', kind: 'data' },
        { value: 'test.Status', label: 'Status', kind: 'enum' }
      ]}
    />
  );
  const chip = container.querySelector('[data-slot="type-picker-trigger"]');
  expect(chip).toHaveAttribute('data-kind', kind);
  expect(chip).toBeDisabled();
  expect(chip).toHaveTextContent(typeName);
});

it('retains kind colors when opening a collapsible inherited member group', () => {
  const { container } = render(
    <InheritedMembersSection
      availableTypes={[{ value: 'test.Identifier', label: 'Identifier', kind: 'data' }]}
      groups={[
        {
          ancestorName: 'Base',
          namespace: 'test',
          kind: 'func',
          members: [
            {
              $type: 'Attribute',
              name: 'identifier',
              typeCall: { $type: 'TypeCall', type: { $refText: 'Identifier' } },
              card: { inf: 1, sup: 1 }
            }
          ]
        }
      ]}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /from Base/ }));
  expect(container.querySelector('[data-slot="type-picker-trigger"]')).toHaveAttribute('data-kind', 'Data');
});

/**
 * AST-shaped Attribute item that `<AttributeRow>` consumes via
 * `useFormContext` at `attributes.${index}.{name, typeCall.type.$refText, card, override}`.
 */
interface TestAttribute {
  $type: 'Attribute';
  name: string;
  typeCall: { $type: 'TypeCall'; type: { $refText: string } };
  card: { inf: number; sup?: number; unbounded?: boolean };
  override: boolean;
}

function baseAttribute(overrides: Partial<TestAttribute> = {}): TestAttribute {
  return {
    $type: 'Attribute',
    name: 'tradeDate',
    typeCall: { $type: 'TypeCall', type: { $refText: 'date' } },
    card: { inf: 1, sup: 1, unbounded: false },
    override: false,
    ...overrides
  };
}

/** Wrapper that provides FormProvider context required by AttributeRow. */
function FormWrapper({ attributes, children }: { attributes: TestAttribute[]; children: React.ReactNode }) {
  const methods = useForm({ defaultValues: { attributes } });
  return <FormProvider {...methods}>{children}</FormProvider>;
}

describe('AttributeRow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces name changes with 500ms delay', () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    const onReorder = vi.fn();
    const attr = baseAttribute();

    render(
      <FormWrapper attributes={[attr]}>
        <AttributeRow
          index={0}
          committedName={attr.name}
          availableTypes={AVAILABLE_TYPES}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onReorder={onReorder}
        />
      </FormWrapper>
    );

    const nameInput = screen.getByLabelText(/attribute name/i);
    fireEvent.change(nameInput, { target: { value: 'executionDate' } });

    // Not committed yet
    expect(onUpdate).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith(0, 'tradeDate', 'executionDate', 'date', '(1..1)');
  });

  it('calls onRemove when remove button is clicked', () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    const onReorder = vi.fn();
    const attr = baseAttribute();

    render(
      <FormWrapper attributes={[attr]}>
        <AttributeRow
          index={0}
          committedName={attr.name}
          availableTypes={AVAILABLE_TYPES}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onReorder={onReorder}
        />
      </FormWrapper>
    );

    const removeBtn = screen.getByLabelText(/remove attribute/i);
    fireEvent.click(removeBtn);

    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it('shows Revert button instead of remove for override attributes', () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    const onReorder = vi.fn();
    const onRevert = vi.fn();
    const attr = baseAttribute({ override: true });

    const { container } = render(
      <FormWrapper attributes={[attr]}>
        <AttributeRow
          index={0}
          committedName={attr.name}
          availableTypes={AVAILABLE_TYPES}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onReorder={onReorder}
          isOverride
          onRevert={onRevert}
        />
      </FormWrapper>
    );

    // Override rows show a Revert button instead of a remove button
    const revertBtn = container.querySelector('[data-slot="attribute-revert"]');
    expect(revertBtn).toBeDefined();
    expect(revertBtn).not.toBeNull();
    expect(container.querySelector('[data-slot="attribute-remove"]')).toBeNull();
  });

  it('disables input when disabled prop is true', () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    const onReorder = vi.fn();
    const attr = baseAttribute();

    render(
      <FormWrapper attributes={[attr]}>
        <AttributeRow
          index={0}
          committedName={attr.name}
          availableTypes={AVAILABLE_TYPES}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onReorder={onReorder}
          disabled
        />
      </FormWrapper>
    );

    const nameInput = screen.getByLabelText(/attribute name/i);
    expect(nameInput).toHaveProperty('disabled', true);
  });

  it('keeps the type label navigable when a matching node exists', () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    const onReorder = vi.fn();
    const onNavigateToNode = vi.fn();
    const attr = baseAttribute();

    const { container } = render(
      <FormWrapper attributes={[attr]}>
        <AttributeRow
          index={0}
          committedName={attr.name}
          availableTypes={AVAILABLE_TYPES}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onReorder={onReorder}
          onNavigateToNode={onNavigateToNode}
          allNodeIds={['com.rosetta.model.date']}
        />
      </FormWrapper>
    );

    const typeLink = container.querySelector('[data-slot="type-link"]');
    expect(typeLink).not.toBeNull();
    fireEvent.click(typeLink!);

    expect(onNavigateToNode).toHaveBeenCalledWith('com.rosetta.model.date');
  });
});
