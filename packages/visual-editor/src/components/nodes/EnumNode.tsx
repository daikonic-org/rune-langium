// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { AnyGraphNode } from '../../types.js';
import { BaseFlowNode } from './BaseFlowNode.js';
import { getHandlePositions, useNavigation, useNodeMetaErrors } from './NavigationContext.js';
import { ENUM_PREVIEW_LIMIT, enumPreviewLabel } from '../../utils/enum-preview.js';

export const EnumNode = memo(function EnumNode({ data, selected, id }: NodeProps) {
  const d = data as unknown as AnyGraphNode;
  const { layoutDirection, onInspectType } = useNavigation();
  const handles = getHandlePositions(layoutDirection);
  // Validation errors live on the node.meta sibling (not on data).
  const nodeErrors = useNodeMetaErrors(id);

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

function EnumDisclosure({ count, onInspect }: { count: number; onInspect?: () => void }) {
  return (
    <div className="rune-node-member">
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
