// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Integration tests for ChoiceForm component (T051).
 *
 * Covers:
 * - Form renders all options for a loaded Choice
 * - Add option shows type selector
 * - Remove option removes member
 * - Choice badge renders
 * - Name editing triggers renameType
 *
 * Phase 5a (US3) of `013-z2f-editor-migration` adds CT1–CT4 below covering the
 * z2f-primitive migration contract: leaf-field rendering, debounced rename,
 * external-data sync repopulation, and the Choice-specific `addChoiceOption`
 * fan-out from the inline TypeSelector.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { TypeSelectorProps } from '../../src/components/editors/TypeSelector.js';
import { ChoiceForm } from '../../src/components/editors/ChoiceForm.js';
import type { AnyGraphNode, TypeOption, EditorFormActions } from '../../src/types.js';
import { testMeta } from '../helpers/node-meta.js';

// ---------------------------------------------------------------------------
// Spy on the upstream useExternalSync hook so CT3 can assert the migration
// adopted it (vs. the now-removed projection-helper passthrough).
// ---------------------------------------------------------------------------

const useExternalSyncSpy = vi.fn();
vi.mock('@zod-to-form/react', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('@zod-to-form/react');
  return {
    ...actual,
    useExternalSync: (...args: unknown[]) => {
      useExternalSyncSpy(...args);
      return (actual as any).useExternalSync(...(args as Parameters<typeof actual.useExternalSync>));
    }
  };
});

// ---------------------------------------------------------------------------
// Stub the bespoke <TypeSelector> so CT4 can drive the add-option fan-out
// without exercising the Radix Select popover (jsdom-hostile). The stub
// renders a hidden <select> element wired to props.onSelect, mirroring the
// real component's contract for the only behaviour the test cares about.
// ---------------------------------------------------------------------------

vi.mock('../../src/components/editors/TypeSelector.js', () => {
  function TypeSelector(props: TypeSelectorProps) {
    return (
      <select
        data-slot="type-selector-stub"
        data-placeholder={props.placeholder ?? ''}
        value={props.value ?? ''}
        onChange={(e) => props.onSelect(e.target.value || null)}
      >
        <option value="">{props.placeholder ?? '—'}</option>
        {(props.options ?? []).map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }
  function getKindBadgeClasses(_kind: string): string {
    return '';
  }
  function getKindDotClass(_kind: string): string {
    return '';
  }
  return { TypeSelector, getKindBadgeClasses, getKindDotClass };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActions(): EditorFormActions<'choice'> {
  return {
    renameType: vi.fn(),
    deleteType: vi.fn(),
    updateDefinition: vi.fn(),
    updateComments: vi.fn(),
    addSynonym: vi.fn(),
    removeSynonym: vi.fn(),
    addChoiceOption: vi.fn(),
    removeChoiceOption: vi.fn(),
    validate: vi.fn().mockReturnValue([])
  };
}

const AVAILABLE_TYPES: TypeOption[] = [
  { value: 'test.model.CashPayment', label: 'CashPayment', kind: 'data', namespace: 'test.model' },
  {
    value: 'test.model.PhysicalSettlement',
    label: 'PhysicalSettlement',
    kind: 'data',
    namespace: 'test.model'
  },
  { value: 'test.model.Trade', label: 'Trade', kind: 'data', namespace: 'test.model' },
  { value: 'builtin::string', label: 'string', kind: 'builtin' }
];

function makeChoiceData(overrides: Record<string, unknown> = {}): AnyGraphNode {
  return {
    $type: 'Choice',
    name: 'PaymentType',
    namespace: 'test.model',
    attributes: [
      { $type: 'ChoiceOption', typeCall: { $type: 'TypeCall', type: { $refText: 'CashPayment' } } },
      {
        $type: 'ChoiceOption',
        typeCall: { $type: 'TypeCall', type: { $refText: 'PhysicalSettlement' } }
      }
    ],
    conditions: [],
    annotations: [],
    synonyms: [],
    position: { x: 0, y: 0 },
    hasExternalRefs: false,
    errors: [],
    ...overrides
  } as AnyGraphNode;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChoiceForm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('triggers removeChoiceOption when remove button is clicked', () => {
    const actions = makeActions();

    render(
      <ChoiceForm
        meta={testMeta('test.model')}
        nodeId="node-1"
        data={makeChoiceData()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const removeBtns = screen.getAllByLabelText(/remove option/i);
    fireEvent.click(removeBtns[0]!);

    expect(actions.removeChoiceOption).toHaveBeenCalledWith('node-1', 'CashPayment');
  });

  it('triggers renameType after debounce on name change', () => {
    const actions = makeActions();

    render(
      <ChoiceForm
        meta={testMeta('test.model')}
        nodeId="node-1"
        data={makeChoiceData()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const nameInput = screen.getByLabelText(/type name/i);
    fireEvent.change(nameInput, { target: { value: 'SettlementType' } });

    expect(actions.renameType).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(actions.renameType).toHaveBeenCalledWith('node-1', 'SettlementType');
  });

  it('renders empty state when no options', () => {
    render(
      <ChoiceForm
        meta={testMeta('test.model')}
        nodeId="node-1"
        data={makeChoiceData({ attributes: [] })}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );

    expect(screen.getByText(/No options defined/)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 5a (US3) z2f-migration contract tests (CT1–CT4)
// ---------------------------------------------------------------------------

describe('ChoiceForm – US3 z2f migration contract (CT1–CT4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useExternalSyncSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // CT1 — leaf field set + tab order matches the baseline
  it('renders leaf fields (name and definition with source-only comments) in the documented tab order', () => {
    const data = makeChoiceData({
      definition: 'A payment classification'
    });
    // `comments` is UI metadata (node.meta sibling) — seeded into form state
    // from `meta`, not from the domain payload.
    const { container } = render(
      <ChoiceForm
        meta={testMeta('test.model', { comments: 'Initial comments' })}
        nodeId="node-1"
        data={data}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );

    // Name input is the first text input, in the form-header slot.
    const header = container.querySelector('[data-slot="type-header"]')!;
    const nameInput = header.querySelector('input[type="text"], input:not([type])');
    expect(nameInput).not.toBeNull();
    expect((nameInput as HTMLInputElement).value).toBe('PaymentType');

    expect(container.querySelector('[data-slot="metadata-description"]')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Details', exact: true }));
    // Documentation mounts on activation; authored comments remain Source-only.
    const descriptionTextarea = container.querySelector('[data-slot="metadata-description"]');
    const commentsTextarea = container.querySelector('[data-slot="metadata-comments"]');
    expect(descriptionTextarea).not.toBeNull();
    expect(commentsTextarea).toBeNull();
    expect((descriptionTextarea as HTMLTextAreaElement).value).toBe('A payment classification');

    // Document order is name input before the activated definition field.
    const allInteractive = Array.from(
      container.querySelectorAll(
        'input[data-slot="type-name-input"], textarea[data-slot="metadata-description"], textarea[data-slot="metadata-comments"]'
      )
    );
    const slots = allInteractive.map((el) => el.getAttribute('data-slot'));
    expect(slots).toEqual(['type-name-input', 'metadata-description']);
  });

  // CT2 — debounced rename fires exactly once with the latest value
  it('fires actions.renameType exactly once after a single debounce window on name edit', () => {
    const renameType = vi.fn();
    const actions = { ...makeActions(), renameType };

    render(
      <ChoiceForm
        meta={testMeta('test.model')}
        nodeId="node-1"
        data={makeChoiceData()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const nameInput = screen.getByLabelText(/type name/i);

    // Three rapid changes coalesce inside the debounce window.
    fireEvent.change(nameInput, { target: { value: 'Settle' } });
    fireEvent.change(nameInput, { target: { value: 'Settlemen' } });
    fireEvent.change(nameInput, { target: { value: 'SettlementType' } });

    expect(renameType).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(renameType).toHaveBeenCalledTimes(1);
    expect(renameType).toHaveBeenCalledWith('node-1', 'SettlementType');
  });

  // CT3 — useExternalSync contract: pristine fields repopulate on data swap.
  it('repopulates pristine values when `data` reference changes (external sync)', () => {
    const renameType = vi.fn();
    const actions = { ...makeActions(), renameType };

    const nodeA = makeChoiceData({ definition: 'Variant A definition' });
    const nodeB = makeChoiceData({
      name: 'SettlementType',
      definition: 'Variant B definition',
      attributes: [
        {
          $type: 'ChoiceOption',
          typeCall: { $type: 'TypeCall', type: { $refText: 'Trade' } }
        }
      ]
    });

    const { container, rerender } = render(
      <ChoiceForm
        meta={testMeta('test.model')}
        nodeId="node-1"
        data={nodeA}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const initialName = container.querySelector('[data-slot="type-name-input"]') as HTMLInputElement;
    expect(initialName.value).toBe('PaymentType');

    // Dirty the name field on nodeA, then swap to nodeB.
    fireEvent.change(initialName, { target: { value: 'Dirty' } });

    rerender(
      <ChoiceForm
        meta={testMeta('test.model')}
        nodeId="node-2"
        data={nodeB}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });

    // The pending dirty edit was flushed against the original binding.
    expect(renameType).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'Details', exact: true }));
    // First activation reads the pristine fields from nodeB after the swap.
    const definitionTextarea = container.querySelector('[data-slot="metadata-description"]') as HTMLTextAreaElement;
    expect(definitionTextarea.value).toBe('Variant B definition');

    // The upstream useExternalSync hook is the integration surface.
    expect(useExternalSyncSpy).toHaveBeenCalled();
    const lastCall = useExternalSyncSpy.mock.calls.at(-1);
    expect(lastCall?.[1]).toBe(nodeB);
  });

  // CT4 — Choice-specific: adding an option fires actions.addChoiceOption with
  // the selected type label. The contract is `addChoiceOption(nodeId, typeName)`
  // per src/types.ts ChoiceFormActions; the inline TypeSelector resolves the
  // selected option's `value` to its `label` before dispatching.
  it('adding a choice option fires actions.addChoiceOption with the chosen type label', () => {
    const addChoiceOption = vi.fn();
    const actions = { ...makeActions(), addChoiceOption };

    const { container } = render(
      <ChoiceForm
        meta={testMeta('test.model')}
        nodeId="node-1"
        data={makeChoiceData()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    // The "Add option" TypeSelector is the second selector in the form
    // (the existing options render their own ChoiceOptionRow above it).
    const addContainer = container.querySelector('[data-slot="add-option"]')!;
    const addSelect = addContainer.querySelector('[data-slot="type-selector-stub"]') as HTMLSelectElement;
    expect(addSelect).not.toBeNull();

    // Pick a type that is not already used as an option (Trade — the fixture
    // has CashPayment and PhysicalSettlement).
    fireEvent.change(addSelect, { target: { value: 'test.model.Trade' } });

    expect(addChoiceOption).toHaveBeenCalledTimes(1);
    expect(addChoiceOption).toHaveBeenCalledWith('node-1', 'Trade');
  });

  // See Codex review, PR #494: a refOnly node's domain/graph-level errors
  // must stay visible once it routes into ChoiceForm instead of OtherForm.
  it('renders domain/graph-level validation errors from node meta', () => {
    render(
      <ChoiceForm
        meta={testMeta('test.model', {
          errors: [{ nodeId: 'node-1', severity: 'error', message: 'Circular inheritance detected' }]
        })}
        nodeId="node-1"
        data={makeChoiceData()}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );
    expect(screen.getByText('Circular inheritance detected')).toBeDefined();
  });
});
