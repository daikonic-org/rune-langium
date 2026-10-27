// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { useEffect, useMemo, useState, type ReactElement, type PointerEvent } from 'react';
import {
  TypeSelector,
  TypeChip,
  typeChipKind,
  buildTypeOptions,
  getKindDotClass,
  qualifiedNameFromNodeId,
  selectNodeRepository,
  useEditorStore
} from '@rune-langium/visual-editor';
import type { TypeKind, TypeOption } from '@rune-langium/visual-editor';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@rune-langium/design-system/ui/command';
import type { CommandEntryGroup } from '@rune-langium/design-system/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
import { Button } from '@rune-langium/design-system/ui/button';
import { ChevronsUpDown } from 'lucide-react';
import { withInstrumentation } from '../services/instrumentation/core.js';

export interface WorkspaceTypePickerProps {
  value: string | null;
  onSelect(value: string | null): void;
  /** Receives the selected repository option when callers need its identity metadata. */
  onSelectOption?(option: TypeOption | null): void;
  filterKinds: TypeKind[];
  allowClear?: boolean;
  label: string;
  appearance?: 'field' | 'chip';
  optionFilter?(option: TypeOption): boolean;
  onOptionPointerDown?(event: PointerEvent, option: TypeOption): void;
}

/**
 * A searchable type picker over the current workspace repository.
 *
 * It derives options from the editor store only; selecting an option delegates
 * to its caller and intentionally does not change Explore's selected node.
 */
export const WorkspaceTypePicker = withInstrumentation(
  function WorkspaceTypePicker({
    value,
    onSelect,
    onSelectOption,
    filterKinds,
    allowClear = false,
    label,
    appearance = 'field',
    optionFilter,
    onOptionPointerDown
  }: WorkspaceTypePickerProps): ReactElement {
    const nodesById = useEditorStore((state) => state.nodesById);
    const repository = selectNodeRepository(nodesById);
    const options = useMemo(
      () =>
        buildTypeOptions(repository, false).filter(
          (option) =>
            option.value === value ||
            qualifiedNameFromNodeId(option.value) === value ||
            !optionFilter ||
            optionFilter(option)
        ),
      [repository, optionFilter, value]
    );
    const selectedValue = useMemo(() => {
      if (!value) return value;
      const allowedKinds = filterKinds.length ? new Set(filterKinds) : undefined;
      return (
        options.find(
          (option) =>
            (!allowedKinds || (option.kind !== 'builtin' && allowedKinds.has(option.kind))) &&
            (option.value === value || qualifiedNameFromNodeId(option.value) === value)
        )?.value ?? value
      );
    }, [filterKinds, options, value]);
    const [popoverKey, setPopoverKey] = useState(0);
    useEffect(() => setPopoverKey((key) => key + 1), [value]);
    const searchLabel = `Search ${label.toLocaleLowerCase()}`;

    const resetPopover = () => {
      setPopoverKey((current) => current + 1);
    };

    return (
      <Popover key={popoverKey} onOpenChange={(open) => !open && resetPopover()}>
        <TypeSelector
          value={selectedValue}
          options={options}
          placeholder={label}
          onSelect={(nextValue) => {
            resetPopover();
            onSelect(nextValue && qualifiedNameFromNodeId(nextValue));
            onSelectOption?.(options.find((option) => option.value === nextValue) ?? null);
          }}
          allowClear={allowClear}
          filterKinds={filterKinds}
          renderTrigger={({ selected, placeholder, onToggle, disabled }) => {
            const displayLabel = selected
              ? `${selected.label}${selected.namespace ? ` — ${selected.namespace}` : ''}`
              : placeholder;
            return (
              <PopoverTrigger
                render={
                  appearance === 'chip' && selected ? (
                    <TypeChip
                      typeName={selected.label}
                      typeKind={typeChipKind(selected.kind)}
                      className="max-w-full min-h-6 truncate"
                      aria-label={`${label}: ${displayLabel}`}
                      title={displayLabel}
                      disabled={disabled}
                      onClick={onToggle}
                    />
                  ) : appearance === 'chip' ? (
                    <Button size="xs" variant="outline" aria-label={label} disabled={disabled} onClick={onToggle}>
                      <span className="truncate">{placeholder}</span>
                      <ChevronsUpDown className="size-3 shrink-0" aria-hidden="true" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      className="w-full min-w-0 justify-between font-normal"
                      aria-label={selected ? `${label}: ${displayLabel}` : label}
                      disabled={disabled}
                      onClick={onToggle}
                    >
                      <span className="truncate">{displayLabel}</span>
                      <ChevronsUpDown className="size-3 shrink-0 opacity-50" aria-hidden="true" />
                    </Button>
                  )
                }
              />
            );
          }}
          renderPopover={({ groups, onSelect: selectOption, allowClear: canClear }) => {
            const commandGroups: CommandEntryGroup<TypeOption | null>[] = [
              ...groups.map((group) => ({
                id: `namespace:${group.label}`,
                items: group.options.map((option) => ({
                  value: option,
                  label: option.label,
                  searchText: `${option.label} ${option.namespace ?? ''}`
                }))
              })),
              ...(canClear ? [{ id: 'clear', items: [{ value: null, label: 'Clear selection' }] }] : [])
            ];

            return (
              <PopoverContent className="w-80 p-0" align="start">
                <Command items={commandGroups} onItemSelect={(option) => selectOption(option?.value ?? null)}>
                  <CommandInput autoFocus aria-label={searchLabel} placeholder={searchLabel} />
                  <CommandList>
                    <CommandEmpty>No matching types.</CommandEmpty>
                    {groups.map((group) => (
                      <CommandGroup<TypeOption | null>
                        key={group.label}
                        id={`namespace:${group.label}`}
                        heading={group.label}
                      >
                        {(item) => {
                          const option = item.value;
                          if (!option) return null;
                          const optionLabel = `${option.label}${option.namespace ? ` — ${option.namespace}` : ''}`;
                          return (
                            <CommandItem
                              key={option.value}
                              value={item}
                              aria-label={optionLabel}
                              onPointerDown={(event) => onOptionPointerDown?.(event, option)}
                            >
                              <span
                                className={`size-2 shrink-0 rounded-full ${getKindDotClass(option.kind)}`}
                                aria-hidden="true"
                              />
                              <span>{option.label}</span>
                              {option.namespace && (
                                <span className="ml-auto text-xs text-muted-foreground">{option.namespace}</span>
                              )}
                            </CommandItem>
                          );
                        }}
                      </CommandGroup>
                    ))}
                    {canClear && (
                      <CommandGroup<TypeOption | null> id="clear">
                        {(item) => (
                          <CommandItem key="clear" value={item} aria-label="Clear selection">
                            Clear selection
                          </CommandItem>
                        )}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            );
          }}
        />
      </Popover>
    );
  },
  { op: 'WorkspaceTypePicker' }
);
