// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * TypeReferenceField — the inspector's canonical type-reference surface.
 *
 * Composes the structure-view's canonical idioms (Phase 3): the selected type
 * renders as a `<TypeChip>` that opens a `<NamespaceTreePicker>` popover (the
 * same segmented-tree look as the namespace explorer), the WHOLE field is a
 * type-ref drop target (parity with the structure view's TypePickerCell), and
 * a right-edge nav arrow navigates to the type — placed so it never obstructs
 * the picker popover, which opens from the chip on the left.
 *
 * Read-only mode renders a disabled chip with no popover and no drop handlers;
 * the nav arrow remains (navigation is read-only-safe).
 */

import { useCallback, useMemo, useState, useContext } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useTypeNavigationMenu } from '../TypeNavigationMenu.js';
import { cn } from '@rune-langium/design-system/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@rune-langium/design-system/ui/popover';
import { RowGlyph } from '@rune-langium/design-system/ui/row-glyph';
import { resolveNodeId, TypeReferenceImports } from './TypeLink.js';
import { NamespaceTreePicker } from './NamespaceTreePicker.js';
import { TypeChip, typeChipKind } from './structure/TypeChip.js';
import { useTypeRefDrop } from '../../hooks/useTypeRefDrop.js';
import { TYPE_REF_KINDS, type TypeRefPayload } from '../../types/structure-view.js';
import type { NavigateToNodeCallback, TypeKind, TypeOption } from '../../types.js';
import { AST_TYPE_TO_NODE_TYPE } from '../../adapters/model-helpers.js';
import { isTypeNodeId, TYPE_DECLARATION_KINDS } from '../../store/node-projection.js';

export interface TypeReferenceFieldProps {
  value: string | null;
  options?: TypeOption[];
  onSelect: (value: string | null) => void;
  displayName?: string;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  allowClear?: boolean;
  filterKinds?: Array<TypeKind | 'builtin'>;
  onNavigateToNode?: NavigateToNodeCallback;
  allNodeIds?: string[];
  readOnly?: boolean;
  className?: string;
}

// One semantic policy for option resolution, picking and drag/drop. Function
// parent fields supply an explicit filterKinds instead of the type default.
const DEFAULT_REFERENCE_KINDS = new Set([
  ...TYPE_DECLARATION_KINDS.map((kind) => AST_TYPE_TO_NODE_TYPE[kind]),
  'builtin'
]);

export function TypeReferenceField({
  value,
  options,
  onSelect,
  displayName,
  placeholder = 'Select type...',
  emptyLabel,
  disabled = false,
  allowClear = false,
  filterKinds,
  onNavigateToNode,
  allNodeIds,
  readOnly = false,
  className
}: TypeReferenceFieldProps) {
  const [open, setOpen] = useState(false);
  const imports = useContext(TypeReferenceImports);
  const referenceOptions = useMemo(
    () =>
      options?.filter((option) =>
        filterKinds?.length ? filterKinds.includes(option.kind) : DEFAULT_REFERENCE_KINDS.has(option.kind)
      ),
    [options, filterKinds]
  );

  const selected = useMemo(() => {
    const byValue = referenceOptions?.find((option) => option.value === value);
    if (byValue) return byValue;
    if (displayName) {
      const byLabel = referenceOptions?.find((option) => option.label === displayName);
      if (byLabel) return byLabel;
      // Qualified authored references retain the canonical option's kind even
      // when its display label is bare (e.g. two namespaces both define Status).
      const nodeId = resolveNodeId(displayName, referenceOptions?.map((option) => option.value) ?? [], imports);
      return referenceOptions?.find((option) => option.value === nodeId) ?? null;
    }
    return null;
  }, [displayName, referenceOptions, value, imports]);

  const effectiveValue = value?.includes('#') || value?.includes('.') ? value : (selected?.value ?? value);
  const typeLabel = displayName ?? selected?.label ?? '';
  const chipKind = typeChipKind(selected?.kind);

  const resolvedNodeId = useMemo(() => {
    if (!allNodeIds?.length) return undefined;
    if (
      effectiveValue &&
      allNodeIds.includes(effectiveValue) &&
      (selected?.value === effectiveValue || isTypeNodeId(effectiveValue))
    )
      return effectiveValue;
    const reference = effectiveValue?.startsWith('builtin::') ? typeLabel : (effectiveValue ?? typeLabel);
    return reference ? resolveNodeId(reference, allNodeIds, imports) : undefined;
  }, [allNodeIds, effectiveValue, typeLabel, imports, selected]);
  const canNavigate = Boolean(onNavigateToNode && resolvedNodeId);
  const navigation = useTypeNavigationMenu({ onNavigate: onNavigateToNode });

  const handleNavigate = useCallback(() => {
    if (resolvedNodeId && onNavigateToNode) {
      onNavigateToNode(resolvedNodeId);
    }
  }, [onNavigateToNode, resolvedNodeId]);

  const handleSelect = useCallback(
    (val: string | null) => {
      onSelect(val);
      setOpen(false);
    },
    [onSelect]
  );

  // Whole-field drop target — dropping a type-ref anywhere on the field selects
  // it (parity with the structure view). The dropped payload's `typeId` is the
  // canonical `namespace.Name` id the store expects for cross-namespace
  // resolution; forward it directly, matching a click in the picker.
  const acceptKinds = useMemo<ReadonlyArray<TypeRefPayload['kind']>>(() => {
    if (disabled || readOnly) return [];
    const kinds = filterKinds?.length ? new Set(filterKinds) : DEFAULT_REFERENCE_KINDS;
    const toTypeKind = (k: TypeRefPayload['kind']): TypeKind =>
      k === 'BasicType' ? 'basicType' : k === 'TypeAlias' ? 'typeAlias' : (k.toLowerCase() as TypeKind);
    // Explicit filters also authorize function-parent drops.
    return TYPE_REF_KINDS.filter((k) => kinds.has(toTypeKind(k)));
  }, [disabled, readOnly, filterKinds]);

  const handleDrop = useCallback((payload: TypeRefPayload) => onSelect(payload.typeId), [onSelect]);
  const { dragOverHandlers, isOver } = useTypeRefDrop({ accept: acceptKinds, onDrop: handleDrop });

  const navButton = canNavigate ? (
    <RowGlyph
      as="button"
      variant="nav"
      type="button"
      data-slot="type-link"
      onClick={handleNavigate}
      title={`Go to ${typeLabel}`}
      aria-label={`Go to ${typeLabel}`}
      className="nodrag nopan"
    >
      <ArrowUpRight className="size-3.5" aria-hidden="true" />
    </RowGlyph>
  ) : null;

  return (
    <>
      <div
        data-slot="type-reference"
        onContextMenu={(event) => navigation.open(event, resolvedNodeId)}
        onKeyDown={(event) => navigation.onKeyDown(event, resolvedNodeId)}
        data-empty={typeLabel ? 'false' : 'true'}
        data-readonly={readOnly ? 'true' : 'false'}
        data-drop-over={isOver ? 'true' : undefined}
        className={cn('rune-type-reference', className)}
        {...(readOnly ? {} : dragOverHandlers)}
      >
        {readOnly ? (
          typeLabel ? (
            <TypeChip
              typeName={typeLabel}
              typeKind={chipKind}
              disabled
              data-slot="type-picker-trigger"
              className="truncate"
            />
          ) : (
            <span className="rune-type-reference__placeholder">{emptyLabel ?? placeholder}</span>
          )
        ) : (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              disabled={disabled}
              render={
                typeLabel ? (
                  <TypeChip
                    typeName={typeLabel}
                    typeKind={chipKind}
                    data-slot="type-picker-trigger"
                    className="truncate"
                  />
                ) : (
                  <button type="button" data-slot="type-picker-trigger" className="rune-type-reference__placeholder">
                    {emptyLabel ?? placeholder}
                  </button>
                )
              }
            />
            <PopoverContent align="start" sideOffset={4} className="w-auto p-0">
              <NamespaceTreePicker
                options={referenceOptions ?? []}
                value={effectiveValue}
                onSelect={handleSelect}
                filterKinds={filterKinds}
                allowClear={allowClear}
              />
            </PopoverContent>
          </Popover>
        )}

        {navButton}
      </div>
      {navigation.menu}
    </>
  );
}
