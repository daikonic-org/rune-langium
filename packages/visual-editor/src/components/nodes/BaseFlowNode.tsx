// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * BaseFlowNode — shared chrome shell for ReactFlow custom node components
 * (DataNode, ChoiceNode, EnumNode, FunctionNode, GenericNode).
 *
 * Owns the parts that were duplicated across every node's structure- and
 * graph-variant render branches: the outer wrapper (className + selected
 * state), the header row (kind badge + name + optional meta-indicators
 * slot), the optional target/source Handles used by graph-variant nodes,
 * and the hydrating-placeholder overlay. Each node keeps its own body
 * content (rows, attributes, members, func I/O) and passes it as
 * children — this component does not know about any node-specific data
 * shape, mirroring the InteractiveDialog shell-only precedent.
 */

import type { ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Spinner } from '@rune-langium/design-system/ui/spinner';
import type { TypeKind } from '../../types.js';
import { NodeKindBadge } from './NodeKindBadge.js';
import { useNodeMetaHydrating } from './NavigationContext.js';

export interface BaseFlowNodeHandles {
  target: Position;
  source: Position;
}

export interface BaseFlowNodeProps {
  /** ReactFlow node id — used to look up meta (errors/hydrating state) via the store. */
  id: string;
  kind: TypeKind;
  name: string;
  /** Kind-specific class(es), e.g. `rune-node-data` or `rune-node-data rune-node-data--structure`. */
  className: string;
  selected?: boolean;
  /** `data-summary` attribute used by the graph variant's collapsed-view CSS. */
  dataSummary?: string;
  /** Structure-variant meta cluster (definition/annotations/conditions popovers). */
  metaIndicators?: ReactNode;
  /** Presence renders target/source Handles (graph variant only). */
  handles?: BaseFlowNodeHandles;
  /**
   * Explicit hydrating override. Graph-variant nodes leave this unset and
   * rely on `useNodeMetaHydrating` (reads `meta.deferred` off the ReactFlow
   * store). Structure-view nodes have no RF-level `meta` — their data
   * carries its own `deferred` field instead — so callers compute the
   * hydrating state themselves and pass it in here.
   */
  hydrating?: boolean;
  children?: ReactNode;
}

export function BaseFlowNode({
  id,
  kind,
  name,
  className,
  selected,
  dataSummary,
  metaIndicators,
  handles,
  hydrating,
  children
}: BaseFlowNodeProps): React.ReactElement {
  const metaHydrating = useNodeMetaHydrating(id);
  const isHydrating = hydrating ?? metaHydrating;

  return (
    <div
      className={`rune-node ${className}${selected ? ' rune-node-selected' : ''}${isHydrating ? ' rune-node-hydrating' : ''}`}
      data-summary={dataSummary}
    >
      {handles ? <Handle type="target" position={handles.target} /> : null}
      <div className="rune-node-header">
        <NodeKindBadge kind={kind} />
        <span className="rune-node-name" title={name}>
          {name}
        </span>
        {metaIndicators}
        {isHydrating ? (
          <>
            <Spinner
              className="rune-node-hydrating-spinner size-3"
              aria-hidden="true"
              data-testid="rune-node-hydrating-spinner"
            />
            {/* The node name is already announced via the adjacent `name` span —
                this status text describes the hydrating state without repeating it. */}
            <span className="sr-only">Loading…</span>
          </>
        ) : null}
      </div>
      {children}
      {handles ? <Handle type="source" position={handles.source} /> : null}
    </div>
  );
}
