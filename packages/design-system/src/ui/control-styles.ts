// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Daikonic contributors

/** Shared chrome for editable controls; each primitive owns its geometry. */
export const fieldControlStyles =
  'rounded-md border border-input bg-background text-xs text-foreground placeholder:text-muted-foreground ' +
  'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ' +
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50';

/** Common rows for native picker buttons and Base UI Select/Command items. */
export const pickerOptionStyles =
  'relative flex min-h-6 w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1 text-left text-xs leading-4 outline-none ' +
  'hover:bg-accent/50 focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ' +
  'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground aria-selected:bg-accent aria-selected:text-accent-foreground ' +
  'aria-[current=true]:bg-accent aria-[current=true]:text-accent-foreground ' +
  'disabled:pointer-events-none disabled:opacity-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ' +
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3 [&_svg:not([class*='text-'])]:text-muted-foreground";
