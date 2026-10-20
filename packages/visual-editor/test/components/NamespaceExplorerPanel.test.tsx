// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Tests for NamespaceExplorerPanel component.
 *
 * Verifies tree rendering, expand/collapse, search filtering,
 * visibility toggles, node selection callbacks, and drag-source palette
 * behaviour.
 *
 * Type names and arrows navigate independently of native row dragging.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamespaceExplorerPanel } from '../../src/components/panels/NamespaceExplorerPanel.js';
import type { TypeGraphNode, AnyGraphNode } from '../../src/types.js';
import { TYPE_REF_PAYLOAD_MIME, isTypeRefPayload, typeRefMimeForKind } from '../../src/types/structure-view.js';
import { testMeta } from '../helpers/node-meta.js';
import { selectNodeRepository } from '../../src/store/node-repository.js';

const virtualTreeTestState = vi.hoisted(() => ({ visibleIndices: undefined as number[] | undefined }));

// Mock @tanstack/react-virtual so tests can select a small viewport without a
// real scroll container.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: (i: number) => number }) => {
    let offset = 0;
    const items = Array.from({ length: count }, (_, i) => {
      const size = estimateSize(i);
      const item = { index: i, key: String(i), start: offset, size, end: offset + size };
      offset += size;
      return item;
    });
    return {
      getVirtualItems: () =>
        virtualTreeTestState.visibleIndices === undefined
          ? items
          : items.filter((item) => virtualTreeTestState.visibleIndices!.includes(item.index)),
      getTotalSize: () => offset
    };
  }
}));

afterEach(() => {
  virtualTreeTestState.visibleIndices = undefined;
});

function makeNode(ns: string, name: string, astType: string = 'Data'): TypeGraphNode {
  const nodeTypeMap: Record<string, string> = {
    Data: 'data',
    Choice: 'choice',
    RosettaEnumeration: 'enum',
    RosettaFunction: 'func'
  };
  return {
    id: `${ns}.${name}`,
    type: nodeTypeMap[astType] ?? 'data',
    position: { x: 0, y: 0 },
    data: {
      $type: astType,
      name,
      namespace: ns,
      attributes: [],
      conditions: [],
      annotations: [],
      synonyms: [],
      position: { x: 0, y: 0 },
      hasExternalRefs: false,
      errors: []
    } as AnyGraphNode,
    meta: testMeta(ns)
  };
}

const defaultNodes = [
  makeNode('com.model', 'Trade'),
  makeNode('com.model', 'Event'),
  makeNode('com.lib', 'Date'),
  makeNode('cdm.product', 'Asset', 'Choice'),
  makeNode('cdm.trade', 'Trade')
];

/** Build a NodeRepository from an arbitrary set of TypeGraphNodes. */
function repoFrom(nodes: TypeGraphNode[]) {
  return selectNodeRepository(new Map(nodes.map((n) => [n.id, n])));
}

const defaultRepo = repoFrom(defaultNodes);

function renderPanel(overrides: Partial<React.ComponentProps<typeof NamespaceExplorerPanel>> = {}) {
  const allNamespaces = new Set(defaultNodes.map((n) => n.meta.namespace));
  const props = {
    nodeRepository: defaultRepo,
    expandedNamespaces: allNamespaces,
    hiddenNodeIds: new Set<string>(),
    onToggleNamespace: vi.fn(),
    onExpandAll: vi.fn(),
    onCollapseAll: vi.fn(),
    onSelectNode: vi.fn(),
    ...overrides
  };
  return { ...render(<NamespaceExplorerPanel {...props} />), props };
}

describe('NamespaceExplorerPanel', () => {
  it('uses a host heading without losing counts or search controls', () => {
    renderPanel({ showHeading: false });
    expect(screen.queryByText('Type explorer')).not.toBeInTheDocument();
    expect(screen.getByTestId('namespace-explorer-count')).toHaveTextContent(`${defaultNodes.length} available`);
    const description = screen.getByText('Click name or arrow to open. Drag a row to a type field.');
    expect(
      description.compareDocumentPosition(screen.getByTestId('namespace-explorer-count')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Filter types or namespaces' })).toBeInTheDocument();
  });

  it('opens parent namespace rows without opening multiple child branches', () => {
    renderPanel();
    const toggle = within(screen.getByTestId('ns-seg-com')).getByRole('button', { name: 'com', exact: true });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.getByTestId('ns-seg-com.model')).toBeInTheDocument();
    expect(screen.getByTestId('ns-seg-com.lib')).toBeInTheDocument();
    expect(screen.queryByTestId('ns-type-com.model.Trade')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ns-type-com.lib.Date')).not.toBeInTheDocument();
    fireEvent.click(
      within(screen.getByTestId('ns-seg-com.model')).getByRole('button', { name: 'com.model', exact: true })
    );
    expect(screen.getByTestId('ns-type-com.model.Trade')).toBeInTheDocument();
    expect(screen.queryByTestId('ns-type-com.lib.Date')).not.toBeInTheDocument();
  });

  it('automatically opens a sole child namespace but stops when that child branches', () => {
    renderPanel({
      nodeRepository: repoFrom([
        makeNode('root', 'Root'),
        makeNode('root.child', 'Child'),
        makeNode('root.child.left', 'Left'),
        makeNode('root.child.right', 'Right')
      ])
    });
    const toggle = within(screen.getByTestId('ns-seg-root')).getByRole('button', { name: 'root', exact: true });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.getByTestId('ns-type-root.child.Child')).toBeInTheDocument();
    expect(screen.getByTestId('ns-seg-root.child.left')).toBeInTheDocument();
    expect(screen.queryByTestId('ns-type-root.child.left.Left')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ns-type-root.child.right.Right')).not.toBeInTheDocument();
  });
  it('compacts deep namespace chains while preserving expansion, navigation and drag identities', () => {
    const nodes = [makeNode('com.rosetta.model', 'Trade'), makeNode('com.rosetta.model', 'Event')];
    const { props } = renderPanel({ nodeRepository: repoFrom(nodes) });
    const namespace = screen.getByTestId('ns-seg-com.rosetta.model');
    expect(screen.queryByTestId('ns-seg-com')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ns-seg-com.rosetta')).not.toBeInTheDocument();
    const toggle = within(namespace).getByRole('button', { name: 'com.rosetta.model', exact: true });
    expect(toggle).toHaveAttribute('title', 'com.rosetta.model');
    expect(toggle.querySelector('span')).toHaveAttribute('dir', 'ltr');
    expect(toggle).toHaveTextContent('com.rosetta.model');
    // Compression does not open previously collapsed deep namespaces.
    expect(screen.queryByTestId('ns-type-com.rosetta.model.Trade')).not.toBeInTheDocument();
    fireEvent.click(toggle);

    fireEvent.click(screen.getByTestId('ns-type-link-com.rosetta.model.Trade'));
    expect(props.onSelectNode).toHaveBeenCalledWith('com.rosetta.model.Trade');
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByTestId('ns-type-com.rosetta.model.Trade'), {
      dataTransfer: { setData, effectAllowed: '' }
    });
    expect(JSON.parse(setData.mock.calls.find(([mime]) => mime === TYPE_REF_PAYLOAD_MIME)![1])).toMatchObject({
      typeId: 'com.rosetta.model.Trade',
      kind: 'Data'
    });

    fireEvent.click(toggle);
    expect(screen.queryByTestId('ns-type-com.rosetta.model.Trade')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByTestId('ns-type-com.rosetta.model.Trade')).toBeInTheDocument();
  });

  it('keeps compacted branch selection whole when search hides a sibling namespace', () => {
    const nodes = [makeNode('org.finance.trade', 'Trade'), makeNode('org.finance.party', 'Party')];
    const onChange = vi.fn();
    renderPanel({
      nodeRepository: repoFrom(nodes),
      selection: { explicit: new Set(), requiredBy: new Map(), onChange }
    });
    expect(screen.getByTestId('ns-seg-org.finance.trade')).toBeInTheDocument();
    expect(screen.getByTestId('ns-seg-org.finance.party')).toBeInTheDocument();
    expect(screen.queryByTestId('ns-seg-org')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('namespace-search'), { target: { value: 'Trade' } });
    expect(screen.queryByTestId('ns-seg-org.finance.party')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ns-seg-checkbox-org.finance'));
    expect(onChange).toHaveBeenCalledWith(new Set(['org.finance.trade.Trade', 'org.finance.party.Party']), {
      kind: 'namespace',
      namespaces: ['org.finance.trade', 'org.finance.party'],
      checked: true
    });
  });
  it('focuses a namespace, preserves ancestor navigation and highlights the selected declaration', async () => {
    const user = userEvent.setup();
    renderPanel({ selectedNodeId: 'com.model.Trade' });
    await user.click(screen.getByRole('button', { name: 'Focus namespace com.model', exact: true }));
    expect(screen.queryByTestId('ns-seg-cdm')).not.toBeInTheDocument();
    expect(screen.getByTestId('ns-type-com.model.Trade')).toHaveAttribute('aria-current', 'true');
    const breadcrumb = screen.getByRole('navigation', { name: 'Namespace location' });
    expect(within(breadcrumb).getByRole('button', { name: 'com.model', exact: true })).toHaveAttribute(
      'aria-current',
      'location'
    );
    await user.click(within(breadcrumb).getByRole('button', { name: 'com', exact: true }));
    expect(screen.getByTestId('ns-seg-com.lib')).toBeInTheDocument();
    await user.click(within(breadcrumb).getByRole('button', { name: 'All', exact: true }));
    expect(screen.getByTestId('ns-seg-cdm')).toBeInTheDocument();
  });

  it('disambiguates same-name search results and keeps their navigation and drag IDs distinct', () => {
    const { props } = renderPanel();
    fireEvent.change(screen.getByTestId('namespace-search'), { target: { value: 'Trade' } });
    expect(screen.getByRole('button', { name: 'Trade model', exact: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trade trade', exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Trade model', exact: true }));
    expect(props.onSelectNode).toHaveBeenLastCalledWith('com.model.Trade');
    fireEvent.click(screen.getByRole('button', { name: 'Trade trade', exact: true }));
    expect(props.onSelectNode).toHaveBeenLastCalledWith('cdm.trade.Trade');
    expect(screen.getByTestId('ns-type-link-com.model.Trade')).toHaveAttribute(
      'title',
      expect.stringContaining('com.model.Trade')
    );
  });

  it('shows empty state when no nodes', () => {
    renderPanel({ nodeRepository: repoFrom([]) });
    expect(screen.getByText('No types loaded')).toBeTruthy();
  });

  it('keeps the count in a quiet footer and omits global visibility shortcuts', () => {
    renderPanel();
    expect(screen.getByRole('contentinfo', { name: 'Available types' })).toContainElement(
      screen.getByTestId('namespace-explorer-count')
    );
    expect(screen.queryByTestId('expand-all')).not.toBeInTheDocument();
    expect(screen.queryByTestId('collapse-all')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Name/arrow navigation leaves row dragging and inclusion independent.
  it('single-click on the row body is a no-op (drag-source-mark removed)', () => {
    const onSetDragSource = vi.fn();
    const { props } = renderPanel({ onSetDragSource });
    const typeRow = screen.getByTestId('ns-type-com.model.Trade');

    fireEvent.click(typeRow);

    expect(onSetDragSource).not.toHaveBeenCalled();
    expect(props.onSelectNode).not.toHaveBeenCalled();
  });

  it('click on nav button calls onSelectNode', () => {
    const { props } = renderPanel();
    const navBtn = screen.getByTestId('ns-type-nav-com.model.Trade');

    fireEvent.click(navBtn);

    expect(props.onSelectNode).toHaveBeenCalledOnce();
  });

  it('navigates from the type name when inclusion mode is absent', async () => {
    const { props } = renderPanel();
    const link = screen.getByTestId('ns-type-link-com.model.Trade');
    await userEvent.click(link);
    expect(props.onSelectNode).toHaveBeenCalledExactlyOnceWith('com.model.Trade');
    link.focus();
    await userEvent.keyboard('{Enter}');
    expect(props.onSelectNode).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('ns-type-com.model.Trade')).toHaveAttribute('draggable', 'true');
  });

  it('positions virtual rows via top, not transform (WebKit drag fix #302)', () => {
    // Regression guard: WebKit/Safari refuses to initiate native HTML5 drag on
    // a `draggable` element whose ancestor has a CSS transform. The virtual-row
    // wrapper must therefore position with `top`, NOT `transform: translateY()`
    // (the @tanstack/react-virtual default), or every draggable type row goes
    // dead in Safari while still working in Chrome. JSDOM can't exercise the
    // real drag, so we assert the structural invariant instead.
    renderPanel();
    const typeRow = screen.getByTestId('ns-type-com.model.Trade');
    const wrapper = typeRow.parentElement!;
    expect(wrapper.style.transform).toBe('');
    expect(wrapper.style.top).toMatch(/px$/);
  });

  it('nav click triggers the just-navigated CSS pulse on the row', () => {
    // Navigation feedback: clicking the arrow flashes the row briefly so
    // the user knows their click registered before focus moves to the
    // navigated target. The pulse is a CSS animation keyed by the
    // `studio-type-row--just-navigated` class, toggled by a useState +
    // 500ms setTimeout in TypeItemRow.
    const { props } = renderPanel();
    const navBtn = screen.getByTestId('ns-type-nav-com.model.Trade');
    const typeRow = screen.getByTestId('ns-type-com.model.Trade');

    fireEvent.click(navBtn);

    expect(props.onSelectNode).toHaveBeenCalledOnce();
    expect(typeRow.className).toContain('studio-type-row--just-navigated');
  });

  it('keyboard activate nav button (Enter) calls onSelectNode', async () => {
    const { props } = renderPanel();
    const navBtn = screen.getByTestId('ns-type-nav-com.model.Trade');

    // Tab to focus the nav button and press Enter
    navBtn.focus();
    fireEvent.keyDown(navBtn, { key: 'Enter' });
    // Native <button> dispatches click on Enter — simulate that
    fireEvent.click(navBtn);

    expect(props.onSelectNode).toHaveBeenCalledOnce();
  });

  it('Enter on nav button does NOT bubble to row keydown (no double-fire)', () => {
    // Codex P2 regression: previously the nav button's keydown bubbled to
    // the row's onKeyDown handler, AND the native button click activation
    // also fired — one keystroke triggered onSelectNode twice (once via
    // bubble, once via click). handleNavKeyDown's stopPropagation prevents
    // that, so the count stays exactly 1.
    const { props } = renderPanel();
    const navBtn = screen.getByTestId('ns-type-nav-com.model.Trade');

    navBtn.focus();
    fireEvent.keyDown(navBtn, { key: 'Enter' });
    fireEvent.click(navBtn); // native button click on Enter

    expect(props.onSelectNode).toHaveBeenCalledOnce();
  });

  it('Space on nav button does NOT bubble to row keydown', () => {
    const { props } = renderPanel();
    const navBtn = screen.getByTestId('ns-type-nav-com.model.Trade');

    navBtn.focus();
    fireEvent.keyDown(navBtn, { key: ' ' });
    fireEvent.click(navBtn);

    // One activation = one onSelectNode call (no double-fire from keydown
    // bubbling to the row's onKeyDown AND the button's native click).
    expect(props.onSelectNode).toHaveBeenCalledOnce();
  });

  it('filters types when search query entered', () => {
    renderPanel();
    const searchInput = screen.getByTestId('namespace-search');
    expect(searchInput).toHaveAttribute('placeholder', 'Filter types or namespaces...');
    fireEvent.change(searchInput, { target: { value: 'Trade' } });

    // Both Trade rows (com.model.Trade and cdm.trade.Trade) should be visible
    expect(screen.getAllByText('Trade').length).toBeGreaterThanOrEqual(1);
    // Asset should not be visible (name doesn't match 'Trade')
    expect(screen.queryByText('Asset')).toBeNull();
  });

  it('shows "No matching types or namespaces" when search has no results', () => {
    renderPanel();
    const searchInput = screen.getByTestId('namespace-search');
    fireEvent.change(searchInput, { target: { value: 'zzzznonexistent' } });
    expect(screen.getByText('No matching types or namespaces')).toBeTruthy();
  });

  it('keeps navigation separate from controlled selection', () => {
    const onChange = vi.fn();
    const { props } = renderPanel({
      selection: { explicit: new Set(), requiredBy: new Map(), onChange }
    });

    fireEvent.click(screen.getByTestId('ns-type-checkbox-com.model.Trade'));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenLastCalledWith(new Set(['com.model.Trade']));

    fireEvent.click(screen.getByTestId('ns-type-nav-com.model.Trade'));
    expect(props.onSelectNode).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('toggles controlled inclusion from the row and name without navigation highlighting', () => {
    const onChange = vi.fn();
    const { props, rerender } = renderPanel({
      selectedNodeId: 'com.model.Trade',
      selection: { explicit: new Set(), requiredBy: new Map(), onChange }
    });
    const row = screen.getByTestId('ns-type-com.model.Trade');
    fireEvent.click(row);
    expect(onChange).toHaveBeenLastCalledWith(new Set(['com.model.Trade']));
    expect(row).not.toHaveClass('studio-type-row--selected');
    rerender(
      <NamespaceExplorerPanel
        {...props}
        selection={{ explicit: new Set(['com.model.Trade']), requiredBy: new Map(), onChange }}
      />
    );
    fireEvent.click(screen.getByTestId('ns-type-link-com.model.Trade'));
    expect(onChange).toHaveBeenLastCalledWith(new Set());
    expect(props.onSelectNode).not.toHaveBeenCalled();
    expect(row).not.toHaveClass('studio-type-row--just-navigated');
    fireEvent.click(screen.getByTestId('ns-type-nav-com.model.Trade'));
    expect(props.onSelectNode).toHaveBeenCalledOnce();
    expect(row).not.toHaveClass('studio-type-row--just-navigated');
  });

  it('keeps required items selected while allowing their explicit selection to be removed', () => {
    const onChange = vi.fn();
    renderPanel({
      selection: {
        explicit: new Set(['canonical:Trade']),
        requiredBy: new Map([['canonical:Trade', ['canonical:Root']]]),
        getSelectionId: (node) => `canonical:${node.data.name}`,
        onChange
      }
    });

    const checkbox = screen.getByTestId('ns-type-checkbox-com.model.Trade');
    expect(checkbox).toHaveAttribute('aria-label', 'Trade, required by canonical:Root');
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);

    expect(onChange).toHaveBeenCalledWith(new Set());
    expect(checkbox).toBeChecked();
  });

  it('does not allow a required-only item to be removed', () => {
    const onChange = vi.fn();
    renderPanel({
      selection: {
        explicit: new Set(),
        requiredBy: new Map([['com.model.Trade', ['com.model.Event']]]),
        onChange
      }
    });

    expect(screen.getByTestId('ns-type-checkbox-com.model.Trade')).toBeDisabled();
    expect(screen.getByLabelText('Required by com.model.Event')).toBeTruthy();
    fireEvent.click(screen.getByTestId('ns-type-com.model.Trade'));
    fireEvent.click(screen.getByTestId('ns-type-link-com.model.Trade'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('selects the complete filtered result set while preserving hidden selections', () => {
    const onChange = vi.fn();
    renderPanel({
      selection: { explicit: new Set(['com.lib.Date']), requiredBy: new Map(), onChange }
    });

    fireEvent.change(screen.getByTestId('namespace-search'), { target: { value: 'Trade' } });
    fireEvent.click(screen.getByTestId('select-visible-results'));

    expect(onChange).toHaveBeenLastCalledWith(new Set(['com.lib.Date', 'cdm.trade.Trade', 'com.model.Trade']));
  });

  it('uses all namespace descendants for indeterminate selection state', () => {
    renderPanel({
      selection: { explicit: new Set(['com.model.Trade']), requiredBy: new Map(), onChange: vi.fn() }
    });

    expect(screen.getByTestId('ns-seg-checkbox-com.model')).toHaveAttribute('data-indeterminate');
  });

  it('includes collapsed descendants when selecting a namespace', () => {
    const onChange = vi.fn();
    const nestedNodes = [makeNode('org.a.deep', 'First'), makeNode('org.b.deep', 'Second')];
    renderPanel({
      nodeRepository: repoFrom(nestedNodes),
      expandedNamespaces: new Set(['org.a.deep', 'org.b.deep']),
      selection: { explicit: new Set(), requiredBy: new Map(), onChange }
    });

    fireEvent.click(within(screen.getByTestId('ns-seg-org')).getByRole('button', { name: 'org', exact: true }));
    expect(screen.queryByTestId('ns-type-org.a.deep.First')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('ns-seg-checkbox-org'));

    expect(onChange).toHaveBeenCalledWith(new Set(['org.a.deep.First', 'org.b.deep.Second']), {
      kind: 'namespace',
      namespaces: ['org.a.deep', 'org.b.deep'],
      checked: true
    });
  });

  it('keeps namespace operations whole while bulk selection follows the filter', () => {
    const onChange = vi.fn();
    renderPanel({ selection: { explicit: new Set(), requiredBy: new Map(), onChange } });

    fireEvent.change(screen.getByTestId('namespace-search'), { target: { value: 'Trade' } });
    fireEvent.click(screen.getByTestId('ns-seg-checkbox-com'));

    expect(onChange).toHaveBeenCalledWith(new Set(['com.lib.Date', 'com.model.Event', 'com.model.Trade']), {
      kind: 'namespace',
      namespaces: ['com.model', 'com.lib'],
      checked: true
    });
  });

  it('supports Space activation on a selection checkbox', async () => {
    const onChange = vi.fn();
    renderPanel({ selection: { explicit: new Set(), requiredBy: new Map(), onChange } });
    const checkbox = screen.getByTestId('ns-type-checkbox-com.model.Trade');
    const user = userEvent.setup();

    checkbox.focus();
    await user.keyboard(' ');

    expect(onChange).toHaveBeenCalledOnce();
  });

  it('includes a selected row that is outside the mounted virtual viewport', () => {
    virtualTreeTestState.visibleIndices = [0];
    const nodes = Array.from({ length: 30 }, (_, index) => makeNode('large', `Type${String(index).padStart(2, '0')}`));
    const offscreenId = 'large.Type29';
    const onChange = vi.fn();
    renderPanel({
      nodeRepository: repoFrom(nodes),
      selection: { explicit: new Set([offscreenId]), requiredBy: new Map(), onChange }
    });

    expect(screen.queryByTestId(`ns-type-${offscreenId}`)).toBeNull();
    expect(screen.getByTestId('ns-seg-checkbox-large')).toHaveAttribute('data-indeterminate');
    fireEvent.click(screen.getByTestId('ns-seg-checkbox-large'));

    expect(onChange).toHaveBeenCalledWith(new Set(nodes.map((node) => node.id)), {
      kind: 'namespace',
      namespaces: ['large'],
      checked: true
    });
  });

  it('highlights selected node', () => {
    renderPanel({ selectedNodeId: 'com.model.Trade' });
    const typeRow = screen.getByTestId('ns-type-com.model.Trade');
    expect(typeRow.className).toContain('bg-accent');
  });

  it('labels the available catalog count independently of graph visibility', () => {
    // Only com.model is expanded, others hidden
    const expanded = new Set(['com.model']);
    renderPanel({ expandedNamespaces: expanded });
    expect(screen.getByText('5 available')).toBeTruthy();
  });

  it('keeps hidden graph nodes in the available catalog count', () => {
    const allNamespaces = new Set(defaultNodes.map((n) => n.meta.namespace));
    const hidden = new Set(['com.model.Trade']);
    renderPanel({ expandedNamespaces: allNamespaces, hiddenNodeIds: hidden });
    expect(screen.getByText('5 available')).toBeTruthy();
  });

  it('kind filter pill shows byType count badge (data pill shows 4 for defaultNodes)', () => {
    // defaultNodes has 4 Data nodes (Trade×2, Event, Date) and 1 Choice node.
    // The pill badge reflects nodeRepository.byType('Data').length directly.
    renderPanel();
    const dataPill = screen.getByTestId('kind-filter-data');
    expect(dataPill.textContent).toContain('4');
  });

  // -------------------------------------------------------------------------
  // Phase 8 — drag-source palette behaviour
  // -------------------------------------------------------------------------

  it('dragstart registers canonical MIME with JSON payload and kind-specific marker MIME', () => {
    renderPanel();
    const tradeRow = screen.getByTestId('ns-type-com.model.Trade');

    // Simulate dataTransfer to capture setData calls
    const setData = vi.fn();
    const dataTransfer = { setData, effectAllowed: '' as DataTransfer['effectAllowed'] };

    fireEvent.dragStart(tradeRow, { dataTransfer });

    // Canonical MIME must be registered with a JSON payload that passes isTypeRefPayload
    const canonicalCall = setData.mock.calls.find((c: string[]) => c[0] === TYPE_REF_PAYLOAD_MIME);
    expect(canonicalCall).toBeTruthy();
    const parsed = JSON.parse(canonicalCall![1] as string);
    expect(isTypeRefPayload(parsed)).toBe(true);
    expect(parsed.typeId).toBe('com.model.Trade');
    expect(parsed.kind).toBe('Data');

    // Kind-specific marker MIME must also be registered
    const kindMime = typeRefMimeForKind('Data');
    const markerCall = setData.mock.calls.find((c: string[]) => c[0] === kindMime);
    expect(markerCall).toBeTruthy();

    // effectAllowed must be 'link' per the dual-MIME contract
    expect(dataTransfer.effectAllowed).toBe('link');
  });

  // -------------------------------------------------------------------------
  // a11y — row body is NOT a button (PR #210 P2 review)
  //
  // The row body advertises no button semantics — no `role`, no `tabIndex`,
  // no Enter/Space activation. The nav-arrow `<button>` embedded in the row
  // is the sole interactive control; it is independently keyboard-focusable
  // (tabIndex=0, descriptive aria-label) and handles the navigate action.
  // Keeping keyboard activation on the row while removing mouse activation
  // would have given AT users a phantom action sighted users can't trigger.
  // -------------------------------------------------------------------------

  it('row body has no button role and is not in the tab order', () => {
    renderPanel();
    const typeRow = screen.getByTestId('ns-type-com.model.Trade');
    expect(typeRow.getAttribute('role')).toBeNull();
    expect(typeRow.getAttribute('tabindex')).toBeNull();
  });

  it('Enter key on row body does NOT fire onSelectNode (no button semantics)', () => {
    const { props } = renderPanel();
    const typeRow = screen.getByTestId('ns-type-com.model.Trade');
    fireEvent.keyDown(typeRow, { key: 'Enter' });
    expect(props.onSelectNode).not.toHaveBeenCalled();
  });

  it('Space key on row body does NOT fire onSelectNode (no button semantics)', () => {
    const { props } = renderPanel();
    const typeRow = screen.getByTestId('ns-type-com.model.Trade');
    fireEvent.keyDown(typeRow, { key: ' ' });
    expect(props.onSelectNode).not.toHaveBeenCalled();
  });

  it('nav button has independent tabIndex=0 (keyboard-focusable)', () => {
    renderPanel();
    const navBtn = screen.getByTestId('ns-type-nav-com.model.Trade');
    expect(navBtn.getAttribute('tabindex')).toBe('0');
  });

  it('nav button has descriptive aria-label', () => {
    renderPanel();
    const navBtn = screen.getByTestId('ns-type-nav-com.model.Trade');
    expect(navBtn.getAttribute('aria-label')).toBe('Navigate to Trade');
  });

  it('non-activation keys on row body (e.g. ArrowDown) do not fire any callback', () => {
    const onSetDragSource = vi.fn();
    const { props } = renderPanel({ onSetDragSource });
    const typeRow = screen.getByTestId('ns-type-com.model.Trade');
    fireEvent.keyDown(typeRow, { key: 'ArrowDown' });
    expect(props.onSelectNode).not.toHaveBeenCalled();
    expect(onSetDragSource).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // All kinds are draggable; validity is gated by each drop target's `accept`.
  // Func/Annotation are draggable but accepted by NO target — they show the
  // no-drop cursor instead of falling back to a WebKit text/region selection.
  // -------------------------------------------------------------------------

  it('Function-kind row is draggable (rejected at drop, never text-selects)', () => {
    const funcNode = makeNode('cdm.func', 'MyFunc', 'RosettaFunction');
    render(
      <NamespaceExplorerPanel
        nodeRepository={repoFrom([funcNode])}
        expandedNamespaces={new Set(['cdm.func'])}
        hiddenNodeIds={new Set()}
        onToggleNamespace={vi.fn()}
        onExpandAll={vi.fn()}
        onCollapseAll={vi.fn()}
        onSelectNode={vi.fn()}
      />
    );
    const funcRow = screen.getByTestId('ns-type-cdm.func.MyFunc');
    expect((funcRow as HTMLElement).draggable).toBe(true);
  });

  it('dragstart on a Function row registers a Func type-ref payload', () => {
    const funcNode = makeNode('cdm.func', 'MyFunc', 'RosettaFunction');
    render(
      <NamespaceExplorerPanel
        nodeRepository={repoFrom([funcNode])}
        expandedNamespaces={new Set(['cdm.func'])}
        hiddenNodeIds={new Set()}
        onToggleNamespace={vi.fn()}
        onExpandAll={vi.fn()}
        onCollapseAll={vi.fn()}
        onSelectNode={vi.fn()}
      />
    );
    const funcRow = screen.getByTestId('ns-type-cdm.func.MyFunc');
    const setData = vi.fn();
    const dataTransfer = { setData, effectAllowed: '' as DataTransfer['effectAllowed'] };
    fireEvent.dragStart(funcRow, { dataTransfer });
    // Every kind is draggable, so the row carries a payload (no text-select fallback).
    const canonical = setData.mock.calls.find((c: string[]) => c[0] === TYPE_REF_PAYLOAD_MIME);
    expect(canonical).toBeDefined();
    expect(JSON.parse(canonical![1]).kind).toBe('Func');
    // Kind-marker MIME present so drop targets reject Func during dragover.
    expect(setData.mock.calls.some((c: string[]) => c[0] === typeRefMimeForKind('Func'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Kind filters remain available without a breakdown beneath each namespace.
// ---------------------------------------------------------------------------

describe('NamespaceExplorerPanel — kind filter pills', () => {
  const mixedNodes = [
    makeNode('pkg', 'D1', 'Data'),
    makeNode('pkg', 'D2', 'Data'),
    makeNode('pkg', 'C1', 'Choice'),
    makeNode('pkg', 'E1', 'RosettaEnumeration'),
    makeNode('pkg', 'F1', 'RosettaFunction')
  ];

  function renderMixed() {
    return render(
      <NamespaceExplorerPanel
        nodeRepository={repoFrom(mixedNodes)}
        expandedNamespaces={new Set(['pkg'])}
        hiddenNodeIds={new Set()}
        onToggleNamespace={vi.fn()}
        onExpandAll={vi.fn()}
        onCollapseAll={vi.fn()}
        onSelectNode={vi.fn()}
      />
    );
  }

  it('renders all four kind filter pills, pressed by default', () => {
    renderMixed();
    for (const kind of ['data', 'choice', 'enum', 'func']) {
      const pill = screen.getByTestId(`kind-filter-${kind}`);
      expect(pill.getAttribute('aria-pressed')).toBe('true');
    }
  });

  it('omits namespace breakdowns and their reserved virtual-row height', () => {
    renderMixed();
    expect(screen.queryByTestId('ns-seg-pkg-kinds')).not.toBeInTheDocument();
    expect(screen.getByTestId('ns-seg-pkg').parentElement).toHaveStyle({ height: '32px' });
    expect(screen.getByTestId('kind-filter-data')).toHaveTextContent('2');
  });

  it('hides types of a kind when its pill is toggled off', () => {
    renderMixed();
    // All five types visible initially.
    expect(screen.getByTestId('ns-type-pkg.C1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('kind-filter-choice'));
    expect(screen.getByTestId('kind-filter-choice').getAttribute('aria-pressed')).toBe('false');
    // Choice row gone; data/enum/func rows remain.
    expect(screen.queryByTestId('ns-type-pkg.C1')).toBeNull();
    expect(screen.getByTestId('ns-type-pkg.D1')).toBeTruthy();
    expect(screen.getByTestId('ns-type-pkg.E1')).toBeTruthy();
  });

  it('prunes a now-empty namespace from the tree when its only kind is filtered off', () => {
    const singleNode = makeNode('only.choice', 'C', 'Choice');
    render(
      <NamespaceExplorerPanel
        nodeRepository={repoFrom([singleNode])}
        expandedNamespaces={new Set(['only.choice'])}
        hiddenNodeIds={new Set()}
        onToggleNamespace={vi.fn()}
        onExpandAll={vi.fn()}
        onCollapseAll={vi.fn()}
        onSelectNode={vi.fn()}
      />
    );
    expect(screen.getByTestId('ns-type-only.choice.C')).toBeTruthy();
    fireEvent.click(screen.getByTestId('kind-filter-choice'));
    expect(screen.queryByTestId('ns-type-only.choice.C')).toBeNull();
    // Empty-state message replaces the pruned tree.
    expect(screen.getByText('No types loaded')).toBeTruthy();
  });
});
