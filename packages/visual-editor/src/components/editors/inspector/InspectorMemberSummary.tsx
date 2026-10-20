// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { ReactNode } from 'react';
import { TypeLink } from '../TypeLink.js';
import {
  INSPECTOR_ROW_CLASS,
  INSPECTOR_ROW_NAME_CLASS,
  inspectorRowAttributes,
  type InspectorRowProps
} from './inspector-row.js';
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
      className={`${INSPECTOR_ROW_CLASS} flex min-h-9 min-w-0 items-center gap-2 text-xs`}
    >
      <span data-slot={nameSlot} className={`${INSPECTOR_ROW_NAME_CLASS} flex-1 truncate font-mono`}>
        {name || '(unnamed)'}
      </span>
      <div className="flex min-w-0 max-w-2/3 items-center gap-1.5 pr-2">
        {typeName && (
          <TypeLink
            typeName={typeName}
            onNavigateToNode={onNavigateToNode}
            allNodeIds={allNodeIds}
            className="truncate text-muted-foreground"
          />
        )}
        {cardinality && <span className="shrink-0 text-muted-foreground">{cardinality}</span>}
      </div>
      {children}
    </div>
  );
}
