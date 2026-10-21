// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * StructureView — assembles the Structure View by composing:
 *   - `buildStructureGraph`  (Phase 2 adapter)
 *   - `layoutStructureGraph` (Phase 3 layout)
 *   - React Flow for rendering the resulting nodes
 *
 * Renders an empty-state message when `focusedTypeId` or `adapterDoc` is absent.
 * Accepts an optional `cellComponents` prop (Phase 5/8) that is injected into the
 * data payload of `'data'`-typed nodes returned by layoutStructureGraph so that
 * DataNode's structure variant renders editable cells instead of plain spans.
 * Choice nodes (arms are type references, not attribute rows) and GroupContainerNode
 * (base-type wrap) do not participate in the cellComponents contract.
 *
 * @module
 */

import { useNavigationArrival, type NavigationArrival } from '../hooks/useNavigationArrival.js';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { indexById } from '@rune-langium/core';
import { ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';
import type { AdapterDocument } from '../adapters/structure-graph-adapter.js';
import { buildStructureGraph } from '../adapters/structure-graph-adapter.js';
import { layoutStructureGraph, STRUCTURE_LAYOUT_CSS_VARS } from '../layout/structure-layout.js';
import { nodeTypes } from './nodes/index.js';
import { NavigationContext } from './nodes/NavigationContext.js';
import { useTypeNavigationMenu } from './TypeNavigationMenu.js';
import type { MeasuredNodeWidths, StructureExpansionKey, StructureRow } from '../types/structure-view.js';
import { measureStructureNodeWidths } from './measure-structure-widths.js';
import type { RangeDiagnostic } from '../hooks/useDiagnosticsForRange.js';

/**
 * Compare two arrays element-wise. Falls back to a per-element equality
 * function (defaults to `Object.is`) — used for `rows` arrays where the
 * adapter emits fresh `StructureRow` arrays per pass but the individual
 * rows are simple records that should be compared structurally.
 */
/**
 * Stable per-document version numbers for the measure-then-layout key.
 * WeakMap lookup-or-assign is idempotent: the same document object always
 * maps to the same version, no matter how many times (or in which aborted
 * render) it is asked — making it safe to call during render, unlike a
 * mutable ref bump.
 */
const docVersions = new WeakMap<object, number>();
let nextDocVersion = 0;
function getDocVersion(doc: object): number {
  let v = docVersions.get(doc);
  if (v === undefined) {
    v = nextDocVersion++;
    docVersions.set(doc, v);
  }
  return v;
}

function arraysEqual<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>, eq: (x: T, y: T) => boolean = Object.is): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  // `.entries()` types `av` as `T`; `b[i]` is in-bounds because the lengths
  // were just checked equal (the `!` encodes that).
  for (const [i, av] of a.entries()) {
    if (!eq(av, b[i]!)) return false;
  }
  return true;
}

/**
 * Shallow equality of two records (string-keyed). Used for individual
 * `StructureRow` / `StructureChoiceArm` objects whose fields are MOSTLY
 * primitive but include one known nested object: `astRange: { start, end }`.
 *
 * The adapter rebuilds `astRange` per pass with fresh `{ start, end }` objects
 * even when the parsed values are unchanged, so an `Object.is` walk would
 * treat every row as "changed" and trigger the all-visible-node rerender
 * fan-out the Phase 14c fix is supposed to prevent. `astRange` is compared
 * structurally (start === start && end === end); everything else stays
 * `Object.is` (strict primitive equality).
 *
 * If a future row field adds another nested object, extend this comparator
 * the same way `node.data` is extended above.
 */
function shallowRecordEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    const av = ao[k];
    const bv = bo[k];
    if (Object.is(av, bv)) continue;
    if (k === 'astRange') {
      // `{ start, end }` — adapter rebuilds the object per pass; compare by value.
      if (!av || !bv || typeof av !== 'object' || typeof bv !== 'object') return false;
      const ar = av as { start?: unknown; end?: unknown };
      const br = bv as { start?: unknown; end?: unknown };
      if (!Object.is(ar.start, br.start) || !Object.is(ar.end, br.end)) return false;
      continue;
    }
    return false;
  }
  return true;
}

/**
 * Compare two `ReadonlyMap<string, V>` instances by content. Used for the
 * `expansions` map on `StructureDataNode`/`StructureChoiceNode`/
 * `StructureBaseContainer` (V=string) which is rebuilt each adapter pass
 * even when content is unchanged, and (visual-polish #11) for layout-
 * emitted `rowOffsets` / `childYByAttrName` maps (V=number) which the
 * layout rebuilds on every pass to feed the SVG connector overlay.
 */
function mapEqual<V>(a: ReadonlyMap<string, V>, b: ReadonlyMap<string, V>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}

/**
 * Structural equality for a Structure View `node.data` payload. Walks the
 * shape the adapter+layout produce (StructureDataNode | StructureChoiceNode |
 * StructureBaseContainer | StructureEnumNode plus the layout's wrappers:
 * `variant: 'structure'`, `instancePath: readonly string[]`, and the
 * StructureFlowInner-injected `cellComponents`, `expansionMap`, and
 * `onToggleExpansion`).
 *
 * Returns `true` when content is unchanged so the caller can preserve the
 * previous node reference. React Flow shallow-compares `node.data` for its
 * memo cache, so reference preservation lets the per-node memo skip
 * re-rendering unchanged DataNode/ChoiceNode/GroupContainerNode instances.
 *
 * Trade-off: this comparator is bespoke for the StructureView node shape.
 * It does NOT generalize to arbitrary `unknown` payloads. If a future
 * adapter adds a field to StructureNode (e.g. a new nested object), the
 * comparator falls through to `Object.is` for that field and the worst
 * case is more frequent identity changes (correctness preserved; perf
 * benefit regresses). Adding a field to the equality walk here is the
 * targeted follow-up when that happens.
 */
function shallowEqualData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    const av = ao[k];
    const bv = bo[k];
    if (Object.is(av, bv)) continue;
    // Special-case the known-nested fields the adapter+layout rebuild per
    // pass. Everything else falls through to Object.is (strict identity).
    if (k === 'rows' || k === 'baseRows' || k === 'options' || k === 'inputRows') {
      // Phase C: `inputRows` is a StructureFunctionNode's array of StructureRow
      // (same per-pass-rebuilt shape as `rows`), so compare it structurally too.
      if (!Array.isArray(av) || !Array.isArray(bv)) return false;
      if (!arraysEqual(av, bv, shallowRecordEqual)) return false;
      continue;
    }
    if (k === 'outputRow') {
      // Phase C: single StructureRow (or undefined); the adapter rebuilds it per
      // pass with a fresh astRange object, so compare by value via the same
      // record comparator the row arrays use.
      if (!shallowRecordEqual(av, bv)) return false;
      continue;
    }
    if (k === 'values') {
      // Enum value names: array of strings.
      if (!Array.isArray(av) || !Array.isArray(bv)) return false;
      if (!arraysEqual(av, bv, Object.is)) return false;
      continue;
    }
    // Phase A meta (definition / annotations / conditions). `projectStructureMeta`
    // rebuilds the annotations + conditions arrays on every adapter recompute, so
    // without a structural compare any metadata-bearing Data/Choice/Function node
    // would fail Object.is every pass and never reuse its React Flow node
    // reference — defeating the Phase-14c re-render limiter (PR #307 finding #3).
    if (k === 'definition') {
      // Plain string | undefined — value compare.
      if (av !== bv) return false;
      continue;
    }
    if (k === 'annotations') {
      // readonly string[] | undefined. Treat absent as empty so undefined ↔ [] is equal.
      const aa = (av ?? []) as readonly string[];
      const ba = (bv ?? []) as readonly string[];
      if (!Array.isArray(aa) || !Array.isArray(ba)) return false;
      if (!arraysEqual(aa, ba, Object.is)) return false;
      continue;
    }
    if (k === 'conditions') {
      // readonly { name, preview }[] | undefined — per-index field equality.
      const ac = (av ?? []) as ReadonlyArray<{ name: string; preview: string }>;
      const bc = (bv ?? []) as ReadonlyArray<{ name: string; preview: string }>;
      if (!Array.isArray(ac) || !Array.isArray(bc)) return false;
      if (!arraysEqual(ac, bc, (x, y) => x.name === y.name && x.preview === y.preview)) return false;
      continue;
    }
    if (k === 'expansions') {
      if (!(av instanceof Map) || !(bv instanceof Map)) return false;
      if (!mapEqual(av as ReadonlyMap<string, string>, bv as ReadonlyMap<string, string>)) return false;
      continue;
    }
    if (k === 'instancePath') {
      // Array of React Flow instance ids (strings).
      if (!Array.isArray(av) || !Array.isArray(bv)) return false;
      if (!arraysEqual(av, bv, Object.is)) return false;
      continue;
    }
    // Visual-polish #11 (PR #210): layout now threads `rowOffsets` and
    // `childYByAttrName` as fresh Map instances on every layout pass (the
    // SVG connector overlay reads them). Without an explicit content
    // comparison they'd fail Object.is on every pass and break the Phase
    // 14c perf invariant (≤1 DataNode re-render per content-equivalent
    // edit). Both maps are `Map<string, number>` so a generic mapEqual
    // walk suffices.
    if (k === 'rowOffsets' || k === 'childYByAttrName') {
      if (!(av instanceof Map) || !(bv instanceof Map)) return false;
      if (!mapEqual(av as ReadonlyMap<string, number>, bv as ReadonlyMap<string, number>)) return false;
      continue;
    }
    if (k === 'connectorGeometry') {
      // Plain `{ rowRightX: number; childLeftX: number }` — fresh object
      // per layout pass, so compare by value.
      if (!av || !bv || typeof av !== 'object' || typeof bv !== 'object') return false;
      const aco = av as { rowRightX: number; childLeftX: number };
      const bco = bv as { rowRightX: number; childLeftX: number };
      if (aco.rowRightX !== bco.rowRightX || aco.childLeftX !== bco.childLeftX) return false;
      continue;
    }
    return false;
  }
  return true;
}

/**
 * Identity-preserving merge of a fresh layout result into the previous
 * one (Phase 14c, Approach B). For each new node, if a previous node with
 * the same `id` exists AND its `data` payload is shallow-equal to the new
 * one, return the previous node object reference. Otherwise return the
 * new node as-is.
 *
 * React Flow shallow-compares `node.data` per node for memoization
 * decisions, so preserving the previous `data` reference where content
 * is unchanged stops the cascade where every keystroke re-renders every
 * visible DataNode.
 *
 * O(n) using a Map index over the previous nodes (no quadratic scan).
 */
function preserveNodeIdentities(prev: ReadonlyArray<Node>, next: ReadonlyArray<Node>): Node[] {
  if (prev.length === 0) return next as Node[];
  const prevById = indexById(prev);
  return next.map((n) => {
    const p = prevById.get(n.id);
    if (!p) return n;
    // Compare top-level fields React Flow inspects for re-render decisions.
    // Position changes legitimately mean layout moved; preserve identity
    // only when position + parent + extent + size + data all match.
    if (
      p.position.x !== n.position.x ||
      p.position.y !== n.position.y ||
      p.parentId !== n.parentId ||
      p.extent !== n.extent ||
      p.type !== n.type ||
      (p as { initialWidth?: number }).initialWidth !== (n as { initialWidth?: number }).initialWidth ||
      (p as { initialHeight?: number }).initialHeight !== (n as { initialHeight?: number }).initialHeight
    ) {
      return n;
    }
    return shallowEqualData(p.data, n.data) ? p : n;
  });
}

/** Shape injected into DataNode's structure-variant `data.cellComponents`. */
export interface StructureCellComponents {
  readonly name?: React.ComponentType<{ value: string; nodeId: string; attrName: string }>;
  readonly type?: React.ComponentType<{
    typeName: string;
    typeKind: StructureRow['typeKind'];
    nodeId: string;
    attrName: string;
  }>;
  readonly card?: React.ComponentType<{ value: string; nodeId: string; attrName: string }>;
}

export interface StructureViewProps {
  /** Increment for each indirect navigation; omit for direct selection or ordinary mounting. */
  readonly navigationRevision?: number;
  /** Canonical node id of the type to focus (e.g. `'cdm.trade.Trade'`). */
  readonly focusedTypeId: string | undefined;
  /** In-memory document representation produced by the studio's store adapter. */
  readonly adapterDoc: AdapterDocument | undefined;
  /** Expansion state; when undefined the view renders all nodes collapsed. */
  readonly expansionMap?: ReadonlyMap<string, boolean>;
  /**
   * Editable cell components for the structure variant of DataNode (Phase 5/8).
   * When provided, `name`, `type`, and `card` slots replace the read-only spans
   * in each attribute row. Memoize the object at the call site to avoid
   * prop-identity churn on every render.
   */
  readonly cellComponents?: StructureCellComponents;
  /**
   * Row-level expand/collapse handler (spec 020 Phase 13, Finding 1). When
   * provided, each Data/Choice-typed row in the rendered DataNode shows an
   * expansion chevron that calls this with the row's StructureExpansionKey.
   * Wire this to `useStructureViewStore.toggleExpansion` in the studio so
   * the click flips the relevant entry in `expansionMap`.
   */
  readonly onToggleExpansion?: (key: StructureExpansionKey) => void;
  /**
   * When `focusedTypeId` is undefined because the user selected a type whose
   * kind isn't supported in Structure View (Function / TypeAlias / Record /
   * Annotation), pass the selected type's name and kind here so the empty
   * state can render actionable guidance instead of the generic prompt
   * (e2e-batch fix #10). When the user has selected nothing or a supported
   * kind, leave this undefined.
   */
  readonly unsupportedSelectedType?: { name: string; kind: string };
  /**
   * Selection sync (e2e-batch fix #3): fired when the user clicks any node in
   * the rendered Structure tree. Receives the canonical type id (e.g.
   * `'cdm.trade.Trade'`) — NOT the per-instance React Flow node id, so the
   * receiver can write straight to a single `selectedNodeId` slice that the
   * Graph / Source / Inspector also read from. EditorPage wires this to
   * `useEditorStore.selectNode`.
   */
  readonly onNodeSelect?: (canonicalTypeId: string) => void;
  /**
   * Spec §8 / §3.3 — navigate-to-enum callback. When provided, rows whose
   * `typeKind === 'Enum'` (and arms in ChoiceNode) render an ↗ inspect button
   * that fires this callback with the enum's canonical type id (ns.Name
   * format). EditorPage wires this to set `focusedTypeId` on the structure
   * view, drilling into the enum's values.
   */
  readonly onNavigateToEnumType?: (typeId: string) => void;
  /** Reveal complete member details from a summarized card. */
  readonly onInspectType?: (typeId: string) => void;
  /**
   * Spec §3.4 — pre-converted LSP diagnostics for the focused file. Ranges
   * must be character offsets (not line/character), pre-converted by EditorPage
   * via a memoized lineOffsets array. DataNode uses `useDiagnosticsForRange`
   * to tint the left edge of rows with overlapping diagnostics. Pass a stable
   * empty array when no diagnostics are available.
   *
   * **astRange-threading gap:** in production today, `StructureRow.astRange`
   * is `undefined` because `graphNodesToAdapterDocument` doesn't derive it
   * from `$cstNode` before strip. The end-to-end wiring is real and tested
   * via synthetic astRange fixtures, but the severity class won't apply in
   * production until the upstream threading lands (deferred follow-up).
   */
  readonly structureDiagnostics?: readonly RangeDiagnostic[];
  /**
   * Namespaces currently being on-demand hydrated (see
   * `useEditorStore.pendingHydrationNamespaces`). Threaded into a
   * `NavigationContext.Provider` so structure-view nodes for deferred
   * placeholders show the same hydrating spinner as the main graph canvas.
   */
  readonly pendingHydrationNamespaces?: ReadonlyArray<string>;
}

const EMPTY_EXPANSION_MAP: ReadonlyMap<string, boolean> = new Map();
const EMPTY_PENDING_HYDRATION: ReadonlyArray<string> = [];
const EMPTY_ALL_NODE_IDS: Set<string> = new Set();

interface StructureFlowInnerProps {
  readonly consumedArrivalRef: React.RefObject<NavigationArrival | undefined>;
  readonly navigationRevision?: number;
  readonly focusedTypeId: string;
  readonly adapterDoc: AdapterDocument;
  readonly expansionMap: ReadonlyMap<string, boolean>;
  readonly cellComponents?: StructureCellComponents;
  readonly onToggleExpansion?: (key: StructureExpansionKey) => void;
  readonly onNodeSelect?: (canonicalTypeId: string) => void;
  readonly onNavigateToEnumType?: (typeId: string) => void;
  readonly onInspectType?: (typeId: string) => void;
  readonly structureDiagnostics?: readonly RangeDiagnostic[];
  readonly pendingHydrationNamespaces: ReadonlyArray<string>;
}

/**
 * Inner ReactFlow renderer — kept separate so the ReactFlowProvider wraps the
 * whole subtree without the empty-state check logic needing to know about it.
 */
function StructureFlowInner({
  consumedArrivalRef,
  focusedTypeId,
  navigationRevision,
  adapterDoc,
  expansionMap,
  cellComponents,
  onToggleExpansion,
  onNodeSelect,
  onNavigateToEnumType,
  onInspectType,
  structureDiagnostics,
  pendingHydrationNamespaces
}: StructureFlowInnerProps): React.ReactElement {
  // Phase 14c (Approach B): keep the previous useMemo result so we can
  // identity-preserve unchanged nodes across re-renders. React Flow shallow-
  // compares `node.data` per node for memoization; producing fresh object
  // identities every layout pass — which is what the adapter+layout+injection
  // stack does — busts that memo cache for every visible node, even when
  // the underlying content is unchanged. Preserving the previous node
  // reference where the data shallow-equals the new one limits the
  // re-render fan-out to the actually-changed nodes.
  const navigationMenu = useTypeNavigationMenu({ onNavigate: onNavigateToEnumType, onInspect: onInspectType });
  const prevNodesRef = useRef<ReadonlyArray<Node>>([]);

  // ── Measure-then-layout ────────────────────────────────────────────────
  // Pass 1 lays out with character-count estimates (positions must exist
  // before render). After commit, a layout effect measures each rendered
  // node's natural rows-column/header widths from the real DOM and re-runs
  // the layout with those measurements, so nodes hug their true content.
  //
  // `layoutKey` identifies one logical layout: measurements are only valid
  // for the doc/focus/expansion state they were taken from, so the key
  // gates both application (stale measurements are ignored) and reset.
  // Doc identity → version via module-level WeakMap (see getDocVersion):
  // a pure lookup-or-assign that is idempotent across renders, so it is
  // safe to call during render (no ref mutation, no phantom bumps under
  // StrictMode double-invoke or aborted concurrent renders).
  const [measured, setMeasured] = useState<{
    key: string;
    widths: ReadonlyMap<string, MeasuredNodeWidths>;
  } | null>(null);
  // Viewport culling (`onlyRenderVisibleElements`) must stay OFF until the
  // measurement pass has converged for the current layout: culled nodes are
  // never mounted, so they would keep their character-count estimates, and
  // nothing re-runs measurement when a pan/fitView later mounts them
  // (PR #472 review). Once measureStructureNodeWidths returns null (nothing
  // changed — every node measured within epsilon) for the current layoutKey,
  // all widths are real and culling is safe to enable.
  const [convergedKey, setConvergedKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const expansionSignature = useMemo(() => {
    const entries: string[] = [];
    for (const [k, v] of expansionMap) entries.push(`${k}=${v ? '1' : '0'}`);
    entries.sort();
    return entries.join('|');
  }, [expansionMap]);
  const layoutKey = `${getDocVersion(adapterDoc)}|${focusedTypeId}|${expansionSignature}`;
  // Only measurements taken under the CURRENT key participate in layout —
  // stale ones (older doc/focus/expansion) are ignored, not applied.
  const measuredWidths = measured && measured.key === layoutKey ? measured.widths : undefined;

  const { nodes, edges } = useMemo(() => {
    const input = buildStructureGraph(adapterDoc, {
      focusedTypeId,
      expansionMap
    });
    // layoutStructureGraph returns LayoutResult: { nodes: ReadonlyArray<Node>, edges: ReadonlyArray<Edge> }
    // where Node/Edge are from @xyflow/react. Spreading to mutable arrays satisfies ReactFlow's prop type.
    const result = layoutStructureGraph(measuredWidths ? { ...input, measuredWidths } : input);
    // Inject cellComponents AND row-expansion plumbing into the data payload of
    // 'data'-typed nodes so that DataNode's structure variant renders editable
    // cells and the per-row expand/collapse chevron (Finding 1).
    //
    // Phase 14e/B: 'choice' nodes now ALSO receive cellComponents +
    // expansionMap + onToggleExpansion. ChoiceNode's structure variant renders
    // a TypePickerCell per arm (drop target so the arm's type can be retyped)
    // AND an expansion chevron for arms whose target is Data or Choice. Arms
    // targeting terminal kinds (Enum / Builtin / Unresolved) render a spacer
    // for visual alignment but no chevron — there's no subtree to drill into.
    //
    // 'structureBase' nodes (GroupContainerNode base-type branch) also receive
    // expansionMap + onToggleExpansion so inherited Data/Choice rows can be
    // expanded/collapsed (Codex P2, PR #191). cellComponents is NOT injected —
    // base rows are read-only inherited rows; editable cells on base rows would
    // be a separate scope decision (spec §5 does not include inline-editing of
    // inherited attributes in Phase 13).
    const needsInjection =
      cellComponents !== undefined ||
      onToggleExpansion !== undefined ||
      onNavigateToEnumType !== undefined ||
      (structureDiagnostics !== undefined && structureDiagnostics.length > 0);
    const freshNodes: Node[] = needsInjection
      ? result.nodes.map((n) => {
          if (n.type === 'data')
            return {
              ...n,
              data: {
                ...n.data,
                cellComponents,
                expansionMap,
                onToggleExpansion,
                onNavigateToEnumType,
                structureDiagnostics
              }
            };
          if (n.type === 'choice')
            return {
              ...n,
              data: {
                ...n.data,
                cellComponents,
                expansionMap,
                onToggleExpansion,
                onNavigateToEnumType,
                structureDiagnostics
              }
            };
          if (n.type === 'structureBase') return { ...n, data: { ...n.data, expansionMap, onToggleExpansion } };
          return n;
        })
      : (result.nodes as Node[]);

    // Reuse previous node references where the new node's data is shallow-
    // equal to the previous one. This lets React Flow's per-node memo skip
    // re-rendering the unchanged DataNode/ChoiceNode/GroupContainerNode
    // instances even though the upstream layout produced a fresh array.
    //
    // NOTE: this useMemo READS prevNodesRef but does NOT write it. The write
    // happens in useLayoutEffect below — committing the cache only AFTER
    // React has committed the render. Mutating the ref inside useMemo would
    // be unsafe under concurrent rendering / StrictMode: an abandoned
    // render's "stable" output would poison the cache for the next attempt.
    const stableNodes = preserveNodeIdentities(prevNodesRef.current, freshNodes);
    return { nodes: stableNodes, edges: result.edges as Edge[] };
  }, [
    focusedTypeId,
    adapterDoc,
    expansionMap,
    cellComponents,
    onToggleExpansion,
    onNavigateToEnumType,
    structureDiagnostics,
    measuredWidths
  ]);

  // Commit the identity-preserving cache only after the render reaches
  // commit phase. Abandoned/discarded renders (StrictMode double-invoke,
  // concurrent priority preemption) never touch the cache.
  useLayoutEffect(() => {
    prevNodesRef.current = nodes;
  }, [nodes]);

  // Measurement pass — runs after every committed layout. Reads the natural
  // (max-content) widths of each rendered node's rows column and header and,
  // when they differ from what the current layout used, stores them so the
  // useMemo above re-runs the layout with real dimensions. Convergence:
  // measureStructureNodeWidths returns null when nothing new/changed was
  // found (the re-measured widths match within epsilon), which ends the
  // measure → re-layout → measure loop after one correction in practice.
  // Synchronous in useLayoutEffect, so the style mutations never paint.
  //
  // Hidden-host guard (PR #472 review): PerspectiveHost keeps Explore
  // mounted under `display:none`, so this effect can fire while the
  // container is hidden — every offsetWidth reads 0, the measurer returns
  // null, and we must NOT treat that as convergence. Skip instead, and use
  // a ResizeObserver to bump `visibilityTick` when the container gains
  // real dimensions again so the measurement pass re-runs on reveal.
  const [visibilityTick, setVisibilityTick] = useState(0);
  const [viewportTick, setViewportTick] = useState(0);
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    let active = true;
    const remeasure = () => {
      if (active) setVisibilityTick((tick) => tick + 1);
    };
    // Fixed node widths cannot observe the intrinsic growth when fallback
    // text is replaced by the loaded UI/monospace fonts.
    void fonts.ready.then(remeasure);
    fonts.addEventListener('loadingdone', remeasure);
    return () => {
      active = false;
      fonts.removeEventListener('loadingdone', remeasure);
    };
  }, []);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || nodes.length === 0) return;
    if (container.offsetWidth === 0 && container.offsetHeight === 0) return; // hidden — skip
    const next = measureStructureNodeWidths(container, measuredWidths);
    if (next) setMeasured({ key: layoutKey, widths: next });
    // null → converged: every rendered node's measured width matches the
    // layout input within epsilon. Safe to enable viewport culling now.
    else setConvergedKey(layoutKey);
  }, [nodes, layoutKey, measuredWidths, visibilityTick]);

  // Re-measure content only on reveal, but refit the camera after pane sizes
  // settle. Opening a companion pane changes the viewport without changing
  // any node geometry; retaining the old transform can leave the tree clipped.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    let width = container.offsetWidth;
    let height = container.offsetHeight;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let visibilityFrame: number | undefined;
    const ro = new ResizeObserver(() => {
      const nextWidth = container.offsetWidth;
      const nextHeight = container.offsetHeight;
      if (width === nextWidth && height === nextHeight) return;
      const wasHidden = width === 0 || height === 0;
      width = nextWidth;
      height = nextHeight;
      clearTimeout(resizeTimer);
      if (width === 0 || height === 0) return;
      if (wasHidden && visibilityFrame === undefined) {
        visibilityFrame = window.requestAnimationFrame(() => {
          visibilityFrame = undefined;
          if (container.offsetWidth > 0 && container.offsetHeight > 0) setVisibilityTick((t) => t + 1);
        });
      }
      resizeTimer = setTimeout(() => setViewportTick((t) => t + 1), 120);
    });
    ro.observe(container);
    return () => {
      clearTimeout(resizeTimer);
      if (visibilityFrame !== undefined) window.cancelAnimationFrame(visibilityFrame);
      ro.disconnect();
    };
  }, []);

  const { arrivalNodeId, emphasizeArrival, cancelArrival } = useNavigationArrival(consumedArrivalRef);
  useEffect(() => {
    if (navigationRevision !== undefined) emphasizeArrival(focusedTypeId, navigationRevision);
    return cancelArrival;
  }, [focusedTypeId, navigationRevision, emphasizeArrival, cancelArrival]);
  const arrivalNodes = useMemo(
    () =>
      nodes.map((node) =>
        node.id === arrivalNodeId
          ? { ...node, className: [node.className, 'rune-navigation-arrival'].filter(Boolean).join(' ') }
          : node
      ),
    [nodes, arrivalNodeId]
  );

  // Auto-fit on focus or expansion change. User feedback: when nodes are
  // expanded the structure tree grows past the viewport edge. Re-fitting
  // when the focused type changes OR the expansion content changes keeps
  // the whole tree on screen. `padding: 0.1` leaves a 10% margin;
  // `duration: 300` matches the node-chrome transition for visual
  // coherence.
  //
  // P2 review (PR #210): the dependency must capture content identity, not
  // just `expansionMap.size`. A "swap" change (collapse one branch and
  // expand another in the same render, or a model refresh that keeps the
  // entry count constant) leaves `.size` unchanged but moves the tree
  // geometry, leaving the newly expanded content outside the viewport
  // with no refit. The map's object reference is rebuilt every render
  // upstream, so depending on the Map directly would refit on every
  // render. A content hash of the sorted entries gives correct
  // same-count-swap detection without firing spuriously.
  //
  // Copilot review: `focusedTypeId` and `expansionMap` are non-optional
  // on StructureFlowInnerProps; the previous `if (!focusedTypeId) return`
  // and `expansionMap?.size` guards were dead.
  const rf = useReactFlow();
  useEffect(() => {
    if (nodes.length === 0) return;
    // requestAnimationFrame so the new node positions have been
    // committed before fitView reads them.
    const id = requestAnimationFrame(() => {
      rf.fitView({ padding: 0.1, duration: 300 });
    });
    return () => cancelAnimationFrame(id);
    // `measuredWidths` (P2 review): the measured re-layout changes node
    // positions without changing focus/expansion/count, so the refit must
    // follow the applied-measurement identity — but NOT raw `nodes`
    // reference churn (document edits would cause spurious camera moves).
  }, [focusedTypeId, expansionSignature, nodes.length, measuredWidths, viewportTick, rf]);

  const navigationCtx = useMemo(
    () => ({
      allNodeIds: EMPTY_ALL_NODE_IDS,
      onNavigateToType: onNavigateToEnumType,
      onInspectType,
      layoutDirection: 'TB' as const,
      pendingHydrationNamespaces
    }),
    [pendingHydrationNamespaces, onInspectType, onNavigateToEnumType]
  );

  return (
    <NavigationContext.Provider value={navigationCtx}>
      <div
        ref={containerRef}
        data-testid="structure-view-flow"
        style={{ width: '100%', height: '100%', minHeight: 0, ...STRUCTURE_LAYOUT_CSS_VARS }}
      >
        <ReactFlow
          nodes={arrivalNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          onlyRenderVisibleElements={convergedKey === layoutKey}
          proOptions={{ hideAttribution: true }}
          // e2e-batch fix #3: selection sync — clicking any node in the
          // Structure tree writes the OWNER type's canonical id to the shared
          // selection slice. We extract `node.data.id` (the canonical type id
          // stamped by the adapter, e.g. `cdm.trade.Trade`) rather than the
          // React Flow `node.id` (which carries the per-instance suffix like
          // `Trade::buyer::Party` and would not match the explorer / inspector
          // selection contract). Falls back to `node.id` when `data.id` is
          // missing so the click still produces a write.
          //
          // Codex P1 review: skip clicks on synthetic wrapper nodes
          // (`structureBase` — the GroupContainerNode renderer for base-type
          // wraps). Their `data.id` is the synthetic wrapper key like
          // `cdm.trade.Trade::__base::cdm.trade.TradeBase`, not a real
          // graph node id — writing it to selectedNodeId would put the cross-
          // pane sync into a no-such-node state. The base's actual selectable
          // contents (header → base type, child → derived type) are accessed
          // via clicking either of those nodes directly; the wrapper itself
          // doesn't represent a navigable selection target.
          onNodeContextMenu={(event, node) => {
            if (node.type === 'structureBase') return;
            navigationMenu.open(event, (node.data as { id?: string }).id);
          }}
          onNodeClick={(_, node) => {
            if (node.type === 'structureBase') return;
            const canonicalId = (node.data as { id?: string } | undefined)?.id ?? node.id;
            onNodeSelect?.(canonicalId);
          }}
        />
      </div>
      {navigationMenu.menu}
    </NavigationContext.Provider>
  );
}

/**
 * StructureView component.
 *
 * Shows the expanded structure graph for the focused type, with optional
 * editable cell components injected via `cellComponents`.  When
 * `focusedTypeId` or `adapterDoc` is missing an empty-state placeholder is
 * rendered instead.
 *
 * Stale-selection state is shown when `focusedTypeId` no longer resolves to
 * any node in `adapterDoc` (e.g. the type was renamed or deleted). Phase 14e/A
 * extends root rendering to Data, Choice, and Enum — only an unknown id falls
 * through to the unsupported-root branch.
 */
export function StructureView({
  focusedTypeId,
  navigationRevision,
  adapterDoc,
  expansionMap,
  cellComponents,
  onToggleExpansion,
  unsupportedSelectedType,
  onNodeSelect,
  onNavigateToEnumType,
  onInspectType,
  structureDiagnostics,
  pendingHydrationNamespaces
}: StructureViewProps): React.ReactElement {
  // A temporary data refresh remounts the inner flow without creating a new navigation.
  const consumedArrivalRef = useRef<NavigationArrival | undefined>(undefined);
  if (!focusedTypeId || !adapterDoc) {
    // e2e-batch fix (#10): distinguish "nothing selected" from "selected an
    // unsupported kind (Function / TypeAlias / Record / Annotation)" so the
    // user gets actionable guidance instead of the generic "Select a type"
    // prompt that doesn't explain why their click didn't open anything.
    if (unsupportedSelectedType) {
      // Copilot review: `kind` is non-optional on the prop type, so the
      // previous `?? 'non-structural'` fallback was dead. Drop it; if a
      // caller ever needs to omit `kind`, the right move is to relax the
      // prop type at the same time.
      return (
        <div
          data-testid="structure-unsupported-kind-state"
          className="flex h-full flex-col items-center justify-center gap-2 px-6 py-8 text-center text-sm text-muted-foreground"
        >
          <p>
            <strong className="text-foreground">{unsupportedSelectedType.name}</strong> is a{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{unsupportedSelectedType.kind}</code> type
            and is not supported in Structure View.
          </p>
          <p className="text-xs">Pick a Data, Choice, or Enum type from the Namespace Explorer to see its structure.</p>
        </div>
      );
    }
    return (
      <div
        data-testid="structure-empty-state"
        className="flex h-full items-center justify-center px-6 py-8 text-center text-sm text-muted-foreground"
      >
        Select a type from the Type explorer to view its structure.
      </div>
    );
  }

  // Detect stale selections upfront — cheaper than building+laying out an empty
  // graph and gives a precise, user-friendly message instead of a blank canvas.
  // Phase 14e/A: Data, Choice, and Enum roots all render; only an unknown id
  // (deleted/renamed type) reaches the unsupported branch.
  const rootNode = adapterDoc.nodes.find((n) => n.id === focusedTypeId);
  if (!rootNode) {
    return (
      <div
        data-testid="structure-unsupported-root-state"
        className="flex h-full items-center justify-center px-6 py-8 text-center text-sm text-muted-foreground"
      >
        The selected type is no longer available. Select a type from the Namespace Explorer.
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <StructureFlowInner
        consumedArrivalRef={consumedArrivalRef}
        focusedTypeId={focusedTypeId}
        navigationRevision={navigationRevision}
        adapterDoc={adapterDoc}
        expansionMap={expansionMap ?? EMPTY_EXPANSION_MAP}
        cellComponents={cellComponents}
        onToggleExpansion={onToggleExpansion}
        onNodeSelect={onNodeSelect}
        onNavigateToEnumType={onNavigateToEnumType}
        onInspectType={onInspectType}
        structureDiagnostics={structureDiagnostics}
        pendingHydrationNamespaces={pendingHydrationNamespaces ?? EMPTY_PENDING_HYDRATION}
      />
    </ReactFlowProvider>
  );
}
