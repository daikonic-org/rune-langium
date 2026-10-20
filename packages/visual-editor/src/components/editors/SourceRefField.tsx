// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * SourceRefField — single cross-reference picker for a synonym source.
 *
 * Mirrors TypeReferenceField's chip+popover idiom but is NOT type-coupled: it
 * picks a `RosettaSynonymSource` from a flat option list (no type kinds, drop
 * target, namespace tree, or node navigation). Built on the shared design-system
 * Popover + Base UI Command primitives.
 */

import { ChevronDown } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
import {
  Command,
  CommandCollection,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  type CommandEntry
} from '@rune-langium/design-system/ui/command';
import type { SourceRefOption } from '../../types.js';

export interface SourceRefFieldProps {
  value: string | null;
  options: SourceRefOption[];
  onSelect: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
}

export function SourceRefField({
  value,
  options,
  onSelect,
  placeholder = 'Select source…',
  disabled = false,
  readOnly = false
}: SourceRefFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);
  const label = selected?.label ?? value ?? '';

  const items = useMemo<readonly CommandEntry<SourceRefOption>[]>(
    () =>
      options.map((option) => ({
        value: option,
        label: option.label,
        searchText: [option.label, option.namespace].filter(Boolean).join(' ')
      })),
    [options]
  );

  const handleSelect = useCallback(
    (option: SourceRefOption) => {
      onSelect(option.value);
      setOpen(false);
    },
    [onSelect]
  );

  if (readOnly) {
    return (
      <span
        data-slot="source-ref"
        className="inline-flex items-center h-6 gap-1.5 rounded-md border border-input bg-background px-1.5 text-xs text-foreground"
      >
        {label || placeholder}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            data-slot="source-ref-trigger"
            className="nodrag nopan inline-flex max-w-full items-center h-6 gap-1.5 rounded-md border border-input bg-background px-1.5 text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
          >
            <span className="truncate">{label || placeholder}</span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        }
      />
      <PopoverContent align="start" sideOffset={4} className="w-auto p-0">
        <Command className="nodrag nopan" items={items} onItemSelect={handleSelect}>
          <CommandInput aria-label="Search sources" placeholder="Search sources…" />
          <CommandList>
            <CommandEmpty>No matching options.</CommandEmpty>
            <CommandCollection<SourceRefOption>>
              {(item) => (
                <CommandItem key={item.value.value} value={item}>
                  {item.value.label}
                  {item.value.namespace ? (
                    <span className="ml-2 text-muted-foreground">{item.value.namespace}</span>
                  ) : null}
                </CommandItem>
              )}
            </CommandCollection>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
