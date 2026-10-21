// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { memo, useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { AnyGraphNode } from '../../types.js';
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

export const ChoiceNode = memo(function ChoiceNode({ data, selected, id }: NodeProps) {
  const d = data as unknown as AnyGraphNode;
  const { onNavigateToType, onInspectType, allNodeIds, layoutDirection } = useNavigation();
  const navigation = useTypeNavigationMenu({ onNavigate: onNavigateToType, onInspect: onInspectType });
  const handles = getHandlePositions(layoutDirection);
  // Validation errors live on the node.meta sibling (not on data).
  const nodeErrors = useNodeMetaErrors(id);
  const imports = useNodeMetaImports(id);
  const handleTypeClick = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.preventDefault();
      onNavigateToType?.(nodeId);
    },
    [onNavigateToType]
  );

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
