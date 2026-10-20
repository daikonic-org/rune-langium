// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Virtual tree hook — wraps @tanstack/react-virtual for namespace explorer tree.
 */

import { useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { RefObject } from 'react';
import type { FlatTreeRow } from '../utils/namespace-tree.js';

const NAMESPACE_ROW_HEIGHT = 36;
const SEGMENT_ROW_HEIGHT = 32;
// Extra height a segment header reserves for the per-kind breakdown chip row.
// Only segments with direct types (non-empty kindCounts) render the chips.
const SEGMENT_KINDS_ROW_HEIGHT = 18;
const TYPE_ROW_HEIGHT = 28;
const QUALIFIED_TYPE_ROW_HEIGHT = 44;

export function useVirtualTree(rows: FlatTreeRow[], scrollRef: RefObject<HTMLDivElement | null>) {
  return useVirtualizer({
    count: rows.length,
    getItemKey: useCallback(
      (index: number) => {
        const row = rows[index]!;
        return row.kind === 'type'
          ? `type:${row.nodeId}:${row.qualifier ?? ''}`
          : row.kind === 'segment'
            ? `segment:${row.fullPath}`
            : `namespace:${row.namespace}`;
      },
      [rows]
    ),
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      if (row?.kind === 'namespace') return NAMESPACE_ROW_HEIGHT;
      if (row?.kind === 'segment') {
        const hasKindChips = Object.keys(row.kindCounts ?? {}).length > 0;
        return SEGMENT_ROW_HEIGHT + (hasKindChips ? SEGMENT_KINDS_ROW_HEIGHT : 0);
      }
      return row?.kind === 'type' && row.qualifier ? QUALIFIED_TYPE_ROW_HEIGHT : TYPE_ROW_HEIGHT;
    },
    overscan: 10
  });
}
