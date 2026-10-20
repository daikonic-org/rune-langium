// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Shared types for the Structure View feature.
 * See docs/superpowers/specs/2026-05-12-structure-view-design.md.
 */

/** MIME type used for drag-drop payloads. */
export const TYPE_REF_PAYLOAD_MIME = 'application/x-rune-type-ref';

/**
 * Every type kind a namespace-explorer row can carry. ALL kinds are draggable
 * (so no row falls back to text-selection on a drag attempt); drop targets gate
 * what they accept via their `accept` list. `Data`/`Choice`/`Enum`/`BasicType`/
 * `Record`/`TypeAlias` are valid attribute type-refs; `Func`/`Annotation` are
 * draggable but accepted by no target (they show the no-drop cursor).
 */
export const TYPE_REF_KINDS = [
  'Data',
  'Choice',
  'Enum',
  'BasicType',
  'Record',
  'TypeAlias',
  'Func',
  'Annotation'
] as const;

export type TypeRefKind = (typeof TYPE_REF_KINDS)[number];

/**
 * Drag payload emitted by NamespaceExplorer items and consumed by drop targets.
 *
 * **Field semantics:**
 * - `typeId`   — canonical node id in `ns.Name` format (e.g. `cdm.trade.Trade`).
 *               Used by `setInheritance` and other operations that reference nodes
 *               by their fully-qualified id.
 * - `typeName` — bare display/AST name (e.g. `Trade`) used in `$refText` writes,
 *               e.g. `updateAttributeType`. This is what the grammar stores as the
 *               unqualified cross-reference text.
 *
 * Drag sources MUST set both fields.
 */
export interface TypeRefPayload {
  readonly rune: 'type-ref';
  readonly namespaceUri: string;
  /** Canonical node id in `ns.Name` format. Used by setInheritance. */
  readonly typeId: string;
  /** Bare AST/display name used in $refText writes. Used by updateAttributeType. */
  readonly typeName: string;
  readonly kind: TypeRefKind;
}

/**
 * Kind-scoped MIME variant so drop targets can filter by `accept` during
 * dragover, when the browser security model makes `getData` return empty.
 *
 * **Recommended drag-source contract:** register BOTH the canonical
 * `TYPE_REF_PAYLOAD_MIME` (with the JSON payload) AND `typeRefMimeForKind(kind)`
 * (with empty value, just a marker). The dual-MIME pattern gives drop targets
 * accept-policy enforcement during the dragover phase.
 *
 * **Single-MIME fallback:** drag sources that register only the canonical MIME
 * will still trigger drop, but accept-policy filtering moves to drop time —
 * the hook can't filter by kind during dragover, so hover may briefly show
 * "accepting" before the drop is rejected if the payload kind isn't in `accept`.
 */
export function typeRefMimeForKind(kind: TypeRefPayload['kind']): string {
  return `${TYPE_REF_PAYLOAD_MIME}+${kind.toLowerCase()}`;
}

/** Type guard for parsed drag payloads. */
export function isTypeRefPayload(value: unknown): value is TypeRefPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.rune === 'type-ref' &&
    typeof v.namespaceUri === 'string' &&
    typeof v.typeId === 'string' &&
    typeof v.typeName === 'string' &&
    typeof v.kind === 'string' &&
    (TYPE_REF_KINDS as ReadonlyArray<string>).includes(v.kind)
  );
}

/**
 * Key used in the expansion map; encodes namespace + type + attribute, plus
 * an optional per-instance discriminator.
 *
 * **Per-instance semantics (Phase 14d, spec 020).** Each visible occurrence of
 * a type tracks its own expansion state — matching XmlSpy / Altova UModel /
 * Liquid Studio / Oxygen XML conventions. The `instancePath` carries the chain
 * of React Flow instance ids of the ancestors leading TO this row's owner (NOT
 * including the owner itself). Two placements of the same type at the same
 * depth produce different `instancePath`s because their parent instance ids
 * differ (e.g. `Trade::buyer::Party` vs `Trade::seller::Party`), so chevrons
 * inside them stay independent.
 *
 * The separator inside the path uses `>` (not `:`) because `:` is already the
 * field separator and we need to round-trip the path through a single string.
 */
export interface StructureExpansionKey {
  readonly namespaceUri: string;
  readonly typeId: string;
  readonly attrName: string;
  /**
   * Chain of React Flow instance ids of ancestors leading to this row's owner,
   * NOT including the owner. Empty/undefined = root-level instance (no ancestors).
   */
  readonly instancePath?: ReadonlyArray<string>;
}

/**
 * Serialise an expansion key for use as a Map / Record key.
 *
 * **Format:**
 * - No `instancePath` (or empty): `${namespaceUri}::${typeId}::${attrName}`
 * - With `instancePath`: `${namespaceUri}::${typeId}::${attrName}::${path.join('>')}`
 *
 * This is the single deterministic per-instance key shape. Root-level rows
 * (empty `instancePath`) serialize without a suffix; nested rows append the
 * ancestor chain. `expansionKey` is the sole serializer — use it everywhere.
 */
export function expansionKey(k: StructureExpansionKey): string {
  const base = `${k.namespaceUri}::${k.typeId}::${k.attrName}`;
  if (!k.instancePath || k.instancePath.length === 0) return base;
  return `${base}::${k.instancePath.join('>')}`;
}

/**
 * Display-shaped condition meta surfaced on a Data / Choice / Function node's
 * header indicator (Phase A; Function added in Phase C — its `conditions` carry
 * both the function's `conditions` and `postConditions`). `name` is the
 * condition's source name (may be empty for unnamed conditions — the renderer
 * falls back to `preview` or an index label); `preview` is a short text
 * rendering of the condition expression produced by `conditionsToDisplay` (no
 * hand-rolled expression serialization).
 */
export interface StructureConditionMeta {
  readonly name: string;
  readonly preview: string;
}

/** Single row inside a Data node, as the Structure View sees it. */
export interface StructureRow {
  readonly attrName: string;
  readonly typeName: string;
  readonly typeKind: 'Data' | 'Choice' | 'Enum' | 'BasicType' | 'Record' | 'TypeAlias' | 'Unresolved';
  readonly targetNodeId?: string;
  readonly targetNamespaceUri?: string;
  readonly cardinality: string;
  readonly isOptional: boolean;
  readonly isInherited: boolean;
  /** Range in the source document (for diagnostic binding + cursor sync). */
  readonly astRange?: { start: number; end: number };
}

/** A Data node in the Structure View graph. */
export interface StructureDataNode {
  /**
   * CANONICAL node id (e.g. `cdm.trade.Party`). Cells / editors look up the
   * shared type description by this id. Multiple visible instances of the same
   * type share the same `id` — they are distinguished by `instanceId`.
   */
  readonly id: string;
  /**
   * Per-instance discriminator id (Phase 14e). The adapter emits one
   * StructureDataNode per visible occurrence of a type; each carries its own
   * `expansions` map so chevrons on different instances don't bleed into each
   * other (e.g. `buyer.Party` vs `seller.Party`).
   *
   * For root placements this equals the canonical `id`. For nested instances
   * it follows the layout's instance-id format
   * (`${parentInstanceId}::${attrName}::${canonicalId}`).
   *
   * The `nodes` map in `StructureGraphInput` is keyed on `instanceId` when
   * the adapter populates it. Layout-only test fixtures may omit `instanceId`;
   * the layout falls back to `id` so existing fixtures continue to work.
   */
  readonly instanceId?: string;
  readonly kind: 'data';
  readonly name: string;
  readonly namespaceUri: string;
  /**
   * True when this node is a deferred curated placeholder whose namespace
   * hasn't been on-demand hydrated yet (forwarded from `GraphNodeMeta.deferred`
   * via `AdapterNode`). Drives the same hydrating-spinner treatment as the
   * main graph canvas.
   */
  readonly deferred?: boolean;
  readonly extendsName?: string;
  readonly extendsNodeId?: string;
  /**
   * Phase A — type-level documentation (the `definition` string on the AST
   * Data node). Surfaced via the header doc (ⓘ) indicator. Undefined / empty
   * when the type has no documentation.
   */
  readonly definition?: string;
  /**
   * Phase A — annotation display strings (e.g. `metadata`, `rootType`) derived
   * from the AST `annotations` via `annotationsToDisplay`. Surfaced via the
   * header annotations (@) indicator. Empty / undefined when none.
   */
  readonly annotations?: readonly string[];
  /**
   * Phase A — condition display meta derived from the AST `conditions` via
   * `conditionsToDisplay`. Surfaced via the header conditions (✓) indicator.
   * Empty / undefined when none.
   */
  readonly conditions?: readonly StructureConditionMeta[];
  readonly rows: ReadonlyArray<StructureRow>;
  /**
   * Direct expansions (attrName → child INSTANCE id). The child id keys into
   * `StructureGraphInput.nodes` (which is per-instance keyed).
   */
  readonly expansions: ReadonlyMap<string, string>;
}

/**
 * A Choice arm — represents one option in a Choice. Unlike Data attributes,
 * Choice arms have no `name` of their own (their identity IS their type) and
 * no cardinality (they are alternatives, not multi-valued).
 */
export interface StructureChoiceArm {
  /** The arm's type name as written in source (e.g., "CashPayment"). */
  readonly typeName: string;
  /** Classification of the referenced type, mirroring StructureRow.typeKind. */
  readonly typeKind: 'Data' | 'Choice' | 'Enum' | 'Builtin' | 'Record' | 'TypeAlias' | 'Unresolved';
  /** Canonical id of the referenced node, when resolvable. */
  readonly targetNodeId?: string;
}

/** A Choice node in the Structure View graph. */
export interface StructureChoiceNode {
  /** Canonical node id; see `StructureDataNode.id` for the per-instance contract. */
  readonly id: string;
  /** Per-instance discriminator (Phase 14e); see `StructureDataNode.instanceId`. */
  readonly instanceId?: string;
  readonly kind: 'choice';
  readonly name: string;
  readonly namespaceUri: string;
  /** See `StructureDataNode.deferred`. */
  readonly deferred?: boolean;
  /** Phase A — type-level documentation; see `StructureDataNode.definition`. */
  readonly definition?: string;
  /** Phase A — annotation display strings; see `StructureDataNode.annotations`. */
  readonly annotations?: readonly string[];
  /**
   * Phase A — condition display meta; see `StructureDataNode.conditions`.
   * Choice declarations may carry conditions in the grammar, so this is
   * accepted symmetrically with Data even though it is usually empty.
   */
  readonly conditions?: readonly StructureConditionMeta[];
  readonly options: ReadonlyArray<StructureChoiceArm>;
  /**
   * Per-arm expansions (Phase 14e/B). Keyed by the arm's `typeName` (since
   * arms have no `attrName` — their identity IS the referenced type), value
   * is the child INSTANCE id in `StructureGraphInput.nodes`. Only arms whose
   * `typeKind` is `Data` or `Choice` are eligible to be expanded; terminal
   * arms (Enum / Builtin / Unresolved) never appear here.
   *
   * Empty (default) for arms that have not been expanded by the user.
   */
  readonly expansions: ReadonlyMap<string, string>;
}

/**
 * A read-only Enum node in the Structure View graph (Phase 14e/A). Materialized
 * when the user focuses an Enum from the namespace explorer; lists the enum's
 * values as plain rows. Enums are terminal — no per-value expansion, no
 * cellComponents wiring, no chevrons.
 */
export interface StructureEnumNode {
  readonly id: string;
  readonly instanceId?: string;
  readonly kind: 'enum';
  readonly name: string;
  readonly namespaceUri: string;
  /** See `StructureDataNode.deferred`. */
  readonly deferred?: boolean;
  /** Enum value names in source order. */
  readonly values: ReadonlyArray<string>;
}

/** A base-type GroupContainer wrap. */
export interface StructureBaseContainer {
  /**
   * Canonical wrapper id (e.g. `cdm.trade.Trade::__base::cdm.trade.TradeBase`).
   * Multiple instances of the same wrapper (one per visible occurrence of the
   * outer type) share the canonical id but differ in `instanceId`.
   */
  readonly id: string;
  /** Per-instance discriminator (Phase 14e); see `StructureDataNode.instanceId`. */
  readonly instanceId?: string;
  readonly kind: 'base';
  /** Canonical inherited type identity for navigation (the wrapper is synthetic). */
  readonly baseTypeId?: string;
  readonly baseTypeName: string;
  readonly baseTypeNamespaceUri: string;
  readonly baseRows: ReadonlyArray<StructureRow>;
  /** INSTANCE id of the child Data node inside this base container. */
  readonly childNodeId: string;
  /**
   * Containment edges from this base level's inherited rows into expanded
   * target nodes (Data/Choice that the user clicked to expand). Values are
   * INSTANCE ids (mirroring StructureDataNode.expansions). Spec §3.2 — base
   * level rows can carry their own expansion edges, scoped per-instance.
   */
  readonly expansions: ReadonlyMap<string, string>;
}

/**
 * A read-only Function node in the Structure View graph (Phase C). Materialized
 * when the user focuses a `RosettaFunction` from the namespace explorer.
 *
 * Functions are RENDERED as a card with the function's inputs presented as
 * stacked Data-style rows (name on top, `type · cardinality` beneath) and a
 * distinct output row (`→ ReturnType · card`). Functions are roots only in this
 * first cut — no nested expansion of input/output types into subtrees (deferred
 * to a later phase), so a function node has no expansion children and renders
 * like a simple Data node with no children column.
 */
export interface StructureFunctionNode {
  readonly id: string;
  readonly instanceId?: string;
  readonly kind: 'function';
  readonly name: string;
  readonly namespaceUri: string;
  /** See `StructureDataNode.deferred`. */
  readonly deferred?: boolean;
  /** Input parameters as stacked Data-style rows (reuses `StructureRow`). */
  readonly inputRows: ReadonlyArray<StructureRow>;
  /** Output as a single Data-style row; undefined when the function has no output. */
  readonly outputRow?: StructureRow;
  /** Phase A — type-level documentation; see `StructureDataNode.definition`. */
  readonly definition?: string;
  /** Phase A — annotation display strings; see `StructureDataNode.annotations`. */
  readonly annotations?: readonly string[];
  /** Phase A — condition display meta; see `StructureDataNode.conditions`. */
  readonly conditions?: readonly StructureConditionMeta[];
}

export type StructureNode =
  | StructureDataNode
  | StructureChoiceNode
  | StructureBaseContainer
  | StructureEnumNode
  | StructureFunctionNode;

/**
 * DOM-measured natural widths for one structure node, keyed by instance id in
 * `StructureGraphInput.measuredWidths`. Produced by the post-render
 * measurement pass in StructureView (measure-then-layout): each rendered
 * node's rows column and header are briefly forced to `max-content` inside a
 * layout effect (no paint in between) and their natural `offsetWidth` is
 * recorded. When present these values replace the character-count estimates
 * in the sizing pass, so the re-layout hugs real rendered content.
 */
export interface MeasuredNodeWidths {
  /** Natural width of the rows column (`.rune-node-rows` / base-rows), border-box. */
  readonly rowsColWidth?: number;
  /** Natural width of the node header (`.rune-node-header`), border-box. */
  readonly headerWidth?: number;
}

/** Full graph input produced by the adapter. */
export interface StructureGraphInput {
  /**
   * INSTANCE id of the root node. Keys into `nodes`. For the root placement
   * the instance id equals the canonical id of the outermost wrapper, so
   * existing callers that pass canonical ids through this field continue to
   * work for non-nested roots.
   *
   * Phase 14e/A: roots may be `data`, `choice`, or `enum` kinds — the adapter
   * materializes whichever the focused type resolves to.
   */
  readonly rootNodeId: string;
  /**
   * Per-instance node map. Keys are `StructureNode.instanceId`; each visible
   * occurrence of a type is its own entry with its own `expansions` map.
   * Look up a node's shared canonical metadata via `.id`.
   */
  readonly nodes: ReadonlyMap<string, StructureNode>;
  /**
   * Optional DOM-measured widths keyed by instance id. When a node has an
   * entry here, the sizing pass uses the measured value (clamped to the same
   * [COL_WIDTH, COL_WIDTH_MAX] envelope) instead of the character-count
   * estimate. Nodes without an entry fall back to estimates, so a partially
   * measured graph still lays out correctly.
   */
  readonly measuredWidths?: ReadonlyMap<string, MeasuredNodeWidths>;
}
