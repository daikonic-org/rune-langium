// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * CST-reuse `.rosetta` renderer (option B).
 *
 * Per node: if its subtree is clean (has a $cstRange and no pendingEditPatch at
 * or under it), slice the original bytes; else regenerate via the render-core,
 * recursing into children (each child reuses if clean). Untouched content is
 * never re-rendered. Replaces serializeModel + mergeSerializedIntoSource.
 */

import {
  renderNode,
  renderExpression,
  RAW_DSL_TYPE,
  type RenderChild,
  type RenderOpts,
  type DehydratedNode
} from '@rune-langium/codegen/rosetta';
import { getSourceComments } from '@rune-langium/core';
import { createSourceTriviaIndex, type SourceTriviaIndex } from './source-trivia.js';
import type { TypeGraphNode } from '../types.js';
import { type DirtyIndex, isSubtreeDirty } from './dirty-paths.js';
import { SCHEMA_BY_TYPE } from '../schemas/schema-by-type.js';

interface CstRange {
  offset: number;
  end: number;
}

function cstRange(node: unknown): CstRange | undefined {
  return (node as { $cstRange?: CstRange }).$cstRange;
}

/**
 * Dev-only observability switch for the schema gate's fallback warning
 * (see below). This package has no established dev/prod runtime split to
 * key off: `import.meta.env.DEV` doesn't type-check here (no `vite/client`
 * types referenced — VE is a library resolved as source by its Vite-based
 * consumers, not a Vite entry point itself; adding that reference would be
 * new infra for one warn line) and `process.env.NODE_ENV` has the same gap
 * (no `@types/node`). Defaults `false` so the schema gate stays silent in
 * production by default — flip to `true` locally (or have a consumer call
 * `setSchemaGateDebug(true)`) to see fallback diagnostics while debugging.
 * Under live-apply forms, intermediate invalid states are the NORMAL
 * editing case — an unconditional warn here would spam production consoles
 * on every serialize of a half-built node.
 */
let schemaGateDebug = false;

/** Enable/disable the schema gate's fallback console.warn (see {@link schemaGateDebug}). */
export function setSchemaGateDebug(enabled: boolean): void {
  schemaGateDebug = enabled;
}

/**
 * True when `node.expression` is a `RawDsl` placeholder (B1 Task 4's
 * pending-reparse escape hatch — see `renderExpr`'s own `RAW_DSL_TYPE` check
 * above). `RawDsl` is a VE-synthetic leaf, never produced by the parser, so
 * it is intentionally ABSENT from the generated `RosettaExpressionSchema`
 * union — a `Condition`/`Operation`/`ShortcutDeclaration` carrying one is a
 * legitimate, expected mid-edit shape, not a schema violation. The schema
 * gate below must not treat it as invalid.
 */
function hasRawDslExpression(node: unknown): boolean {
  const expr = (node as { expression?: { $type?: string } }).expression;
  return expr?.$type === RAW_DSL_TYPE;
}

export interface RenderArgs {
  nodes: TypeGraphNode[];
  originalSource: string;
  dirty: DirtyIndex;
  /**
   * Node ids forced to regenerate regardless of patches — used when an edit
   * lives off the node's `data` subtree (e.g. an `extends` change carried on an
   * EDGE, not a `nodes` patch). See Task 6's inheritance handling.
   */
  forceDirtyNodeIds?: ReadonlySet<string>;
  /**
   * Source byte ranges of genuinely-deleted top-level elements. These ranges
   * are subtracted from inter-node gaps so deleted elements do not appear in
   * the assembled output. Pre-sorted by offset; caller is responsible for
   * excluding ranges still occupied by a renamed/replaced node (rename-safety).
   */
  baselineNodes?: readonly DehydratedNode[];
  removedRanges?: ReadonlyArray<{ offset: number; end: number }>;
}

/**
 * Copy bytes from `source[from..to)`, excluding any sub-range in `removed`.
 * `removed` MUST be pre-sorted by offset (ascending). Ranges that fall
 * entirely outside `[from, to)` are silently skipped. Overlapping removed
 * ranges are handled correctly by advancing `cur` to `Math.max(cur, r.end)`.
 */
function copyGapExcluding(
  source: string,
  from: number,
  to: number,
  removed: ReadonlyArray<{ offset: number; end: number }>
): string {
  let out = '';
  let cur = from;
  for (const r of removed) {
    if (r.end <= from || r.offset >= to) continue; // outside this gap
    if (r.offset > cur) out += source.slice(cur, r.offset);
    cur = Math.max(cur, r.end);
  }
  if (cur < to) out += source.slice(cur, to);
  return out;
}

export function renderNamespace(args: RenderArgs): string {
  const { nodes, originalSource, dirty, forceDirtyNodeIds } = args;

  let trivia: SourceTriviaIndex | undefined;
  const getTrivia = () => {
    if (trivia) return trivia;
    const changed = nodes.filter((node) => forceDirtyNodeIds?.has(node.id) || isSubtreeDirty(dirty, node.id, []));
    const scopes = [
      ...changed.flatMap((node) => {
        const range = cstRange(node.data);
        return range ? [range] : [];
      }),
      ...(args.removedRanges ?? [])
    ];
    const rootRanges = nodes
      .flatMap((node) => {
        const range = cstRange(node.data);
        return range ? [range] : [];
      })
      .sort((left, right) => left.offset - right.offset);
    const intervals = scopes.map((scope) => ({
      offset: scope.offset,
      end: rootRanges.find((range) => range.offset >= scope.end)?.offset ?? originalSource.length
    }));
    const baseline = (args.baselineNodes ?? nodes.map((node) => node.data)).filter((node) => {
      const range = cstRange(node);
      return range && scopes.some((scope) => scope.offset <= range.offset && scope.end >= range.end);
    });
    const comments = scopes.length
      ? getSourceComments(originalSource).filter((comment) =>
          intervals.some((interval) => interval.offset <= comment.offset && comment.offset < interval.end)
        )
      : [];
    trivia = createSourceTriviaIndex(
      originalSource,
      baseline,
      comments,
      changed.map((node) => node.data)
    );
    return trivia;
  };
  const originalNewlines = (text: string) => (originalSource.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text);

  // P2 fidelity: an unedited expression body inside an otherwise-dirty node
  // (e.g. a condition renamed but its body untouched) would otherwise fall
  // through render-core's default `exprText`, which renders STRUCTURALLY —
  // dropping comments and collapsing authored multi-line layout. Slice the
  // ORIGINAL source bytes instead whenever the body still carries a clean
  // $cstRange, byte-identical to a whole-node CST reuse.
  //
  // "Range present ⇒ body unedited" is a STRUCTURAL invariant, not a tracked
  // dirty flag: every store expression-edit path (condition/operation/
  // shortcut body) replaces the body wholesale with a rangeless
  // `{ $type: 'RawDsl', text }` leaf (B1 Task 4 fix — no in-place expression
  // mutations exist). A range against the immutable original source can
  // therefore never be "half-updated"; there is no dual-source-of-truth class
  // to guard against here, so no per-body dirty tracking is added.
  const renderExpr: RenderOpts['renderExpr'] = (expr) => {
    const e = expr as { $type?: string; text?: string };
    if (e.$type === RAW_DSL_TYPE) return String(e.text ?? '');
    const range = cstRange(expr);
    // The body is always nested one level inside its owning construct
    // (condition/operation/shortcut), which wraps the returned text in its own
    // `indentBlock` call — so, like a whole-node CHILD reuse, the slice must
    // be normalized to RELATIVE indentation first (see normalizeReusedSlice's
    // doc) or continuation lines end up over-indented by the wrapper's pad.
    if (range)
      return getTrivia().withOwnedTrivia(
        expr as DehydratedNode,
        normalizeReusedSlice(originalSource.slice(range.offset, range.end), originalSource, range.offset),
        true
      );
    return renderExpression(expr as never);
  };

  // Per-node recursive renderer (closes over originalSource + dirty + nodeId).
  function makeRender(nodeId: string) {
    const render = (child: DehydratedNode, dataPath: (string | number)[]): string => {
      const range = cstRange(child);
      const forced = dataPath.length === 0 && (forceDirtyNodeIds?.has(nodeId) ?? false);
      const subtreeDirty = forced || isSubtreeDirty(dirty, nodeId, dataPath);
      // A reused slice that is a CHILD (dataPath.length > 0) gets re-composed by
      // the parent renderer, which re-applies the block's indent via `indentBlock`.
      // Normalize the slice to RELATIVE indentation first so the parent's pad
      // lands uniformly — otherwise continuation lines keep their ABSOLUTE source
      // indentation and get over-indented (+2 per edit) → byte drift. Top-level
      // elements (dataPath.length === 0) are placed verbatim and must stay
      // byte-identical, so they are never normalized.
      const isChild = dataPath.length > 0;
      if (range && !subtreeDirty) {
        return isChild
          ? getTrivia().withOwnedTrivia(child, reuseSlice(originalSource, range, true), true)
          : reuseSlice(originalSource, range, false); // clean → reuse
      }
      const ownedTrivia = getTrivia();
      if (hasRawDslExpression(child)) ownedTrivia.ignoreReplacedExpression(child);
      // Dirty or new → regenerate. renderChild recurses with extended dataPath.
      const renderChild: RenderChild = (c) => {
        const idx = childIndex(child, c, dataPath);
        return render(c, idx);
      };
      // Schema-as-validity-trigger gate: before structural rendering, safeParse
      // the node against its own $type's generated schema. A node that fails
      // (e.g. a RosettaSynonymBody with none of its five alternatives populated
      // — the #363 fallback case, now schema-driven) skips renderNode entirely
      // and falls straight to the SAME CST/skip fallback below, identical to a
      // renderNode-returns-null outcome. render-core's own rosetta subpath stays
      // zod-free; this check lives entirely on the VE side of the seam.
      const childType = (child as { $type: string }).$type;
      const schema = SCHEMA_BY_TYPE[childType];
      if (schema && !hasRawDslExpression(child)) {
        const result = schema.safeParse(child);
        if (!result.success) {
          // Dev-only: under live-apply forms, an intermediate invalid node
          // (mid-edit, not yet complete) is the NORMAL editing case, not an
          // error — an unconditional warn here would spam production
          // consoles on every serialize of a half-built node. See
          // schemaGateDebug's doc for why this is a flag, not
          // import.meta.env.DEV.
          if (schemaGateDebug) {
            console.warn(
              `[cst-reuse] schema validation failed for $type "${childType}" — falling back to CST`,
              result.error.issues.map((i) => ({ path: i.path, message: i.message }))
            );
          }
          if (range) return ownedTrivia.withOwnedTrivia(child, reuseSlice(originalSource, range, isChild), true);
          if (schemaGateDebug) {
            console.warn(
              `[cst-reuse] skipping new node of unimplemented/invalid $type "${childType}" — schema validation failed and no $cstRange`
            );
          }
          return '';
        }
      }
      const generated = renderNode(child, renderChild, { renderExpr });
      if (generated !== null) return originalNewlines(ownedTrivia.withOwnedTrivia(child, generated, false));
      if (range) return ownedTrivia.withOwnedTrivia(child, reuseSlice(originalSource, range, isChild), true); // unimplemented but had bytes
      // Brand-new node of an unimplemented $type — no bytes to slice and no
      // renderer to regenerate it. Degrade gracefully: return '' so this node is
      // absent from the output rather than crashing the source-sync effect.
      console.warn(
        `[cst-reuse] skipping new node of unimplemented $type "${(child as { $type: string }).$type}" — renderNode returned null and no $cstRange`
      );
      return '';
    };
    return render;
  }

  // Top-level elements that exist in the baseline (have a $cstRange), sorted by
  // source offset, drive the assembly. Gaps between them (header, comments,
  // non-graph elements like functions) are copied verbatim — minus any ranges
  // belonging to genuinely-deleted elements.
  const sortedRemoved = [...(args.removedRanges ?? [])].sort((a, b) => a.offset - b.offset);

  if (sortedRemoved.length > 0) getTrivia();
  const omittedRanges = () =>
    [...sortedRemoved, ...(trivia?.omittedGapRanges() ?? [])].sort((left, right) => left.offset - right.offset);

  const placed = nodes
    .map((n) => ({ n, range: cstRange(n.data) }))
    .filter((x): x is { n: TypeGraphNode; range: CstRange } => x.range !== undefined)
    .sort((a, b) => a.range.offset - b.range.offset);

  const parts: string[] = [];
  let cursor = 0;
  for (const { n, range } of placed) {
    if (range.offset > cursor) parts.push(copyGapExcluding(originalSource, cursor, range.offset, omittedRanges()));
    const render = makeRender(n.id);
    parts.push(render(n.data, []));
    cursor = range.end;
  }
  if (cursor < originalSource.length)
    parts.push(copyGapExcluding(originalSource, cursor, originalSource.length, omittedRanges()));

  // New top-level nodes (no $cstRange) → append at the namespace tail.
  // Filter out empty strings: a fresh node whose $type is unimplemented returns
  // '' from the render closure (graceful skip) and must not appear in output.
  const fresh = nodes.filter((n) => cstRange(n.data) === undefined);
  if (fresh.length > 0) {
    let body = parts.join('');
    if (!body.endsWith('\n')) body += '\n';
    const additions: string[] = [];
    for (const n of fresh) {
      const render = makeRender(n.id);
      const rendered = render(n.data, []);
      if (rendered !== '') additions.push(rendered);
    }
    if (additions.length > 0) {
      return body + '\n' + additions.join('\n\n') + '\n';
    }
    return body;
  }

  return parts.join('');
}

/**
 * Slice a clean/unimplemented subtree from the baseline source. A top-level
 * element is returned verbatim (byte-identical placement). A child slice is
 * normalized to RELATIVE indentation (see {@link normalizeReusedSlice}) so the
 * parent renderer's `indentBlock` re-applies the level uniformly.
 */
function reuseSlice(source: string, range: CstRange, isChild: boolean): string {
  const slice = source.slice(range.offset, range.end);
  return isChild ? normalizeReusedSlice(slice, source, range.offset) : slice;
}

/**
 * Strip the node's own source base-column indentation from every continuation
 * line of a reused CST slice, so the slice composes like freshly-rendered
 * RELATIVE text: line 0 sits at column 0 (the slice starts at the node's first
 * token), and continuation lines are indented relative to it. The parent
 * renderer then re-applies the block's indent uniformly via `indentBlock`.
 *
 * Without this, a reused multi-line child (e.g. a `condition` body) keeps its
 * ABSOLUTE source indentation on continuation lines; `indentBlock` adds the
 * parent level on top, over-indenting every continuation line by the parent pad
 * (+2) on each edit — valid but NOT byte-for-byte `.rosetta`.
 *
 * The base column is the leading whitespace of the baseline line that contains
 * `offset`. Single-line slices need no normalization.
 *
 * NOTE — 2-space indent assumption: this function strips the base-column indent
 * based on the ACTUAL leading whitespace of the containing source line, not a
 * fixed constant. However, render-core's `indentBlock` always pads with 2 spaces
 * per level, matching the Rosetta convention. If the original source used a
 * different indent width (e.g. 4 spaces), the stripped slice is re-indented at
 * 2 spaces per level on regeneration — strictly better than the prior
 * accumulating +2 drift, and acceptable for the Rosetta style convention.
 */
function normalizeReusedSlice(slice: string, source: string, offset: number): string {
  if (slice.indexOf('\n') === -1) return slice; // single line — nothing to re-indent
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  let baseCol = 0;
  while (lineStart + baseCol < source.length) {
    const ch = source[lineStart + baseCol];
    if (ch === ' ' || ch === '\t') baseCol++;
    else break;
  }
  if (baseCol === 0) return slice;
  const lines = slice.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    let strip = 0;
    while (strip < baseCol && (line[strip] === ' ' || line[strip] === '\t')) strip++;
    lines[i] = line.slice(strip);
  }
  return lines.join('\n');
}

/**
 * Compute the dataPath segment for a child relative to its parent's dataPath.
 * The render-core hands us the child object; we locate it among the parent's
 * known child arrays to build the patch-comparable path.
 */
function childIndex(
  parent: DehydratedNode,
  child: DehydratedNode,
  parentPath: (string | number)[]
): (string | number)[] {
  const p = parent as unknown as Record<string, unknown[]>;
  for (const key of CHILD_ARRAY_KEYS) {
    const arr = p[key];
    if (Array.isArray(arr)) {
      const i = arr.indexOf(child);
      if (i >= 0) return [...parentPath, key, i];
    }
  }
  // Child not found in a known array (should not happen for rendered children);
  // fall back to the parent path so the child inherits the parent's dirtiness.
  return parentPath;
}

const CHILD_ARRAY_KEYS = [
  'attributes',
  'conditions',
  'annotations',
  'references',
  'synonyms',
  'enumSynonyms',
  'labels',
  'ruleReferences',
  'enumValues',
  'inputs',
  'operations',
  'shortcuts',
  'postConditions',
  'parameters',
  // Inline type-call args (`Type(param: value)`): `typeCallArgs` on Attribute,
  // `arguments` on a TypeCall (ChoiceOption / TypeAlias wrapped type).
  'typeCallArgs',
  'arguments'
];
