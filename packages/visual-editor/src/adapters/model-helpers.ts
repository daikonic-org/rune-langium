// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Display formatting helpers for dehydrated domain-node fields.
 *
 * These convert structured AST model objects (cardinalities, references,
 * annotations, conditions) into display strings for the UI layer.
 * They live here (not in components) so both node components and
 * form components can share them.
 */

import { RAW_DSL_TYPE } from '@rune-langium/codegen/rosetta';
import type { TypeOption } from '../types.js';

// ---------------------------------------------------------------------------
// Cardinality
// ---------------------------------------------------------------------------

interface CardinalityShape {
  inf: number;
  sup?: number;
  unbounded: boolean;
}

/** Format a RosettaCardinality model as a display string, e.g. `(1..*)`. */
export function formatCardinality(card: CardinalityShape | undefined): string {
  if (!card) return '';
  if (card.unbounded) return `(${card.inf}..*)`;
  const sup = card.sup ?? card.inf;
  return `(${card.inf}..${sup})`;
}

/** Parse a cardinality display string back to structured form. */
export function parseCardinality(card?: string): CardinalityShape {
  if (!card) return { inf: 1, sup: 1, unbounded: false };
  const match = card.match(/\(?(\d+)\.\.(\*|\d+)\)?/);
  if (!match) return { inf: 1, sup: 1, unbounded: false };
  const inf = parseInt(match[1]!, 10);
  if (match[2] === '*') return { inf, unbounded: true };
  const sup = parseInt(match[2]!, 10);
  return { inf, sup, unbounded: false };
}

// ---------------------------------------------------------------------------
// Type references
// ---------------------------------------------------------------------------

interface ReferenceShape {
  $refText?: string;
  ref?: unknown;
}

interface TypeCallShape {
  type?: ReferenceShape;
}

/** Get the display name of a type reference (e.g. from a TypeCall). */
export function getTypeRefText(typeCall: TypeCallShape | undefined): string | undefined {
  return typeCall?.type?.$refText;
}

/** Get display text from a Reference-like object. */
export function getRefText(ref: ReferenceShape | undefined): string | undefined {
  return ref?.$refText;
}

/**
 * Resolve a (possibly namespace-qualified) reference-text ref against a
 * flat list of `TypeOption`s, returning the matching option's canonical
 * `value`, or `null` if there's no match.
 *
 * `refText` is either a bare name (globally unique among candidates of the
 * SAME referenceable kind, so it matches an option's `label` directly) or a
 * namespace-qualified `${namespace}.${name}` string — written by e.g.
 * `disambiguateTypeRef` in `editor-store.ts` when the bare name collides
 * elsewhere in the graph. That qualified shape is exactly
 * `qualifiedExportPath`'s format, i.e. identical to a graph-backed option's
 * canonical `value`. Try `value` first so a qualified cross-namespace ref
 * still resolves, instead of only ever matching a bare `label` (Codex
 * review, PR #494).
 *
 * Callers MUST pass an already-scoped `options` list (e.g. func-kind-only
 * for a Function's `superFunction`), not the full unfiltered type list —
 * bare-name uniqueness is only guaranteed within that scope, and matching
 * against every kind risks an unrelated same-named option (a different
 * kind, or a different namespace) winning the bare-label fallback (Codex
 * review, PR #494).
 */
export function resolveRefTextToOptionValue(refText: string | undefined, options: TypeOption[]): string | null {
  if (!refText) return null;
  return options.find((opt) => opt.value === refText || opt.label === refText)?.value ?? null;
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

interface AnnotationRefShape {
  annotation?: ReferenceShape;
  attribute?: ReferenceShape;
}

export interface AnnotationDisplayInfo {
  name: string;
  attribute?: string;
}

// Cached per raw AnnotationRefShape reference so an unchanged annotation
// (Mutative preserves object identity for array elements untouched by a
// mutation, e.g. a reorder of a sibling annotation) yields the SAME display
// object across calls. Lets consumers key React list items by object
// identity (see useStableKey) instead of array position, which breaks on
// reorder for these id-less display shapes.
const annotationDisplayCache = new WeakMap<AnnotationRefShape, AnnotationDisplayInfo>();

/** Convert Dehydrated<AnnotationRef>[] to display-friendly objects. */
export function annotationsToDisplay(annotations: AnnotationRefShape[] | undefined): AnnotationDisplayInfo[] {
  if (!annotations || annotations.length === 0) return [];
  return annotations.map((ref) => {
    let display = annotationDisplayCache.get(ref);
    if (display === undefined) {
      display = {
        name: ref.annotation?.$refText ?? 'unknown',
        attribute: ref.attribute?.$refText
      };
      annotationDisplayCache.set(ref, display);
    }
    return display;
  });
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

interface ConditionShape {
  name?: string;
  definition?: string;
  expression?: unknown;
  postCondition?: boolean;
}

export interface ConditionDisplayInfo {
  name?: string;
  definition?: string;
  expressionText: string;
  isPostCondition?: boolean;
  /** Raw AST expression object for direct tree conversion in the expression builder. */
  expressionAst?: unknown;
}

/**
 * Extract display text from an expression AST node.
 * Tries the RawDsl leaf's `text` (edited, pending reparse — see RAW_DSL_TYPE),
 * then $cstText (preserved by parser worker), then $cstNode.text, then empty.
 * Shared by condition/operation/shortcut display helpers so all expression
 * body readers agree on precedence (DRY — see FunctionForm.tsx's getCstText).
 */
export function getExpressionDisplayText(expr: unknown): string {
  if (expr && typeof expr === 'object') {
    const rec = expr as Record<string, unknown>;
    if (rec.$type === RAW_DSL_TYPE && typeof rec.text === 'string') return rec.text.trim();
    const cstText = rec.$cstText;
    if (typeof cstText === 'string') return cstText.trim();
    const cstNode = rec.$cstNode;
    if (cstNode && typeof cstNode === 'object') {
      const text = (cstNode as Record<string, unknown>).text;
      if (typeof text === 'string') return text.trim();
    }
  }
  return '';
}

/** Get expression text from a condition model. See {@link getExpressionDisplayText}. */
function getExpressionText(condition: ConditionShape): string {
  return getExpressionDisplayText(condition.expression);
}

// Cached per raw ConditionShape reference — see annotationDisplayCache above
// for why (Mutative reference stability + reorder-safe React list keys via
// useStableKey). Pre- and post-conditions share one cache: a raw condition
// object can only ever appear in one of the two source arrays at a time.
const conditionDisplayCache = new WeakMap<ConditionShape, ConditionDisplayInfo>();

function conditionToDisplay(c: ConditionShape, isPostCondition: boolean): ConditionDisplayInfo {
  let display = conditionDisplayCache.get(c);
  // Also invalidate on a role mismatch, not just a cache miss — the same
  // raw condition reference could in principle be looked up as a regular
  // condition in one call and a post-condition in another (e.g. moved
  // between the two source arrays while keeping its identity), and the
  // cache must not keep serving the FIRST role it ever saw for that
  // reference (Codex review).
  if (display === undefined || display.isPostCondition !== isPostCondition) {
    display = {
      name: c.name ?? undefined,
      definition: c.definition ?? undefined,
      expressionText: getExpressionText(c),
      isPostCondition,
      expressionAst: c.expression
    };
    conditionDisplayCache.set(c, display);
  }
  return display;
}

/** Convert condition models to display-friendly objects. */
export function conditionsToDisplay(
  conditions: ConditionShape[] | undefined,
  postConditions?: ConditionShape[] | undefined
): ConditionDisplayInfo[] {
  const result: ConditionDisplayInfo[] = [];
  for (const c of conditions ?? []) {
    result.push(conditionToDisplay(c, false));
  }
  for (const c of postConditions ?? []) {
    result.push(conditionToDisplay(c, true));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Synonyms
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Member list access (type-aware)
// ---------------------------------------------------------------------------

/**
 * Kind-to-ReactFlow-type mapping. Used to set `Node.type` for
 * component selection, and for display badges.
 */
export const AST_TYPE_TO_NODE_TYPE: Record<string, string> = {
  Data: 'data',
  Choice: 'choice',
  RosettaEnumeration: 'enum',
  RosettaFunction: 'func',
  RosettaRecordType: 'record',
  RosettaTypeAlias: 'typeAlias',
  RosettaBasicType: 'basicType',
  Annotation: 'annotation'
};

export const NODE_TYPE_TO_AST_TYPE: Record<string, string> = {
  data: 'Data',
  choice: 'Choice',
  enum: 'RosettaEnumeration',
  func: 'RosettaFunction',
  record: 'RosettaRecordType',
  typeAlias: 'RosettaTypeAlias',
  basicType: 'RosettaBasicType',
  annotation: 'Annotation'
};

/**
 * Resolve the React-Flow node-kind (`'data' | 'choice' | 'enum' | ...`) for
 * a node or its data payload.
 *
 * Accepts either a React-Flow node (`{ data }`) or the inner `data` payload
 * directly, and resolves via `data.$type` alone. `$type` is guaranteed on
 * every node since the typeKind→$type unification (Phase 2 curated-serializer
 * fix), so the former `node.type` fallback arm is retired. Unrecognised or
 * `$type`-less inputs degrade to the `'data'` last-resort default.
 *
 * Use this helper instead of indexing `AST_TYPE_TO_NODE_TYPE` directly.
 */
export function resolveNodeKind(nodeOrData: unknown): string {
  if (nodeOrData == null) return 'data';
  const obj = nodeOrData as { data?: unknown };
  const d = (obj.data ?? obj) as { $type?: string } | undefined;
  return AST_TYPE_TO_NODE_TYPE[d?.$type ?? ''] ?? 'data';
}
