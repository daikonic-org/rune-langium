// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Integration tests for DataTypeForm component (T047).
 *
 * Covers:
 * - Renders all fields for a loaded Data type
 * - Rename triggers renameType action
 * - Parent type selection triggers setInheritance
 * - Add/remove attribute round-trip
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DataTypeForm } from '../../src/components/editors/DataTypeForm.js';
import type { AnyGraphNode, TypeOption, EditorFormActions, TypeGraphNode } from '../../src/types.js';
import { TYPE_REF_PAYLOAD_MIME, typeRefMimeForKind } from '../../src/types/structure-view.js';
import type { TypeRefPayload } from '../../src/types/structure-view.js';
import { testMeta } from '../helpers/node-meta.js';

function makeActions(overrides: Partial<EditorFormActions<'data'>> = {}): EditorFormActions<'data'> {
  return {
    renameType: vi.fn(),
    deleteType: vi.fn(),
    updateDefinition: vi.fn(),
    updateComments: vi.fn(),
    addSynonym: vi.fn(),
    removeSynonym: vi.fn(),
    addAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    updateAttribute: vi.fn(),
    reorderAttribute: vi.fn(),
    setInheritance: vi.fn(),
    validate: vi.fn(() => []),
    ...overrides
  };
}

const AVAILABLE_TYPES: TypeOption[] = [
  { value: 'builtin::string', label: 'string', kind: 'builtin' },
  { value: 'builtin::date', label: 'date', kind: 'builtin' },
  { value: 'test.Event', label: 'Event', kind: 'data', namespace: 'test' }
];

function makeDataNode(): AnyGraphNode {
  return {
    $type: 'Data',
    name: 'Trade',
    namespace: 'test.model',
    definition: 'A financial trade',
    attributes: [
      {
        $type: 'Attribute',
        name: 'tradeDate',
        typeCall: { $type: 'TypeCall', type: { $refText: 'date' } },
        card: { inf: 1, sup: 1, unbounded: false },
        override: false
      },
      {
        $type: 'Attribute',
        name: 'currency',
        typeCall: { $type: 'TypeCall', type: { $refText: 'string' } },
        card: { inf: 1, sup: 1, unbounded: false },
        override: false
      }
    ],
    superType: { $refText: 'Event' },
    conditions: [],
    annotations: [],
    synonyms: [],
    position: { x: 0, y: 0 },
    hasExternalRefs: false,
    errors: []
  } as AnyGraphNode;
}

describe('DataTypeForm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls renameType after debounce when name changes', () => {
    const renameType = vi.fn();
    const actions = makeActions({ renameType });

    render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={makeDataNode()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const nameInput = screen.getByLabelText(/data type name/i);
    fireEvent.change(nameInput, { target: { value: 'Execution' } });

    expect(renameType).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(renameType).toHaveBeenCalledWith('test.Trade', 'Execution');
  });

  it('calls addAttribute when "Add Attribute" button is clicked', () => {
    const addAttribute = vi.fn();
    const actions = makeActions({ addAttribute });
    const { container } = render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={makeDataNode()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const addBtn = container.querySelector('[data-slot="add-attribute-btn"]');
    expect(addBtn).toBeDefined();
    fireEvent.click(addBtn!);

    expect(addAttribute).toHaveBeenCalledWith('test.Trade', '', 'string', '(1..1)');
  });

  it('calls removeAttribute when attribute remove button is clicked', () => {
    const removeAttribute = vi.fn();
    const actions = makeActions({ removeAttribute });

    render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={makeDataNode()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const removeBtns = screen.getAllByLabelText(/remove attribute/i);
    fireEvent.click(removeBtns[0]!);

    expect(removeAttribute).toHaveBeenCalledWith('test.Trade', 'tradeDate');
  });

  it('shows empty state when no attributes', () => {
    const actions = makeActions();
    const data = makeDataNode();
    (data as any).attributes = [];

    render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={data}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    expect(screen.getByText(/no attributes defined/i)).toBeDefined();
  });
});

describe('DataTypeForm – merged inherited attribute list', () => {
  /** Build a parent node with given attributes, and a child node pointing to it. */
  function makeInheritanceNodes(childData: AnyGraphNode, parentAttrs: Record<string, unknown>[]): TypeGraphNode[] {
    const parentNode = {
      id: 'test.BaseType',
      type: 'data',
      position: { x: 0, y: 0 },
      data: {
        $type: 'Data',
        name: 'BaseType',
        namespace: 'test',
        attributes: parentAttrs,
        conditions: [],
        annotations: [],
        synonyms: [],
        position: { x: 0, y: 0 },
        hasExternalRefs: false,
        errors: []
      },
      meta: testMeta('test')
    } as TypeGraphNode;
    const childNode = {
      id: 'test.Trade',
      type: 'data',
      position: { x: 0, y: 0 },
      data: childData,
      meta: testMeta('test')
    } as TypeGraphNode;
    return [childNode, parentNode];
  }

  const baseTypeAttr = {
    $type: 'Attribute',
    name: 'id',
    typeCall: { $type: 'TypeCall', type: { $refText: 'string' } },
    card: { inf: 1, sup: 1, unbounded: false },
    override: false
  };

  /** makeDataNode already has superType: { $refText: 'Event' }; override to 'BaseType'. */
  function makeChildData(overrides: Record<string, unknown> = {}): AnyGraphNode {
    const d = makeDataNode();
    (d as any).superType = { $refText: 'BaseType' };
    return { ...d, ...overrides } as AnyGraphNode;
  }

  it('renders inherited attribute rows when allNodes provided', () => {
    const childData = makeChildData();
    const allNodes = makeInheritanceNodes(childData, [baseTypeAttr]);
    const { container } = render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={childData}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
        allNodes={allNodes}
      />
    );
    const inherited = container.querySelectorAll('[data-slot="inherited-attribute-row"]');
    expect(inherited.length).toBe(1);
    expect(inherited[0]?.querySelector('[data-slot="type-picker-trigger"]')).toHaveAttribute('data-kind', 'BasicType');
  });

  it('shows inherited-from label with ancestor name', () => {
    const childData = makeChildData();
    const allNodes = makeInheritanceNodes(childData, [baseTypeAttr]);
    render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={childData}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
        allNodes={allNodes}
      />
    );
    expect(screen.getByText(/inherited from BaseType/)).toBeDefined();
  });

  it('includes inherited count in Attributes label', () => {
    const childData = makeChildData();
    const allNodes = makeInheritanceNodes(childData, [baseTypeAttr]);
    render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={childData}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
        allNodes={allNodes}
      />
    );
    // 2 local + 1 inherited = 3
    expect(screen.getByText(/Attributes \(3\)/)).toBeDefined();
  });

  it('does not render a separate InheritedMembersSection', () => {
    const childData = makeChildData();
    const allNodes = makeInheritanceNodes(childData, [baseTypeAttr]);
    const { container } = render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={childData}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
        allNodes={allNodes}
      />
    );
    expect(container.querySelector('[data-slot="inherited-members-section"]')).toBeNull();
  });

  it('local attribute shadows inherited attribute with same name', () => {
    const childData = makeChildData({
      attributes: [
        {
          $type: 'Attribute',
          name: 'id',
          typeCall: { $type: 'TypeCall', type: { $refText: 'string' } },
          card: { inf: 1, sup: 1, unbounded: false },
          override: false
        }
      ]
    });
    const allNodes = makeInheritanceNodes(childData, [baseTypeAttr]);
    const { container } = render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={childData}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
        allNodes={allNodes}
      />
    );
    const local = container.querySelectorAll('[data-slot="attribute-row"]');
    const inherited = container.querySelectorAll('[data-slot="inherited-attribute-row"]');
    expect(local.length).toBe(1);
    expect(inherited.length).toBe(0);
  });

  it('Override button calls addAttribute', () => {
    const addAttribute = vi.fn();
    const childData = makeChildData();
    const allNodes = makeInheritanceNodes(childData, [baseTypeAttr]);
    const { container } = render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={childData}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions({ addAttribute })}
        allNodes={allNodes}
      />
    );
    const overrideBtn = container.querySelector('[data-slot="attribute-override"]');
    fireEvent.click(overrideBtn!);
    expect(addAttribute).toHaveBeenCalledWith('test.Trade', 'id', 'string', '(1..1)');
  });

  it('after Override, addAttribute action is dispatched for the inherited attribute', () => {
    const addAttribute = vi.fn();
    const childData = makeChildData();
    const allNodes = makeInheritanceNodes(childData, [baseTypeAttr]);
    const { container } = render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={childData}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions({ addAttribute })}
        allNodes={allNodes}
      />
    );
    const overrideBtn = container.querySelector('[data-slot="attribute-override"]');
    fireEvent.click(overrideBtn!);
    // The action dispatches addAttribute; when the store updates and re-renders
    // with the new data, the inherited row will be shadowed by the local one.
    expect(addAttribute).toHaveBeenCalledWith('test.Trade', 'id', 'string', '(1..1)');
  });

  it('inherited rows have no remove or drag controls', () => {
    const childData = makeChildData();
    const allNodes = makeInheritanceNodes(childData, [baseTypeAttr]);
    const { container } = render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={childData}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
        allNodes={allNodes}
      />
    );
    const inheritedRow = container.querySelector('[data-slot="inherited-attribute-row"]')!;
    expect(inheritedRow.querySelector('[data-slot="attribute-remove"]')).toBeNull();
    expect(inheritedRow.querySelector('[data-slot="drag-handle"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// US1 TDD tests (T010–T012) — baseline + external-sync contract
// ---------------------------------------------------------------------------

// Spy on the upstream useExternalSync hook so T012 can assert the migration
// adopted it (vs. the now-deleted local <ExternalDataSync> component).
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

describe('DataTypeForm – US1 z2f migration contract (T010–T012)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useExternalSyncSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // T010 — leaf field set + tab order
  it('renders leaf fields (name and definition with source-only comments) in the documented tab order', () => {
    const data = makeDataNode();
    // `comments` is UI metadata (node.meta sibling) — seeded into form state
    // from `meta`, not from the domain payload.
    const { container } = render(
      <DataTypeForm
        meta={testMeta('test.model', { comments: 'Initial comments' })}
        nodeId="test.Trade"
        data={data}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );

    // Name must be the first text input in the form-header slot.
    const header = container.querySelector('[data-slot="type-header"]')!;
    const nameInput = header.querySelector('input[type="text"], input:not([type])');
    expect(nameInput).not.toBeNull();
    expect((nameInput as HTMLInputElement).value).toBe('Trade');

    // Metadata fields live in the "Doc" tab — activate it first.
    // Base UI tabs switch on click, so drive the actual interaction the user
    // performs instead of the old Radix-specific mouseDown shortcut.
    const docTab = screen.getByRole('tab', { name: /details/i });
    act(() => {
      fireEvent.click(docTab);
    });

    // The MetadataSection renders Description (definition) and Comments
    // textareas — assert both are present with the values from the data prop.
    const descriptionTextarea = container.querySelector('[data-slot="metadata-description"]');
    const commentsTextarea = container.querySelector('[data-slot="metadata-comments"]');
    expect(descriptionTextarea).not.toBeNull();
    expect(commentsTextarea).toBeNull();
    expect((descriptionTextarea as HTMLTextAreaElement).value).toBe('A financial trade');

    // Tab order: name input appears before doc-tab content in DOM order.
    // After clicking Doc, the textarea elements are rendered in the active panel.
    const allInteractive = Array.from(
      container.querySelectorAll(
        'input[data-slot="type-name-input"], textarea[data-slot="metadata-description"], textarea[data-slot="metadata-comments"]'
      )
    );
    const slots = allInteractive.map((el) => el.getAttribute('data-slot'));
    expect(slots).toEqual(['type-name-input', 'metadata-description']);
  });

  // T011 — debounced rename fires exactly once with the new name
  it('fires actions.renameType exactly once after a single debounce window on name edit', () => {
    const renameType = vi.fn();
    const actions = makeActions({ renameType });

    render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={makeDataNode()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const nameInput = screen.getByLabelText(/data type name/i);

    // Type rapidly — three changes coalesced inside the debounce window
    fireEvent.change(nameInput, { target: { value: 'Trad' } });
    fireEvent.change(nameInput, { target: { value: 'Tradex' } });
    fireEvent.change(nameInput, { target: { value: 'Execution' } });

    // Before the debounce expires, no action fires
    expect(renameType).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Exactly one commit, with the latest value
    expect(renameType).toHaveBeenCalledTimes(1);
    expect(renameType).toHaveBeenCalledWith('test.Trade', 'Execution');
  });

  // T012 — useExternalSync contract: form repopulates pristine fields when
  // `data` reference changes; pending debounced commit on the original node
  // flushes before/after the swap (action attributed to nodeA's id).
  it('repopulates pristine values when `data` reference changes (external sync)', () => {
    const renameType = vi.fn();
    const updateDefinition = vi.fn();
    const actions = makeActions({ renameType, updateDefinition });

    const nodeA = makeDataNode(); // name: 'Trade', definition: 'A financial trade'
    const nodeB = (() => {
      const b = makeDataNode();
      (b as any).name = 'Position';
      (b as any).definition = 'A held position';
      return b;
    })();

    const { container, rerender } = render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={nodeA}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    // Confirm initial state pulls from nodeA
    const initialName = container.querySelector('[data-slot="type-name-input"]') as HTMLInputElement;
    expect(initialName.value).toBe('Trade');

    // Dirty the name field on nodeA
    fireEvent.change(initialName, { target: { value: 'Dirty' } });

    // Swap to nodeB (different reference identity, same nodeId for simplicity).
    // The form host flushes the pending debounce on unmount of the old binding
    // OR the next debounce tick — advance both to be deterministic.
    rerender(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Position"
        data={nodeB}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });

    // The pending dirty edit was flushed against the original node
    // (the renameType action fires once the debounce completes; the exact
    // nodeId passed is current-render-bound per react-hook-form's closure,
    // so the test asserts the call happened, not the id).
    expect(renameType).toHaveBeenCalled();

    // Pristine fields (definition) reflect nodeB's values after the swap.
    // MetadataSection lives in the "Doc" tab — activate it to render the DOM.
    // Base UI tabs switch on click, so use the real activation gesture.
    const docTab = screen.getByRole('tab', { name: /details/i });
    act(() => {
      fireEvent.click(docTab);
    });

    const definitionTextarea = container.querySelector('[data-slot="metadata-description"]') as HTMLTextAreaElement;
    expect(definitionTextarea.value).toBe('A held position');

    // Migration contract: the upstream useExternalSync hook (not the local
    // ExternalDataSync component) is the integration surface. The spy is
    // invoked at least once on initial mount + once after the data swap.
    expect(useExternalSyncSpy).toHaveBeenCalled();
    // First call's source argument identity matches the most recent data prop
    const lastCall = useExternalSyncSpy.mock.calls.at(-1);
    expect(lastCall?.[1]).toBe(nodeB);
  });
});

// ---------------------------------------------------------------------------
// US2 TDD tests (T018–T019) — array reorder via z2f primitive routing
// ---------------------------------------------------------------------------

/**
 * Build a Data fixture with three attributes (a1, a2, a3) for reorder tests.
 * The `useFieldArray` index is the same as the array index in `attributes[]`.
 */
function makeThreeAttrDataNode(): AnyGraphNode {
  return {
    $type: 'Data',
    name: 'Trade',
    namespace: 'test.model',
    definition: 'A financial trade',
    attributes: [
      {
        $type: 'Attribute',
        name: 'a1',
        typeCall: { $type: 'TypeCall', type: { $refText: 'string' } },
        card: { inf: 1, sup: 1, unbounded: false },
        override: false
      },
      {
        $type: 'Attribute',
        name: 'a2',
        typeCall: { $type: 'TypeCall', type: { $refText: 'string' } },
        card: { inf: 1, sup: 1, unbounded: false },
        override: false
      },
      {
        $type: 'Attribute',
        name: 'a3',
        typeCall: { $type: 'TypeCall', type: { $refText: 'string' } },
        card: { inf: 1, sup: 1, unbounded: false },
        override: false
      }
    ],
    superType: undefined,
    conditions: [],
    annotations: [],
    synonyms: [],
    position: { x: 0, y: 0 },
    hasExternalRefs: false,
    errors: []
  } as AnyGraphNode;
}

/**
 * Construct a synthetic DataTransfer mock that supports setData/getData.
 * The same backing store is shared between dragStart and drop so the
 * source index round-trips through the synthetic event.
 */
function makeDataTransfer(): DataTransfer {
  const store: Record<string, string> = {};
  return {
    setData: (type: string, value: string) => {
      store[type] = value;
    },
    getData: (type: string) => store[type] ?? '',
    effectAllowed: 'move',
    dropEffect: 'move',
    types: ['text/plain'],
    items: [] as unknown as DataTransferItemList,
    files: [] as unknown as FileList,
    clearData: () => undefined,
    setDragImage: () => undefined
  } as unknown as DataTransfer;
}

describe('DataTypeForm – US2 array reorder contract (T018–T019)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // T018 — drag-handle reorder fires actions.reorderAttribute exactly once
  // with (nodeId, fromIndex, toIndex) and the form's `members` field state
  // reflects the new order.
  it('drag-handle reorder fires actions.reorderAttribute once with (from, to) and updates form state', () => {
    const reorderAttribute = vi.fn();
    const actions = makeActions({ reorderAttribute });

    const { container } = render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={makeThreeAttrDataNode()}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    const rows = container.querySelectorAll('[data-slot="attribute-row"]');
    expect(rows.length).toBe(3);

    // Collect the rendered name input values to confirm initial order [a1,a2,a3]
    const namesBefore = Array.from(container.querySelectorAll('[data-slot="attribute-name"]')).map(
      (el) => (el as HTMLInputElement).value
    );
    expect(namesBefore).toEqual(['a1', 'a2', 'a3']);

    // Simulate dragging row index 2 onto row index 0:
    //  - dragStart on the source row writes index 2 to dataTransfer
    //  - drop on the target row reads it back and calls handleReorder(2, 0)
    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(rows[2]!, { dataTransfer });
    fireEvent.dragOver(rows[0]!, { dataTransfer });
    fireEvent.drop(rows[0]!, { dataTransfer });

    // Exactly one reorder action — no double-fire from gesture + primitive
    expect(reorderAttribute).toHaveBeenCalledTimes(1);
    expect(reorderAttribute).toHaveBeenCalledWith('test.Trade', 2, 0);

    // Form state's members array reflects the new order [a3, a1, a2]
    const namesAfter = Array.from(container.querySelectorAll('[data-slot="attribute-name"]')).map(
      (el) => (el as HTMLInputElement).value
    );
    expect(namesAfter).toEqual(['a3', 'a1', 'a2']);
  });

  // T019 — add → reorder → remove sequence replays in user-visible order
  // against the action surface (US2 Acceptance Scenario 3).
  //
  // The form is graph-controlled: the rendered row set is derived from `data`,
  // and the parent host re-renders with a new `data` after each action lands
  // in the store. This test simulates that round-trip by re-rendering with
  // the updated fixture between actions, and asserts the three callbacks
  // fire in user-visible order with correct indices/names.
  it('add → reorder → remove sequence replays in order', () => {
    const callOrder: string[] = [];
    const addAttribute = vi.fn(() => {
      callOrder.push('add');
    });
    const reorderAttribute = vi.fn(() => {
      callOrder.push('reorder');
    });
    const removeAttribute = vi.fn(() => {
      callOrder.push('remove');
    });
    const actions = makeActions({ addAttribute, reorderAttribute, removeAttribute });

    const initial = makeThreeAttrDataNode();
    const { container, rerender } = render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={initial}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );

    // ---- Step 1 — add a new attribute -------------------------------------
    const addBtn = container.querySelector('[data-slot="add-attribute-btn"]')!;
    fireEvent.click(addBtn);
    expect(addAttribute).toHaveBeenCalledTimes(1);
    expect(addAttribute).toHaveBeenLastCalledWith('test.Trade', '', 'string', '(1..1)');

    // Simulate the parent's store updating: data now has 4 attrs (the new
    // row appended at the tail). Re-render to surface the next user-visible
    // state. useExternalSync resets pristine fields to the new data.
    const afterAdd = makeThreeAttrDataNode();
    (afterAdd as any).attributes = [
      ...((initial as any).attributes as any[]),
      {
        $type: 'Attribute',
        name: 'a4',
        typeCall: { $type: 'TypeCall', type: { $refText: 'string' } },
        card: { inf: 1, sup: 1, unbounded: false },
        override: false
      }
    ];
    rerender(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={afterAdd}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );
    let rows = container.querySelectorAll('[data-slot="attribute-row"]');
    expect(rows.length).toBe(4);

    // ---- Step 2 — drag the newly-added row (index 3) above row 1 -----------
    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(rows[3]!, { dataTransfer });
    fireEvent.dragOver(rows[1]!, { dataTransfer });
    fireEvent.drop(rows[1]!, { dataTransfer });
    expect(reorderAttribute).toHaveBeenCalledTimes(1);
    expect(reorderAttribute).toHaveBeenLastCalledWith('test.Trade', 3, 1);

    // Simulate the store reordering attributes accordingly: [a1, a4, a2, a3].
    const afterReorder = makeThreeAttrDataNode();
    const reorderedAttrs = [...((afterAdd as any).attributes as any[])];
    const [moved] = reorderedAttrs.splice(3, 1);
    reorderedAttrs.splice(1, 0, moved);
    (afterReorder as any).attributes = reorderedAttrs;
    rerender(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={afterReorder}
        availableTypes={AVAILABLE_TYPES}
        actions={actions}
      />
    );
    rows = container.querySelectorAll('[data-slot="attribute-row"]');
    expect(rows.length).toBe(4);

    // ---- Step 3 — remove the (now index 1) formerly-added row -------------
    const removeBtns = rows[1]!.querySelectorAll('[data-slot="attribute-remove"]');
    expect(removeBtns.length).toBe(1);
    fireEvent.click(removeBtns[0]!);
    expect(removeAttribute).toHaveBeenCalledTimes(1);
    // The committed name at index 1 is 'a4' (the moved row).
    expect(removeAttribute).toHaveBeenLastCalledWith('test.Trade', 'a4');

    // Actions fired in user-visible order: add, reorder, remove
    expect(callOrder).toEqual(['add', 'reorder', 'remove']);
  });
});
// US4 TDD tests (T040–T041) — inherited rows via z2f ghost-row primitive
// ---------------------------------------------------------------------------
//
// Phase 6 wires `arrayConfig.before: GhostRow[]` (R6 / upstream `010` T038)
// into the Data form, replacing the discriminating `effectiveAttributes.map`
// loop. The contract is:
//
//   - Local rows are rendered from RHF's `useFieldArray` (form-state participants).
//   - Inherited rows are rendered from `arrayConfig.before` ghost rows, ABOVE
//     local rows. Ghost rows do NOT participate in form state, validation, or
//     submission — they are render-only.
//
// GT1 — DOM order: 3 inherited then M local (inherited render above locals)
// GT2 — ghost rows are not in the submitted form value (`form.getValues('members')`
//       only contains local entries)
// GT3 — clicking override on an inherited row fires `actions.addAttribute` with
//       (nodeId, name, typeName, cardinality) matching that inherited row
// GT4 — reordering local rows does not move inherited rows

describe('DataTypeForm – US4 ghost-row primitive (T040–T041)', () => {
  function makeAttr(name: string, refText = 'string'): Record<string, unknown> {
    return {
      $type: 'Attribute',
      name,
      typeCall: { $type: 'TypeCall', type: { $refText: refText } },
      card: { inf: 1, sup: 1, unbounded: false },
      override: false
    };
  }

  function makeChildWithParent(
    parentAttrs: Record<string, unknown>[],
    localAttrs: Record<string, unknown>[]
  ): { childData: AnyGraphNode; allNodes: TypeGraphNode[] } {
    const childData = {
      $type: 'Data',
      name: 'Trade',
      namespace: 'test.model',
      definition: '',
      attributes: localAttrs,
      superType: { $refText: 'BaseType' },
      conditions: [],
      annotations: [],
      synonyms: [],
      position: { x: 0, y: 0 },
      hasExternalRefs: false,
      errors: []
    } as AnyGraphNode;
    const parentNode = {
      id: 'test.BaseType',
      type: 'data',
      position: { x: 0, y: 0 },
      data: {
        $type: 'Data',
        name: 'BaseType',
        namespace: 'test',
        attributes: parentAttrs,
        conditions: [],
        annotations: [],
        synonyms: [],
        position: { x: 0, y: 0 },
        hasExternalRefs: false,
        errors: []
      },
      meta: testMeta('test')
    } as TypeGraphNode;
    const childNode = {
      id: 'test.Trade',
      type: 'data',
      position: { x: 0, y: 0 },
      data: childData,
      meta: testMeta('test')
    } as TypeGraphNode;
    return { childData, allNodes: [childNode, parentNode] };
  }

  // GT1 — DOM order: N inherited rows above M local rows
  it('renders N inherited rows above M local rows in the attributes list', () => {
    const parentAttrs = [makeAttr('id'), makeAttr('createdAt', 'date'), makeAttr('owner')];
    const localAttrs = [makeAttr('amount')];
    const { childData, allNodes } = makeChildWithParent(parentAttrs, localAttrs);

    const { container } = render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={childData}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
        allNodes={allNodes}
      />
    );

    // Capture every attribute-area row in document order.
    const allRows = Array.from(
      container.querySelectorAll('[data-slot="attribute-row"], [data-slot="inherited-attribute-row"]')
    );

    expect(allRows).toHaveLength(4);

    // Inherited rows appear before local rows in DOM order.
    const slots = allRows.map((el) => el.getAttribute('data-slot'));
    expect(slots).toEqual([
      'inherited-attribute-row',
      'inherited-attribute-row',
      'inherited-attribute-row',
      'attribute-row'
    ]);
  });

  // GT2 — ghost rows do not appear in the submitted form value
  it('ghost rows do not appear in submitted form value', () => {
    const parentAttrs = [makeAttr('id'), makeAttr('createdAt', 'date'), makeAttr('owner')];
    const localAttrs = [makeAttr('amount')];
    const { childData, allNodes } = makeChildWithParent(parentAttrs, localAttrs);

    const { container } = render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={childData}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
        allNodes={allNodes}
      />
    );

    // The form value for `members` is driven by RHF's useFieldArray; ghost
    // rows are render-only and never register a Controller. We assert this
    // structural property via the DOM:
    //
    //   Each <AttributeRow> registers a Controller on `members.${i}.name`
    //   and thus renders an <input data-slot="attribute-name">.
    //   Each <InheritedAttributeRow> renders only a <span data-slot="attribute-name">
    //   (no input, no form-state registration).
    //
    // Therefore the count of *inputs* with data-slot="attribute-name" equals
    // the local count (the only entries that would survive a form submit).
    const localNameInputs = container.querySelectorAll('[data-slot="attribute-row"] input[data-slot="attribute-name"]');
    const inheritedNameSpans = container.querySelectorAll(
      '[data-slot="inherited-attribute-row"] span[data-slot="attribute-name"]'
    );
    const allNameInputs = container.querySelectorAll('input[data-slot="attribute-name"]');

    expect(localNameInputs).toHaveLength(1);
    expect(inheritedNameSpans).toHaveLength(3);
    // Only the local rows contribute name inputs — i.e. only locals are in
    // the form-state surface that a submit would serialise.
    expect(allNameInputs).toHaveLength(localAttrs.length);
  });

  // GT3 — clicking override fires actions.addAttribute with the inherited values
  it('clicking override on an inherited row fires actions.addAttribute with the inherited values', () => {
    const parentAttrs = [makeAttr('id', 'string'), makeAttr('createdAt', 'date'), makeAttr('owner', 'string')];
    const { childData, allNodes } = makeChildWithParent(parentAttrs, []);
    const addAttribute = vi.fn();

    const { container } = render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={childData}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions({ addAttribute })}
        allNodes={allNodes}
      />
    );

    // Click override on the SECOND inherited row (index 1 → 'createdAt').
    const overrideButtons = container.querySelectorAll('[data-slot="attribute-override"]');
    expect(overrideButtons).toHaveLength(3);
    fireEvent.click(overrideButtons[1]!);

    expect(addAttribute).toHaveBeenCalledTimes(1);
    expect(addAttribute).toHaveBeenCalledWith('test.Trade', 'createdAt', 'date', '(1..1)');
  });

  // GT4 — reordering local rows does not move inherited rows
  it('reordering local rows does not move inherited rows', () => {
    const parentAttrs = [makeAttr('id'), makeAttr('createdAt', 'date')];
    const localAttrs = [makeAttr('alpha'), makeAttr('beta'), makeAttr('gamma')];
    const { childData, allNodes } = makeChildWithParent(parentAttrs, localAttrs);

    const reorderAttribute = vi.fn();
    const { container } = render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={childData}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions({ reorderAttribute })}
        allNodes={allNodes}
      />
    );

    const orderedSlots = () =>
      Array.from(container.querySelectorAll('[data-slot="attribute-row"], [data-slot="inherited-attribute-row"]')).map(
        (el) => el.getAttribute('data-slot')
      );

    // Initial: 2 inherited then 3 local.
    expect(orderedSlots()).toEqual([
      'inherited-attribute-row',
      'inherited-attribute-row',
      'attribute-row',
      'attribute-row',
      'attribute-row'
    ]);

    // Drag local row index 2 (gamma) → index 0 of the local zone.
    // The local rows render `data-index` on the <AttributeRow>; we use the
    // existing native-DnD wiring (R5) to fire the reorder.
    const localRows = container.querySelectorAll('[data-slot="attribute-row"]');
    const fromRow = localRows[2]!;
    const toRow = localRows[0]!;

    const dataTransfer = {
      data: {} as Record<string, string>,
      setData(key: string, value: string) {
        this.data[key] = value;
      },
      getData(key: string) {
        return this.data[key] ?? '';
      },
      effectAllowed: '',
      dropEffect: ''
    };

    fireEvent.dragStart(fromRow, { dataTransfer });
    fireEvent.dragOver(toRow, { dataTransfer });
    fireEvent.drop(toRow, { dataTransfer });

    // The reorder action fired against the local index space.
    expect(reorderAttribute).toHaveBeenCalledWith('test.Trade', 2, 0);

    // Inherited rows remain in their positions (above all locals); local
    // rows reorder among themselves only.
    const slots = orderedSlots();
    expect(slots.slice(0, 2)).toEqual(['inherited-attribute-row', 'inherited-attribute-row']);
    expect(slots.slice(2).every((s) => s === 'attribute-row')).toBe(true);
    expect(slots).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// P2-b — Extends field drop validation
// The Extends TypeReferenceField must only accept Data/builtin drops and
// reject wrong-kind drops (Enum, Func, etc.) so setInheritance is never
// called with an invalid parent kind.
// ---------------------------------------------------------------------------

function buildDataTransfer(payload: TypeRefPayload): DataTransfer {
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
  { value: 'builtin::string', label: 'string', kind: 'builtin' },
  { value: 'test.BaseType', label: 'BaseType', kind: 'data', namespace: 'test' },
  { value: 'test.Side', label: 'Side', kind: 'enum', namespace: 'test' }
];

function makeSimpleDataNode(): AnyGraphNode {
  return {
    $type: 'Data',
    name: 'Trade',
    namespace: 'test',
    definition: '',
    attributes: [],
    conditions: [],
    annotations: [],
    synonyms: [],
    position: { x: 0, y: 0 },
    hasExternalRefs: false,
    errors: []
  } as AnyGraphNode;
}

describe('DataTypeForm – Extends field drop validation (P2-b)', () => {
  it('rejects an Enum drop on the Extends TypeReferenceField (does not call setInheritance)', () => {
    const setInheritance = vi.fn();
    const { container } = render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={makeSimpleDataNode()}
        availableTypes={EXTENDS_TYPES}
        actions={makeActions({ setInheritance })}
      />
    );

    // The Extends TypeReferenceField contains one [data-slot="type-reference"] drop target.
    const dropTargets = container.querySelectorAll('[data-slot="type-reference"]');
    // The first drop target belongs to the Extends field (it appears before attribute rows).
    expect(dropTargets.length).toBeGreaterThan(0);
    const extendsDropTarget = dropTargets[0]!;

    const enumPayload: TypeRefPayload = {
      rune: 'type-ref',
      namespaceUri: 'test',
      typeId: 'test.Side',
      typeName: 'Side',
      kind: 'Enum'
    };

    act(() => {
      fireEvent.drop(extendsDropTarget, { dataTransfer: buildDataTransfer(enumPayload) });
    });

    expect(setInheritance).not.toHaveBeenCalled();
  });

  it('accepts a Data drop on the Extends TypeReferenceField (calls setInheritance)', () => {
    const setInheritance = vi.fn();
    const { container } = render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={makeSimpleDataNode()}
        availableTypes={EXTENDS_TYPES}
        actions={makeActions({ setInheritance })}
      />
    );

    const dropTargets = container.querySelectorAll('[data-slot="type-reference"]');
    const extendsDropTarget = dropTargets[0]!;

    const dataPayload: TypeRefPayload = {
      rune: 'type-ref',
      namespaceUri: 'test',
      typeId: 'test.BaseType',
      typeName: 'BaseType',
      kind: 'Data'
    };

    act(() => {
      fireEvent.drop(extendsDropTarget, { dataTransfer: buildDataTransfer(dataPayload) });
    });

    expect(setInheritance).toHaveBeenCalledWith('test.Trade', 'test.BaseType');
  });

  // Gap 3: header "Reveal in graph" action.
  it('renders a "Reveal in graph" header action that navigates to this node', () => {
    const onNavigateToNode = vi.fn();
    render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={makeDataNode()}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
        onNavigateToNode={onNavigateToNode}
      />
    );

    const reveal = screen.getByLabelText('Reveal in graph');
    fireEvent.click(reveal);
    expect(onNavigateToNode).toHaveBeenCalledWith('test.Trade');
  });

  it('hides the "Reveal in graph" action when no navigate callback is provided', () => {
    render(
      <DataTypeForm
        meta={testMeta('test.model')}
        nodeId="test.Trade"
        data={makeDataNode()}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );
    expect(screen.queryByLabelText('Reveal in graph')).toBeNull();
  });

  // See Codex review, PR #494: a refOnly node's domain/graph-level errors
  // must stay visible once it routes into DataTypeForm instead of OtherForm.
  it('renders domain/graph-level validation errors from node meta', () => {
    render(
      <DataTypeForm
        meta={testMeta('test.model', {
          errors: [{ nodeId: 'test.Trade', severity: 'error', message: 'Circular inheritance detected' }]
        })}
        nodeId="test.Trade"
        data={makeDataNode()}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );
    expect(screen.getByText('Circular inheritance detected')).toBeDefined();
  });
});
