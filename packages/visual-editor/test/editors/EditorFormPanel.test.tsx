// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Integration tests for EditorFormPanel (T048).
 *
 * Covers:
 * - Dispatch by kind (data -> DataTypeForm, readOnly -> OtherForm, null -> empty)
 * - Accessibility attributes (role, aria-label)
 * - Escape key closes panel
 * - Sticky header renders name + kind badge
 * - Inspector close remains keyboard-driven (Escape), no header close button
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { parse } from '@rune-langium/core';
import { EditorFormPanel } from '../../src/components/panels/EditorFormPanel.js';
import { astToModel } from '../../src/adapters/ast-to-model.js';
import type { AnyGraphNode, TypeOption, EditorFormActions } from '../../src/types.js';
import { testMeta } from '../helpers/node-meta.js';

const { typeAliasFormSpy } = vi.hoisted(() => ({
  typeAliasFormSpy: vi.fn()
}));

vi.mock('../../src/components/editors/TypeAliasForm.js', () => ({
  TypeAliasForm: (props: unknown) => {
    typeAliasFormSpy(props);
    return <div data-slot="mock-type-alias-form">TypeAliasForm</div>;
  }
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActions(): EditorFormActions {
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
    addEnumValue: vi.fn(),
    removeEnumValue: vi.fn(),
    updateEnumValue: vi.fn(),
    reorderEnumValue: vi.fn(),
    setEnumParent: vi.fn(),
    addChoiceOption: vi.fn(),
    removeChoiceOption: vi.fn(),
    addInputParam: vi.fn(),
    removeInputParam: vi.fn(),
    updateOutputType: vi.fn(),
    updateExpression: vi.fn(),
    validate: vi.fn().mockReturnValue([])
  };
}

const AVAILABLE_TYPES: TypeOption[] = [
  { value: 'builtin::string', label: 'string', kind: 'builtin' },
  { value: 'builtin::number', label: 'number', kind: 'builtin' }
];

function makeNodeData(overrides: Record<string, unknown> = {}): AnyGraphNode {
  return {
    $type: 'Data',
    name: 'Trade',
    namespace: 'test.model',
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

describe('EditorFormPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    typeAliasFormSpy.mockReset();
  });

  // ---- Empty state -------------------------------------------------------

  it('renders empty state when nodeData is null', () => {
    render(<EditorFormPanel nodeData={null} nodeId={null} availableTypes={AVAILABLE_TYPES} actions={makeActions()} />);

    expect(screen.getByText('Select a node to edit')).toBeDefined();
  });

  it('renders empty state when nodeId is null', () => {
    render(
      <EditorFormPanel
        nodeData={makeNodeData()}
        nodeId={null}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );

    expect(screen.getByText('Select a node to edit')).toBeDefined();
  });

  // ---- Accessibility -----------------------------------------------------

  it('has role="complementary" and aria-label', () => {
    render(
      <EditorFormPanel
        nodeData={makeNodeData()}
        nodeId="node-1"
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );

    const panel = screen.getByRole('complementary');
    expect(panel).toBeDefined();
    expect(panel.getAttribute('aria-label')).toBe('Edit Trade');
  });

  it('sets aria-label="Editor form" in empty state', () => {
    render(<EditorFormPanel nodeData={null} nodeId={null} availableTypes={AVAILABLE_TYPES} actions={makeActions()} />);

    const panel = screen.getByRole('complementary');
    expect(panel.getAttribute('aria-label')).toBe('Editor form');
  });

  // ---- Kind dispatch ------------------------------------------------------

  it('renders DataTypeForm for data kind', () => {
    render(
      <EditorFormPanel
        nodeData={makeNodeData({ $type: 'Data' })}
        nodeId="node-1"
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );

    // DataTypeForm renders a "Data" badge
    expect(screen.getAllByText('Data').length).toBeGreaterThanOrEqual(1);
    // Should show add-attribute button (icon-only post-migration; query
    // by aria-label).
    expect(screen.getByLabelText('Add attribute')).toBeDefined();
  });

  it('renders a parsed AST-backed node without recursing through runtime fields', async () => {
    const parsed = await parse(`
      namespace test.model

      type Trade:
        tradeDate date (1..1)
    `);
    const { nodes } = astToModel(parsed.value);
    const tradeNode = nodes.find((node) => node.data.name === 'Trade');

    expect(tradeNode).toBeDefined();

    render(
      <EditorFormPanel
        nodeData={tradeNode!.data}
        nodeId={tradeNode!.id}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );

    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(screen.getByLabelText('Add attribute')).toBeInTheDocument();
  });

  it('renders DataTypeForm (not OtherForm) for a read-only covered type (data)', () => {
    // A read-only Data node must now render DataTypeForm in read-only mode,
    // NOT OtherForm. Covered kinds always use their dedicated form.
    render(
      <EditorFormPanel
        nodeData={makeNodeData({ isReadOnly: true })}
        nodeId="node-1"
        isReadOnly={true}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );

    const panel = screen.getByRole('complementary');
    // Panel aria-label is "Edit <name>" (covered kind, not OtherForm's "Details for").
    expect(panel.getAttribute('aria-label')).toBe('Edit Trade');
    // DataTypeForm renders [data-slot="data-type-form"] inside the panel.
    const dataForm = panel.querySelector('[data-slot="data-type-form"]');
    expect(dataForm).not.toBeNull();
    // In read-only mode the name field is a static heading, not an input.
    expect(panel.querySelector('[data-slot="type-name-input"]')).toBeNull();
    expect(panel.querySelector('[data-slot="type-name"]')).not.toBeNull();
    // The "Add attribute" button must be absent in read-only mode.
    expect(panel.querySelector('[data-slot="add-attribute-btn"]')).toBeNull();
  });

  it('renders DataTypeForm in read-only mode when only the panel isReadOnly prop is set (node flag unset)', () => {
    // This is the discriminating case for the independent panel-level lock:
    // nodeData.isReadOnly is absent/false, but the panel isReadOnly prop is true.
    render(
      <EditorFormPanel
        nodeData={makeNodeData({ isReadOnly: false })}
        nodeId="node-1"
        isReadOnly={true}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );

    const panel = screen.getByRole('complementary');
    const dataForm = panel.querySelector('[data-slot="data-type-form"]');
    expect(dataForm).not.toBeNull();
    // Read-only mode: no add-attribute button, no editable name input.
    expect(panel.querySelector('[data-slot="add-attribute-btn"]')).toBeNull();
    expect(panel.querySelector('[data-slot="type-name-input"]')).toBeNull();
    expect(panel.querySelector('[data-slot="type-name"]')).not.toBeNull();
  });

  it('renders OtherForm for view-only kinds (e.g. Annotation)', () => {
    render(
      <EditorFormPanel
        nodeData={makeNodeData({ $type: 'Annotation' })}
        meta={testMeta('test.model')}
        nodeId="node-1"
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );

    // Falls through to OtherForm for annotation kind — shows namespace in type-header eyebrow
    const nsSpan = document.querySelector('[data-slot="type-header-namespace"]');
    expect(nsSpan).not.toBeNull();
    expect(nsSpan!.textContent).toBe('test.model');
  });

  it('forwards available types and navigation props to TypeAliasForm', () => {
    const onNavigateToNode = vi.fn();

    render(
      <EditorFormPanel
        nodeData={makeNodeData({
          $type: 'RosettaTypeAlias',
          name: 'AliasName',
          typeCall: { $type: 'TypeCall', type: { $refText: 'string' } }
        })}
        nodeId="alias-node"
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
        allNodes={
          [
            {
              id: 'alias-node',
              data: {
                $type: 'RosettaTypeAlias',
                name: 'AliasName',
                namespace: 'test.model'
              }
            },
            {
              id: 'other-node',
              data: {
                $type: 'Data',
                name: 'Trade',
                namespace: 'test.model'
              }
            }
          ] as never
        }
        onNavigateToNode={onNavigateToNode}
      />
    );

    expect(screen.getByText('TypeAliasForm')).toBeInTheDocument();
    expect(typeAliasFormSpy).toHaveBeenCalledOnce();

    const props = typeAliasFormSpy.mock.calls[0]?.[0] as {
      availableTypes?: TypeOption[];
      allNodeIds?: string[];
      onNavigateToNode?: (nodeId: string) => void;
    };

    expect(props.availableTypes).toEqual(AVAILABLE_TYPES);
    expect(props.allNodeIds).toEqual(['alias-node', 'other-node']);
    expect(props.onNavigateToNode).toBe(onNavigateToNode);
  });

  // ---- Sticky header ------------------------------------------------------

  it('renders sticky header with name and kind badge', () => {
    render(
      <EditorFormPanel
        nodeData={makeNodeData()}
        nodeId="node-1"
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );

    const header = document.querySelector('[data-slot="type-header"]');
    expect(header).toBeDefined();
    expect(screen.getByDisplayValue('Trade')).toBeInTheDocument();
    expect(header!.textContent).toContain('Data');
  });

  // ---- Close affordance ---------------------------------------------------

  it('does not render a header close button even when onClose is provided', () => {
    const onClose = vi.fn();

    render(
      <EditorFormPanel
        nodeData={makeNodeData()}
        nodeId="node-1"
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
        onClose={onClose}
      />
    );

    expect(screen.queryByLabelText('Close editor panel')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ---- Escape key ---------------------------------------------------------

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();

    render(
      <EditorFormPanel
        nodeData={makeNodeData()}
        nodeId="node-1"
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
        onClose={onClose}
      />
    );

    const panel = screen.getByRole('complementary');
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  // ---- refOnly routing -------------------------------------------------------

  it('renders DataTypeForm read-only (not OtherForm) for a refOnly covered type (data)', () => {
    // refOnly entries (curated reference-only, no source text) route through
    // their kind's own form — same tabs/sections as the editable case, with
    // every field disabled — rather than forking to the much more limited
    // OtherForm. OtherForm is reserved for kinds with no form at all.
    render(
      <EditorFormPanel
        nodeData={makeNodeData({ $type: 'Data' })}
        meta={testMeta('test.model')}
        nodeId="node-1"
        refOnly={true}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );

    const panel = screen.getByRole('complementary');
    // aria-label tracks which component renders (DataTypeForm here), not
    // readOnly-ness — matches the established "Edit X" convention for any
    // covered-kind render (see the isReadOnly-only test above).
    expect(panel.getAttribute('aria-label')).toBe('Edit Trade');
    const nsSpan = panel.querySelector('[data-slot="type-header-namespace"]');
    expect(nsSpan).not.toBeNull();
    expect(nsSpan!.textContent).toBe('test.model');
    // DataTypeForm (not OtherForm) renders for a refOnly covered kind.
    expect(panel.querySelector('[data-slot="data-type-form"]')).not.toBeNull();
    // The "Reference Only" pill still surfaces, now via DataTypeForm's own
    // TypeHeader trailing slot instead of OtherForm's.
    expect(screen.getByText('Reference Only')).toBeDefined();
    // Read-only: the name renders as static text, not an editable input, and
    // the "Add attribute" control is hidden.
    expect(panel.querySelector('[data-slot="type-name-input"]')).toBeNull();
    expect(panel.querySelector('[data-slot="add-attribute-btn"]')).toBeNull();
  });

  it('renders OtherForm with "Reference Only" pill for a refOnly uncovered kind (record)', () => {
    // record/basicType/annotation have no editor form implementation at all,
    // so refOnly still falls back to OtherForm for these kinds.
    render(
      <EditorFormPanel
        nodeData={makeNodeData({ $type: 'RosettaRecordType' })}
        meta={testMeta('test.model')}
        nodeId="node-1"
        refOnly={true}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );

    const panel = screen.getByRole('complementary');
    expect(panel.getAttribute('aria-label')).toBe('Details for Trade');
    expect(panel.querySelector('[data-slot="data-type-form"]')).toBeNull();
    expect(screen.getByText('Reference Only')).toBeDefined();
  });

  // ---- isHydrating loading state -------------------------------------------

  it('renders a loading state instead of a form when isHydrating is true', () => {
    // A deferred placeholder's data is a stub ({$type, name} only) while its
    // namespace's on-demand hydration round-trip is in flight — the panel
    // must show a loading state, not dispatch the stub into a form with no
    // fields (see docs/superpowers/specs/2026-05-25-curated-on-demand-hydration-design.md).
    render(
      <EditorFormPanel
        nodeData={{ $type: 'Data', name: 'Trade' } as unknown as AnyGraphNode}
        meta={testMeta('cdm.product', { deferred: true })}
        nodeId="node-1"
        isHydrating={true}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );

    expect(screen.getByText('Loading cdm.product…')).toBeDefined();
    // Neither the empty-state message nor a real form should render.
    expect(screen.queryByText('Select a node to edit')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Data' })).toBeNull();
  });

  it('does not render the loading state when isHydrating is false (default)', () => {
    render(
      <EditorFormPanel
        nodeData={makeNodeData({ $type: 'Data' })}
        meta={testMeta('test.model')}
        nodeId="node-1"
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );

    expect(screen.queryByLabelText('Loading namespace')).toBeNull();
    expect(screen.getAllByText('Data').length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to OtherForm for a still-deferred stub once isHydrating goes false (stuck/failed hydration)', () => {
    // If a namespace's on-demand hydration request fails,
    // `dequeuePendingHydration` removes it from the pending list WITHOUT
    // clearing `meta.deferred` or replacing the stub `data` — so
    // `isHydrating` flips back to false while `nodeData` is still just
    // `{$type, name}` (see ExplorePerspective.tsx's `selectedNodeIsHydrating`
    // and App.tsx's hydration-failure handler). Dispatching that stub into a
    // covered kind's rich form would render empty/misleading tabs and
    // sections. The panel must keep using the stub-tolerant OtherForm
    // instead (Codex review, PR #494).
    render(
      <EditorFormPanel
        nodeData={{ $type: 'Data', name: 'Trade' } as unknown as AnyGraphNode}
        meta={testMeta('cdm.product', { deferred: true })}
        nodeId="node-1"
        isHydrating={false}
        availableTypes={AVAILABLE_TYPES}
        actions={makeActions()}
      />
    );

    const panel = screen.getByRole('complementary');
    expect(panel.getAttribute('aria-label')).toBe('Details for Trade');
    expect(panel.querySelector('[data-slot="data-type-form"]')).toBeNull();
    expect(screen.queryByText(/Loading/)).toBeNull();
  });

  // ---- synonymSourceOptions threading -------------------------------------

  it('accepts synonymSourceOptions without error and renders the DataTypeForm', () => {
    // The prop is optional; supplying it must not crash the panel or the form.
    // Full rendering of the source picker UI is tested in Task 5 (MetadataSection).
    const synonymSourceOptions = [{ value: 'ns.FpML', label: 'FpML', namespace: 'ns' }];
    render(
      <EditorFormPanel
        nodeData={makeNodeData({ $type: 'Data' })}
        nodeId="node-1"
        availableTypes={AVAILABLE_TYPES}
        synonymSourceOptions={synonymSourceOptions}
        actions={makeActions()}
      />
    );

    const panel = screen.getByRole('complementary');
    expect(panel.querySelector('[data-slot="data-type-form"]')).not.toBeNull();
  });
});

it('renders host declaration actions in the shared read-only title, outside disabled member controls', () => {
  const invoke = vi.fn();
  const { container } = render(
    <EditorFormPanel
      nodeData={makeNodeData()}
      meta={testMeta('test.ns')}
      nodeId="test.ns.Sample#Data"
      refOnly
      availableTypes={[]}
      actions={makeActions()}
      headerActions={
        <button type="button" onClick={invoke}>
          Modify local copy
        </button>
      }
    />
  );
  const action = screen.getByRole('button', { name: 'Modify local copy' });
  expect(container.querySelector('[data-slot="type-header"]')).toContainElement(action);
  fireEvent.click(action);
  expect(invoke).toHaveBeenCalledOnce();
});
