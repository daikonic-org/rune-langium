// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * `RuneTypeGraph` — Main React graph component for visualizing Rune DSL (CDM/DRR)
 * type hierarchies using `@xyflow/react`.
 *
 * @remarks
 * Subscribes to the zustand `editorStore` for node/edge data and visibility state.
 * Local ReactFlow state preserves drag positions across renders; store data is
 * synced in on each store update. All domain mutations (add/remove types,
 * attribute edits) go through the store — this component is intentionally read-only
 * from a domain perspective.
 *
 * The component renders inside a `ReactFlowProvider` wrapper so it can host its own
 * ReactFlow instance. The `ref` prop exposes imperative handles for programmatic
 * control (`fitView`, `navigateToNode`, `getSelection`).
 *
 * @useWhen
 * - Embedding a Rune DSL type hierarchy viewer or editor in a React app
 * - Visualizing CDM/DRR model graphs alongside a text editor
 *
 * @avoidWhen
 * - Mounting multiple `RuneTypeGraph` instances pointing at the **same** zustand
 *   store — both will compete for node position state and layout triggers, causing
 *   visual inconsistencies and duplicate re-renders. Each graph instance should
 *   own its own store (use `createEditorStore()` to create isolated instances).
 * - Using in a server-side rendering (SSR) context — `@xyflow/react` is browser-only.
 *
 * @pitfalls
 * - Do NOT mount this component before the Rune DSL workspace has been loaded into
 *   the store — the graph will render empty and the layout engine will produce
 *   zero-node output with no visible error.
 * - Do NOT share a single `editorStore` instance between multiple mounted graphs —
 *   concurrent Dagre layout computations will overwrite each other's node positions.
 * - Async layout (`computeLayoutAsync`) uses a Web Worker; if the worker is cancelled
 *   mid-run (e.g., rapid model updates), the graph may remain in a transitional
 *   layout state. The next model change triggers a fresh layout.
 *
 * @category Visual Editor
 * @see {@link RuneTypeGraphProps}
 * @see {@link RuneTypeGraphRef}
 * @see {@link createEditorStore}
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useCallback, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigationArrival } from '../hooks/useNavigationArrival.js';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Panel,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useNodesInitialized,
  useReactFlow,
  ReactFlowProvider,
  type Node
} from '@xyflow/react';
import type { OnSelectionChangeParams } from '@xyflow/react';
import { cn } from '@rune-langium/design-system/utils';
import { nodeTypes } from './nodes/index.js';
import { NavigationContext } from './nodes/NavigationContext.js';
import { edgeTypes } from './edges/index.js';
import { GraphContextMenu } from './GraphContextMenu.js';
import type { ContextMenuState } from './GraphContextMenu.js';
import { GraphLegend } from './GraphLegend.js';
import { computeLayout, computeLayoutIncremental } from '../layout/dagre-layout.js';
import { computeLayoutAsync, cancelAsyncLayout } from '../layout/layout-worker.js';
import { findInheritanceGroups } from '../layout/grouped-layout.js';
import { getNodeHeight, getNodeWidth } from '../layout/node-dimensions.js';
import { GRAPH_NODE_CSS_VARS } from '../layout/graph-node-geometry.js';
import { shouldReplaceLayoutPositions } from './layout-sync.js';
import { modelsToAst } from '../adapters/model-to-ast.js';
import { indexById } from '@rune-langium/core';
import { renderModel } from '@rune-langium/codegen/rosetta';
import { validateGraph } from '../validation/edit-validator.js';
import { useEditorStore } from '../store/editor-store.js';
import { selectNodeRepository } from '../store/node-repository.js';
import { qualifiedNameFromNodeId } from '../store/node-projection.js';
import type {
  RuneTypeGraphProps,
  RuneTypeGraphRef,
  TypeGraphNode,
  TypeGraphEdge,
  GraphFilters,
  LayoutOptions,
  ValidationError,
  AnyGraphNode,
  EdgeData
} from '../types.js';
import type { GroupContainerData, GroupContainerNodeType } from './nodes/GroupContainerNode.js';

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: {
  layout: LayoutOptions;
  showMinimap: boolean;
  showControls: boolean;
  showLegend: boolean;
  readOnly: boolean;
} = {
  layout: { direction: 'TB' as const, nodeSeparation: 50, rankSeparation: 100 },
  showMinimap: false,
  showControls: true,
  showLegend: true,
  readOnly: true
};

const VIEWPORT_STORAGE_KEY = 'rune-type-graph:viewport';
const GROUP_HORIZONTAL_PADDING = 26;
const GROUP_TOP_PADDING = 40;
const GROUP_BOTTOM_PADDING = 18;

type DisplayGraphNode = TypeGraphNode | GroupContainerNodeType;
type StoredViewport = { x: number; y: number; zoom: number };

interface PersistedViewportRecord {
  signature: string;
  viewport: StoredViewport;
}

interface InheritanceDisplayModel {
  nodes: DisplayGraphNode[];
  groupLabelsByNodeId: Map<string, string>;
}

function isGroupContainerNode(node: DisplayGraphNode): node is GroupContainerNodeType {
  return node.type === 'groupContainer';
}

function isTypeGraphNode(node: DisplayGraphNode): node is TypeGraphNode {
  return !isGroupContainerNode(node);
}

function createViewportSignature(
  nodes: Array<{ id: string }>,
  edges: Array<{ id: string }>,
  layout: LayoutOptions
): string {
  const engine = layout.engine ?? 'dagre';
  const direction = layout.direction ?? 'TB';
  const grouping = layout.groupByInheritance ? 'grouped' : 'flat';
  const nodeIds = nodes
    .map((node) => node.id)
    .sort()
    .join('|');
  const edgeIds = edges
    .map((edge) => edge.id)
    .sort()
    .join('|');
  return `engine:${engine};dir:${direction};group:${grouping};nodes:${nodeIds};edges:${edgeIds}`;
}

function restoreViewport(rawViewport: string | null, expectedSignature: string): StoredViewport | null {
  if (!rawViewport) return null;
  const parsed = JSON.parse(rawViewport) as Partial<PersistedViewportRecord> | StoredViewport;
  if ('signature' in parsed && 'viewport' in parsed) {
    return parsed.signature === expectedSignature ? (parsed.viewport ?? null) : null;
  }
  return null;
}

function buildInheritanceDisplayNodes(nodes: TypeGraphNode[], edges: TypeGraphEdge[]): InheritanceDisplayModel {
  const groups = findInheritanceGroups(nodes, edges).filter((group) => group.nodes.length > 1);
  if (groups.length === 0) return { nodes, groupLabelsByNodeId: new Map() };

  const groupedNodeIds = new Set<string>();
  const groupedNodes: DisplayGraphNode[] = [];
  const groupLabelsByNodeId = new Map<string, string>();

  for (const group of groups) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const node of group.nodes) {
      const width = getNodeWidth(node);
      const height = getNodeHeight(node);
      const { x, y } = node.position;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
      groupedNodeIds.add(node.id);
    }

    const groupPosition = {
      x: minX - GROUP_HORIZONTAL_PADDING,
      y: minY - GROUP_TOP_PADDING
    };
    const groupWidth = maxX - minX + GROUP_HORIZONTAL_PADDING * 2;
    const groupHeight = maxY - minY + GROUP_TOP_PADDING + GROUP_BOTTOM_PADDING;
    const groupNodeId = `__group__inheritance__${group.id}`;
    const rootName = group.nodes[0]?.data.name ?? 'Inheritance cluster';
    const groupNode: GroupContainerNodeType = {
      id: groupNodeId,
      type: 'groupContainer',
      position: groupPosition,
      data: {
        label: rootName,
        description: 'Inheritance cluster',
        nodeCount: group.nodes.length,
        scope: 'inheritance'
      } satisfies GroupContainerData,
      style: {
        width: groupWidth,
        height: groupHeight
      },
      draggable: false,
      selectable: false,
      deletable: false,
      connectable: false
    };

    groupedNodes.push(groupNode);
    for (const node of group.nodes) {
      groupLabelsByNodeId.set(node.id, rootName);
      groupedNodes.push({
        ...node,
        parentId: groupNodeId,
        extent: 'parent',
        draggable: false,
        position: {
          x: node.position.x - groupPosition.x,
          y: node.position.y - groupPosition.y
        }
      });
    }
  }

  for (const node of nodes) {
    if (!groupedNodeIds.has(node.id)) {
      groupedNodes.push(node);
    }
  }

  return { nodes: groupedNodes, groupLabelsByNodeId };
}

// ---------------------------------------------------------------------------
// Inner component (needs ReactFlowProvider context)
// ---------------------------------------------------------------------------

const RuneTypeGraphInner = forwardRef<RuneTypeGraphRef, RuneTypeGraphProps>(function RuneTypeGraphInner(
  { config, callbacks, className, navigationTarget },
  ref
) {
  const mergedConfig = useMemo(() => ({ ...DEFAULT_CONFIG, ...config }), [config]);
  const [runtimeLayoutEngine, setRuntimeLayoutEngine] = useState<'dagre' | 'elk'>(
    mergedConfig.layout.engine ?? 'dagre'
  );
  useEffect(() => {
    setRuntimeLayoutEngine(mergedConfig.layout.engine ?? 'dagre');
  }, [mergedConfig.layout.engine]);
  const activeLayout = useMemo(
    () => ({
      ...mergedConfig.layout,
      engine: runtimeLayoutEngine
    }),
    [mergedConfig.layout, runtimeLayoutEngine]
  );
  const { fitView, setCenter, setViewport } = useReactFlow();

  // Subscribe to store state
  const storeNodes = useEditorStore((s) => s.nodes);
  const storeNodesById = useEditorStore((s) => s.nodesById);
  const storeEdges = useEditorStore((s) => s.edges);
  const visibility = useEditorStore((s) => s.visibility);
  const selectNode = useEditorStore((s) => s.selectNode);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const focusMode = useEditorStore((s) => s.focusMode);
  const pendingHydrationNamespaces = useEditorStore((s) => s.pendingHydrationNamespaces);

  // Derive visible nodes/edges from store, respecting namespace, kind, and individual visibility
  const { visibleNodes, visibleEdges } = useMemo(() => {
    const { expandedNamespaces, hiddenNodeIds, visibleNodeKinds, visibleEdgeKinds } = visibility;
    const vNodes = storeNodes.filter(
      (n) =>
        expandedNamespaces.has(n.meta.namespace) &&
        !hiddenNodeIds.has(n.id) &&
        visibleNodeKinds.has(n.type as import('../types.js').TypeKind)
    );
    const visibleIds = new Set(vNodes.map((n) => n.id));
    const vEdges = storeEdges.filter(
      (e) =>
        visibleIds.has(e.source) &&
        visibleIds.has(e.target) &&
        visibleEdgeKinds.has((e.data as import('../types.js').EdgeData).kind)
    );
    return { visibleNodes: vNodes, visibleEdges: vEdges };
  }, [storeNodes, storeEdges, visibility]);

  // Apply layout to visible nodes.
  // Small graphs (<500 nodes): synchronous incremental layout (cache-first).
  // Large graphs (>=500 nodes): async layout off the main thread.
  const isInitialLoad = useRef(true);
  const ASYNC_LAYOUT_THRESHOLD = 500;
  const layoutEngine = activeLayout.engine ?? 'dagre';
  const shouldUseAsyncLayout = layoutEngine === 'elk' || visibleNodes.length >= ASYNC_LAYOUT_THRESHOLD;
  const [asyncLayoutResult, setAsyncLayoutResult] = useState<TypeGraphNode[]>([]);

  // Synchronous path for small/medium graphs
  const syncLayoutedNodes = useMemo(() => {
    if (visibleNodes.length === 0 || shouldUseAsyncLayout) return [];
    if (isInitialLoad.current) {
      return computeLayout(visibleNodes, visibleEdges, activeLayout);
    }
    return computeLayoutIncremental(visibleNodes, visibleEdges, activeLayout);
  }, [activeLayout, shouldUseAsyncLayout, visibleEdges, visibleNodes]);

  // Flip the flag only once the initial render has actually committed —
  // doing this inside the useMemo above would leak into discarded render
  // work (Strict Mode double-render, Suspense retries, concurrent
  // prerendering), permanently skipping the one-time full computeLayout
  // for a render that never committed.
  useEffect(() => {
    isInitialLoad.current = false;
  }, []);

  // Async path for large graphs
  useEffect(() => {
    if (!shouldUseAsyncLayout) return;
    if (visibleNodes.length === 0) {
      setAsyncLayoutResult([]);
      return;
    }
    cancelAsyncLayout();
    computeLayoutAsync(visibleNodes, visibleEdges, activeLayout).then((result) => {
      if (result) {
        setAsyncLayoutResult(result);
        isInitialLoad.current = false;
      }
    });
    return () => cancelAsyncLayout();
  }, [activeLayout, shouldUseAsyncLayout, visibleEdges, visibleNodes]);

  const layoutedNodes = shouldUseAsyncLayout ? asyncLayoutResult : syncLayoutedNodes;
  const viewportSignature = useMemo(
    () => createViewportSignature(layoutedNodes, visibleEdges, activeLayout),
    [activeLayout, layoutedNodes, visibleEdges]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<DisplayGraphNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<TypeGraphEdge>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  // Track current filters
  const filtersRef = useRef<GraphFilters>(mergedConfig.initialFilters ?? {});

  // Sync store data into local ReactFlow state, preserving drag positions
  const prevVisibleRef = useRef<TypeGraphNode[]>([]);
  const prevLayoutedRef = useRef<TypeGraphNode[]>([]);
  const initialLoadDoneRef = useRef(false);
  useEffect(() => {
    const prev = prevVisibleRef.current;
    const prevLayouted = prevLayoutedRef.current;
    prevVisibleRef.current = layoutedNodes;
    prevLayoutedRef.current = layoutedNodes;

    const layoutChanged = shouldReplaceLayoutPositions(prevLayouted, layoutedNodes);

    if (prev.length === 0 || layoutChanged) {
      // Initial load — set nodes; viewport restore fires in the nodesInitialized effect below
      setNodes(layoutedNodes);
      setEdges(visibleEdges);
      return;
    }

    // Merge: preserve local positions, update data from store
    setNodes((localNodes: DisplayGraphNode[]) => {
      const localTypeNodes = localNodes.filter(isTypeGraphNode);
      const storeMap = indexById(layoutedNodes);
      const merged: DisplayGraphNode[] = [];
      for (const n of localTypeNodes) {
        const sn = storeMap.get(n.id);
        if (!sn) continue;
        // Preserve position from local state, update data from store
        merged.push(sn.data === n.data ? n : { ...n, data: sn.data });
      }

      // Add new nodes not yet in local state
      const localIds = new Set(localTypeNodes.map((n) => n.id));
      for (const sn of layoutedNodes) {
        if (!localIds.has(sn.id)) merged.push(sn);
      }
      return merged;
    });
    setEdges(visibleEdges);
  }, [layoutedNodes, visibleEdges, setNodes, setEdges]);

  const graphNodes = useMemo(() => nodes.filter(isTypeGraphNode), [nodes]);
  const nodesInitialized = useNodesInitialized();
  const measuredLayoutKey = useMemo(() => {
    if (!nodesInitialized || graphNodes.length === 0) return null;
    const nodeKey = graphNodes
      .map((node) => `${node.id}:${Math.round(getNodeWidth(node))}x${Math.round(getNodeHeight(node))}`)
      .sort()
      .join('|');
    return [
      activeLayout.engine ?? 'dagre',
      activeLayout.direction ?? 'TB',
      activeLayout.groupByInheritance ? 'grouped' : 'flat',
      nodeKey
    ].join(':');
  }, [activeLayout.direction, activeLayout.engine, activeLayout.groupByInheritance, graphNodes, nodesInitialized]);
  const measuredLayoutKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!measuredLayoutKey) {
      measuredLayoutKeyRef.current = null;
      return;
    }
    if (measuredLayoutKeyRef.current === measuredLayoutKey) return;
    // Guard against the same staleness hazard as the focus-fit/selection-fit
    // effects above: `graphNodes` is derived from local `nodes` state, which
    // can still reflect the PRE-update value when this effect fires in the
    // same commit as the "sync store data into local ReactFlow state" effect
    // (e.g. right after a `selectNode` call changes `visibility`). Relaying
    // out over that stale set here would silently clobber the sync effect's
    // correct, freshly-filtered `setNodes` result back to the unfiltered
    // node list. Only proceed once `graphNodes` actually agrees with the
    // current store-derived `visibleNodes` set — a mismatch means the sync
    // effect's update hasn't landed yet, and this effect will re-fire
    // correctly (with a fresh `measuredLayoutKey`) once it has.
    if (
      graphNodes.length !== visibleNodes.length ||
      !graphNodes.every((n) => visibleNodes.some((v) => v.id === n.id))
    ) {
      return;
    }
    measuredLayoutKeyRef.current = measuredLayoutKey;
    if ((activeLayout.engine ?? 'dagre') === 'elk') {
      computeLayoutAsync(graphNodes, edges, activeLayout).then((relayoutedNodes) => {
        if (!relayoutedNodes) return;
        if (shouldReplaceLayoutPositions(graphNodes, relayoutedNodes)) {
          setNodes(relayoutedNodes);
        }
      });
      return;
    }
    const relayoutedNodes = computeLayout(graphNodes, edges, activeLayout);
    if (shouldReplaceLayoutPositions(graphNodes, relayoutedNodes)) {
      setNodes(relayoutedNodes);
    }
  }, [activeLayout, edges, graphNodes, measuredLayoutKey, setNodes, visibleNodes]);

  // Initial viewport restore — runs once after nodes are measured for the first time.
  // Replaces the old setTimeout(50) approach which fired before dimensions were ready.
  useEffect(() => {
    if (!nodesInitialized || initialLoadDoneRef.current || nodes.length === 0) return;
    initialLoadDoneRef.current = true;
    try {
      const rawViewport = window.localStorage.getItem(VIEWPORT_STORAGE_KEY);
      const viewport = restoreViewport(rawViewport, viewportSignature);
      if (viewport) {
        void setViewport(viewport, { duration: 180 });
      } else {
        void fitView({ duration: 200, padding: 0.16 });
      }
    } catch {
      /* SSR/test guard */
    }
  }, [nodesInitialized, nodes.length, viewportSignature, setViewport, fitView]);

  const focusFitKeyRef = useRef<string | null>(null);
  const selectionFitKeyRef = useRef<string | null>(null);
  const scheduleFitView = useCallback(
    (options?: Parameters<typeof fitView>[0]) => {
      if (typeof window === 'undefined') return;
      let timeoutId: number | undefined;
      const frameId = window.requestAnimationFrame(() => {
        timeoutId = window.setTimeout(() => {
          void fitView(options);
        }, 0);
      });
      return () => {
        window.cancelAnimationFrame(frameId);
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      };
    },
    [fitView]
  );

  const runViewportAction = useCallback(
    (params?: {
      relayout?: boolean;
      layoutOptions?: LayoutOptions;
      focusNodeId?: string;
      mode?: 'fit-graph' | 'fit-node' | 'center-and-fit-node';
      fitOptions?: Parameters<typeof fitView>[0];
      /**
       * Source nodes/edges for a `relayout: true` call. Defaults to the local
       * `graphNodes`/`edges` React Flow state — correct for user-triggered
       * calls (imperative ref methods, toolbar buttons), which always run
       * after the component has settled.
       *
       * Callers invoked from a `useEffect` that reacts to the SAME store
       * change as the "sync store data into local ReactFlow state" effect
       * (below) MUST pass the store-derived `visibleNodes`/`visibleEdges`
       * here instead. Both effects fire in the same commit; `graphNodes`
       * (derived from local `nodes` state) still reflects the PRE-update
       * value until the sync effect's `setNodes` call is itself re-rendered,
       * one commit later. Relaying out over that stale set here would
       * silently clobber the sync effect's correct `setNodes` result back to
       * the unfiltered node list — this was the root cause of newly-added
       * namespace nodes (e.g. a freshly uploaded/typed type) never
       * rendering once focus mode selected them (2026-08-07).
       */
      relayoutNodes?: TypeGraphNode[];
      relayoutEdges?: TypeGraphEdge[];
    }) => {
      const {
        relayout = false,
        layoutOptions,
        focusNodeId,
        mode = 'fit-graph',
        fitOptions,
        relayoutNodes: relayoutNodesParam,
        relayoutEdges: relayoutEdgesParam
      } = params ?? {};
      const relayoutSourceNodes = relayoutNodesParam ?? graphNodes;
      const relayoutSourceEdges = relayoutEdgesParam ?? edges;
      const effectiveLayout = layoutOptions ?? activeLayout;
      const layoutEngine = effectiveLayout.engine ?? 'dagre';
      const nextNodes =
        relayout && layoutEngine !== 'elk'
          ? computeLayout(relayoutSourceNodes, relayoutSourceEdges, effectiveLayout)
          : relayoutSourceNodes;
      if (relayout && layoutEngine === 'elk') {
        computeLayoutAsync(relayoutSourceNodes, relayoutSourceEdges, effectiveLayout).then((relayoutedNodes) => {
          if (!relayoutedNodes) return;
          setNodes(relayoutedNodes);
          const focusedRelayoutedNode = focusNodeId
            ? relayoutedNodes.find((node) => node.id === focusNodeId)
            : undefined;
          if (mode === 'center-and-fit-node' && focusedRelayoutedNode) {
            setCenter(
              focusedRelayoutedNode.position.x + getNodeWidth(focusedRelayoutedNode) / 2,
              focusedRelayoutedNode.position.y + getNodeHeight(focusedRelayoutedNode) / 2,
              {
                zoom: 1.08,
                duration: 220
              }
            );
          }
          if ((mode === 'fit-node' || mode === 'center-and-fit-node') && focusedRelayoutedNode) {
            scheduleFitView(
              fitOptions ?? {
                duration: 200,
                padding: 0.4,
                maxZoom: 1.18,
                nodes: [focusedRelayoutedNode]
              }
            );
            return;
          }
          scheduleFitView(
            fitOptions ??
              (focusMode ? { duration: 220, padding: 0.22, maxZoom: 1.08 } : { duration: 200, padding: 0.16 })
          );
        });
        return;
      }
      if (relayout) {
        setNodes(nextNodes);
      }
      const focusedNode = focusNodeId ? nextNodes.find((node) => node.id === focusNodeId) : undefined;
      if (mode === 'center-and-fit-node' && focusedNode) {
        setCenter(
          focusedNode.position.x + getNodeWidth(focusedNode) / 2,
          focusedNode.position.y + getNodeHeight(focusedNode) / 2,
          {
            zoom: 1.08,
            duration: 220
          }
        );
      }
      if ((mode === 'fit-node' || mode === 'center-and-fit-node') && focusedNode) {
        return scheduleFitView(
          fitOptions ?? {
            duration: 200,
            padding: 0.4,
            maxZoom: 1.18,
            nodes: [focusedNode]
          }
        );
      }
      return scheduleFitView(
        fitOptions ?? (focusMode ? { duration: 220, padding: 0.22, maxZoom: 1.08 } : { duration: 200, padding: 0.16 })
      );
    },
    [activeLayout, edges, focusMode, graphNodes, scheduleFitView, setCenter, setNodes]
  );

  // Re-layout and fit view whenever the focus subgraph changes.
  // Guard with `nodesInitialized` (canonical React Flow pattern) so layout runs
  // only after React Flow has measured actual node dimensions — not fallbacks.
  //
  // Uses `visibleNodes`/`visibleEdges` (store-derived, always current for this
  // render) rather than `graphNodes`/`edges` (derived from local React Flow
  // `nodes` state) for both the membership check and the relayout source. The
  // "sync store data into local ReactFlow state" effect above and this effect
  // both fire in the same commit whenever a `selectNode` call changes
  // `visibility` — `graphNodes` still reflects the PRE-update `nodes` value at
  // that point, one commit behind. Using it here would race with (and silently
  // clobber) the sync effect's `setNodes` call back to the stale, unfiltered
  // node list — the root cause of a freshly focus-selected node (e.g. a type
  // from a just-uploaded file) never rendering (2026-08-07).
  useEffect(() => {
    if (!focusMode || !selectedNodeId || visibility.hiddenNodeIds.size === 0) {
      focusFitKeyRef.current = null;
      return;
    }
    if (!visibleNodes.some((node) => node.id === selectedNodeId)) return;
    const focusKey = `${selectedNodeId}:${visibleNodes
      .map((node) => node.id)
      .sort()
      .join('|')}`;
    // Same subgraph already laid out — skip.
    if (focusFitKeyRef.current === focusKey) return;
    // Nodes not yet measured — wait for the next nodesInitialized → true transition.
    if (!nodesInitialized) return;
    focusFitKeyRef.current = focusKey;
    return runViewportAction({
      relayout: true,
      layoutOptions: {
        ...activeLayout,
        direction: 'TB'
      },
      relayoutNodes: visibleNodes,
      relayoutEdges: visibleEdges,
      focusNodeId: selectedNodeId,
      mode: 'center-and-fit-node',
      fitOptions: {
        duration: 220,
        padding: 0.22,
        maxZoom: 1.9
      }
    });
  }, [
    activeLayout,
    focusMode,
    visibleNodes,
    visibleEdges,
    nodesInitialized,
    runViewportAction,
    selectedNodeId,
    visibility.hiddenNodeIds.size
  ]);

  // Same staleness hazard as the focus-fit effect above: uses `layoutedNodes`
  // (store-derived via a synchronous memo, always current for this render —
  // exactly what the sync effect is about to push into local `nodes` state)
  // rather than `graphNodes` (derived from local `nodes` state, one commit
  // behind when this effect fires in the same commit as the sync effect).
  useEffect(() => {
    if (!selectedNodeId || !nodesInitialized) {
      selectionFitKeyRef.current = null;
      return;
    }
    if (focusMode && visibility.hiddenNodeIds.size > 0) {
      selectionFitKeyRef.current = null;
      return;
    }
    const selectedNode = layoutedNodes.find((node) => node.id === selectedNodeId);
    if (!selectedNode) return;
    const selectionKey = `${selectedNodeId}:${Math.round(selectedNode.position.x)}:${Math.round(selectedNode.position.y)}:${Math.round(getNodeWidth(selectedNode))}x${Math.round(getNodeHeight(selectedNode))}`;
    if (selectionFitKeyRef.current === selectionKey) return;
    selectionFitKeyRef.current = selectionKey;
    return runViewportAction({
      relayoutNodes: layoutedNodes,
      focusNodeId: selectedNodeId,
      mode: 'fit-node',
      fitOptions: {
        duration: 180,
        padding: 0.4,
        maxZoom: 1.18,
        nodes: [selectedNode]
      }
    });
  }, [focusMode, layoutedNodes, nodesInitialized, runViewportAction, selectedNodeId, visibility.hiddenNodeIds.size]);

  const hoveredEdge = useMemo(
    () => (hoveredEdgeId ? (edges.find((edge) => edge.id === hoveredEdgeId) ?? null) : null),
    [edges, hoveredEdgeId]
  );

  const focusNodeId = hoveredNodeId ?? selectedNodeId;

  // Precompute adjacency map so emphasis lookups are O(1) per focus change
  const adjacencyMap = useMemo(() => {
    const map = new Map<string, { nodeIds: Set<string>; edgeIds: Set<string> }>();
    for (const edge of edges) {
      if (!map.has(edge.source)) map.set(edge.source, { nodeIds: new Set(), edgeIds: new Set() });
      if (!map.has(edge.target)) map.set(edge.target, { nodeIds: new Set(), edgeIds: new Set() });
      map.get(edge.source)!.nodeIds.add(edge.target);
      map.get(edge.source)!.edgeIds.add(edge.id);
      map.get(edge.target)!.nodeIds.add(edge.source);
      map.get(edge.target)!.edgeIds.add(edge.id);
    }
    return map;
  }, [edges]);

  const emphasis = useMemo(() => {
    if (hoveredEdge) {
      return {
        focusedNodeIds: new Set<string>([hoveredEdge.source, hoveredEdge.target]),
        focusedEdgeIds: new Set<string>([hoveredEdge.id])
      };
    }
    if (!focusNodeId) return null;
    const focusedNodeIds = new Set<string>([focusNodeId]);
    const focusedEdgeIds = new Set<string>();
    const adjacent = adjacencyMap.get(focusNodeId);
    if (adjacent) {
      for (const nodeId of adjacent.nodeIds) focusedNodeIds.add(nodeId);
      for (const edgeId of adjacent.edgeIds) focusedEdgeIds.add(edgeId);
    }
    return { focusedNodeIds, focusedEdgeIds };
  }, [adjacencyMap, focusNodeId, hoveredEdge]);

  const inheritanceDisplay = useMemo<InheritanceDisplayModel>(
    () =>
      activeLayout.groupByInheritance
        ? buildInheritanceDisplayNodes(graphNodes, edges)
        : { nodes: graphNodes, groupLabelsByNodeId: new Map() },
    [activeLayout.groupByInheritance, edges, graphNodes]
  );

  const { arrivalNodeId, emphasizeArrival, cancelArrival } = useNavigationArrival();
  const navigationNodeId = navigationTarget
    ? graphNodes.find(
        (node) => node.id === navigationTarget.nodeId || qualifiedNameFromNodeId(node.id) === navigationTarget.nodeId
      )?.id
    : undefined;
  useEffect(() => {
    if (navigationNodeId) emphasizeArrival(navigationNodeId, navigationTarget?.revision);
    return cancelArrival;
  }, [navigationNodeId, navigationTarget?.revision, emphasizeArrival, cancelArrival]);

  const baseDisplayNodes = inheritanceDisplay.nodes;

  const displayNodes = useMemo(
    () =>
      baseDisplayNodes.map((node) => {
        if (node.type === 'groupContainer') {
          return {
            ...node,
            className: cn('rune-graph-group-shell', emphasis && 'rune-graph-group-shell--contextual')
          };
        }
        const isFocus = focusNodeId === node.id;
        const isRelated = emphasis?.focusedNodeIds.has(node.id) ?? false;
        const isDimmed = emphasis ? !isRelated : false;
        return {
          ...node,
          className: cn(
            'rune-flow-node-shell',
            arrivalNodeId === node.id && 'rune-navigation-arrival',
            isFocus && 'rune-flow-node-shell--focus',
            isRelated && !isFocus && 'rune-flow-node-shell--related',
            isDimmed && 'rune-flow-node-shell--dimmed'
          )
        };
      }),
    [baseDisplayNodes, emphasis, focusNodeId, arrivalNodeId]
  );

  const displayEdges = useMemo(
    () =>
      edges.map((edge): TypeGraphEdge => {
        const edgeData = edge.data as EdgeData;
        const isRelated = emphasis?.focusedEdgeIds.has(edge.id) ?? false;
        const isDimmed = emphasis ? !isRelated : false;
        const shouldShowLabel = zoomLevel >= 0.9 || isRelated;
        return {
          ...edge,
          data: {
            ...edgeData,
            showLabel: shouldShowLabel
          },
          style: {
            ...edge.style,
            opacity: isDimmed ? 0.16 : 1,
            strokeWidth: isRelated ? 2.35 : edge.style?.strokeWidth
          }
        };
      }),
    [edges, emphasis, zoomLevel]
  );

  const activeNode = useMemo(
    () => graphNodes.find((node) => node.id === (hoveredNodeId ?? selectedNodeId)) ?? null,
    [graphNodes, hoveredNodeId, selectedNodeId]
  );

  const breadcrumbItems = useMemo(() => {
    if (!activeNode) return [];
    const items: Array<{ key: string; label: string }> = [];
    const groupLabel = inheritanceDisplay.groupLabelsByNodeId.get(activeNode.id);
    if (groupLabel) {
      items.push({ key: 'group', label: groupLabel });
    }
    items.push({ key: 'node', label: activeNode.data.name });
    const neighborCount = edges.filter((edge) => edge.source === activeNode.id || edge.target === activeNode.id).length;
    if (neighborCount > 0) {
      items.push({
        key: 'neighbors',
        label: `${neighborCount} related ${neighborCount === 1 ? 'edge' : 'edges'}`
      });
    }
    return items;
  }, [activeNode, inheritanceDisplay.groupLabelsByNodeId, edges]);

  // Selection handler — writes to store
  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      if (selectedNodes.length > 0) {
        const node = selectedNodes[0] as Node;
        if (node.type === 'groupContainer') return;
        selectNode(node.id);
      } else {
        callbacks?.onSelectionClear?.();
      }
    },
    [selectNode, callbacks]
  );

  // Navigation context value for clickable type references in nodes
  const navigationCtx = useMemo(() => {
    const allNodeIds = new Set(storeNodes.map((n) => n.id));
    return {
      onNavigateToType: callbacks?.onNavigateToType,
      onInspectType: callbacks?.onInspectType,
      allNodeIds,
      layoutDirection: activeLayout.direction ?? 'TB',
      pendingHydrationNamespaces
    };
  }, [
    activeLayout.direction,
    storeNodes,
    callbacks?.onNavigateToType,
    callbacks?.onInspectType,
    pendingHydrationNamespaces
  ]);

  // Node double-click handler
  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: TypeGraphNode | GroupContainerNodeType) => {
      if (isGroupContainerNode(node)) return;
      callbacks?.onNodeDoubleClick?.(node.id, node.data);
    },
    [callbacks]
  );

  // Imperative ref API — view operations only
  useImperativeHandle(
    ref,
    () => ({
      fitView(nodeId?: string) {
        runViewportAction({
          focusNodeId: nodeId,
          mode: nodeId ? 'fit-node' : 'fit-graph',
          fitOptions: nodeId ? undefined : { duration: 200 }
        });
      },

      focusNode(nodeId: string) {
        // Keep the public graph API accepting Rune qualified names even though
        // the internal graph key also carries declaration kind.
        const node = graphNodes.find((n) => n.id === nodeId || qualifiedNameFromNodeId(n.id) === nodeId);
        if (node) {
          emphasizeArrival(node.id);
          runViewportAction({
            focusNodeId: node.id,
            mode: 'center-and-fit-node'
          });
          // Programmatically select the target node in React Flow
          setNodes((prev) => {
            let changed = false;
            const next = prev.map((n) => {
              const isSelected = n.id === node.id;
              if ((n.selected ?? false) === isSelected) {
                return n;
              }
              changed = true;
              return {
                ...n,
                selected: isSelected
              };
            });
            return changed ? next : prev;
          });
        }
      },

      search(query: string): string[] {
        const results: string[] = [];
        if (!query.trim()) return results;
        const regex = new RegExp(query, 'i');
        for (const node of graphNodes) {
          if (regex.test(node.data.name)) {
            results.push(node.id);
          }
        }
        return results;
      },

      setFilters(filters: GraphFilters) {
        filtersRef.current = filters;
      },

      getFilters(): GraphFilters {
        return { ...filtersRef.current };
      },

      relayout(options?: LayoutOptions, focusNodeId?: string) {
        if (options?.engine) setRuntimeLayoutEngine(options.engine);
        return runViewportAction({
          relayout: true,
          layoutOptions: options ?? activeLayout,
          focusNodeId,
          mode: focusNodeId ? 'fit-node' : 'fit-graph'
        });
      },

      async exportImage(_format: 'svg' | 'png'): Promise<Blob> {
        // TODO: Implement with html-to-image
        return new Blob([''], { type: 'text/plain' });
      },

      exportRosetta(): Map<string, string> {
        const outputModels = modelsToAst(storeNodes, storeEdges);
        const result = new Map<string, string>();
        for (const model of outputModels) {
          try {
            result.set(model.name, renderModel(model));
          } catch {
            result.set(model.name, `// Error serializing ${model.name}`);
          }
        }
        callbacks?.onModelChanged?.(result);
        return result;
      },

      getNodeData(nodeId: string): AnyGraphNode | null {
        const node = selectNodeRepository(storeNodesById).byId(nodeId);
        return node?.data ?? null;
      },

      getNodes(): TypeGraphNode[] {
        return storeNodes;
      },

      validate(): ValidationError[] {
        return validateGraph(storeNodes, storeEdges);
      }
    }),
    [
      activeLayout,
      graphNodes,
      storeNodes,
      storeNodesById,
      storeEdges,
      runViewportAction,
      setNodes,
      callbacks,
      emphasizeArrival
    ]
  );

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: TypeGraphNode | GroupContainerNodeType) => {
    if (isGroupContainerNode(node)) return;
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, node });
  }, []);

  const handlePaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, node: null });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleLayoutEngineChange = useCallback(
    (engine: 'dagre' | 'elk') => {
      setRuntimeLayoutEngine(engine);
      callbacks?.onLayoutEngineChange?.(engine);
      runViewportAction({
        relayout: true,
        layoutOptions: {
          ...activeLayout,
          engine
        },
        mode: 'fit-graph'
      });
    },
    [activeLayout, callbacks, runViewportAction]
  );

  // Close context menu on pane click
  const handlePaneClick = useCallback(() => {
    setContextMenu(null);
    setHoveredNodeId(null);
    setHoveredEdgeId(null);
  }, []);

  const handleNodeMouseEnter = useCallback((_event: React.MouseEvent, node: TypeGraphNode | GroupContainerNodeType) => {
    if (node.type === 'groupContainer') return;
    setHoveredNodeId(node.id);
  }, []);

  const handleMove = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: { x: number; y: number; zoom: number }) => {
      setZoomLevel((prev) => (Math.abs(prev - viewport.zoom) > 0.02 ? viewport.zoom : prev));
    },
    []
  );

  const densityClass =
    zoomLevel < 0.58
      ? 'rune-type-graph--zoom-low'
      : zoomLevel < 0.86
        ? 'rune-type-graph--zoom-mid'
        : 'rune-type-graph--zoom-full';

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
  }, []);

  const handleEdgeMouseEnter = useCallback((_event: React.MouseEvent, edge: TypeGraphEdge) => {
    setHoveredEdgeId(edge.id);
  }, []);

  const handleEdgeMouseLeave = useCallback(() => {
    setHoveredEdgeId(null);
  }, []);

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: TypeGraphEdge) => {
      if (!edge.data) return;
      callbacks?.onEdgeSelect?.(edge.id, edge.data);
    },
    [callbacks]
  );

  const handleMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: { x: number; y: number; zoom: number }) => {
      try {
        const record: PersistedViewportRecord = { signature: viewportSignature, viewport };
        window.localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(record));
      } catch {
        /* storage unavailable */
      }
    },
    [viewportSignature]
  );

  return (
    <div className={cn('rune-type-graph', densityClass, className)} style={GRAPH_NODE_CSS_VARS as CSSProperties}>
      {breadcrumbItems.length > 0 && (
        <div className="rune-graph-breadcrumbs" aria-label="Graph navigation context">
          {breadcrumbItems.map((item, index) => (
            <span key={item.key} className="rune-graph-breadcrumbs__item">
              {index > 0 && <span className="rune-graph-breadcrumbs__sep">/</span>}
              <span>{item.label}</span>
            </span>
          ))}
        </div>
      )}
      <NavigationContext.Provider value={navigationCtx}>
        <ReactFlow<DisplayGraphNode, TypeGraphEdge>
          // Display nodes include synthetic group containers; domain nodes remain in the store.

          nodes={displayNodes}
          edges={displayEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onSelectionChange={handleSelectionChange}
          onNodeDoubleClick={handleNodeDoubleClick}
          onNodeContextMenu={handleNodeContextMenu}
          onNodeMouseEnter={handleNodeMouseEnter}
          onNodeMouseLeave={handleNodeMouseLeave}
          onEdgeMouseEnter={handleEdgeMouseEnter}
          onEdgeMouseLeave={handleEdgeMouseLeave}
          onEdgeClick={handleEdgeClick}
          onPaneContextMenu={handlePaneContextMenu}
          onPaneClick={handlePaneClick}
          onMove={handleMove}
          onMoveEnd={handleMoveEnd}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          onlyRenderVisibleElements
          // The default 0.5 floor cannot fit tall namespace graphs.
          minZoom={0.05}
          nodesDraggable={!mergedConfig.readOnly}
          nodesConnectable={!mergedConfig.readOnly}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
        >
          {mergedConfig.showControls && <Controls />}
          {mergedConfig.showMinimap && <MiniMap />}
          {mergedConfig.showLegend && (
            <Panel position="top-right" style={{ pointerEvents: 'none' }}>
              <GraphLegend />
            </Panel>
          )}
          {/* 22px gap matches the reference `.rs-canvas-grid` (and the former
              fixed CSS overlay, now removed so there is a single grid that pans
              with the canvas rather than two phasing against each other). */}
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
        </ReactFlow>
      </NavigationContext.Provider>
      <GraphContextMenu
        state={contextMenu}
        layoutEngine={runtimeLayoutEngine}
        onLayoutEngineChange={handleLayoutEngineChange}
        onClose={handleCloseContextMenu}
        onNavigate={callbacks?.onNavigateToType}
        onInspect={callbacks?.onInspectType}
      />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Public component (wraps with ReactFlowProvider)
// ---------------------------------------------------------------------------

export const RuneTypeGraph = forwardRef<RuneTypeGraphRef, RuneTypeGraphProps>(function RuneTypeGraph(props, ref) {
  return (
    <ReactFlowProvider>
      <RuneTypeGraphInner {...props} ref={ref} />
    </ReactFlowProvider>
  );
});
