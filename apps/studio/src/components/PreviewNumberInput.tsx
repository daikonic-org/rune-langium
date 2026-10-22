// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useState, type ComponentProps } from 'react';
import { Input } from '@rune-langium/design-system/ui/input';
import { formatPreviewNumber, type NumericPresentation } from '../store/form-presentation-store.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

export const PreviewNumberInput = withInstrumentation(
  function PreviewNumberInput({
    value,
    format,
    onValueChange,
    onBlur,
    ...props
  }: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
    value: unknown;
    format?: NumericPresentation;
    onValueChange(value: number | ''): void;
  }) {
    const [focused, setFocused] = useState(false);
    const display = !!format && !focused;
    const raw = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    return (
      <Input
        {...props}
        type={display ? 'text' : 'number'}
        inputMode="decimal"
        value={display ? formatPreviewNumber(value, format) : raw}
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
