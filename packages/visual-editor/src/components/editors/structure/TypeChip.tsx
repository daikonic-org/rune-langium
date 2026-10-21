// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import * as React from 'react';
import { cn } from '@rune-langium/design-system/utils';
import type { TypeOption } from '../../../types.js';

export type TypeChipKind = 'Data' | 'Choice' | 'Enum' | 'BasicType' | 'Record' | 'TypeAlias' | 'Unresolved';

// Map a TypeOption kind to the canonical TypeChip color variant. Func/Annotation
// (and an unknown/missing kind) fall to 'Unresolved' — they are not valid
// attribute type-refs, so they only appear here in degenerate states.
const KIND_TO_CHIP: Partial<Record<NonNullable<TypeOption['kind']>, TypeChipKind>> = {
  data: 'Data',
  choice: 'Choice',
  enum: 'Enum',
  record: 'Record',
  typeAlias: 'TypeAlias',
  basicType: 'BasicType',
  builtin: 'BasicType'
};

export function typeChipKind(kind: TypeOption['kind'] | undefined): TypeChipKind {
  return (kind && KIND_TO_CHIP[kind]) ?? 'Unresolved';
}

/**
 * TypeChip — the canonical "type as chip" idiom (structure-view cells + the
 * inspector type-reference field).
 *
 * Component-override convention: the chip's INTRINSIC look (mono pill layout +
 * per-kind colour) lives here — utilities plus a per-kind CSS-var swap for the
 * `color-mix` fills that have no utility form. The `rune-cell-type-chip` class
 * is retained as a stable hook for the CONTEXTUAL overrides that legitimately
 * stay in CSS (visual-editor styles.css) because they depend on where the chip
 * is nested — parent-driven state a self-contained component can't express:
 *   - base-container row    → `margin-left: auto`
 *   - type-picker trigger   → ellipsis truncation (`[data-slot='type-picker-trigger']`)
 *   - structure-node cells  → `font-size: var(--text-2xs)`
 *   - drag-over wrapper      → focus outline
 * Those rules are unlayered, so they still win over the layered utilities here.
 * A test also queries `.rune-cell-type-chip`, so the class must remain.
 *
 * Polymorphic via `as`: defaults to `button` (the interactive popover trigger —
 * forwards its ref so base-ui's `<PopoverTrigger render>` can attach), or `span`
 * for a static display chip (e.g. the base-container row).
 */

// Per-kind colour surface. Data/Record/TypeAlias share the data palette;
// BasicType & Unresolved use `color-mix` tints (the tier-3 vars).
type TypeChipStyle = React.CSSProperties & { '--type-chip-bg': string; '--type-chip-fg': string };
const kindVars: Record<TypeChipKind, TypeChipStyle> = {
  Data: { '--type-chip-bg': 'var(--color-data-badge)', '--type-chip-fg': 'var(--color-data-text)' },
  Record: { '--type-chip-bg': 'var(--color-data-badge)', '--type-chip-fg': 'var(--color-data-text)' },
  TypeAlias: { '--type-chip-bg': 'var(--color-data-badge)', '--type-chip-fg': 'var(--color-data-text)' },
  Choice: { '--type-chip-bg': 'var(--color-choice-bg)', '--type-chip-fg': 'var(--color-choice-text)' },
  Enum: { '--type-chip-bg': 'var(--color-enum-bg)', '--type-chip-fg': 'var(--color-enum-text)' },
  BasicType: {
    '--type-chip-bg': 'color-mix(in oklch, var(--muted-foreground) 14%, transparent)',
    '--type-chip-fg': 'var(--muted-foreground)'
  },
  Unresolved: {
    '--type-chip-bg': 'color-mix(in oklch, var(--destructive) 14%, transparent)',
    '--type-chip-fg': 'var(--destructive)'
  }
};

export interface TypeChipProps extends React.ComponentProps<'button'> {
  typeName: string;
  typeKind: TypeChipKind;
  /** Render element. `button` (default) for interactive triggers; `span` for a
   *  static display chip (no ref / handlers). */
  as?: 'button' | 'span';
}

export const TypeChip = React.forwardRef<HTMLButtonElement, TypeChipProps>(function TypeChip(
  { typeName, typeKind, className, style, as = 'button', disabled, ...props },
  ref
): React.ReactElement {
  const Component = as as React.ElementType;
  const isButton = as === 'button';
  return (
    <Component
      // Only the button case is a real HTMLButtonElement, so only forward the
      // (button-typed) ref then — a `span` would be a type/runtime mismatch.
      ref={isButton ? ref : undefined}
      {...(isButton ? { type: 'button', disabled } : {})}
      data-slot="type-chip"
      data-kind={typeKind}
      style={
        {
          ...kindVars[typeKind],
          '--type-chip-fg': `color-mix(in oklch, ${kindVars[typeKind]['--type-chip-fg']} 85%, var(--foreground))`,
          ...(style as React.CSSProperties)
        } as React.CSSProperties
      }
      className={cn(
        // `rune-cell-type-chip` = the contextual-CSS + test hook (see header).
        'rune-cell-type-chip',
        // Intrinsic look: mono pill, kind-tinted surface.
        'inline-flex items-center justify-center rounded-sm border border-transparent',
        'px-(--rune-chip-padding-x) py-(--rune-chip-padding-y) font-mono text-xs leading-none not-italic',
        'bg-(--type-chip-bg) text-(color:--type-chip-fg) transition-colors duration-[120ms]',
        // Interactive affordance only for an ENABLED button. A disabled button
        // gets not-allowed explicitly (the global `:disabled` baseline is
        // specificity-0 and would lose to a `cursor-*` utility); the static
        // `span` display chip gets neither pointer nor hover ring.
        isButton ? (disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:border-current') : 'cursor-default',
        className
      )}
      {...props}
    >
      {typeName}
    </Component>
  );
});
