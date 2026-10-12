// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * ChoiceForm — structured editor form for a Choice node.
 *
 * Phase 5a (User Story 3) of `013-z2f-editor-migration`. Mirrors the
 * Phase 3 (DataTypeForm) z2f migration template:
 *
 * - Validation drives off the canonical `ChoiceSchema` from the
 *   langium-generated AST (R1 / R11).
 * - The graph node is passed straight into `defaultValues` (R11). The
 *   AST schema is a `z.looseObject`, so any graph-only keys flow through
 *   without a projection layer.
 * - External-data sync uses the upstream `useExternalSync` hook with an
 *   identity projection (R11) — the graph node IS the AST shape, so no
 *   transformation is required at the sync boundary.
 * - Configured sections share graph actions through EditorActionsProvider.
 *
 * Sections:
 * 1. Header: editable name + "Choice" amber badge
 * 2. Options: ChoiceOptionRow list + inline TypeSelector for "Add Option"
 * 3. Metadata: description, comments, synonyms (MetadataSection)
 *
 * Note: Choices have NO parent/inheritance and no Conditions/Annotations
 * sections (matches the pre-migration baseline).
 *
 * @module
 */

import { useFieldArray, type Control } from 'react-hook-form';
import { useCallback } from 'react';
import { FieldGroup, FieldLegend, FieldSet } from '@rune-langium/design-system/ui/field';
import { Badge } from '@rune-langium/design-system/ui/badge';
import { TypeHeader, INSPECTOR_FORM_HEADER_CLASS } from '../TypeHeader.js';
import { InspectorFrame } from './inspector/InspectorFrame.js';
import { InspectorFooter } from './inspector/InspectorFooter.js';
import { InspectorMetadataDetails } from './inspector/InspectorMetadataDetails.js';
import { useInspectorTargets, type InspectorHostProps } from '../forms/metadata/useInspectorTargets.js';
import { MetadataTargetProvider } from '../forms/metadata/MetadataTargetContext.js';
import { ChoiceOptionRow } from './ChoiceOptionRow.js';
import { TypeSelector } from './TypeSelector.js';
import { EditorSections } from '../forms/sections/EditorSections.js';
import { EditorActionsProvider } from '../forms/sections/EditorActionsContext.js';
import { useAutoSave } from '../../hooks/useAutoSave.js';
import { useLatestRef } from '../../hooks/useLatestRef.js';
import { useZodForm, useExternalSync } from '@zod-to-form/react';
import { EditorFormProvider as FormProvider } from '../forms/EditorFormProvider.js';
import { editorOptimization } from '../forms/editor-optimization.js';

import { ChoiceSchema } from '../../generated/zod-schemas.js';
import { formRegistry } from '../forms/rows/index.js';
import { formValuesProjection } from './identity-projection.js';
import { getTypeRefText } from '../../adapters/model-helpers.js';
import type {
  TypeGraphNode,
  AnyGraphNode,
  GraphNodeMeta,
  TypeOption,
  SourceRefOption,
  EditorFormActions,
  NavigateToNodeCallback
} from '../../types.js';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ChoiceFormProps extends InspectorHostProps {
  /** Node ID of the Choice being edited. */
  nodeId: string;
  /** Data payload for the selected choice node (AnyGraphNode with $type='Choice'). */
  data: AnyGraphNode;
  /** Available type options for selectors. */
  availableTypes: TypeOption[];
  /** Available synonym source options for the source-ref picker. */
  synonymSourceOptions?: SourceRefOption[];
  /** Choice-specific editor form action callbacks. */
  allNodes?: TypeGraphNode[];
  actions: EditorFormActions<'choice'>;
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

const EMPTY_NODES: TypeGraphNode[] = [];
const EMPTY_SYNONYM_SOURCE_OPTIONS: SourceRefOption[] = [];

function ChoiceForm({
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
}: ChoiceFormProps) {
  const d = data as any;

  // ---- Form setup (useZodForm + useExternalSync per R11 / R4) -------------
  // Drive validation off the canonical AST schema; pass the graph node
  // straight into `defaultValues` (ChoiceSchema is z.looseObject, so the
  // graph node passes through unchanged). Phase 8 (US6) wires the bespoke
  // <ChoiceOptionRow> as a custom row renderer via formRegistry.

  const { form } = useZodForm(ChoiceSchema, {
    optimization: editorOptimization,
    defaultValues: formValuesProjection<typeof ChoiceSchema>(data, nodeMeta),
    mode: 'onChange',
    formRegistry,
    errorDisplay: 'afterTouched'
  });

  // Re-bind pristine field state when the caller swaps to a different node.
  // `keepDirty: true` preserves the prior local-component semantics so
  // in-flight user edits are not stomped by a graph push.
  useExternalSync(form, data, (n) => formValuesProjection<typeof ChoiceSchema>(n, nodeMeta), { keepDirty: true });

  // Track committed data for diffing
  const committedRef = useLatestRef(data);

  // ---- Name auto-save (debounced) ------------------------------------------

  const commitName = useCallback(
    (newName: string) => {
      if (newName && newName.trim() && newName !== committedRef.current.name) {
        actions.renameType(nodeId, newName.trim());
      }
    },
    [nodeId, actions]
  );

  const debouncedName = useAutoSave(commitName, 500);

  // ---- Option callbacks ----------------------------------------------------

  const handleRemoveOption = useCallback(
    (nId: string, typeName: string) => {
      actions.removeChoiceOption(nId, typeName);
    },
    [actions]
  );

  const handleAddOption = useCallback(
    (value: string | null) => {
      if (value) {
        const label = availableTypes.find((opt) => opt.value === value)?.label;
        if (label) {
          actions.addChoiceOption(nodeId, label);
        }
      }
    },
    [nodeId, actions, availableTypes]
  );

  // ---- Derived members from AST attributes ---------------------------------

  const { fields } = useFieldArray({
    control: form.control as unknown as Control<{ attributes: { name: string }[] }>,
    name: 'attributes'
  });
  const members = (d.attributes ?? []).map((o: any) => ({
    name: getTypeRefText(o.typeCall) ?? '',
    typeName: getTypeRefText(o.typeCall) ?? ''
  }));

  // ---- Filter out types already used as options ----------------------------

  const usedTypeNames = new Set(members.map((m: { typeName: string }) => m.typeName));
  const addableTypes = availableTypes.filter(
    (opt) => (opt.kind === 'data' || opt.kind === 'choice') && opt.label !== d.name && !usedTypeNames.has(opt.label)
  );

  // ---- Render --------------------------------------------------------------

  const isReadOnly = Boolean(readOnlyProp || nodeMeta.isReadOnly);

  const targets = useInspectorTargets({
    nodeId,
    root: data,
    fields,
    collection: 'attributes',
    actions,
    scopeKey,
    parseEpoch,
    readOnly: isReadOnly
  });

  return (
    <FormProvider
      {...form}
      schema={ChoiceSchema}
      registerCommitFlush={registerCommitFlush}
      additionalCommitFlush={debouncedName.flush}
    >
      <EditorActionsProvider
        nodeId={nodeId}
        actions={actions}
        allNodes={allNodes}
        sourceCommentsOnly
        readOnly={isReadOnly}
        synonymSourceOptions={synonymSourceOptions}
      >
        <div data-slot="choice-form" className="h-full min-h-0 p-4">
          <MetadataTargetProvider value={targets.rootBinding}>
            <InspectorFrame
              header={
                <>
                  <TypeHeader
                    kind="choice"
                    namespace={nodeMeta.namespace}
                    control={form.control}
                    onNameChange={debouncedName}
                    placeholder="Choice name"
                    nameAriaLabel="Choice type name"
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

              sections={[
                {
                  id: 'members',
                  label: 'Options',
                  members: true,
                  content: (
                    <>
                      {' '}
                      <FieldSet className="gap-1">
                        <FieldLegend variant="label" className="mb-0 text-muted-foreground">
                          Options ({members.length})
                        </FieldLegend>

                        <FieldGroup role="list" className="gap-0.5">
                          {members.map((member: { name: string; typeName: string }, index: number) => (
                            <ChoiceOptionRow
                              key={fields[index]?.id ?? member.typeName ?? member.name}
                              selected={targets.selection.selectedRow?.key === fields[index]?.id}
                              onSelect={() => {
                                const key = fields[index]?.id;
                                if (key) targets.selection.select(key);
                              }}
                              typeName={member.typeName ?? member.name}
                              nodeId={nodeId}
                              availableTypes={availableTypes}
                              onRemove={handleRemoveOption}
                              onNavigateToNode={onNavigateToNode}
                              allNodeIds={allNodeIds}
                            />
                          ))}

                          {members.length === 0 && (
                            <p className="text-xs text-muted-foreground italic py-2 text-center">
                              No options defined. Use the selector below to add one.
                            </p>
                          )}
                        </FieldGroup>

                        {/* Add Option via TypeSelector — hidden in read-only mode */}
                        {!isReadOnly && (
                          <div data-slot="add-option" className="mt-1">
                            <TypeSelector
                              value=""
                              options={addableTypes}
                              onSelect={handleAddOption}
                              placeholder="Add option..."
                            />
                          </div>
                        )}
                      </FieldSet>
                    </>
                  )
                },
                { id: 'doc', label: 'Doc', content: <EditorSections names={['MetadataSection']} /> },
                { id: 'meta', label: 'Meta', content: <EditorSections names={['AnnotationSection']} /> }
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

export { ChoiceForm };
