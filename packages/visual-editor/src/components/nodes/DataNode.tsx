// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * DataNode — Custom ReactFlow node for Rune DSL `Data` types.
 *
 * Displays type name, attributes with types and cardinalities,
 * and visual indicators for inheritance and validation errors.
 */

import { memo, useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Plus, Minus } from 'lucide-react';
import { RowGlyph } from '@rune-langium/design-system/ui/row-glyph';
import { TypeChip } from '../editors/structure/TypeChip.js';
import type { AnyGraphNode } from '../../types.js';
import type { StructureDataNode, StructureExpansionKey, StructureRow } from '../../types/structure-view.js';
import { expansionKey } from '../../types/structure-view.js';
import { getTypeRefText, formatCardinality } from '../../adapters/model-helpers.js';
import {
  getHandlePositions,
  useNavigation,
  resolveTypeNodeId,
  useNodeMetaErrors,
  useNodeMetaImports
} from './NavigationContext.js';
import { BaseFlowNode } from './BaseFlowNode.js';
import { useTypeNavigationMenu } from '../TypeNavigationMenu.js';
import { StructureMetaIndicators } from './StructureMetaIndicators.js';
import { useDiagnosticsForRange, diagnosticSeverityClass } from '../../hooks/useDiagnosticsForRange.js';
import type { RangeDiagnostic } from '../../hooks/useDiagnosticsForRange.js';
import { STRUCTURE_LAYOUT_CONSTANTS } from '../../layout/structure-layout.js';

// ---------------------------------------------------------------------------
// Structure-variant types (Finding 4)
// ---------------------------------------------------------------------------

interface StructureNodeData extends StructureDataNode {
  readonly variant: 'structure';
  readonly cellComponents?: {
    name?: React.ComponentType<{ value: string; nodeId: string; attrName: string }>;
    type?: React.ComponentType<{
      typeName: string;
      typeKind: StructureRow['typeKind'];
      nodeId: string;
      attrName: string;
    }>;
    card?: React.ComponentType<{ value: string; nodeId: string; attrName: string }>;
  };
  /**
   * Per-node rows-column width (e2e-batch fix #12) — referenced by the
   * inline-style `width` on `.rune-node-rows` so per-node estimates
   * override the global `--rune-col-width` fallback.
   */
  readonly rowsColWidth?: number;
  /**
   * Visual-polish #11 (PR #210) — layout-emitted geometry feeding the SVG
   * row→child connector overlay. `rowOffsets` and `childYByAttrName` are
   * keyed by attrName; entries exist only for rows whose expansion is
   * currently materialized (the placement pass writes them in
   * `placeDataChildren`). `connectorGeometry` carries the wrapper-relative
   * x of both the row-right and child-left edges so the renderer doesn't
   * have to know whether the variant has a body padding wrapper. All three
   * absent / empty means nothing to draw.
   */
  readonly rowOffsets?: ReadonlyMap<string, number>;
  readonly childYByAttrName?: ReadonlyMap<string, number>;
  readonly connectorGeometry?: { readonly rowRightX: number; readonly childLeftX: number };
  /**
   * Per-key expansion state for rendering the expand/collapse chevron
   * (Finding 1, spec 020 Phase 13). When absent, all rows render
   * collapsed (aria-expanded=false).
   */
  readonly expansionMap?: ReadonlyMap<string, boolean>;
  /**
   * Callback fired when the user activates a row's expand/collapse control.
   * The receiver is expected to flip the corresponding entry in the
   * expansion map (typically via useStructureViewStore.toggleExpansion).
   */
  readonly onToggleExpansion?: (key: StructureExpansionKey) => void;
  /**
   * React Flow instance ids of this node's ancestors (NOT including this node
   * itself). Injected by `layoutStructureGraph` (Phase 14d). Used to scope
   * each row's expansion key per-instance: two visible occurrences of the
   * same type have different `instancePath`s because their parent instance
   * ids differ, so their row chevrons stay independent.
   *
   * Optional / may be undefined when this component is rendered outside the
   * Structure View layout (e.g., direct unit tests that omit it). Treated
   * as an empty array: `ownerInstancePath = [...(instancePath ?? []), id]`.
   */
  readonly instancePath?: ReadonlyArray<string>;
  /**
   * Spec §8 / §3.3 — navigate-to-enum callback. Injected by StructureView
   * alongside cellComponents. Rows with `typeKind === 'Enum'` render an ↗
   * button that fires this with the enum's canonical typeId (ns.Name).
   */
  readonly onNavigateToEnumType?: (typeId: string) => void;
  /**
   * Spec §3.4 — pre-converted LSP diagnostics for the focused file. Ranges
   * are character offsets. Each row checks for overlap via useDiagnosticsForRange
   * and applies the appropriate severity CSS class to its left edge.
   *
   * **NOTE — astRange-threading gap:** in studio-created rows today,
   * `StructureRow.astRange` is `undefined` because `graphNodesToAdapterDocument`
   * forwards attributes from the dehydrated node data (which carries no
   * `$cstNode`) and never derives an offset range. The hook returns
   * `undefined` in production so the severity class never applies. Tests
   * inject synthetic astRange values to verify the end-to-end wiring,
   * which is real and ready to fire once the upstream threads astRange.
   * Tracking: this is the deferred half of spec §3.4 / spec 020 PR #207.
   */
  readonly structureDiagnostics?: readonly RangeDiagnostic[];
}

/**
 * Row-level expansion is only meaningful for typeKinds whose target is itself
 * a structured node (Data / Choice). Enum rows are terminal — drilling into
 * their values is the EnumNode's responsibility, not a row expansion.
 * Builtin and Unresolved have no expansion target at all.
 */
function isRowExpandable(typeKind: StructureRow['typeKind']): boolean {
  return typeKind === 'Data' || typeKind === 'Choice';
}

// ---------------------------------------------------------------------------
// Row → child SVG connector overlay (visual-polish #11, PR #210)
// ---------------------------------------------------------------------------
//
// Each parent structure node renders its own absolutely-positioned SVG that
// links every materialized row's right edge to the corresponding child's
// header center. Self-contained per parent — no global coordinator.
//
// The visual-only CORNER_RADIUS lives here (not in STRUCTURE_LAYOUT_CONSTANTS)
// because it isn't layout-coupled; it only affects path-shape rendering. The
// audit's item #11 rationale: visual constants stay with the visual code,
// only layout-coupled values get promoted to the SSoT.
//
// The helper is duplicated across DataNode / ChoiceNode / GroupContainerNode
// rather than extracted to a shared module to keep each node's rendering
// self-contained per the audit's #11 constraint. The duplication is ~30
// lines per file and the geometry is identical — see ChoiceNode.tsx and
// GroupContainerNode.tsx for matching implementations.

const CONNECTOR_CORNER_RADIUS = 4;

function buildConnectorPath(startX: number, startY: number, endX: number, endY: number): string {
  if (startY === endY) {
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }
  // Stepped path: horizontal half the gutter, vertical to child level, horizontal in.
  // Mid-x is derived from the actual start/end distance so the bend stays
  // centered in the visible gutter regardless of any per-variant padding
  // offset (Data inserts NODE_PADDING in the gap; Choice does not).
  const gap = endX - startX;
  const midX = startX + gap / 2;
  const goingDown = endY > startY;
  const r = Math.min(CONNECTOR_CORNER_RADIUS, Math.abs(endY - startY) / 2, gap / 4);
  const v1 = goingDown ? startY + r : startY - r;
  const v2 = goingDown ? endY - r : endY + r;
  const sweepIn = goingDown ? 1 : 0;
  const sweepOut = goingDown ? 0 : 1;
  return [
    `M ${startX} ${startY}`,
    `H ${midX - r}`,
    `A ${r} ${r} 0 0 ${sweepIn} ${midX} ${v1}`,
    `V ${v2}`,
    `A ${r} ${r} 0 0 ${sweepOut} ${midX + r} ${endY}`,
    `H ${endX}`
  ].join(' ');
}

interface RowConnectorOverlayProps {
  readonly rowOffsets?: ReadonlyMap<string, number>;
  readonly childYByAttrName?: ReadonlyMap<string, number>;
  /** Wrapper-relative x of the row's right edge — start point of every connector. */
  readonly rowRightX: number;
  /** Wrapper-relative x of the child's left edge — end point of every connector. */
  readonly childLeftX: number;
}

function RowConnectorOverlay({
  rowOffsets,
  childYByAttrName,
  rowRightX,
  childLeftX
}: RowConnectorOverlayProps): React.ReactElement | null {
  if (!rowOffsets || !childYByAttrName || childYByAttrName.size === 0) return null;
  const { HEADER_HEIGHT } = STRUCTURE_LAYOUT_CONSTANTS;
  const paths: React.ReactElement[] = [];
  for (const [attrName, childY] of childYByAttrName) {
    const rowCenter = rowOffsets.get(attrName);
    if (rowCenter === undefined) continue;
    const endY = childY + HEADER_HEIGHT / 2;
    paths.push(
      <path
        key={attrName}
        className="rune-row-connector"
        d={buildConnectorPath(rowRightX, rowCenter, childLeftX, endY)}
      />
    );
  }
  if (paths.length === 0) return null;
  return (
    <svg
      className="rune-row-connector-overlay"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible'
      }}
    >
      {paths}
    </svg>
  );
}

function isStructureData(d: unknown): d is StructureNodeData {
  return typeof d === 'object' && d !== null && (d as { variant?: unknown }).variant === 'structure';
}

/**
 * Per-row sub-component for the structure variant. Extracted so that
 * `useDiagnosticsForRange` — a hook — can be called once per row inside a
 * proper function component, which hooks rules require.
 */
interface StructureDataRowProps {
  row: StructureRow;
  expandable: boolean;
  isExpanded: boolean;
  handleToggle: (e: React.MouseEvent<HTMLButtonElement>) => void;
  NameCell?: React.ComponentType<{ value: string; nodeId: string; attrName: string }>;
  TypeCell?: React.ComponentType<{
    typeName: string;
    typeKind: StructureRow['typeKind'];
    nodeId: string;
    attrName: string;
  }>;
  CardCell?: React.ComponentType<{ value: string; nodeId: string; attrName: string }>;
  nodeId: string;
  onNavigateToEnumType?: (typeId: string) => void;
  structureDiagnostics: readonly RangeDiagnostic[];
}

function StructureDataRow({
  row,
  expandable,
  isExpanded,
  handleToggle,
  NameCell,
  TypeCell,
  CardCell,
  nodeId,
  onNavigateToEnumType,
  structureDiagnostics
}: StructureDataRowProps): React.ReactElement {
  const { onInspectType } = useNavigation();
  const navigation = useTypeNavigationMenu({ onNavigate: onNavigateToEnumType, onInspect: onInspectType });
  const diagnostic = useDiagnosticsForRange(row.astRange, structureDiagnostics);
  const isEnum = row.typeKind === 'Enum';
  const isUnresolved = row.typeKind === 'Unresolved';

  let rowClass = `rune-node-row${expandable ? ' has-expansion' : ''}`;
  if (diagnostic) rowClass += ` ${diagnosticSeverityClass(diagnostic.severity)}`;

  const unresolvedTitle = diagnostic?.message ?? `Type ${row.typeName} not found in this namespace or its imports`;

  return (
    // XMLSpy-style stacked row: the attribute name sits on the top line and
    // the type-chip + cardinality (plus any enum-nav / unresolved glyphs) on a
    // second line beneath. `.rune-node-row__main` is the stacked column; the
    // expand control stays a direct child of `.rune-node-row` so it centers
    // vertically across both lines.
    <>
      <div className={rowClass} data-attr={row.attrName} {...navigation.targetProps(row.targetNodeId)}>
        <div className="rune-node-row__main">
          <div className="rune-node-row__name-line">
            {NameCell ? (
              <NameCell value={row.attrName} nodeId={nodeId} attrName={row.attrName} />
            ) : (
              <span className="rune-cell-name">{row.attrName}</span>
            )}
          </div>
          <div className="rune-node-row__type-line">
            {TypeCell ? (
              <TypeCell typeName={row.typeName} typeKind={row.typeKind} nodeId={nodeId} attrName={row.attrName} />
            ) : (
              // row.typeName is string (not undefined) per StructureRow; render '?' if empty.
              <TypeChip as="span" typeName={row.typeName || '?'} typeKind={row.typeKind} />
            )}
            {/* Spec §3.3 — enum-nav glyph (↗): navigate into the enum type as root. */}
            {isEnum && onNavigateToEnumType && row.targetNodeId ? (
              <RowGlyph
                as="button"
                variant="enum-nav"
                type="button"
                className="nodrag nopan"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onNavigateToEnumType(row.targetNodeId!);
                }}
                aria-label={`Navigate to ${row.typeName}`}
                title={`Navigate to ${row.typeName}`}
                data-testid={`enum-nav-${row.attrName}`}
              >
                ↗
              </RowGlyph>
            ) : null}
            {/* Spec §3.3 — unresolved-ref indicator (?): shows LSP error as tooltip. */}
            {isUnresolved ? (
              <RowGlyph
                variant="unresolved"
                title={unresolvedTitle}
                aria-label={`Unresolved type: ${row.typeName}`}
                role="img"
                data-testid={`unresolved-${row.attrName}`}
              >
                ?
              </RowGlyph>
            ) : null}
            {CardCell ? (
              <CardCell value={row.cardinality} nodeId={nodeId} attrName={row.attrName} />
            ) : (
              <span className="rune-cell-card">{row.cardinality}</span>
            )}
          </div>
        </div>
        {/* Expand/collapse control moved to the RIGHT edge of the row
          (was leading-edge before this iteration) and switched from a
          chevron to a +/− icon to match the form-preview Add/Remove
          treatment. Plus = "expand (add the child structure to view)",
          Minus = "collapse (remove it)". `nodrag nopan` keeps React
          Flow from treating the click as a canvas gesture. */}
        {expandable ? (
          <button
            type="button"
            className="rune-row-expand rune-row-expand--right nodrag nopan"
            onClick={handleToggle}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${row.attrName}`}
            data-testid={`expand-row-${row.attrName}`}
          >
            {isExpanded ? <Minus size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
          </button>
        ) : null}
        {/* structure variant: no Handle — layout emits zero edges; nodesConnectable=false */}
      </div>
      {navigation.menu}
    </>
  );
}

export const DataNode = memo(function DataNode({ data, selected, id }: NodeProps) {
  const d = data as unknown as AnyGraphNode;
  const members = ((d as any).attributes ?? []) as any[];
  const { onNavigateToType, onInspectType, allNodeIds, layoutDirection, pendingHydrationNamespaces } = useNavigation();
  const navigation = useTypeNavigationMenu({ onNavigate: onNavigateToType, onInspect: onInspectType });
  const handles = getHandlePositions(layoutDirection);
  // Validation errors live on the node.meta sibling (not on data) — read
  // them out of the ReactFlow store by node id.
  const nodeErrors = useNodeMetaErrors(id);
  const imports = useNodeMetaImports(id);
  const summary =
    members.length === 0 ? 'No attributes' : `${members.length} attribute${members.length === 1 ? '' : 's'}`;

  const handleTypeClick = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.preventDefault();
      onNavigateToType?.(nodeId);
    },
    [onNavigateToType]
  );

  if (isStructureData(data)) {
    // Finding 1: consume StructureRow shape from data.rows (not data.attributes).
    // StructureRow.typeName, .attrName, .cardinality are already pre-formatted strings
    // from the adapter — no getTypeRefText / formatCardinality needed here.
    // Phase 10 has shipped (commit 01ea4af9 "tightened CSS variables") — removed TODO.
    // Core geometry handled by .rune-node-data--structure, .rune-node-body--two-col,
    // .rune-node-rows, .rune-node-row, .rune-row-handle, .rune-node-children-slot
    // in styles.css — layout constants (ROW_HEIGHT=28, COL_WIDTH=260, etc.) are matched there.
    const rows = data.rows;
    const {
      cellComponents,
      expansionMap,
      onToggleExpansion,
      instancePath,
      onNavigateToEnumType,
      structureDiagnostics,
      // Visual-polish #11 (PR #210): connector overlay inputs threaded by
      // layoutStructureGraph. rowOffsets is keyed by attrName;
      // childYByAttrName contains one entry per materialized expansion;
      // connectorGeometry carries the row-right/child-left x coordinates so
      // the renderer doesn't have to know about per-variant body padding.
      // See RowConnectorOverlay.
      rowOffsets,
      childYByAttrName,
      connectorGeometry
    } = data;
    // e2e-batch fix #12: per-node rows-column width from the layout.
    // Layout's estimateRowsColWidth() sizes this from row content so CDM-scale
    // type names don't clip. Inline-style overrides the --rune-col-width CSS
    // fallback when present.
    const rowsColWidth = data.rowsColWidth;
    const NameCell = cellComponents?.name;
    const TypeCell = cellComponents?.type;
    const CardCell = cellComponents?.card;
    const activeDiagnostics: readonly RangeDiagnostic[] = structureDiagnostics ?? [];
    // Adapter's expansion-key contract uses the bare type name as `typeId`
    // (see structure-graph-adapter.ts `shouldExpand`). Mirror that here so
    // toggles round-trip through the persistence layer correctly.
    const ownerNamespaceUri = data.namespaceUri;
    const ownerTypeName = data.name;
    // Per-instance expansion. The rowKey's instancePath must include self's
    // React Flow id (`id`) so two visible occurrences of the same type at the
    // same depth produce DISTINCT keys. `data.instancePath` carries the ancestors
    // (NOT including self); appending `id` makes it self-inclusive.
    //
    // Example: buyer.Party and seller.Party both have `data.instancePath = ['Trade']`
    // because their parent is Trade. Each chevron serializes to a distinct key:
    //   buyer.Party:  instancePath = ['Trade', 'Trade::buyer::Party']
    //   seller.Party: instancePath = ['Trade', 'Trade::seller::Party']
    //
    // The adapter's shouldExpand checks with the same self-inclusive path, so
    // expansion round-trips correctly through the store.
    const ownerInstancePath: ReadonlyArray<string> = [...(instancePath ?? []), id];

    return (
      <BaseFlowNode
        id={id}
        kind="data"
        name={data.name}
        className="rune-node-data rune-node-data--structure"
        selected={selected}
        hydrating={Boolean(data.deferred) && pendingHydrationNamespaces.includes(data.namespaceUri)}
        metaIndicators={
          <StructureMetaIndicators
            definition={data.definition}
            annotations={data.annotations}
            conditions={data.conditions}
          />
        }
      >
        <div className="rune-node-body rune-node-body--two-col">
          <div className="rune-node-rows" style={rowsColWidth ? { width: rowsColWidth } : undefined}>
            {rows.map((row: StructureRow) => {
              const expandable = isRowExpandable(row.typeKind);
              const rowKey: StructureExpansionKey | undefined = expandable
                ? {
                    namespaceUri: ownerNamespaceUri,
                    typeId: ownerTypeName,
                    attrName: row.attrName,
                    instancePath: ownerInstancePath
                  }
                : undefined;
              const isExpanded = rowKey && expansionMap ? expansionMap.get(expansionKey(rowKey)) === true : false;
              const handleToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
                e.preventDefault();
                e.stopPropagation();
                if (rowKey) onToggleExpansion?.(rowKey);
              };
              return (
                <StructureDataRow
                  key={row.attrName}
                  row={row}
                  expandable={expandable}
                  isExpanded={isExpanded}
                  handleToggle={handleToggle}
                  NameCell={NameCell}
                  TypeCell={TypeCell}
                  CardCell={CardCell}
                  nodeId={data.id}
                  onNavigateToEnumType={onNavigateToEnumType}
                  structureDiagnostics={activeDiagnostics}
                />
              );
            })}
          </div>
          <div
            className="rune-node-children-slot"
            data-testid="data-node-children"
            // Only decorate (grow into the gutter + draw the dashed column
            // divider) when this node actually has a materialized child column.
            // Otherwise the slot must stay collapsed: with rows now shrink-wrapped
            // and the node width header-driven, a growing slot would fill the
            // empty right area and draw a stray vertical dashed line.
            data-has-children={(childYByAttrName?.size ?? 0) > 0 ? 'true' : undefined}
          />
        </div>
        {/* Visual-polish #11 (PR #210): SVG connector from row→child for each
            materialized expansion. Rendered AFTER the body so it paints over,
            but the SVG itself is pointer-events:none / aria-hidden, so it
            doesn't interfere with row controls or screen readers. All
            geometry (rowRightX, childLeftX, rowOffsets, childYByAttrName) is
            threaded from the layout — the renderer is purely a path emitter. */}
        {connectorGeometry ? (
          <RowConnectorOverlay
            rowOffsets={rowOffsets}
            childYByAttrName={childYByAttrName}
            rowRightX={connectorGeometry.rowRightX}
            childLeftX={connectorGeometry.childLeftX}
          />
        ) : null}
      </BaseFlowNode>
    );
  }

  return (
    <>
      <BaseFlowNode
        id={id}
        kind="data"
        name={d.name}
        className="rune-node-data"
        selected={selected}
        dataSummary={summary}
        handles={handles}
      >
        <div className="rune-node-summary">{summary}</div>
        <div className="rune-node-body">
          {members.length > 0 && (
            <div className="rune-node-members">
              {members.map((member: any) => {
                const typeName = getTypeRefText(member.typeCall);
                const card = formatCardinality(member.card);
                const targetId = typeName ? resolveTypeNodeId(typeName, allNodeIds, imports) : undefined;
                return (
                  <div
                    key={member.name}
                    className={`rune-node-member${member.override ? ' rune-node-member-override' : ''}`}
                  >
                    <span className="rune-node-member-name">{member.name}</span>
                    {typeName &&
                      (targetId && navigation.hasActions ? (
                        <button
                          type="button"
                          className="rune-node-member-type nodrag nopan"
                          data-navigable
                          onClick={(e) => handleTypeClick(e, targetId)}
                          {...navigation.targetProps(targetId)}
                        >
                          {typeName}
                        </button>
                      ) : (
                        <span className="rune-node-member-type">{typeName}</span>
                      ))}
                    {card && <span className="rune-node-member-cardinality">{card}</span>}
                  </div>
                );
              })}
            </div>
          )}
          {nodeErrors.length > 0 && (
            <div className="rune-node-errors">
              {nodeErrors.map((err, i) => (
                <div key={`${err.ruleId ?? 'err'}:${err.message}:${i}`}>{err.message}</div>
              ))}
            </div>
          )}
        </div>
      </BaseFlowNode>
      {navigation.menu}
    </>
  );
});
