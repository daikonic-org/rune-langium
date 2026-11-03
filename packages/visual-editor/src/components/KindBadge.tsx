// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * KindBadge — the single canonical type-kind pill.
 *
 * Wraps the design-system <Badge> (token-backed CVA variants) so color is
 * sourced once. `shape="label"` is the text pill used in the graph + inspector;
 * `shape="glyph"` is the compact single-letter box used in dense tree rows.
 * Intended to replace (as call sites migrate) NodeKindBadge,
 * NamespaceExplorerPanel's inline KIND_COLOR_VAR glyph, and TypeSelector's
 * getKindLabel.
 */
import * as React from 'react';
import { Badge } from '@rune-langium/design-system/ui/badge';
import { cn } from '@rune-langium/design-system/utils';
import type { TypeKind } from '../types.js';

/** Canonical kind → full label. The ONE source for kind labels. */
export const KIND_LABEL: Record<TypeKind, string> = {
  data: 'Data',
  choice: 'Choice',
  enum: 'Enum',
  func: 'Function',
  record: 'Record',
  typeAlias: 'Type Alias',
  basicType: 'Basic Type',
  annotation: 'Annotation'
};

/** Canonical kind → single-letter classifier for the compact glyph shape. */
export const KIND_LETTER: Record<TypeKind, string> = {
  data: 'D',
  choice: 'C',
  enum: 'E',
  func: 'F',
  record: 'R',
  typeAlias: 'A',
  basicType: 'B',
  annotation: '@'
};

export interface KindBadgeProps {
  kind: TypeKind;
  /** 'label' = text pill (graph/inspector); 'glyph' = compact letter box (tree). */
  shape?: 'label' | 'glyph';
  className?: string;
}

export function KindBadge({ kind, shape = 'label', className }: KindBadgeProps): React.ReactElement {
  if (shape === 'glyph') {
    return (
      <Badge
        variant={kind}
        aria-label={KIND_LABEL[kind]}
        className={cn(
          'rune-kind-glyph h-[18px] w-[18px] justify-center rounded-[5px] p-0 font-mono text-3xs font-bold text-foreground',
          className
        )}
      >
        {KIND_LETTER[kind]}
      </Badge>
    );
  }
  return (
    <Badge variant={kind} className={cn('rune-node-kind-badge uppercase tracking-[0.5px]', className)}>
      {KIND_LABEL[kind]}
    </Badge>
  );
}
