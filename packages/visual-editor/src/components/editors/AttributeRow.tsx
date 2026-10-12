// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * AttributeRow — inline editable row for a single Data type attribute.
 *
 * Reads/writes form state via `useFormContext` (provided by the parent
 * FormProvider) at the **canonical AST paths** for an `Attribute`:
 *
 *   {fieldArrayName}.${index}.name                    → string
 *   {fieldArrayName}.${index}.typeCall.type.$refText  → string (display name)
 *   {fieldArrayName}.${index}.card                    → RosettaCardinality { inf, sup?, unbounded? }
 *   {fieldArrayName}.${index}.override                → boolean
 *
 * `fieldArrayName` defaults to `'attributes'` so all existing DataTypeForm
 * and AnnotationForm usages continue to work unchanged. FunctionForm passes
 * `fieldArrayName="inputs"` so the same row can power function inputs without
 * any logic duplication (DRY / Task R-func-input).
 *
 * Per R11 of `specs/013-z2f-editor-migration/research.md`, the editor
 * consumes the AST graph node directly — no projection layer. The bespoke
 * `<CardinalityPicker>` is part of the public component surface and is
 * shared with z2f's componentMap (`zod-form-components.tsx`), so its
 * string-based API is preserved; this row translates between the AST
 * `RosettaCardinality` shape and the picker's `(inf..sup)` string at the
 * boundary via `formatCardinality` / `parseCardinality`.
 *
 * Renders: drag handle (⠿) | name input | TypeSelector | CardinalityPicker | remove button.
 * Name changes are debounced (500 ms). Type and cardinality are immediate.
 * Override attributes display a dimmed "(override)" badge.
 *
 * @module
 */

import { inspectorRowAttributes, type InspectorRowProps } from './inspector/inspector-row.js';

import { useCallback, useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import { EditorController as Controller } from '../forms/EditorFormProvider.js';
import { Button } from '@rune-langium/design-system/ui/button';
import { Input } from '@rune-langium/design-system/ui/input';
import { X } from 'lucide-react';
import { useAutoSave } from '../../hooks/useAutoSave.js';
import { TypeReferenceField } from './TypeReferenceField.js';
import { CardinalityPicker } from './CardinalityPicker.js';
import { formatCardinality, parseCardinality } from '../../adapters/model-helpers.js';
import { useEditorActionsContext } from '../forms/sections/EditorActionsContext.js';
import type { TypeOption, NavigateToNodeCallback } from '../../types.js';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AttributeRowProps extends InspectorRowProps {
  /** Index position of this member in the useFieldArray. */
  index: number;
  /**
   * Name of the `useFieldArray` field (form path prefix).
   * Defaults to `'attributes'`; pass `'inputs'` for function input rows.
   */
  fieldArrayName?: string;
  /** Last-committed attribute name (for graph action diffing). */
  committedName: string;
  /** Available type options for the TypeSelector. */
  availableTypes: TypeOption[];
  /** Commit attribute changes to the graph. */
  onUpdate: (
    index: number,
    oldName: string,
    newName: string,
    typeName: string,
    cardinality: string,
    targetTypeId?: string
  ) => void;
  /** Remove this attribute by index. */
  onRemove: (index: number) => void;
  /** Reorder (drag) callback; fromIndex → toIndex. */
  onReorder: (fromIndex: number, toIndex: number) => void;
  /** Whether the form is read-only. */
  disabled?: boolean;
  /** Callback to navigate to a type's graph node. */
  onNavigateToNode?: NavigateToNodeCallback;
  /** All loaded graph node IDs for resolving type name to node ID. */
  allNodeIds?: string[];
  /** Whether this attribute overrides an inherited member. */
  isOverride?: boolean;
  /** Callback to revert an override (remove local, restore inherited). */
  onRevert?: () => void;
}

// Grid columns: handle | name (takes all flex) | type (sizes to its chip,
// capped so a long type-ref truncates instead of starving the name) |
// cardinality (content) | trailing. The type column is `fit-content` rather
// than a fraction so the type field hugs its chip — no full-width "phantom box"
// pushing the name to ~half width.
const ATTRIBUTE_ROW_LAYOUT =
  'grid w-full items-center gap-x-1 [grid-template-columns:12px_minmax(0,1fr)_fit-content(11rem)_auto_minmax(0,max-content)]';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function AttributeRow({
  index,
  fieldArrayName = 'attributes',
  committedName,
  availableTypes,
  onUpdate,
  onRemove,
  onReorder,
  disabled = false,
  onNavigateToNode,
  allNodeIds,
  isOverride: isOverrideProp,
  onRevert,
  selected,
  onSelect
}: AttributeRowProps) {
  const { control, getValues, setValue, watch } = useFormContext();
  const editorCtx = useEditorActionsContext();
  const effectiveReadOnly = Boolean(disabled || editorCtx?.readOnly);
  const prefix = `${fieldArrayName}.${index}`;

  // AST-canonical reads (R11 / row-renderer contract §2). The picker still
  // talks in `(inf..sup)` strings, so we adapt at the row boundary rather
  // than mutating its public API (it ships in `components.ts` and is wired
  // into z2f's `componentMap` via `zod-form-components.tsx`).
  //
  // `RosettaCardinality` from the AST schema has `unbounded` as optional,
  // but `formatCardinality` expects `unbounded: boolean`. Normalise on read.
  const normaliseCard = (
    raw: { inf: number; sup?: number; unbounded?: boolean } | undefined
  ): { inf: number; sup?: number; unbounded: boolean } | undefined =>
    raw ? { ...raw, unbounded: raw.unbounded ?? false } : undefined;

  const isOverrideForm: boolean = watch(`${prefix}.override`);
  const isOverride = isOverrideProp ?? isOverrideForm;
  const typeName: string | undefined = watch(`${prefix}.typeCall.type.$refText`);
  const cardObj = normaliseCard(
    watch(`${prefix}.card`) as { inf: number; sup?: number; unbounded?: boolean } | undefined
  );
  const cardinalityString = formatCardinality(cardObj) || '(1..1)';

  // ---- Name auto-save (debounced) ------------------------------------------

  const commitName = useCallback(
    (newName: string) => {
      const currentType: string = getValues(`${prefix}.typeCall.type.$refText`) ?? 'string';
      const currentCard = normaliseCard(
        getValues(`${prefix}.card`) as { inf: number; sup?: number; unbounded?: boolean } | undefined
      );
      onUpdate(index, committedName, newName, currentType, formatCardinality(currentCard) || '(1..1)');
    },
    [index, committedName, prefix, getValues, onUpdate]
  );

  const debouncedName = useAutoSave(commitName, 500);

  // ---- Type selection (immediate) ------------------------------------------

  const handleTypeSelect = useCallback(
    (value: string | null) => {
      if (!value) return;
      const option = availableTypes.find((o) => o.value === value);
      const newTypeName = option?.label ?? value;
      // Pass option.value (the canonical `namespace.Name` id) as targetTypeId
      // so the store can qualify the $refText when the bare name collides across
      // namespaces (mirrors the attribute-type-update path — DRY).
      const targetTypeId = option?.value;
      setValue(`${prefix}.typeCall.type.$refText`, newTypeName, { shouldDirty: true });
      const name: string = getValues(`${prefix}.name`);
      onUpdate(index, committedName, name, newTypeName, cardinalityString, targetTypeId);
    },
    [index, committedName, prefix, availableTypes, getValues, setValue, cardinalityString, onUpdate]
  );

  // ---- Cardinality (immediate from picker) ---------------------------------

  const handleCardinalityChange = useCallback(
    (card: string) => {
      // Translate the picker's `(inf..sup)` string back to RosettaCardinality
      // for the AST-shaped form state, then forward the original string to
      // the action callback (EditorFormActions still take `cardinality: string`
      // — FR-002).
      setValue(`${prefix}.card`, parseCardinality(card), { shouldDirty: true });
      const name: string = getValues(`${prefix}.name`);
      onUpdate(index, committedName, name, typeName ?? 'string', card);
    },
    [index, committedName, prefix, typeName, getValues, setValue, onUpdate]
  );

  // ---- Drag reorder ---------------------------------------------------------
  //
  // Per R5 of `specs/013-z2f-editor-migration/research.md` (Pattern B): this
  // row owns the gesture surface (native HTML5 DnD via `dataTransfer`) and
  // delegates the actual reorder to the parent's `onReorder(from, to)`
  // callback. The parent (`DataTypeForm.handleReorderAttribute`) calls
  // `useFieldArray.move(from, to)` to update form state, then fires
  // `actions.reorderAttribute(nodeId, from, to)` so the graph store mirrors
  // the change. The upstream `arrayConfig.reorder: true` flag declared in
  // `z2f.config.ts` is the declarative scaffolding for Phase 8 (US6) when
  // the array is promoted to z2f-driven rendering — at which point the
  // upstream `<ArrayReorderHandle>` mounts alongside (or replaces) this
  // gesture surface but the `onReorder` route is unchanged.

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData('text/plain', String(index));
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const fromIndex = Number(e.dataTransfer.getData('text/plain'));
    if (!Number.isNaN(fromIndex) && fromIndex !== index) {
      onReorder(fromIndex, index);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  // ---- Resolve typeName (label) to option value for TypeSelector ----------

  const typeValue = useMemo(() => {
    const name = typeName ?? '';
    // Try exact value match first, then label match
    const byValue = availableTypes.find((o) => o.value === name);
    if (byValue) return byValue.value;
    const byLabel = availableTypes.find((o) => o.label === name);
    return byLabel?.value ?? name;
  }, [typeName, availableTypes]);

  // ---- Render --------------------------------------------------------------

  return (
    <div
      role="listitem"
      {...inspectorRowAttributes({ selected, onSelect }, committedName)}
      data-slot="attribute-row"
      data-index={index}
      className={`${ATTRIBUTE_ROW_LAYOUT} rune-inspector-row border border-transparent px-1 py-0.5
        hover:border-border ${isOverride ? 'opacity-60' : ''}`}
      draggable={!effectiveReadOnly}
      onDragStart={handleDragStart}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Drag handle */}
      <span
        data-slot="drag-handle"
        className="cursor-grab justify-self-center text-muted-foreground select-none text-xs shrink-0"
        aria-hidden="true"
      >
        ⠿
      </span>

      {/* Name input */}
      <Controller
        control={control}
        name={`${prefix}.name`}
        render={({ field }) => (
          <Input
            variant="inline"
            data-slot="attribute-name"
            type="text"
            value={field.value}
            onChange={(e) => {
              field.onChange(e);
              debouncedName(e.target.value);
            }}
            onBlur={field.onBlur}
            disabled={effectiveReadOnly}
            className="w-full min-w-0 px-1.5 py-0.5 text-xs"
            placeholder="name"
            aria-label={`Attribute name: ${field.value}`}
          />
        )}
      />

      {/* Type selector + navigation link */}
      <div data-slot="attribute-type" className="min-w-0">
        <TypeReferenceField
          value={typeValue}
          displayName={typeName}
          options={availableTypes}
          onSelect={handleTypeSelect}
          disabled={effectiveReadOnly}
          placeholder="Select type..."
          emptyLabel="Type"
          onNavigateToNode={onNavigateToNode}
          allNodeIds={allNodeIds}
          className="attribute-type-field"
        />
      </div>

      {/* Cardinality */}
      <div data-slot="attribute-cardinality" className="shrink-0">
        <CardinalityPicker
          value={cardinalityString}
          onChange={handleCardinalityChange}
          disabled={effectiveReadOnly}
          variant="pill"
        />
      </div>

      <div className="min-w-0 justify-self-end flex items-center gap-1">
        {isOverride && (
          <span data-slot="override-badge" className="text-2xs text-muted-foreground italic whitespace-nowrap">
            override
          </span>
        )}

        {/* Remove / Revert button */}
        {isOverride && onRevert ? (
          <button
            data-slot="attribute-revert"
            type="button"
            onClick={onRevert}
            disabled={effectiveReadOnly}
            className="shrink-0 rounded border border-border px-2 py-0.5 text-2xs
              text-muted-foreground transition-colors hover:text-foreground hover:border-input
              disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label={`Revert override for attribute ${committedName || 'unnamed'}`}
          >
            Revert
          </button>
        ) : (
          // Icon-button replaces the literal "✕" Unicode glyph (font-
          // dependent baseline jitter) with a lucide <X /> in a ghost
          // icon-button — matches FormPreviewPanel's remove affordance.
          // `<X />` is the conventional remove glyph; `<Minus />` reads
          // as "collapse / decrement", which is wrong for an explicit
          // deletion. The hover-destructive treatment is preserved via
          // the `hover:text-destructive` class override.
          <Button
            data-slot="attribute-remove"
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onRemove(index)}
            disabled={effectiveReadOnly}
            aria-label={`Remove attribute ${committedName || 'unnamed'}`}
            title={`Remove attribute ${committedName || 'unnamed'}`}
            className="shrink-0 text-muted-foreground hover:text-destructive"
          >
            <X className="size-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

export { AttributeRow };

// ---------------------------------------------------------------------------
// InheritedAttributeRow — read-only row for an inherited attribute
// ---------------------------------------------------------------------------

export interface InheritedAttributeRowProps extends InspectorRowProps {
  name: string;
  typeName: string;
  cardinality: string;
  ancestorName: string;
  onOverride: () => void;
  onNavigateToNode?: NavigateToNodeCallback;
  allNodeIds?: string[];
  /** When true, hide the Override button to prevent mutations on locked types. */
  disabled?: boolean;
}

function InheritedAttributeRow({
  name,
  typeName,
  cardinality,
  ancestorName,
  onOverride,
  onNavigateToNode,
  allNodeIds,
  disabled,
  selected,
  onSelect
}: InheritedAttributeRowProps) {
  const editorCtx = useEditorActionsContext();
  const effectiveDisabled = Boolean(disabled || editorCtx?.readOnly);

  return (
    <div
      role="listitem"
      {...inspectorRowAttributes({ selected, onSelect }, name)}
      data-slot="inherited-attribute-row"
      data-name={name}
      className={`${ATTRIBUTE_ROW_LAYOUT} rounded border border-transparent px-1 py-0.5
        bg-muted/20 opacity-70`}
    >
      {/* Spacer aligns with drag handle */}
      <span className="w-3 shrink-0 justify-self-center" />

      <span
        data-slot="attribute-name"
        className="min-w-0 px-1.5 py-0.5 text-xs font-mono text-muted-foreground truncate"
      >
        {name}
      </span>

      <div data-slot="attribute-type" className="min-w-0">
        <TypeReferenceField
          value={null}
          displayName={typeName}
          options={[]}
          onSelect={() => undefined}
          readOnly
          placeholder="Type"
          onNavigateToNode={onNavigateToNode}
          allNodeIds={allNodeIds}
          className="attribute-type-field"
        />
      </div>

      <span data-slot="attribute-cardinality" className="shrink-0 text-2xs text-muted-foreground">
        {cardinality}
      </span>

      <div className="min-w-0 justify-self-end flex items-center gap-1">
        <span data-slot="inherited-from-label" className="text-2xs text-muted-foreground italic whitespace-nowrap">
          inherited from {ancestorName}
        </span>

        {!effectiveDisabled && (
          <button
            data-slot="attribute-override"
            type="button"
            onClick={onOverride}
            aria-label={`Override inherited attribute ${name} from ${ancestorName}`}
            className="shrink-0 rounded border border-border px-2 py-0.5 text-2xs
              text-muted-foreground transition-colors hover:text-foreground hover:border-input"
          >
            Override
          </button>
        )}
      </div>
    </div>
  );
}

export { InheritedAttributeRow };
