// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Daikonic contributors

import * as React from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../utils';
import { fieldControlStyles, pickerOptionStyles } from './control-styles';

const pickerTriggerVariants = cva(
  cn(
    fieldControlStyles,
    "inline-flex min-h-6 max-h-7 w-fit min-w-0 max-w-full items-center justify-between gap-1.5 py-0 whitespace-nowrap transition-[color,box-shadow] hover:bg-accent/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3 [&_svg:not([class*='text-'])]:text-muted-foreground"
  ),
  {
    variants: { size: { sm: 'h-6 px-1.5', default: 'h-7 px-2' } },
    defaultVariants: { size: 'sm' }
  }
);

type PickerTriggerProps = React.ComponentProps<'button'> &
  VariantProps<typeof pickerTriggerVariants> & {
    /** Disable when the composing control supplies its own indicator. */
    indicator?: boolean;
  };

/** Field trigger shared by plain Selects and domain-specific popover pickers. */
const PickerTrigger = React.forwardRef<HTMLButtonElement, PickerTriggerProps>(function PickerTrigger(
  { className, size = 'sm', indicator = true, children, ...props },
  ref
) {
  return (
    <button
      type="button"
      data-slot="picker-trigger"
      data-size={size}
      {...props}
      ref={ref}
      className={cn(pickerTriggerVariants({ size }), className)}
    >
      {children}
      {indicator && <ChevronDownIcon aria-hidden="true" className="size-3 text-muted-foreground" />}
    </button>
  );
});

/** Native row; callers retain the appropriate option or navigation semantics. */
const PickerOption = React.forwardRef<HTMLButtonElement, React.ComponentProps<'button'>>(function PickerOption(
  { className, ...props },
  ref
) {
  return (
    <button
      type="button"
      data-slot="picker-option"
      {...props}
      ref={ref}
      className={cn(pickerOptionStyles, className)}
    />
  );
});

export { PickerOption, PickerTrigger, pickerTriggerVariants };
export type { PickerTriggerProps };
