// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Textarea — shadcn/ui Textarea component.
 *
 * @module
 */

import * as React from 'react';

import { cn } from '../utils';
import { fieldControlStyles } from './control-styles';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldControlStyles, 'flex min-h-[60px] w-full px-1.5 py-1.5 field-sizing-content', className)}
      {...props}
    />
  );
}

export { Textarea };
