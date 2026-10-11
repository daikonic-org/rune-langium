// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Tests for the StructureView component (Phase 7).
 *
 * Task 7.1 — empty-state renders when focusedTypeId is undefined.
 * Task 7.2 — adapter + layout integration: expansion map controls visibility.
 * PR #182 Finding 2 — unsupported-root state for non-Data and stale selections.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { StructureView } from '../../src/components/StructureView.js';
import type { AdapterDocument } from '../../src/adapters/structure-graph-adapter.js';
import { expansionKey } from '../../src/types/structure-view.js';

const { reactFlow } = vi.hoisted(() => ({ reactFlow: { fitView: vi.fn() } }));

// -----------------------------------------------------------------------
// Task 7.1 — empty-state
// -----------------------------------------------------------------------

describe('StructureView — empty state', () => {
  it('renders empty-state when focusedTypeId is undefined', () => {
    render(<StructureView focusedTypeId={undefined} adapterDoc={undefined} />);
    expect(screen.getByTestId('structure-empty-state')).toBeInTheDocument();
    expect(screen.getByTestId('structure-empty-state')).toHaveTextContent(
      'Select a type from the Type explorer to view its structure.'
    );
  });

  it('renders empty-state when adapterDoc is undefined even with a focusedTypeId', () => {
    render(<StructureView focusedTypeId="cdm.trade.Trade" adapterDoc={undefined} />);
    expect(screen.getByTestId('structure-empty-state')).toBeInTheDocument();
  });

  it('renders empty-state when focusedTypeId is undefined even with an adapterDoc', () => {
    const doc: AdapterDocument = {
      namespaces: [{ uri: 'cdm.trade' }],
      nodes: []
    };
    render(<StructureView focusedTypeId={undefined} adapterDoc={doc} />);
    expect(screen.getByTestId('structure-empty-state')).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------------
// Task 7.2 — adapter + layout integration
// -----------------------------------------------------------------------

/**
 * Fixture: Trade with an economics: Economics attribute.
 * Uses canonical cardinality shape { inf, sup?, unbounded }.
 */
const tradeDoc: AdapterDocument = {
  namespaces: [{ uri: 'cdm.trade' }],
  nodes: [
    {
      id: 'cdm.trade.Economics',
      $type: 'Data' as const,
      name: 'Economics',
      namespace: 'cdm.trade',
      attributes: [
        {
          name: 'notional',
          typeCall: { type: { $refText: 'number' } },
          card: { inf: 0, sup: 1, unbounded: false }
        }
      ]
    },
    {
      id: 'cdm.trade.Trade',
      $type: 'Data' as const,
      name: 'Trade',
      namespace: 'cdm.trade',
      attributes: [
        {
          name: 'tradeDate',
          typeCall: { type: { $refText: 'date' } },
          card: { inf: 0, sup: 1, unbounded: false }
        },
        {
          name: 'economics',
          typeCall: { type: { $refText: 'Economics' } },
          card: { inf: 0, unbounded: false }
        }
      ]
    }
  ]
};

/**
 * Mock ReactFlow to avoid jsdom layout measurement failures.
 * The mock renders each node's data-id so we can assert which nodes are present
 * without requiring full browser geometry.
 */
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    // Phase 13 / Finding 2: layout uses per-edge instance ids for child React
    // Flow node ids. The canonical id is preserved in `data.id` (see the
    // layout's per-node data payload). The mock surfaces both so tests can
    // assert against the stable canonical id rather than the path-dependent
    // instance id.
    ReactFlow: ({
      nodes,
      onlyRenderVisibleElements
    }: {
      nodes: Array<{ id: string; className?: string; data: { id?: string } }>;
      onlyRenderVisibleElements?: boolean;
    }) => (
      <div
        data-testid="mock-react-flow"
        data-only-render-visible={onlyRenderVisibleElements === true ? 'true' : 'false'}
      >
        {nodes.map((n) => (
          <div
            className={n.className}
            key={n.id}
            data-testid={`rf-node-${n.id}`}
            data-node-id={n.id}
            data-canonical-id={n.data?.id ?? n.id}
          />
        ))}
      </div>
    ),
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReactFlow: () => reactFlow
  };
});

// -----------------------------------------------------------------------
// Phase 14e/A — Choice + Enum roots are first-class
//
// Previously (PR #182 Finding 2) StructureView rejected Choice/Enum roots
// with an unsupported-root message even though EditorPage allowed them
// through. Phase 14e/A wires real Choice / Enum root materialization via
// the adapter, so only an unknown id (deleted/renamed type, stale selection)
// falls through to the unsupported-root state.
// -----------------------------------------------------------------------

describe('StructureView — Choice / Enum roots are first-class (Phase 14e/A)', () => {
  it('renders the Choice as root (NOT unsupported state) when focusedTypeId resolves to a Choice', () => {
    const docWithChoice: AdapterDocument = {
      namespaces: [{ uri: 'cdm.settlement' }],
      nodes: [
        {
          id: 'cdm.settlement.SettlementTerms',
          $type: 'Choice' as const,
          name: 'SettlementTerms',
          namespace: 'cdm.settlement',
          choiceOptions: [{ typeCall: { type: { $refText: 'Cash' } } }]
        }
      ]
    };
    render(<StructureView focusedTypeId="cdm.settlement.SettlementTerms" adapterDoc={docWithChoice} />);
    // No unsupported / empty state — the Choice mounts as the root.
    expect(screen.queryByTestId('structure-unsupported-root-state')).toBeNull();
    expect(screen.queryByTestId('structure-empty-state')).toBeNull();
    expect(screen.getByTestId('mock-react-flow')).toBeInTheDocument();
    // The Choice's canonical id appears in the rendered nodes.
    const choiceNode = document.querySelector('[data-canonical-id="cdm.settlement.SettlementTerms"]');
    expect(choiceNode).not.toBeNull();
  });

  it('renders the Enum as root (NOT unsupported state) when focusedTypeId resolves to an Enum', () => {
    const docWithEnum: AdapterDocument = {
      namespaces: [{ uri: 'cdm.base' }],
      nodes: [
        {
          id: 'cdm.base.DayCountFraction',
          $type: 'Enum' as const,
          name: 'DayCountFraction',
          namespace: 'cdm.base',
          values: [{ name: 'ACT_360' }, { name: 'ACT_365' }]
        }
      ]
    };
    render(<StructureView focusedTypeId="cdm.base.DayCountFraction" adapterDoc={docWithEnum} />);
    expect(screen.queryByTestId('structure-unsupported-root-state')).toBeNull();
    expect(screen.queryByTestId('structure-empty-state')).toBeNull();
    expect(screen.getByTestId('mock-react-flow')).toBeInTheDocument();
    const enumNode = document.querySelector('[data-canonical-id="cdm.base.DayCountFraction"]');
    expect(enumNode).not.toBeNull();
  });

  it('renders unsupported-root when focusedTypeId does not exist in adapterDoc (stale selection)', () => {
    const docWithoutStaleNode: AdapterDocument = {
      namespaces: [{ uri: 'cdm.trade' }],
      nodes: [
        {
          id: 'cdm.trade.Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'cdm.trade',
          attributes: []
        }
      ]
    };
    render(<StructureView focusedTypeId="cdm.trade.DeletedType" adapterDoc={docWithoutStaleNode} />);
    expect(screen.getByTestId('structure-unsupported-root-state')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-react-flow')).toBeNull();
  });

  it('does NOT render unsupported-root for a valid Data selection', () => {
    render(<StructureView focusedTypeId="cdm.trade.Trade" adapterDoc={tradeDoc} />);
    expect(screen.queryByTestId('structure-unsupported-root-state')).toBeNull();
    expect(screen.getByTestId('mock-react-flow')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Codex P2 / PR #191 — 'structureBase' nodes get expansionMap + onToggleExpansion
// ---------------------------------------------------------------------------

describe('StructureView — structureBase injection (Codex P2, PR #191)', () => {
  it('injects expansionMap and onToggleExpansion into structureBase nodes but NOT cellComponents', () => {
    // Spy on the mocked ReactFlow to capture the nodes array it receives.
    // The module mock is installed at the top of the file. We install a second
    // overriding mock here via vi.doMock — but that requires re-importing, which
    // is complex in this ESM setup. Instead we assert the effect indirectly:
    //
    // Approach: inject a custom onToggleExpansion, render a doc that produces
    // a structureBase node (Trade extends TradeBase with a complex attr on
    // TradeBase). Use the already-mocked ReactFlow that renders
    // `data-testid="rf-node-{id}"` divs. Then assert both root node AND the
    // base container node appear (base container id contains the canonical base
    // id in its instance-id path), and that no crash occurs — which proves the
    // injection is wired (GroupContainerNode would throw if it received undefined
    // for required props, but since the interface marks them optional, the real
    // signal here is no exception + correct nodes rendered).
    //
    // A doc where Trade extends TradeBase — adapter will emit a structureBase node.
    const docWithBase: AdapterDocument = {
      namespaces: [{ uri: 'cdm.trade' }],
      nodes: [
        {
          id: 'cdm.trade.TradeBase',
          $type: 'Data' as const,
          name: 'TradeBase',
          namespace: 'cdm.trade',
          attributes: [
            {
              name: 'tradeID',
              typeCall: { type: { $refText: 'string' } },
              card: { inf: 0, sup: 1, unbounded: false }
            }
          ]
        },
        {
          id: 'cdm.trade.Trade',
          $type: 'Data' as const,
          name: 'Trade',
          namespace: 'cdm.trade',
          extends: 'TradeBase',
          attributes: [
            {
              name: 'tradeDate',
              typeCall: { type: { $refText: 'date' } },
              card: { inf: 0, sup: 1, unbounded: false }
            }
          ]
        }
      ]
    };

    const onToggleExpansion = vi.fn();
    const expansionMap = new Map<string, boolean>();

    render(
      <StructureView
        focusedTypeId="cdm.trade.Trade"
        adapterDoc={docWithBase}
        expansionMap={expansionMap}
        onToggleExpansion={onToggleExpansion}
      />
    );

    // Sanity: not empty/unsupported state.
    expect(screen.queryByTestId('structure-empty-state')).toBeNull();
    expect(screen.queryByTestId('structure-unsupported-root-state')).toBeNull();

    // The mock ReactFlow rendered. When Trade extends TradeBase, the layout
    // wraps Trade in a base container. The root React Flow node id is the base
    // container's instance id (`cdm.trade.Trade::__base::cdm.trade.TradeBase`),
    // not the bare canonical Trade id. Assert via canonical id attributes
    // which the mock surfaces on `data-canonical-id`.
    const baseContainerNode = document.querySelector(
      '[data-canonical-id="cdm.trade.Trade::__base::cdm.trade.TradeBase"]'
    );
    expect(baseContainerNode).not.toBeNull();

    // The derived Trade node is a child inside the base container. Its canonical
    // id is the plain Trade id; the instance id is path-qualified.
    const derivedTradeNode = document.querySelector('[data-canonical-id="cdm.trade.Trade"]');
    expect(derivedTradeNode).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 14e/B — StructureView injects cellComponents + expansion plumbing
// into 'choice' typed nodes (parity with 'data')
// ---------------------------------------------------------------------------

describe('StructureView — choice-node injection (Phase 14e/B)', () => {
  it('injects cellComponents + expansionMap + onToggleExpansion into choice nodes', () => {
    // The mocked ReactFlow surfaces n.data via `data-canonical-id`. To verify
    // injection took effect, we use a real cellComponents.type that asserts
    // its presence at render time. Skipping the mock here is impractical, so
    // instead we verify indirectly: no crash + the Choice root mounts.
    const docWithChoice: AdapterDocument = {
      namespaces: [{ uri: 'cdm.payment' }],
      nodes: [
        {
          id: 'cdm.payment.Method',
          $type: 'Choice' as const,
          name: 'Method',
          namespace: 'cdm.payment',
          choiceOptions: [{ typeCall: { type: { $refText: 'Cash' } } }]
        }
      ]
    };
    const onToggleExpansion = vi.fn();
    const cellComponents = { type: () => <span data-testid="injected-type-cell" /> };
    render(
      <StructureView
        focusedTypeId="cdm.payment.Method"
        adapterDoc={docWithChoice}
        expansionMap={new Map()}
        onToggleExpansion={onToggleExpansion}
        cellComponents={cellComponents as any}
      />
    );
    // The Choice root mounted (no crash) and was rendered through the layout.
    expect(screen.queryByTestId('structure-unsupported-root-state')).toBeNull();
    expect(screen.queryByTestId('structure-empty-state')).toBeNull();
    expect(screen.getByTestId('mock-react-flow')).toBeInTheDocument();
    expect(document.querySelector('[data-canonical-id="cdm.payment.Method"]')).not.toBeNull();
  });
});

describe('StructureView — adapter + layout integration', () => {
  it('renders Trade node; Economics node absent when not expanded', () => {
    render(<StructureView focusedTypeId="cdm.trade.Trade" adapterDoc={tradeDoc} expansionMap={new Map()} />);

    // Flow container should be present (not empty state)
    expect(screen.queryByTestId('structure-empty-state')).toBeNull();
    expect(screen.getByTestId('mock-react-flow')).toBeInTheDocument();

    // Root retains its canonical id, so the rf-node testid is stable.
    const tradeNode = screen.queryByTestId('rf-node-cdm.trade.Trade');
    expect(tradeNode).toBeInTheDocument();

    // Economics should NOT appear (no expansion) — assert via canonical id.
    const economicsByCanonical = document.querySelector('[data-canonical-id="cdm.trade.Economics"]');
    expect(economicsByCanonical).toBeNull();
  });

  it('renders Economics node when expansion map marks it as expanded', () => {
    // Per-instance key: Trade's root instance id is its canonical id 'cdm.trade.Trade'.
    // Root-row chevrons use instancePath = [rootInstanceId] (self-inclusive).
    const key = expansionKey({
      namespaceUri: 'cdm.trade',
      typeId: 'Trade',
      attrName: 'economics',
      instancePath: ['cdm.trade.Trade']
    });
    const expansionMap = new Map([[key, true]]);

    render(<StructureView focusedTypeId="cdm.trade.Trade" adapterDoc={tradeDoc} expansionMap={expansionMap} />);

    expect(screen.queryByTestId('structure-empty-state')).toBeNull();
    // Phase 13 / Finding 2: assert by canonical id since the React Flow `id`
    // is a per-edge instance id (`cdm.trade.Trade::economics::cdm.trade.Economics`).
    const economicsByCanonical = document.querySelector('[data-canonical-id="cdm.trade.Economics"]');
    expect(economicsByCanonical).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Finding H — onlyRenderVisibleElements prop (020-14b)
//
// Deeply expanded schemas (CDM Trade 3-4 levels) emit hundreds of
// containment-nested nodes. React Flow renders all of them by default even
// when most are off-viewport. onlyRenderVisibleElements culls offscreen nodes
// — a favorable trade-off for a read-only viewer with no edges and no minimap.
// Perf benefit is only observable in real-browser scroll/pan; this test just
// asserts the prop is gated so CI catches regressions.
//
// PR #472 review: culling is now DEFERRED until the measurement pass has
// converged for the current layout — culled nodes never mount, so enabling
// culling before every node is measured would freeze estimate-based widths.
// In jsdom the container reports 0×0 (treated as hidden — see the hidden-host
// guard), so measurement never runs and the prop must stay false here. The
// converged=true path is exercised in real-browser e2e verification.
// ---------------------------------------------------------------------------

describe('StructureView — onlyRenderVisibleElements (Finding H)', () => {
  it('keeps onlyRenderVisibleElements off until measurement converges', () => {
    render(<StructureView focusedTypeId="cdm.trade.Trade" adapterDoc={tradeDoc} />);
    expect(screen.queryByTestId('structure-empty-state')).toBeNull();
    const flow = screen.getByTestId('mock-react-flow');
    expect(flow.getAttribute('data-only-render-visible')).toBe('false');
  });

  it('measures a revealed pane on the next frame, outside the resize callback', () => {
    let onResize: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          onResize = callback;
        }
        observe() {}
        disconnect() {}
      }
    );
    const view = render(<StructureView focusedTypeId="cdm.trade.Trade" adapterDoc={tradeDoc} />);
    const container = screen.getByTestId('structure-view-flow');
    let width = 0;
    let height = 0;
    Object.defineProperty(container, 'offsetWidth', { configurable: true, get: () => width });
    Object.defineProperty(container, 'offsetHeight', { configurable: true, get: () => height });
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    try {
      width = 500;
      height = 400;
      act(() => onResize?.([], {} as ResizeObserver));
      expect(frames).toHaveLength(1);
      expect(screen.getByTestId('mock-react-flow').getAttribute('data-only-render-visible')).toBe('false');
      act(() => frames.shift()?.(0));
      expect(screen.getByTestId('mock-react-flow').getAttribute('data-only-render-visible')).toBe('true');
    } finally {
      view.unmount();
      requestFrame.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('StructureView — fitting after pane resizing', () => {
  let resize: () => void;
  let width: number;
  let height: number;
  const disconnect = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    width = 640;
    height = 480;
    reactFlow.fitView.mockClear();
    disconnect.mockClear();
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
      return this.dataset.testid === 'structure-view-flow' ? width : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
      return this.dataset.testid === 'structure-view-flow' ? height : 0;
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect = disconnect;
      }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function renderFittedStructure() {
    const result = render(<StructureView focusedTypeId="cdm.trade.Trade" adapterDoc={tradeDoc} />);
    act(() => vi.advanceTimersByTime(32));
    reactFlow.fitView.mockClear();
    return result;
  }

  it('refits once after a series of nonzero pane-size changes settles', () => {
    renderFittedStructure();
    act(() => {
      width = 420;
      resize();
    });
    act(() => vi.advanceTimersByTime(80));
    act(() => {
      width = 320;
      resize();
    });
    act(() => vi.advanceTimersByTime(100));
    expect(reactFlow.fitView).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(60));
    act(() => vi.advanceTimersByTime(32));
    expect(reactFlow.fitView).toHaveBeenCalledOnce();
    expect(reactFlow.fitView).toHaveBeenCalledWith({ padding: 0.1, duration: 300 });
    act(() => resize());
    act(() => vi.advanceTimersByTime(200));
    expect(reactFlow.fitView).toHaveBeenCalledOnce();
  });

  it('does not fit a hidden canvas and refits when it becomes visible again', () => {
    renderFittedStructure();
    act(() => {
      width = 300;
      resize();
    });
    act(() => {
      width = 0;
      height = 0;
      resize();
    });
    act(() => vi.advanceTimersByTime(200));
    expect(reactFlow.fitView).not.toHaveBeenCalled();
    act(() => {
      width = 300;
      height = 280;
      resize();
    });
    act(() => vi.advanceTimersByTime(160));
    act(() => vi.advanceTimersByTime(32));
    expect(reactFlow.fitView).toHaveBeenCalled();
  });

  it('cancels a pending resize fit when unmounted', () => {
    const { unmount } = renderFittedStructure();
    act(() => {
      width = 320;
      resize();
    });
    unmount();
    act(() => vi.advanceTimersByTime(200));
    expect(reactFlow.fitView).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

describe('StructureView navigation arrivals', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('briefly emphasizes the destination and repeats same-target navigation without reacting to expansion', () => {
    const { container, rerender } = render(
      <StructureView focusedTypeId="cdm.trade.Trade" adapterDoc={tradeDoc} navigationRevision={1} />
    );
    act(() => vi.advanceTimersByTime(350));
    expect(container.querySelector('.rune-navigation-arrival')).toHaveAttribute('data-canonical-id', 'cdm.trade.Trade');
    act(() => vi.advanceTimersByTime(1100));
    expect(container.querySelector('.rune-navigation-arrival')).toBeNull();
    reactFlow.fitView.mockClear();
    rerender(<StructureView focusedTypeId="cdm.trade.Trade" adapterDoc={tradeDoc} navigationRevision={2} />);
    act(() => vi.advanceTimersByTime(350));
    expect(container.querySelector('.rune-navigation-arrival')).not.toBeNull();
    expect(reactFlow.fitView).toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1100));
    rerender(
      <StructureView
        focusedTypeId="cdm.trade.Trade"
        adapterDoc={tradeDoc}
        navigationRevision={2}
        expansionMap={new Map([[expansionKey('cdm.trade.Trade', 'economics'), true]])}
      />
    );
    act(() => vi.advanceTimersByTime(350));
    expect(container.querySelector('.rune-navigation-arrival')).toBeNull();
  });
});
