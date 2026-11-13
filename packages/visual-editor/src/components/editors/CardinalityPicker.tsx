// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * CardinalityPicker — shared field trigger and option rows, with Rune preset
 * and custom-cardinality validation. Popover composition retains the custom
 * input flow and React Flow gesture guards in both Structure and Inspector.
 */

import { useCallback, useId, useRef, useState } from 'react';
import { cn } from '@rune-langium/design-system/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
import { Input } from '@rune-langium/design-system/ui/input';
import { FieldError } from '@rune-langium/design-system/ui/field';
import { PickerOption, PickerTrigger } from '@rune-langium/design-system/ui/picker';
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
   * Context hook for Structure (`chip`) or Inspector (`pill`). All variants
   * share the design system's compact field chrome and focus treatment.
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

/** Context hooks retain structure geometry without defining another field look. */
const TRIGGER_VARIANT_CLASS: Record<NonNullable<CardinalityPickerProps['variant']>, string> = {
  chip: 'rune-cell-card',
  pill: 'rune-inspector-pill',
  default: 'min-w-[3.75rem]'
};

/** Sentinel value used to trigger the custom input flow. */
const CUSTOM_VALUE = '__custom__';

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
  const customErrorId = useId();

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
      if (disabled) return;
      onChange(presetValue);
      handleOpenChange(false);
    },
    [disabled, onChange, handleOpenChange]
  );

  const startCustom = useCallback(() => {
    setShowCustom(true);
    setCustomValue(normalizedValue);
    setCustomError(null);
  }, [normalizedValue]);

  const commitCustom = useCallback(() => {
    if (disabled) return;
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
  }, [customValue, disabled, onChange, handleOpenChange]);

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
          <PickerTrigger
            aria-label={`Cardinality ${displayValue}`}
            className={cn(
              'nodrag nopan font-mono text-2xs',
              TRIGGER_VARIANT_CLASS[variant],
              wrapperClassName,
              triggerClassName
            )}
          >
            <span data-slot="cardinality-value" className={cn('font-mono', !hasValue && 'text-muted-foreground')}>
              {displayValue}
            </span>
          </PickerTrigger>
        }
      />
      <PopoverContent align="start" sideOffset={4} className={cn('w-auto min-w-[6rem] p-1', contentClassName)}>
        {showCustom ? (
          <div className="flex flex-col gap-1">
            <Input
              ref={customInputRef}
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
              aria-describedby={customError ? customErrorId : undefined}
              autoFocus
              className={cn('font-mono', inputClassName)}
            />
            <FieldError id={customErrorId} className="px-1">
              {customError}
            </FieldError>
          </div>
        ) : (
          <div className="flex flex-col" role="listbox" aria-label="Cardinality presets">
            {PRESETS.map((preset) => {
              const isSelected = matchingPreset?.value === preset.value;
              return (
                <PickerOption
                  key={preset.value}
                  role="option"
                  aria-selected={isSelected}
                  disabled={disabled}
                  onClick={() => commitPreset(preset.value)}
                  className="font-mono"
                >
                  {preset.label}
                </PickerOption>
              );
            })}
            <div className="my-1 h-px bg-border" aria-hidden="true" />
            <PickerOption
              role="option"
              aria-selected={!matchingPreset && hasValue}
              disabled={disabled}
              data-value={CUSTOM_VALUE}
              onClick={startCustom}
              className="text-muted-foreground"
            >
              Custom…
            </PickerOption>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
