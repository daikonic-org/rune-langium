// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Input — shadcn/ui Input component.
 *
 * One compact field treatment, shared by forms and inline editors.
 * Callers supply layout constraints such as width and flex growth.
 *
 * @module
 */

import * as React from 'react';

import { cn } from '../utils';
import { fieldControlStyles } from './control-styles';

export type InputProps = React.ComponentProps<'input'>;

function Input({ className, type, ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(fieldControlStyles, 'h-6 min-h-6 max-h-7 w-full px-1.5 py-0', className)}
      {...props}
    />
  );
}

export { Input };
