// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import * as React from 'react';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { Select as SelectPrimitive } from '@base-ui/react/select';

import { cn } from '../utils';

// CSS variable mapping:
// --radix-select-content-available-height → --available-height
// --radix-select-content-transform-origin → --transform-origin
// --radix-select-trigger-height → --anchor-height
// --radix-select-trigger-width → --anchor-width
// data-[state=open/closed] → data-[open]/data-[closed]
// focus:bg-accent (items) → data-[highlighted]:bg-accent

type SelectRootProps = React.ComponentProps<typeof SelectPrimitive.Root>;
type SelectItemDefinition = {
  label: React.ReactNode;
  value: unknown;
};

function collectSelectItems(children: React.ReactNode) {
  const items: SelectItemDefinition[] = [];

  function walk(node: React.ReactNode) {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement<{ children?: React.ReactNode; value?: unknown }>(child)) {
        return;
      }

      if (child.type === SelectItem) {
        items.push({
          label: child.props.children,
          value: child.props.value
        });
      }

      if (child.props.children != null) {
        walk(child.props.children);
      }
    });
  }

  walk(children);
  return items.length > 0 ? items : undefined;
}

function Select({
  onValueChange,
  items,
  children,
  ...props
}: Omit<SelectRootProps, 'onValueChange'> & {
  onValueChange?: (value: string) => void;
}) {
  const resolvedItems = React.useMemo(() => items ?? collectSelectItems(children), [children, items]);

  return (
    <SelectPrimitive.Root
      data-slot="select"
      items={resolvedItems}
      onValueChange={
        onValueChange
          ? (v: unknown) => {
              if (v !== null && v !== undefined) onValueChange(v as string);
            }
          : undefined
      }
      {...props}
    >
      {children}
    </SelectPrimitive.Root>
  );
}

function SelectGroup({ ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({
  placeholder,
  className,
  children,
  render,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.Value>, 'children'> & {
  placeholder?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={(state) =>
        cn(
          (state as { placeholder?: boolean }).placeholder && placeholder != null && 'text-muted-foreground',
          typeof className === 'function' ? className(state) : className
        )
      }
      render={(valueProps, state) => {
        const isPlaceholder = (state as { placeholder?: boolean }).placeholder === true;
        const nextProps = {
          ...valueProps,
          children: isPlaceholder ? placeholder : (children ?? valueProps.children)
        };

        if (typeof render === 'function') {
          return render(nextProps, state);
        }

        if (render != null && React.isValidElement(render)) {
          const renderElement = render as React.ReactElement<{ className?: string }>;
          return React.cloneElement(renderElement, {
            ...nextProps,
            className: cn(renderElement.props.className, nextProps.className)
          });
        }

        return <span {...nextProps} />;
      }}
      {...props}
    >
      {children}
    </SelectPrimitive.Value>
  );
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: 'sm' | 'default';
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "border-input [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex min-h-6 max-h-7 w-fit items-center justify-between gap-1.5 rounded-md border bg-transparent py-0 whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-7 data-[size=default]:px-2 data-[size=default]:text-sm data-[size=sm]:h-6 data-[size=sm]:px-1.5 data-[size=sm]:text-xs *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = 'item-aligned',
  align = 'center',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Popup> & {
  position?: 'item-aligned' | 'popper';
  align?: 'start' | 'center' | 'end';
}) {
  const alignItemWithTrigger = position !== 'popper';
  return (
    <SelectPrimitive.Portal>
      {/*
        When this Select is rendered inside a Dialog, base-ui's own
        FloatingPortal resolves its portal container to the Dialog's
        existing portal node (useFloatingPortalNode's `parentPortalNode`
        fallback — keeps the whole floating-element tree in one DOM
        subtree for focus-trap guards) rather than `document.body`. The
        Positioner's default `z-index: auto` means it never establishes
        its own stacking context on its own — WITHOUT the explicit
        `z-[60]` below, this Popup's bare `z-50` would only compete
        against the Dialog's own `z-50` content as a DOM-order tie, and
        the Dialog's body (later in that shared portal) would win the
        hit test even though the popup paints visually on top (confirmed
        live via document.elementFromPoint; see
        https://github.com/pradeepmouli/rune-langium/issues/396). The
        explicit `z-[60]` on both the Positioner and the Popup below
        (higher than Dialog's z-50) gives the Positioner its own
        stacking context so it always wins regardless of DOM order or
        nesting depth.
      */}
      <SelectPrimitive.Positioner
        data-slot="select-positioner"
        className="z-[60]"
        alignItemWithTrigger={alignItemWithTrigger}
        align={align}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            'bg-popover text-popover-foreground data-[open]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:fade-in-0 data-[closed]:zoom-out-95 data-[open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-[60] max-h-(--available-height) min-w-[8rem] origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md',
            position === 'popper' &&
              'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
            className
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List
            className={cn(
              'p-1',
              position === 'popper' && 'h-(--anchor-height) w-full min-w-(--anchor-width) scroll-my-1'
            )}
          >
            {children}
          </SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.GroupLabel>) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn('text-muted-foreground px-2 py-1.5 text-xs', className)}
      {...props}
    />
  );
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span data-slot="select-item-indicator" className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('bg-border pointer-events-none -mx-1 my-1 h-px', className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpArrow>
  );
}

function SelectScrollDownButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownArrow>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue
};
