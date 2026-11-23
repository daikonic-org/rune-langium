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
    className,
    ...props
  }: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
    value: unknown;
    format?: NumericPresentation;
    onValueChange(value: number | ''): void;
  }) {
    const [focused, setFocused] = useState(false);
    const raw = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    const displayed = focused ? raw : formatPreviewNumber(value, format);
    const showingFormat = !focused && (!!format || displayed !== raw);
    return (
      <Input
        {...props}
        className={cn(className, 'tabular-nums')}
        type={showingFormat ? 'text' : 'number'}
        inputMode="decimal"
        value={displayed}
        onFocus={() => setFocused(true)}
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
    );
  },
  {
    op: 'PreviewNumberInput',
    sanitize: () => ({}),
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);
