// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * TypeSelector — searchable type dropdown with kind-colored badges.
 *
 * Uses composition-based architecture: accepts `renderTrigger` and
 * `renderPopover` render-props so the host app can inject shadcn
 * Popover + Command primitives. Falls back to a shadcn Select
 * when render-props are not provided.
 */

import { useCallback, useMemo, useState } from 'react';
import type { TypeOption, TypeKind } from '../../types.js';
import { KIND_LABEL } from '../KindBadge.js';
import { badgeVariants } from '@rune-langium/design-system/ui/badge';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@rune-langium/design-system/ui/select';
import { useTypeRefDrop } from '../../hooks/useTypeRefDrop.js';
import type { TypeRefPayload } from '../../types/structure-view.js';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TypeSelectorProps {
  /** Currently selected type value (node ID or built-in type name). */
  value: string | null;
  /** Available types to choose from. May be undefined before types are loaded. */
  options?: TypeOption[];
  /** Placeholder text. */
  placeholder?: string;
  /** Called when a type is selected. */
  onSelect: (value: string | null) => void;
  /** Whether the selector is disabled. */
  disabled?: boolean;
  /** Whether to include a "None" / clear option. */
  allowClear?: boolean;
  /** Filter options to specific kinds. */
  filterKinds?: Array<TypeKind | 'builtin'>;
  /** Additional CSS classes for the fallback trigger surface. */
  triggerClassName?: string;
  /** Render-prop for the trigger (button that opens the popover). */
  renderTrigger?: (props: TypeSelectorTriggerProps) => React.ReactNode;
  /** Render-prop for the popover content (search + list). */
  renderPopover?: (props: TypeSelectorPopoverProps) => React.ReactNode;
}

export interface TypeSelectorTriggerProps {
  /** Currently selected option, or null. */
  selected: TypeOption | null;
  /** Placeholder text. */
  placeholder: string;
  /** Whether the popover is open. */
  open: boolean;
  /** Toggle the popover. */
  onToggle: () => void;
  /** Whether the selector is disabled. */
  disabled: boolean;
}

export interface TypeSelectorPopoverProps {
  /** Grouped and filtered options ready for rendering. */
  groups: TypeSelectorGroup[];
  /** Current search query. */
  searchQuery: string;
  /** Update the search query. */
  onSearchChange: (query: string) => void;
  /** Handle option selection. */
  onSelect: (value: string | null) => void;
  /** Whether to show a "None" clear option. */
  allowClear: boolean;
  /** The currently selected value. */
  selectedValue: string | null;
}

export interface TypeSelectorGroup {
  label: string;
  options: TypeOption[];
}

// ---------------------------------------------------------------------------
// Kind badge color mapping
//
// Per R12 (specs/013-z2f-editor-migration/research.md), editor components
// must consume colors via design-system primitives or `var(--color-*)`
// tokens, never hardcoded Tailwind palette utilities (the kind matched by
// the no-hardcoded-colours CI guard at packages/visual-editor/test/quality).
// We delegate to `badgeVariants` from `@rune-langium/design-system/ui/badge`
// (which owns the kind-specific palette) and to design-tokens CSS variables
// for the inline dot indicators.
// ---------------------------------------------------------------------------

/**
 * Map a TypeKind to the design-system Badge variant key. The Badge component
 * already exposes `data | enum | choice | func | record | typeAlias |
 * basicType | annotation` variants. `builtin` falls through to `basicType`
 * (gray) — visually unchanged from the previous local mapping.
 */
type BadgeKindVariant = 'data' | 'enum' | 'choice' | 'func' | 'record' | 'typeAlias' | 'basicType' | 'annotation';

function kindToBadgeVariant(kind: TypeKind | 'builtin'): BadgeKindVariant {
  return kind === 'builtin' ? 'basicType' : kind;
}

/**
 * Solid dot colors for inline type indicators. Token-backed for the four
 * kinds with dedicated `--color-{kind}` vars in theme.css; the remaining
 * kinds reuse the muted-foreground token. This is a deliberate, minor
 * visual shift documented in T077 — the previous mapping used per-kind
 * Tailwind palette colors that bypassed the design-tokens layer.
 */
const KIND_DOT_TOKEN_CLASS: Record<TypeKind | 'builtin', string> = {
  data: 'bg-data',
  choice: 'bg-choice',
  enum: 'bg-enum',
  func: 'bg-func',
  record: 'bg-data',
  typeAlias: 'bg-muted-foreground',
  basicType: 'bg-muted-foreground',
  annotation: 'bg-choice',
  builtin: 'bg-muted-foreground'
};

export function getKindDotClass(kind: TypeKind | 'builtin'): string {
  return KIND_DOT_TOKEN_CLASS[kind] ?? KIND_DOT_TOKEN_CLASS.builtin;
}

/**
 * Returns badge CSS classes for a given type kind. Wraps the design-system
 * `badgeVariants` so callers (e.g. `ChoiceOptionRow`, `TypeLink`) get
 * token-backed colors automatically.
 */
export function getKindBadgeClasses(kind: TypeKind | 'builtin'): string {
  return badgeVariants({ variant: kindToBadgeVariant(kind) });
}

/**
 * Returns a human-readable label for a type kind.
 * Delegates to the canonical KIND_LABEL map from KindBadge; handles the
 * 'builtin' pseudo-kind (not a TypeKind) locally since KIND_LABEL only
 * covers TypeKind values.
 */
export function getKindLabel(kind: TypeKind | 'builtin'): string {
  return kind === 'builtin' ? 'Built-in' : KIND_LABEL[kind];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Searchable type selector with kind-colored badges.
 *
 * When `renderTrigger` and `renderPopover` are provided, uses composition
 * to inject host app UI primitives (e.g., shadcn Popover + Command).
 * Otherwise falls back to a shadcn Select.
 */
export function TypeSelector({
  value,
  options,
  placeholder = 'Select type...',
  onSelect,
  disabled = false,
  allowClear = false,
  filterKinds,
  triggerClassName,
  renderTrigger,
  renderPopover
}: TypeSelectorProps): React.ReactNode {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Filter options by kind if specified
  const filteredOptions = useMemo(() => {
    if (!options) return [];
    if (!filterKinds || filterKinds.length === 0) return options;
    const kindSet = new Set(filterKinds);
    return options.filter((opt) => kindSet.has(opt.kind));
  }, [options, filterKinds]);

  // Apply search filter
  const searchedOptions = useMemo(() => {
    if (!searchQuery.trim()) return filteredOptions;
    const query = searchQuery.toLowerCase();
    return filteredOptions.filter((opt) => opt.label.toLowerCase().includes(query));
  }, [filteredOptions, searchQuery]);

  // Group options by kind then namespace
  const groups = useMemo((): TypeSelectorGroup[] => {
    const result: TypeSelectorGroup[] = [];

    // Built-in types first
    const builtins = searchedOptions.filter((o) => o.kind === 'builtin');
    if (builtins.length > 0) {
      result.push({ label: 'Built-in', options: builtins });
    }

    // Group user types by namespace
    const byNamespace = new Map<string, TypeOption[]>();
    for (const opt of searchedOptions) {
      if (opt.kind === 'builtin') continue;
      const ns = opt.namespace ?? 'Global';
      if (!byNamespace.has(ns)) {
        byNamespace.set(ns, []);
      }
      byNamespace.get(ns)!.push(opt);
    }

    for (const [ns, opts] of byNamespace) {
      result.push({ label: ns, options: opts });
    }

    return result;
  }, [searchedOptions]);

  // Find current selection
  const selected = useMemo(() => options?.find((o) => o.value === value) ?? null, [options, value]);

  const handleSelect = useCallback(
    (val: string | null) => {
      onSelect(val);
      setOpen(false);
      setSearchQuery('');
    },
    [onSelect]
  );

  const handleToggle = () => {
    if (!disabled) {
      setOpen(!open);
      if (open) setSearchQuery('');
    }
  };

  // Accept a drag from the namespace explorer (same dual-MIME contract as
  // StructureView's TypePickerCell) so dropping a type-ref on the
  // Inspector's type selector picks that type. The dropped payload's
  // `typeId` is the canonical `namespace.Name` identifier the store
  // expects for cross-namespace resolution; we forward it directly to
  // `onSelect`, matching how a click on a SelectItem would behave
  // (the SelectItem's value is also the canonical id). `accept` mirrors
  // the optional `filterKinds` prop so the selector silently ignores
  // drops of kinds it isn't allowed to accept (e.g. dragging a Function
  // onto a typeAlias-only selector).
  const acceptKinds: ReadonlyArray<TypeRefPayload['kind']> = useMemo(() => {
    if (disabled) return [];
    // Valid attribute type-refs. Func/Annotation are intentionally absent —
    // they're draggable from the explorer but never a valid attribute type.
    const all: ReadonlyArray<TypeRefPayload['kind']> = ['Data', 'Choice', 'Enum', 'BasicType', 'Record', 'TypeAlias'];
    // "No filter specified" (undefined or empty array) means the selector
    // accepts every draggable kind — that's the caller's signal of "I have
    // no opinion about kinds; let any type-ref drop through".
    if (!filterKinds || filterKinds.length === 0) return all;
    // Map PascalCase payload kinds back to lowercase TypeKind. BasicType and
    // TypeAlias are camelCase in TypeKind, so they can't use a plain toLowerCase().
    const toTypeKind = (k: TypeRefPayload['kind']): TypeKind =>
      k === 'BasicType' ? 'basicType' : k === 'TypeAlias' ? 'typeAlias' : (k.toLowerCase() as TypeKind);
    const mapped = all.filter((k) => filterKinds.includes(toTypeKind(k)));
    // P2 review (PR #210): when filterKinds is NON-empty but maps to zero
    // draggable kinds (e.g. caller passed `['builtin', 'func', 'typeAlias']`,
    // none of which have draggable analogs in TypeRefPayload), reject all
    // drops. The previous `mapped.length > 0 ? mapped : all` fallback
    // silently widened the contract to accept everything — bypassing the
    // caller's stated filter. "Specified an opinion but no draggable kinds
    // match" is a stricter signal than "specified no opinion at all".
    return mapped;
  }, [disabled, filterKinds]);
  const handleDrop = useCallback(
    (payload: TypeRefPayload) => {
      handleSelect(payload.typeId);
    },
    [handleSelect]
  );
  const { dragOverHandlers, isOver } = useTypeRefDrop({ accept: acceptKinds, onDrop: handleDrop });
  const dropAttrs = {
    ...dragOverHandlers,
    'data-drop-over': isOver ? 'true' : undefined,
    'data-type-selector-drop': 'true'
  };

  // Composition mode: use render-props
  if (renderTrigger && renderPopover) {
    return (
      <span {...dropAttrs} className="inline-block">
        {renderTrigger({
          selected,
          placeholder,
          open,
          onToggle: handleToggle,
          disabled
        })}
        {open &&
          renderPopover({
            groups,
            searchQuery,
            onSearchChange: setSearchQuery,
            onSelect: handleSelect,
            allowClear,
            selectedValue: value
          })}
      </span>
    );
  }

  // Fallback mode: shadcn Select. Wrap the Select in a drop-target span
  // so the trigger AND any popover-hovering area can accept type-ref
  // drops. The `data-drop-over` attribute drives the focus-ring style in
  // styles.css (see `[data-type-selector-drop][data-drop-over]`).
  const NONE_SENTINEL = '__none__';
  return (
    <span {...dropAttrs} className="inline-block w-full">
      <Select
        value={value ?? NONE_SENTINEL}
        onValueChange={(val) => handleSelect(val === NONE_SENTINEL ? null : val)}
        disabled={disabled}
      >
        <SelectTrigger
          aria-label={placeholder}
          size="sm"
          data-slot="type-selector"
          className={`data-[size=sm]:h-6 py-0 text-xs px-2 ${triggerClassName ?? ''}`.trim()}
        >
          <SelectValue placeholder={allowClear ? '— None —' : placeholder} />
        </SelectTrigger>
        <SelectContent className="rune-type-selector__content">
          {allowClear && <SelectItem value={NONE_SENTINEL}>— None —</SelectItem>}
          {groups.map((group) => (
            <SelectGroup key={group.label}>
              <SelectLabel>{group.label}</SelectLabel>
              {group.options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={`inline-block size-2 rounded-full shrink-0 ${getKindDotClass(opt.kind)}`}
                      aria-hidden="true"
                    />
                    {opt.label}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </span>
  );
}
