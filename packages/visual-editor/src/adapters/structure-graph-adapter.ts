// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Adapter: studio document state → StructureGraphInput.
 *
 * Walks the focused type's structure, resolving inheritance and type
 * references. Honors the expansion map to decide which complex-typed
 * attributes should produce child nodes.
 *
 * See docs/superpowers/specs/2026-05-12-structure-view-design.md § 3.
 */

import {
  type StructureGraphInput,
  type StructureNode,
  type StructureDataNode,
  type StructureChoiceNode,
  type StructureChoiceArm,
  type StructureBaseContainer,
  type StructureEnumNode,
  type StructureFunctionNode,
  type StructureRow,
  expansionKey
} from '../types/structure-view.js';
import { buildImportAliasMap, importAliasCandidates } from '@rune-langium/core';
import type { NamespaceImport } from '@rune-langium/core';
import { BUILTIN_TYPES } from '../types.js';

export interface AdapterDocument {
  readonly namespaces: ReadonlyArray<{ uri: string }>;
  readonly nodes: ReadonlyArray<AdapterNode>;
}

export interface AdapterNode {
  readonly id: string;
  readonly $type: 'Data' | 'Choice' | 'Enum' | 'Record' | 'TypeAlias' | 'Function';
  readonly name: string;
  readonly namespace: string;
  readonly imports?: readonly NamespaceImport[];
  /**
   * Forwarded from `GraphNodeMeta.deferred` by `graphNodesToAdapterDocument`.
   * True when this node is a deferred curated placeholder whose namespace
   * hasn't been on-demand hydrated yet. Propagated onto the built
   * StructureDataNode/Choice/Enum/Function so structure-view nodes can show
   * the same hydrating-spinner treatment as the main graph canvas.
   */
  readonly deferred?: boolean;
  readonly extends?: string;
  /**
   * Data nodes carry their attributes here. Array entries may be `null`
   * during partial-parse state (the user has typed `attrs:` but the parser
   * hasn't materialized the entry yet); the adapter filters those out.
   * Type widened from `ReadonlyArray<AdapterAttribute>` to
   * `ReadonlyArray<AdapterAttribute | null | undefined>` so consumers
   * reading the type as documentation see the true runtime contract
   * (Copilot review on PR #219; the alternative would be to sanitize at
   * the projection boundary, but the adapter is the canonical tolerator).
   */
  readonly attributes?: ReadonlyArray<AdapterAttribute | null | undefined>;
  /** Choice nodes carry their arms here — real ChoiceOption AST shape (typeCall only, no name/card). */
  readonly choiceOptions?: ReadonlyArray<AdapterChoiceOption | null | undefined>;
  readonly values?: ReadonlyArray<{ name: string }>;
  /**
   * Phase C — Function nodes carry their input parameters here. Inputs are
   * `Attribute`-shaped (same shape as Data `attributes`: name + typeCall + card),
   * so they reuse `AdapterAttribute`. Array entries may be `null` during
   * partial-parse; `buildFunctionNode` filters those out.
   */
  readonly inputs?: ReadonlyArray<AdapterAttribute | null | undefined>;
  /**
   * Phase C — a Function's (optional) output parameter, also `Attribute`-shaped.
   * Null/undefined when the function declares no output.
   */
  readonly output?: AdapterAttribute | null;
  /**
   * Phase A — type metadata projected from the store node by the studio
   * (`graphNodesToAdapterDocument`). All optional: fallback / hydration nodes
   * may omit them. `definition` is the doc string; `annotations` are display
   * strings from `annotationsToDisplay`; `conditions` are
   * `{ name, preview }` pairs from `conditionsToDisplay` (Data only, in
   * practice). The adapter forwards these onto the built StructureNode.
   */
  readonly definition?: string;
  readonly annotations?: readonly string[];
  readonly conditions?: readonly { readonly name: string; readonly preview: string }[];
}

/**
 * Mirrors the real ChoiceOption AST shape: only `typeCall`, no `name`, no `card`.
 * Choice arms are alternatives ("pick one of these types"), not attributes.
 *
 * `typeCall` is optional because partial-parse state (the user has typed
 * `arm:` but no type name yet) yields entries with `typeCall === undefined`.
 * The adapter substitutes a sentinel — see `buildChoiceArm`. Widened type
 * (vs. strict + defensive guards) keeps the runtime contract honest for
 * downstream consumers (Copilot review on PR #219).
 */
export interface AdapterChoiceOption {
  /** The type reference in the same union form as AdapterAttribute.typeCall. */
  readonly typeCall?: { readonly type?: { readonly $refText?: string } } | string;
}

/**
 * Canonical cardinality shape mirroring `model-helpers.ts`'s `CardinalityShape`.
 * Re-declared here (not imported) because that type is not exported, but kept
 * structurally identical so the adapter can be wired to the real Langium AST
 * in Phase 3 without a second migration.
 */
export interface AdapterCardinality {
  readonly inf: number;
  readonly sup?: number;
  readonly unbounded: boolean;
}

export interface AdapterAttribute {
  /**
   * All three core fields are optional because partial-parse state — the user
   * has typed `attrs:` but the parser hasn't finished resolving the row yet —
   * yields entries with one or more missing. The adapter substitutes
   * sentinels (empty string name, `<unresolved>` typeName, `0..1` card)
   * rather than throwing. Type widening here (vs. defensive guards in
   * `buildRow` only) keeps the runtime contract honest for downstream
   * consumers reading the type as documentation (Copilot review on PR #219).
   */
  readonly name?: string;
  readonly typeCall?: { readonly type?: { readonly $refText?: string } } | string;
  readonly card?: AdapterCardinality;
  readonly astRange?: { start: number; end: number };
}

export interface BuildOptions {
  readonly focusedTypeId: string;
  readonly expansionMap: ReadonlyMap<string, boolean>;
}

/**
 * Phase 14e — per-instance materialization makes the SuppressedEdge side-table
 * mechanism obsolete. Under canonical-id dedup, the cache shared one
 * StructureNode across multiple visible references, so a containment edge
 * suppressed by the cycle guard in one context could be promoted later when
 * the same target was reached via a non-cyclic sibling path (replay). Under
 * per-instance materialization, each visible reference builds its own
 * StructureNode independently — there is no shared "completed sibling" to
 * promote into. Cycles are still detected via the canonical-id `path` set
 * (recursion ancestors), but the resulting suppression is purely local: the
 * cyclic row's `expansions` map simply omits the cyclic edge. The row chip
 * remains visible.
 *
 * Sibling cross-references (Trade.party AND Trade.counterparty → Party) are
 * preserved naturally: each gets its own Party instance with its own subtree;
 * the spec §3.2 "completed sibling" semantics now manifest as two visible
 * instances of the same canonical type instead of a shared cross-tree handle.
 *
 * The `SuppressedEdge` interface and `replaySuppressedEdges` helper that this
 * file used to expose are removed — kept here as a doc comment to explain why
 * the cycle-guard branches don't push anything anymore.
 */

// classifyType treats anything in BUILTIN_TYPES as a chip-only "primitive-like" leaf; UI does not drill into them.
const BUILTIN_SET = new Set<string>(BUILTIN_TYPES);

function typeRefText(attr: AdapterAttribute): string {
  // Defensive: during partial-parse (user mid-keystroke in source view) the
  // Langium AST can carry an Attribute node whose `typeCall` hasn't been
  // produced yet. The studio's `graphNodesToAdapterDocument` projection
  // forwards attributes as-is, so an undefined `typeCall` reaches us here.
  // Treat it as an empty/unresolved typeName instead of crashing the render
  // (surfaced as a blank-screen by 2026-05-20 prod-smoke check).
  if (attr.typeCall == null) return '';
  if (typeof attr.typeCall === 'string') return attr.typeCall;
  return attr.typeCall.type?.$refText ?? '';
}

/**
 * Pill-label form of cardinality: `"0..1"`, `"0..*"`, `"1..*"`.
 *
 * Deliberately parens-less; the canonical `formatCardinality` in
 * `model-helpers.ts` returns parens form (`"(0..1)"`) for domain-node
 * display. The structure-view spec calls for the bare form on
 * `StructureRow.cardinality`.
 */
function formatCardinality(card: AdapterCardinality | undefined): string {
  // Defensive: partial-parse attributes may arrive without a `card` block.
  // Fall back to `0..1` (the DSL default) so the row still renders a chip.
  if (!card) return '0..1';
  const inf = typeof card.inf === 'number' ? card.inf : 0;
  const sup = card.unbounded ? '*' : String(card.sup ?? inf);
  return `${inf}..${sup}`;
}

function classifyType(typeName: string, doc: AdapterDocument, caller?: AdapterNode): StructureRow['typeKind'] {
  if (BUILTIN_SET.has(typeName)) return 'BasicType';
  const match = findNodeByName(typeName, doc, caller);
  if (!match) return 'Unresolved';
  if (match.$type === 'Data') return 'Data';
  if (match.$type === 'Choice') return 'Choice';
  if (match.$type === 'Record') return 'Record';
  if (match.$type === 'TypeAlias') return 'TypeAlias';
  return 'Enum'; // remaining $type === 'Enum'
}

// Resolve aliases using the declaring node, since files in one namespace can have different imports.
//
// Rune DSL grammar (rune-dsl.langium) declares `TypeCall.type` and `extends`
// superType references as `[T:QualifiedName]`, so $refText can be either a
// bare name ("Party") or a fully-qualified name ("cdm.product.Party"). We
// handle both forms here so the qualified-name source-drop path (Phase 9)
// resolves correctly.
function findNodeByName(typeName: string, doc: AdapterDocument, caller?: AdapterNode): AdapterNode | undefined {
  // Qualified-ref form: "<ns.segments>.<TypeName>". Split on the last dot:
  // everything before is the namespace, everything after is the simple name.
  // A failed qualified lookup is authoritative — type names can't contain
  // dots in the DSL, so a $refText with dots is unambiguously a qualified
  // reference. Falling back to unqualified matching here would let a
  // typoed namespace silently resolve to a same-named type elsewhere.
  const lastDot = typeName.lastIndexOf('.');
  if (lastDot > 0) {
    const imports = caller?.imports ?? [];
    for (const candidate of importAliasCandidates(typeName, buildImportAliasMap(imports))) {
      const dot = candidate.lastIndexOf('.');
      const match = doc.nodes.find(
        (n) => n.name === candidate.slice(dot + 1) && n.namespace === candidate.slice(0, dot)
      );
      if (match) return match;
    }
    return undefined;
  }

  // Unqualified path: name match, optionally prefer same-namespace caller.
  let firstMatch: AdapterNode | undefined;
  for (const n of doc.nodes) {
    if (n.name !== typeName) continue;
    if (caller && n.namespace === caller.namespace) return n;
    if (!firstMatch) firstMatch = n;
  }
  return firstMatch;
}

function buildRow(
  attr: AdapterAttribute,
  doc: AdapterDocument,
  caller: AdapterNode,
  isInherited = false
): StructureRow {
  const typeName = typeRefText(attr);
  const typeKind = classifyType(typeName, doc, caller);
  const target =
    typeKind !== 'BasicType' && typeKind !== 'Unresolved' && typeKind !== 'Record' && typeKind !== 'TypeAlias'
      ? findNodeByName(typeName, doc, caller)
      : undefined;
  const cardinality = formatCardinality(attr.card);
  return {
    attrName: attr.name ?? '',
    typeName,
    typeKind,
    targetNodeId: target?.id,
    targetNamespaceUri: target?.namespace,
    cardinality,
    // Treat a missing `card` block as the DSL default (0..1) → optional.
    isOptional: (attr.card?.inf ?? 0) === 0,
    isInherited,
    astRange: attr.astRange
  };
}

/**
 * Decide whether `row` should be expanded into a child node for THIS visible
 * occurrence of its owner.
 *
 * **Per-instance semantics (Phase 14d).** `instancePath` carries the chain of
 * React Flow instance ids of the owner's ancestors (NOT including the owner
 * itself). The adapter builds the expansion key with the same `instancePath`
 * the renderer uses for its chevron, so a toggle on one visible occurrence
 * only affects that occurrence's subtree.
 *
 * The expansion map is checked with a plain `=== true` look-up on the
 * per-instance key. Absent entries are collapsed; only an explicit `true`
 * expands. `toggleExpansion` in the store writes `true` on expand and
 * DELETES on collapse, so the map stays compact.
 */
function shouldExpand(
  row: StructureRow,
  ownerNamespace: string,
  ownerTypeName: string,
  expansionMap: ReadonlyMap<string, boolean>,
  instancePath: ReadonlyArray<string>
): boolean {
  if (row.typeKind !== 'Data' && row.typeKind !== 'Choice') return false;
  if (!row.targetNodeId) return false;
  const key = expansionKey({
    namespaceUri: ownerNamespace,
    typeId: ownerTypeName,
    attrName: row.attrName,
    instancePath
  });
  return expansionMap.get(key) === true;
}

function choiceOptRefText(opt: AdapterChoiceOption): string {
  // Mirrors `typeRefText`'s defensive handling — Choice arms can have a
  // missing `typeCall` during partial-parse for the same reason.
  if (opt?.typeCall == null) return '';
  if (typeof opt.typeCall === 'string') return opt.typeCall;
  return opt.typeCall.type?.$refText ?? '';
}

/**
 * Resolve a single ChoiceOption arm into a StructureChoiceArm.
 * Reuses `findNodeByName` (the same lookup `buildRow` uses) to classify and
 * resolve the referenced type — no fabricated name or cardinality.
 */
function buildChoiceArm(opt: AdapterChoiceOption, doc: AdapterDocument, owner: AdapterNode): StructureChoiceArm {
  const refText = choiceOptRefText(opt);
  if (!refText) {
    return { typeName: '<unresolved>', typeKind: 'Unresolved' };
  }
  if (BUILTIN_SET.has(refText)) {
    return { typeName: refText, typeKind: 'Builtin' };
  }
  const target = findNodeByName(refText, doc, owner);
  if (!target) {
    return { typeName: refText, typeKind: 'Unresolved' };
  }
  // Record/TypeAlias are now in the adapter doc (attribute type-refs), so a
  // choice arm referencing one resolves here too — classify as its real kind
  // instead of falling through to 'Enum'. Stays a leaf (isArmExpandable only
  // expands Data/Choice; armKindToRowKind passes the kind through).
  const typeKind: StructureChoiceArm['typeKind'] =
    target.$type === 'Data'
      ? 'Data'
      : target.$type === 'Choice'
        ? 'Choice'
        : target.$type === 'Record'
          ? 'Record'
          : target.$type === 'TypeAlias'
            ? 'TypeAlias'
            : 'Enum';
  return { typeName: refText, typeKind, targetNodeId: target.id };
}

/**
 * Build a StructureChoiceNode for `node` at the given instance id, with an
 * optional `expansions` map of pre-resolved arm expansions (Phase 14e/B). The
 * caller is responsible for materializing the arm targets into `out` before
 * passing their instance ids in via `expansions` — `buildChoiceNode` itself
 * does not recurse.
 */
function buildChoiceNode(
  node: AdapterNode,
  doc: AdapterDocument,
  instanceId: string,
  expansions: ReadonlyMap<string, string> = new Map()
): StructureChoiceNode {
  const arms = (node.choiceOptions ?? [])
    .filter((opt): opt is AdapterChoiceOption => opt != null)
    .map((opt) => buildChoiceArm(opt, doc, node));
  return {
    id: node.id,
    instanceId,
    kind: 'choice',
    name: node.name,
    namespaceUri: node.namespace,
    deferred: node.deferred,
    // Phase A — forward type metadata from the AdapterNode (projected by the
    // studio). Defensive defaults keep fallback/hydration nodes from throwing.
    definition: node.definition,
    annotations: node.annotations,
    conditions: node.conditions,
    options: arms,
    expansions
  };
}

/**
 * Build a StructureEnumNode for `node` at the given instance id (Phase 14e/A).
 * Enum nodes are terminal — no expansion map, no recursion.
 */
function buildEnumNode(node: AdapterNode, instanceId: string): StructureEnumNode {
  return {
    id: node.id,
    instanceId,
    kind: 'enum',
    name: node.name,
    namespaceUri: node.namespace,
    deferred: node.deferred,
    values: (node.values ?? []).map((v) => v.name)
  };
}

/**
 * Build a StructureFunctionNode for `node` at the given instance id (Phase C).
 *
 * Inputs and the (optional) output are `Attribute`-shaped, so they reuse the
 * same `buildRow` path as Data attributes — name on top, `type · cardinality`
 * beneath. Functions are terminal in this first cut: no expansion map, no
 * recursion into input/output types. Meta (definition / annotations /
 * conditions) is forwarded from the AdapterNode (projected by the studio).
 */
function buildFunctionNode(node: AdapterNode, doc: AdapterDocument, instanceId: string): StructureFunctionNode {
  const inputRows = (node.inputs ?? [])
    .filter((a): a is AdapterAttribute => a != null)
    .map((a) => buildRow(a, doc, node, false));
  const outputRow = node.output != null ? buildRow(node.output, doc, node, false) : undefined;
  return {
    id: node.id,
    instanceId,
    kind: 'function',
    name: node.name,
    namespaceUri: node.namespace,
    deferred: node.deferred,
    inputRows,
    outputRow,
    // Phase A — forward type metadata from the AdapterNode (projected by the
    // studio). Defensive defaults keep fallback/hydration nodes from throwing.
    definition: node.definition,
    annotations: node.annotations,
    conditions: node.conditions
  };
}

/**
 * Compose the React Flow instance id a layout placement would assign to an
 * expansion child. Mirrors the layout's `makeInstanceId` so the adapter and
 * layout agree on what `data.instancePath` should look like in renderer chevrons.
 *
 * Layout source of truth: `packages/visual-editor/src/layout/structure-layout.ts:339`.
 *
 * Phase 14e: this is also the key the adapter uses for `out` entries — each
 * unique (parentInstanceId × attrName × canonicalTarget) gets its own
 * StructureNode in the per-instance graph.
 */
function adapterChildInstanceId(parentInstanceId: string, attrName: string, targetCanonicalId: string): string {
  return `${parentInstanceId}::${attrName}::${targetCanonicalId}`;
}

/**
 * Compose the instance id of a base container nested one level deeper than its
 * outer instance (via the layout's `__derived` slot).
 */
function adapterDerivedInstanceId(outerInstanceId: string, innerCanonicalId: string): string {
  return `${outerInstanceId}::__derived::${innerCanonicalId}`;
}

/**
 * Phase 14d helper: walk the inheritance chain of `focused` to determine the
 * canonical id of the OUTERMOST base container wrapping it (or `focused.id`
 * itself if there is no inheritance). Mirrors the wrapper-id construction in
 * `materializeDataWithInheritance` so callers can pre-compute the outermost
 * id before invoking materialization (needed when the outermost id is also
 * used as the layout's rfId — i.e. for the root placement).
 *
 * Cycle protection mirrors the inheritance walk in
 * `materializeDataWithInheritance`: a local `visited` set breaks malformed
 * chains; well-formed inputs cannot self-extend.
 */
function computeOutermostCanonicalId(focused: AdapterNode, doc: AdapterDocument, cache?: Map<string, string>): string {
  if (cache?.has(focused.id)) return cache.get(focused.id) as string;
  if (!focused.extends) {
    cache?.set(focused.id, focused.id);
    return focused.id;
  }
  const visited = new Set<string>([focused.id]);
  let outermost = focused.id;
  let cursor: AdapterNode | undefined = findNodeByName(focused.extends, doc, focused);
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    outermost = `${focused.id}::__base::${cursor.id}`;
    cursor = cursor.extends ? findNodeByName(cursor.extends, doc, cursor) : undefined;
  }
  cache?.set(focused.id, outermost);
  return outermost;
}

/**
 * Phase 14e — full per-instance materialization.
 *
 * Walk a Data node's rows and, for each expanded row, materialize a fresh
 * per-instance subtree. Unlike the previous Phase 14d implementation, `out`
 * is now keyed on instance ids (not canonical ids), so two visible occurrences
 * of the same type (e.g. `buyer.Party` and `seller.Party`) produce two
 * independent StructureDataNode entries with their own `expansions` maps.
 *
 * Toggling a chevron on one instance writes a per-instance store key (the
 * renderer uses `data.instancePath` + self's rfId), and `shouldExpand` for
 * the OTHER instance checks a different key — so siblings stay independent.
 *
 * Cycle protection is keyed on CANONICAL ids (cycles are a property of the
 * type graph, not visible instances) — the `path` set carries canonical ids
 * of recursion ancestors. A second SIBLING instance of an ancestor type is
 * still legal; only re-entering the SAME ancestor (which would loop forever)
 * is suppressed.
 */
function walkAndExpand(
  node: AdapterNode,
  doc: AdapterDocument,
  nodesById: ReadonlyMap<string, AdapterNode>,
  opts: BuildOptions,
  out: Map<string, StructureNode>,
  // Canonical ids of `node`'s ancestors in the current recursion stack. A
  // target already on `path` forms a containment cycle in the layout — the
  // edge is dropped, but the row chip remains visible. Per-instance semantics
  // mean no cross-instance "completed sibling" promotion is needed.
  path: ReadonlySet<string>,
  // Cache mapping a Data target's canonical id to its outermost wrapper's
  // canonical id. Performance-only.
  outerMostCanonicalCache: Map<string, string>,
  // INSTANCE id of the StructureNode being walked. Used as the `out` key for
  // this node's `expansions` map AND as the parent instance id when computing
  // child instance ids.
  currentInstanceId: string,
  // Chain of ancestor instance ids leading to this node (NOT including this
  // node itself).
  instancePath: ReadonlyArray<string>
): void {
  const expansions = new Map<string, string>();
  // Defensive: skip null/undefined entries — they appear in the attributes
  // array briefly during partial-parse when the user is mid-keystroke.
  const rows = (node.attributes ?? [])
    .filter((a): a is AdapterAttribute => a != null)
    .map((a) => buildRow(a, doc, node, false));

  const placeholder: StructureDataNode = {
    id: node.id,
    instanceId: currentInstanceId,
    kind: 'data',
    name: node.name,
    namespaceUri: node.namespace,
    deferred: node.deferred,
    extendsName: node.extends,
    extendsNodeId: node.extends ? findNodeByName(node.extends, doc, node)?.id : undefined,
    // Phase A — forward type metadata from the AdapterNode (projected by the
    // studio). Defensive defaults keep fallback/hydration nodes from throwing.
    definition: node.definition,
    annotations: node.annotations,
    conditions: node.conditions,
    rows,
    expansions
  };
  out.set(currentInstanceId, placeholder);

  // Cycle guard carries CANONICAL ids — cycles are properties of the type
  // graph, not visible instances.
  const nextPath = new Set(path);
  nextPath.add(node.id);
  const childInstancePath: ReadonlyArray<string> = [...instancePath, currentInstanceId];

  for (const row of rows) {
    if (shouldExpand(row, node.namespace, node.name, opts.expansionMap, childInstancePath) && row.targetNodeId) {
      const target = nodesById.get(row.targetNodeId);
      if (!target) continue;
      if (target.$type !== 'Data' && target.$type !== 'Choice') continue;
      if (nextPath.has(target.id)) {
        // Cyclic; drop the containment edge silently. The row chip remains.
        continue;
      }
      if (target.$type === 'Data') {
        const targetOutermostCanonical = computeOutermostCanonicalId(target, doc, outerMostCanonicalCache);
        const childInstanceId = adapterChildInstanceId(currentInstanceId, row.attrName, targetOutermostCanonical);
        const expandedId = materializeDataWithInheritance(
          target,
          doc,
          nodesById,
          opts,
          out,
          nextPath,
          outerMostCanonicalCache,
          childInstanceId,
          childInstancePath
        );
        expansions.set(row.attrName, expandedId);
      } else {
        const childInstanceId = adapterChildInstanceId(currentInstanceId, row.attrName, target.id);
        if (!out.has(childInstanceId)) {
          // Phase 14e/B — Choice arms are now expandable too. Recurse into the
          // arm-expansion walk with the same per-instance path conventions so
          // a Choice reached via a Data expansion can have its own arms drilled.
          const armExpansions = expandChoiceArms(
            target,
            doc,
            nodesById,
            opts,
            out,
            nextPath,
            outerMostCanonicalCache,
            childInstanceId,
            childInstancePath
          );
          out.set(childInstanceId, buildChoiceNode(target, doc, childInstanceId, armExpansions));
        }
        expansions.set(row.attrName, childInstanceId);
      }
    }
  }
}

/**
 * Materialize a Data node into `out` with its full inheritance chain, per
 * instance. Returns the INSTANCE id that a containment edge should point at —
 * either the outermost base container's instance id (if the node has
 * `extends`) or the focused node's own instance id.
 *
 * Shared between `buildStructureGraph` (focused root) and `walkAndExpand`
 * (each expanded Data target). Containment is the single mechanism for both
 * inheritance and type-reference per spec §3.2.
 *
 * Phase 14e (per-instance materialization): each call builds FRESH
 * StructureNode entries keyed under instance ids; multiple visible
 * occurrences of the same canonical type produce multiple, independent
 * subtrees. The `outerMostCanonicalCache` is performance-only (canonical id
 * → canonical outermost id); it does NOT short-circuit re-materialization.
 * Inheritance-chain cycles are broken by a local `visited` set; expansion
 * cycles are guarded by the canonical-id `path` set threaded through.
 */
function materializeDataWithInheritance(
  focused: AdapterNode,
  doc: AdapterDocument,
  nodesById: ReadonlyMap<string, AdapterNode>,
  opts: BuildOptions,
  out: Map<string, StructureNode>,
  path: ReadonlySet<string>,
  outerMostCanonicalCache: Map<string, string>,
  /**
   * INSTANCE id that the OUTERMOST wrapper of this Data type will carry (the
   * outermost base container, or the focused node itself if no inheritance).
   * Used both as the `out` key and as the basis for nested-container instance
   * ids beneath this wrapper.
   */
  outermostInstanceId: string,
  /**
   * Instance path for the OUTERMOST wrapper's `instancePath` (= ancestors of
   * the wrapper, NOT including the wrapper itself). For the root this is
   * `[]`; for an expanded child it's `[...parentPath, parentInstanceId]`.
   * Inner containers (and the focused Data node) build their own deeper
   * paths from this value.
   */
  instancePath: ReadonlyArray<string>
): string {
  // Collect ancestors from nearest base outward, with inheritance-cycle
  // protection. `visited` is intrinsic to the type's chain and local to
  // this call.
  const visited = new Set<string>([focused.id]);
  const ancestors: AdapterNode[] = [];
  let cursor: AdapterNode | undefined = focused.extends ? findNodeByName(focused.extends, doc, focused) : undefined;
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    ancestors.push(cursor);
    cursor = cursor.extends ? findNodeByName(cursor.extends, doc, cursor) : undefined;
  }

  // Compute the canonical id chain of base containers (outermost FIRST).
  // ancestors is INNERMOST → OUTERMOST; reverse for layout placement order.
  const outerToInner = [...ancestors].reverse();
  const baseCanonicalIds = outerToInner.map((baseNode) => `${focused.id}::__base::${baseNode.id}`);

  // Compute the per-instance rfId AND instancePath for each base container,
  // plus the focused Data node. The outermost container's rfId is
  // `outermostInstanceId` (passed in); each inner is the layout's `__derived`
  // slot of the previous outer.
  const baseRfIds: string[] = [];
  const basePaths: Array<ReadonlyArray<string>> = [];
  let prevRfId = outermostInstanceId;
  let prevPath: ReadonlyArray<string> = instancePath;
  // `.entries()` (not `for (let i…)`) so `baseCanonicalId` is typed `string`,
  // not `string | undefined` — the iterator yields the element directly. We
  // also capture the just-computed rfId/path locally instead of re-reading
  // `baseRfIds[i]`/`basePaths[i]`, which removes the redundant index access.
  for (const [i, baseCanonicalId] of baseCanonicalIds.entries()) {
    let myRfId: string;
    let myPath: ReadonlyArray<string>;
    if (i === 0) {
      myRfId = outermostInstanceId;
      myPath = instancePath;
    } else {
      myRfId = adapterDerivedInstanceId(prevRfId, baseCanonicalId);
      myPath = [...prevPath, prevRfId];
    }
    baseRfIds.push(myRfId);
    basePaths.push(myPath);
    prevRfId = myRfId;
    prevPath = myPath;
  }
  // Focused node sits one __derived deeper than the innermost base (or IS
  // the outermost wrapper when there's no inheritance).
  const focusedRfId = ancestors.length === 0 ? outermostInstanceId : adapterDerivedInstanceId(prevRfId, focused.id);
  const focusedPath: ReadonlyArray<string> = ancestors.length === 0 ? instancePath : [...prevPath, prevRfId];

  // Walk the focused Data node first. Under per-instance keying, the
  // canonical-id `path` cycle guard is sufficient — if the focused canonical
  // id is already on `path`, walkAndExpand's per-row check will suppress
  // re-entry via the `nextPath.has(target.id)` guard before recursion. The
  // pre-seed cache sentinel that the previous canonical-keyed implementation
  // needed is no longer required: each call writes its own per-instance
  // entry into `out` under a unique key, so there is no cross-instance
  // collision to defend against.
  walkAndExpand(focused, doc, nodesById, opts, out, path, outerMostCanonicalCache, focusedRfId, focusedPath);

  // No inheritance chain → the focused Data node IS the outermost wrapper.
  if (ancestors.length === 0) {
    outerMostCanonicalCache.set(focused.id, focused.id);
    return focusedRfId;
  }

  // Build containers inside-out. Each base container is its own
  // per-instance entry keyed by its rfId, mirroring the layout placement.
  let childInstanceId = focusedRfId;
  let outermostCanonical = focused.id;
  let outermostRfId = focusedRfId;
  // `.entries()` yields `baseNode` typed `AdapterNode` (not `… | undefined`).
  for (const [ai, baseNode] of ancestors.entries()) {
    const baseCanonicalId = `${focused.id}::__base::${baseNode.id}`;
    // Same defensive filter as walkAndExpand — null entries can briefly appear
    // in inherited-attribute arrays during partial-parse.
    const baseRows = (baseNode.attributes ?? [])
      .filter((a): a is AdapterAttribute => a != null)
      .map((a) => buildRow(a, doc, baseNode, true));

    // Look up the rfId+path computed for this base container above. Loop
    // walks INNERMOST → OUTERMOST; arrays are OUTERMOST → INNERMOST.
    const oi = ancestors.length - 1 - ai;
    // `baseRfIds`/`basePaths` were built with exactly `ancestors.length`
    // entries above, and `oi ∈ [0, ancestors.length)`, so both reads are
    // in-bounds — the non-null assertions encode that structural invariant.
    const baseRfId = baseRfIds[oi]!;
    const baseRowInstancePath = basePaths[oi]!;

    const baseExpansions = new Map<string, string>();
    // Cycle guard set carries CANONICAL ids. Include focused.id, the base
    // type, and the synthetic container id so an inherited row that loops
    // back to any of those levels is correctly suppressed.
    const baseRowPath = new Set(path);
    baseRowPath.add(focused.id);
    baseRowPath.add(baseNode.id);
    baseRowPath.add(baseCanonicalId);

    const baseContainer: StructureBaseContainer = {
      id: baseCanonicalId,
      instanceId: baseRfId,
      kind: 'base',
      baseTypeId: baseNode.id,
      baseTypeName: baseNode.name,
      baseTypeNamespaceUri: baseNode.namespace,
      baseRows,
      childNodeId: childInstanceId,
      expansions: baseExpansions
    };
    out.set(baseRfId, baseContainer);

    // Children of this base's expanded rows see this base container as their
    // immediate parent: instancePath = `[...baseRowInstancePath, baseRfId]`.
    const childExpansionInstancePath: ReadonlyArray<string> = [...baseRowInstancePath, baseRfId];

    for (const row of baseRows) {
      if (!shouldExpand(row, baseNode.namespace, baseNode.name, opts.expansionMap, childExpansionInstancePath))
        continue;
      if (!row.targetNodeId) continue;
      const target = nodesById.get(row.targetNodeId);
      if (!target) continue;
      if (target.$type !== 'Data' && target.$type !== 'Choice') continue;
      if (baseRowPath.has(target.id)) {
        // Cyclic; drop the containment edge. Per-instance materialization
        // means each visible occurrence is independent; no cross-instance
        // replay needed.
        continue;
      }
      if (target.$type === 'Data') {
        const targetOutermostCanonical = computeOutermostCanonicalId(target, doc, outerMostCanonicalCache);
        const targetInstanceId = adapterChildInstanceId(baseRfId, row.attrName, targetOutermostCanonical);
        const expandedId = materializeDataWithInheritance(
          target,
          doc,
          nodesById,
          opts,
          out,
          baseRowPath,
          outerMostCanonicalCache,
          targetInstanceId,
          childExpansionInstancePath
        );
        baseExpansions.set(row.attrName, expandedId);
      } else {
        const targetInstanceId = adapterChildInstanceId(baseRfId, row.attrName, target.id);
        if (!out.has(targetInstanceId)) {
          // Phase 14e/B — inherited Choice rows also get arm-level expansion.
          const armExpansions = expandChoiceArms(
            target,
            doc,
            nodesById,
            opts,
            out,
            baseRowPath,
            outerMostCanonicalCache,
            targetInstanceId,
            childExpansionInstancePath
          );
          out.set(targetInstanceId, buildChoiceNode(target, doc, targetInstanceId, armExpansions));
        }
        baseExpansions.set(row.attrName, targetInstanceId);
      }
    }
    childInstanceId = baseRfId;
    outermostCanonical = baseCanonicalId;
    outermostRfId = baseRfId;
  }

  outerMostCanonicalCache.set(focused.id, outermostCanonical);
  return outermostRfId;
}

/**
 * Phase 14e/B — Choice arm expansion. Walk a Choice node's arms and, for any
 * arm targeting a Data or Choice type whose per-instance expansion key is
 * marked `true`, materialize the target into `out` and return an `expansions`
 * map keyed by the arm's `typeName`.
 *
 * **Arm expansion key convention.** Arms have no `attrName` in the DSL — their
 * identity IS the referenced type. The expansion key uses the arm's `typeName`
 * as the `attrName` slot, mirroring how `StructureChoiceArm.typeName` already
 * keys the layout's `rowOffsets` for Choice nodes. So toggling an arm fires
 * `{ namespaceUri: <choiceNs>, typeId: <choiceName>, attrName: <armTypeName>,
 *   instancePath: <self-inclusive path> }` — same shape as Data row chevrons.
 *
 * **Per-instance semantics.** The renderer builds the key with
 * `[...instancePath, choiceInstanceId]` (self-inclusive), and `shouldExpandArm`
 * checks against the same self-inclusive path so the round-trip is symmetric
 * with `shouldExpand`.
 *
 * Terminal arms (Enum / Builtin / Unresolved) are never expandable — they
 * have no child to materialize. Cycles (an arm pointing back into a Choice
 * already on the recursion path) are dropped silently; the arm chip remains.
 */
function expandChoiceArms(
  node: AdapterNode,
  doc: AdapterDocument,
  nodesById: ReadonlyMap<string, AdapterNode>,
  opts: BuildOptions,
  out: Map<string, StructureNode>,
  path: ReadonlySet<string>,
  outerMostCanonicalCache: Map<string, string>,
  currentInstanceId: string,
  instancePath: ReadonlyArray<string>
): Map<string, string> {
  const expansions = new Map<string, string>();
  const childInstancePath: ReadonlyArray<string> = [...instancePath, currentInstanceId];

  // Seed the cycle-protection path with the CURRENT Choice's canonical id before
  // iterating arms. This mirrors walkAndExpand's convention (lines 397-398: `const
  // nextPath = new Set(path); nextPath.add(node.id)` before the row loop) and
  // ensures self-referential arms are suppressed regardless of the entry path.
  //
  // Without this, Choice-as-arm-target callers (walkAndExpand / materializeDataWithInheritance)
  // pass a `path` containing only Data ancestors — so `path.has(node.id)` is false
  // and a self-arm generates one bogus nested copy before terminating on the second
  // recursion.  Choice-as-root callers (buildStructureGraph) pre-seed the Set with
  // root.id, so they were already correct.  Hoisting the add here makes both paths
  // uniform.
  const nextPath = new Set(path);
  nextPath.add(node.id);

  for (const opt of node.choiceOptions ?? []) {
    if (opt == null) continue;
    const arm = buildChoiceArm(opt, doc, node);
    if (arm.typeKind !== 'Data' && arm.typeKind !== 'Choice') continue;
    if (!arm.targetNodeId) continue;
    const key = expansionKey({
      namespaceUri: node.namespace,
      typeId: node.name,
      attrName: arm.typeName,
      instancePath: childInstancePath
    });
    if (opts.expansionMap.get(key) !== true) continue;

    const target = nodesById.get(arm.targetNodeId);
    if (!target) continue;
    if (target.$type !== 'Data' && target.$type !== 'Choice') continue;
    if (nextPath.has(target.id)) continue; // cycle — drop edge, keep chip

    if (target.$type === 'Data') {
      const targetOutermostCanonical = computeOutermostCanonicalId(target, doc, outerMostCanonicalCache);
      const childInstanceId = adapterChildInstanceId(currentInstanceId, arm.typeName, targetOutermostCanonical);
      const expandedId = materializeDataWithInheritance(
        target,
        doc,
        nodesById,
        opts,
        out,
        nextPath,
        outerMostCanonicalCache,
        childInstanceId,
        childInstancePath
      );
      expansions.set(arm.typeName, expandedId);
    } else {
      // target.$type === 'Choice'
      const childInstanceId = adapterChildInstanceId(currentInstanceId, arm.typeName, target.id);
      if (!out.has(childInstanceId)) {
        const nestedArmExpansions = expandChoiceArms(
          target,
          doc,
          nodesById,
          opts,
          out,
          nextPath,
          outerMostCanonicalCache,
          childInstanceId,
          childInstancePath
        );
        out.set(childInstanceId, buildChoiceNode(target, doc, childInstanceId, nestedArmExpansions));
      }
      expansions.set(arm.typeName, childInstanceId);
    }
  }
  return expansions;
}

export function buildStructureGraph(doc: AdapterDocument, opts: BuildOptions): StructureGraphInput {
  const nodes = new Map<string, StructureNode>();
  // Built once and threaded through the whole (mutually recursive) walk below
  // instead of each recursion level re-scanning doc.nodes with .find().
  const nodesById: ReadonlyMap<string, AdapterNode> = new Map(doc.nodes.map((n) => [n.id, n]));
  const root = nodesById.get(opts.focusedTypeId);
  if (!root) {
    return { rootNodeId: opts.focusedTypeId, nodes };
  }

  if (root.$type === 'Data') {
    // Phase 14e — per-instance materialization. The `out` map is keyed by
    // instance id (one entry per visible occurrence). `outerMostCanonicalCache`
    // is canonical→canonical (performance only).
    //
    // Root instance id === outermost canonical id, matching the layout's
    // root rfId convention so `data.instancePath = []` at the root.
    const outerMostCanonicalCache = new Map<string, string>();
    const outermostCanonicalId = computeOutermostCanonicalId(root, doc, outerMostCanonicalCache);
    const rootInstanceId = materializeDataWithInheritance(
      root,
      doc,
      nodesById,
      opts,
      nodes,
      new Set<string>(),
      outerMostCanonicalCache,
      outermostCanonicalId,
      []
    );
    return { rootNodeId: rootInstanceId, nodes };
  }

  if (root.$type === 'Choice') {
    // Phase 14e/A — wire Choice root rendering. Root instance id === canonical id
    // (matches the layout's root rfId convention so `data.instancePath = []`).
    // Arm expansions are then resolved against the per-instance expansion map.
    const rootInstanceId = root.id;
    const outerMostCanonicalCache = new Map<string, string>();
    const armExpansions = expandChoiceArms(
      root,
      doc,
      nodesById,
      opts,
      nodes,
      new Set<string>([root.id]),
      outerMostCanonicalCache,
      rootInstanceId,
      []
    );
    nodes.set(rootInstanceId, buildChoiceNode(root, doc, rootInstanceId, armExpansions));
    return { rootNodeId: rootInstanceId, nodes };
  }

  if (root.$type === 'Enum') {
    // Phase 14e/A — focused Enum root materializes as a single read-only node
    // listing its values. Enums are terminal: no expansion, no chevrons.
    const rootInstanceId = root.id;
    nodes.set(rootInstanceId, buildEnumNode(root, rootInstanceId));
    return { rootNodeId: rootInstanceId, nodes };
  }

  if (root.$type === 'Function') {
    // Phase C — focused Function root materializes as a single node with its
    // inputs as stacked Data-style rows and a distinct output row. Functions are
    // roots only in this first cut: no nested expansion of input/output types.
    const rootInstanceId = root.id;
    nodes.set(rootInstanceId, buildFunctionNode(root, doc, rootInstanceId));
    return { rootNodeId: rootInstanceId, nodes };
  }

  // Defensive fallback — unknown $type echoes the focused id with empty nodes.
  return { rootNodeId: root.id, nodes };
}

/**
 * Find the first StructureNode whose canonical id matches.
 *
 * Phase 14e: `StructureGraphInput.nodes` is keyed by INSTANCE id (per-instance
 * materialization). Callers that need to look up a node by its canonical id —
 * tests, AST navigation, cell editors — use this helper instead of `nodes.get`.
 *
 * If multiple visible instances share the canonical id (e.g. `buyer.Party`
 * and `seller.Party`), the FIRST entry in iteration order is returned. Use
 * `findAllByCanonicalId` for the full list.
 */
export function findByCanonicalId(
  nodes: ReadonlyMap<string, StructureNode>,
  canonicalId: string
): StructureNode | undefined {
  for (const node of nodes.values()) {
    if (node.id === canonicalId) return node;
  }
  return undefined;
}

/** Return all StructureNodes whose canonical id matches. */
export function findAllByCanonicalId(nodes: ReadonlyMap<string, StructureNode>, canonicalId: string): StructureNode[] {
  const out: StructureNode[] = [];
  for (const node of nodes.values()) {
    if (node.id === canonicalId) out.push(node);
  }
  return out;
}
