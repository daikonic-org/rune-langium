// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Textarea — shadcn/ui Textarea component.
 *
 * @module
 */

import * as React from 'react';

import { cn } from '../utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-[60px] w-full rounded-md border border-input bg-background px-1.5 py-1.5 text-xs text-foreground shadow-xs',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'field-sizing-content',
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
