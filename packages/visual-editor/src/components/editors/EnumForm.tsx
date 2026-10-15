// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * EnumForm — structured editor form for an Enumeration node.
 *
 * Uses react-hook-form `FormProvider` so nested components (EnumValueRow,
 * declarative section components) can access form state via
 * `useFormContext`. `useFieldArray` manages the `enumValues` list with
 * stable keys for add/remove/reorder without stale-closure bugs.
 *
 * Per R11 of `specs/013-z2f-editor-migration/research.md`, the form is
 * driven directly by the langium-generated `RosettaEnumerationSchema`
 * (`z.looseObject`). The graph node IS already AST-shaped, so it is
 * passed straight into `defaultValues` and `useExternalSync` uses an
 * identity projection.
 *
 * Sections (Annotations, Metadata) render declaratively via the typed
 * config + `componentModule` lookup (Phase 7 / US5). The
 * `<EditorActionsProvider>` wrapper bridges those section components
 * back to `EditorFormActions` + `nodeId`.
 *
 * Sections:
 * 1. Header: editable name + "Enum" green badge
 * 2. Parent enum: TypeSelector (filtered to kind='enum', clearable)
 * 3. Enum values: EnumValueRow list + "Add Value" button
 * 4. Annotations + Metadata: resolved by the shared section layout
 *
 * @module
 */

import { getEditorFieldSchema } from '../../schemas/editor-field-schema.js';
import { SCHEMA_BY_TYPE } from '../../schemas/schema-by-type.js';
import { useInspectorExternalSync } from '../../hooks/useInspectorExternalSync.js';
import { useCallback, useMemo, useState } from 'react';
import { useFieldArray, type Control } from 'react-hook-form';
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
import { EnumValueRow, InheritedEnumValueRow } from './EnumValueRow.js';
import { useEffectiveMembers } from '../../hooks/useInheritedMembers.js';
import { useInspectorCommitLifecycle } from '../../hooks/editor-commit-lifecycle.js';
import { useAutoSave } from '../../hooks/useAutoSave.js';
import { useLatestRef } from '../../hooks/useLatestRef.js';
import { useZodForm } from '@zod-to-form/react';
import { EditorFormProvider as FormProvider } from '../forms/EditorFormProvider.js';
import { editorOptimization } from '../forms/editor-optimization.js';

import { RosettaEnumerationSchema } from '../../generated/zod-schemas.js';
import { formRegistry } from '../forms/rows/index.js';
import { formValuesProjection } from './identity-projection.js';
import { getRefText } from '../../adapters/model-helpers.js';
import { EditorSections } from '../forms/sections/EditorSections.js';
import { EditorActionsProvider } from '../forms/sections/EditorActionsContext.js';
import type {
  AnyGraphNode,
  GraphNodeMeta,
  TypeOption,
  SourceRefOption,
  TypeGraphNode,
  EditorFormActions,
  NavigateToNodeCallback
} from '../../types.js';

const EMPTY_NODES: TypeGraphNode[] = [];
const EMPTY_SYNONYM_SOURCE_OPTIONS: SourceRefOption[] = [];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EnumFormProps extends InspectorHostProps {
  /** Node ID of the Enum being edited. */
  nodeId: string;
  /** Data payload for the selected enum node (AnyGraphNode with $type='RosettaEnumeration'). */
  data: AnyGraphNode;
  /** Available type options for selectors. */
  availableTypes: TypeOption[];
  /** Available synonym source options for the source-ref picker. */
  synonymSourceOptions?: SourceRefOption[];
  /** Enum-specific editor form action callbacks. */
  actions: EditorFormActions<'enum'>;
  /** All graph nodes for inherited member resolution. */
  allNodes?: TypeGraphNode[];
  /** Callback to navigate to a type's graph node. */
  onNavigateToNode?: NavigateToNodeCallback;
  /** All loaded graph node IDs for resolving type name to node ID. */
  allNodeIds?: string[];
  /**
   * Panel-level read-only override. ORed with the node metadata's
   * `isReadOnly` flag.
   */
  readOnly?: boolean;
  /**
   * True when the node's source file is a refOnly curated reference.
   * Surfaces a "Reference Only" pill in the header, matching OtherForm's
   * treatment.
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

function EnumForm({
  nodeId,
  data,
  availableTypes,
  synonymSourceOptions = EMPTY_SYNONYM_SOURCE_OPTIONS,
  actions,
  allNodes = EMPTY_NODES,
  onNavigateToNode,
  allNodeIds,
  readOnly: readOnlyProp,
  refOnly,
  meta: nodeMeta,
  scopeKey,
  parseEpoch,
  saveStatus,
  registerCommitFlush
}: EnumFormProps) {
  const d = data as any;
  // ---- Form setup (R11: AST schema + identity projection) -----------------
  // RosettaEnumerationSchema is `z.looseObject`, so the graph node passes
  // through `defaultValues` without a projection layer. The bespoke
  // <EnumValueRow> reads `enumValues.${index}.{name,display}` paths.
  // Phase 8 (US6) wires the row as a custom renderer via formRegistry.

  const { form } = useZodForm(RosettaEnumerationSchema, {
    optimization: editorOptimization,
    // The graph node is a union (`AnyGraphNode`); the host narrows by
    // `$type` upstream. `formValuesProjection` covers the typed gap between
    // the discriminated union and z2f's `Partial<output<Schema>>` constraint.
    defaultValues: formValuesProjection<typeof RosettaEnumerationSchema>(data, nodeMeta),
    mode: 'onChange',
    formRegistry,
    errorDisplay: 'afterTouched'
  });

  // Re-bind pristine field state when the caller swaps to a different node
  // (object identity is the contract). `keepDirty: true` preserves the
  // pre-migration `keepDirtyValues: true` semantics. Identity projection
  // per R11 — the graph node IS already AST-shaped.
  useInspectorExternalSync(form, data, (n) => formValuesProjection<typeof RosettaEnumerationSchema>(n, nodeMeta), {
    parseEpoch
  });

  // The bespoke <EnumValueRow> reads `enumValues.${index}.{name,display}`
  // paths against the AST schema. Widen the control type so useFieldArray
  // accepts the lazily-typed array key (RosettaEnumerationSchema's enumValues
  // is `optional` in the inferred output, which collapses to `never` here).
  const { fields, append, remove, move } = useFieldArray({
    control: form.control as unknown as Control<{
      enumValues: { $type?: string; name: string; display?: string }[];
    }>,
    name: 'enumValues'
  });

  // Track the committed (graph-confirmed) data for diffing
  const committedRef = useLatestRef(data);

  // ---- Name auto-save (debounced) ------------------------------------------

  const lifecycle = useInspectorCommitLifecycle(registerCommitFlush);

  const commitName = useCallback(
    (newName: string) => {
      if (!getEditorFieldSchema(SCHEMA_BY_TYPE.RosettaEnumeration!, 'name')?.safeParse(newName.trim()).success) return;
      if (newName && newName.trim() && newName !== committedRef.current.name) {
        lifecycle.flush();
        actions.renameType(nodeId, newName.trim());
      }
    },
    [nodeId, actions, lifecycle.flush]
  );

  const debouncedName = useAutoSave(commitName, 500);

  // ---- Parent enum ---------------------------------------------------------

  const handleParentSelect = useCallback(
    (value: string | null) => {
      actions.setEnumParent(nodeId, value);
    },
    [nodeId, actions]
  );

  // ---- Enum value actions --------------------------------------------------

  const handleOverrideInheritedValue = useCallback(
    (name: string, displayName: string) => {
      append({ $type: 'RosettaEnumValue', name, display: displayName });
      actions.addEnumValue(nodeId, name, displayName || undefined);
    },
    [nodeId, actions, append]
  );

  const handleAddValue = useCallback(() => {
    append({ $type: 'RosettaEnumValue', name: '', display: '' });
    actions.addEnumValue(nodeId, '', undefined);
  }, [nodeId, actions, append]);

  const handleRemoveValue = useCallback(
    (i: number) => {
      const enumValues = (committedRef.current as any).enumValues ?? [];
      const committed = enumValues[i];
      if (committed) {
        remove(i);
        actions.removeEnumValue(nodeId, committed.name);
      }
    },
    [nodeId, actions, remove]
  );

  const handleReorderValue = useCallback(
    (fromIndex: number, toIndex: number) => {
      move(fromIndex, toIndex);
      actions.reorderEnumValue(nodeId, fromIndex, toIndex);
    },
    [nodeId, actions, move]
  );

  const handleUpdateValue = useCallback(
    (_nodeId: string, oldName: string, newName: string, displayName?: string) => {
      actions.updateEnumValue(nodeId, oldName, newName, displayName);
    },
    [nodeId, actions]
  );

  const handleRevertEnumOverride = useCallback(
    (valueName: string) => {
      const fieldIdx = fields.findIndex((f: any) => f.name === valueName);
      if (fieldIdx >= 0) {
        remove(fieldIdx);
        actions.removeEnumValue(nodeId, valueName);
      }
    },
    [nodeId, actions, fields, remove]
  );

  // ---- Effective members (local + inherited) -------------------------------

  const parentName = getRefText(d.parent);
  const { effective: effectiveValues } = useEffectiveMembers(data, allNodes, fields);
  const inheritedCount = effectiveValues.filter((e) => e.source === 'inherited').length;

  // ---- Resolve parent enum option ------------------------------------------

  const parentOptions = availableTypes.filter((opt) => opt.kind === 'enum' && opt.label !== d.name);

  const parentValue = parentName ? (availableTypes.find((opt) => opt.label === parentName)?.value ?? null) : null;

  const isReadOnly = Boolean(readOnlyProp || nodeMeta.isReadOnly);

  const targets = useInspectorTargets({
    nodeId,
    root: data,
    fields,
    collection: 'enumValues',
    effective: effectiveValues,
    actions,
    scopeKey,
    parseEpoch,
    readOnly: isReadOnly
  });

  const editorActionsValue = useMemo(
    () => ({ nodeId, actions, readOnly: isReadOnly, synonymSourceOptions, allNodes, sourceCommentsOnly: true }),
    [nodeId, actions, isReadOnly, synonymSourceOptions, allNodes]
  );

  // ---- Render --------------------------------------------------------------

  return (
    <FormProvider
      {...form}
      canonicalType="RosettaEnumeration"
      schema={RosettaEnumerationSchema}
      registerCommitFlush={lifecycle.register}
      additionalCommitFlush={debouncedName.flush}
    >
      <EditorActionsProvider {...editorActionsValue}>
        <div data-slot="enum-form" className={INSPECTOR_FORM_CLASS}>
          <MetadataTargetProvider value={targets.rootBinding}>
            <InspectorFrame
              header={
                <>
                  <TypeHeader
                    kind="enum"
                    namespace={nodeMeta.namespace}
                    control={form.control}
                    onNameChange={debouncedName}
                    placeholder="Enum name"
                    nameAriaLabel="Enum type name"
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
                  placeholder="Select parent enum..."
                  allowClear
                  emptyLabel="No parent enum"
                  filterKinds={['enum']}
                  onNavigateToNode={onNavigateToNode}
                  allNodeIds={allNodeIds}
                  disabled={isReadOnly}
                />
              }
              sections={[
                {
                  id: 'members',
                  label: 'Values',
                  members: true,
                  content: (
                    <>
                      {' '}
                      <FieldSet className="gap-1">
                        <FieldLegend
                          variant="label"
                          className="mb-0 text-muted-foreground flex items-center justify-between"
                        >
                          <span>Values ({fields.length + inheritedCount})</span>
                          {/* Icon-only add button matches FormPreviewPanel; see
                  DataTypeForm for the rationale. */}
                          {!isReadOnly && (
                            <Button
                              data-slot="add-value-btn"
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              onClick={handleAddValue}
                              aria-label="Add value"
                              title="Add value"
                            >
                              <Plus className="size-3" />
                            </Button>
                          )}
                        </FieldLegend>

                        <PaginatedEnumValues
                          effectiveValues={effectiveValues}
                          targets={targets}
                          // Read straight from `d`, NOT `committedRef` — the ref only updates
                          // in a post-commit layout effect, so on the render that swaps
                          // `data` (node switch / external graph push) it would still hold
                          // the PREVIOUS node's enumValues, baking a stale rename anchor
                          // into this row's onUpdate closures (Codex review).
                          committedEnumValues={d.enumValues ?? []}
                          nodeId={nodeId}
                          onUpdate={handleUpdateValue}
                          onRemove={handleRemoveValue}
                          onReorder={handleReorderValue}
                          onRevertOverride={handleRevertEnumOverride}
                          onOverrideInherited={handleOverrideInheritedValue}
                          isReadOnly={isReadOnly}
                          synonymSourceOptions={synonymSourceOptions}
                        />
                      </FieldSet>
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

// Pagination threshold — render rows incrementally to avoid mounting
// 600+ Controller-bound form rows at once. Can't use @tanstack/react-virtual
// here because EnumValueRow uses useFormContext + Controller with index-based
// paths — unmounting rows would unregister fields from react-hook-form state
// even with shouldUnregister: false, and drag-reorder indices would break.
const PAGE_SIZE = 50;

interface PaginatedEnumValuesProps {
  targets: ReturnType<typeof useInspectorTargets>;
  effectiveValues: Array<{
    id: string;
    source: 'local' | 'inherited';
    name: string;
    displayName?: string;
    fieldIndex?: number;
    isOverride?: boolean;
    ancestorName?: string;
  }>;
  committedEnumValues: Array<{ name?: string; display?: string }>;
  nodeId: string;
  onUpdate: (nodeId: string, oldName: string, newName: string, displayName?: string) => void;
  onRemove: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  onRevertOverride: (name: string) => void;
  onOverrideInherited: (name: string, displayName: string) => void;
  /** When true, hides Override buttons on inherited rows to prevent mutations on locked types. */
  isReadOnly?: boolean;
  /** Available synonym source options threaded from EnumForm to each value row. */
  synonymSourceOptions?: SourceRefOption[];
}

function PaginatedEnumValues({
  targets,
  effectiveValues,
  committedEnumValues,
  nodeId,
  onUpdate,
  onRemove,
  onReorder,
  onRevertOverride,
  onOverrideInherited,
  isReadOnly,
  synonymSourceOptions
}: PaginatedEnumValuesProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  if (effectiveValues.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic py-2 text-center">
        No values defined. Use the + button above to add one.
      </p>
    );
  }

  const visible = effectiveValues.slice(0, visibleCount);
  const remaining = effectiveValues.length - visibleCount;

  return (
    <FieldGroup role="list" className="gap-0.5">
      {visible.map((entry) =>
        entry.source === 'local' ? (
          <EnumValueRow
            key={entry.id}
            selected={targets.selection.selectedRow?.key === entry.id}
            onSelect={() => targets.selection.select(entry.id)}
            metadataInDetails
            index={entry.fieldIndex!}
            name={committedEnumValues[entry.fieldIndex!]?.name ?? ''}
            displayName={committedEnumValues[entry.fieldIndex!]?.display ?? ''}
            nodeId={nodeId}
            onUpdate={onUpdate}
            onRename={targets.rootBinding.guarded ? (name) => targets.renameRow(entry.id, name) : undefined}
            onRemove={() => onRemove(entry.fieldIndex!)}
            onReorder={onReorder}
            isOverride={entry.isOverride}
            onRevert={entry.isOverride ? () => onRevertOverride(entry.name) : undefined}
            synonymSourceOptions={synonymSourceOptions}
          />
        ) : (
          <InheritedEnumValueRow
            metadataInDetails
            key={entry.id}
            selected={targets.selection.selectedRow?.key === entry.id}
            onSelect={() => targets.selection.select(entry.id)}
            name={entry.name}
            displayName={entry.displayName}
            ancestorName={entry.ancestorName!}
            disabled={isReadOnly}
            onOverride={() => onOverrideInherited(entry.name, entry.displayName ?? '')}
          />
        )
      )}
      {remaining > 0 && (
        <button
          type="button"
          className="text-xs text-primary hover:underline py-1 text-center w-full"
          onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
        >
          Show more ({remaining} remaining)
        </button>
      )}
    </FieldGroup>
  );
}

export { EnumForm };
