// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Input — shadcn/ui Input component.
 *
 * Variants:
 * - `default`: full-width compact field with inset ring focus, bg-background.
 * - `inline`: compact inspector/row field with the same border, fill and inset
 *   focus treatment. Size and width are supplied by the caller.
 *
 * @module
 */

import * as React from 'react';

import { cn } from '../utils';

export interface InputProps extends React.ComponentProps<'input'> {
  /**
   * Visual variant.
   * - `'default'`: full-width compact field.
   * - `'inline'`: compact row/inspector field with an inset focus ring.
   */
  variant?: 'default' | 'inline';
}

function Input({ className, type, variant = 'default', ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      data-variant={variant !== 'default' ? variant : undefined}
      className={cn(
        'min-h-6 max-h-7',
        // ── default variant ───────────────────────────────────────────────
        variant === 'default' && [
          'h-6 w-full rounded-md border border-input bg-background px-1.5 py-0 text-xs text-foreground',
          'placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          'disabled:opacity-50'
        ],
        // ── inline variant — compact inspector/row field ──────────────────
        variant === 'inline' && [
          'rounded-md border border-input bg-background text-foreground',
          'placeholder:text-muted-foreground',
          'outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          'disabled:opacity-50 disabled:bg-background',
          'transition-[border-color,box-shadow]'
        ],
        className
      )}
      {...props}
    />
  );
}

export { Input };
