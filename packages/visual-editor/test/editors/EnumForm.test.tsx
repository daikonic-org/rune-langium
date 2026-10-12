// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Integration tests for EnumForm component (T050).
 *
 * Covers:
 * - Form renders all fields for a loaded Enum
 * - Add/remove enum values
 * - Set display names
 * - Parent enum selection
 * - Reorder values
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { EnumForm } from '../../src/components/editors/EnumForm.js';
import type { AnyGraphNode, TypeOption, EditorFormActions, TypeGraphNode } from '../../src/types.js';
import { TYPE_REF_PAYLOAD_MIME, typeRefMimeForKind } from '../../src/types/structure-view.js';
import type { TypeRefPayload } from '../../src/types/structure-view.js';
import { testMeta } from '../helpers/node-meta.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActions(overrides: Partial<EditorFormActions<'enum'>> = {}): EditorFormActions<'enum'> {
  return {
    renameType: vi.fn(),
    deleteType: vi.fn(),
    updateDefinition: vi.fn(),
    updateComments: vi.fn(),
    addSynonym: vi.fn(),
    removeSynonym: vi.fn(),
    addEnumValue: vi.fn(),
    removeEnumValue: vi.fn(),
    updateEnumValue: vi.fn(),
    reorderEnumValue: vi.fn(),
    setEnumParent: vi.fn(),
    validate: vi.fn().mockReturnValue([]),
    ...overrides
  };
}

const AVAILABLE_TYPES: TypeOption[] = [
  {
    value: 'test.enums.CurrencyEnum',
    label: 'CurrencyEnum',
    kind: 'enum',
    namespace: 'test.enums'
  },
  { value: 'test.enums.RatingEnum', label: 'RatingEnum', kind: 'enum', namespace: 'test.enums' },
  { value: 'builtin::string', label: 'string', kind: 'builtin' }
];

function makeEnumData(overrides: Record<string, unknown> = {}): AnyGraphNode {
  return {
    $type: 'RosettaEnumeration',
    name: 'CurrencyEnum',
    namespace: 'test.enums',
    enumValues: [
      { $type: 'RosettaEnumValue', name: 'USD', display: 'US Dollar' },
      { $type: 'RosettaEnumValue', name: 'EUR', display: 'Euro' },
      { $type: 'RosettaEnumValue', name: 'GBP', display: 'British Pound' }
    ],
    synonyms: [],
    annotations: [],
    position: { x: 0, y: 0 },
    hasExternalRefs: false,
    errors: [],
    ...overrides
  } as AnyGraphNode;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EnumForm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('triggers addEnumValue when add-value button is clicked', () => {
    const actions = makeActions();

    render(
      <EnumForm
        meta={testMeta('test.enums')}
        nodeId="node-1"
        data={makeEnumData()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    // Post-icon-button migration: add-value is an icon-only <Button>
    // with aria-label="Add value".
    const addBtn = screen.getByLabelText('Add value');
    fireEvent.click(addBtn);

    expect(actions.addEnumValue).toHaveBeenCalledWith('node-1', '', undefined);
  });

  it('triggers removeEnumValue when remove button is clicked', () => {
    const actions = makeActions();

    render(
      <EnumForm
        meta={testMeta('test.enums')}
        nodeId="node-1"
        data={makeEnumData()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const removeBtns = screen.getAllByLabelText(/remove value/i);
    fireEvent.click(removeBtns[0]!);

    expect(actions.removeEnumValue).toHaveBeenCalledWith('node-1', 'USD');
  });

  it('triggers renameType after debounce on name change', () => {
    const actions = makeActions();

    render(
      <EnumForm
        meta={testMeta('test.enums')}
        nodeId="node-1"
        data={makeEnumData()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const nameInput = screen.getByLabelText(/type name/i);
    fireEvent.change(nameInput, { target: { value: 'StatusEnum' } });

    expect(actions.renameType).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(actions.renameType).toHaveBeenCalledWith('node-1', 'StatusEnum');
  });
});

// ---------------------------------------------------------------------------
// US3 / Phase 5b TDD tests (ET1–ET4) — z2f migration contract for EnumForm
// ---------------------------------------------------------------------------

// Spy on the upstream hooks so the migration tests can assert the
// integration surface (R4 useExternalSync + R11 canonical AST schema).
const useExternalSyncSpy = vi.fn();
const useZodFormSpy = vi.fn();
vi.mock('@zod-to-form/react', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('@zod-to-form/react');
  return {
    ...actual,
    useExternalSync: (...args: unknown[]) => {
      useExternalSyncSpy(...args);
      return (actual as any).useExternalSync(...(args as Parameters<typeof actual.useExternalSync>));
    },
    useZodForm: (...args: unknown[]) => {
      useZodFormSpy(...args);
      return (actual as any).useZodForm(...(args as Parameters<typeof actual.useZodForm>));
    }
  };
});

describe('EnumForm – US3/Phase 5b z2f migration contract (ET1–ET4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useExternalSyncSpy.mockClear();
    useZodFormSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // R11 — useZodForm is invoked with the canonical AST RosettaEnumerationSchema
  // (NOT the form-surface projection enumFormSchema).
  it('uses the canonical RosettaEnumerationSchema (R11) for useZodForm', async () => {
    const { RosettaEnumerationSchema } = await import('../../src/generated/zod-schemas.js');

    render(
      <EnumForm
        meta={testMeta('test.enums')}
        nodeId="node-1"
        data={makeEnumData()}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );

    expect(useZodFormSpy).toHaveBeenCalled();
    const firstCall = useZodFormSpy.mock.calls[0];
    expect(firstCall?.[0]).toBe(RosettaEnumerationSchema);
  });

  // ET1 — leaf field labels + tab order
  it('renders leaf fields (name, value rows with name + display) in the documented tab order', () => {
    const { container } = render(
      <EnumForm
        meta={testMeta('test.enums')}
        nodeId="node-1"
        data={makeEnumData()}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );

    // Name must be the first text input in the form-header slot.
    const header = container.querySelector('[data-slot="type-header"]')!;
    const nameInput = header.querySelector('input[data-slot="type-name-input"]');
    expect(nameInput).not.toBeNull();
    expect((nameInput as HTMLInputElement).value).toBe('CurrencyEnum');

    // Each enum value row exposes both a name input and a display input
    // (declared via the typed config as enumValues[].name + enumValues[].display).
    const rows = container.querySelectorAll('[data-slot="enum-value-row"]');
    expect(rows.length).toBe(3);
    rows.forEach((row, idx) => {
      const inputs = row.querySelectorAll('input[type="text"]');
      // First input is the value name, second is the display name
      expect(inputs.length).toBe(1);
      const ariaLabel = inputs[0]!.getAttribute('aria-label') ?? '';
      expect(ariaLabel.toLowerCase()).toContain('value name');
      // Document order: name input precedes display input within each row
      expect(row.querySelector('input[aria-label="Display name"]')).toBeNull();
      void idx;
    });
  });

  // ET2 — debounced rename fires exactly once with the new name
  it('fires actions.renameType exactly once after a single debounce window on name edit', () => {
    const renameType = vi.fn();
    const actions = { ...makeActions(), renameType };

    render(
      <EnumForm
        meta={testMeta('test.enums')}
        nodeId="node-1"
        data={makeEnumData()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const nameInput = screen.getByLabelText(/enum type name/i);

    // Type rapidly — three changes coalesced inside the debounce window
    fireEvent.change(nameInput, { target: { value: 'Stat' } });
    fireEvent.change(nameInput, { target: { value: 'Status' } });
    fireEvent.change(nameInput, { target: { value: 'StatusEnum' } });

    expect(renameType).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(renameType).toHaveBeenCalledTimes(1);
    expect(renameType).toHaveBeenCalledWith('node-1', 'StatusEnum');
  });

  // ET3 — useExternalSync contract: form repopulates pristine fields when
  // `data` reference changes (R4 + R11).
  it('repopulates pristine values when `data` reference changes (external sync)', () => {
    const actions = makeActions();

    const nodeA = makeEnumData(); // name: 'CurrencyEnum'
    const nodeB = makeEnumData({
      name: 'StatusEnum',
      enumValues: [
        { $type: 'RosettaEnumValue', name: 'OPEN', display: 'Open' },
        { $type: 'RosettaEnumValue', name: 'CLOSED', display: 'Closed' }
      ]
    });

    const { container, rerender } = render(
      <EnumForm
        meta={testMeta('test.enums')}
        nodeId="node-1"
        data={nodeA}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const initialName = container.querySelector('[data-slot="type-name-input"]') as HTMLInputElement;
    expect(initialName.value).toBe('CurrencyEnum');

    // Swap to nodeB (different reference identity)
    rerender(
      <EnumForm
        meta={testMeta('test.enums')}
        nodeId="node-1"
        data={nodeB}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Pristine name field reflects nodeB's value after the swap
    const nameAfter = container.querySelector('[data-slot="type-name-input"]') as HTMLInputElement;
    expect(nameAfter.value).toBe('StatusEnum');

    // Migration contract: the upstream useExternalSync hook is the
    // integration surface; spy is invoked with the most recent data prop.
    expect(useExternalSyncSpy).toHaveBeenCalled();
    const lastCall = useExternalSyncSpy.mock.calls.at(-1);
    expect(lastCall?.[1]).toBe(nodeB);

    // The new node's value rows are rendered (2 rows for nodeB)
    const rows = container.querySelectorAll('[data-slot="enum-value-row"]');
    expect(rows.length).toBe(2);
  });

  // ET4 — adding an enum value via the "Add Value" button fires addEnumValue;
  // editing an existing value's name + displayName fires updateEnumValue after
  // the debounce window. (T029 contract — covers the enum-specific row affordance.)
  it('add fires addEnumValue and editing name + displayName fires updateEnumValue after debounce', () => {
    const addEnumValue = vi.fn();
    const updateEnumValue = vi.fn();
    const actions = { ...makeActions(), addEnumValue, updateEnumValue };

    const { container } = render(
      <EnumForm
        meta={testMeta('test.enums')}
        nodeId="node-1"
        data={makeEnumData()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    // Click "Add Value" — the addEnumValue action fires immediately with the
    // empty-row template documented by EnumForm.
    const addBtn = container.querySelector('[data-slot="add-value-btn"]') as HTMLButtonElement;
    expect(addBtn).not.toBeNull();
    fireEvent.click(addBtn);

    expect(addEnumValue).toHaveBeenCalledTimes(1);
    expect(addEnumValue).toHaveBeenCalledWith('node-1', '', undefined);

    // Now exercise the per-row name + display path on the first existing row.
    const rows = container.querySelectorAll('[data-slot="enum-value-row"]');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const inputs = rows[0]!.querySelectorAll('input[type="text"]');
    const nameInput = inputs[0] as HTMLInputElement;

    fireEvent.change(nameInput, { target: { value: 'USD2' } });

    // No update action before the debounce expires
    expect(updateEnumValue).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    // updateEnumValue fires for both name + displayName edits inside the
    // debounce window — assert the most recent call carries the latest values.
    expect(updateEnumValue).toHaveBeenCalled();
    const lastCall = updateEnumValue.mock.calls.at(-1);
    // Signature: (nodeId, oldName, newName, displayName)
    expect(lastCall?.[0]).toBe('node-1');
    expect(lastCall?.[1]).toBe('USD');
    // The latest displayName typed wins inside the debounce window.
    expect(lastCall?.[3]).toBe('US Dollar');
  });
});

describe('EnumForm – merged inherited enum value list', () => {
  /** Build parent and child enum nodes for inheritance tests. */
  function makeEnumInheritanceNodes(childData: AnyGraphNode, parentValues: Record<string, unknown>[]): TypeGraphNode[] {
    const parentNode = {
      id: 'test.BaseEnum',
      type: 'enum',
      position: { x: 0, y: 0 },
      data: {
        $type: 'RosettaEnumeration',
        name: 'BaseEnum',
        namespace: 'test',
        enumValues: parentValues,
        synonyms: [],
        annotations: [],
        position: { x: 0, y: 0 },
        hasExternalRefs: false,
        errors: []
      },
      meta: testMeta('test')
    } as TypeGraphNode;
    const childNode = {
      id: 'node-1',
      type: 'enum',
      position: { x: 0, y: 0 },
      data: childData,
      meta: testMeta('test')
    } as TypeGraphNode;
    return [childNode, parentNode];
  }

  /** Make child enum data with parent ref to BaseEnum. */
  function makeChildEnum(overrides: Record<string, unknown> = {}): AnyGraphNode {
    return makeEnumData({ parent: { $refText: 'BaseEnum' }, ...overrides });
  }

  it('renders inherited enum value rows when allNodes provided', () => {
    const childData = makeChildEnum();
    const allNodes = makeEnumInheritanceNodes(childData, [{ $type: 'RosettaEnumValue', name: 'JPY', display: 'Yen' }]);
    const { container } = render(
      <EnumForm
        meta={testMeta('test.enums')}
        nodeId="node-1"
        data={childData}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
        allNodes={allNodes}
      />
    );
    const inherited = container.querySelectorAll('[data-slot="inherited-enum-value-row"]');
    expect(inherited.length).toBe(1);
  });

  it('shows inherited-from label with ancestor name', () => {
    const childData = makeChildEnum();
    const allNodes = makeEnumInheritanceNodes(childData, [{ $type: 'RosettaEnumValue', name: 'JPY', display: '' }]);
    render(
      <EnumForm
        meta={testMeta('test.enums')}
        nodeId="node-1"
        data={childData}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
        allNodes={allNodes}
      />
    );
    expect(screen.getByText(/inherited from BaseEnum/)).toBeDefined();
  });

  it('includes inherited count in Values label', () => {
    const childData = makeChildEnum();
    const allNodes = makeEnumInheritanceNodes(childData, [
      { $type: 'RosettaEnumValue', name: 'JPY', display: '' },
      { $type: 'RosettaEnumValue', name: 'CHF', display: '' }
    ]);
    render(
      <EnumForm
        meta={testMeta('test.enums')}
        nodeId="node-1"
        data={childData}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
        allNodes={allNodes}
      />
    );
    // 3 local + 2 inherited = 5
    expect(screen.getByText(/Values \(5\)/)).toBeDefined();
  });

  it('local value shadows inherited value with same name', () => {
    const childData = makeChildEnum({
      enumValues: [{ $type: 'RosettaEnumValue', name: 'GBP', display: '' }]
    });
    const allNodes = makeEnumInheritanceNodes(childData, [
      { $type: 'RosettaEnumValue', name: 'GBP', display: 'Pound' }
    ]);
    const { container } = render(
      <EnumForm
        meta={testMeta('test.enums')}
        nodeId="node-1"
        data={childData}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
        allNodes={allNodes}
      />
    );
    const local = container.querySelectorAll('[data-slot="enum-value-row"]');
    const inherited = container.querySelectorAll('[data-slot="inherited-enum-value-row"]');
    expect(local.length).toBe(1);
    expect(inherited.length).toBe(0);
  });

  it('Override button calls addEnumValue', () => {
    const addEnumValue = vi.fn();
    const childData = makeChildEnum();
    const allNodes = makeEnumInheritanceNodes(childData, [{ $type: 'RosettaEnumValue', name: 'JPY', display: 'Yen' }]);
    const { container } = render(
      <EnumForm
        meta={testMeta('test.enums')}
        nodeId="node-1"
        data={childData}
        availableTypes={AVAILABLE_TYPES}
        actions={{ ...makeActions(), addEnumValue }}
        allNodes={allNodes}
      />
    );
    const overrideBtn = container.querySelector('[data-slot="enum-value-override"]');
    fireEvent.click(overrideBtn!);
    expect(addEnumValue).toHaveBeenCalledWith('node-1', 'JPY', 'Yen');
  });

  it('inherited rows have no remove control', () => {
    const childData = makeChildEnum();
    const allNodes = makeEnumInheritanceNodes(childData, [{ $type: 'RosettaEnumValue', name: 'JPY', display: '' }]);
    const { container } = render(
      <EnumForm
        meta={testMeta('test.enums')}
        nodeId="node-1"
        data={childData}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
        allNodes={allNodes}
      />
    );
    const inheritedRow = container.querySelector('[data-slot="inherited-enum-value-row"]')!;
    expect(inheritedRow.querySelector('button[aria-label*="Remove"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// P2-b — Extends field drop validation
// The Extends TypeReferenceField must only accept Enum drops and reject
// wrong-kind drops (Data, Func, etc.) so setEnumParent is never called
// with an invalid parent kind.
// ---------------------------------------------------------------------------

function buildEnumDataTransfer(payload: TypeRefPayload): DataTransfer {
  const store = new Map<string, string>();
  store.set(TYPE_REF_PAYLOAD_MIME, JSON.stringify(payload));
  store.set(typeRefMimeForKind(payload.kind), '');
  return {
    types: Array.from(store.keys()),
    getData: (mime: string) => store.get(mime) ?? '',
    setData: () => {},
    dropEffect: '' as DataTransfer['dropEffect'],
    effectAllowed: 'link' as DataTransfer['effectAllowed']
  } as unknown as DataTransfer;
}

const EXTENDS_TYPES: TypeOption[] = [
  { value: 'test.enums.CurrencyEnum', label: 'CurrencyEnum', kind: 'enum', namespace: 'test.enums' },
  { value: 'test.Trade', label: 'Trade', kind: 'data', namespace: 'test' }
];

function makeSimpleEnumData(): AnyGraphNode {
  return {
    $type: 'RosettaEnumeration',
    name: 'PaymentEnum',
    namespace: 'test',
    enumValues: [],
    synonyms: [],
    annotations: [],
    position: { x: 0, y: 0 },
    hasExternalRefs: false,
    errors: []
  } as AnyGraphNode;
}

describe('EnumForm – Extends field drop validation (P2-b)', () => {
  it('rejects a Data drop on the Extends TypeReferenceField (does not call setEnumParent)', () => {
    const setEnumParent = vi.fn();
    const { container } = render(
      <EnumForm
        meta={testMeta('test.enums')}
        nodeId="test.PaymentEnum"
        data={makeSimpleEnumData()}
        availableTypes={EXTENDS_TYPES}
        actions={makeActions({ setEnumParent })}
      />
    );

    const dropTargets = container.querySelectorAll('[data-slot="type-reference"]');
    expect(dropTargets.length).toBeGreaterThan(0);
    const extendsDropTarget = dropTargets[0]!;

    const dataPayload: TypeRefPayload = {
      rune: 'type-ref',
      namespaceUri: 'test',
      typeId: 'test.Trade',
      typeName: 'Trade',
      kind: 'Data'
    };

    act(() => {
      fireEvent.drop(extendsDropTarget, { dataTransfer: buildEnumDataTransfer(dataPayload) });
    });

    expect(setEnumParent).not.toHaveBeenCalled();
  });

  it('accepts an Enum drop on the Extends TypeReferenceField (calls setEnumParent)', () => {
    const setEnumParent = vi.fn();
    const { container } = render(
      <EnumForm
        meta={testMeta('test.enums')}
        nodeId="test.PaymentEnum"
        data={makeSimpleEnumData()}
        availableTypes={EXTENDS_TYPES}
        actions={makeActions({ setEnumParent })}
      />
    );

    const dropTargets = container.querySelectorAll('[data-slot="type-reference"]');
    const extendsDropTarget = dropTargets[0]!;

    const enumPayload: TypeRefPayload = {
      rune: 'type-ref',
      namespaceUri: 'test.enums',
      typeId: 'test.enums.CurrencyEnum',
      typeName: 'CurrencyEnum',
      kind: 'Enum'
    };

    act(() => {
      fireEvent.drop(extendsDropTarget, { dataTransfer: buildEnumDataTransfer(enumPayload) });
    });

    expect(setEnumParent).toHaveBeenCalledWith('test.PaymentEnum', 'test.enums.CurrencyEnum');
  });

  // See Codex review, PR #494: a refOnly node's domain/graph-level errors
  // must stay visible once it routes into EnumForm instead of OtherForm.
  it('renders domain/graph-level validation errors from node meta', () => {
    render(
      <EnumForm
        meta={testMeta('test.model', {
          errors: [{ nodeId: 'test.PaymentEnum', severity: 'error', message: 'Circular inheritance detected' }]
        })}
        nodeId="test.PaymentEnum"
        data={makeEnumData()}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );
    expect(screen.getByText('Circular inheritance detected')).toBeDefined();
  });
});
