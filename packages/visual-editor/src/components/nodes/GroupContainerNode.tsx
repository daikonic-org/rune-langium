// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { Node, NodeProps } from '@xyflow/react';

export interface GroupContainerInheritanceData extends Record<string, unknown> {
  scope: 'inheritance';
  label: string;
  description?: string;
  nodeCount: number;
}

export type GroupContainerData = GroupContainerInheritanceData;
export type GroupContainerNodeType = Node<GroupContainerData, 'groupContainer'>;

export function GroupContainerNode({ data }: NodeProps<GroupContainerNodeType>): React.ReactElement {
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
