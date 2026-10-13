// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * @rune-langium/visual-editor — Shared types
 *
 * `Dehydrated<T>` (from `@rune-langium/core`) is the central node payload
 * type: the LOSSLESS editable wire model of any Langium AST node — Langium
 * runtime internals stripped, every `Reference` as strict `{ $refText }`,
 * `$type` required. {@link DomainNodeData} is the discriminated union of
 * `Dehydrated<T>` over every top-level element kind the editor renders, and
 * is the `data` payload of every {@link TypeGraphNode}. UI/editor metadata
 * lives on the sibling {@link GraphNodeMeta} (`node.meta`), never on `data`.
 *
 * The generated Zod schemas from langium-zod validate these shapes directly
 * — no transform layer is needed.
 */

import type { Node, Edge } from '@xyflow/react';
import type { InspectorMetadataActions } from './store/metadata-target.js';
import type {
  Data,
  Choice,
  RosettaEnumeration,
  RosettaFunction,
  RosettaRecordType,
  RosettaTypeAlias,
  RosettaBasicType,
  Annotation,
  AnyDomain
} from '@rune-langium/core';

// Dehydrated<T> — canonical editable wire model (defined in @rune-langium/core)
export type { Dehydrated } from '@rune-langium/core';

// ---------------------------------------------------------------------------
// GraphNodeMeta — UI/editor metadata sibling
// ---------------------------------------------------------------------------

/**
 * UI/editor metadata for a graph node, held on `node.meta` — a sibling of the
 * pure-domain `node.data` payload. `position` is NOT here — it already lives
 * on the ReactFlow node itself.
 */
export interface GraphNodeMeta {
  namespace: string;
  errors: ValidationError[];
  isReadOnly?: boolean;
  hasExternalRefs: boolean;
  /** Derived linked scope facts; never part of the authored domain payload. */
  annotationDefinitions?: Readonly<Record<string, { name: string; namespace: string }>>;
  /** UI-only annotation (not from AST). */
  comments?: string;
  /** True only on deferred-export placeholder nodes (list-only curated types
   *  not yet hydrated). Drives on-demand hydration gating in the explorer. */
  deferred?: boolean;
}

// ---------------------------------------------------------------------------
// Supported top-level AST types (for union/discrimination)
// ---------------------------------------------------------------------------

/** Union of all top-level AST element types that appear as graph nodes. */
export type RootAstElement =
  | Data
  | Choice
  | RosettaEnumeration
  | RosettaFunction
  | RosettaRecordType
  | RosettaTypeAlias
  | RosettaBasicType
  | Annotation;

/**
 * Domain payload of an editor graph node — the discriminated union (on
 * `$type`) of `Dehydrated<T>` over every top-level element kind the editor
 * renders. This is the PURE domain object: lossless, strict `{ $refText }`
 * refs, `$type` required, and NO UI metadata (which lives on `node.meta`).
 *
 * Sourced from the generated core `AnyDomain` union (single source of truth;
 * the editor no longer hand-maintains the arm list — the langium-zod
 * `repository.elementTypes` config drives it).
 */
export type DomainNodeData = AnyDomain;

/**
 * Union of all node-data variants for top-level elements.
 *
 * @deprecated Phase 3 step 3 flipped the substrate: `node.data` is the pure
 * `Dehydrated<T>` domain object. This name is retained as an alias of
 * {@link DomainNodeData} for the existing consumer surface; new code should
 * use `DomainNodeData` directly.
 */
export type AnyGraphNode = DomainNodeData;

// ---------------------------------------------------------------------------
// Type kind (short alias strings for UI/form dispatch)
// ---------------------------------------------------------------------------

/** Short kind strings used for UI dispatch, badge rendering, and form actions. */
export type TypeKind = 'data' | 'choice' | 'enum' | 'func' | 'record' | 'typeAlias' | 'basicType' | 'annotation';

export type EdgeKind = 'extends' | 'attribute-ref' | 'choice-option' | 'enum-extends' | 'type-alias-ref';

/**
 * Data payload for graph edges.
 *
 * The index signature is required for compatibility with ReactFlow's
 * `Edge<T extends Record<string, unknown>>` constraint.
 */
export interface EdgeData {
  kind: EdgeKind;
  label?: string;
  cardinality?: string;
  /** Required for ReactFlow compatibility: Edge<T> requires T extends Record<string, unknown> */
  [key: string]: unknown;
}

export interface ValidationError {
  nodeId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  ruleId?: string;
  line?: number;
  column?: number;
}

/**
 * Props provided to the expression editor render-prop slot.
 *
 * `packages/visual-editor` is editor-agnostic — the host app provides
 * the actual editor implementation (e.g. CodeMirror, Monaco) via a
 * `renderExpressionEditor` prop on `FunctionForm`.
 */
export interface ExpressionEditorSlotProps {
  /** Current expression text. */
  value: string;
  /** Called on every keystroke / change. */
  onChange: (value: string) => void;
  /** Called when the editor loses focus — triggers validation & commit. */
  onBlur: () => void;
  /** Validation error message (null when valid). */
  error?: string | null;
  /** Placeholder text shown when the editor is empty. */
  placeholder?: string;
  /** Raw AST expression object — enables direct tree conversion without reparsing text. */
  expressionAst?: unknown;
  readOnly?: boolean;
  target?: { nodeId: string; kind: 'precondition' | 'postcondition'; index: number };
}

export interface FunctionBodyEditorSlotProps {
  nodeId: string;
  readOnly: boolean;
}

// ---------------------------------------------------------------------------
// Editor Form Types
// ---------------------------------------------------------------------------

/**
 * Built-in type names available in com.rosetta.model.
 * Covers all basic types, record types, and type aliases (spec §1.1):
 *   - Basic types:   boolean, number, string, time, pattern
 *   - Record types:  date, dateTime, zonedDateTime
 *   - Type aliases:  int, productType, eventType, calculation
 */
export const BUILTIN_TYPES = [
  'boolean',
  'number',
  'string',
  'time',
  'pattern',
  'date',
  'dateTime',
  'zonedDateTime',
  'int',
  'productType',
  'eventType',
  'calculation'
] as const;

/** A type option for searchable type selectors. */
export interface TypeOption {
  /** Node ID, or special ID for built-in types. */
  value: string;
  /** Display label (type name). */
  label: string;
  /** Type kind for badge coloring. */
  kind: TypeKind | 'builtin' | 'record' | 'typeAlias' | 'basicType' | 'annotation';
  /** Namespace for grouping in the dropdown. */
  namespace?: string;
}

/** Option for the synonym-source reference picker. */
export interface SourceRefOption {
  /** Canonical id of the source declaration (e.g. `ns.FpML`). */
  value: string;
  /** Display name (bare source name). */
  label: string;
  /** Namespace for cross-namespace qualification. */
  namespace?: string;
}

// ---------------------------------------------------------------------------
// Kind-specific form action interfaces
// ---------------------------------------------------------------------------

/** Actions shared by all type kinds. */
export interface CommonFormActions extends Partial<InspectorMetadataActions> {
  renameType(nodeId: string, newName: string): void;
  deleteType(nodeId: string): void;
  updateDefinition(nodeId: string, definition: string): void;
  updateComments(nodeId: string, comments: string): void;
  addSynonym(nodeId: string, source: string, value?: string): void;
  removeSynonym(nodeId: string, index: number): void;
  addAnnotation(nodeId: string, annotationName: string): void;
  removeAnnotation(nodeId: string, index: number): void;
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
  validate(): ValidationError[];
}

/** Data type–specific editor actions. */
export interface DataFormActions extends CommonFormActions {
  addAttribute(nodeId: string, attrName: string, typeName: string, cardinality: string): void;
  removeAttribute(nodeId: string, attrName: string): void;
  updateAttribute(nodeId: string, oldName: string, newName: string, typeName: string, cardinality: string): void;
  reorderAttribute(nodeId: string, fromIndex: number, toIndex: number): void;
  setInheritance(childId: string, parentId: string | null): void;
}

/** Enum-specific editor actions. */
export interface EnumFormActions extends CommonFormActions {
  addEnumValue(nodeId: string, valueName: string, displayName?: string): void;
  removeEnumValue(nodeId: string, valueName: string): void;
  updateEnumValue(nodeId: string, oldName: string, newName: string, displayName?: string): void;
  reorderEnumValue(nodeId: string, fromIndex: number, toIndex: number): void;
  addEnumValueSynonym(nodeId: string, valueIndex: number, source: string, value: string): void;
  removeEnumValueSynonym(nodeId: string, valueIndex: number, synIndex: number): void;
  setEnumParent(nodeId: string, parentId: string | null): void;
}

/** Choice-specific editor actions. */
export interface ChoiceFormActions extends CommonFormActions {
  addChoiceOption(nodeId: string, typeName: string): void;
  removeChoiceOption(nodeId: string, typeName: string): void;
}

/** Function-specific editor actions. */
export interface FuncFormActions extends CommonFormActions {
  addInputParam(nodeId: string, paramName: string, typeName: string): void;
  removeInputParam(nodeId: string, paramName: string): void;
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
  updateExpression(nodeId: string, expressionText: string, operationIndex?: number): void;
  /** Set (or clear, with `null`) a Function's `superFunction` parent reference. */
  setFunctionParent(nodeId: string, parentId: string | null): void;
}

/** TypeAlias-specific editor actions. */
export interface TypeAliasFormActions extends CommonFormActions {
  updateTypeAliasType(nodeId: string, typeName: string): void;
}

/** Maps each `TypeKind` to its form actions interface. */
export interface FormActionsKindMap {
  data: DataFormActions;
  enum: EnumFormActions;
  choice: ChoiceFormActions;
  func: FuncFormActions;
  record: CommonFormActions;
  typeAlias: TypeAliasFormActions;
  basicType: CommonFormActions;
  annotation: CommonFormActions;
}

/** Intersection of all kind-specific actions (every method available). */
export type AllEditorFormActions = DataFormActions &
  EnumFormActions &
  ChoiceFormActions &
  FuncFormActions &
  TypeAliasFormActions;

/**
 * Kind-aware editor form actions.
 *
 * When parameterized with a specific kind (e.g. `EditorFormActions<'data'>`),
 * only that kind's actions + common actions are available.
 *
 * When unparameterized (`EditorFormActions`), resolves to the full intersection
 * of all kind-specific actions for backward compatibility.
 *
 * @example
 * ```ts
 * // Narrow — DataTypeForm only sees data + common actions
 * const dataActions: EditorFormActions<'data'>;
 * dataActions.addAttribute(...); // ✅
 * dataActions.addEnumValue(...); // ❌ compile error
 *
 * // Full — EditorFormPanel passes the complete set
 * const allActions: EditorFormActions;
 * allActions.addAttribute(...); // ✅
 * allActions.addEnumValue(...); // ✅
 * ```
 */
export type EditorFormActions<K extends TypeKind = TypeKind> = [TypeKind] extends [K]
  ? AllEditorFormActions
  : FormActionsKindMap[K];

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Visibility filter state for the type graph.
 *
 * @config
 * - `namespaces` — only show types from the listed namespaces (e.g., `["com.isda.cdm.product"]`)
 * - `kinds` — restrict to specific node types (`"data"`, `"choice"`, `"enum"`, `"function"`)
 * - `namePattern` — case-insensitive substring or glob match against type names
 * - `hideOrphans` — remove nodes with no edges (types not referenced by any other type)
 *
 * @category Visual Editor
 */
export interface GraphFilters {
  namespaces?: string[];
  kinds?: TypeKind[];
  namePattern?: string;
  hideOrphans?: boolean;
}

export type LayoutDirection = 'TB' | 'LR' | 'BT' | 'RL';
export type LayoutEngine = 'dagre' | 'elk';

export interface LayoutOptions {
  engine?: LayoutEngine;
  direction?: LayoutDirection;
  nodeSeparation?: number;
  rankSeparation?: number;
  /** Group nodes into inheritance trees and lay out each tree independently. */
  groupByInheritance?: boolean;
}

export interface NodeStyleConfig {
  data?: { headerColor?: string; borderColor?: string };
  choice?: { headerColor?: string; borderColor?: string };
  enum?: { headerColor?: string; borderColor?: string };
}

export interface EdgeStyleConfig {
  extends?: { color?: string; strokeWidth?: number };
  'attribute-ref'?: { color?: string; strokeWidth?: number; dashed?: boolean };
  'choice-option'?: { color?: string; strokeWidth?: number };
  'enum-extends'?: { color?: string; strokeWidth?: number };
}

/**
 * Configuration props for the `RuneTypeGraph` component.
 *
 * @config
 * - `layout` — Dagre layout algorithm options (direction, separation distances,
 *   inheritance grouping). Changes trigger a full re-layout.
 * - `nodeStyles` — per-kind header and border color overrides.
 * - `edgeStyles` — per-edge-kind color, stroke width, and dash style overrides.
 * - `initialFilters` — filter state applied on first mount. Does NOT update the
 *   graph if changed after mount — call `ref.setFilters()` imperatively instead.
 * - `showMinimap` — render a minimap overview (default: `false`).
 * - `showControls` — render zoom/fit controls (default: `true`).
 * - `readOnly` — disable edit controls and context menus (default: `true`).
 *
 * @pitfalls
 * - `initialFilters` is only read on mount — passing a new object on re-render
 *   does NOT update the graph filters. Use the `RuneTypeGraphRef.setFilters()`
 *   imperative handle for dynamic filter changes.
 *
 * @category Visual Editor
 */
export interface RuneTypeGraphConfig {
  layout?: LayoutOptions;
  nodeStyles?: NodeStyleConfig;
  edgeStyles?: EdgeStyleConfig;
  initialFilters?: GraphFilters;
  showMinimap?: boolean;
  showControls?: boolean;
  /** Show the always-on kind/edge legend overlay (default true). */
  showLegend?: boolean;
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Event Callbacks
// ---------------------------------------------------------------------------

/** Callback for navigating to a type definition by node ID (namespace::name). */
export type NavigateToNodeCallback = (nodeId: string) => void;

/**
 * Event callbacks for the `RuneTypeGraph` component.
 *
 * @remarks
 * All callbacks are optional. `onModelChanged` fires after every committed edit
 * with the full serialized model as a `Map<namespace, rosettaSource>`. Use it
 * to persist model state.
 *
 * @pitfalls
 * - `onModelChanged` may fire frequently during drag operations — debounce it
 *   before persisting to disk or a backend.
 * - `onValidationChange` fires synchronously after each model mutation and may
 *   deliver validation errors before the UI has fully re-rendered.
 *
 * @category Visual Editor
 */
export interface RuneTypeGraphCallbacks {
  onNodeDoubleClick?: (nodeId: string, data: AnyGraphNode) => void;
  /** Called when a type reference is clicked within a graph node (e.g., attribute type name). */
  onNavigateToType?: NavigateToNodeCallback;
  /** Called when the user switches layout engine from the graph context menu. */
  onLayoutEngineChange?: (engine: LayoutEngine) => void;
  onEdgeSelect?: (edgeId: string, data: EdgeData) => void;
  onSelectionClear?: () => void;
  onContextMenu?: (position: { x: number; y: number }) => void;
  onTypeCreated?: (nodeId: string, kind: TypeKind, name: string) => void;
  onTypeDeleted?: (nodeId: string) => void;
  /**
   * Fires when the graph serializes the model — i.e. on an explicit
   * `exportRosetta()` call. For **automatic** source synchronization on
   * every editor-store edit (regardless of whether the graph view is
   * mounted), consumers should mount the exported `useModelSourceSync`
   * hook in an always-mounted parent (as `EditorPage` does).
   * `RuneTypeGraph` intentionally no longer holds that subscription
   * internally, so source-sync is not coupled to the graph pane's mount
   * lifecycle. May return a Promise — the hook does NOT await it
   * (fire-and-forget).
   */
  onModelChanged?: (serialized: Map<string, string>) => void | Promise<void>;
  onValidationChange?: (errors: ValidationError[]) => void;
}

// ---------------------------------------------------------------------------
// Component Props & Ref
// ---------------------------------------------------------------------------

/**
 * Props for the `RuneTypeGraph` React component.
 *
 * @remarks
 * `config` and `callbacks` are both optional. When omitted, the graph renders
 * in read-only mode with default layout and styling.
 *
 * @category Visual Editor
 * @see {@link RuneTypeGraphConfig}
 * @see {@link RuneTypeGraphCallbacks}
 * @see {@link RuneTypeGraphRef}
 */
export interface RuneTypeGraphProps {
  /** Explicit navigation arrival, including repeated jumps and asynchronously loaded nodes. */
  navigationTarget?: { nodeId: string; revision: number };
  config?: RuneTypeGraphConfig;
  callbacks?: RuneTypeGraphCallbacks;
  className?: string;
}

/**
 * Imperative ref handle for `RuneTypeGraph`.
 *
 * @remarks
 * Obtain via `React.useRef<RuneTypeGraphRef>()` and pass as `ref` to
 * `<RuneTypeGraph ref={ref} />`. All methods are synchronous except
 * `exportImage()`.
 *
 * @pitfalls
 * - `relayout()` triggers a full Dagre computation — avoid calling it in rapid
 *   succession (e.g., in a `useEffect` with frequent deps). Batch layout updates
 *   with a debounce.
 * - `exportImage()` renders the current viewport — hidden nodes (filtered out)
 *   will not appear in the export.
 *
 * @category Visual Editor
 */
export interface RuneTypeGraphRef {
  fitView(): void;
  focusNode(nodeId: string): void;
  search(query: string): string[];
  setFilters(filters: GraphFilters): void;
  getFilters(): GraphFilters;
  relayout(options?: LayoutOptions): void;
  exportImage(format: 'svg' | 'png'): Promise<Blob>;
  exportRosetta(): Map<string, string>;
  /** Get current data for a node by ID (returns null if not found). */
  getNodeData(nodeId: string): AnyGraphNode | null;
  /** Get all current nodes (for building availableTypes list). */
  getNodes(): TypeGraphNode[];
  /** Validate the current graph and return errors. */
  validate(): ValidationError[];
}

// ---------------------------------------------------------------------------
// Namespace Explorer Types
// ---------------------------------------------------------------------------

export interface NamespaceTreeNode {
  namespace: string;
  types: NamespaceTypeEntry[];
  totalCount: number;
  dataCount: number;
  choiceCount: number;
  enumCount: number;
  funcCount: number;
}

export interface NamespaceTypeEntry {
  nodeId: string;
  name: string;
  kind: TypeKind;
  /** Whether this entry is from a system/base-type file (read-only). */
  isSystem?: boolean;
}

export interface VisibilityState {
  /** Namespaces whose types are currently visible on the graph. */
  expandedNamespaces: Set<string>;
  /** Individual nodes hidden within expanded namespaces. */
  hiddenNodeIds: Set<string>;
  /** Whether the explorer panel is open. */
  explorerOpen: boolean;
  /** Which node kinds are visible (all visible by default). */
  visibleNodeKinds: Set<TypeKind>;
  /** Which edge kinds are visible (all visible by default). */
  visibleEdgeKinds: Set<EdgeKind>;
}

// ---------------------------------------------------------------------------
// Typed ReactFlow aliases
// ---------------------------------------------------------------------------

/**
 * Editor graph node. `data` is the PURE `Dehydrated<T>` domain payload
 * ({@link DomainNodeData}); `meta` is the UI/editor metadata sibling
 * ({@link GraphNodeMeta}); `position` stays ReactFlow-native.
 *
 * ReactFlow's `Node<T>` constrains `T extends Record<string, unknown>`.
 * `DomainNodeData` satisfies it structurally: every union arm is a mapped
 * (anonymous) object type, which TypeScript gives an implicit index
 * signature — no explicit index signature is added to the domain object.
 */
export type TypeGraphNode = Node<DomainNodeData> & { meta: GraphNodeMeta };
export type TypeGraphEdge = Edge<EdgeData>;
