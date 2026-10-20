// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * EnumNode — Custom ReactFlow node for Rune DSL `RosettaEnumeration` types.
 *
 * Two rendering variants:
 *   - `variant === 'structure'`: structure-view context. Reads `data.values`
 *     (StructureEnumNode.values: ReadonlyArray<string>). Renders each value
 *     as a bounded row preview. The Inspector owns the complete value list.
 *   - default (graph view): reads `data.enumValues` with summary count.
 */

import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { AnyGraphNode } from '../../types.js';
import type { StructureEnumNode } from '../../types/structure-view.js';
import { BaseFlowNode } from './BaseFlowNode.js';
import { getHandlePositions, useNavigation, useNodeMetaErrors } from './NavigationContext.js';
import { ENUM_PREVIEW_LIMIT, enumPreviewLabel } from '../../utils/enum-preview.js';

// ---------------------------------------------------------------------------
// Structure-variant helpers (Phase 14e/A)
// ---------------------------------------------------------------------------

interface StructureEnumNodeData extends StructureEnumNode {
  readonly variant: 'structure';
}

function isStructureEnum(d: unknown): d is StructureEnumNodeData {
  return typeof d === 'object' && d !== null && (d as { variant?: unknown }).variant === 'structure';
}

export const EnumNode = memo(function EnumNode({ data, selected, id }: NodeProps) {
  const d = data as unknown as AnyGraphNode;
  const { layoutDirection, pendingHydrationNamespaces, onInspectType } = useNavigation();
  const handles = getHandlePositions(layoutDirection);
  // Validation errors live on the node.meta sibling (not on data).
  const nodeErrors = useNodeMetaErrors(id);

  // -------------------------------------------------------------------------
  // Structure variant — reads data.values (ReadonlyArray<string>) emitted by
  // the adapter (StructureEnumNode). Enums are read-only and terminal: no
  // editable cells or expansion trees; long lists disclose through the host.
  // -------------------------------------------------------------------------
  if (isStructureEnum(data)) {
    const values = data.values;
    // e2e-batch fix #12: per-node rows-column width from the layout.
    const rowsColWidth = (data as { rowsColWidth?: number }).rowsColWidth;
    return (
      <BaseFlowNode
        id={id}
        kind="enum"
        name={data.name}
        className="rune-node-enum rune-node-enum--structure"
        selected={selected}
        hydrating={Boolean(data.deferred) && pendingHydrationNamespaces.includes(data.namespaceUri)}
      >
        <div className="rune-node-rows" style={rowsColWidth ? { width: rowsColWidth } : undefined}>
          {values.slice(0, ENUM_PREVIEW_LIMIT).map((value) => (
            <div key={value} className="rune-node-row" data-attr={value}>
              <span className="rune-cell-name">{value}</span>
            </div>
          ))}
          {values.length > ENUM_PREVIEW_LIMIT && (
            <EnumDisclosure
              count={values.length}
              onInspect={onInspectType ? () => onInspectType(data.id) : undefined}
              structure
            />
          )}
        </div>
      </BaseFlowNode>
    );
  }

  // -------------------------------------------------------------------------
  // Default graph variant — reads data.enumValues (pre-existing behavior).
  // -------------------------------------------------------------------------
  const members = ((d as any).enumValues ?? []) as any[];
  const summary = members.length === 0 ? 'No values' : `${members.length} value${members.length === 1 ? '' : 's'}`;

  return (
    <BaseFlowNode
      id={id}
      kind="enum"
      name={d.name}
      className="rune-node-enum"
      selected={selected}
      dataSummary={summary}
      handles={handles}
    >
      <div className="rune-node-summary">{summary}</div>
      <div className="rune-node-body">
        {members.length > 0 && (
          <div className="rune-node-members">
            {members.slice(0, ENUM_PREVIEW_LIMIT).map((member: any) => (
              <div key={member.name} className="rune-node-member">
                <span className="rune-node-member-name">{member.name}</span>
              </div>
            ))}
            {members.length > ENUM_PREVIEW_LIMIT && (
              <EnumDisclosure count={members.length} onInspect={onInspectType ? () => onInspectType(id) : undefined} />
            )}
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
  );
});

function EnumDisclosure({
  count,
  onInspect,
  structure = false
}: {
  count: number;
  onInspect?: () => void;
  structure?: boolean;
}) {
  return (
    <div className={structure ? 'rune-node-row' : 'rune-node-member'}>
      {onInspect ? (
        <button
          type="button"
          className="nodrag nopan rune-enum-disclosure"
          onClick={(event) => {
            event.stopPropagation();
            onInspect();
          }}
        >
          {enumPreviewLabel(count)}
        </button>
      ) : (
        <span className="rune-enum-disclosure">{count - ENUM_PREVIEW_LIMIT} more values</span>
      )}
    </div>
  );
}
