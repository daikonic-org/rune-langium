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
import { SearchIcon } from 'lucide-react';

import { cn } from '../utils';
import { fieldControlStyles } from './control-styles';

export type InputProps = React.ComponentProps<'input'>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input({ className, type, ...props }, ref) {
  return (
    <input
      type={type}
      data-slot="input"
      ref={ref}
      className={cn(fieldControlStyles, 'h-6 min-h-6 max-h-7 w-full px-1.5 py-0', className)}
      {...props}
    />
  );
});

/** Input with one shared search affordance; refs and ARIA reach the input. */
const SearchInput = React.forwardRef<HTMLInputElement, InputProps & { wrapperClassName?: string }>(function SearchInput(
  { className, wrapperClassName, ...props },
  ref
) {
  return (
    <div data-slot="search-input-wrapper" className={cn('relative w-full min-w-0', wrapperClassName)}>
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute left-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
      />
      <Input type="text" {...props} ref={ref} className={cn('pl-6', className)} />
    </div>
  );
});

export { Input, SearchInput };
