// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/** Inline value basics; optional standalone metadata delegates to shared editors. */

import {
  INSPECTOR_ROW_CLASS,
  INSPECTOR_ROW_NAME_CLASS,
  inspectorRowAttributes,
  type InspectorRowProps
} from './inspector/inspector-row.js';

import { useEffect, useCallback } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { EditorController as Controller, useEditorFieldValidator } from '../forms/EditorFormProvider.js';
import { X } from 'lucide-react';
import { Badge } from '@rune-langium/design-system/ui/badge';
import { Button } from '@rune-langium/design-system/ui/button';
import { Input } from '@rune-langium/design-system/ui/input';
import { useAutoSave } from '../../hooks/useAutoSave.js';
import { useEditorActionsContext } from '../forms/sections/EditorActionsContext.js';
import { SynonymEditor } from './SynonymEditor.js';
import { MetadataScalar } from './MetadataSection.js';
import type { SourceRefOption } from '../../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EnumValueRowProps extends InspectorRowProps {
  /** Last-committed value name (used as oldName diff anchor in callbacks). */
  name: string;
  /** Last-committed display name (used as diff anchor in callbacks). */
  displayName: string;
  /** Node ID of the parent Enum — forwarded to callbacks for store dispatch. */
  nodeId: string;
  /** Index position of this member in the useFieldArray. */
  index: number;
  /** Commit value name/displayName changes to the graph. */
  onUpdate: (nodeId: string, oldName: string, newName: string, displayName?: string) => void;
  /** Optional name-only commit using the host's current canonical member identity. */
  onRename?: (name: string) => void;
  /** Remove this enum value. */
  onRemove: (nodeId: string, valueName: string) => void;
  /** Reorder (drag) callback; fromIndex → toIndex. */
  onReorder: (fromIndex: number, toIndex: number) => void;
  /** Whether the row is disabled. */
  disabled?: boolean;
  /** Whether this local value overrides an inherited value with the same name. */
  isOverride?: boolean;
  /** Callback to revert this override, restoring the inherited value. */
  onRevert?: () => void;
  /**
   * Available synonym source options threaded from EnumForm via PaginatedEnumValues.
   * When non-empty, a synonym sub-section (chips + add-row) appears below the main row.
   */
  synonymSourceOptions?: SourceRefOption[];
  metadataInDetails?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const EMPTY_SYNONYM_SOURCE_OPTIONS: SourceRefOption[] = [];

function EnumValueRow({
  name,
  nodeId,
  index,
  onUpdate,
  onRename,
  onRemove,
  onReorder,
  disabled = false,
  isOverride = false,
  onRevert,
  synonymSourceOptions = EMPTY_SYNONYM_SOURCE_OPTIONS,
  metadataInDetails = false,
  selected,
  onSelect
}: EnumValueRowProps) {
  const { control, getValues } = useFormContext();
  const editorCtx = useEditorActionsContext();
  const effectiveReadOnly = Boolean(disabled || editorCtx?.readOnly);
  // AST-canonical paths (R11): `enumValues[].name` and `enumValues[].display`.
  // Pre-migration this row read `members.${index}.{name,displayName}` from a
  // hand-authored projection schema; the projection layer is gone now.
  const prefix = `enumValues.${index}`;

  const validateName = useEditorFieldValidator(`${prefix}.name`);
  const enumSynonyms = useWatch({
    control,
    name: `${prefix}.enumSynonyms`,
    defaultValue: getValues(`${prefix}.enumSynonyms`) ?? []
  });
  // ---- Name auto-save (debounced) ------------------------------------------

  const commitNameChange = useCallback(
    (draft: { name: string; oldName: string; display?: string }) => {
      if (validateName && validateName(draft.name) !== true) return;
      if (effectiveReadOnly) return false;
      if (onRename) onRename(draft.name);
      else onUpdate(nodeId, draft.oldName, draft.name, draft.display || undefined);
    },
    [validateName, effectiveReadOnly, nodeId, onUpdate, onRename]
  );
  const debouncedName = useAutoSave(commitNameChange, 500);
  useEffect(() => {
    if (!effectiveReadOnly) debouncedName.flush();
  }, [effectiveReadOnly, debouncedName]);

  // ---- Display name auto-save (debounced) ----------------------------------

  const commitDisplayName = useCallback(
    (newDisplayName: string) => {
      const currentName: string = getValues(`${prefix}.name`) ?? name;
      onUpdate(nodeId, name, currentName, newDisplayName || undefined);
    },
    [nodeId, name, prefix, getValues, onUpdate]
  );

  // ---- Drag reorder --------------------------------------------------------

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData('text/plain', String(index));
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const fromIndex = Number(e.dataTransfer.getData('text/plain'));
    if (!Number.isNaN(fromIndex) && fromIndex !== index) {
      onReorder(fromIndex, index);
    }
  }

  const showSynonymSection =
    !metadataInDetails && ((enumSynonyms?.length ?? 0) > 0 || (!effectiveReadOnly && synonymSourceOptions.length > 0));

  // ---- Render -------------------------------------------------------------

  return (
    <div
      {...inspectorRowAttributes({ selected, onSelect }, name)}
      data-slot="enum-value-row"
      className={INSPECTOR_ROW_CLASS}
      role="listitem"
      draggable={!effectiveReadOnly}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Main row: handle | name | display | badge | action button */}
      <div className="flex items-center gap-1.5">
        {/* Drag handle */}
        <span
          data-slot="drag-handle"
          className="cursor-grab text-muted-foreground text-xs select-none shrink-0"
          aria-hidden="true"
        >
          ⠿
        </span>

        {/* Value name via Controller */}
        <Controller
          control={control}
          name={`${prefix}.name`}
          render={({ field }) => {
            const isEmpty = (field.value ?? '').trim() === '';
            return (
              <Input
                variant="inline"
                type="text"
                value={field.value ?? ''}
                onChange={(e) => {
                  field.onChange(e);
                  debouncedName({ name: e.target.value, oldName: name, display: getValues(`${prefix}.display`) });
                }}
                onBlur={field.onBlur}
                disabled={effectiveReadOnly}
                aria-label={`Value name for ${name || 'new value'}`}
                placeholder="Value name"
                className={`flex-1 ${INSPECTOR_ROW_NAME_CLASS}${isEmpty ? ' border-destructive' : ''}`}
              />
            );
          }}
        />

        {!metadataInDetails && (
          <MetadataScalar
            name={`${prefix}.display`}
            kind="display"
            label="Display name"
            slot="metadata-display"
            inline
            readOnly={effectiveReadOnly}
            onCommit={commitDisplayName}
          />
        )}

        {/* Override badge */}
        {isOverride && (
          <Badge data-slot="override-badge" variant="warning" className="shrink-0 text-3xs">
            override
          </Badge>
        )}

        {/* Revert button (for overrides) or Remove button */}
        {isOverride && onRevert ? (
          <button
            type="button"
            onClick={onRevert}
            disabled={effectiveReadOnly}
            aria-label={`Revert override for value ${name || 'unnamed'}`}
            className="shrink-0 text-xs px-2 py-0.5 border border-border rounded
              text-muted-foreground hover:text-foreground hover:border-input transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Revert
          </button>
        ) : (
          // Icon-button replaces literal "✕" Unicode glyph. Same pattern as
          // AttributeRow / ChoiceOptionRow / FunctionInputRow — lucide <X />
          // in a ghost icon-button with hover:text-destructive preserved.
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onRemove(nodeId, name)}
            disabled={effectiveReadOnly}
            aria-label={`Remove value ${name || 'unnamed'}`}
            title={`Remove value ${name || 'unnamed'}`}
            className="shrink-0 text-muted-foreground hover:text-destructive"
          >
            <X className="size-3" />
          </Button>
        )}
      </div>

      {showSynonymSection && (
        <SynonymEditor
          formPrefix={prefix}
          field="enumSynonyms"
          kind="enumValue"
          nodeId={nodeId}
          sourceOptions={synonymSourceOptions}
          readOnly={effectiveReadOnly}
          onAdd={
            editorCtx
              ? (source, value) => editorCtx.actions.addEnumValueSynonym?.(nodeId, index, source, value ?? '')
              : undefined
          }
          onRemove={
            editorCtx
              ? (synonymIndex) => editorCtx.actions.removeEnumValueSynonym?.(nodeId, index, synonymIndex)
              : undefined
          }
        />
      )}
    </div>
  );
}

export { EnumValueRow };

// ---------------------------------------------------------------------------
// InheritedEnumValueRow — read-only row for an inherited enum value
// ---------------------------------------------------------------------------

export interface InheritedEnumValueRowProps extends InspectorRowProps {
  name: string;
  displayName?: string;
  ancestorName: string;
  metadataInDetails?: boolean;
  onOverride: () => void;
  /** When true, hide the Override button to prevent mutations on locked types. */
  disabled?: boolean;
}

function InheritedEnumValueRow({
  name,
  displayName,
  ancestorName,
  onOverride,
  metadataInDetails = false,
  disabled,
  selected,
  onSelect
}: InheritedEnumValueRowProps) {
  const editorCtx = useEditorActionsContext();
  const effectiveDisabled = Boolean(disabled || editorCtx?.readOnly);

  return (
    <div
      {...inspectorRowAttributes({ selected, onSelect }, name)}
      data-slot="inherited-enum-value-row"
      data-name={name}
      className={`${INSPECTOR_ROW_CLASS} flex items-center gap-1.5 rounded bg-muted/20`}
      role="listitem"
    >
      {/* Spacer aligns with drag handle */}
      <span className="w-3 shrink-0" />

      <span className={`flex-1 ${INSPECTOR_ROW_NAME_CLASS} text-muted-foreground truncate`}>{name}</span>

      {!metadataInDetails && displayName && (
        <span className={`flex-1 ${INSPECTOR_ROW_NAME_CLASS} text-muted-foreground truncate`}>{displayName}</span>
      )}

      <span data-slot="inherited-from-label" className="text-xs text-muted-foreground italic whitespace-nowrap">
        inherited from {ancestorName}
      </span>

      {!effectiveDisabled && (
        <button
          data-slot="enum-value-override"
          type="button"
          onClick={onOverride}
          aria-label={`Override inherited value ${name} from ${ancestorName}`}
          className="ml-auto shrink-0 text-xs px-2 py-0.5 border border-border rounded
            text-muted-foreground hover:text-foreground hover:border-input transition-colors"
        >
          Override
        </button>
      )}
    </div>
  );
}

export { InheritedEnumValueRow };
