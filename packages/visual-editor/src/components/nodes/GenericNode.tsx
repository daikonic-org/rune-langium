// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * GenericNode — Custom ReactFlow node for secondary Rune DSL constructs.
 *
 * Shared component for record, typeAlias, basicType, and annotation nodes.
 * Displays type name, kind badge, members (if any), parent reference,
 * and validation errors.
 */

import { memo, useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { AnyGraphNode, TypeKind } from '../../types.js';
import { resolveNodeKind, getTypeRefText, formatCardinality, getRefText } from '../../adapters/model-helpers.js';
import {
  getHandlePositions,
  useNavigation,
  resolveTypeNodeId,
  useNodeMetaErrors,
  useNodeMetaImports
} from './NavigationContext.js';
import { BaseFlowNode } from './BaseFlowNode.js';

const KIND_CSS: Record<string, string> = {
  func: 'rune-node-func',
  record: 'rune-node-record',
  typeAlias: 'rune-node-typealias',
  basicType: 'rune-node-basictype',
  annotation: 'rune-node-annotation'
};

export const GenericNode = memo(function GenericNode({ data, selected, id }: NodeProps) {
  const d = data as unknown as AnyGraphNode;
  const kind = resolveNodeKind(d) as TypeKind;
  const kindCss = KIND_CSS[kind] ?? '';
  const parentName = getRefText((d as any).superType);
  const { onNavigateToType, allNodeIds, layoutDirection } = useNavigation();
  const handles = getHandlePositions(layoutDirection);
  // Validation errors live on the node.meta sibling (not on data).
  const nodeErrors = useNodeMetaErrors(id);
  const imports = useNodeMetaImports(id);
  // For functions, show inputs as members; otherwise show attributes/features
  const members = (
    kind === 'func' ? ((d as any).inputs ?? []) : ((d as any).attributes ?? (d as any).features ?? [])
  ) as any[];

  const handleTypeClick = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.preventDefault();
      onNavigateToType?.(nodeId);
    },
    [onNavigateToType]
  );

  const outputTypeName = kind === 'func' ? getTypeRefText((d as any).output?.typeCall) : undefined;
  const outputTargetId = outputTypeName ? resolveTypeNodeId(outputTypeName, allNodeIds, imports) : undefined;
  const parentTargetId = parentName ? resolveTypeNodeId(parentName, allNodeIds, imports) : undefined;
  const summaryParts: string[] = [];
  if (parentName) summaryParts.push(`extends ${parentName}`);
  if (members.length > 0) {
    summaryParts.push(`${members.length} member${members.length === 1 ? '' : 's'}`);
  } else if (kind === 'func' && outputTypeName) {
    summaryParts.push(`returns ${outputTypeName}`);
  }
  const summary = summaryParts.join(' • ') || 'No members';

  return (
    <BaseFlowNode
      id={id}
      kind={kind}
      name={d.name}
      className={kindCss}
      selected={selected}
      dataSummary={summary}
      handles={handles}
    >
      <div className="rune-node-summary">{summary}</div>
      <div className="rune-node-body">
        {parentName && (
          <div className="rune-node-parent">
            <span className="rune-node-parent-label">→ </span>
            {parentTargetId && onNavigateToType ? (
              <button
                type="button"
                className="nodrag nopan"
                data-navigable
                onClick={(e) => handleTypeClick(e, parentTargetId)}
              >
                {parentName}
              </button>
            ) : (
              <span>{parentName}</span>
            )}
          </div>
        )}
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
                    (targetId && onNavigateToType ? (
                      <button
                        type="button"
                        className="rune-node-member-type nodrag nopan"
                        data-navigable
                        onClick={(e) => handleTypeClick(e, targetId)}
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
        {kind === 'func' && (d as any).output && (
          <div className="rune-node-members" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="rune-node-member">
              <span className="rune-node-member-name">output</span>
              {outputTargetId && onNavigateToType ? (
                <button
                  type="button"
                  className="rune-node-member-type nodrag nopan"
                  data-navigable
                  onClick={(e) => handleTypeClick(e, outputTargetId)}
                >
                  {outputTypeName}
                </button>
              ) : (
                <span className="rune-node-member-type">{outputTypeName}</span>
              )}
            </div>
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
