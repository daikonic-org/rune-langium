// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { ComponentProps } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import { cn } from '../utils';
import { buttonVariants } from './button';

/** Single source of calendar styling; DayPicker owns keyboard and date-grid semantics. */
export function Calendar({ className, classNames, components, ...props }: ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays
      fixedWeeks
      navLayout="around"
      labels={{
        labelDayButton: (day, modifiers) =>
          `${day.getDate()}, ${day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', year: 'numeric' })}${modifiers.today ? ', today' : ''}${modifiers.selected ? ', selected' : ''}`
      }}
      className={cn('relative w-fit p-3 text-sm', className)}
      classNames={{
        months: 'relative flex flex-col gap-4 sm:flex-row',
        month: 'w-full',
        month_caption: 'flex h-8 items-center justify-center px-9',
        caption_label: 'text-sm font-medium',
        nav: 'flex items-center gap-1',
        button_previous: cn(buttonVariants({ variant: 'ghost', size: 'icon-xs' }), 'absolute left-0 top-0 size-8'),
        button_next: cn(buttonVariants({ variant: 'ghost', size: 'icon-xs' }), 'absolute right-0 top-0 size-8'),
        month_grid: 'mt-2 w-full table-fixed border-collapse',
        weekday: 'h-8 w-8 text-xs font-normal text-muted-foreground',
        day: 'relative size-8 p-0 text-center text-sm',
        day_button: cn(
          buttonVariants({ variant: 'ghost', size: 'icon-xs' }),
          'size-8 rounded-md p-0 text-xs font-normal tabular-nums text-foreground'
        ),
        selected: '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button:hover]:bg-primary/90',
        today: '[&>button]:border [&>button]:border-primary',
        outside: 'bg-muted/40 [&>button]:text-foreground',
        disabled: 'opacity-40',
        hidden: 'invisible',
        ...classNames
      }}
      components={{
        Chevron: ({ orientation, className: chevronClass }) => {
          const Icon = orientation === 'left' ? ChevronLeft : orientation === 'right' ? ChevronRight : ChevronDown;
          return <Icon className={cn('size-3.5', chevronClass)} aria-hidden="true" />;
        },
        ...components
      }}
      {...props}
    />
  );
}
