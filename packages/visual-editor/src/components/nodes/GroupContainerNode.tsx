// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { Plus, Minus } from 'lucide-react';
import type { Node, NodeProps } from '@xyflow/react';
import type { StructureExpansionKey, StructureRow } from '../../types/structure-view.js';
import { expansionKey } from '../../types/structure-view.js';
import { STRUCTURE_LAYOUT_CONSTANTS } from '../../layout/structure-layout.js';
import { TypeChip } from '../editors/structure/TypeChip.js';
import { useNavigation } from './NavigationContext.js';
import { useTypeNavigationMenu } from '../TypeNavigationMenu.js';

export interface GroupContainerInheritanceData extends Record<string, unknown> {
  scope: 'inheritance';
  label: string;
  description?: string;
  nodeCount: number;
}

export interface GroupContainerBaseTypeData extends Record<string, unknown> {
  scope: 'base-type';
  /** Canonical declaration ID, distinct from the synthetic wrapper ID. */
  baseTypeId?: string;
  baseTypeName: string;
  /** Namespace URI of the base type — needed to build the StructureExpansionKey for each row. */
  baseTypeNamespaceUri: string;
  baseRows: ReadonlyArray<StructureRow>;
  /**
   * Per-node rows-column width (e2e-batch fix #12 follow-up; Codex rescue
   * P2). Layout's `sizeBase` computes `max(baseRowsColWidth, derived
   * child rowsColWidth)` and threads it via `placeNode`; without reading
   * it here the inherited base-rows container stretches to the full
   * outer width, letting long inherited row text bleed into the right
   * expansion column. Optional for legacy callers (test fixtures) that
   * construct GroupContainerBaseTypeData by hand.
   */
  rowsColWidth?: number;
  /**
   * Per-key expansion state for rendering the expand/collapse chevron on inherited
   * Data/Choice rows (Codex P2, PR #191). Injected by StructureView alongside
   * onToggleExpansion. When absent, all rows render collapsed.
   */
  expansionMap?: ReadonlyMap<string, boolean>;
  /**
   * Callback fired when the user activates a row's expand/collapse control.
   * The expansion key uses the base type's namespace + canonical typeId so it
   * round-trips correctly through the persistence layer.
   */
  onToggleExpansion?: (key: StructureExpansionKey) => void;
  /**
   * React Flow instance ids of this base container's ancestors (NOT including
   * the container itself). Injected by `layoutStructureGraph` (Phase 14d).
   * Used to scope each row's expansion key per-instance so chevrons on
   * inherited rows of two visible occurrences of the same base type stay
   * independent. Treated as empty array when absent.
   */
  instancePath?: ReadonlyArray<string>;
  /**
   * Visual-polish #11 (PR #210) — layout-emitted geometry feeding the SVG
   * row→child connector overlay for the base container's own (inherited
   * row) expansions. Keys match `baseRows[*].attrName`. The derived child
   * is intentionally NOT included — it has its own visual relationship via
   * the dotted-border containment, and adding a connector would duplicate
   * that signal. `connectorGeometry` carries the wrapper-relative
   * row-right / child-left x; base's right column starts at `BASE_PADDING
   * + max(rowsColWidth, derivedChildWidth) + COL_GAP`, which the layout
   * resolves before threading it here.
   */
  rowOffsets?: ReadonlyMap<string, number>;
  childYByAttrName?: ReadonlyMap<string, number>;
  connectorGeometry?: { readonly rowRightX: number; readonly childLeftX: number };
}

export type GroupContainerData = GroupContainerInheritanceData | GroupContainerBaseTypeData;
export type GroupContainerNodeType = Node<GroupContainerData, 'groupContainer'>;

/**
 * Row-level expansion is only meaningful for typeKinds whose target is itself a
 * structured node (Data / Choice). Enum rows are terminal. Builtin and Unresolved
 * have no expansion target. Mirrors the same helper in DataNode.tsx.
 */
function isRowExpandable(typeKind: StructureRow['typeKind']): boolean {
  return typeKind === 'Data' || typeKind === 'Choice';
}

// ---------------------------------------------------------------------------
// Row → child SVG connector overlay (visual-polish #11, PR #210)
// ---------------------------------------------------------------------------
// Mirror of DataNode's RowConnectorOverlay — see that file for the design
// rationale. Base containers only draw connectors for ROW-level expansions
// (inherited rows the user expanded into the right column); the derived
// child inside the dashed border is NOT connected — it has its own visual
// relationship via the containment chrome, and a connector would duplicate
// that signal.

const CONNECTOR_CORNER_RADIUS = 4;

function buildConnectorPath(startX: number, startY: number, endX: number, endY: number): string {
  if (startY === endY) {
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }
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
  readonly rowRightX: number;
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

export function GroupContainerNode({ data, id }: NodeProps<GroupContainerNodeType>): React.ReactElement {
  const { onNavigateToType, onInspectType } = useNavigation();
  const navigation = useTypeNavigationMenu({ onNavigate: onNavigateToType, onInspect: onInspectType });
  if (data.scope === 'inheritance') {
    return (
      <div className="rune-graph-group">
        <div className="rune-graph-group__header">
          <span className="rune-graph-group__title">{data.label}</span>
          <span className="rune-graph-group__meta">{data.nodeCount} types</span>
        </div>
        {data.description ? <div className="rune-graph-group__description">{data.description}</div> : null}
      </div>
    );
  }

  // scope === 'base-type'
  // Phase 10 has shipped (commit 01ea4af9 "tightened CSS variables") — removed TODO.
  // Core geometry handled by .rune-graph-group--base, .rune-graph-group__base-rows,
  // .rune-graph-group__base-row in styles.css — layout constants (ROW_HEIGHT=28,
  // BASE_PADDING=16, etc.) are matched there.
  //
  // Codex P2 / PR #191: each Data/Choice row now shows a chevron expand/collapse
  // button (matching the DataNode pattern). The expansion key uses the BARE base
  // type name as typeId because the adapter's shouldExpand (and DataNode) write
  // `typeId: ownerTypeName` (bare) — see structure-graph-adapter.ts:194 and
  // DataNode.tsx:113. Any other format would produce a key that the adapter never
  // looks for, leaving the chevron's "expanded" state visually correct but never
  // actually rendering the child.
  const {
    baseTypeId,
    baseTypeName,
    baseTypeNamespaceUri,
    baseRows,
    expansionMap,
    onToggleExpansion,
    instancePath,
    rowsColWidth,
    // Visual-polish #11 (PR #210): connector overlay inputs threaded by
    // layoutStructureGraph from `placeBaseChildren`. Only inherited-row
    // expansions are represented — the derived child inside the dashed
    // border is intentionally excluded (see RowConnectorOverlay docstring).
    rowOffsets,
    childYByAttrName,
    connectorGeometry
  } = data;

  // Phase 14d (fix): include self's React Flow id in the rowKey instancePath so
  // two visible occurrences of the same base container at the same depth produce
  // distinct keys. `data.instancePath` carries the ancestors (NOT including self);
  // appending `id` makes it self-inclusive and aligns with the adapter's updated
  // shouldExpand check (which also uses the self-inclusive path).
  const ownerInstancePath: ReadonlyArray<string> = [...(instancePath ?? []), id];

  return (
    <div className="rune-graph-group rune-graph-group--base">
      <div
        className="rune-graph-group__header focus-visible:outline-2 focus-visible:outline-ring"
        {...navigation.targetProps(baseTypeId, `${baseTypeName} type actions`)}
      >
        {/* Header reads name-left / kind-pill-right; matches the inner
            DataNode/ChoiceNode/EnumNode header treatment (kind badge
            pushed to the right via .rune-node-kind-badge { margin-left:
            auto }). DOM order keeps the type name first so screen
            readers announce the identity before the kind classifier. */}
        <span className="rune-graph-group__title">{baseTypeName}</span>
        <span className="rune-graph-group__meta">base</span>
      </div>
      <div className="rune-graph-group__base-rows" style={rowsColWidth ? { width: rowsColWidth } : undefined}>
        {baseRows.map((row) => {
          const expandable = isRowExpandable(row.typeKind);
          const rowKey: StructureExpansionKey | undefined = expandable
            ? {
                namespaceUri: baseTypeNamespaceUri,
                typeId: baseTypeName,
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
            <div
              key={row.attrName}
              className={`rune-node-row focus-visible:outline-2 focus-visible:outline-ring${expandable ? ' has-expansion' : ''}`}
              data-attr={row.attrName}
              {...navigation.targetProps(row.targetNodeId, `${row.attrName}: ${row.typeName}`)}
            >
              <div className="rune-node-row__main">
                <div className="rune-node-row__name-line">
                  <span className="rune-cell-name">{row.attrName}</span>
                </div>
                <div className="rune-node-row__type-line">
                  <TypeChip as="span" typeName={row.typeName} typeKind={row.typeKind} />
                  <span className="rune-cell-card">{row.cardinality}</span>
                </div>
              </div>
              {expandable ? (
                <button
                  type="button"
                  className="rune-row-expand rune-row-expand--right nodrag nopan"
                  onClick={handleToggle}
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${row.attrName}`}
                  data-testid={`base-expand-row-${row.attrName}`}
                >
                  {isExpanded ? <Minus size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {/* Visual-polish #11 (PR #210): row→child SVG connector for the base
          container's own inherited-row expansions. Same pattern as Data /
          Choice; geometry differs because base inserts BASE_PADDING and
          may have a wider gutter when the derived child is wider than the
          inherited rows (see placeBaseChildren). */}
      {navigation.menu}
      {connectorGeometry ? (
        <RowConnectorOverlay
          rowOffsets={rowOffsets}
          childYByAttrName={childYByAttrName}
          rowRightX={connectorGeometry.rowRightX}
          childLeftX={connectorGeometry.childLeftX}
        />
      ) : null}
    </div>
  );
}
