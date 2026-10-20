// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Layout: StructureGraphInput → React Flow nodes/edges.
 *
 * Strategy: a node's body is a 2-column flow (rows left, expansions right);
 * expansions are React Flow children with `parentId` set, positioned in the
 * right-hand column. Layout is performed in two passes: (1) size every node
 * bottom-up from its row count and expansions; (2) walk top-down placing each
 * node so each expansion vertically aligns with its source row.
 *
 * Containment is rendered exclusively via React Flow `parentId` +
 * `extent: 'parent'` — no explicit `Edge` records are emitted in Phase 3. If a
 * future phase introduces non-containment edges (e.g., cross-tree handles
 * rendered as a separate edge type), revisit the returned `edges` array.
 *
 * See docs/superpowers/specs/2026-05-12-structure-view-design.md § 3.
 */

import type { Edge, Node } from '@xyflow/react';
import { ENUM_PREVIEW_LIMIT, enumPreviewLabel, enumPreviewRowCount } from '../utils/enum-preview.js';
import type {
  StructureBaseContainer,
  StructureChoiceNode,
  StructureDataNode,
  StructureEnumNode,
  StructureFunctionNode,
  StructureGraphInput,
  StructureNode
} from '../types/structure-view.js';

/**
 * Single source of truth for Structure View layout constants.
 *
 * STRUCTURE_LAYOUT_CSS_VARS derives the CSS geometry directly from these
 * values. Structure roots inject that map for styles.css to consume.
 */
export const STRUCTURE_LAYOUT_CONSTANTS = {
  /**
   * Single-line row height — used by Choice arms and Enum values, which render
   * one line of `--text-2xs` (the arm's type chip, or the enum value name).
   * Kept tight at 28 so those rows read "as before" the stacked-rows change.
   */
  ROW_HEIGHT: 28,
  /**
   * Stacked Data attribute-row height — the rendered footprint of ONE framed
   * row box (`box-sizing: border-box`). XMLSpy-style: each Data row is TWO
   * lines of `--text-2xs` — the attribute NAME on top, the type-chip +
   * cardinality on a second line beneath — wrapped in a hairline-bordered card.
   * 44 accommodates the name and control lines, a half-space inter-line gap,
   * 2×DATA_ROW_PADDING_Y and the hairline border. Rows are framed and separated by
   * DATA_ROW_GAP; the rows stack also carries DATA_ROWS_PADDING top & bottom.
   * Choice/Enum stay on ROW_HEIGHT (28, single-line, unframed). Base-container
   * inherited rows are Data attribute rows, so they use this height too.
   * CSS mirror: `--rune-data-row-height`.
   */
  DATA_ROW_HEIGHT: 44,
  /**
   * Vertical gap BETWEEN consecutive framed Data/base/func rows (the
   * `.rune-node-rows` flex `row-gap`). Distinct from ROW_GAP (8 — the
   * expansion-column vertical gutter). Reserved in the node-sizing math as
   * `(n − 1) × DATA_ROW_GAP` and in each row's center offset (pitch =
   * DATA_ROW_HEIGHT + DATA_ROW_GAP). CSS mirror: `--rune-data-row-gap`.
   */
  DATA_ROW_GAP: 3,
  /**
   * Top AND bottom padding of the framed-rows stack (`.rune-node-rows`
   * `padding-block`) — breathing room between the header and the first framed
   * row, and below the last framed row before the node's bottom edge. Reserved
   * once at top and once at bottom in the node-sizing math, and pushes every
   * row center down by this amount. CSS mirror: `--rune-data-rows-padding`.
   */
  DATA_ROWS_PADDING: 4,
  /**
   * Vertical padding INSIDE each framed row card (top & bottom). Layout-coupled:
   * DATA_ROW_HEIGHT (border-box) budgets content + 2×DATA_ROW_PADDING_Y +
   * 2×hairline border. CSS mirror: `--rune-data-row-padding-y`.
   */
  DATA_ROW_PADDING_Y: 2,
  /**
   * Horizontal padding inside each framed row card (left & right). CSS mirror:
   * `--rune-data-row-padding-x`. (Width has estimate slack, so this is not as
   * tightly layout-coupled as the Y padding, but kept in the SSoT for parity.)
   */
  DATA_ROW_PADDING_X: 4,
  HEADER_HEIGHT: 28,
  /**
   * Minimum rows-column width — a TIGHT floor now that framed rows shrink-wrap
   * to their widest member (the rows-only `estimateRowsColWidth` no longer
   * folds in the header, so the column hugs its content; the node's outer width
   * separately respects `estimateHeaderWidth`). Long CDM type names still grow
   * the column past this floor via the estimate; the floor only stops
   * absurdly-narrow nodes for single-short-attribute types. Lowered from 320
   * (the old header-inclusive floor) so the rows hug. Capped by COL_WIDTH_MAX.
   */
  COL_WIDTH: 96,
  /** Upper clamp on per-node rows-column width — keeps long identifiers from breaking layout. */
  COL_WIDTH_MAX: 600,
  COL_GAP: 32,
  ROW_GAP: 8,
  /**
   * Padding inside a base GroupContainer's yellow dashed border.
   * Stepped 16 → 8 → 4 across the structure-pane polish iterations to
   * progressively tighten the container around its inherited rows so
   * the dashed border doesn't read as a chunky outer-margin. 4px is the
   * absolute floor while keeping the border visually distinct from the
   * row content. CSS mirror lives in styles.css `--rune-base-padding`;
   * both must stay in sync (structure-css-ssot.test.ts asserts this).
   */
  BASE_PADDING: 4,
  /**
   * Uniform inset between a Data/Choice node's chrome edges and its content
   * (header, rows, and right-column expansion children). Equivalent in spirit
   * to BASE_PADDING for base containers — provides visual breathing room on
   * all four sides so content doesn't read as flush-clipped against the card
   * border.
   *
   * Must be mirrored on both sides: (1) layout math (this constant) shifts
   * rowOffsets and child placements by NODE_PADDING so the rendered chrome
   * padding aligns with React Flow's wrapper-relative child positions, and
   * (2) CSS `--rune-node-padding` applies the chrome padding visually. The
   * SSoT test (structure-css-ssot.test.ts Part A) enforces that the two
   * stay numerically in sync. Replaced the earlier CHILD_INSET-only fix
   * (which only padded the right + bottom edges) once the user asked for
   * uniform padding around all content. */
  NODE_PADDING: 4,
  /**
   * Rendered vertical footprint of the Function node's input→output separator
   * (Phase C). The `.rune-node-func-output-sep` rule draws a 1px top border
   * with `var(--space-1)` (4px) margin above AND below: 4 + 1 + 4 = 9px. This
   * footprint sits between the last input row and the output row, so
   * `sizeFunction` MUST reserve it (only when an output exists) or the output
   * row + bottom padding get clipped by `.rune-node`'s `overflow: hidden`.
   * CSS mirror: `--rune-func-output-sep-height` (the separator rule derives its
   * margin/border from this var so the 9px stays in one source). */
  FUNCTION_OUTPUT_SEP_HEIGHT: 9
} as const;

/**
 * The `--rune-*` geometry custom properties, DERIVED from
 * `STRUCTURE_LAYOUT_CONSTANTS` so the layout math (this module) is the single
 * source of truth and the structure-view CSS reads its geometry from JS. Apply
 * this map as an inline `style` on each structure-pane root (RuneTypeGraph,
 * StructureView); descendant `.rune-node-*` rules consume the vars. Replaces the
 * hand-declared `:root` block in styles.css and its parity test — there is now
 * one source, not two kept in sync.
 *
 * Only LAYOUT-bearing vars live here; ornament vars (chip/pill padding, row
 * indent) and the design-system token bridges stay declared in styles.css.
 */
export const STRUCTURE_LAYOUT_CSS_VARS = {
  '--rune-row-height': `${STRUCTURE_LAYOUT_CONSTANTS.ROW_HEIGHT}px`,
  '--rune-data-row-height': `${STRUCTURE_LAYOUT_CONSTANTS.DATA_ROW_HEIGHT}px`,
  '--rune-data-row-gap': `${STRUCTURE_LAYOUT_CONSTANTS.DATA_ROW_GAP}px`,
  '--rune-data-rows-padding': `${STRUCTURE_LAYOUT_CONSTANTS.DATA_ROWS_PADDING}px`,
  '--rune-data-row-padding-y': `${STRUCTURE_LAYOUT_CONSTANTS.DATA_ROW_PADDING_Y}px`,
  '--rune-data-row-padding-x': `${STRUCTURE_LAYOUT_CONSTANTS.DATA_ROW_PADDING_X}px`,
  '--rune-header-height': `${STRUCTURE_LAYOUT_CONSTANTS.HEADER_HEIGHT}px`,
  '--rune-col-width': `${STRUCTURE_LAYOUT_CONSTANTS.COL_WIDTH}px`,
  '--rune-col-gap': `${STRUCTURE_LAYOUT_CONSTANTS.COL_GAP}px`,
  '--rune-row-gap': `${STRUCTURE_LAYOUT_CONSTANTS.ROW_GAP}px`,
  '--rune-base-padding': `${STRUCTURE_LAYOUT_CONSTANTS.BASE_PADDING}px`,
  '--rune-node-padding': `${STRUCTURE_LAYOUT_CONSTANTS.NODE_PADDING}px`,
  '--rune-func-output-sep-height': `${STRUCTURE_LAYOUT_CONSTANTS.FUNCTION_OUTPUT_SEP_HEIGHT}px`
} as const satisfies Record<`--rune-${string}`, string>;

// Internal aliases — keep call sites inside this module readable.
const {
  ROW_HEIGHT,
  DATA_ROW_HEIGHT,
  DATA_ROW_GAP,
  DATA_ROWS_PADDING,
  HEADER_HEIGHT,
  COL_WIDTH,
  COL_WIDTH_MAX,
  COL_GAP,
  ROW_GAP,
  BASE_PADDING,
  NODE_PADDING,
  FUNCTION_OUTPUT_SEP_HEIGHT
} = STRUCTURE_LAYOUT_CONSTANTS;

/**
 * Vertical pitch from one framed Data/base/func row's top to the next — the
 * row footprint plus the inter-row gap. Used to derive each row's center and
 * the total rows-stack height now that rows are framed cards separated by
 * DATA_ROW_GAP (previously rows were flush, so pitch == DATA_ROW_HEIGHT).
 */
const DATA_ROW_PITCH = DATA_ROW_HEIGHT + DATA_ROW_GAP;

/**
 * Total vertical footprint of a stack of `n` framed Data/base/func rows,
 * INCLUDING the top + bottom DATA_ROWS_PADDING and the (n − 1) inter-row gaps.
 * `n === 0` collapses to zero (no padding reserved for an empty stack).
 */
function framedRowsStackHeight(rowCount: number): number {
  if (rowCount <= 0) return 0;
  return 2 * DATA_ROWS_PADDING + rowCount * DATA_ROW_HEIGHT + (rowCount - 1) * DATA_ROW_GAP;
}

interface SizedNode {
  /** Outer width — includes rowsColWidth + (optional COL_GAP + childrenWidth). */
  width: number;
  height: number;
  /**
   * Per-node rows-column width (e2e-batch fix #12). Computed from content so
   * dense CDM types like `AdjustableOrAdjustedOrRelativeDate` aren't clipped
   * by a global COL_WIDTH. The DataNode/ChoiceNode/EnumNode renderers pick this
   * up via `data.rowsColWidth` and set it as inline style on `.rune-node-rows`,
   * overriding the `--rune-col-width` CSS fallback.
   */
  rowsColWidth: number;
  /** attrName → vertical center of the row inside the node body. */
  rowOffsets: Map<string, number>;
}

/**
 * Estimate the rendered width of the framed **rows column** (the
 * `.rune-node-rows` stack) for a Data/Choice/Enum/Function node — ROWS ONLY,
 * NOT including the header.
 *
 * Rows-only is deliberate: the rows now shrink-wrap to their widest member
 * (XMLSpy-style framed cards), so the rendered rows column is tight to the
 * widest row's content — narrower than the node when the header is the wider
 * element. The node's outer width takes the MAX of this and the header width
 * (see `estimateHeaderWidth`) at each size site. Keeping this rows-only also
 * keeps it the correct connector anchor: `rowRightX = NODE_PADDING +
 * rowsColWidth` lands on the framed rows' real right edge.
 *
 * Uses a conservative monospace-ish character-width estimate (~7px @ 12px font)
 * plus per-row chrome (frame border + padding + the right-edge expand chevron).
 * Result is clamped to [COL_WIDTH, COL_WIDTH_MAX]; COL_WIDTH is the minimum
 * sane rows-column width (a tight floor now that the header no longer inflates
 * it). Not pixel-perfect — variable-pitch fonts can render wider; the
 * COL_WIDTH_MAX cap + CSS `text-overflow: ellipsis` are the safety net.
 */
function estimateRowsColWidth(
  rowTexts: ReadonlyArray<{ name: string; typeName: string; card: string; expandable?: boolean }>
): number {
  const CHAR_W = 7;
  // Framed-row chrome ALWAYS present: 2px L/R row padding + hairline border +
  // the chip & cardinality internal padding AND the cardinality parens the
  // char count under-counts (card data is e.g. "1..1" but renders "(1..1)") + a
  // small safety margin. Tighter than the previous flat 48 (which always
  // budgeted the expand chevron → visible empty space inside primitive/enum
  // rows, the slack the user flagged) but not so tight it clips: ~22 keeps a
  // few px margin over real content for typical rows (chip padding-x is now 4px).
  const CHROME_BASE = 22;
  // The right-edge expand control (+/−) renders ONLY for rows whose type is
  // itself expandable (Data / Choice). Reserve its footprint only for those
  // rows so a node of all-primitive attributes hugs its content.
  const EXPAND_CHEVRON = 22;
  let max = 0;
  for (const r of rowTexts) {
    // Type line holds the type chip text + a small gap + the cardinality, so
    // estimate it as typeName + card + 2 chars of separator.
    const lineChars = Math.max(r.name.length, r.typeName.length + r.card.length + 2);
    const w = lineChars * CHAR_W + CHROME_BASE + (r.expandable ? EXPAND_CHEVRON : 0);
    if (w > max) max = w;
  }
  return Math.min(COL_WIDTH_MAX, Math.max(COL_WIDTH, max));
}

/**
 * Whether a structure row renders the right-edge expand control — true only for
 * rows whose target type is itself a structured node (Data / Choice). Mirrors
 * `isRowExpandable` in DataNode.tsx so the width estimate reserves chevron room
 * exactly when the renderer draws it.
 */
function rowIsExpandable(typeKind: string): boolean {
  return typeKind === 'Data' || typeKind === 'Choice';
}

/**
 * Measure-then-layout (user-requested sizing fix): when the StructureView's
 * post-render measurement pass has recorded a node's real rows-column width,
 * prefer it over the character-count estimate. Measured values go through the
 * same [COL_WIDTH, COL_WIDTH_MAX] clamp the estimator applies so the layout's
 * existing floor/ceiling invariants (connector anchors, pathological names)
 * hold either way.
 */
function measuredOrEstimatedRowsColWidth(
  input: StructureGraphInput,
  instanceId: string,
  estimate: () => number
): number {
  const measured = input.measuredWidths?.get(instanceId)?.rowsColWidth;
  if (measured !== undefined && measured > 0) {
    return Math.min(COL_WIDTH_MAX, Math.max(COL_WIDTH, measured));
  }
  return estimate();
}

/** Header counterpart of {@link measuredOrEstimatedRowsColWidth} (no clamp — headers never had one). */
function measuredOrEstimatedHeaderWidth(
  input: StructureGraphInput,
  instanceId: string,
  estimate: () => number
): number {
  const measured = input.measuredWidths?.get(instanceId)?.headerWidth;
  if (measured !== undefined && measured > 0) return measured;
  return estimate();
}

/**
 * Estimate the rendered width of a structure node's HEADER — the
 * `NodeKindBadge` + the type name + (optionally) the meta-indicator cluster.
 *
 * Split out from `estimateRowsColWidth` so the rows column can shrink-wrap to
 * its members while the node's outer width still respects a header that is
 * wider than any row (e.g. `AdjustableOrAdjustedOrRelativeDate` with short
 * attributes). Each size site takes `max(rowsColWidth, estimateHeaderWidth())`
 * for the node's content width.
 *
 * Calibrated against the rendered header (`.rune-node-header`): tightened
 * --space-2 L/R padding (16), badge width per label text (8px/char + 8px
 * chrome — "Data"→40, "Function"→72), badge/name/meta gap --space-1 (4),
 * name ≈ 9px/char, and — when the node carries doc/conditions/annotations —
 * the `StructureMetaIndicators` cluster (gap 4 + ≈ 20 for up to three compact
 * indicators). Must stay in sync with the `.rune-node-*--structure
 * .rune-node-header` padding/gap in styles.css so the node hugs the header.
 *
 * `badgeLabel` is the text rendered inside the badge (e.g. "Data", "Function").
 * Different kinds render different badge widths; passing the label lets the
 * estimate account for the actual rendered text rather than a flat constant.
 */
function estimateHeaderWidth(name: string, hasMeta: boolean, badgeLabel: string = 'Data'): number {
  const HEADER_PADDING = 16; // --space-2 left + right
  // Measured at 1×: "FUNCTION" (8 chars) → 77px offsetWidth.
  // 8 chars × 8px + 0.5px letter-spacing × 8 + 4px×2 padding + 1px×2 border = 77px.
  const BADGE_CHAR_W = 8.5; // base char width + letter-spacing share
  const BADGE_CHROME = 10; // 4px×2 padding + 1px×2 border
  const kindBadgeWidth = badgeLabel.length * BADGE_CHAR_W + BADGE_CHROME;
  const BADGE_GAP = 4; // --space-1
  const NAME_CHAR_W = 9;
  const META_CLUSTER = hasMeta ? 4 + 20 : 0; // gap + indicator cluster (≈ measured 20px)
  return HEADER_PADDING + kindBadgeWidth + BADGE_GAP + name.length * NAME_CHAR_W + META_CLUSTER;
}

/**
 * True when a structure node carries any header meta-indicator (doc /
 * annotations / conditions), so `estimateHeaderWidth` reserves room for the
 * `StructureMetaIndicators` cluster. Structural (duck-typed) so it works for
 * Data / Choice / Function nodes alike — any node may omit the fields.
 */
function nodeHasMeta(node: {
  definition?: string;
  annotations?: readonly unknown[];
  conditions?: readonly unknown[];
}): boolean {
  return (
    (typeof node.definition === 'string' && node.definition.trim().length > 0) ||
    (node.annotations?.length ?? 0) > 0 ||
    (node.conditions?.length ?? 0) > 0
  );
}

/**
 * Phase 14e — per-instance StructureNode keying. With the adapter emitting one
 * StructureNode per visible occurrence (`input.nodes` keyed by instance id),
 * each node already represents a unique placement context. Size cache and
 * cycle protection key on instance id directly — no path-aware composite key
 * needed (each instance is its own entry by construction).
 *
 * Kept as a tiny helper for symmetry with the placement pass and to avoid
 * scattering raw `node.instanceId` reads through size lookups.
 */
function makeSizeCacheKey(instanceId: string): string {
  return instanceId;
}

/**
 * Read a node's effective instance id, falling back to canonical id for tests
 * (and other call sites) that construct StructureGraphInput by hand without
 * setting `instanceId`. The adapter always sets `instanceId`; this fallback
 * preserves test ergonomics so unit tests pinning layout geometry don't need
 * to spell out the instance-id discriminator on every fixture.
 */
function nodeInstanceId(node: StructureNode): string {
  return node.instanceId ?? node.id;
}

/**
 * Simulate `placeDataChildren` / `placeBaseChildren`'s placement walk to compute
 * the bottom of the right-hand column. The placement pass advances `yCursor` to
 * `max(rowTop, yCursor)` so a late-row expansion can land below the simple-sum
 * height; sizing must mirror that math, otherwise children render outside the
 * parent's extent (see review must-fix #6 / #7).
 */
function simulateColumnHeight(
  expansions: ReadonlyMap<string, string>,
  rowOffsets: ReadonlyMap<string, number>,
  input: StructureGraphInput,
  sizes: Map<string, SizedNode>,
  sizing: Set<string>,
  /** Initial yCursor — HEADER_HEIGHT for data nodes, BASE_PADDING+HEADER_HEIGHT
   *  for base containers (whose placement pass starts there to match CSS padding). */
  initialYCursor: number = HEADER_HEIGHT,
  /**
   * Height of the rows being aligned to at THIS level. Data attribute rows
   * (sizeData / base inherited rows) are DATA_ROW_HEIGHT; Choice arms are
   * ROW_HEIGHT. Used to derive each row's top from its center — must match the
   * row height the corresponding place*Children walk uses, or expansion
   * children misalign with their source row.
   */
  rowHeight: number = ROW_HEIGHT
): number {
  let yCursor = initialYCursor;
  for (const [attrName, childInstanceId] of expansions) {
    const child = input.nodes.get(childInstanceId);
    if (!child) continue;
    const childSize = sizeOf(child, sizes, input, sizing);
    if (!childSize) continue;
    const rowCenter = rowOffsets.get(attrName);
    const rowTop = rowCenter !== undefined ? rowCenter - rowHeight / 2 : yCursor;
    const childY = Math.max(rowTop, yCursor);
    yCursor = childY + childSize.height + ROW_GAP;
  }
  // No trailing gap once the last child has been placed; clamp to HEADER_HEIGHT
  // so an empty expansions map still reserves a header strip.
  return Math.max(HEADER_HEIGHT, yCursor - ROW_GAP);
}

/**
 * Compute the SizedNode for a Data node by recursing into per-instance
 * expansion children.
 */
function sizeData(
  node: StructureDataNode,
  sizes: Map<string, SizedNode>,
  input: StructureGraphInput,
  sizing: Set<string>
): SizedNode {
  const rows = node.rows;
  // Data attribute rows are stacked, framed two-line cards → DATA_ROW_HEIGHT
  // each, separated by DATA_ROW_GAP, with DATA_ROWS_PADDING top + bottom. The
  // header is flush with the wrapper top; the rows stack begins one
  // DATA_ROWS_PADDING below it.
  const rowsStackBottom = HEADER_HEIGHT + framedRowsStackHeight(rows.length);

  // Row centers map to their y from the wrapper origin: header (flush) + the
  // rows-stack top padding + i × pitch (row footprint + inter-row gap) + half a
  // row to reach the framed card's vertical center.
  const rowOffsets = new Map<string, number>();
  const rowsTop = HEADER_HEIGHT + DATA_ROWS_PADDING;
  for (const [i, row] of rows.entries()) {
    rowOffsets.set(row.attrName, rowsTop + i * DATA_ROW_PITCH + DATA_ROW_HEIGHT / 2);
  }

  let childrenWidth = 0;
  for (const [, childInstanceId] of node.expansions) {
    const child = input.nodes.get(childInstanceId);
    if (!child) continue;
    const childSize = sizeOf(child, sizes, input, sizing);
    if (!childSize) continue;
    childrenWidth = Math.max(childrenWidth, childSize.width);
  }

  // Height of the right-hand expansions column matches what the placement pass
  // will actually produce (row-aligned + non-overlapping), not the naive sum.
  // simulateColumnHeight starts at the rows-stack top (header + top padding, so
  // a no-offset child aligns near the first framed row) and returns an absolute
  // y-bottom from the wrapper origin.
  const rightColumnAbsBottom =
    node.expansions.size > 0
      ? simulateColumnHeight(node.expansions, rowOffsets, input, sizes, sizing, rowsTop, DATA_ROW_HEIGHT)
      : HEADER_HEIGHT;

  // Width is SPLIT: the framed rows shrink-wrap to their widest member
  // (rowsColWidth, rows-only), while the node's content width also respects the
  // header (kind badge + name + meta) when it is the wider element.
  const rowsColWidth = measuredOrEstimatedRowsColWidth(input, nodeInstanceId(node), () =>
    estimateRowsColWidth(
      rows.map((r) => ({
        name: r.attrName,
        typeName: r.typeName,
        card: r.cardinality,
        expandable: rowIsExpandable(r.typeKind)
      }))
    )
  );
  const headerWidth = measuredOrEstimatedHeaderWidth(input, nodeInstanceId(node), () =>
    estimateHeaderWidth(node.name, nodeHasMeta(node), 'Data')
  );
  // Wrapper dimensions = inner content + NODE_PADDING on the sides (×2) and
  // bottom only for the expansion column (the rows stack carries its own
  // DATA_ROWS_PADDING bottom). rightColumnAbsBottom is measured from the
  // wrapper origin. Header is flush at top (no top inset).
  const leftColumnWidth = Math.max(rowsColWidth, headerWidth);
  const innerWidth = childrenWidth > 0 ? rowsColWidth + COL_GAP + childrenWidth : leftColumnWidth;
  const innerHeight = Math.max(rowsStackBottom, rightColumnAbsBottom + NODE_PADDING);
  return {
    width: Math.max(innerWidth, headerWidth) + 2 * NODE_PADDING,
    height: innerHeight,
    rowsColWidth,
    rowOffsets
  };
}

function sizeChoice(
  node: StructureChoiceNode,
  sizes: Map<string, SizedNode>,
  input: StructureGraphInput,
  sizing: Set<string>
): SizedNode {
  // StructureChoiceArm uses typeName as the row key (arms have no attrName —
  // their identity IS the referenced type). Header is flush with the wrapper
  // top (no top NODE_PADDING — see sizeData for matching rationale).
  const rowOffsets = new Map<string, number>();
  for (const [i, option] of node.options.entries()) {
    rowOffsets.set(option.typeName, HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2);
  }
  const rowsHeight = HEADER_HEIGHT + node.options.length * ROW_HEIGHT;

  // Phase 14e/B — Choice arms gained expansion. Mirror sizeData: walk the
  // arm expansions, take the widest child, and simulate column height so
  // late-arm expansions get the room they need.
  //
  // Test-fixture fallback: pre-Phase-14e layout fixtures construct Choice nodes
  // by hand without `expansions`. Treat absent as an empty map so legacy
  // fixtures keep working without churn (same approach as `nodeInstanceId`).
  const expansions = node.expansions ?? EMPTY_EXPANSIONS;
  let childrenWidth = 0;
  for (const [, childInstanceId] of expansions) {
    const child = input.nodes.get(childInstanceId);
    if (!child) continue;
    const childSize = sizeOf(child, sizes, input, sizing);
    if (!childSize) continue;
    childrenWidth = Math.max(childrenWidth, childSize.width);
  }

  const rightColumnAbsBottom =
    expansions.size > 0
      ? simulateColumnHeight(expansions, rowOffsets, input, sizes, sizing, HEADER_HEIGHT)
      : HEADER_HEIGHT;

  // Choice arms stay single-line, unframed (ROW_HEIGHT) and FILL the column —
  // only Data rows shrink-wrap. So the column width is max(arm content, header)
  // (the header floor that estimateRowsColWidth used to fold in). Arms have no
  // attrName / cardinality — pass empty strings so the row estimate only widens
  // for long typeNames.
  const rowsColWidth = Math.max(
    measuredOrEstimatedRowsColWidth(input, nodeInstanceId(node), () =>
      // Choice arms always expand into their referenced type, so reserve chevron room.
      estimateRowsColWidth(
        node.options.map((arm) => ({ name: arm.typeName, typeName: '', card: '', expandable: true }))
      )
    ),
    measuredOrEstimatedHeaderWidth(input, nodeInstanceId(node), () =>
      estimateHeaderWidth(node.name, nodeHasMeta(node), 'Choice')
    )
  );
  const innerWidth = childrenWidth > 0 ? rowsColWidth + COL_GAP + childrenWidth : rowsColWidth;
  const innerHeight = Math.max(rowsHeight, rightColumnAbsBottom);
  return {
    width: innerWidth + 2 * NODE_PADDING,
    height: innerHeight + NODE_PADDING,
    rowsColWidth,
    rowOffsets
  };
}

const EMPTY_EXPANSIONS: ReadonlyMap<string, string> = new Map();

/**
 * Size a read-only Enum node (Phase 14e/A). Mirrors `sizeChoice` for the
 * value-only case (no expansions). Each value renders as a row at ROW_HEIGHT.
 */
function sizeEnum(node: StructureEnumNode, input: StructureGraphInput): SizedNode {
  const rowOffsets = new Map<string, number>();
  const visibleValues = node.values.slice(0, ENUM_PREVIEW_LIMIT);
  for (const [i, value] of visibleValues.entries()) {
    rowOffsets.set(value, HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2);
  }
  // Enum values stay single-line, unframed (ROW_HEIGHT) and FILL the column.
  // Width is max(longest value name, header) — Enum headers carry no meta
  // cluster (StructureEnumNode has no doc/annotation/condition fields).
  const rowsColWidth = Math.max(
    measuredOrEstimatedRowsColWidth(input, nodeInstanceId(node), () =>
      estimateRowsColWidth([
        ...visibleValues.map((v) => ({ name: v, typeName: '', card: '' })),
        ...(node.values.length > ENUM_PREVIEW_LIMIT
          ? [{ name: enumPreviewLabel(node.values.length), typeName: '', card: '' }]
          : [])
      ])
    ),
    measuredOrEstimatedHeaderWidth(input, nodeInstanceId(node), () => estimateHeaderWidth(node.name, false, 'Enum'))
  );
  return {
    width: rowsColWidth,
    height: HEADER_HEIGHT + enumPreviewRowCount(node.values.length) * ROW_HEIGHT,
    rowsColWidth,
    rowOffsets
  };
}

/**
 * Size a read-only Function node (Phase C). The body is the function's input
 * rows followed by an optional output row, all rendered as stacked Data-style
 * rows → DATA_ROW_HEIGHT (matching sizeData). Functions have no expansion
 * children in this first cut, so there is no right-hand column and no
 * simulateColumnHeight pass — height is the header plus the row stack.
 *
 * **Reserved height (clipping fix).** `.rune-node` is `overflow: hidden`, so
 * the returned height MUST cover everything the renderer draws:
 *   - header (HEADER_HEIGHT)
 *   - each input row (DATA_ROW_HEIGHT)
 *   - when an output exists: the input→output separator
 *     (FUNCTION_OUTPUT_SEP_HEIGHT — the 1px border + 2×space-1 margins) PLUS
 *     the output row (DATA_ROW_HEIGHT)
 *   - the body's bottom NODE_PADDING inset
 * Omitting the separator or NODE_PADDING clips the output row / bottom edge.
 *
 * Width grows from the input/output row texts plus the function name as a
 * header floor, via `estimateRowsColWidth` (same estimator the Data/Choice/Enum
 * sizers use). rowOffsets are keyed by each row's `attrName` (inputs) plus a
 * stable `__output__` sentinel for the output row; the output center is pushed
 * down by FUNCTION_OUTPUT_SEP_HEIGHT to account for the separator above it.
 */
const FUNCTION_OUTPUT_ROW_KEY = '__output__';

function sizeFunction(node: StructureFunctionNode, input: StructureGraphInput): SizedNode {
  const inputRows = node.inputRows;

  // Framed input rows: the stack begins one DATA_ROWS_PADDING below the header,
  // each row is DATA_ROW_HEIGHT separated by DATA_ROW_GAP (pitch).
  const rowsTop = HEADER_HEIGHT + DATA_ROWS_PADDING;
  const rowOffsets = new Map<string, number>();
  for (const [i, row] of inputRows.entries()) {
    rowOffsets.set(row.attrName, rowsTop + i * DATA_ROW_PITCH + DATA_ROW_HEIGHT / 2);
  }
  // Bottom of the input stack (no trailing gap after the last input row).
  const inputStackBottom =
    inputRows.length > 0
      ? rowsTop + inputRows.length * DATA_ROW_HEIGHT + (inputRows.length - 1) * DATA_ROW_GAP
      : rowsTop;

  let contentBottom = inputStackBottom;
  if (node.outputRow) {
    // The separator is a flex item inside .rune-node-rows (row-gap: DATA_ROW_GAP).
    // It gets a row-gap BEFORE it (between last input row and sep) and AFTER it
    // (between sep and output row) — 2 × DATA_ROW_GAP on top of the separator's
    // own margin/height (FUNCTION_OUTPUT_SEP_HEIGHT = 9px).
    const outputTop = inputStackBottom + FUNCTION_OUTPUT_SEP_HEIGHT + 2 * DATA_ROW_GAP;
    rowOffsets.set(FUNCTION_OUTPUT_ROW_KEY, outputTop + DATA_ROW_HEIGHT / 2);
    contentBottom = outputTop + DATA_ROW_HEIGHT;
  }

  const rowTexts = inputRows.map((r) => ({ name: r.attrName, typeName: r.typeName, card: r.cardinality }));
  if (node.outputRow) {
    rowTexts.push({
      name: node.outputRow.attrName,
      typeName: node.outputRow.typeName,
      card: node.outputRow.cardinality
    });
  }
  // Split width — framed rows shrink-wrap (rows-only), node respects the header.
  const rowsColWidth = measuredOrEstimatedRowsColWidth(input, nodeInstanceId(node), () =>
    estimateRowsColWidth(rowTexts)
  );
  const headerWidth = measuredOrEstimatedHeaderWidth(input, nodeInstanceId(node), () =>
    estimateHeaderWidth(node.name, nodeHasMeta(node), 'Function')
  );

  // Reserve the rows-stack bottom DATA_ROWS_PADDING (mirrors the func rows CSS).
  const height = contentBottom + DATA_ROWS_PADDING;

  return {
    width: Math.max(rowsColWidth, headerWidth) + 2 * NODE_PADDING,
    height,
    rowsColWidth,
    rowOffsets
  };
}

/**
 * Compute the SizedNode for a Base container, recursing into the derived inner
 * child and any per-instance row-level expansions.
 */
function sizeBase(
  node: StructureBaseContainer,
  sizes: Map<string, SizedNode>,
  input: StructureGraphInput,
  sizing: Set<string>
): SizedNode {
  const child = input.nodes.get(node.childNodeId);
  const childSize = child
    ? (sizeOf(child, sizes, input, sizing) ?? {
        width: COL_WIDTH,
        height: HEADER_HEIGHT,
        rowsColWidth: COL_WIDTH,
        rowOffsets: new Map()
      })
    : { width: COL_WIDTH, height: HEADER_HEIGHT, rowsColWidth: COL_WIDTH, rowOffsets: new Map() };

  // Base inherited rows ARE Data attribute rows (name + type/card, stacked,
  // framed) → DATA_ROW_HEIGHT + DATA_ROW_GAP + DATA_ROWS_PADDING, matching
  // sizeData's framed-rows stack.
  const baseRowsHeight = HEADER_HEIGHT + framedRowsStackHeight(node.baseRows.length);

  // Base containers can carry their own `expansions` (spec §3.2: containment
  // is uniform across inheritance and type-reference). Each expansion is
  // placed in the right-hand column aligned with the corresponding base row.
  //
  // Row centers must include BASE_PADDING (top) so expansion children placed
  // at rowOffsets.get(attrName) align with the visually-rendered rows — the
  // CSS applies `padding: 16px` (BASE_PADDING) inside .rune-graph-group--base,
  // pushing every rendered row down by that amount relative to the node origin.
  const rowOffsets = new Map<string, number>();
  const baseRowsTop = BASE_PADDING + HEADER_HEIGHT + DATA_ROWS_PADDING;
  for (const [i, baseRow] of node.baseRows.entries()) {
    rowOffsets.set(baseRow.attrName, baseRowsTop + i * DATA_ROW_PITCH + DATA_ROW_HEIGHT / 2);
  }

  let expansionsWidth = 0;
  for (const [, expChildInstanceId] of node.expansions) {
    const expChild = input.nodes.get(expChildInstanceId);
    if (!expChild) continue;
    const expSize = sizeOf(expChild, sizes, input, sizing);
    if (!expSize) continue;
    expansionsWidth = Math.max(expansionsWidth, expSize.width);
  }

  // Mirror the placement pass: late-row expansions can extend below the simple
  // sum of child heights because each child is placed at max(rowTop, yCursor).
  // The simulation starts at BASE_PADDING + HEADER_HEIGHT to match the updated
  // placeBaseChildren yCursor (which was bumped to account for CSS top padding).
  // simulateColumnHeight returns the absolute y-bottom from the node origin, so
  // rightColumnHeight is that value directly — no further adjustment needed.
  const rightColumnHeight =
    node.expansions.size > 0
      ? simulateColumnHeight(node.expansions, rowOffsets, input, sizes, sizing, baseRowsTop, DATA_ROW_HEIGHT)
      : BASE_PADDING + HEADER_HEIGHT;

  // e2e-batch fix #12 (Codex P1 follow-up): compute rowsColWidth FIRST so
  // innerWidth + leftColumn placement can use it. Was computed AFTER
  // innerWidth and then ignored, so wide base rows would overflow into the
  // expansion gutter and right-column expansions would overlap the base
  // rows. Codex caught it in the adversarial pass.
  //
  // baseRowsColWidth covers the base container's own inherited rows; the
  // nested derived child's rowsColWidth keeps the parent wide enough for
  // its own rows column. The base container's effective rowsColWidth is
  // the max of those two — whichever needs more room sets the floor.
  // Base rows fill the column (header floor folded in via estimateHeaderWidth),
  // mirroring Choice/Enum — only top-level Data rows shrink-wrap.
  const baseRowsColWidth = Math.max(
    measuredOrEstimatedRowsColWidth(input, nodeInstanceId(node), () =>
      estimateRowsColWidth(
        node.baseRows.map((r) => ({
          name: r.attrName,
          typeName: r.typeName,
          card: r.cardinality,
          expandable: rowIsExpandable(r.typeKind)
        }))
      )
    ),
    measuredOrEstimatedHeaderWidth(input, nodeInstanceId(node), () =>
      estimateHeaderWidth(node.baseTypeName, false, 'base')
    )
  );
  const rowsColWidth = Math.max(baseRowsColWidth, childSize.rowsColWidth);

  // The base container wraps:
  //  - the base rows (top section, inside top padding)
  //  - the derived child below the base rows (+ ROW_GAP separator)
  //  - expansions positioned in a right-hand column next to the base rows
  // leftColumnHeight is the content height from the node origin (before adding
  // BASE_PADDING bottom). The +BASE_PADDING accounts for the gap between the
  // last base row and the derived child, mirroring placeBaseChildren's
  // y: HEADER_HEIGHT + baseRows.length*DATA_ROW_HEIGHT + BASE_PADDING for the child.
  const leftColumnHeight = baseRowsHeight + childSize.height + BASE_PADDING;
  const innerHeight = Math.max(leftColumnHeight, rightColumnHeight);
  // Left column reserves the wider of (rowsColWidth, derived child's full
  // outer width). rowsColWidth is already floor-clamped to COL_WIDTH by
  // estimateRowsColWidth, so Math.max(rowsColWidth, childSize.width)
  // preserves the previous "min COL_WIDTH" guarantee without needing an
  // explicit COL_WIDTH term.
  const leftColumnWidth = Math.max(rowsColWidth, childSize.width);
  const innerWidth = expansionsWidth > 0 ? leftColumnWidth + COL_GAP + expansionsWidth : leftColumnWidth;

  return {
    width: innerWidth + BASE_PADDING * 2,
    height: innerHeight + BASE_PADDING * 2,
    rowsColWidth,
    rowOffsets
  };
}

/**
 * Compute (and cache) the size of `node` keyed by its per-instance id.
 *
 * **Cache key:** `node.instanceId` (set by the adapter; for the root this
 * equals the canonical id). The adapter emits one StructureNode per visible
 * occurrence, so each instance is unique by construction — no path-aware
 * composite key needed.
 *
 * **Cycle protection:** `sizing: Set<string>` tracks instance ids currently on
 * the stack. Re-entrant sizing of the same instance id (only possible for
 * malformed inputs where an `expansions` value points back at an ancestor
 * instance id) returns a stable placeholder so the layout doesn't stack-
 * overflow. Well-formed adapter output never re-enters the same instance id.
 */
function sizeOf(
  node: StructureNode,
  sizes: Map<string, SizedNode>,
  input: StructureGraphInput,
  sizing: Set<string>
): SizedNode | undefined {
  const instanceId = nodeInstanceId(node);
  const cacheKey = makeSizeCacheKey(instanceId);
  const cached = sizes.get(cacheKey);
  if (cached) return cached;
  if (sizing.has(instanceId)) {
    const placeholder: SizedNode = {
      width: COL_WIDTH,
      height: HEADER_HEIGHT,
      rowsColWidth: COL_WIDTH,
      rowOffsets: new Map()
    };
    sizes.set(cacheKey, placeholder);
    return placeholder;
  }
  sizing.add(instanceId);
  try {
    let sized: SizedNode;
    if (node.kind === 'data') sized = sizeData(node, sizes, input, sizing);
    else if (node.kind === 'choice') sized = sizeChoice(node, sizes, input, sizing);
    else if (node.kind === 'enum') sized = sizeEnum(node, input);
    else if (node.kind === 'function') sized = sizeFunction(node, input);
    else sized = sizeBase(node, sizes, input, sizing);
    sizes.set(cacheKey, sized);
    return sized;
  } finally {
    sizing.delete(instanceId);
  }
}

export interface LayoutResult {
  readonly nodes: ReadonlyArray<Node>;
  readonly edges: ReadonlyArray<Edge>;
}

// Phase 14e: the adapter now emits per-instance StructureNodes with instance
// ids pre-computed (see `adapterChildInstanceId` in structure-graph-adapter.ts).
// The layout consumes those ids directly — no per-edge id construction here.
// The format matches: `${parentInstanceId}::${attrName}::${targetCanonicalId}`.

/**
 * Convert a `StructureGraphInput` into React Flow nodes for the Structure View.
 *
 * Phase 14e — per-instance materialization. The adapter emits one StructureNode
 * per visible occurrence with pre-computed instance ids; the layout consumes
 * those ids directly:
 *   - `input.nodes` is keyed by instance id (`StructureNode.instanceId`).
 *   - `expansions.values()` are CHILD instance ids — direct lookup keys.
 *   - `StructureBaseContainer.childNodeId` is the inner derived child's
 *     instance id.
 *
 * The React Flow node id == `node.instanceId`; the `data` payload still
 * carries the canonical `.id` so cell renderers and AST-binding consumers
 * see one entry per shared type description.
 *
 * Two-pass layout: size every node first (bottom-up, cycle-guarded), then
 * place top-down so expansion children align with their source row.
 *
 * Cycle protection at placement uses a `Set<instanceId>` of ancestors; well-
 * formed adapter output never re-enters the same instance id (the adapter
 * silently drops cyclic edges in per-instance materialization), but malformed
 * inputs still terminate safely via the guard.
 */
export function layoutStructureGraph(input: StructureGraphInput): LayoutResult {
  const sizes = new Map<string, SizedNode>();
  const sizing = new Set<string>();
  const root = input.nodes.get(input.rootNodeId);
  if (!root) return { nodes: [], edges: [] };

  sizeOf(root, sizes, input, sizing);

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  function placeNode(
    instanceId: string,
    parentInstanceId: string | undefined,
    position: { x: number; y: number },
    ancestors: ReadonlySet<string>,
    instanceAncestorPath: readonly string[]
  ): void {
    const n = input.nodes.get(instanceId);
    if (!n) return;
    const sz = sizes.get(makeSizeCacheKey(instanceId));
    if (!sz) return;

    // Dimensions are emitted via THREE channels so all React Flow consumers see
    // a consistent size:
    //  - `style.width/height` — CSS render hint (drives the actual DOM size
    //    before React Flow's auto-measure pass)
    //  - `initialWidth/initialHeight` — RF12-specific initial-only fields read
    //    by `getNodesBounds`, static `fitView`, and other pre-mount dimension
    //    helpers (per RF12 migration docs — top-level `width/height` are now
    //    output-only, populated by RF on measure)
    // After mount, RF populates `node.measured` from the rendered DOM; if CSS
    // drifts from the layout's pre-computed sz, measured wins for parent-extent
    // clamping etc., but initial helpers still get the right answer pre-measure.
    //
    // Visual-polish #11 (PR #210): each parent that places expansion children
    // also threads a `childYByAttrName` map into its `data` so the renderer
    // can draw an SVG connector from the row's right edge to the child's
    // header center. The map is populated below in the placement walks at
    // the same moment childY is computed; here we initialize it lazily so
    // parents with no expansions emit nothing extra.
    // Visual-polish #11 (PR #210): connector overlay needs the y-coordinate
    // of each materialized child keyed by the attrName (Data/base) or arm
    // typeName (Choice) it expanded from. The map is created here and shared
    // by reference with `data.childYByAttrName`; the placement walks below
    // write into the same Map instance, so the renderer sees the populated
    // entries once the synchronous placement pass completes.
    //
    // `connectorGeometry` is a mutable holder for cross-cutting values that
    // need to be written by the placement walk and read by the renderer:
    //   - rowRightX: wrapper-relative x of the row's right edge
    //   - childLeftX: wrapper-relative x of every materialized child's left
    //     edge (all row-level expansions in a parent share the same x)
    // Wrapping in an object lets the synchronous placement pass mutate the
    // values after the React Flow `data` payload has been pushed, and the
    // renderer sees the final values because it reads them after layout
    // returns.
    const childYByAttrName = new Map<string, number>();
    const connectorGeometry: { rowRightX: number; childLeftX: number } = { rowRightX: 0, childLeftX: 0 };

    nodes.push({
      id: instanceId,
      type: n.kind === 'base' ? 'structureBase' : n.kind,
      position,
      // e2e-batch fix #12: `rowsColWidth` flows through to DataNode /
      // ChoiceNode / EnumNode / GroupContainerNode renderers as inline
      // style on `.rune-node-rows`. Each node sets its own rows-column
      // width based on content estimate so CDM-scale type names don't clip.
      data: {
        ...n,
        variant: 'structure',
        instancePath: instanceAncestorPath,
        rowsColWidth: sz.rowsColWidth,
        // rowOffsets and childYByAttrName power the SVG row→child connector
        // overlay rendered inside each parent node component. Both are keyed
        // by attrName (DataNode / GroupContainerNode) or arm typeName
        // (ChoiceNode) so the renderer can pair each expanded row with the
        // child y it actually landed at. `connectorGeometry` is a shared
        // mutable holder so the renderer reads the rowRightX / childLeftX
        // values written by the placement pass — the object reference is
        // stable, the placement pass mutates fields in place.
        rowOffsets: sz.rowOffsets,
        childYByAttrName,
        connectorGeometry
      },
      parentId: parentInstanceId,
      extent: parentInstanceId ? 'parent' : undefined,
      initialWidth: sz.width,
      initialHeight: sz.height,
      style: { width: sz.width, height: sz.height }
    });

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(instanceId);
    const childInstanceAncestorPath = [...instanceAncestorPath, instanceId];

    switch (n.kind) {
      case 'data':
        placeDataChildren(n, sz, nextAncestors, childInstanceAncestorPath, childYByAttrName, connectorGeometry);
        break;
      case 'base':
        placeBaseChildren(n, sz, nextAncestors, childInstanceAncestorPath, childYByAttrName, connectorGeometry);
        break;
      case 'choice':
        placeChoiceChildren(n, sz, nextAncestors, childInstanceAncestorPath, childYByAttrName, connectorGeometry);
        break;
      case 'enum':
        // Phase 14e/A — Enum nodes are terminal; their value list renders
        // as plain rows, no children to place.
        break;
      case 'function':
        // Phase C — Function nodes are terminal in this first cut; inputs and
        // the output render as plain stacked rows with no expansion children.
        break;
      default: {
        const _exhaustive: never = n;
        void _exhaustive;
      }
    }
  }

  function placeDataChildren(
    n: StructureDataNode,
    sz: SizedNode,
    ancestors: ReadonlySet<string>,
    instanceAncestorPath: readonly string[],
    childYByAttrName: Map<string, number>,
    connectorGeometry: { rowRightX: number; childLeftX: number }
  ): void {
    // Visual-polish #11: the Data body has `padding-left: NODE_PADDING`
    // (see styles.css `.rune-node-data--structure .rune-node-body--two-col`),
    // so the rows column sits at wrapper x = NODE_PADDING and ends at
    // wrapper x = NODE_PADDING + rowsColWidth. Children are placed at
    // wrapper x = NODE_PADDING + rowsColWidth + COL_GAP (below).
    connectorGeometry.rowRightX = NODE_PADDING + sz.rowsColWidth;
    connectorGeometry.childLeftX = NODE_PADDING + sz.rowsColWidth + COL_GAP;

    // yCursor floor: header sits flush with the wrapper top; the framed rows
    // stack begins one DATA_ROWS_PADDING below it, so the first expansion's
    // minimum y mirrors sizeData/simulateColumnHeight's `rowsTop` init.
    let yCursor = HEADER_HEIGHT + DATA_ROWS_PADDING;
    for (const [attrName, childInstanceId] of n.expansions) {
      const childSize = sizes.get(makeSizeCacheKey(childInstanceId));
      if (!childSize) continue;

      // Data rows are the stacked two-line rows → DATA_ROW_HEIGHT (matches
      // sizeData's rowOffsets + simulateColumnHeight rowHeight param).
      const rowCenter = sz.rowOffsets.get(attrName);
      const rowTop = rowCenter !== undefined ? rowCenter - DATA_ROW_HEIGHT / 2 : yCursor;
      const childY = Math.max(rowTop, yCursor);

      // Cycle guard: skip placement when the target instance is already on the
      // recursion path (only possible for malformed input — the adapter's
      // SuppressedEdge mechanism prevents this for well-formed graphs).
      //
      // e2e-batch fix #12 follow-up (caught by Sonnet RF review): use
      // `sz.rowsColWidth` for child x-offset, not the global COL_WIDTH. After
      // per-node column widths, any parent wider than COL_WIDTH (320) would
      // have placed children OVERLAPPING the left column. The size pass
      // already widens the parent's `width` to `rowsColWidth + COL_GAP +
      // childrenWidth`, so placement must mirror that origin.
      if (!ancestors.has(childInstanceId)) {
        // x: NODE_PADDING (left chrome inset) + rowsColWidth + COL_GAP.
        // y is row-aligned via rowOffsets which already include NODE_PADDING
        // — see sizeData rowOffsets construction.
        placeNode(
          childInstanceId,
          nodeInstanceId(n),
          { x: NODE_PADDING + sz.rowsColWidth + COL_GAP, y: childY },
          ancestors,
          instanceAncestorPath
        );
        // Visual-polish #11 (PR #210): record this child's y so the parent's
        // SVG connector overlay can draw row → child paths. Only record when
        // we actually placed the child (the cycle-guard branch above skips
        // both placement AND the connector entry — no orphan paths).
        childYByAttrName.set(attrName, childY);
      }

      yCursor = childY + childSize.height + ROW_GAP;
    }
  }

  /**
   * Phase 14e/B — Choice arm expansion placement. Mirrors `placeDataChildren`
   * but iterates `node.expansions` keyed by arm typeName (since arms have no
   * attrName). The arm's row center comes from sizeChoice's rowOffsets which
   * also key by typeName, so alignment works the same way.
   */
  function placeChoiceChildren(
    n: StructureChoiceNode,
    sz: SizedNode,
    ancestors: ReadonlySet<string>,
    instanceAncestorPath: readonly string[],
    childYByAttrName: Map<string, number>,
    connectorGeometry: { rowRightX: number; childLeftX: number }
  ): void {
    // Visual-polish #11 + Codex review on 616f71e5: ChoiceNode now renders
    // with the `.rune-node-body--two-col` wrapper (matching DataNode), so
    // the rows column gets the same NODE_PADDING left inset from the
    // wrapper's CSS padding. Row right edge therefore sits at wrapper x =
    // NODE_PADDING + rowsColWidth — symmetric with Data. Child placement
    // unchanged (still NODE_PADDING + rowsColWidth + COL_GAP). Visible
    // gutter between row-right and child-left is now exactly COL_GAP.
    connectorGeometry.rowRightX = NODE_PADDING + sz.rowsColWidth;
    connectorGeometry.childLeftX = NODE_PADDING + sz.rowsColWidth + COL_GAP;

    // Same defensive default as sizeChoice — legacy test fixtures may omit
    // the `expansions` map; treat as empty rather than crashing.
    const expansions = n.expansions ?? EMPTY_EXPANSIONS;
    // yCursor floor: header is flush with wrapper top, so first expansion's
    // minimum y is HEADER_HEIGHT (right under the header). Mirrors sizeChoice.
    let yCursor = HEADER_HEIGHT;
    for (const [armTypeName, childInstanceId] of expansions) {
      const childSize = sizes.get(makeSizeCacheKey(childInstanceId));
      if (!childSize) continue;

      const rowCenter = sz.rowOffsets.get(armTypeName);
      const rowTop = rowCenter !== undefined ? rowCenter - ROW_HEIGHT / 2 : yCursor;
      const childY = Math.max(rowTop, yCursor);

      // e2e-batch fix #12 follow-up — same per-node width fix as
      // placeDataChildren. See that function's comment for rationale.
      if (!ancestors.has(childInstanceId)) {
        placeNode(
          childInstanceId,
          nodeInstanceId(n),
          { x: NODE_PADDING + sz.rowsColWidth + COL_GAP, y: childY },
          ancestors,
          instanceAncestorPath
        );
        // Visual-polish #11 (PR #210): keyed by arm typeName because Choice
        // arms have no attrName — sizeChoice's rowOffsets use the same key,
        // so the renderer can pair connector start (row center) with end
        // (child header center) by looking up the same string.
        childYByAttrName.set(armTypeName, childY);
      }

      yCursor = childY + childSize.height + ROW_GAP;
    }
  }

  function placeBaseChildren(
    n: StructureBaseContainer,
    sz: SizedNode,
    ancestors: ReadonlySet<string>,
    instanceAncestorPath: readonly string[],
    childYByAttrName: Map<string, number>,
    connectorGeometry: { rowRightX: number; childLeftX: number }
  ): void {
    // 1. The derived child sits inside the yellow border below the base rows.
    //    `n.childNodeId` is the child's per-instance id (set by the adapter —
    //    `adapterDerivedInstanceId`). For test fixtures constructed without
    //    per-instance ids, this is the canonical id, which is also the key
    //    in `input.nodes` (since `nodeInstanceId` falls back to `id`).
    //
    // Visual-polish #11 (PR #210): the derived child intentionally does NOT
    // get a `childYByAttrName` entry — it's not row-level expansion. The
    // derived child has its own visual relationship via the dotted-border
    // containment, so drawing a connector to it would duplicate that signal.
    if (!ancestors.has(n.childNodeId)) {
      placeNode(
        n.childNodeId,
        nodeInstanceId(n),
        {
          // Base inherited rows are framed Data attribute rows → the framed
          // rows stack (matches sizeBase's baseRowsHeight). The derived child
          // sits one BASE_PADDING below that stack.
          x: BASE_PADDING,
          y: HEADER_HEIGHT + framedRowsStackHeight(n.baseRows.length) + BASE_PADDING
        },
        ancestors,
        instanceAncestorPath
      );
    }

    // 2. Base container's own row-level expansions (inherited rows the user
    //    expanded) sit in the right-hand column aligned with their base rows.
    //
    // e2e-batch fix #12 (Codex P1 follow-up): the right-column origin must
    // mirror sizeBase's leftColumnWidth = max(rowsColWidth, childSize.width).
    // Previously used Math.max(COL_WIDTH, leftColumnWidth) which ignored
    // sz.rowsColWidth — for base containers whose own inherited rows are
    // wider than the derived child, expansion children would have overlapped
    // the base rows. Use sz.rowsColWidth (computed in sizeBase) as the floor.
    const derivedChildSize = sizes.get(makeSizeCacheKey(n.childNodeId));
    const derivedChildWidth = derivedChildSize?.width ?? COL_WIDTH;
    const rightColumnX = BASE_PADDING + Math.max(sz.rowsColWidth, derivedChildWidth) + COL_GAP;

    // Visual-polish #11: base container rows sit at wrapper x = BASE_PADDING
    // (from the container's `padding: BASE_PADDING`); the right column —
    // where row-level expansions land — sits at `rightColumnX` (above).
    // When the derived child is wider than the inherited rows, the gutter
    // grows past COL_GAP; buildConnectorPath handles the wider gap.
    connectorGeometry.rowRightX = BASE_PADDING + sz.rowsColWidth;
    connectorGeometry.childLeftX = rightColumnX;

    let yCursor = BASE_PADDING + HEADER_HEIGHT + DATA_ROWS_PADDING;
    for (const [attrName, childInstanceId] of n.expansions) {
      const childSize = sizes.get(makeSizeCacheKey(childInstanceId));
      if (!childSize) continue;

      // Base inherited rows are Data attribute rows → DATA_ROW_HEIGHT.
      const rowCenter = sz.rowOffsets.get(attrName);
      const rowTop = rowCenter !== undefined ? rowCenter - DATA_ROW_HEIGHT / 2 : yCursor;
      const childY = Math.max(rowTop, yCursor);

      if (!ancestors.has(childInstanceId)) {
        placeNode(childInstanceId, nodeInstanceId(n), { x: rightColumnX, y: childY }, ancestors, instanceAncestorPath);
        // Visual-polish #11 (PR #210): only row-level expansions get a
        // connector entry. Note the right-column x origin differs from
        // Data/Choice — see `rightColumnX` above. The renderer computes the
        // child-left endpoint from rowsColWidth + COL_GAP relative to the
        // parent's body, which lines up because the base container's row
        // column starts at BASE_PADDING (mirroring rightColumnX).
        childYByAttrName.set(attrName, childY);
      }

      yCursor = childY + childSize.height + ROW_GAP;
    }
  }

  // Root: its rfId is its own instance id (which equals the canonical id of
  // the outermost wrapper). instanceAncestorPath = [] preserves the root's
  // `data.instancePath = []` contract for back-compat with legacy expansion keys.
  placeNode(input.rootNodeId, undefined, { x: 0, y: 0 }, new Set(), []);
  return { nodes, edges };
}
