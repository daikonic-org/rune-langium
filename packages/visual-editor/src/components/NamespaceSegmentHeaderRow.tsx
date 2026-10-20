// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Shared compact namespace header; canonical paths remain available to assistive technology. */

import type { JSX, ReactNode } from 'react';
import { ChevronRight, ChevronDown, Crosshair } from 'lucide-react';
import { Button } from '@rune-langium/design-system/ui/button';
import { NumberChiclet } from '@rune-langium/design-system/ui/number-chiclet';
import { NamespaceTreeGuides } from './NamespaceTreeChrome.js';
import type { TypeKind } from '../types.js';
import { KIND_LABEL } from './KindBadge.js';

// Order the kind-count chips deterministically (most common kinds first) so the
// breakdown reads consistently across namespaces.
const KIND_CHIP_ORDER: readonly TypeKind[] = [
  'data',
  'choice',
  'enum',
  'func',
  'record',
  'typeAlias',
  'basicType',
  'annotation'
];

export { NAMESPACE_TREE_INDENT_BASE } from '../utils/namespace-tree-presentation.js';
export const NAMESPACE_TREE_TYPE_INDENT = 16;

export interface NamespaceSegmentHeaderRowProps {
  /** Optional control rendered before the tree expansion button. */
  leading?: ReactNode;
  /** Aggregated full dotted path shown as the label (e.g. "cdm.base.datetime"). */
  fullPath: string;
  /** Relative segment label; canonical path is retained in title and accessible name. */
  label?: string;
  onFocus?: () => void;
  /** Preserve the specific namespace suffix when a narrow explorer clips the label. */
  truncateFrom?: 'start' | 'end';
  /** Whether this segment is expanded (controls the chevron + collapse state). */
  expanded: boolean;
  /** Total count shown in the trailing chiclet (types in this subtree). */
  count: number;
  /**
   * Per-kind breakdown of the types DIRECTLY in this namespace (kinds with 0
   * omitted). When present and non-empty, a compact muted chip row renders under
   * the header (e.g. "14 data · 2 choice · 1 enum"). Optional so the inspector's
   * type-picker reuse of this row can omit it.
   */
  kindCounts?: Partial<Record<TypeKind, number>>;
  /** Toggle expand/collapse — fired by the chevron button and the label. */
  onToggle: () => void;
  /** Left padding in px, from shared tree geometry. */
  indentPx: number;
  /** Visual nesting depth; capped indentation preserves room for labels. */
  depth?: number;
  /** Optional test id for the outer wrapper (explorer uses `ns-seg-${fullPath}`). */
  'data-testid'?: string;
}

export function NamespaceSegmentHeaderRow({
  leading,
  fullPath,
  label,
  onFocus,
  truncateFrom = 'end',
  expanded,
  count,
  kindCounts,
  onToggle,
  indentPx,
  depth = 0,
  'data-testid': dataTestId
}: NamespaceSegmentHeaderRowProps): JSX.Element {
  // Compact per-kind chips for the types directly in this namespace. Only kinds
  // with count > 0 render; the row is omitted entirely when there are none.
  const kindChips = kindCounts
    ? KIND_CHIP_ORDER.filter((k) => (kindCounts[k] ?? 0) > 0).map((k) => ({ kind: k, count: kindCounts[k]! }))
    : [];
  const kindSummary = kindChips
    .map(({ kind, count: kindCount }) => `${kindCount} ${KIND_LABEL[kind].toLowerCase()}`)
    .join(' · ');
  return (
    <div data-testid={dataTestId} className="group relative">
      <NamespaceTreeGuides depth={depth} />
      <div
        className="rune-ns-seg-header flex items-center gap-1 px-2 py-1 text-sm cursor-default text-foreground"
        style={{ paddingLeft: `${indentPx}px` }}
      >
        {leading}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggle}
          aria-label={expanded ? 'Collapse segment' : 'Expand segment'}
          aria-expanded={expanded}
          className="shrink-0"
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </Button>

        {/* Use a real <button> so keyboard users can toggle the segment with
            Enter/Space and assistive tech announces it as interactive. */}
        <button
          type="button"
          className="min-w-0 flex-1 text-xs font-semibold cursor-pointer bg-transparent border-0 p-0 text-left text-inherit hover:text-inherit focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={onToggle}
          title={fullPath || '(default)'}
          aria-label={fullPath || '(default)'}
          aria-expanded={expanded}
        >
          <span className="block truncate" dir={truncateFrom === 'start' ? 'rtl' : 'ltr'}>
            <bdi dir="ltr">{label ?? (fullPath || '(default)')}</bdi>
          </span>
        </button>

        <NumberChiclet>{count}</NumberChiclet>
        {onFocus && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onFocus}
            aria-label={`Focus namespace ${fullPath || '(default)'}`}
            title="Focus namespace"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Crosshair aria-hidden="true" className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Per-kind breakdown chips for the types directly in this namespace.
          Compact + muted so the dense header rows stay scannable. Indented to
          sit under the label (chevron width + base indent). */}
      {kindChips.length > 0 && (
        <div
          // Single-line + clip: the virtualizer allocates a FIXED row height for
          // the kinds row, so wrapping (flex-wrap) would overflow it and overlap
          // the next row on narrow panels / many kinds. Keep it one line.
          className="flex flex-nowrap items-center gap-x-1.5 overflow-hidden pb-1 text-3xs text-muted-foreground/80"
          style={{ paddingLeft: `${indentPx + 28}px` }}
          title={kindSummary}
          data-testid={dataTestId ? `${dataTestId}-kinds` : undefined}
        >
          {kindChips.map(({ kind, count: kindCount }, i) => (
            <span key={kind} className="inline-flex items-center whitespace-nowrap">
              {i > 0 && <span className="mr-1.5 text-muted-foreground/40">·</span>}
              <span className="font-mono font-medium tabular-nums text-muted-foreground">{kindCount}</span>
              <span className="ml-0.5">{KIND_LABEL[kind].toLowerCase()}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
