// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * ChoiceNode — Custom ReactFlow node for Rune DSL `Choice` types.
 *
 * Displays choice name and its options (each referencing a type).
 *
 * Two rendering variants:
 *   - `variant === 'structure'`: structure-view context, reads `data.options`
 *     (ReadonlyArray<StructureChoiceArm>) emitted by layoutStructureGraph.
 *     Phase 14e/B brings ChoiceNode to parity with DataNode for arms: each
 *     arm row renders a TypePickerCell (drag-drop target) and, for arms
 *     whose target is Data or Choice, an expansion chevron that toggles
 *     per-instance expansion via `data.onToggleExpansion`. Terminal arms
 *     (Enum / Builtin / Unresolved) render a spacer for alignment but no
 *     chevron — there is no subtree to drill into.
 *   - default (graph view): reads `data.attributes`, renders navigable handles.
 */

import { memo, useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Plus, Minus } from 'lucide-react';
import { RowGlyph } from '@rune-langium/design-system/ui/row-glyph';
import { TypeChip } from '../editors/structure/TypeChip.js';
import type { AnyGraphNode } from '../../types.js';
import type {
  StructureChoiceNode,
  StructureChoiceArm,
  StructureExpansionKey,
  StructureRow
} from '../../types/structure-view.js';
import { expansionKey } from '../../types/structure-view.js';
import { getTypeRefText } from '../../adapters/model-helpers.js';
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
import type { RangeDiagnostic } from '../../hooks/useDiagnosticsForRange.js';
import { STRUCTURE_LAYOUT_CONSTANTS } from '../../layout/structure-layout.js';

// ---------------------------------------------------------------------------
// Structure-variant helpers
// ---------------------------------------------------------------------------

interface StructureChoiceNodeData extends StructureChoiceNode {
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
  /** Per-key expansion state (Phase 14e/B); same shape as DataNode. */
  readonly expansionMap?: ReadonlyMap<string, boolean>;
  /** Toggle callback (Phase 14e/B); same shape as DataNode. */
  readonly onToggleExpansion?: (key: StructureExpansionKey) => void;
  /** Ancestor rfId chain (Phase 14d); same shape as DataNode. */
  readonly instancePath?: ReadonlyArray<string>;
  /** Per-node rows-column width (e2e-batch fix #12); same shape as DataNode. */
  readonly rowsColWidth?: number;
  /**
   * Visual-polish #11 (PR #210) — layout-emitted geometry for the SVG
   * row→child connector overlay. For Choice, both maps are keyed by arm
   * typeName (not attrName — arms have no attrName). `connectorGeometry`
   * carries the row-right/child-left x coordinates. Entries exist only
   * for arms whose expansion is currently materialized. See DataNode for
   * full rationale.
   */
  readonly rowOffsets?: ReadonlyMap<string, number>;
  readonly childYByAttrName?: ReadonlyMap<string, number>;
  readonly connectorGeometry?: { readonly rowRightX: number; readonly childLeftX: number };
  /**
   * Spec §8 / §3.3 — navigate-to-enum callback (same contract as DataNode).
   * Arms with `typeKind === 'Enum'` render an ↗ button that fires this with
   * the arm's `targetNodeId`.
   */
  readonly onNavigateToEnumType?: (typeId: string) => void;
  /**
   * Spec §3.4 — pre-converted diagnostics for the focused file (same contract
   * as DataNode). Arms use `useDiagnosticsForRange` for left-edge severity tinting.
   * Choice arms do not carry `astRange` today (no field on StructureChoiceArm),
   * so this is reserved for future use but accepted to keep the interface symmetric.
   */
  readonly structureDiagnostics?: readonly RangeDiagnostic[];
}

function isStructureChoice(d: unknown): d is StructureChoiceNodeData {
  return typeof d === 'object' && d !== null && (d as { variant?: unknown }).variant === 'structure';
}

/**
 * An arm is expandable only when its referenced target is itself a structured
 * node (Data or Choice). Terminal kinds — Enum, Builtin, Unresolved — never
 * get a chevron. Mirrors DataNode's `isRowExpandable` predicate.
 */
function isArmExpandable(typeKind: StructureChoiceArm['typeKind']): boolean {
  return typeKind === 'Data' || typeKind === 'Choice';
}

/**
 * StructureChoiceArm.typeKind narrows to a subset of StructureRow.typeKind
 * (no 'Builtin' vs 'BasicType' overlap — arms classify Builtin where rows
 * classify BasicType). Map the arm kind to the row kind that TypePickerCell
 * expects so the same cell component can be reused on arms without a
 * dedicated arm-specific TypePickerCell variant.
 */
function armKindToRowKind(armKind: StructureChoiceArm['typeKind']): StructureRow['typeKind'] {
  return armKind === 'Builtin' ? 'BasicType' : armKind;
}

// ---------------------------------------------------------------------------
// Row → child SVG connector overlay (visual-polish #11, PR #210)
// ---------------------------------------------------------------------------
// Mirror of DataNode's RowConnectorOverlay — see that file for the design
// rationale (self-contained per parent, no shared module, visual-only
// CORNER_RADIUS stays here rather than in STRUCTURE_LAYOUT_CONSTANTS).

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
  for (const [armTypeName, childY] of childYByAttrName) {
    const rowCenter = rowOffsets.get(armTypeName);
    if (rowCenter === undefined) continue;
    const endY = childY + HEADER_HEIGHT / 2;
    paths.push(
      <path
        key={armTypeName}
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

/**
 * Per-arm sub-component for ChoiceNode's structure variant. Kept as a
 * dedicated function component so any per-arm hook (e.g. future
 * useDiagnosticsForRange when arms carry astRange) can be added without
 * violating hooks rules.
 *
 * **astRange-threading gap:** `StructureChoiceArm` does NOT carry an
 * astRange field today, so this row deliberately does NOT call
 * `useDiagnosticsForRange` — the result would always be `undefined` and
 * the diagnostic class would never apply (Copilot review caught this on
 * PR #207). When arms gain astRange (mirroring the same fix DataNode rows
 * need — see DataNode.tsx comment on `structureDiagnostics`), reintroduce
 * the hook call here.
 */
interface StructureChoiceArmRowProps {
  arm: StructureChoiceArm;
  expandable: boolean;
  isExpanded: boolean;
  handleToggle: (e: React.MouseEvent<HTMLButtonElement>) => void;
  TypeCell?: React.ComponentType<{
    typeName: string;
    typeKind: StructureRow['typeKind'];
    nodeId: string;
    attrName: string;
  }>;
  nodeId: string;
  onNavigateToEnumType?: (typeId: string) => void;
}

function StructureChoiceArmRow({
  arm,
  expandable,
  isExpanded,
  handleToggle,
  TypeCell,
  nodeId,
  onNavigateToEnumType
}: StructureChoiceArmRowProps): React.ReactElement {
  const { onInspectType } = useNavigation();
  const navigation = useTypeNavigationMenu({ onNavigate: onNavigateToEnumType, onInspect: onInspectType });
  const isEnum = arm.typeKind === 'Enum';
  const isUnresolved = arm.typeKind === 'Unresolved';

  const rowClass = `rune-node-row${expandable ? ' has-expansion' : ''}`;

  const unresolvedTitle = `Type ${arm.typeName} not found in this namespace or its imports`;

  return (
    <>
      <div className={rowClass} data-attr={arm.typeName} {...navigation.targetProps(arm.targetNodeId)}>
        {TypeCell ? (
          // Cells receive the canonical node id (data.id), not the
          // React Flow wrapper id — matches DataNode's contract so
          // updateAttributeType (or the analogous arm-retype action)
          // looks up by canonical id consistently.
          <TypeCell
            typeName={arm.typeName}
            typeKind={armKindToRowKind(arm.typeKind)}
            nodeId={nodeId}
            attrName={arm.typeName}
          />
        ) : (
          <TypeChip as="span" typeName={arm.typeName || '?'} typeKind={armKindToRowKind(arm.typeKind)} />
        )}
        {/* Spec §3.3 — enum-nav glyph (↗) for Enum arms. */}
        {isEnum && onNavigateToEnumType && arm.targetNodeId ? (
          <RowGlyph
            as="button"
            variant="enum-nav"
            type="button"
            className="nodrag nopan"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onNavigateToEnumType(arm.targetNodeId!);
            }}
            aria-label={`Navigate to ${arm.typeName}`}
            title={`Navigate to ${arm.typeName}`}
            data-testid={`enum-nav-arm-${arm.typeName}`}
          >
            ↗
          </RowGlyph>
        ) : null}
        {/* Spec §3.3 — unresolved-type indicator (?) for Unresolved arms. */}
        {isUnresolved ? (
          <RowGlyph
            variant="unresolved"
            title={unresolvedTitle}
            aria-label={`Unresolved type: ${arm.typeName}`}
            role="img"
            data-testid={`unresolved-arm-${arm.typeName}`}
          >
            ?
          </RowGlyph>
        ) : null}
        {/* Expand/collapse moved to right edge with +/− icons —
          matches DataNode and the form-preview Add/Remove treatment. */}
        {expandable ? (
          <button
            type="button"
            className="rune-row-expand rune-row-expand--right nodrag nopan"
            onClick={handleToggle}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${arm.typeName}`}
            data-testid={`choice-arm-expand-${arm.typeName}`}
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

export const ChoiceNode = memo(function ChoiceNode({ data, selected, id }: NodeProps) {
  const d = data as unknown as AnyGraphNode;
  const { onNavigateToType, onInspectType, allNodeIds, layoutDirection, pendingHydrationNamespaces } = useNavigation();
  const navigation = useTypeNavigationMenu({ onNavigate: onNavigateToType, onInspect: onInspectType });
  const handles = getHandlePositions(layoutDirection);
  // Validation errors live on the node.meta sibling (not on data).
  const nodeErrors = useNodeMetaErrors(id);
  const imports = useNodeMetaImports(id);
  // Hoisted above the structure/default branch below: hooks must run
  // unconditionally on every render, but the structure variant returns
  // early, so this can't sit after that branch (rules-of-hooks).
  const handleTypeClick = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.preventDefault();
      onNavigateToType?.(nodeId);
    },
    [onNavigateToType]
  );

  // -------------------------------------------------------------------------
  // Structure variant — reads data.options (StructureChoiceArm[]) from the
  // adapter. Arms have only a typeName and typeKind — no attrName or
  // cardinality (a choice arm IS a type, not an attribute).
  //
  // Phase 14e/B: arms gain TypePickerCell (when injected via cellComponents)
  // and per-arm expansion chevrons (when the target is Data or Choice).
  // -------------------------------------------------------------------------
  if (isStructureChoice(data)) {
    const options = data.options;
    const {
      cellComponents,
      expansionMap,
      onToggleExpansion,
      instancePath,
      onNavigateToEnumType,
      // Visual-polish #11 (PR #210): same connector overlay inputs as DataNode,
      // keyed by arm typeName for Choice.
      rowOffsets,
      childYByAttrName,
      connectorGeometry
    } = data;
    const TypeCell = cellComponents?.type;
    // `structureDiagnostics` is intentionally NOT destructured here — arms have
    // no astRange today so we don't pass diagnostics through to the row (would
    // be a no-op). See `StructureChoiceArmRow`'s docstring for the threading
    // gap; reintroduce both ends when arms gain astRange.
    const ownerNamespaceUri = data.namespaceUri;
    const ownerTypeName = data.name;
    // Same self-inclusive instancePath convention as DataNode: ancestors + self.
    const ownerInstancePath: ReadonlyArray<string> = [...(instancePath ?? []), id];
    // e2e-batch fix #12: per-node rows-column width from the layout.
    const rowsColWidth = data.rowsColWidth;

    return (
      <BaseFlowNode
        id={id}
        kind="choice"
        name={data.name}
        className="rune-node-choice rune-node-choice--structure"
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
        {/* Body wrapper mirrors DataNode's DOM (PR #210 follow-up to a Codex
            review on PR #210's commit 616f71e5: the existing CSS rule
            `.rune-node-choice--structure .rune-node-body--two-col` never
            matched because Choice had no such wrapper, so the NODE_PADDING
            sides+bottom inset was silently missing for Choice nodes).
            With the wrapper in place, the rows column renders inset 4px
            from the chrome left edge — matching Data — and the connector's
            rowRightX is updated to NODE_PADDING + rowsColWidth (see
            placeChoiceChildren). The empty children-slot is included for
            DOM parity with Data so a future change that consumes the slot
            (e.g. decorative border-left) doesn't have to branch on
            variant. */}
        <div className="rune-node-body rune-node-body--two-col">
          <div className="rune-node-rows" style={rowsColWidth ? { width: rowsColWidth } : undefined}>
            {options.map((arm: StructureChoiceArm) => {
              const expandable = isArmExpandable(arm.typeKind);
              // Arm expansion key convention (Phase 14e/B): arm.typeName fills
              // the attrName slot since arms have no DSL-level attribute name.
              // Matches the adapter's `expandChoiceArms` key construction so
              // chevron writes round-trip through `shouldExpandArm`-equivalent
              // checks symmetrically.
              const rowKey: StructureExpansionKey | undefined = expandable
                ? {
                    namespaceUri: ownerNamespaceUri,
                    typeId: ownerTypeName,
                    attrName: arm.typeName,
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
                <StructureChoiceArmRow
                  key={arm.typeName}
                  arm={arm}
                  expandable={expandable}
                  isExpanded={isExpanded}
                  handleToggle={handleToggle}
                  TypeCell={TypeCell}
                  nodeId={data.id}
                  onNavigateToEnumType={onNavigateToEnumType}
                />
              );
            })}
          </div>
          <div
            className="rune-node-children-slot"
            data-testid="choice-node-children"
            // See DataNode: only decorate when a child column is materialized,
            // else the slot draws a stray dashed divider in empty space.
            data-has-children={(childYByAttrName?.size ?? 0) > 0 ? 'true' : undefined}
          />
        </div>
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

  // -------------------------------------------------------------------------
  // Default graph variant — reads data.attributes (existing behavior).
  // -------------------------------------------------------------------------
  const members = ((d as any).attributes ?? []) as any[];
  const summary = members.length === 0 ? 'No options' : `${members.length} option${members.length === 1 ? '' : 's'}`;

  return (
    <>
      <BaseFlowNode
        id={id}
        kind="choice"
        name={d.name}
        className="rune-node-choice"
        selected={selected}
        dataSummary={summary}
        handles={handles}
      >
        <div className="rune-node-summary">{summary}</div>
        <div className="rune-node-body">
          {members.length > 0 && (
            <div className="rune-node-members">
              {members.map((member: any, i: number) => {
                const typeName = getTypeRefText(member.typeCall);
                const displayName = typeName ?? member.name;
                const targetId = typeName ? resolveTypeNodeId(typeName, allNodeIds, imports) : undefined;
                return (
                  <div key={typeName ?? member.name ?? i} className="rune-node-member">
                    {targetId && navigation.hasActions ? (
                      <button
                        type="button"
                        className="rune-node-member-name nodrag nopan"
                        data-navigable
                        onClick={(e) => handleTypeClick(e, targetId)}
                        {...navigation.targetProps(targetId)}
                      >
                        {displayName}
                      </button>
                    ) : (
                      <span className="rune-node-member-name">{displayName}</span>
                    )}
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
