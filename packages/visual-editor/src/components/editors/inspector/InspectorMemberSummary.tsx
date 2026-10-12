// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { ReactNode } from 'react';
import { TypeLink } from '../TypeLink.js';
import { inspectorRowAttributes, type InspectorRowProps } from './inspector-row.js';
import type { NavigateToNodeCallback } from '../../../types.js';

/** Static member presentation shared by fallback Inspectors and the public input row. */
export function InspectorMemberSummary({
  name,
  typeName,
  cardinality,
  slot = 'readonly-member-row',
  nameSlot,
  children,
  onNavigateToNode,
  allNodeIds,
  ...selection
}: InspectorRowProps & {
  name: string;
  typeName?: string;
  cardinality?: string;
  slot?: string;
  nameSlot?: string;
  children?: ReactNode;
  onNavigateToNode?: NavigateToNodeCallback;
  allNodeIds?: string[];
}) {
  return (
    <div
      data-slot={slot}
      role="listitem"
      {...inspectorRowAttributes(selection, name)}
      className="rune-inspector-row flex min-w-0 items-center gap-1.5 rounded border border-transparent p-1 text-xs"
    >
      <span data-slot={nameSlot} className="min-w-0 flex-1 truncate font-mono">
        {name || '(unnamed)'}
      </span>
      {typeName && (
        <TypeLink
          typeName={typeName}
          onNavigateToNode={onNavigateToNode}
          allNodeIds={allNodeIds}
          className="text-muted-foreground"
        />
      )}
      {cardinality && <span className="shrink-0 text-muted-foreground">{cardinality}</span>}
      {children}
    </div>
  );
}
