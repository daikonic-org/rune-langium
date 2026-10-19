// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * CardinalityPicker — chip/pill trigger that opens a compact preset popover.
 *
 * Shares the structure-view / inspector "type selector" idiom: a mono chip
 * trigger (`TypeChip` / `rune-inspector-pill` aesthetic) that opens a
 * `Popover` listing the four common cardinalities plus a custom input. This
 * deliberately mirrors `TypeReferenceField` + `NamespaceTreePicker` rather than
 * a base-ui `Select`, because the Select:
 *   - rendered oversized inside structure nodes (its `data-[size=sm]:h-8` beat
 *     the chip's `h-auto`),
 *   - never opened inside a React Flow node (no `nodrag nopan`, so RF claimed
 *     the pointerdown as a canvas gesture), and
 *   - highlighted items with `text-primary-foreground` (poor contrast) instead
 *     of the `text-accent-foreground` the popover lists use.
 * The Popover + chip trigger fixes all three and unifies the look with the
 * type field. Public props are unchanged so both call sites (the structure
 * `CardinalityCell` `chip` variant and the inspector `AttributeRow` `pill`
 * variant) and z2f's `componentMap` keep working.
 */

import { useCallback, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@rune-langium/design-system/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
import { Input } from '@rune-langium/design-system/ui/input';
import { validateCardinality } from '../../validation/edit-validator.js';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CardinalityPickerProps {
  /** Current cardinality value (e.g., "(0..*)"). */
  value: string;
  /** Called when cardinality changes. */
  onChange: (cardinality: string) => void;
  /** Whether the picker is disabled. */
  disabled?: boolean;
  /**
   * Visual variant for the trigger.
   * - `'default'`: compact mono box (h-5, rounded).
   * - `'chip'`: structure-view chip — wears `rune-cell-card` so it matches the
   *   `TypeChip` cells in the same row.
   * - `'pill'`: inspector pill — wears `rune-inspector-pill`, the shared muted
   *   rounded-field box, so it stays in sync with the type-reference field.
   */
  variant?: 'default' | 'chip' | 'pill';
  /** Optional wrapper class override (merged onto the trigger). */
  wrapperClassName?: string;
  /** Optional trigger class override. */
  triggerClassName?: string;
  /** Optional popover-content class override. */
  contentClassName?: string;
  /** Optional custom-input class override. */
  inputClassName?: string;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const PRESETS = [
  { label: '1..1', value: '(1..1)' },
  { label: '0..1', value: '(0..1)' },
  { label: '0..*', value: '(0..*)' },
  { label: '1..*', value: '(1..*)' }
] as const;

/** Trigger chrome per variant. `nodrag nopan` keeps React Flow from claiming
 *  the click when the chip lives inside a structure node (the same guard the
 *  row's expand button uses). */
const TRIGGER_VARIANT_CLASS: Record<NonNullable<CardinalityPickerProps['variant']>, string> = {
  // Structure chip — `rune-cell-card` is the mono muted pill the TypeChip cells
  // sit beside; the structure-node font-size override drops it to 2xs there.
  chip: 'rune-cell-card nodrag nopan',
  // Inspector pill — the shared muted rounded-field box.
  pill: 'rune-inspector-pill nodrag nopan',
  // Default compact box.
  default:
    'nodrag nopan inline-flex h-5 min-w-[3.75rem] items-center gap-0.5 rounded-md bg-muted px-1.5 text-2xs font-mono leading-none text-muted-foreground'
};

/** Sentinel value used to trigger the custom input flow. */
const CUSTOM_VALUE = '__custom__';

function joinClasses(...classNames: Array<string | undefined>): string | undefined {
  const joined = classNames.filter((className) => Boolean(className && className.trim())).join(' ');
  return joined.length > 0 ? joined : undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CardinalityPicker({
  value,
  onChange,
  disabled = false,
  variant = 'default',
  wrapperClassName,
  triggerClassName,
  contentClassName,
  inputClassName
}: CardinalityPickerProps): React.ReactNode {
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customValue, setCustomValue] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const customInputRef = useRef<HTMLInputElement>(null);

  // Normalize the value for display (strip parens).
  const normalizedValue = value.replace(/[()]/g, '').trim();
  const hasValue = normalizedValue.length > 0;
  const displayValue = hasValue ? normalizedValue : '1..1';
  const matchingPreset = PRESETS.find((p) => p.value.replace(/[()]/g, '').trim() === normalizedValue);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    // Reset the custom flow whenever the popover closes so it reopens to the
    // preset list, not a stale input.
    if (!next) {
      setShowCustom(false);
      setCustomError(null);
    }
  }, []);

  const commitPreset = useCallback(
    (presetValue: string) => {
      onChange(presetValue);
      handleOpenChange(false);
    },
    [onChange, handleOpenChange]
  );

  const startCustom = useCallback(() => {
    setShowCustom(true);
    setCustomValue(normalizedValue);
    setCustomError(null);
  }, [normalizedValue]);

  const commitCustom = useCallback(() => {
    if (!customValue.trim()) {
      setCustomError(null);
      return;
    }
    const error = validateCardinality(customValue);
    if (error) {
      setCustomError(error);
      return;
    }
    setCustomError(null);
    const formatted = customValue.startsWith('(') ? customValue : `(${customValue})`;
    onChange(formatted);
    handleOpenChange(false);
  }, [customValue, onChange, handleOpenChange]);

  const handleCustomKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitCustom();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowCustom(false);
        setCustomError(null);
      }
    },
    [commitCustom]
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        data-slot="cardinality-picker"
        disabled={disabled}
        render={
          <button
            type="button"
            aria-label={`Cardinality ${displayValue}`}
            className={joinClasses(TRIGGER_VARIANT_CLASS[variant], wrapperClassName, triggerClassName)}
          >
            <span data-slot="cardinality-value" className={cn('font-mono', !hasValue && 'text-muted-foreground')}>
              {displayValue}
            </span>
            <ChevronDown className="size-3 shrink-0 opacity-50" aria-hidden="true" />
          </button>
        }
      />
      <PopoverContent align="start" sideOffset={4} className={joinClasses('w-auto min-w-[6rem] p-1', contentClassName)}>
        {showCustom ? (
          <div className="flex flex-col gap-1">
            <Input
              ref={customInputRef}
              variant="inline"
              type="text"
              value={customValue}
              onChange={(e) => {
                setCustomValue(e.target.value);
                setCustomError(null);
              }}
              onKeyDown={handleCustomKeyDown}
              onBlur={commitCustom}
              disabled={disabled}
              placeholder="inf..sup"
              aria-label="Custom cardinality"
              aria-invalid={!!customError}
              autoFocus
              className={joinClasses(
                `w-full px-1.5 py-0.5 text-2xs font-mono leading-none disabled:cursor-not-allowed${customError ? ' border-destructive' : ''}`,
                inputClassName
              )}
            />
            {customError && <span className="px-1 text-2xs text-destructive">{customError}</span>}
          </div>
        ) : (
          <div className="flex flex-col" role="listbox" aria-label="Cardinality presets">
            {PRESETS.map((preset) => {
              const isSelected = matchingPreset?.value === preset.value;
              return (
                <button
                  key={preset.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => commitPreset(preset.value)}
                  className={cn(
                    'flex w-full items-center rounded-sm px-2 py-1 text-xs font-mono text-foreground hover:bg-accent/50',
                    isSelected && 'bg-accent text-accent-foreground'
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
            <div className="my-1 h-px bg-border" aria-hidden="true" />
            <button
              type="button"
              role="option"
              aria-selected={!matchingPreset && hasValue}
              data-value={CUSTOM_VALUE}
              onClick={startCustom}
              className={cn(
                'flex w-full items-center rounded-sm px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50',
                !matchingPreset && hasValue && 'bg-accent text-accent-foreground'
              )}
            >
              Custom…
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
