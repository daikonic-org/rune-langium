// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * DataTypeForm — structured editor form for a Data type node.
 *
 * Uses react-hook-form `FormProvider` so nested components (AttributeRow,
 * MetadataSection) can access form state via `useFormContext`.
 * `useFieldArray` manages the members list with stable keys for
 * add/remove/reorder without stale-closure bugs.
 *
 * Sections:
 * 1. Header: editable name + "Data" blue badge
 * 2. Inheritance: TypeSelector for parent type (clearable)
 * 3. Attributes: AttributeRow list via useFieldArray + "Add Attribute" button
 * 4. Metadata: description, comments, synonyms (MetadataSection)
 *
 * @module
 */

import { TypeReferenceImports, resolveNodeId } from './TypeLink.js';
import { qualifiedNameFromNodeId } from '../../store/node-projection.js';
import { getEditorFieldSchema } from '../../schemas/editor-field-schema.js';
import { SCHEMA_BY_TYPE } from '../../schemas/schema-by-type.js';
import { useInspectorExternalSync } from '../../hooks/useInspectorExternalSync.js';
import { createAttributeDraft } from '../../store/attribute-drafts.js';
import { useEffect, useCallback, useMemo } from 'react';
import { useFieldArray, type Control } from 'react-hook-form';
import type { GhostRow, GhostRowContext } from '@zod-to-form/core';
import { FieldGroup, FieldLegend, FieldSet } from '@rune-langium/design-system/ui/field';
import { Button } from '@rune-langium/design-system/ui/button';
import { Badge } from '@rune-langium/design-system/ui/badge';
import { TypeHeader, INSPECTOR_FORM_HEADER_CLASS, INSPECTOR_FORM_CLASS } from '../TypeHeader.js';
import { InspectorFrame } from './inspector/InspectorFrame.js';
import { InspectorFooter } from './inspector/InspectorFooter.js';
import { InspectorInheritanceField } from './inspector/InspectorInheritanceField.js';
import { InspectorMetadataDetails } from './inspector/InspectorMetadataDetails.js';
import { useInspectorTargets, type InspectorHostProps } from '../forms/metadata/useInspectorTargets.js';
import { MetadataTargetProvider } from '../forms/metadata/MetadataTargetContext.js';
import { Plus } from 'lucide-react';
import { AttributeRow } from './AttributeRow.js';
import { InheritedAttributeRow } from './AttributeRow.js';
import { useEffectiveMembers } from '../../hooks/useInheritedMembers.js';
import { getRefText, parseCardinality } from '../../adapters/model-helpers.js';
import { useInspectorCommitLifecycle } from '../../hooks/editor-commit-lifecycle.js';
import { useAutoSave } from '../../hooks/useAutoSave.js';
import { useLatestRef } from '../../hooks/useLatestRef.js';
import { useZodForm } from '@zod-to-form/react';
import { EditorFormProvider as FormProvider } from '../forms/EditorFormProvider.js';
import { editorOptimization } from '../forms/editor-optimization.js';

import { DataSchema } from '../../generated/zod-schemas.js';
import { formRegistry } from '../forms/rows/index.js';
import { formValuesProjection } from './identity-projection.js';
import { EditorSections } from '../forms/sections/EditorSections.js';
import { EditorActionsProvider } from '../forms/sections/EditorActionsContext.js';
import type {
  AnyGraphNode,
  GraphNodeMeta,
  TypeGraphNode,
  TypeOption,
  SourceRefOption,
  EditorFormActions,
  ExpressionEditorSlotProps,
  NavigateToNodeCallback
} from '../../types.js';
import type { ReactNode } from 'react';

const EMPTY_NODES: TypeGraphNode[] = [];
const EMPTY_SYNONYM_SOURCE_OPTIONS: SourceRefOption[] = [];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DataTypeFormProps extends InspectorHostProps {
  /** Node ID of the Data type being edited. */
  nodeId: string;
  /** Data payload for the selected node (AnyGraphNode with $type='Data'). */
  data: AnyGraphNode;
  /** Available type options for selectors. */
  availableTypes: TypeOption[];
  /** Available synonym source options for the source-ref picker. */
  synonymSourceOptions?: SourceRefOption[];
  /** Data-specific editor form action callbacks. */
  actions: EditorFormActions<'data'>;
  /** All graph nodes (for inherited member resolution via useEffectiveMembers). */
  allNodes?: TypeGraphNode[];
  /** Optional render-prop for a rich expression editor. */
  renderExpressionEditor?: (props: ExpressionEditorSlotProps) => ReactNode;
  compactConditions?: boolean;
  structuralEditsDisabled?: boolean;
  /** Callback to navigate to a type's graph node. */
  onNavigateToNode?: NavigateToNodeCallback;
  /** All loaded graph node IDs for resolving type name to node ID. */
  allNodeIds?: string[];
  /**
   * Panel-level read-only override. When true the form renders in read-only
   * mode even if the node's own `isReadOnly` flag is false (e.g. panel prop
   * lock from a curated refOnly file). ORed with the node metadata's
   * `isReadOnly` flag.
   */
  readOnly?: boolean;
  /**
   * True when the node's source file is a refOnly curated reference (no
   * client-side source text). Surfaces a "Reference Only" pill in the
   * header, matching OtherForm's treatment, so a read-only render here
   * (vs. a locked-but-editable-source node) reads the same as it always
   * has for curated types.
   */
  refOnly?: boolean;
  /**
   * UI/editor metadata for the node (namespace, isReadOnly, errors,
   * comments, ...). Required — `data` is the pure domain payload and no
   * longer carries any UI metadata (Phase 3 step 3).
   */
  meta: GraphNodeMeta;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function DataTypeForm({
  nodeId,
  data,
  availableTypes,
  synonymSourceOptions = EMPTY_SYNONYM_SOURCE_OPTIONS,
  actions,
  allNodes = EMPTY_NODES,
  renderExpressionEditor,
  compactConditions,
  structuralEditsDisabled = false,
  onNavigateToNode,
  allNodeIds,
  readOnly: readOnlyProp,
  refOnly,
  meta: nodeMeta,
  scopeKey,
  parseEpoch,
  saveStatus,
  registerCommitFlush
}: DataTypeFormProps) {
  // ---- Form setup (useZodForm + useExternalSync per R11 / R4) -------------
  // Drive validation off the canonical AST schema. Per R11 the editor
  // consumes the AST node directly — `<AttributeRow>` now reads AST paths
  // (`attributes.${i}.{name,typeCall.type.$refText,card,override}`), so
  // there is no projection layer and no reshape bridge.

  const { form } = useZodForm(DataSchema, {
    optimization: editorOptimization,
    defaultValues: formValuesProjection<typeof DataSchema>(data, nodeMeta),
    mode: 'onChange',
    formRegistry,
    errorDisplay: 'afterTouched'
  });

  // Re-bind pristine field state when the caller swaps to a different node
  // (object identity is the contract). `keepDirty: true` preserves the
  // pre-migration `keepDirtyValues: true` semantics so in-flight user edits
  // are not stomped by a graph push.
  useInspectorExternalSync(form, data, (d) => formValuesProjection<typeof DataSchema>(d, nodeMeta), { parseEpoch });

  // `DataSchema` is a `z.looseObject`; the inferred `output<>` does not
  // expose `attributes` as a structured array path RHF's overloaded
  // `useFieldArray` can latch onto. Widen the control type so the AST array
  // key (`attributes`) is accepted — runtime behaviour is unchanged.
  type AttributeFieldShape = {
    $type: 'Attribute';
    name: string;
    typeCall: { $type: 'TypeCall'; type: { $refText: string } };
    card: { inf: number; sup?: number; unbounded?: boolean };
    override?: boolean;
  };
  const { fields, append, remove, move } = useFieldArray({
    control: form.control as unknown as Control<{ attributes: AttributeFieldShape[] }>,
    name: 'attributes'
  });

  // Track the committed (graph-confirmed) data for diffing
  const committedRef = useLatestRef(data);

  // ---- Name auto-save (debounced) ------------------------------------------

  const lifecycle = useInspectorCommitLifecycle(registerCommitFlush);

  const commitName = useCallback(
    (newName: string) => {
      if (!getEditorFieldSchema(SCHEMA_BY_TYPE.Data!, 'name')?.safeParse(newName.trim()).success) return;
      if (structuralEditsDisabled) return false;
      if (readOnlyProp || nodeMeta.isReadOnly) return;
      if (newName && newName.trim() && newName !== committedRef.current.name) {
        lifecycle.flush();
        actions.renameType(nodeId, newName.trim());
      }
    },
    [nodeId, actions, structuralEditsDisabled, readOnlyProp, nodeMeta.isReadOnly, lifecycle.flush]
  );

  const debouncedName = useAutoSave(commitName, 500);
  useEffect(() => {
    if (!structuralEditsDisabled) debouncedName.flush();
  }, [structuralEditsDisabled, debouncedName]);

  // ---- Inheritance ---------------------------------------------------------

  const handleParentSelect = useCallback(
    (value: string | null) => {
      const label = value ? (availableTypes.find((o) => o.value === value)?.label ?? '') : '';
      // Mirror the selection into AST-canonical `superType.$refText` so the
      // form stays consistent until the external graph push round-trips back
      // through `useExternalSync`. The visible parent label below reads off
      // `data.superType` (the committed graph value) for the same reason.
      form.setValue('superType.$refText', label, { shouldDirty: true });
      actions.setInheritance(nodeId, value);
    },
    [nodeId, actions, availableTypes, form]
  );

  // ---- Attribute actions ---------------------------------------------------

  // Build an AST-shaped Attribute literal for `useFieldArray.append`. The
  // bespoke <AttributeRow> reads `attributes.${i}.{name,typeCall.type.$refText,card,override}`
  // (R11), so the appended item must be in that shape — no projection.
  const makeAttributeAstItem = useCallback(
    (name: string, typeName: string, cardinality = '(1..1)', override = false) =>
      createAttributeDraft(name, typeName, parseCardinality(cardinality), override),
    []
  );

  const handleOverrideInherited = useCallback(
    (attr: { name: string; typeName: string; cardinality: string }) => {
      append(makeAttributeAstItem(attr.name, attr.typeName, attr.cardinality));
      actions.addAttribute(nodeId, attr.name, attr.typeName, attr.cardinality);
    },
    [nodeId, actions, append, makeAttributeAstItem]
  );

  const handleRevertOverride = useCallback(
    (attrName: string) => {
      // `useFieldArray` field items carry the AST `name` field directly
      // (the array `name: 'attributes'` binds to AST `Attribute` items).
      const fieldIdx = fields.findIndex((f) => (f as { name?: string }).name === attrName);
      if (fieldIdx >= 0) {
        remove(fieldIdx);
        actions.removeAttribute(nodeId, attrName);
      }
    },
    [nodeId, actions, fields, remove]
  );

  const handleAddAttribute = useCallback(() => {
    append(makeAttributeAstItem('', 'string', '(1..1)'));
    actions.addAttribute(nodeId, '', 'string', '(1..1)');
  }, [nodeId, actions, append, makeAttributeAstItem]);

  const handleRemoveAttribute = useCallback(
    (index: number) => {
      const attrs = (committedRef.current as any).attributes ?? [];
      const committed = attrs[index];
      if (committed) {
        remove(index);
        actions.removeAttribute(nodeId, committed.name);
      }
    },
    [nodeId, actions, remove]
  );

  const handleReorderAttribute = useCallback(
    (fromIndex: number, toIndex: number) => {
      move(fromIndex, toIndex);
      actions.reorderAttribute(nodeId, fromIndex, toIndex);
    },
    [nodeId, actions, move]
  );

  const handleUpdateAttribute = useCallback(
    (_index: number, oldName: string, newName: string, typeName: string, cardinality: string) => {
      actions.updateAttribute(nodeId, oldName, newName, typeName, cardinality);
    },
    [nodeId, actions]
  );

  // ---- Resolve parent type option for display ------------------------------

  // ---- Effective members (local + inherited) via hook ----------------------

  const { effective: effectiveAttributes } = useEffectiveMembers(data, allNodes, fields);

  // Local-side metadata derived from the effective list — `isOverride` tells
  // <AttributeRow> when to render the "revert" affordance (shadowing an
  // inherited row with the same name).
  const localMeta = useMemo(() => {
    const meta: Record<number, { isOverride: boolean; name: string }> = {};
    for (const entry of effectiveAttributes) {
      if (entry.source === 'local' && entry.fieldIndex !== undefined) {
        meta[entry.fieldIndex] = { isOverride: entry.isOverride, name: entry.name };
      }
    }
    return meta;
  }, [effectiveAttributes]);

  const d = data as any;
  const parentName = getRefText(d.superType);

  const parentOptions = availableTypes.filter(
    (opt) => (opt.kind === 'data' || opt.kind === 'builtin') && opt.label !== d.name
  );

  const parentValue = parentName ? (availableTypes.find((opt) => opt.label === parentName)?.value ?? null) : null;

  // ---- Compute isReadOnly before ghost rows so it is in scope for the memo --

  const sourceReadOnly = Boolean(readOnlyProp || nodeMeta.isReadOnly);
  const isReadOnly = sourceReadOnly || structuralEditsDisabled;

  // ---- Inherited rows as ghost-row primitives (US4 / R6) -------------------
  // Per upstream `arrayConfig.before` (zod-to-form/core: `GhostRow[]`), build
  // one self-contained renderable per inherited entry. Ghost rows do not
  // participate in form state, validation, or submission. The render function
  // receives `{ isFirst, isLast }` positional context and returns the existing
  // <InheritedAttributeRow> JSX with the override affordance preserved.
  const targets = useInspectorTargets({
    nodeId,
    root: data,
    fields,
    collection: 'attributes',
    effective: effectiveAttributes,
    actions,
    scopeKey,
    parseEpoch,
    readOnly: isReadOnly
  });

  const ghostRowsBefore = useMemo<GhostRow[]>(() => {
    const rows: GhostRow[] = [];
    for (const entry of effectiveAttributes) {
      if (entry.source !== 'inherited') continue;
      rows.push({
        id: entry.id,
        render: (_ctx: GhostRowContext) => (
          <TypeReferenceImports.Provider value={entry.imports}>
            <InheritedAttributeRow
              availableTypes={availableTypes}
              name={entry.name}
              selected={targets.selection.selectedRow?.key === entry.id}
              onSelect={() => targets.selection.select(entry.id)}
              typeName={entry.typeName ?? 'string'}
              cardinality={entry.cardinality ?? '(1..1)'}
              ancestorName={entry.ancestorName ?? ''}
              disabled={isReadOnly}
              onOverride={() =>
                handleOverrideInherited({
                  name: entry.name,
                  typeName: entry.imports?.some((imp) => imp.namespaceAlias)
                    ? qualifiedNameFromNodeId(
                        resolveNodeId(entry.typeName ?? 'string', allNodeIds ?? [], entry.imports) ??
                          entry.typeName ??
                          'string'
                      )
                    : (entry.typeName ?? 'string'),
                  cardinality: entry.cardinality ?? '(1..1)'
                })
              }
              onNavigateToNode={onNavigateToNode}
              allNodeIds={allNodeIds}
            />
          </TypeReferenceImports.Provider>
        )
      });
    }
    return rows;
  }, [
    effectiveAttributes,
    availableTypes,
    isReadOnly,
    handleOverrideInherited,
    onNavigateToNode,
    allNodeIds,
    targets.selection.selectedRow?.key,
    targets.selection.select
  ]);

  const inheritedCount = ghostRowsBefore.length;

  // ---- Render --------------------------------------------------------------

  return (
    <FormProvider
      {...form}
      canonicalType="Data"
      schema={DataSchema}
      registerCommitFlush={lifecycle.register}
      additionalCommitFlush={debouncedName.flush}
    >
      <EditorActionsProvider
        nodeId={nodeId}
        actions={actions}
        allNodes={allNodes}
        sourceCommentsOnly
        readOnly={isReadOnly}
        synonymSourceOptions={synonymSourceOptions}
        renderExpressionEditor={renderExpressionEditor}
        compactConditions={compactConditions}
        sourceReadOnly={sourceReadOnly}
      >
        <div data-slot="data-type-form" className={INSPECTOR_FORM_CLASS}>
          <MetadataTargetProvider value={targets.rootBinding}>
            <InspectorFrame
              header={
                <>
                  {structuralEditsDisabled && (
                    <p role="status" className="text-xs text-muted-foreground">
                      Structural editing waits for the current Rune draft to parse.
                    </p>
                  )}
                  <TypeHeader
                    kind="data"
                    namespace={nodeMeta.namespace}
                    control={form.control}
                    onNameChange={debouncedName}
                    placeholder="Type name"
                    nameAriaLabel="Data type name"
                    className={INSPECTOR_FORM_HEADER_CLASS}
                    onReveal={onNavigateToNode ? () => onNavigateToNode(nodeId) : undefined}
                    trailing={
                      refOnly ? (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          Reference Only
                        </Badge>
                      ) : undefined
                    }
                  />
                </>
              }
              inheritance={
                <InspectorInheritanceField
                  value={parentValue ?? null}
                  displayName={parentName}
                  options={parentOptions}
                  onSelect={handleParentSelect}
                  placeholder="Select parent type..."
                  allowClear
                  emptyLabel="No parent type"
                  filterKinds={['data', 'builtin']}
                  onNavigateToNode={onNavigateToNode}
                  allNodeIds={allNodeIds}
                  disabled={isReadOnly}
                />
              }
              sections={[
                {
                  id: 'members',
                  label: 'Members',
                  members: true,
                  content: (
                    <>
                      <FieldSet className="gap-1">
                        <FieldLegend
                          variant="label"
                          className="mb-0 text-muted-foreground flex items-center justify-between"
                        >
                          <span>Attributes ({fields.length + inheritedCount})</span>
                          {/* Icon-only add button to match FormPreviewPanel's
                    +/- treatment for optional sections and array adds.
                    The legend already names the section ("Attributes"),
                    so the button only conveys the operation. aria-label
                    preserves the full phrasing for screen readers. */}
                          {!isReadOnly && (
                            <Button
                              data-slot="add-attribute-btn"
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              onClick={handleAddAttribute}
                              aria-label="Add attribute"
                              title="Add attribute"
                            >
                              <Plus className="size-3" />
                            </Button>
                          )}
                        </FieldLegend>

                        <FieldGroup role="list" className="gap-0.5">
                          {/* Inherited rows via z2f's `arrayConfig.before` ghost-row primitive
                    (R6 / US4). Rendered above local rows; do not participate in
                    form state, validation, or submission. */}
                          {ghostRowsBefore.map((row, i) => (
                            <div key={`ghost-before-${row.id}`}>
                              {
                                row.render({
                                  isFirst: i === 0,
                                  isLast: i === ghostRowsBefore.length - 1
                                }) as ReactNode
                              }
                            </div>
                          ))}

                          {/* Local rows from RHF's useFieldArray — the form-state surface. */}
                          {fields.map((field, index) => {
                            const meta = localMeta[index];
                            const isOverride = meta?.isOverride ?? false;
                            const localName = meta?.name ?? '';
                            return (
                              <AttributeRow
                                key={field.id}
                                selected={targets.selection.selectedRow?.key === field.id}
                                onSelect={() => targets.selection.select(field.id)}
                                index={index}
                                // Read straight from `data`, NOT `committedRef` — the ref only
                                // updates in a post-commit layout effect, so on the render
                                // that swaps `data` (node switch / external graph push) it
                                // would still hold the PREVIOUS node's name at this index,
                                // baking a stale rename/retype anchor into this row's
                                // onUpdate closures (Codex review).
                                committedName={((data as any).attributes ?? [])[index]?.name ?? ''}
                                availableTypes={availableTypes}
                                onUpdate={handleUpdateAttribute}
                                onRename={
                                  targets.rootBinding.guarded ? (name) => targets.renameRow(field.id, name) : undefined
                                }
                                onRemove={handleRemoveAttribute}
                                onReorder={handleReorderAttribute}
                                onNavigateToNode={onNavigateToNode}
                                allNodeIds={allNodeIds}
                                isOverride={isOverride}
                                onRevert={isOverride ? () => handleRevertOverride(localName) : undefined}
                              />
                            );
                          })}

                          {fields.length === 0 && ghostRowsBefore.length === 0 && (
                            <p className="text-xs text-muted-foreground italic py-2 text-center">
                              No attributes defined. Use the + button above to add one.
                            </p>
                          )}
                        </FieldGroup>
                      </FieldSet>
                    </>
                  )
                },
                {
                  id: 'conditions',
                  label: 'Conditions',
                  content: (
                    <>
                      <EditorSections names={['ConditionSection']} />
                    </>
                  )
                },
                {
                  id: 'details',
                  label: 'Details',
                  content: <EditorSections names={['MetadataSection', 'AnnotationSection']} />
                }
              ]}
              details={<InspectorMetadataDetails targets={targets} />}
              footer={<InspectorFooter errors={nodeMeta.errors} status={saveStatus} />}
            />
          </MetadataTargetProvider>
        </div>
      </EditorActionsProvider>
    </FormProvider>
  );
}

export { DataTypeForm };
