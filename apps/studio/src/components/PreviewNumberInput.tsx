// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useState, type ComponentProps } from 'react';
import { Input } from '@rune-langium/design-system/ui/input';
import { cn } from '@rune-langium/design-system/utils';
import { formatPreviewNumber, type NumericPresentation } from '../store/form-presentation-store.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const PreviewNumberInput = withInstrumentation(
  function PreviewNumberInput({
    value,
    format,
    onValueChange,
    onBlur,
    onFocus,
    className,
    ...props
  }: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
    value: unknown;
    format?: NumericPresentation;
    onValueChange(value: number | ''): void;
  }) {
    const [focused, setFocused] = useState(false);
    const raw = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    const formatted = !focused ? formatPreviewNumber(value, format) : raw;
    const showDisplay = formatted !== raw;
    return (
      <div className="relative min-w-0">
        <Input
          {...props}
          // Keep the native number control and its selection stable across focus transitions.
          className={cn(
            className,
            'peer pb-0 tabular-nums',
            showDisplay && 'text-transparent forced-colors:text-[FieldText]'
          )}
          type="number"
          inputMode="decimal"
          aria-valuetext={showDisplay ? formatted : undefined}
          value={raw}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onChange={(event) =>
            onValueChange(
              event.target.value === '' || Number.isNaN(event.target.valueAsNumber) ? '' : event.target.valueAsNumber
            )
          }
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
        />
        {showDisplay && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-px flex items-center px-1.5 text-xs tabular-nums peer-disabled:opacity-50 forced-colors:hidden"
          >
            <span className="truncate">{formatted}</span>
          </span>
        )}
      </div>
    );
  },
  {
    op: 'PreviewNumberInput',
    sanitize: () => ({}),
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
