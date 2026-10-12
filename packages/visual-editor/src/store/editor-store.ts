// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Zustand editor store for the Rune DSL visual editor.
 *
 * @remarks
 * Manages three categories of state:
 * - **Graph state** — `nodes`, `edges` (typed `@xyflow/react` node/edge objects)
 * - **UI state** — selection, search query/results, active filters, panel visibility
 * - **Domain state** — validated `ValidationError[]`, layout options, namespace visibility
 *
 * State mutations go through `EditorActions`. The store is wrapped with `zundo`
 * temporal middleware — undo/redo is tracked via `useTemporalStore`.
 *
 * The default export `useEditorStore` is a singleton store.
 * Use `createEditorStore()` to create an isolated store instance for embedding
 * multiple independent graph panels.
 *
 * @pitfalls
 * - Do NOT share a single `useEditorStore` instance between two mounted
 *   `RuneTypeGraph` components — they will fight over layout state and selection.
 *   Create a separate store per graph using `createEditorStore()`.
 * - `loadModels()` triggers a full Dagre layout on every call — do not call it
 *   inside a render function or on every keystroke.
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { NodeChange, EdgeChange } from '@xyflow/react';
import type {
  TypeGraphNode,
  TypeGraphEdge,
  GraphFilters,
  TypeKind,
  EdgeKind,
  ValidationError,
  EdgeData,
  LayoutOptions,
  LayoutEngine,
  VisibilityState,
  DomainNodeData,
  GraphNodeMeta
} from '../types.js';
// Merged type + ops namespaces: `Data` is both the interface type and the
// generated ops namespace (Data.addAttribute / Data.removeAttribute …),
// from the single core barrel. Imported as values so the namespace ops resolve.
import { Data, Choice, RosettaEnumeration, RosettaFunction, Annotation } from '@rune-langium/core';
import { indexById } from '@rune-langium/core';
import { RAW_DSL_TYPE } from '@rune-langium/codegen/rosetta';
import { astToModel } from '../adapters/ast-to-model.js';
import { computeLayout, clearLayoutCache } from '../layout/dagre-layout.js';
import { validateGraph } from '../validation/edit-validator.js';
import { AST_TYPE_TO_NODE_TYPE, NODE_TYPE_TO_AST_TYPE, formatCardinality } from '../adapters/model-helpers.js';
import type { TrackedState } from './history.js';
import { create as mutativeCreate } from 'mutative';
import type { Patches } from 'mutative';
import { reconcileParse, type GraphEditRecipe } from './edit-reconcile.js';
import {
  makeNodeId,
  makeEdgeId,
  parseEdgeId,
  toNodesById,
  toEdgesById,
  nodesFromMap,
  edgesFromMap,
  ensureMemberArray
} from './node-projection.js';
import { selectEdgeIndex } from './edge-index.js';
import { rewriteEdgeRefInNode, rewriteOwnRefs, renameRefValue } from './edge-ref-rewrite.js';
import {
  captureMetadataTarget as captureTarget,
  resolveMetadataTarget,
  readAtMetadataPath,
  getMetadataCapabilities,
  type InspectorMetadataActions
} from './metadata-target.js';
import {
  applyMetadataRecipe,
  validateMetadataCommand,
  createAnnotationDraft,
  createSynonymDraft,
  getMetadataItems
} from './metadata-ops.js';

// ---------------------------------------------------------------------------
// Cross-namespace type-ref disambiguation (spec 020 Phase 13, Finding 3)
// ---------------------------------------------------------------------------

/**
 * Build the canonical `$refText` for a type drop, qualifying with the
 * namespace iff any OTHER node in the current store has the same bare name
 * (would resolve ambiguously). Otherwise returns the bare name verbatim.
 *
 * `targetTypeId` must be the canonical id (`namespace.Name`) of the actual
 * drop target — caller is expected to have validated existence already.
 *
 * The qualified form matches the grammar's `QualifiedName` token shape used
 * by the source-drop path (see structure-graph-adapter.ts findNodeByName
 * comment): `<namespace>.<TypeName>`. Resolution in both the adapter and the
 * Langium grammar treats a `$refText` with dots as authoritatively qualified.
 */
export function disambiguateTypeRef(
  targetTypeId: string,
  targetTypeName: string,
  targetNamespace: string,
  allNodes: ReadonlyArray<TypeGraphNode>
): string {
  // Look for ANY other node (different id) sharing the same bare name.
  // We don't need to enumerate them — the existence of a single sibling
  // collision is enough to require qualification.
  for (const n of allNodes) {
    if (n.id === targetTypeId) continue;
    const nName = (n.data as { name?: string }).name;
    if (nName === targetTypeName) {
      return `${targetNamespace}.${targetTypeName}`;
    }
  }
  return targetTypeName;
}

/**
 * Resolve a target node id from a bare type name, preferring the SOURCE node's
 * namespace, then falls back to a bare-name scan for built-in/string types or
 * cross-namespace refs that have no node in the source namespace. Node ids
 * include declaration kind, while Rune type references do not, so this lookup
 * deliberately compares source-level identity rather than constructing an id.
 *
 * The fallback preserves the pre-repository linear-scan behavior exactly; the
 * namespace-qualified hit only changes resolution in the ambiguous
 * same-name-in-two-namespaces case (a correctness win, not a regression).
 */
function resolveTargetId(
  nodesById: ReadonlyMap<string, TypeGraphNode>,
  allNodes: ReadonlyArray<TypeGraphNode>,
  sourceNodeId: string,
  typeName: string
): string | undefined {
  const ns = nodesById.get(sourceNodeId)?.meta.namespace;
  const isTypeTarget = (node: TypeGraphNode) => node.data.$type !== 'RosettaFunction';
  if (ns) {
    const local = allNodes.find(
      (node) => isTypeTarget(node) && node.meta.namespace === ns && node.data.name === typeName
    );
    if (local) return local.id;
  }
  return allNodes.find((node) => isTypeTarget(node) && node.data.name === typeName)?.id;
}

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

/**
 * Snapshot of visual editor state tracked by the zustand store.
 *
 * @config
 * Read-only from outside the store — use `EditorActions` methods to mutate.
 * Accessible via `useEditorStore(selector)`.
 *
 * @category Visual Editor
 */
export interface EditorState {
  // --- Graph state ---
  nodes: TypeGraphNode[];
  edges: TypeGraphEdge[];
  /**
   * Canonical id→node index — the edit SUBSTRATE (Phase 3B). `nodes` above is a
   * derived render cache (invariant I1: `nodes === [...nodesById.values()]`).
   * Every source-affecting action writes this Map through a chokepoint
   * (`mutateGraph`/`updateGraphView`/`loadModels`); the post-undo `store.subscribe`
   * re-derives the arrays from the Maps after history restore.
   * Do NOT write the Maps ad-hoc from a new action — go through a chokepoint.
   */
  nodesById: Map<string, TypeGraphNode>;
  /**
   * Canonical id→edge index — the edit substrate (invariant I1:
   * `edges === [...edgesById.values()]`). See `nodesById` for the write contract.
   */
  edgesById: Map<string, TypeGraphEdge>;
  /**
   * Curated-bundle deferred-export entries, stored on the store so
   * `loadModels` can re-merge their placeholder graph nodes after
   * replacing `nodes` with new RosettaModel-derived nodes. Without this
   * state, every `loadModels` call (e.g. from EditorPage's linkDocument
   * callback) would silently lose the curated namespaces that
   * `loadDeferredExports` previously created.
   */
  deferredExports: DeferredExportEntry[];

  // --- UI state ---
  selectedNodeId: string | null;
  /** Rename-only identity change from the last explicit selection, preserved across model refreshes. */
  selectionRekey?: { from: string; to: string; intermediateIds?: string[] };
  searchQuery: string;
  searchResults: string[];
  activeFilters: GraphFilters;
  detailPanelOpen: boolean;
  validationErrors: ValidationError[];

  // --- Layout options ---
  layoutOptions: LayoutOptions;

  // --- Focus mode ---
  /** When true, selecting a node auto-isolates its focused cluster. */
  focusMode: boolean;
  /** Node kinds excluded from focus-mode related clusters (selected node is always retained). */
  focusRelatedExcludedKinds: Set<TypeKind>;

  // --- Namespace visibility ---
  visibility: VisibilityState;

  // --- On-demand curated hydration ---
  /**
   * Namespaces queued for server-side hydration. An App.tsx effect watches
   * this list and re-parses with `hydrateNamespaces` set to the cumulative
   * union of these + `hydratedNamespaces` so the worker receives the full
   * closure. Cleared by `markNamespacesHydrated` once the parse completes.
   */
  pendingHydrationNamespaces: string[];
  /**
   * Namespaces that have already been hydrated in the current session.
   * Used by `requestNamespaceHydration` to deduplicate requests and by the
   * App.tsx re-parse effect to build the cumulative `hydrateNamespaces` set
   * (replacement-semantics worker hydration requires sending the full set).
   */
  hydratedNamespaces: string[];
  /**
   * Monotonically-incrementing counter, bumped by `markNamespacesHydrated`
   * each time new AST content reaches the worker. Consumers (e.g.
   * ExplorePerspective) can react to this to re-link a selected node whose
   * initial link ran before the hydration round-trip completed.
   */
  hydrationNonce: number;
  /**
   * Monotonically-incrementing counter bumped ONLY when the graph is (re)built
   * from a parse result — i.e. inside `loadModels`. (`loadDeferredExports` is a
   * state-only stash that does NOT rebuild nodes, so it does not bump it.)
   * User-edit actions deliberately do NOT bump it.
   *
   * `useModelSourceSync` reads this to tell PARSE-origin `nodes`/`edges` changes
   * apart from USER-EDIT-origin ones: it only serializes the graph back to
   * source text when `parseEpoch` did NOT advance since the last emission.
   * Without this, a degraded reparse (worker unavailable → attributes stripped,
   * empty `errors`) would re-serialize the truncated graph over the real source
   * and corrupt the file. See `loadModels`' degraded-parse guard for the
   * complementary protection (rejecting a parse that shrinks the live graph).
   */
  parseEpoch: number;
  /**
   * Id-rooted Mutative patches for user edits that have NOT yet round-tripped
   * through a reparse. Captured by `mutateGraph` (semantic edit actions), replayed
   * by `loadModels` on top of each healthy parse so an edit made just before its
   * own reparse lands is not momentarily reverted, then pruned as the parse
   * catches up. See `edit-reconcile.ts` for the pure replay logic.
   *
   * Deliberately excluded from the zundo `partialize` set (`{nodes, edges}`), so
   * it is not part of undo history — patches track in-flight intent, not state.
   */
  pendingEditPatches: Patches;
  pendingInversePatches: Patches;
}

export interface DeferredExportEntry {
  filePath: string;
  namespace: string;
  exports: Array<{ type: string; name: string }>;
}

export interface EditorActions extends InspectorMetadataActions {
  // --- Data loading ---
  loadModels(models: unknown, layoutOpts?: LayoutOptions): void;
  /** Register deferred corpus types as graph nodes without full AST models. */
  loadDeferredExports(entries: DeferredExportEntry[]): void;

  // --- Navigation ---
  selectNode(nodeId: string | null, options?: { isolateInFocusMode?: boolean; reapplyFocusMode?: boolean }): void;
  setSearchQuery(query: string): void;
  setFilters(filters: GraphFilters): void;
  toggleDetailPanel(): void;

  // --- Layout ---
  relayout(options?: LayoutOptions): void;
  setLayoutEngine(engine: LayoutEngine): void;

  // --- Graph state access ---
  getNodes(): TypeGraphNode[];
  getEdges(): TypeGraphEdge[];

  // --- Namespace visibility ---
  toggleNamespace(namespace: string): void;
  toggleNodeVisibility(nodeId: string): void;
  expandAllNamespaces(): void;
  collapseAllNamespaces(): void;
  setInitialVisibility(totalNodeCount: number): void;
  toggleExplorer(): void;
  getVisibleNodes(): TypeGraphNode[];
  getVisibleEdges(): TypeGraphEdge[];

  // --- Kind-based visibility ---
  toggleNodeKind(kind: TypeKind): void;
  toggleEdgeKind(kind: EdgeKind): void;
  showAllNodeKinds(): void;
  showAllEdgeKinds(): void;

  // --- Isolation / focus ---
  /** Hide all nodes except the given node's focused cluster. */
  isolateNode(nodeId: string): void;
  /** Unhide a node's focused cluster (expand their namespaces too). */
  revealNeighbors(nodeId: string): void;
  /** Hide all nodes except the given set. */
  showOnly(nodeIds: Set<string>): void;
  /** Unhide all nodes (reset hiddenNodeIds). */
  showAllNodes(): void;
  /** Toggle focus mode (auto-isolate selected node + neighbors). */
  toggleFocusMode(): void;
  /** Toggle exclusion of a node kind from focus-mode related clusters. */
  toggleFocusRelatedExcludedKind(kind: TypeKind): void;

  // --- Editing (P2) ---
  createType(kind: TypeKind, name: string, namespace: string): string;
  deleteType(nodeId: string): void;
  renameType(nodeId: string, newName: string): void;
  addAttribute(nodeId: string, attrName: string, typeName: string, cardinality: string): void;
  removeAttribute(nodeId: string, attrName: string): void;
  renameAttribute(nodeId: string, oldName: string, newName: string): void;
  /**
   * Update the type ref on an attribute.
   *
   * @param targetTypeId Canonical node id of the resolved target
   *   (`namespace.Name`). The store validates the id against current nodes
   *   and writes a fully-qualified `$refText` when any other node shares the
   *   bare name across namespaces (spec 020 Phase 13, Finding 3).
   *   Stale or unknown ids are rejected (no-op).
   */
  updateAttributeType(nodeId: string, attrName: string, newTypeName: string, targetTypeId: string): void;
  updateAttribute(nodeId: string, oldName: string, newName: string, typeName: string, cardinality: string): void;
  reorderAttribute(nodeId: string, fromIndex: number, toIndex: number): void;
  updateCardinality(nodeId: string, attrName: string, cardinality: string): void;
  setInheritance(childId: string, parentId: string | null): void;
  validate(): ValidationError[];

  // --- Enum operations ---
  addEnumValue(nodeId: string, valueName: string, displayName?: string): void;
  removeEnumValue(nodeId: string, valueName: string): void;
  updateEnumValue(nodeId: string, oldName: string, newName: string, displayName?: string): void;
  reorderEnumValue(nodeId: string, fromIndex: number, toIndex: number): void;
  addEnumValueSynonym(nodeId: string, valueIndex: number, source: string, value: string): void;
  removeEnumValueSynonym(nodeId: string, valueIndex: number, synIndex: number): void;
  setEnumParent(nodeId: string, parentId: string | null): void;

  // --- Choice operations ---
  addChoiceOption(nodeId: string, typeName: string): void;
  removeChoiceOption(nodeId: string, typeName: string): void;

  // --- Function operations ---
  addInputParam(nodeId: string, paramName: string, typeName: string): void;
  removeInputParam(nodeId: string, paramName: string): void;
  /**
   * Update name, type, and cardinality for a function input parameter.
   *
   * @param targetTypeId Canonical node id of the resolved target
   *   (`namespace.Name`). Mirrors `updateAttributeType`'s qualification
   *   contract: when provided, the store calls `disambiguateTypeRef` and
   *   writes a fully-qualified `$refText` when another node shares the bare
   *   name across namespaces. When omitted (or unknown), the bare `typeName`
   *   is written as before (backward-compatible).
   */
  updateInputParam(
    nodeId: string,
    oldName: string,
    newName: string,
    typeName: string,
    cardinality: string,
    targetTypeId?: string
  ): void;
  reorderInputParam(nodeId: string, fromIndex: number, toIndex: number): void;
  updateOutputType(nodeId: string, typeName: string): void;
  /** Set (or clear, with `null`) a Function's `superFunction` parent reference. */
  setFunctionParent(nodeId: string, parentId: string | null): void;
  updateTypeAliasType(nodeId: string, typeName: string): void;
  updateExpression(nodeId: string, expressionText: string, operationIndex?: number): void;

  // --- Condition operations ---
  addCondition(
    nodeId: string,
    condition: {
      name?: string;
      definition?: string;
      expressionText: string;
      isPostCondition?: boolean;
    }
  ): void;
  removeCondition(nodeId: string, index: number): void;
  updateCondition(
    nodeId: string,
    index: number,
    updates: {
      name?: string;
      definition?: string;
      expressionText?: string;
    }
  ): void;
  reorderCondition(nodeId: string, fromIndex: number, toIndex: number): void;

  // --- Metadata operations ---
  updateDefinition(nodeId: string, definition: string): void;
  updateComments(nodeId: string, comments: string): void;
  addSynonym(nodeId: string, source: string, value?: string): void;
  removeSynonym(nodeId: string, index: number): void;

  // --- Annotation operations ---
  addAnnotation(nodeId: string, annotationName: string): void;
  removeAnnotation(nodeId: string, index: number): void;

  // --- ReactFlow integration ---
  applyReactFlowNodeChanges(changes: NodeChange<TypeGraphNode>[]): void;
  applyReactFlowEdgeChanges(changes: EdgeChange<TypeGraphEdge>[]): void;

  // --- On-demand curated hydration ---
  /**
   * Queue a namespace for server-side hydration. No-op if the namespace is
   * already hydrated or already pending. The App.tsx effect watches
   * `pendingHydrationNamespaces` and re-parses when this list is non-empty.
   */
  requestNamespaceHydration(ns: string): void;
  /**
   * Mark a set of namespaces as successfully hydrated: move them from
   * `pendingHydrationNamespaces` to `hydratedNamespaces`. Called by the
   * App.tsx effect after `applyParseResult` returns. Also increments
   * `hydrationNonce` so effects that depend on it (e.g. the re-link
   * effect in ExplorePerspective) can react to the new AST being live.
   */
  markNamespacesHydrated(names: string[]): void;
  /**
   * Namespaces that must be sent on EVERY parse (replacement-semantics
   * worker): confirmed-hydrated plus in-flight pending, so a concurrent
   * reparse can't evict a namespace mid-hydration.
   */
  activeHydrationNamespaces(): string[];
  /** Remove namespaces from the pending queue WITHOUT marking them hydrated —
   *  used when an on-demand hydration parse fails, so re-selecting re-queues. */
  dequeuePendingHydration(names: string[]): void;
  /**
   * Clear all hydration state. Called on workspace switch so stale browsed-
   * namespace names from the previous workspace don't carry over into the new
   * one (the on-demand effect won't re-fire for names already in
   * `hydratedNamespaces`, so they must be cleared on workspace load).
   */
  resetHydration(): void;
}

const INHERITANCE_EDGE_KINDS = new Set<EdgeKind>(['extends', 'enum-extends']);

function isInheritanceEdgeKind(kind: EdgeKind | undefined): boolean {
  return kind !== undefined && INHERITANCE_EDGE_KINDS.has(kind);
}

function getEdgeKind(edge: TypeGraphEdge): EdgeKind | undefined {
  return edge.data?.kind;
}

function buildNodeMap(nodes: TypeGraphNode[]): Map<string, TypeGraphNode> {
  return toNodesById(nodes);
}

/**
 * Build placeholder TypeGraphNodes for deferred-export entries whose
 * full RosettaModel hasn't been materialized yet. Both `loadModels`
 * (post-replace merge) and `loadDeferredExports` (direct insert) share
 * this — keeps the placeholder shape in one place so a change to
 * `DomainNodeData`'s required fields only happens once.
 *
 * Mutates `existingIds` by adding each newly-emitted node's id so
 * callers can use the same set to track de-duplication across
 * subsequent operations.
 */
function buildDeferredPlaceholderNodes(entries: DeferredExportEntry[], existingIds: Set<string>): TypeGraphNode[] {
  const out: TypeGraphNode[] = [];
  for (const entry of entries) {
    for (const exp of entry.exports) {
      // Only create graph nodes for top-level element kinds. Enum values
      // are index-only (for cross-file reference resolution).
      if (!(exp.type in AST_TYPE_TO_NODE_TYPE)) continue;
      const nodeType = AST_TYPE_TO_NODE_TYPE[exp.type]!;
      const nodeId = makeNodeId(entry.namespace, exp.name, exp.type);
      if (existingIds.has(nodeId)) continue;
      existingIds.add(nodeId);
      // Placeholder `data` is a minimal domain stub ($type + name only);
      // ALL UI/editor metadata (incl. `deferred: true`) lives on `meta`.
      const meta: GraphNodeMeta = {
        namespace: entry.namespace,
        errors: [],
        isReadOnly: true,
        hasExternalRefs: false,
        deferred: true
      };
      out.push({
        id: nodeId,
        type: nodeType,
        position: { x: 0, y: 0 },
        data: { $type: exp.type, name: exp.name } as unknown as TypeGraphNode['data'],
        meta
      });
    }
  }
  return out;
}

function collectFocusClusterNodeIds(
  nodeId: string,
  edges: TypeGraphEdge[],
  nodeMap: Map<string, TypeGraphNode>,
  excludedKinds: Set<TypeKind>
): Set<string> {
  const focusNodeIds = new Set<string>([nodeId]);
  const parentStack = [nodeId];

  while (parentStack.length > 0) {
    const currentId = parentStack.pop()!;
    for (const edge of edges) {
      if (!isInheritanceEdgeKind(getEdgeKind(edge)) || edge.source !== currentId) continue;
      if (focusNodeIds.has(edge.target)) continue;
      focusNodeIds.add(edge.target);
      parentStack.push(edge.target);
    }
  }

  for (const edge of edges) {
    const kind = getEdgeKind(edge);
    if (isInheritanceEdgeKind(kind)) continue;
    if (edge.source === nodeId) focusNodeIds.add(edge.target);
    if (edge.target === nodeId) focusNodeIds.add(edge.source);
  }

  if (excludedKinds.size > 0) {
    for (const id of Array.from(focusNodeIds)) {
      if (id === nodeId) continue;
      const node = nodeMap.get(id);
      if (!node) continue;
      if (excludedKinds.has(node.type as TypeKind)) {
        focusNodeIds.delete(id);
      }
    }
  }

  return focusNodeIds;
}

/**
 * Combined zustand store type (state + actions).
 *
 * @remarks
 * Use the `useEditorStore` hook to subscribe to this store in React components,
 * or `createEditorStore()` to create an isolated instance.
 *
 * @category Visual Editor
 */
export type EditorStore = EditorState & EditorActions;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nodeCounter = 0;

/** Sequence counter to cancel in-flight progressive namespace expansion. */
let expandSeq = 0;

function parseCardinalityString(card: string): { inf: number; sup?: number; unbounded: boolean } {
  const match = card.match(/\(?(\d+)\.\.(\*|\d+)\)?/);
  if (!match) return { inf: 1, sup: 1, unbounded: false };
  const inf = parseInt(match[1]!, 10);
  if (match[2] === '*') return { inf, unbounded: true };
  const sup = parseInt(match[2]!, 10);
  return { inf, sup, unbounded: false };
}

function formatCardinalityString(card: string): string {
  // Normalize to (inf..sup) format
  if (card.startsWith('(') && card.endsWith(')')) {
    return card;
  }
  return `(${card})`;
}

/**
 * Move `arr[fromIndex]` to `toIndex`, mutating in place. Returns false (no-op)
 * when `fromIndex` is out of range — a negative index would otherwise splice
 * from the END and move the wrong element. `toIndex` follows native splice
 * semantics (a value >= length inserts at the end; a negative value counts back
 * from the end — NOT clamped to 0); callers pass in-range drag-drop indices.
 * Shared by the reorder* actions so the bounds guard can't drift between them.
 */
function reorderInPlace<T>(arr: T[], fromIndex: number, toIndex: number): boolean {
  if (fromIndex < 0 || fromIndex >= arr.length) return false;
  const moved = arr.splice(fromIndex, 1)[0]!; // guard guarantees a defined element
  arr.splice(toIndex, 0, moved);
  return true;
}

// ---------------------------------------------------------------------------
// buildNewTypeNode — DRY helper for createType
// ---------------------------------------------------------------------------

/**
 * Build a minimal TypeGraphNode shell for a newly-created type.
 * Extracted from createType so the same shape is reused without duplication.
 * The `counter` value is the already-incremented nodeCounter at call time.
 */
function buildNewTypeNode(kind: TypeKind, name: string, namespace: string, counter: number): TypeGraphNode {
  const $type = NODE_TYPE_TO_AST_TYPE[kind] ?? 'Data';
  // `data` is the pure domain payload; UI/editor metadata lives on `meta` only.
  const meta: GraphNodeMeta = {
    namespace,
    errors: [],
    hasExternalRefs: false
  };
  const baseData: Record<string, unknown> = {
    $type,
    name,
    definition: undefined,
    annotations: [],
    synonyms: []
  };
  switch ($type) {
    case 'Data':
      baseData.attributes = [];
      baseData.conditions = [];
      break;
    case 'Choice':
      baseData.attributes = [];
      break;
    case 'RosettaEnumeration':
      baseData.enumValues = [];
      break;
    case 'RosettaFunction':
      baseData.inputs = [];
      baseData.conditions = [];
      baseData.postConditions = [];
      baseData.operations = [];
      baseData.shortcuts = [];
      break;
    case 'RosettaRecordType':
      baseData.features = [];
      break;
    case 'Annotation':
      baseData.attributes = [];
      break;
  }
  return {
    id: makeNodeId(namespace, name, $type),
    type: kind,
    position: { x: counter * 50, y: counter * 50 },
    data: baseData as unknown as DomainNodeData,
    meta
  };
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

/** Threshold above which namespaces start collapsed for performance. */
const LARGE_MODEL_THRESHOLD = 100;

/** All node kinds — default visibility. */
const ALL_NODE_KINDS = new Set<TypeKind>([
  'data',
  'choice',
  'enum',
  'func',
  'record',
  'typeAlias',
  'basicType',
  'annotation'
]);

/** All edge kinds — default visibility. */
const ALL_EDGE_KINDS = new Set<EdgeKind>([
  'extends',
  'attribute-ref',
  'choice-option',
  'enum-extends',
  'type-alias-ref'
]);

/** Number of source attributes carried by a graph node (0 for non-attributed kinds). */
function nodeAttributeCount(n: TypeGraphNode): number {
  const d = n.data as { attributes?: unknown };
  return Array.isArray(d.attributes) ? d.attributes.length : 0;
}

/**
 * Detect a DEGRADED reparse — one that strips source content from the live
 * graph, the symptom of the parse worker being unavailable (types still parse
 * but their attributes come back empty, with no `errors`). Applying such a
 * result would let `useModelSourceSync` re-serialize the truncated graph over
 * the real source and corrupt it.
 *
 * Compared against the CURRENT store nodes (not a frozen baseline) so a
 * legitimate user deletion is NOT flagged: after a delete the live graph
 * already reflects it, and the reparse of the saved source matches → ratio ≈ 1.
 * Only nodes present in BOTH are compared, so hydration that ADDS nodes never
 * trips it. Uses a collective-ratio test (not per-node) so a single-attribute
 * delete (drop of 1 out of many) stays well above the threshold, while a
 * worker-down strip (most attributes → 0) falls below it.
 *
 * Deliberately a RATIO test, not a total-wipe test: distinguishing a worker-down
 * strip from a legitimate "clear all attributes" source edit is impossible from
 * content alone (both yield the same node ids with zero attributes), and a
 * total-wipe rejecter would wedge the graph on a real multi-type source clear.
 * The ratio test therefore only catches degradation of models with enough
 * attributes (currentTotal >= 3) to be statistically implausible as a user edit;
 * a robust fix for the small-model residual needs a real parse-worker health
 * signal, which the parse pipeline does not currently expose. The parseEpoch gate
 * still suppresses the immediate write-back in the residual case.
 */
export function isDegradedReparse(incoming: TypeGraphNode[], current: TypeGraphNode[]): boolean {
  if (current.length === 0) return false; // no baseline (initial load) → accept
  const incomingById = indexById(incoming);
  let currentTotal = 0;
  let incomingTotal = 0;
  let common = 0;
  for (const cur of current) {
    const inc = incomingById.get(cur.id);
    if (!inc) continue; // missing node may be a legit delete — don't judge it here
    common++;
    currentTotal += nodeAttributeCount(cur);
    incomingTotal += nodeAttributeCount(inc);
  }
  // Need a meaningful attributed baseline before judging (avoids false positives
  // on tiny / attribute-light graphs, and avoids wedging on legit source clears).
  if (common === 0 || currentTotal < 3) return false;
  // Degraded when the shared nodes collectively lost more than half their
  // attributes — a single user edit can't plausibly do that, a worker-down
  // strip always does.
  return incomingTotal < currentTotal * 0.5;
}

/**
 * Extra state a graph chokepoint caller may set alongside a mutation — never the
 * graph substrate (`nodes`/`edges`/`nodesById`/`edgesById`) nor the patch/epoch
 * fields, which the chokepoint owns. Excluding them keeps I1/I2 structurally
 * enforced: a caller's `extra` cannot override the derived caches or the Maps,
 * append/clobber patches, or bump `parseEpoch`.
 */
type GraphMutationExtra = Omit<
  Partial<EditorState>,
  'nodes' | 'edges' | 'nodesById' | 'edgesById' | 'pendingEditPatches' | 'pendingInversePatches' | 'parseEpoch'
>;

/**
 * Apply a semantic graph edit DIRECTLY on the persistent state Maps, capturing
 * id-rooted Mutative patches as pending user intent.
 *
 * Phase 3B Task 3 chokepoint. Operates on `nodesById`/`edgesById` (the canonical
 * edit substrate) rather than projecting maps from arrays each call. The recipe
 * draft uses `nodes`/`edges` key names (matching `GraphDraft`) so:
 *   • all 6 recipe bodies are UNCHANGED (they already mutate draft.nodes/draft.edges),
 *   • patches are id-rooted at `nodes`/`edges` — identical shape to `commitEdit`,
 *     so `reconcileParse` (Task 4) and all reconcile tests stay valid.
 *
 * @param set   The store set from createEditorStore closure.
 * @param get   Store getter.
 * @param recipe Mutative recipe operating on `{ nodes: Map, edges: Map }`.
 * @param extra  Optional additional state to merge (e.g. selectedNodeId changes).
 */
function mutateGraph(
  set: (partial: Partial<EditorState>) => void,
  get: () => EditorState,
  recipe: GraphEditRecipe,
  extra?: GraphMutationExtra
): void {
  const { nodesById, edgesById, pendingEditPatches, pendingInversePatches } = get();
  const [next, patches, inversePatches] = mutativeCreate({ nodes: nodesById, edges: edgesById }, recipe, {
    enablePatches: true
  });
  if (patches.length === 0 && !extra) return; // no-op recipe — leave state untouched
  set({
    nodesById: next.nodes,
    edgesById: next.edges,
    nodes: nodesFromMap(next.nodes), // re-derive array caches from updated Maps
    edges: edgesFromMap(next.edges),
    pendingEditPatches: patches.length > 0 ? [...pendingEditPatches, ...patches] : pendingEditPatches,
    pendingInversePatches:
      inversePatches.length > 0 ? [...pendingInversePatches, ...inversePatches] : pendingInversePatches,
    ...extra
  });
}

/**
 * View-only update chokepoint (Phase 3B, Task 5).
 *
 * Writes nodes/edges arrays + re-derived Maps, but NEVER captures patches
 * (pendingEditPatches) and NEVER bumps parseEpoch.
 *
 * INVARIANT I2: position/layout is VIEW state, not a source edit. The
 * `relayout`, `setLayoutEngine`, `applyReactFlowNodeChanges`, and
 * `applyReactFlowEdgeChanges` actions route through here to keep Maps canonical.
 *
 * DEVIATION FROM PLAN'S RECIPE FORM: RF's `applyNodeChanges` and Dagre's
 * `computeLayout` are array-centric — they consume and produce nodes/edges
 * arrays, not Maps. Re-expressing them as Mutative Map recipes would require
 * reimplementing `applyNodeChanges`'s batched change semantics. We accept
 * array inputs here and rebuild the Maps from the result instead.
 *
 * @param set   The store set from createEditorStore closure.
 * @param get   Store getter.
 * @param view  New nodes and/or edges arrays (either or both may be omitted to
 *              keep the current value).
 * @param extra Optional additional state to merge (e.g. layoutOptions).
 *              Must NOT include pendingEditPatches or parseEpoch.
 */
function updateGraphView(
  set: (partial: Partial<EditorState>) => void,
  get: () => EditorState,
  view: { nodes?: TypeGraphNode[]; edges?: TypeGraphEdge[] },
  extra?: GraphMutationExtra
): void {
  const nextNodes = view.nodes ?? get().nodes;
  const nextEdges = view.edges ?? get().edges;
  set({
    nodes: nextNodes,
    edges: nextEdges,
    nodesById: toNodesById(nextNodes),
    edgesById: toEdgesById(nextEdges),
    ...extra
    // NO pendingEditPatches, NO parseEpoch
  });
}

const initialState: EditorState = {
  nodes: [],
  edges: [],
  nodesById: new Map<string, TypeGraphNode>(),
  edgesById: new Map<string, TypeGraphEdge>(),
  deferredExports: [],
  selectedNodeId: null,
  searchQuery: '',
  searchResults: [],
  activeFilters: {},
  detailPanelOpen: false,
  validationErrors: [],
  layoutOptions: { direction: 'LR', nodeSeparation: 50, rankSeparation: 100, engine: 'dagre' },
  focusMode: true,
  focusRelatedExcludedKinds: new Set<TypeKind>(['basicType']),
  visibility: {
    expandedNamespaces: new Set<string>(),
    hiddenNodeIds: new Set<string>(),
    explorerOpen: true,
    visibleNodeKinds: new Set(ALL_NODE_KINDS),
    visibleEdgeKinds: new Set(ALL_EDGE_KINDS)
  },
  pendingHydrationNamespaces: [],
  hydratedNamespaces: [],
  hydrationNonce: 0,
  parseEpoch: 0,
  pendingEditPatches: [],
  pendingInversePatches: []
};

// ---------------------------------------------------------------------------
// Store creation
// ---------------------------------------------------------------------------

/**
 * Create an isolated zustand editor store instance.
 *
 * @remarks
 * Returns a new zustand `useStore` hook bound to a fresh store instance.
 * Use this when embedding multiple independent `RuneTypeGraph` components
 * in the same React tree — each graph must own a separate store.
 *
 * The store is wrapped with `zundo` temporal middleware for undo/redo support.
 * Access undo/redo via `useTemporalStore`.
 *
 * @useWhen
 * - Rendering two or more `RuneTypeGraph` components simultaneously (different
 *   namespaces, split-pane editors, etc.)
 * - Writing tests that need an isolated store per test case
 *
 * @avoidWhen
 * - You only need a single graph — use the pre-created `useEditorStore` singleton.
 *
 * @pitfalls
 * - Each `createEditorStore()` call allocates a new Zustand store + Zundo temporal
 *   tracker. Do NOT call this inside a render function — call once at module level
 *   or in a `useState` initializer.
 *
 * @param overrides - Optional partial initial state to override defaults.
 * @returns A zustand `useStore` hook bound to the new isolated store.
 *
 * @category Visual Editor
 */
export const createEditorStore = (overrides?: Partial<EditorState>) => {
  const store = create<EditorStore>()(
    temporal(
      (set, get) => {
        // All 34 source-affecting actions now route through mutateGraph /
        // updateGraphView / loadModels — the chokepoints set BOTH Maps and
        // arrays explicitly in every write. The transitional set-interceptor
        // (Phase 3B Task 2) that re-derived Maps from arrays is retired here
        // (Phase 3C Task 8). The post-undo subscribe below handles the only
        // remaining case where Maps and arrays diverge (zundo undo/redo restores
        // Maps via userSet, bypassing the creator's set).

        return {
          ...initialState,
          ...overrides,

          // -----------------------------------------------------------------------
          // Data loading
          // -----------------------------------------------------------------------

          loadModels(models, layoutOpts) {
            // Clear layout cache on full model reload
            clearLayoutCache();

            const opts = layoutOpts ?? get().layoutOptions;
            const filters = get().activeFilters;
            const { nodes: rawNodes, edges } = astToModel(models, { filters });

            // Merge deferred-export placeholder nodes for curated namespaces
            // that haven't been materialized yet. This is the atomic version
            // of "loadModels then loadDeferredExports" — keeps the API
            // single-call so callers can't forget the merge step. Existing
            // ids win (placeholders don't duplicate a now-materialized node).
            const existingIds = new Set(rawNodes.map((n) => n.id));
            const placeholders = buildDeferredPlaceholderNodes(get().deferredExports, existingIds);
            const mergedNodes: TypeGraphNode[] = placeholders.length > 0 ? [...rawNodes, ...placeholders] : rawNodes;

            // Determine initial visibility based on model size
            const allNamespaces = new Set(mergedNodes.map((n) => n.meta.namespace));
            const shouldCollapse = mergedNodes.length > LARGE_MODEL_THRESHOLD;

            const expandedNamespaces = shouldCollapse ? new Set<string>() : new Set(allNamespaces);

            // Lay out the visible nodes so the graph renders in position
            // form. Previous code stored the layout result on an unused
            // local — review caught the wasted compute. Use the laid-out
            // nodes when available; fall back to mergedNodes when
            // shouldCollapse is true (large workspace: no layout yet).
            const visibleNodes = shouldCollapse ? [] : mergedNodes;
            const visibleEdges = shouldCollapse ? [] : edges;
            const laidOutNodes =
              visibleNodes.length > 0 ? computeLayout(visibleNodes, visibleEdges, opts) : mergedNodes;

            // Preserve the current selection if the selected node still exists
            // in the freshly-merged graph. EditorPage re-runs `loadModels` from
            // a `useEffect` keyed on `[models, deferredExports]`; any time the
            // server returns a new prop reference (debounced re-parse, async
            // hydration completing, transient deferredExports churn), the
            // effect re-fires. The previous unconditional `selectedNodeId:
            // null` reset clobbered user selection on every re-parse — the
            // explorer click would register, populate Inspector/Structure for
            // a frame, then a subsequent re-parse would wipe it. The user's
            // Form preview kept showing stale content because preview-store
            // doesn't clear on selection drop, but Structure/Inspector/Graph
            // (which read selectedNodeId directly) went empty. Only drop the
            // selection when the previously-selected id no longer matches a
            // node in the new graph (e.g. type was renamed or deleted).
            // Degraded-parse guard: reject a reparse that strips source content
            // from the live graph (parse worker unavailable → attributes return
            // empty with no `errors`). Applying it would corrupt the source via
            // the model→source serialize path. Keep the last good graph verbatim;
            // a healthy reparse later replaces it. Compared against current nodes
            // so legitimate user deletions are not mistaken for degradation.
            if (isDegradedReparse(laidOutNodes, get().nodes)) {
              console.warn(
                '[editor-store] Rejected a degraded reparse (attributes stripped from the live graph) ' +
                  'to protect the source document. The parse worker is likely unavailable.'
              );
              return;
            }

            // Replay user edits made since the last parse on top of this one, then
            // clear them (ONE-SHOT). This covers the dangerous in-flight case: an
            // edit made just before its own reparse lands, where the reparse predates
            // the edit and would otherwise momentarily revert it (and that reverted
            // graph would then be re-serialized over source). Id-keyed, so replay
            // targets the right node even if the parse re-orders the array.
            //
            // One-shot (clear below, don't carry remaining patches forward) is
            // deliberate: the save-triggered reparse that DOES reflect the edit is
            // the next parse, so a single replay window suffices. Carrying patches
            // would let object-valued edits (typeCall, cardinality) — which a reparse
            // re-derives with extra AST metadata, so they never compare byte-equal —
            // accumulate and replay stale data indefinitely. See `edit-reconcile.ts`.
            //
            // reconcileParse now returns Maps (canonical substrate). We set them
            // directly alongside the derived arrays so the invariant holds:
            //   I1: nodes === [...nodesById.values()]
            const { nodesById: reconciledById, edgesById: reconciledEdgesById } = reconcileParse(
              laidOutNodes,
              edges,
              get().pendingEditPatches
            );
            const reconciledNodes = nodesFromMap(reconciledById);
            const reconciledEdges = edgesFromMap(reconciledEdgesById);

            const { selectedNodeId: previousSelection, selectionRekey } = get();
            const preservedSelection =
              previousSelection && reconciledNodes.some((n) => n.id === previousSelection) ? previousSelection : null;

            set({
              nodesById: reconciledById,
              edgesById: reconciledEdgesById,
              nodes: reconciledNodes,
              edges: reconciledEdges,
              layoutOptions: opts,
              selectedNodeId: preservedSelection,
              selectionRekey: selectionRekey?.to === preservedSelection ? selectionRekey : undefined,
              searchQuery: '',
              searchResults: [],
              // PARSE-origin change — bump parseEpoch so useModelSourceSync skips
              // serializing this graph back to source (it came FROM the source).
              parseEpoch: get().parseEpoch + 1,
              // One-shot: edits since the last parse have now been replayed; clear
              // so they can never accumulate or replay stale data across reparses.
              pendingEditPatches: [],
              pendingInversePatches: [],
              visibility: {
                expandedNamespaces,
                hiddenNodeIds: new Set<string>(),
                explorerOpen: true,
                visibleNodeKinds: new Set(ALL_NODE_KINDS),
                visibleEdgeKinds: new Set(ALL_EDGE_KINDS)
              }
            });
          },

          loadDeferredExports(entries) {
            // Idempotence guard (Codex P1 review on PR #164): EditorPage's
            // effect re-fires whenever its `deferredExports` prop reference
            // changes. The prop default is an inline `[]` which is a fresh
            // array on every render → unconditional re-dispatch would
            // re-emit visibility state on every render and trigger a
            // subscriber re-render cascade. Short-circuit if entries is
            // the same reference or both-empty: the contract for "clear
            // stale state on workspace switch" only fires on a genuine
            // transition from non-empty to empty, which this guard preserves.
            const current = get().deferredExports;
            if (entries === current) return;
            if (entries.length === 0 && current.length === 0) return;
            // STATE-ONLY update (Codex P2 review on PR #164: "avoid recording
            // a stale mixed graph before reload"). Touching `nodes` here would
            // be tracked by zundo's temporal middleware — undo after a
            // workspace switch would restore the intermediate "old workspace
            // nodes + new curated placeholders" state. Instead, only stash
            // the entries; loadModels is the single source of node mutation
            // and reads these entries when it computes the merged graph.
            // `deferredExports` is NOT in TrackedState (see history.ts) so
            // this write doesn't pollute the undo history.
            set({ deferredExports: entries });
          },

          // -----------------------------------------------------------------------
          // Navigation
          // -----------------------------------------------------------------------

          selectNode(nodeId, options) {
            const nextDetailPanelOpen = nodeId !== null;
            const {
              selectedNodeId,
              selectionRekey,
              detailPanelOpen,
              focusMode,
              edges,
              visibility,
              nodes,
              focusRelatedExcludedKinds
            } = get();
            const selectionChanged = selectedNodeId !== nodeId;
            if (selectionChanged || selectionRekey || detailPanelOpen !== nextDetailPanelOpen) {
              set({ selectedNodeId: nodeId, selectionRekey: undefined, detailPanelOpen: nextDetailPanelOpen });
            }
            if (nodeId === null && focusMode && visibility.hiddenNodeIds.size > 0) {
              get().showAllNodes();
              return;
            }
            const shouldApplyFocusMode =
              nodeId &&
              focusMode &&
              options?.isolateInFocusMode !== false &&
              (selectionChanged || options?.reapplyFocusMode);
            if (shouldApplyFocusMode) {
              const focusNodeIds = collectFocusClusterNodeIds(
                nodeId,
                edges,
                buildNodeMap(nodes),
                focusRelatedExcludedKinds
              );
              get().showOnly(focusNodeIds);
            }
          },

          setSearchQuery(query) {
            const nodes = get().nodes;
            const results: string[] = [];

            if (query.trim()) {
              const regex = new RegExp(query, 'i');
              for (const node of nodes) {
                if (regex.test(node.data.name)) {
                  results.push(node.id);
                }
              }
            }

            set({ searchQuery: query, searchResults: results });
          },

          setFilters(filters) {
            set({ activeFilters: filters });
          },

          toggleDetailPanel() {
            set((state) => ({ detailPanelOpen: !state.detailPanelOpen }));
          },

          // -----------------------------------------------------------------------
          // Layout
          // -----------------------------------------------------------------------

          relayout(options) {
            const opts = options ?? get().layoutOptions;
            const nodes = computeLayout(get().nodes, get().edges, opts);
            updateGraphView(set, get, { nodes }, { layoutOptions: opts });
          },

          setLayoutEngine(engine) {
            const opts = { ...get().layoutOptions, engine };
            const nodes = computeLayout(get().nodes, get().edges, opts);
            updateGraphView(set, get, { nodes }, { layoutOptions: opts });
          },

          getNodes() {
            return get().nodes;
          },

          getEdges() {
            return get().edges;
          },

          // -----------------------------------------------------------------------
          // Editing commands (P2)
          // -----------------------------------------------------------------------

          createType(kind: TypeKind, name: string, namespace: string): string {
            const $type = NODE_TYPE_TO_AST_TYPE[kind] ?? 'Data';
            const nodeId = makeNodeId(namespace, name, $type);
            nodeCounter++;
            // Build node OUTSIDE the recipe so nodeCounter++ side-effect is stable
            // and the constructed node is captured as a patch (fixes: raw set lost
            // the node on next reparse since nodes array wasn't in the patch substrate).
            const newNode = buildNewTypeNode(kind, name, namespace, nodeCounter);
            mutateGraph(set, get, (draft) => {
              draft.nodes.set(nodeId, newNode);
            });
            return nodeId;
          },

          deleteType(nodeId: string) {
            const clearsSelection = get().selectedNodeId === nodeId;
            mutateGraph(
              set,
              get,
              (draft) => {
                draft.nodes.delete(nodeId);
                for (const [id, e] of draft.edges) {
                  if (e.source === nodeId || e.target === nodeId) draft.edges.delete(id);
                }
              },
              clearsSelection ? { selectedNodeId: null, selectionRekey: undefined } : undefined
            );
          },

          renameType(nodeId: string, newName: string) {
            // Read-only lookups before the recipe (safe against stale draft reads).
            const state = get();
            const target = state.nodesById.get(nodeId);
            if (!target) return;

            const oldName = target.data.name;
            const namespace = target.meta.namespace;
            const newNodeId = makeNodeId(namespace, newName, target.data.$type);
            // No-op if the new id is already taken: with nodesById canonical, the
            // re-key's `set(newNodeId, …)` would silently overwrite the occupant
            // (a same-name no-op, or a real collision dropping another type). Bail
            // before mutating so neither node is lost.
            if (state.nodesById.has(newNodeId)) return;
            const reselect = state.selectedNodeId === nodeId ? newNodeId : state.selectedNodeId;
            const previousRekey = state.selectionRekey?.to === nodeId ? state.selectionRekey : undefined;

            // Read the pre-mutation Maps from the store (un-proxied): mutateGraph
            // applies the recipe result AFTER create() returns, so get() here is the
            // original state. Scanning these plain Maps — instead of the drafted ones —
            // keeps Mutative from proxying all N entries just to read them; we only
            // touch the draft for entries that actually change (O(changed), not O(N)).
            const { nodesById: originalNodes, edgesById: originalEdges } = get();

            mutateGraph(
              set,
              get,
              (draft) => {
                const n = originalNodes.get(nodeId);
                if (!n) return;

                // 1. Re-key the renamed node (delete old id, insert new id + name)
                draft.nodes.delete(nodeId);
                draft.nodes.set(newNodeId, { ...n, id: newNodeId, data: { ...n.data, name: newName } });

                // 2. Cascade refs EDGE-DRIVEN (spec §3): only nodes with an incident
                //    edge targeting the renamed node are touched — the edge's
                //    existence IS the binding decision, so a bare same-name ref in
                //    another namespace that binds locally has no edge here and is
                //    (correctly) untouched.
                const incident = selectEdgeIndex(originalEdges).byTarget(nodeId);
                for (const edge of incident) {
                  if (edge.source === nodeId) continue; // self handled below via rewriteOwnRefs
                  const other = originalNodes.get(edge.source);
                  if (!other) continue;
                  // A node can have several incident edges; rewrite against the
                  // LATEST draft state so multiple slots accumulate.
                  const current = draft.nodes.get(edge.source) ?? other;
                  const rewritten = rewriteEdgeRefInNode(edge, current.data, oldName, newName, namespace);
                  if (rewritten === null) {
                    // Invariant breach (spec §3.3): warn + skip; never guess, never throw.
                    console.warn(`[renameType] edge ${edge.id} did not locate a rewritable slot — skipped`);
                    continue;
                  }
                  draft.nodes.set(edge.source, { ...current, data: rewritten });
                }
                // 2b. The renamed node's own data ALWAYS gets the slot rewrite
                //     (self-refs have no edges — spec §3.4/§5). Applied to the
                //     re-keyed entry from step 1.
                const renamedEntry = draft.nodes.get(newNodeId)!;
                const ownRewritten = rewriteOwnRefs(renamedEntry.data, oldName, newName, namespace);
                if (ownRewritten !== renamedEntry.data) {
                  draft.nodes.set(newNodeId, { ...renamedEntry, data: ownRewritten });
                }

                // 3. Re-key incident edges via parse+rebuild (NOT string .replace).
                //    Labels on choice-option edges carry the (possibly qualified)
                //    type name, so match bare AND `<namespace>.<oldName>` forms.
                for (const [id, e] of originalEdges) {
                  const sourceChanged = e.source === nodeId;
                  const targetChanged = e.target === nodeId;
                  // Only choice-option edges carry a *type name* in data.label.
                  // attribute-ref labels are attribute NAMES (and enum-extends a
                  // literal) — never rewrite those, or an attribute that happens
                  // to share the renamed type's name would corrupt its edge.
                  const relabeled =
                    e.data?.kind === 'choice-option'
                      ? renameRefValue(e.data?.label, oldName, newName, namespace)
                      : null;
                  const labelChanged = relabeled !== null;
                  if (!sourceChanged && !targetChanged && !labelChanged) continue;

                  const newSource = sourceChanged ? newNodeId : e.source;
                  const newTarget = targetChanged ? newNodeId : e.target;
                  const newLabel = labelChanged ? relabeled : e.data?.label;
                  const parsed = parseEdgeId(id);
                  const newEdgeId = parsed
                    ? makeEdgeId(parsed.kind, { source: newSource, target: newTarget, label: newLabel })
                    : id.replace(nodeId, newNodeId).replace(oldName, newName); // fallback (should not occur post-3A)
                  draft.edges.delete(id);
                  draft.edges.set(newEdgeId, {
                    ...e,
                    id: newEdgeId,
                    source: newSource,
                    target: newTarget,
                    data: e.data ? { ...e.data, label: newLabel } : e.data
                  });
                }
              },
              reselect !== state.selectedNodeId
                ? {
                    selectedNodeId: reselect,
                    selectionRekey: {
                      from: previousRekey?.from ?? nodeId,
                      to: newNodeId,
                      ...(previousRekey
                        ? { intermediateIds: [...new Set([...(previousRekey.intermediateIds ?? []), nodeId])] }
                        : {})
                    }
                  }
                : undefined
            );
          },

          // no 1:1 generated accessor: kind-agnostic (Data+Annotation) + edge-coupled + name-based remove
          addAttribute(nodeId: string, attrName: string, typeName: string, cardinality: string) {
            const card = parseCardinalityString(cardinality);
            const newAttr = {
              $type: 'Attribute',
              name: attrName,
              override: false,
              typeCall: {
                $type: 'TypeCall',
                type: { $refText: typeName },
                arguments: []
              },
              card: { $type: 'RosettaCardinality', ...card },
              annotations: [],
              synonyms: []
            };

            const { nodes, nodesById } = get();
            const targetNodeId = resolveTargetId(nodesById, nodes, nodeId, typeName);
            const newEdge: TypeGraphEdge | null =
              targetNodeId && targetNodeId !== nodeId
                ? {
                    id: makeEdgeId('attribute-ref', { source: nodeId, target: targetNodeId, label: attrName }),
                    source: nodeId,
                    target: targetNodeId,
                    type: 'attribute-ref',
                    data: {
                      kind: 'attribute-ref' as const,
                      label: attrName,
                      cardinality: formatCardinalityString(cardinality)
                    }
                  }
                : null;

            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              if (n) {
                const d = n.data;
                // Data and Annotation use 'attributes'
                if (d.$type === 'Data' || d.$type === 'Annotation') {
                  const dd = d as { attributes?: unknown[] };
                  if (!Array.isArray(dd.attributes)) dd.attributes = [];
                  if (d.$type === 'Data') {
                    Data.addAttribute(d, newAttr as unknown as Parameters<typeof Data.addAttribute>[1]);
                  } else {
                    Annotation.addAttribute(d, newAttr as unknown as Parameters<typeof Annotation.addAttribute>[1]);
                  }
                }
              }
              if (newEdge) draft.edges.set(newEdge.id, newEdge);
            });
          },

          removeAttribute(nodeId: string, attrName: string) {
            const edgeIdsToDrop: string[] = [];
            for (const e of get().edges) {
              if (e.source === nodeId && e.data?.kind === 'attribute-ref' && e.data?.label === attrName) {
                edgeIdsToDrop.push(e.id);
              }
            }
            mutateGraph(set, get, (draft) => {
              const node = draft.nodes.get(nodeId);
              if (node) {
                const d = node.data;
                const key = { name: attrName } as unknown as Parameters<typeof Data.removeAttribute>[1];
                if (d.$type === 'Data') {
                  while (Data.removeAttribute(d, key)) {
                    /* drain duplicates */
                  }
                } else if (d.$type === 'Annotation') {
                  while (Annotation.removeAttribute(d, key)) {
                    /* drain duplicates */
                  }
                }
              }
              for (const id of edgeIdsToDrop) draft.edges.delete(id);
            });
          },

          updateAttributeType(nodeId: string, attrName: string, newTypeName: string, targetTypeId: string) {
            const current = get();
            const node = current.nodesById.get(nodeId);
            if (!node) return;
            const d0 = node.data;
            // Allow Data, Annotation, AND Choice through — Choice arms are stored in
            // `attributes` (typeCall.type.$refText), not in a separate array.
            // Other $types (Enum, RosettaFunction, etc.) are still unsupported.
            if (d0.$type !== 'Data' && d0.$type !== 'Annotation' && d0.$type !== 'Choice') return;

            const isChoice = d0.$type === 'Choice';
            const attrs0 = ((d0 as any).attributes ?? []) as any[];

            // Data/Annotation arms are matched by `name`; Choice arms are matched
            // by `typeCall.type.$refText` because they have no distinct `.name` field.
            const firstMatch = isChoice
              ? attrs0.find((a: any) => (a.typeCall?.type?.$refText ?? a.typeCall) === attrName)
              : attrs0.find((a: any) => a.name === attrName);
            if (!firstMatch) return;

            // Choice arms carry no cardinality; only preserve it for Data/Annotation.
            const preservedCardinality = isChoice ? undefined : formatCardinality(firstMatch.card);

            // Phase 13 / Finding 3: validate that the canonical targetTypeId exists
            // in the current store and pick a $refText that disambiguates against
            // same-named types in other namespaces. Reject (no-op) stale or unknown
            // ids — a drag payload pointing at a deleted node must NOT corrupt the AST.
            const target = current.nodesById.get(targetTypeId);
            if (!target) return; // stale payload — abort
            const targetNamespace = target.meta.namespace;
            if (!targetNamespace) return; // malformed target
            const refText = disambiguateTypeRef(targetTypeId, newTypeName, targetNamespace, current.nodes);

            // For Choice arms, the old edge is a choice-option keyed by old type name;
            // for Data/Annotation it's an attribute-ref keyed by attribute name.
            const oldEdgeIds: string[] = [];
            for (const e of current.edges) {
              const matches = isChoice
                ? e.source === nodeId && e.data?.kind === 'choice-option' && e.data.label === attrName
                : e.source === nodeId && e.data?.kind === 'attribute-ref' && e.data.label === attrName;
              if (matches) oldEdgeIds.push(e.id);
            }

            // New edge unless the attribute points back at its own node.
            const newEdge: TypeGraphEdge | null =
              targetTypeId === nodeId
                ? null
                : isChoice
                  ? {
                      id: makeEdgeId('choice-option', { source: nodeId, target: targetTypeId, label: refText }),
                      source: nodeId,
                      target: targetTypeId,
                      type: 'choice-option',
                      data: { kind: 'choice-option' as const, label: refText }
                    }
                  : {
                      id: makeEdgeId('attribute-ref', { source: nodeId, target: targetTypeId, label: attrName }),
                      source: nodeId,
                      target: targetTypeId,
                      type: 'attribute-ref',
                      data: {
                        kind: 'attribute-ref' as const,
                        label: attrName,
                        cardinality: preservedCardinality
                      }
                    };

            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              if (n) {
                const d = n.data;
                if (d.$type === 'Data' || d.$type === 'Annotation' || d.$type === 'Choice') {
                  const attrs = (d as { attributes?: any[] }).attributes;
                  for (const a of attrs ?? []) {
                    const matches = isChoice
                      ? (a.typeCall?.type?.$refText ?? a.typeCall) === attrName
                      : a.name === attrName;
                    if (matches) {
                      a.typeCall = {
                        ...(a.typeCall ?? { $type: 'TypeCall', arguments: [] }),
                        type: { $refText: refText }
                      };
                    }
                  }
                }
              }
              for (const id of oldEdgeIds) draft.edges.delete(id);
              if (newEdge) draft.edges.set(newEdge.id, newEdge);
            });
          },

          renameAttribute(nodeId: string, oldName: string, newName: string) {
            const current = get();
            const node = current.nodesById.get(nodeId);
            if (!node) return;
            const d0 = node.data;
            if (d0.$type !== 'Data' && d0.$type !== 'Annotation') return;
            const attrs0 = ((d0 as any).attributes ?? []) as any[];
            if (!attrs0.some((a) => a.name === oldName)) return;

            // Precompute id-rewrites for the attribute-ref edges (their id encodes
            // the attribute name) from the current base edges.
            const edgeRewrites: Array<{ oldId: string; newEdge: TypeGraphEdge }> = [];
            for (const e of current.edges) {
              if (!(e.source === nodeId && e.data?.kind === 'attribute-ref' && e.data.label === oldName)) continue;
              const parsed = parseEdgeId(e.id);
              const newId = parsed
                ? makeEdgeId(parsed.kind, { source: e.source, target: e.target, label: newName })
                : e.id.replace(`--attribute-ref--${oldName}--`, `--attribute-ref--${newName}--`); // fallback (should not occur post-3A)
              edgeRewrites.push({
                oldId: e.id,
                newEdge: { ...e, id: newId, data: { ...e.data, label: newName } }
              });
            }

            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              if (n) {
                const d = n.data;
                if (d.$type === 'Data' || d.$type === 'Annotation') {
                  // Rename every attribute sharing the old name (mirrors the prior `.map`).
                  for (const a of (d as { attributes?: Array<{ name: string }> }).attributes ?? []) {
                    if (a.name === oldName) a.name = newName;
                  }
                }
              }
              for (const { oldId, newEdge } of edgeRewrites) {
                if (!draft.edges.has(oldId)) continue;
                draft.edges.delete(oldId);
                draft.edges.set(newEdge.id, newEdge);
              }
            });
          },

          updateCardinality(nodeId: string, attrName: string, cardinality: string) {
            const card = parseCardinalityString(cardinality);
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              if (!n) return;
              const d = n.data;
              if (d.$type !== 'Data' && d.$type !== 'Annotation') return;
              // Update every attribute sharing the name (mirrors the prior `.map`).
              for (const a of (d as { attributes?: Array<{ name: string; card?: unknown }> }).attributes ?? []) {
                if (a.name === attrName) a.card = { $type: 'RosettaCardinality', ...card };
              }
            });
          },

          setInheritance(childId: string, parentId: string | null) {
            // Phase 13 / Finding 3: validate parentId exists; reject stale payloads
            // (drag target deleted between drag and drop). Read-only lookups happen
            // BEFORE the recipe so the draft sees the committed state.
            const state = get();
            const parentNode = parentId ? state.nodesById.get(parentId) : null;
            if (parentId && !parentNode) return; // stale parentId — no-op, leave state untouched

            const parentName = parentNode?.data.name;
            const parentNamespace = parentNode?.meta.namespace;
            const superRefText =
              parentName && parentNamespace && parentNode
                ? disambiguateTypeRef(parentNode.id, parentName, parentNamespace, state.nodes)
                : parentName;
            // Strict `{ $refText }` ref shape (Phase 3 prep): hydration re-resolves
            // the real Reference from $refText via the Langium linker, so a
            // synthesized `ref: { name }` was never load-bearing for round-trip.
            const superRef = superRefText ? { $refText: superRefText } : undefined;

            mutateGraph(set, get, (draft) => {
              // Remove existing extends edge from this child
              for (const [id, e] of draft.edges) {
                if (e.source === childId && e.data?.kind === 'extends') draft.edges.delete(id);
              }
              // Update child superType (Data nodes only)
              const n = draft.nodes.get(childId);
              const d = n?.data;
              if (d?.$type === 'Data') (d as { superType?: unknown }).superType = superRef;
              // Add new extends edge when a parent is supplied
              if (parentId) {
                const id = makeEdgeId('extends', { source: childId, target: parentId });
                draft.edges.set(id, {
                  id,
                  source: childId,
                  target: parentId,
                  type: 'inheritance',
                  data: { kind: 'extends' as const, label: 'extends' }
                });
              }
            });
          },

          validate(): ValidationError[] {
            const errors = validateGraph(get().nodes, get().edges);
            set({ validationErrors: errors });
            return errors;
          },

          // -----------------------------------------------------------------------
          // Attribute operations
          // -----------------------------------------------------------------------

          updateAttribute(nodeId: string, oldName: string, newName: string, typeName: string, cardinality: string) {
            // Combined name+type+cardinality edit from the inspector form. Routed
            // through `mutateGraph` (like the field-level attribute actions) so an
            // edit made just before its own reparse lands is captured as a pending
            // patch and replayed, not dropped. See `edit-reconcile.ts`.
            const card = parseCardinalityString(cardinality);
            const { nodes, nodesById, edges } = get();
            const oldEdgeIds: string[] = [];
            for (const e of edges) {
              if (e.source === nodeId && e.data?.kind === 'attribute-ref' && e.data?.label === oldName) {
                oldEdgeIds.push(e.id);
              }
            }
            const targetNodeId = resolveTargetId(nodesById, nodes, nodeId, typeName);
            const newEdge: TypeGraphEdge | null =
              targetNodeId && targetNodeId !== nodeId
                ? {
                    id: makeEdgeId('attribute-ref', { source: nodeId, target: targetNodeId, label: newName }),
                    source: nodeId,
                    target: targetNodeId,
                    type: 'attribute-ref',
                    data: {
                      kind: 'attribute-ref' as const,
                      label: newName,
                      cardinality: formatCardinalityString(cardinality)
                    }
                  }
                : null;

            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              if (n) {
                const d = n.data;
                if (d.$type === 'Data' || d.$type === 'Annotation') {
                  // Update every attribute sharing the old name (mirrors the prior `.map`).
                  for (const a of (d as { attributes?: any[] }).attributes ?? []) {
                    if (a.name === oldName) {
                      a.name = newName;
                      a.typeCall = { ...a.typeCall, $type: 'TypeCall', type: { $refText: typeName } };
                      a.card = { $type: 'RosettaCardinality', ...card };
                    }
                  }
                }
              }
              for (const id of oldEdgeIds) draft.edges.delete(id);
              if (newEdge) draft.edges.set(newEdge.id, newEdge);
            });
          },

          reorderAttribute(nodeId: string, fromIndex: number, toIndex: number) {
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              const d = n?.data;
              if (!d || (d.$type !== 'Data' && d.$type !== 'Annotation')) return;
              const attrs = (d as { attributes?: unknown[] }).attributes;
              if (!Array.isArray(attrs)) return;
              // moveAttributeAt guards out-of-range from (langium-zod 0.8.3) — a true
              // no-op there, in-place splice otherwise; equivalent to reorderInPlace.
              if (d.$type === 'Data') Data.moveAttributeAt(d, fromIndex, toIndex);
              else Annotation.moveAttributeAt(d, fromIndex, toIndex);
            });
          },

          // -----------------------------------------------------------------------
          // Enum operations
          // -----------------------------------------------------------------------

          addEnumValue(nodeId: string, valueName: string, displayName?: string) {
            const newValue = {
              $type: 'RosettaEnumValue',
              name: valueName,
              display: displayName,
              annotations: [],
              enumSynonyms: []
            };
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              const d = n?.data;
              if (d?.$type !== 'RosettaEnumeration') return;
              ensureMemberArray(d); // init guard: enumValues may be absent on a fresh node
              RosettaEnumeration.addEnumValue(
                d,
                newValue as unknown as Parameters<typeof RosettaEnumeration.addEnumValue>[1]
              );
            });
          },

          removeEnumValue(nodeId: string, valueName: string) {
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              const d = n?.data;
              if (d?.$type !== 'RosettaEnumeration') return;
              const vals = (d as { enumValues?: { name: string }[] }).enumValues;
              if (!Array.isArray(vals)) return;
              // Drain ALL matches by name (master behavior) — robust against a
              // malformed graph with duplicate enum-value names. A single removeX
              // call would drop only the first, leaving stale duplicates behind.
              const key = { name: valueName } as unknown as Parameters<typeof RosettaEnumeration.removeEnumValue>[1];
              while (RosettaEnumeration.removeEnumValue(d, key)) {
                /* drain duplicates */
              }
            });
          },

          updateEnumValue(nodeId: string, oldName: string, newName: string, displayName?: string) {
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              const d = n?.data;
              if (d?.$type !== 'RosettaEnumeration') return;
              const vals = (d as { enumValues?: { name: string; display?: string }[] }).enumValues;
              if (!Array.isArray(vals)) return;
              // Update ALL matches by name (master behavior) — see removeEnumValue.
              for (const item of vals) {
                if (item.name === oldName) {
                  item.name = newName;
                  item.display = displayName;
                }
              }
            });
          },

          reorderEnumValue(nodeId: string, fromIndex: number, toIndex: number) {
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              const d = n?.data;
              if (d?.$type !== 'RosettaEnumeration') return;
              const vals = (d as { enumValues?: unknown[] }).enumValues;
              if (!Array.isArray(vals)) return;
              // moveEnumValueAt guards out-of-range from (0.8.3) — equivalent to reorderInPlace.
              RosettaEnumeration.moveEnumValueAt(d, fromIndex, toIndex);
            });
          },

          // no generated domain op at the enum-value level; push/splice inline
          addEnumValueSynonym(nodeId: string, valueIndex: number, source: string, value: string) {
            const target = get().captureMetadataTarget(nodeId, ['enumValues', valueIndex]);
            const item = createSynonymDraft('enumValue', source, value);
            if (target && item)
              get().applyMetadataCommand(target, { kind: 'append', field: 'enumSynonyms', value: item });
          },

          removeEnumValueSynonym(nodeId: string, valueIndex: number, synIndex: number) {
            const target = get().captureMetadataTarget(nodeId, ['enumValues', valueIndex]);
            if (!target) return;
            const expected = getMetadataItems(target.expected, 'enumSynonyms')[synIndex];
            if (expected)
              get().applyMetadataCommand(target, { kind: 'remove', field: 'enumSynonyms', index: synIndex, expected });
          },

          setEnumParent(nodeId: string, parentId: string | null) {
            const state = get();
            const parentNode = parentId ? state.nodesById.get(parentId) : null;
            if (parentId && !parentNode) return; // stale parentId — no-op, leave state untouched (mirrors setInheritance)
            const parentName = parentNode?.data.name;
            const parentNamespace = parentNode?.meta.namespace;
            const parentRefText =
              parentName && parentNamespace && parentNode
                ? disambiguateTypeRef(parentNode.id, parentName, parentNamespace, state.nodes)
                : parentName;
            // Strict `{ $refText }` ref shape (Phase 3 prep) — mirrors setInheritance,
            // including cross-namespace qualification via disambiguateTypeRef.
            const parentRef = parentRefText ? { $refText: parentRefText } : undefined;
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              const d = n?.data;
              if (d?.$type !== 'RosettaEnumeration') return;
              (d as { parent?: unknown }).parent = parentRef;
              for (const [id, e] of draft.edges) {
                if (e.source === nodeId && e.data?.kind === 'enum-extends') draft.edges.delete(id);
              }
              if (parentId) {
                const edgeId = makeEdgeId('enum-extends', { source: nodeId, target: parentId });
                draft.edges.set(edgeId, {
                  id: edgeId,
                  source: nodeId,
                  target: parentId,
                  type: 'enum-extends',
                  data: {
                    kind: 'enum-extends' as const,
                    label: 'extends'
                  }
                });
              }
            });
          },

          // -----------------------------------------------------------------------
          // Choice operations
          // -----------------------------------------------------------------------

          addChoiceOption(nodeId: string, typeName: string) {
            const newOption = {
              $type: 'ChoiceOption',
              typeCall: {
                $type: 'TypeCall',
                type: { $refText: typeName },
                arguments: []
              },
              annotations: [],
              synonyms: []
            };
            // Resolve the target node id BEFORE the recipe (read-only against the
            // derived `nodes` array — I1 keeps it equal to nodesById.values()).
            const { nodes, nodesById } = get();
            const targetId = resolveTargetId(nodesById, nodes, nodeId, typeName);
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              const d = n?.data;
              if (d?.$type !== 'Choice') return;
              ensureMemberArray(d).push(newOption);
              if (targetId) {
                const id = makeEdgeId('choice-option', { source: nodeId, target: targetId, label: typeName });
                draft.edges.set(id, {
                  id,
                  source: nodeId,
                  target: targetId,
                  type: 'choice-option',
                  data: { kind: 'choice-option' as const, label: typeName }
                });
              }
            });
          },

          removeChoiceOption(nodeId: string, typeName: string) {
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              const d = n?.data;
              if (d?.$type !== 'Choice') return;
              if (Array.isArray((d as { attributes?: unknown[] }).attributes)) {
                const key = { typeCall: { type: { $refText: typeName } } } as unknown as Parameters<
                  typeof Choice.removeAttribute
                >[1];
                while (Choice.removeAttribute(d, key)) {
                  /* drain duplicates */
                }
              }
              for (const [id, e] of draft.edges) {
                if (e.source === nodeId && e.data?.kind === 'choice-option' && e.data?.label === typeName) {
                  draft.edges.delete(id);
                }
              }
            });
          },

          // -----------------------------------------------------------------------
          // Function operations
          // -----------------------------------------------------------------------

          addInputParam(nodeId: string, paramName: string, typeName: string) {
            const newInput = {
              $type: 'Attribute',
              name: paramName,
              override: false,
              typeCall: {
                $type: 'TypeCall',
                type: { $refText: typeName },
                arguments: []
              },
              card: { $type: 'RosettaCardinality', inf: 1, sup: 1, unbounded: false },
              annotations: [],
              synonyms: []
            };
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              const d = n?.data;
              if (d?.$type !== 'RosettaFunction') return;
              ensureMemberArray(d); // init guard: inputs may be absent on a fresh node
              RosettaFunction.addInput(d, newInput as unknown as Parameters<typeof RosettaFunction.addInput>[1]);
            });
          },

          removeInputParam(nodeId: string, paramName: string) {
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              const d = n?.data;
              if (d?.$type !== 'RosettaFunction') return;
              const inputs = (d as { inputs?: { name: string }[] }).inputs;
              if (!Array.isArray(inputs)) return;
              // Original semantics: remove only the FIRST input matching the name
              // (findIndex + splice-one), NOT a drain. The generated removeInput
              // removes the first match, so a single call preserves behavior exactly.
              const key = { name: paramName } as unknown as Parameters<typeof RosettaFunction.removeInput>[1];
              RosettaFunction.removeInput(d, key);
            });
          },

          updateInputParam(
            nodeId: string,
            oldName: string,
            newName: string,
            typeName: string,
            cardinality: string,
            targetTypeId?: string
          ) {
            const card = parseCardinalityString(cardinality);
            // Resolve the qualified $refText using the same disambiguation logic
            // as updateAttributeType (spec 020 Phase 13, Finding 3).  When a
            // canonical targetTypeId is supplied and the node exists, qualify the
            // name if any OTHER node shares the same bare name.  Fall back to the
            // bare typeName when the id is absent or stale (backward-compatible).
            // All reads are done BEFORE the recipe, once, against the committed
            // state — `nodes` is the derived I1 array (=== nodesById.values()).
            const { nodes, nodesById } = get();
            const targetNode = targetTypeId ? nodesById.get(targetTypeId) : undefined;
            const targetNamespace = targetNode ? targetNode.meta.namespace : undefined;
            const refText =
              targetNode && targetNamespace
                ? disambiguateTypeRef(targetTypeId!, typeName, targetNamespace, nodes)
                : typeName;

            // Add a new attribute-ref edge if the target type node exists.
            // Prefer id-based lookup (avoids resolving to the wrong same-named
            // node in a different namespace); fall back to name-based lookup for
            // built-in / string types that have no graph node.
            const targetNodeId = targetNode?.id ?? resolveTargetId(nodesById, nodes, nodeId, typeName);
            const newEdge: TypeGraphEdge | null =
              targetNodeId && targetNodeId !== nodeId
                ? {
                    id: makeEdgeId('attribute-ref', { source: nodeId, target: targetNodeId, label: newName }),
                    source: nodeId,
                    target: targetNodeId,
                    type: 'attribute-ref',
                    data: {
                      kind: 'attribute-ref' as const,
                      label: newName,
                      cardinality: formatCardinalityString(cardinality)
                    }
                  }
                : null;

            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              const d = n?.data;
              if (d?.$type !== 'RosettaFunction') return;
              for (const inp of (d as { inputs?: any[] }).inputs ?? []) {
                if (inp.name === oldName) {
                  inp.name = newName;
                  // Mutate typeCall in-place so Mutative preserves the existing
                  // `arguments` array (spreading a Mutative proxy discards the
                  // proxy's array tracking; field-by-field mutation is safe here).
                  if (!inp.typeCall) {
                    inp.typeCall = { $type: 'TypeCall', type: { $refText: refText }, arguments: [] };
                  } else {
                    if (!inp.typeCall.type) inp.typeCall.type = {};
                    inp.typeCall.type.$refText = refText;
                    // arguments is left untouched — preserves parameterized TypeCall.arguments.
                  }
                  inp.card = { $type: 'RosettaCardinality', ...card };
                }
              }
              // Remove the old attribute-ref edge for this input (keyed by old name).
              for (const [id, e] of draft.edges) {
                if (e.source === nodeId && e.data?.kind === 'attribute-ref' && e.data?.label === oldName) {
                  draft.edges.delete(id);
                }
              }
              if (newEdge) draft.edges.set(newEdge.id, newEdge);
            });
          },

          reorderInputParam(nodeId: string, fromIndex: number, toIndex: number) {
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              const d = n?.data;
              if (d?.$type !== 'RosettaFunction') return;
              const inputs = (d as { inputs?: unknown[] }).inputs;
              if (!Array.isArray(inputs)) return;
              // moveInputAt guards out-of-range from (0.8.3) — equivalent to reorderInPlace.
              RosettaFunction.moveInputAt(d, fromIndex, toIndex);
            });
          },

          updateOutputType(nodeId: string, typeName: string) {
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              const d = n?.data;
              if (d?.$type !== 'RosettaFunction') return;
              const fd = d as {
                output?: {
                  $type?: string;
                  name?: string;
                  override?: boolean;
                  card?: unknown;
                  typeCall?: { $type: string; type: { $refText: string }; arguments: unknown[] };
                };
              };
              if (!fd.output) {
                fd.output = {
                  $type: 'Attribute',
                  name: 'output',
                  override: false,
                  card: { $type: 'RosettaCardinality', inf: 1, sup: 1, unbounded: false }
                };
              }
              fd.output.typeCall = {
                $type: 'TypeCall',
                type: { $refText: typeName },
                arguments: []
              };
            });
          },

          setFunctionParent(nodeId: string, parentId: string | null) {
            // Mirrors setEnumParent (Function's superFunction, like Enum's
            // parent, is a single scalar ref, not Data's special-cased
            // superType). Reuses the 'extends' edge kind — ast-to-model.ts
            // already emits `superFunction` as an 'extends' edge, so no new
            // EdgeKind is needed (edges are scoped by source node id, so
            // this never collides with a Data node's own 'extends' edge).
            const state = get();
            const parentNode = parentId ? state.nodesById.get(parentId) : null;
            if (parentId && !parentNode) return; // stale parentId — no-op, leave state untouched
            const parentName = parentNode?.data.name;
            const parentNamespace = parentNode?.meta.namespace;
            const parentRefText =
              parentName && parentNamespace && parentNode
                ? disambiguateTypeRef(parentNode.id, parentName, parentNamespace, state.nodes)
                : parentName;
            const parentRef = parentRefText ? { $refText: parentRefText } : undefined;
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              const d = n?.data;
              if (d?.$type !== 'RosettaFunction') return;
              (d as { superFunction?: unknown }).superFunction = parentRef;
              for (const [id, e] of draft.edges) {
                if (e.source === nodeId && e.data?.kind === 'extends') draft.edges.delete(id);
              }
              if (parentId) {
                const edgeId = makeEdgeId('extends', { source: nodeId, target: parentId });
                draft.edges.set(edgeId, {
                  id: edgeId,
                  source: nodeId,
                  target: parentId,
                  type: 'extends',
                  data: { kind: 'extends' as const, label: 'extends' }
                });
              }
            });
          },

          updateTypeAliasType(nodeId: string, typeName: string) {
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              if (!n || n.data.$type !== 'RosettaTypeAlias') return;
              const d = n.data as { typeCall?: { type?: { $refText?: string }; arguments?: unknown[] } };
              if (!d.typeCall) d.typeCall = { type: { $refText: typeName }, arguments: [] };
              else if (!d.typeCall.type) d.typeCall.type = { $refText: typeName };
              else d.typeCall.type.$refText = typeName;
            });
          },

          updateExpression(nodeId: string, expressionText: string, operationIndex?: number) {
            if (operationIndex !== undefined) {
              const node = get().nodes.find((n) => n.id === nodeId);
              const operations = node?.data.$type === 'RosettaFunction' ? node.data.operations : undefined;
              if (
                !Number.isInteger(operationIndex) ||
                operationIndex < 0 ||
                operationIndex >= (operations?.length ?? 0)
              ) {
                throw new RangeError(`Invalid function operation index: ${operationIndex}`);
              }
            }
            const index = operationIndex ?? 0;
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              if (!n) return;
              const d = n.data;
              if (d.$type === 'RosettaFunction') {
                // Keep edited expressions as RawDsl until the owning source is reparsed.
                const fd = d as { operations?: any[]; expressionText?: string; output?: { name?: string } };
                if (!fd.operations || fd.operations.length === 0) {
                  fd.operations = [
                    {
                      $type: 'Operation',
                      add: false,
                      assignRoot: { $refText: fd.output?.name ?? '' },
                      expression: { $type: RAW_DSL_TYPE, text: expressionText }
                    }
                  ];
                } else {
                  // Replace wholesale — a stale structural node with only
                  // $cstText overwritten would still carry its OLD $type and
                  // structural fields, which the structural-first renderer
                  // would render instead of the edit (silently dropping it).
                  fd.operations[index].expression = { $type: RAW_DSL_TYPE, text: expressionText };
                }
                if (index === 0) fd.expressionText = expressionText;
              } else {
                // For Data/TypeAlias, store as a display field only.
                (d as { expressionText?: string }).expressionText = expressionText;
              }
            });
          },

          // -----------------------------------------------------------------------
          // Condition operations
          // -----------------------------------------------------------------------

          // no 1:1 generated accessor: kind-agnostic (any node kind) + pre/post split;
          // DomainOps addCondition exists only per-type (Data/RosettaFunction/RosettaTypeAlias)
          addCondition(
            nodeId: string,
            condition: {
              name?: string;
              definition?: string;
              expressionText: string;
              isPostCondition?: boolean;
            }
          ) {
            const newCondition = {
              $type: 'Condition',
              name: condition.name,
              definition: condition.definition,
              // RawDsl leaf — edited text pending reparse — see RAW_DSL_TYPE.
              expression: { $type: RAW_DSL_TYPE, text: condition.expressionText },
              postCondition: condition.isPostCondition ?? false
            };
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              const d = n?.data;
              if (!d) return;
              const dd = d as { conditions?: unknown[]; postConditions?: unknown[] };
              if (condition.isPostCondition) {
                if (Array.isArray(dd.postConditions)) {
                  dd.postConditions.push(newCondition);
                } else {
                  dd.postConditions = [newCondition];
                }
              } else {
                if (Array.isArray(dd.conditions)) {
                  dd.conditions.push(newCondition);
                } else {
                  dd.conditions = [newCondition];
                }
              }
            });
          },

          removeCondition(nodeId: string, index: number) {
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              const d = n?.data;
              if (!d) return;
              const dd = d as { conditions?: any[]; postConditions?: any[] };
              const allConditions = [...(dd.conditions ?? []), ...(dd.postConditions ?? [])];
              // Bounds guard (mirrors updateCondition): a negative index would make
              // splice(-1, 1) delete the LAST condition; an out-of-range index would
              // splice nothing yet still reassign + emit a spurious patch.
              if (index < 0 || index >= allConditions.length) return;
              allConditions.splice(index, 1);
              dd.conditions = allConditions.filter((c: any) => !c.postCondition);
              dd.postConditions = allConditions.filter((c: any) => c.postCondition);
            });
          },

          updateCondition(
            nodeId: string,
            index: number,
            updates: { name?: string; definition?: string; expressionText?: string }
          ) {
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              const d = n?.data;
              if (!d) return;
              const dd = d as { conditions?: any[]; postConditions?: any[] };
              const allConditions = [...(dd.conditions ?? []), ...(dd.postConditions ?? [])];
              if (index < 0 || index >= allConditions.length) return;
              const cond = allConditions[index];
              allConditions[index] = {
                ...cond,
                ...(updates.name !== undefined ? { name: updates.name } : {}),
                ...(updates.definition !== undefined ? { definition: updates.definition } : {}),
                // Replace wholesale (not spread) — cond.expression carries the
                // STALE structural $type/fields from the pre-edit parse; spreading
                // it and only overwriting $cstText left the old $type intact, so
                // the structural-first renderer re-rendered the OLD expression and
                // silently dropped the edit. RawDsl leaf — see RAW_DSL_TYPE.
                ...(updates.expressionText !== undefined
                  ? { expression: { $type: RAW_DSL_TYPE, text: updates.expressionText } }
                  : {})
              };
              dd.conditions = allConditions.filter((c: any) => !c.postCondition);
              dd.postConditions = allConditions.filter((c: any) => c.postCondition);
            });
          },

          // kept reorderInPlace: moveConditionAt differs on kind-agnostic dispatch (per-type only) and would splice the draft on out-of-range indices, emitting a spurious patch
          reorderCondition(nodeId: string, fromIndex: number, toIndex: number) {
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              const d = n?.data;
              if (!d) return;
              const dd = d as { conditions?: any[] };
              const conditions = [...(dd.conditions ?? [])];
              if (!reorderInPlace(conditions, fromIndex, toIndex)) return; // out-of-range → no-op, no patch
              dd.conditions = conditions;
            });
          },

          // -----------------------------------------------------------------------
          // Metadata operations
          // -----------------------------------------------------------------------

          captureMetadataTarget(nodeId, path) {
            return captureTarget(get(), nodeId, path);
          },

          applyMetadataCommand(target, command) {
            const state = get();
            const node = resolveMetadataTarget(state, target);
            if (!node) return { status: 'stale' };
            if (state.nodesById.get(target.nodeId)?.meta.isReadOnly) return { status: 'readOnly' };
            const rejected = validateMetadataCommand(node, command);
            if (rejected) return rejected;
            mutateGraph(set, get, (draft) => {
              const owner = draft.nodes.get(target.nodeId)?.data;
              const current = owner && readAtMetadataPath(owner, target.path);
              if (current) applyMetadataRecipe(current, command);
            });
            return { status: 'committed' };
          },

          updateDefinition(nodeId: string, definition: string) {
            const target = get().captureMetadataTarget(nodeId, []);
            if (target) get().applyMetadataCommand(target, { kind: 'definition', value: definition });
          },

          updateComments(nodeId: string, comments: string) {
            mutateGraph(set, get, (draft) => {
              const n = draft.nodes.get(nodeId);
              if (!n) return;
              // `comments` is UI-only metadata — it lives on `meta`, not `data`.
              n.meta.comments = comments;
            });
          },

          // item construction stays bespoke (rich-ref synonym shapes); append delegated to DomainOps
          addSynonym(nodeId: string, source: string, value?: string) {
            const target = get().captureMetadataTarget(nodeId, []);
            if (!target) return;
            const kind = getMetadataCapabilities(target.expected).synonymKind;
            const item = kind && createSynonymDraft(kind, source, value);
            if (item) get().applyMetadataCommand(target, { kind: 'append', field: 'synonyms', value: item });
          },

          removeSynonym(nodeId: string, index: number) {
            const target = get().captureMetadataTarget(nodeId, []);
            if (!target) return;
            const expected = getMetadataItems(target.expected, 'synonyms')[index];
            if (expected) get().applyMetadataCommand(target, { kind: 'remove', field: 'synonyms', index, expected });
          },

          addAnnotation(nodeId: string, annotationName: string) {
            const target = get().captureMetadataTarget(nodeId, []);
            if (target)
              get().applyMetadataCommand(target, {
                kind: 'append',
                field: 'annotations',
                value: createAnnotationDraft(annotationName)
              });
          },

          removeAnnotation(nodeId: string, index: number) {
            const target = get().captureMetadataTarget(nodeId, []);
            if (!target) return;
            const expected = getMetadataItems(target.expected, 'annotations')[index];
            if (expected) get().applyMetadataCommand(target, { kind: 'remove', field: 'annotations', index, expected });
          },

          requestNamespaceHydration(ns: string) {
            set((s) => {
              if (s.hydratedNamespaces.includes(ns) || s.pendingHydrationNamespaces.includes(ns)) return s;
              return { pendingHydrationNamespaces: [...s.pendingHydrationNamespaces, ns] };
            });
          },

          markNamespacesHydrated(names: string[]) {
            const nameSet = new Set(names);
            set((s) => ({
              hydratedNamespaces: [...new Set([...s.hydratedNamespaces, ...names])],
              pendingHydrationNamespaces: s.pendingHydrationNamespaces.filter((n) => !nameSet.has(n)),
              hydrationNonce: s.hydrationNonce + 1
            }));
          },

          activeHydrationNamespaces() {
            const s = get();
            return [...new Set([...s.hydratedNamespaces, ...s.pendingHydrationNamespaces])];
          },

          dequeuePendingHydration: (names) => {
            const nameSet = new Set(names);
            set((s) => ({
              pendingHydrationNamespaces: s.pendingHydrationNamespaces.filter((n) => !nameSet.has(n)),
              // Bump hydrationNonce here too, not just in markNamespacesHydrated:
              // a failed hydration attempt (this is called from the on-demand
              // hydration effect's .catch) is still "a hydration round happened"
              // and must notify HydrationOrchestrator so it can fire (and clear)
              // any waiters stuck on this namespace instead of leaving them
              // frozen forever.
              hydrationNonce: s.hydrationNonce + 1
            }));
          },

          resetHydration() {
            set({ pendingHydrationNamespaces: [], hydratedNamespaces: [], hydrationNonce: 0 });
          },

          // -----------------------------------------------------------------------
          // ReactFlow integration
          // -----------------------------------------------------------------------

          applyReactFlowNodeChanges(changes: NodeChange<TypeGraphNode>[]) {
            // Filter out intermediate drag states to avoid polluting undo history.
            // Only apply position changes when dragging is complete.
            const meaningful = changes.filter((c) => {
              if (c.type === 'position' && c.dragging) return false;
              return true;
            });
            if (meaningful.length === 0) return;
            updateGraphView(set, get, { nodes: applyNodeChanges(meaningful, get().nodes) });
          },

          applyReactFlowEdgeChanges(changes: EdgeChange<TypeGraphEdge>[]) {
            updateGraphView(set, get, { edges: applyEdgeChanges(changes, get().edges) });
          },

          // -----------------------------------------------------------------------
          // Namespace visibility
          // -----------------------------------------------------------------------

          toggleNamespace(namespace: string) {
            set((state) => {
              const next = new Set(state.visibility.expandedNamespaces);
              if (next.has(namespace)) {
                next.delete(namespace);
              } else {
                next.add(namespace);
              }
              return {
                visibility: { ...state.visibility, expandedNamespaces: next }
              };
            });
          },

          toggleNodeVisibility(nodeId: string) {
            set((state) => {
              const next = new Set(state.visibility.hiddenNodeIds);
              if (next.has(nodeId)) {
                next.delete(nodeId);
              } else {
                next.add(nodeId);
              }
              return {
                visibility: { ...state.visibility, hiddenNodeIds: next }
              };
            });
          },

          expandAllNamespaces() {
            const nodes = get().nodes;
            const allNs = [...new Set(nodes.map((n) => n.meta.namespace))];

            // For small models, expand all at once
            if (nodes.length <= LARGE_MODEL_THRESHOLD) {
              set((state) => ({
                visibility: {
                  ...state.visibility,
                  expandedNamespaces: new Set(allNs),
                  hiddenNodeIds: new Set<string>()
                }
              }));
              return;
            }

            // Progressive expand: batch namespaces to keep each frame under ~100 nodes.
            // Sort namespaces by node count (smallest first) for faster visual feedback.
            const nsCountMap = new Map<string, number>();
            for (const n of nodes) {
              nsCountMap.set(n.meta.namespace, (nsCountMap.get(n.meta.namespace) ?? 0) + 1);
            }
            const nsByCount = allNs
              .map((ns) => ({ ns, count: nsCountMap.get(ns) ?? 0 }))
              .sort((a, b) => a.count - b.count);

            const BATCH_NODE_LIMIT = 100;
            const batches: string[][] = [];
            let currentBatch: string[] = [];
            let currentCount = 0;

            for (const { ns, count } of nsByCount) {
              if (currentCount + count > BATCH_NODE_LIMIT && currentBatch.length > 0) {
                batches.push(currentBatch);
                currentBatch = [ns];
                currentCount = count;
              } else {
                currentBatch.push(ns);
                currentCount += count;
              }
            }
            if (currentBatch.length > 0) batches.push(currentBatch);

            // Clear hidden nodes immediately
            set((state) => ({
              visibility: { ...state.visibility, hiddenNodeIds: new Set<string>() }
            }));

            // Expand batches progressively using requestAnimationFrame
            const seq = ++expandSeq;
            let batchIndex = 0;
            const expandNextBatch = () => {
              if (expandSeq !== seq || batchIndex >= batches.length) return;
              const batch = batches[batchIndex++]!;
              set((state) => {
                const next = new Set(state.visibility.expandedNamespaces);
                for (const ns of batch) next.add(ns);
                return {
                  visibility: { ...state.visibility, expandedNamespaces: next }
                };
              });
              if (batchIndex < batches.length) {
                requestAnimationFrame(expandNextBatch);
              }
            };
            requestAnimationFrame(expandNextBatch);
          },

          collapseAllNamespaces() {
            expandSeq++; // Cancel any in-flight progressive expansion
            set((state) => ({
              visibility: {
                ...state.visibility,
                expandedNamespaces: new Set<string>(),
                hiddenNodeIds: new Set<string>()
              }
            }));
          },

          setInitialVisibility(totalNodeCount: number) {
            set((state) => {
              const shouldCollapse = totalNodeCount > LARGE_MODEL_THRESHOLD;
              const allNs = new Set(state.nodes.map((n) => n.meta.namespace));
              return {
                focusMode: true,
                visibility: {
                  ...state.visibility,
                  expandedNamespaces: shouldCollapse ? new Set<string>() : allNs,
                  hiddenNodeIds: new Set<string>()
                }
              };
            });
          },

          toggleExplorer() {
            set((state) => ({
              visibility: {
                ...state.visibility,
                explorerOpen: !state.visibility.explorerOpen
              }
            }));
          },

          getVisibleNodes(): TypeGraphNode[] {
            const { nodes, visibility } = get();
            return nodes.filter(
              (n) =>
                visibility.expandedNamespaces.has(n.meta.namespace) &&
                !visibility.hiddenNodeIds.has(n.id) &&
                visibility.visibleNodeKinds.has(n.type as TypeKind)
            );
          },

          getVisibleEdges(): TypeGraphEdge[] {
            const { edges, visibility } = get();
            const visibleNodeIds = new Set(
              get()
                .getVisibleNodes()
                .map((n) => n.id)
            );
            return edges.filter(
              (e) =>
                visibleNodeIds.has(e.source) &&
                visibleNodeIds.has(e.target) &&
                visibility.visibleEdgeKinds.has((e.data as EdgeData).kind)
            );
          },

          // -----------------------------------------------------------------------
          // Kind-based visibility
          // -----------------------------------------------------------------------

          toggleNodeKind(kind: TypeKind) {
            set((state) => {
              const next = new Set(state.visibility.visibleNodeKinds);
              if (next.has(kind)) {
                next.delete(kind);
              } else {
                next.add(kind);
              }
              return {
                visibility: { ...state.visibility, visibleNodeKinds: next }
              };
            });
          },

          toggleEdgeKind(kind: EdgeKind) {
            set((state) => {
              const next = new Set(state.visibility.visibleEdgeKinds);
              if (next.has(kind)) {
                next.delete(kind);
              } else {
                next.add(kind);
              }
              return {
                visibility: { ...state.visibility, visibleEdgeKinds: next }
              };
            });
          },

          showAllNodeKinds() {
            set((state) => ({
              visibility: {
                ...state.visibility,
                visibleNodeKinds: new Set(ALL_NODE_KINDS)
              }
            }));
          },

          showAllEdgeKinds() {
            set((state) => ({
              visibility: {
                ...state.visibility,
                visibleEdgeKinds: new Set(ALL_EDGE_KINDS)
              }
            }));
          },

          // -----------------------------------------------------------------------
          // Isolation / focus
          // -----------------------------------------------------------------------

          toggleFocusRelatedExcludedKind(kind: TypeKind) {
            const { selectedNodeId, focusMode, edges, nodes } = get();
            let nextExcludedKinds: Set<TypeKind> | null = null;

            set((state) => {
              nextExcludedKinds = new Set(state.focusRelatedExcludedKinds);
              if (nextExcludedKinds.has(kind)) {
                nextExcludedKinds.delete(kind);
              } else {
                nextExcludedKinds.add(kind);
              }

              return {
                focusRelatedExcludedKinds: nextExcludedKinds
              };
            });

            if (focusMode && selectedNodeId && nextExcludedKinds) {
              const focusNodeIds = collectFocusClusterNodeIds(
                selectedNodeId,
                edges,
                buildNodeMap(nodes),
                nextExcludedKinds
              );
              get().showOnly(focusNodeIds);
            }
          },

          isolateNode(nodeId: string) {
            const { edges, nodes, focusRelatedExcludedKinds } = get();
            const focusNodeIds = collectFocusClusterNodeIds(
              nodeId,
              edges,
              buildNodeMap(nodes),
              focusRelatedExcludedKinds
            );
            get().showOnly(focusNodeIds);
          },

          revealNeighbors(nodeId: string) {
            const { nodes, edges, visibility, focusRelatedExcludedKinds } = get();
            const focusNodeIds = collectFocusClusterNodeIds(
              nodeId,
              edges,
              buildNodeMap(nodes),
              focusRelatedExcludedKinds
            );
            const nodeMap = buildNodeMap(nodes);
            const hiddenNodeIds = new Set(visibility.hiddenNodeIds);
            const expandedNamespaces = new Set(visibility.expandedNamespaces);
            for (const id of focusNodeIds) {
              hiddenNodeIds.delete(id);
              const node = nodeMap.get(id);
              if (node) expandedNamespaces.add(node.meta.namespace);
            }
            set((state) => ({
              visibility: {
                ...state.visibility,
                hiddenNodeIds,
                expandedNamespaces
              }
            }));
          },

          showOnly(nodeIds: Set<string>) {
            const { nodes } = get();
            const nodeMap = buildNodeMap(nodes);
            const hiddenNodeIds = new Set<string>();
            for (const n of nodes) {
              if (!nodeIds.has(n.id)) hiddenNodeIds.add(n.id);
            }
            const expandedNamespaces = new Set(get().visibility.expandedNamespaces);
            for (const id of nodeIds) {
              const node = nodeMap.get(id);
              if (node) expandedNamespaces.add(node.meta.namespace);
            }
            set((state) => ({
              visibility: {
                ...state.visibility,
                hiddenNodeIds,
                expandedNamespaces
              }
            }));
          },

          showAllNodes() {
            set((state) => ({
              visibility: {
                ...state.visibility,
                hiddenNodeIds: new Set<string>()
              }
            }));
          },

          toggleFocusMode() {
            const next = !get().focusMode;
            set({ focusMode: next });
            if (next) {
              const { selectedNodeId, edges, nodes, focusRelatedExcludedKinds } = get();
              if (selectedNodeId) {
                const focusNodeIds = collectFocusClusterNodeIds(
                  selectedNodeId,
                  edges,
                  buildNodeMap(nodes),
                  focusRelatedExcludedKinds
                );
                if (focusNodeIds.size > 1) {
                  get().showOnly(focusNodeIds);
                } else {
                  get().showAllNodes();
                }
              }
            } else {
              get().showAllNodes();
            }
          }
        }; // end return object
      }, // end creator function
      {
        // Track Maps (the canonical SoT) rather than arrays. Equality on Map
        // identity keeps array re-derives (which don't touch Maps) from
        // pushing redundant undo entries.
        partialize: (state): TrackedState => ({
          nodesById: state.nodesById,
          edgesById: state.edgesById
        }),
        equality: (a, b) => a.nodesById === b.nodesById && a.edgesById === b.edgesById,
        limit: 50
      }
    )
  );

  // ---------------------------------------------------------------------------
  // Post-undo array re-derive (Phase 3B Task 6, permanent).
  //
  // zundo's undo/redo restores ONLY partialized fields (nodesById, edgesById)
  // via the internal userSet — which bypasses the creator's set.
  // After a restore, Maps hold the historical values but nodes/edges arrays are stale.
  //
  // Fix: subscribe to the store. When Maps change but arrays didn't (the exact
  // signature of an undo/redo restore), re-derive arrays via store.setState.
  // store.setState goes through zundo's override, but the partialized snapshot
  // {nodesById, edgesById} is unchanged by an arrays-only write, so the
  // equality fn fires and zundo does NOT record the re-derive as a new entry.
  //
  // Loop-safety: after the re-derive, maps are unchanged and arrays match →
  // next subscription call sees mapsChanged=false → skips. No infinite loop.
  // ---------------------------------------------------------------------------
  store.subscribe((state, prevState) => {
    const mapsChanged = state.nodesById !== prevState.nodesById || state.edgesById !== prevState.edgesById;
    const arraysUnchanged = state.nodes === prevState.nodes && state.edges === prevState.edges;
    if (mapsChanged && arraysUnchanged) {
      // undo/redo restored Maps but left arrays stale — re-derive without
      // triggering history (arrays-only write → equality short-circuits zundo).
      store.setState({
        nodes: nodesFromMap(state.nodesById),
        edges: edgesFromMap(state.edgesById)
      });
    }
  });

  return store;
};

/**
 * Default store instance for use with RuneTypeGraph.
 */
export const useEditorStore = createEditorStore();
