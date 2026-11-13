// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Command — searchable action list built on Base UI Combobox.
 *
 * @module
 */

import * as React from 'react';
import { Combobox } from '@base-ui/react/combobox';

import { cn } from '../utils';
import { pickerOptionStyles } from './control-styles';
import { SearchInput } from './input';

export interface CommandEntry<Value> {
  readonly value: Value;
  readonly label: string;
  readonly searchText?: string;
}

export interface CommandEntryGroup<Value> {
  readonly id: string;
  readonly items: readonly CommandEntry<Value>[];
}

interface CommandProps<Value> extends React.ComponentProps<'div'> {
  readonly items: readonly CommandEntry<Value>[] | readonly CommandEntryGroup<Value>[];
  readonly onItemSelect: (value: Value) => void;
}

function Command<Value>({ items, onItemSelect, className, children, ...props }: CommandProps<Value>) {
  return (
    <Combobox.Root<CommandEntry<Value>>
      items={items}
      value={null}
      inline
      open
      autoHighlight
      itemToStringLabel={(item) => item.searchText ?? item.label}
      onValueChange={(item) => {
        if (item !== null) onItemSelect(item.value);
      }}
    >
      <div
        data-slot="command"
        className={cn(
          'flex h-full w-full flex-col overflow-hidden rounded bg-popover text-popover-foreground',
          className
        )}
        {...props}
      >
        {children}
      </div>
    </Combobox.Root>
  );
}

function CommandInput({ render, ...props }: React.ComponentProps<typeof Combobox.Input>) {
  return (
    <div className="border-b border-input p-1.5" data-slot="command-input-wrapper">
      <Combobox.Input data-slot="command-input" render={render ?? <SearchInput />} {...props} />
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof Combobox.List>) {
  return (
    <Combobox.List
      data-slot="command-list"
      className={cn('max-h-[300px] overflow-y-auto overflow-x-hidden', className)}
      {...props}
    />
  );
}

function CommandEmpty({ className, ...props }: React.ComponentProps<typeof Combobox.Empty>) {
  return (
    <Combobox.Empty
      data-slot="command-empty"
      // Base UI keeps this polite live region mounted when results exist.
      // Collapse its empty spacing without hiding it from assistive technology.
      className={(state) =>
        cn(
          'py-6 text-center text-sm text-muted-foreground empty:py-0',
          typeof className === 'function' ? className(state) : className
        )
      }
      {...props}
    />
  );
}

interface CommandCollectionProps<Value> {
  readonly children: (item: CommandEntry<Value>, index: number) => React.ReactNode;
}

function CommandCollection<Value>({ children }: CommandCollectionProps<Value>) {
  return <Combobox.Collection>{children}</Combobox.Collection>;
}

interface CommandGroupProps<Value> extends Omit<React.ComponentProps<typeof Combobox.Group>, 'children' | 'items'> {
  readonly id: string;
  readonly heading?: React.ReactNode;
  readonly children: (item: CommandEntry<Value>, index: number) => React.ReactNode;
}

function CommandGroup<Value>({ id, heading, className, children, ...props }: CommandGroupProps<Value>) {
  const filteredGroups = Combobox.useFilteredItems<CommandEntryGroup<Value>>();
  const filteredItems = filteredGroups.find((group) => group.id === id)?.items ?? [];

  if (filteredItems.length === 0) return null;

  return (
    <Combobox.Group
      data-slot="command-group"
      items={filteredItems}
      className={cn('overflow-hidden p-1 text-foreground', className)}
      {...props}
    >
      {heading ? (
        <Combobox.GroupLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          {heading}
        </Combobox.GroupLabel>
      ) : null}
      <CommandCollection>{children}</CommandCollection>
    </Combobox.Group>
  );
}

function CommandSeparator({ className, ...props }: React.ComponentProps<typeof Combobox.Separator>) {
  return (
    <Combobox.Separator data-slot="command-separator" className={cn('-mx-1 h-px bg-border', className)} {...props} />
  );
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof Combobox.Item>) {
  return (
    <Combobox.Item
      data-slot="command-item"
      className={(state) => cn(pickerOptionStyles, typeof className === 'function' ? className(state) : className)}
      {...props}
    />
  );
}

export {
  Command,
  CommandCollection,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
};
