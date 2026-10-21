// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { memo, useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { AnyGraphNode } from '../../types.js';
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

export const DataNode = memo(function DataNode({ data, selected, id }: NodeProps) {
  const d = data as unknown as AnyGraphNode;
  const members = ((d as any).attributes ?? []) as any[];
  const { onNavigateToType, onInspectType, allNodeIds, layoutDirection } = useNavigation();
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
