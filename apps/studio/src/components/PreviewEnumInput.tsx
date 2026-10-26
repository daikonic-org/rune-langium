// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { useState } from 'react';
import type { CodeListValue } from '@rune-langium/codegen/export';
import { Button } from '@rune-langium/design-system/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
import {
  Command,
  CommandCollection,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@rune-langium/design-system/ui/command';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@rune-langium/design-system/ui/select';
import { ChevronsUpDown } from 'lucide-react';
import { withInstrumentation } from '../services/instrumentation/core.js';
const CLEAR = '__rune_enum_unset__';
const caption = (entry: CodeListValue) =>
  `${entry.label}${entry.deprecatedDate ? ` (deprecated ${entry.deprecatedDate})` : ''}`;
export const PreviewEnumInput = withInstrumentation(
  function PreviewEnumInput({
    label,
    value,
    options,
    required,
    invalid,
    describedBy,
    onChange
  }: {
    label: string;
    value?: string;
    options: readonly CodeListValue[];
    required: boolean;
    invalid?: boolean;
    describedBy?: string;
    onChange(value: string | undefined): void;
  }) {
    const [open, setOpen] = useState(false);
    let clearValue = CLEAR;
    while (options.some((entry) => entry.value === clearValue)) clearValue += '_';
    const known = options.find((entry) => entry.value === value);
    const unknown = value && !known ? `${value} (not in list)` : undefined;
    const current = unknown ?? (known ? caption(known) : 'Select…');
    if (options.length <= 30)
      return (
        <Select value={value} onValueChange={(next) => onChange(next === clearValue ? undefined : (next ?? undefined))}>
          <SelectTrigger
            size="sm"
            aria-label={label}
            className="w-full"
            aria-invalid={invalid}
            aria-describedby={describedBy}
          >
            <SelectValue placeholder="Select…">{value ? current : undefined}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {!required && <SelectItem value={clearValue}>Select…</SelectItem>}
            {unknown && (
              <SelectItem value={value!} disabled>
                {unknown}
              </SelectItem>
            )}
            {options.map((entry) => (
              <SelectItem key={entry.value} value={entry.value} className="text-xs">
                <span>{caption(entry)}</span>
                {entry.description && (
                  <span className="max-w-64 truncate text-muted-foreground" title={entry.description}>
                    {entry.description}
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    const items = [
      ...(!required ? [{ value: undefined, label: 'Select…' }] : []),
      ...options.map((entry) => ({
        value: entry.value,
        label: caption(entry),
        searchText: `${entry.value} ${caption(entry)} ${entry.description ?? ''} ${entry.source ?? ''}`
      }))
    ];
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<Button variant="outline" size="sm" />}
          aria-label={label}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className="w-full min-w-0 justify-between font-normal"
        >
          <span className="truncate">{current}</span>
          <ChevronsUpDown className="size-3 shrink-0" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent className="w-80 max-w-[calc(100vw-1.5rem)] p-0" align="start">
          <Command
            items={items}
            onItemSelect={(next) => {
              onChange(next);
              setOpen(false);
            }}
          >
            <CommandInput autoFocus aria-label={`Search ${label}`} placeholder="Search code or description" />
            <CommandList aria-label={`${label} values`}>
              <CommandEmpty>No matching values.</CommandEmpty>
              <CommandCollection<string | undefined>>
                {(item) => (
                  <CommandItem key={item.value ?? CLEAR} value={item} className="text-xs">
                    <span className="min-w-0">{item.label}</span>
                  </CommandItem>
                )}
              </CommandCollection>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  },
  { op: 'PreviewEnumInput', capture: 0 }
);
