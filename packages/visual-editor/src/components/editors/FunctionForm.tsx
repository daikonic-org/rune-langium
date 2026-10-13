// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * FunctionForm — structured editor form for a Function node.
 *
 * Per R11 of `specs/013-z2f-editor-migration/research.md`, the form is
 * driven directly by the langium-generated `RosettaFunctionSchema` from
 * `src/generated/zod-schemas.ts`; no projection helper is required because
 * `RosettaFunctionSchema` is a `z.looseObject` and the graph node IS the
 * AST shape Langium emits (extra keys like `expressionText`, `definition`,
 * `comments`, `synonyms` are accepted as extras).
 *
 * The host wraps the form tree in `<EditorActionsProvider>` so the
 * declaratively-rendered section components (Annotation, Condition,
 * Metadata) derive their callbacks from `EditorFormActions` + `nodeId`
 * via `useEditorActionsContext()` (Phase 7 / US5 contract). The form
 * body itself no longer threads per-section callback props.
 *
 * Sections:
 * 1. Header: editable name + "Function" purple badge
 * 2. Input parameters: editable `<AttributeRow>` list via useFieldArray
 *    (mirrors DataTypeForm's attribute section — DRY / Task R-func-input),
 *    plus an inline "add input" row that uses `<TypeReferenceField>`.
 * 3. Output type: TypeReferenceField for the return type
 * 4. Function Body: aliases + operations rendered through the
 *    `renderExpressionEditor` slot, falling back to a plain `<Textarea>`
 *    when the slot is not provided. This is the bespoke editor UX that
 *    FR-010 mandates we preserve.
 * 5. Conditions / Annotations / Metadata: rendered via
 *    `<EditorActionsProvider>`-backed declarative invocations (no prop
 *    callbacks).
 *
 * @module
 */

import { getEditorFieldSchema } from '../../schemas/editor-field-schema.js';
import { SCHEMA_BY_TYPE } from '../../schemas/schema-by-type.js';
import { useInspectorExternalSync } from '../../hooks/useInspectorExternalSync.js';
import { createAttributeDraft } from '../../store/attribute-drafts.js';
import { useState, useCallback, useEffect, useRef } from 'react';
import { renderNode, type DehydratedNode } from '@rune-langium/codegen/rosetta';
import type { ReactNode } from 'react';
import { useFieldArray, type Control } from 'react-hook-form';
import { Field, FieldError, FieldGroup, FieldLegend, FieldSet } from '@rune-langium/design-system/ui/field';
import { Input } from '@rune-langium/design-system/ui/input';
import { Textarea } from '@rune-langium/design-system/ui/textarea';
import { Button } from '@rune-langium/design-system/ui/button';
import { Badge } from '@rune-langium/design-system/ui/badge';
import { TypeHeader, INSPECTOR_FORM_HEADER_CLASS } from '../TypeHeader.js';
import { InspectorFrame } from './inspector/InspectorFrame.js';
import { InspectorFooter } from './inspector/InspectorFooter.js';
import { InspectorInheritanceField } from './inspector/InspectorInheritanceField.js';
import { InspectorMetadataDetails } from './inspector/InspectorMetadataDetails.js';
import { useInspectorTargets, type InspectorHostProps } from '../forms/metadata/useInspectorTargets.js';
import { MetadataTargetProvider } from '../forms/metadata/MetadataTargetContext.js';
import { Plus } from 'lucide-react';
import { TypeReferenceField } from './TypeReferenceField.js';
import { AttributeRow } from './AttributeRow.js';
import { InheritedMembersSection } from './InheritedMembersSection.js';
import { EditorSections } from '../forms/sections/EditorSections.js';
import { EditorActionsProvider } from '../forms/sections/EditorActionsContext.js';
import {
  getTypeRefText,
  getRefText,
  resolveRefTextToOptionValue,
  parseCardinality,
  getExpressionDisplayText
} from '../../adapters/model-helpers.js';
import { useInspectorCommitLifecycle } from '../../hooks/editor-commit-lifecycle.js';
import { useAutoSave } from '../../hooks/useAutoSave.js';
import { useLatestRef } from '../../hooks/useLatestRef.js';
import { useStableKey } from '../../hooks/useStableKey.js';
import { useZodForm } from '@zod-to-form/react';
import { EditorFormProvider as FormProvider, EditorController as Controller } from '../forms/EditorFormProvider.js';
import { editorOptimization } from '../forms/editor-optimization.js';

import { functionFormRegistry } from '../forms/rows/index.js';
import { RosettaFunctionSchema } from '../../generated/zod-schemas.js';
import { useExpressionAutocomplete } from '../../hooks/useExpressionAutocomplete.js';
import { validateExpression } from '../../validation/edit-validator.js';
import { formValuesProjection } from './identity-projection.js';
import type {
  TypeGraphNode,
  AnyGraphNode,
  GraphNodeMeta,
  TypeOption,
  SourceRefOption,
  EditorFormActions,
  ExpressionEditorSlotProps,
  FunctionBodyEditorSlotProps,
  NavigateToNodeCallback
} from '../../types.js';
import type { InheritedGroup } from '../../hooks/useInheritedMembers.js';

const EMPTY_GROUPS: InheritedGroup[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract display text from an AST expression node. See {@link getExpressionDisplayText}. */
const getCstText = getExpressionDisplayText;

function OperationExpressionEditor({
  nodeId,
  operation,
  index,
  actions,
  readOnly,
  renderExpressionEditor
}: {
  nodeId: string;
  operation: DehydratedNode & { expression?: unknown };
  index: number;
  actions: EditorFormActions<'func'>;
  readOnly: boolean;
  renderExpressionEditor?: (props: ExpressionEditorSlotProps) => ReactNode;
}) {
  const committedText = getCstText(operation.expression);
  const [draft, setDraft] = useState(committedText);
  const draftRef = useRef(draft);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(committedText);
    draftRef.current = committedText;
    setError(null);
  }, [nodeId, committedText]);
  const commit = () => {
    if (readOnly) return;
    const currentDraft = draftRef.current;
    const validation = validateExpression(currentDraft);
    setError(validation.valid ? null : (validation.error ?? 'Invalid expression'));
    if (validation.valid && currentDraft !== committedText) actions.updateExpression(nodeId, currentDraft, index);
  };
  const change = (value: string) => {
    draftRef.current = value;
    setDraft(value);
    setError(null);
  };
  const headingOperation = { ...operation, expression: undefined };
  const heading =
    renderNode(headingOperation, () => '')
      ?.split('\n')[0]
      ?.replace(/:$/, '') ?? '';
  return (
    <div data-slot="operation-section" className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{heading}</span>
      {readOnly ? (
        <pre className="studio-scroll text-xs font-mono bg-muted/50 rounded p-2 whitespace-pre-wrap overflow-auto max-h-40">
          {committedText || '(empty)'}
        </pre>
      ) : renderExpressionEditor ? (
        renderExpressionEditor({
          value: draft,
          onChange: change,
          onBlur: commit,
          error,
          placeholder: 'Enter expression...',
          expressionAst: operation.expression
        })
      ) : (
        <>
          <Textarea
            value={draft}
            onChange={(event) => change(event.target.value)}
            onBlur={commit}
            aria-label={`Function operation ${index + 1}`}
            rows={2}
            className={`text-sm font-mono resize-y ${error ? 'border-destructive' : ''}`}
            placeholder="Enter expression..."
          />
          {error && <FieldError>{error}</FieldError>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FunctionFormProps extends InspectorHostProps {
  allNodes?: TypeGraphNode[];
  synonymSourceOptions?: SourceRefOption[];
  /** Node ID of the Function being edited. */
  nodeId: string;
  /** Data payload for the selected function node (AnyGraphNode with $type='RosettaFunction'). */
  data: AnyGraphNode;
  /** Available type options for selectors. */
  availableTypes: TypeOption[];
  /** Function-specific editor form action callbacks. */
  actions: EditorFormActions<'func'>;
  /** Inherited member groups from super-function (if any). */
  inheritedGroups?: InheritedGroup[];
  /**
   * Optional render-prop for a rich expression editor (e.g. CodeMirror).
   * When omitted, a plain `<Textarea>` is rendered as fallback.
   *
   * Per FR-010 / R10, this slot is preserved verbatim through the
   * z2f migration: the bespoke expression-builder UX is owned by the
   * studio app and remains a controlled override.
   */
  renderExpressionEditor?: (props: ExpressionEditorSlotProps) => ReactNode;
  renderFunctionBodyEditor?: (props: FunctionBodyEditorSlotProps) => ReactNode;
  structuralEditsDisabled?: boolean;
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
// FunctionForm
// ---------------------------------------------------------------------------

function FunctionForm({
  nodeId,
  data,
  availableTypes,
  actions,
  inheritedGroups = EMPTY_GROUPS,
  renderExpressionEditor,
  renderFunctionBodyEditor,
  structuralEditsDisabled = false,
  synonymSourceOptions,
  onNavigateToNode,
  allNodeIds,
  readOnly: readOnlyProp,
  refOnly,
  meta: nodeMeta,
  allNodes = [],
  scopeKey,
  parseEpoch,
  saveStatus,
  registerCommitFlush
}: FunctionFormProps) {
  const d = data as any;
  const getKey = useStableKey();

  // ---- Form setup (useZodForm + useExternalSync per R11 / R4) -------------
  // Drive validation off the canonical AST schema; pass the graph node
  // straight into `defaultValues` (RosettaFunctionSchema is a z.looseObject,
  // so the graph node passes through unchanged — no projection layer).

  const { form } = useZodForm(RosettaFunctionSchema, {
    optimization: editorOptimization,
    defaultValues: formValuesProjection<typeof RosettaFunctionSchema>(data, nodeMeta),
    mode: 'onChange',
    formRegistry: functionFormRegistry,
    errorDisplay: 'afterTouched'
  });

  // Re-bind pristine field state when the caller swaps to a different
  // node (object identity is the contract). `keepDirty: true` preserves
  // the pre-migration `keepDirtyValues: true` semantics so in-flight
  // user edits are not stomped by a graph push.
  useInspectorExternalSync(form, data, (n) => formValuesProjection<typeof RosettaFunctionSchema>(n, nodeMeta), {
    parseEpoch
  });

  // ---- useFieldArray for `inputs` (mirrors DataTypeForm's `attributes`) ----
  // `RosettaFunctionSchema` is a z.looseObject; the inferred output type does
  // not expose `inputs` as a typed array path RHF's overloaded `useFieldArray`
  // can latch onto. Widen the control type so the AST key is accepted —
  // runtime behaviour is unchanged.
  type AttributeFieldShape = {
    $type: 'Attribute';
    name: string;
    typeCall: { $type: 'TypeCall'; type: { $refText: string } };
    card: { inf: number; sup?: number; unbounded?: boolean };
    override?: boolean;
  };
  const { fields, append, remove, move } = useFieldArray({
    control: form.control as unknown as Control<{ inputs: AttributeFieldShape[] }>,
    name: 'inputs'
  });

  // Track the committed (graph-confirmed) data for diffing
  const committedRef = useLatestRef(data);

  // ---- Name auto-save (debounced — preserved per R8) ----------------------

  const lifecycle = useInspectorCommitLifecycle(registerCommitFlush);

  const commitName = useCallback(
    (newName: string) => {
      if (!getEditorFieldSchema(SCHEMA_BY_TYPE.RosettaFunction!, 'name')?.safeParse(newName.trim()).success) return;
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

  // ---- Expression validation (on blur — preserves bespoke UX, FR-010) -----

  const [expressionError, setExpressionError] = useState<string | null>(null);

  const handleExpressionBlur = useCallback(() => {
    // Guard: a readOnly textarea cannot produce new content, so blur should
    // never trigger a mutation. Early-return to be explicit.
    if (readOnlyProp || nodeMeta.isReadOnly) return;
    const currentExpression = form.getValues('expressionText' as never) as unknown as string;
    const result = validateExpression(currentExpression);
    if (!result.valid) {
      setExpressionError(result.error ?? 'Invalid expression');
    } else {
      setExpressionError(null);
      if (currentExpression !== ((committedRef.current as any).expressionText ?? '')) {
        actions.updateExpression(nodeId, currentExpression);
      }
    }
  }, [nodeId, actions, form, readOnlyProp, nodeMeta.isReadOnly]);

  // ---- Output type ---------------------------------------------------------

  const handleOutputTypeSelect = useCallback(
    (value: string | null) => {
      if (value) {
        const opt = availableTypes.find((o) => o.value === value);
        actions.updateOutputType(nodeId, opt?.label ?? value);
      }
    },
    [nodeId, actions, availableTypes]
  );

  const outputType = getTypeRefText(d.output?.typeCall) ?? d.outputType ?? '';
  const outputValue = outputType ? (availableTypes.find((o) => o.label === outputType)?.value ?? '') : '';

  // ---- Parent function (superFunction) --------------------------------------
  // `InheritedMembersSection` alone is not an equivalent fallback for
  // showing the parent relationship — it renders nothing when the parent is
  // unresolved (not yet loaded/hydrated) or has no inputs, which would
  // silently hide `extends` the way OtherForm never did (Codex review,
  // PR #494). Mirrors DataTypeForm's / EnumForm's own Extends field: the
  // displayed name comes straight off `d.superFunction`'s ref text
  // (resolution-independent), while `parentValue`/`parentOptions` drive the
  // editable selector.

  const handleParentSelect = useCallback(
    (value: string | null) => {
      const label = value ? (availableTypes.find((o) => o.value === value)?.label ?? '') : '';
      // Mirror the selection into AST-canonical `superFunction.$refText` so
      // the form stays consistent until the external graph push round-trips
      // back through `useExternalSync`.
      form.setValue('superFunction.$refText' as never, label as never, { shouldDirty: true });
      actions.setFunctionParent(nodeId, value);
    },
    [nodeId, actions, availableTypes, form]
  );

  const superFunctionName = getRefText(d.superFunction);
  // Exclude by canonical node id, not bare name — two functions in
  // different namespaces may legitimately share a name, and only the
  // node ITSELF should be excluded from its own parent options (Codex
  // review, PR #494).
  const parentOptions = availableTypes.filter((opt) => opt.kind === 'func' && opt.value !== nodeId);
  // Resolve against `parentOptions` (func-kind, self-excluded), NOT the
  // unfiltered `availableTypes` — a bare `superFunctionName` is only
  // guaranteed unique among candidates a Function may actually extend.
  // Matching against every kind risked a same-named Data/Enum/etc. option
  // earlier in `availableTypes` winning over the real function (Codex
  // review, PR #494). See `resolveRefTextToOptionValue`'s doc comment for
  // why a bare-label match alone would also fail to resolve a qualified
  // cross-namespace parent.
  const parentValue = resolveRefTextToOptionValue(superFunctionName, parentOptions);

  // ---- Input param helpers -------------------------------------------------

  // Derive the read-only display projection for useExpressionAutocomplete.
  // This keeps the autocomplete hook working correctly even though we now
  // drive visual rendering from `fields` (the RHF field array).
  const inputParams = (d.inputs ?? []).map((p: any) => ({
    name: p.name ?? '',
    typeName: getTypeRefText(p.typeCall)
  }));

  // Autocomplete hook (available for future autocompletion popup integration)
  const { getCompletions: _getCompletions } = useExpressionAutocomplete(availableTypes, inputParams);

  // Build an AST-shaped Attribute literal for `useFieldArray.append`. Same
  // shape as DataTypeForm.makeAttributeAstItem — function inputs and data
  // attributes share the `Attribute` AST schema.
  const makeInputAstItem = useCallback(
    (name: string, typeName: string, cardinality = '(1..1)', override = false) =>
      createAttributeDraft(name, typeName, parseCardinality(cardinality), override),
    []
  );

  // ---- Input param callbacks -----------------------------------------------

  const handleUpdateInput = useCallback(
    (index: number, oldName: string, newName: string, typeName: string, cardinality: string, targetTypeId?: string) => {
      // `index` unused here — action uses name-based diffing (mirrors updateAttribute).
      void index;
      actions.updateInputParam(nodeId, oldName, newName, typeName, cardinality, targetTypeId);
    },
    [nodeId, actions]
  );

  const handleRemoveInputByIndex = useCallback(
    (index: number) => {
      // Resolve the committed name so the store can find the entry by name.
      // If `committedInputs[index]` is missing (e.g. the committed snapshot is
      // behind the field array), the remove is skipped — no fallback is
      // performed because the store uses name-keyed lookup.
      const committedInputs = ((committedRef.current as any).inputs ?? []) as Array<any>;
      const committed = committedInputs[index];
      if (committed) {
        remove(index);
        actions.removeInputParam(nodeId, committed.name);
      }
    },
    [nodeId, actions, remove]
  );

  const handleReorderInput = useCallback(
    (fromIndex: number, toIndex: number) => {
      move(fromIndex, toIndex);
      actions.reorderInputParam(nodeId, fromIndex, toIndex);
    },
    [nodeId, actions, move]
  );

  // ---- Inline add-input state + handler ------------------------------------

  const [addParamName, setAddParamName] = useState('');
  const [addParamType, setAddParamType] = useState('');

  const handleAddInput = useCallback(() => {
    const name = addParamName.trim();
    if (!name) return;
    const typeName = addParamType
      ? (availableTypes.find((o) => o.value === addParamType)?.label ?? addParamType)
      : 'string';
    // Update both form state (field array) and the graph store — mirrors
    // DataTypeForm.handleAddAttribute which calls both append() and
    // actions.addAttribute().
    append(makeInputAstItem(name, typeName));
    actions.addInputParam(nodeId, name, typeName);
    setAddParamName('');
    setAddParamType('');
  }, [nodeId, actions, availableTypes, addParamName, addParamType, append, makeInputAstItem]);

  // ---- Render --------------------------------------------------------------
  // Section components (Annotation, Condition, Metadata) are invoked
  // declaratively here — no callback props. They derive their actions
  // from <EditorActionsProvider> via `useEditorActionsContext()` per the
  // Phase 7 / US5 contract.

  const sourceReadOnly = Boolean(readOnlyProp || nodeMeta.isReadOnly);
  const isReadOnly = sourceReadOnly || structuralEditsDisabled;

  const inheritedRows = inheritedGroups.flatMap((group) =>
    group.members.map((member) => {
      const node = member as { name?: string };
      return {
        id: `inherited:${group.ancestorName}:${node.name ?? ''}`,
        name: node.name ?? '',
        source: 'inherited' as const,
        isOverride: false,
        rawMember: member
      };
    })
  );
  const targets = useInspectorTargets({
    nodeId,
    root: data,
    fields,
    collection: 'inputs',
    effective: inheritedRows,
    actions,
    scopeKey,
    parseEpoch,
    readOnly: isReadOnly,
    output: true
  });

  return (
    <EditorActionsProvider
      nodeId={nodeId}
      actions={actions}
      allNodes={allNodes}
      sourceCommentsOnly
      synonymSourceOptions={synonymSourceOptions}
      readOnly={isReadOnly}
      renderExpressionEditor={renderExpressionEditor}
      showPostConditionToggle
    >
      <FormProvider
        {...form}
        canonicalType="RosettaFunction"
        schema={RosettaFunctionSchema}
        registerCommitFlush={lifecycle.register}
        additionalCommitFlush={debouncedName.flush}
      >
        <div data-slot="function-form" className="h-full min-h-0 p-4">
          <MetadataTargetProvider value={targets.rootBinding}>
            <InspectorFrame
              header={
                <>
                  {structuralEditsDisabled && (
                    <p role="status" className="text-xs text-muted-foreground">
                      Signature editing waits for the current Rune draft to parse.
                    </p>
                  )}
                  <fieldset disabled={structuralEditsDisabled} className="contents">
                    <TypeHeader
                      kind="func"
                      namespace={nodeMeta.namespace}
                      control={form.control}
                      onNameChange={debouncedName}
                      placeholder="Function name"
                      nameAriaLabel="Function type name"
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
                  </fieldset>
                </>
              }
              inheritance={
                <InspectorInheritanceField
                  value={parentValue}
                  displayName={superFunctionName}
                  options={parentOptions}
                  onSelect={handleParentSelect}
                  placeholder="Select parent function..."
                  allowClear
                  emptyLabel="No parent function"
                  filterKinds={['func']}
                  onNavigateToNode={onNavigateToNode}
                  allNodeIds={allNodeIds}
                  disabled={isReadOnly}
                />
              }
              sections={[
                {
                  id: 'implementation',
                  label: 'Implementation',
                  members: true,
                  content: (
                    <>
                      <fieldset disabled={structuralEditsDisabled} className="contents">
                        {' '}
                        {/* Input Parameters — editable AttributeRow list via useFieldArray,
              mirrors the Members section in DataTypeForm (DRY / R-func-input). */}
                        <FieldSet className="gap-1">
                          <FieldLegend variant="label" className="mb-0 text-muted-foreground">
                            Inputs ({fields.length})
                          </FieldLegend>

                          <FieldGroup className="gap-0.5">
                            {fields.map((field, index) => (
                              <AttributeRow
                                key={field.id}
                                selected={targets.selection.selectedRow?.key === field.id}
                                onSelect={() => targets.selection.select(field.id)}
                                index={index}
                                fieldArrayName="inputs"
                                // Read straight from `data`, NOT `committedRef` — see DataTypeForm's
                                // identical fix; the ref is post-commit-only and can bake a stale
                                // rename anchor into this row's onUpdate closures.
                                committedName={(d.inputs ?? [])[index]?.name ?? ''}
                                availableTypes={availableTypes}
                                onUpdate={handleUpdateInput}
                                onRename={
                                  targets.rootBinding.guarded ? (name) => targets.renameRow(field.id, name) : undefined
                                }
                                onRemove={handleRemoveInputByIndex}
                                onReorder={handleReorderInput}
                                onNavigateToNode={onNavigateToNode}
                                allNodeIds={allNodeIds}
                                disabled={isReadOnly}
                              />
                            ))}

                            {fields.length === 0 && (
                              <p className="text-xs text-muted-foreground italic py-2 text-center">
                                No input parameters defined.
                              </p>
                            )}
                          </FieldGroup>

                          {/* Inline add input — hidden in read-only mode */}
                          {!isReadOnly && (
                            <div className="flex items-center gap-1 mt-1">
                              <Input
                                data-slot="add-param-name"
                                type="text"
                                value={addParamName}
                                onChange={(e) => setAddParamName(e.target.value)}
                                placeholder="Name"
                                className="text-xs h-6 px-1.5 flex-1 min-w-0"
                                aria-label="New input parameter name"
                              />
                              <div className="min-w-0 shrink-0">
                                <TypeReferenceField
                                  value={addParamType || null}
                                  options={availableTypes}
                                  onSelect={(v) => setAddParamType(v ?? '')}
                                  placeholder="Type..."
                                  emptyLabel="Type"
                                  onNavigateToNode={onNavigateToNode}
                                  allNodeIds={allNodeIds}
                                />
                              </div>
                              {/* Icon-only add button matches FormPreviewPanel; see
                  DataTypeForm for the rationale. */}
                              <Button
                                data-slot="add-input-btn"
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                onClick={handleAddInput}
                                aria-label="Add input"
                                title="Add input"
                                className="shrink-0"
                              >
                                <Plus className="size-3" />
                              </Button>
                            </div>
                          )}
                        </FieldSet>
                        {/* Output Type */}
                        <FieldSet
                          className="gap-1.5"
                          onFocusCapture={() => targets.selection.select('$output')}
                          onClick={() => targets.selection.select('$output')}
                        >
                          <FieldLegend variant="label" className="mb-0 text-muted-foreground">
                            Output Type
                          </FieldLegend>
                          <TypeReferenceField
                            value={outputValue}
                            displayName={outputType}
                            options={availableTypes}
                            onSelect={handleOutputTypeSelect}
                            placeholder="Select output type..."
                            emptyLabel="No output type"
                            onNavigateToNode={onNavigateToNode}
                            allNodeIds={allNodeIds}
                            disabled={isReadOnly}
                          />
                        </FieldSet>
                        {/* Function Body — aliases + operations, each with its own
              expression editor (R10 / FR-010 — bespoke UX preserved). */}
                        <InheritedMembersSection
                          groups={inheritedGroups}
                          onSelectMember={(ancestor, name) => targets.selection.select(`inherited:${ancestor}:${name}`)}
                          selectedKey={targets.selection.selectedRow?.key}
                        />
                      </fieldset>{' '}
                      {renderFunctionBodyEditor ? (
                        renderFunctionBodyEditor({ nodeId, readOnly: sourceReadOnly })
                      ) : (
                        <>
                          <FieldSet className="gap-2">
                            <FieldLegend variant="label" className="mb-0 text-muted-foreground">
                              Function Body
                            </FieldLegend>

                            {/* Aliases (shortcuts) — always non-editable derived content,
                regardless of isReadOnly (mirrors the pre-existing Textarea
                fallback's hardcoded `readOnly`). renderExpressionEditor's
                rich editor has no readOnly awareness of its own; calling
                it unconditionally let users type inside a fully-
                interactive-looking ExpressionBuilder whose changes
                silently never persist (Codex review, PR #494). */}
                            {(d.shortcuts ?? []).map((shortcut: any, i: number) => {
                              const aliasText = getCstText(shortcut.expression);
                              return (
                                <div key={getKey(shortcut)} data-slot="alias-section" className="flex flex-col gap-1">
                                  <span className="text-xs font-medium text-muted-foreground">
                                    alias {shortcut.name ?? `#${i}`}
                                  </span>
                                  <pre className="studio-scroll text-xs font-mono bg-muted/30 rounded p-2 whitespace-pre-wrap overflow-auto max-h-40">
                                    {aliasText || '(empty)'}
                                  </pre>
                                </div>
                              );
                            })}

                            {(d.operations ?? []).map((op: DehydratedNode, index: number) => (
                              <OperationExpressionEditor
                                key={index}
                                nodeId={nodeId}
                                operation={op}
                                index={index}
                                actions={actions}
                                readOnly={isReadOnly}
                                renderExpressionEditor={renderExpressionEditor}
                              />
                            ))}

                            {/* Empty state — no operations yet */}
                            {(d.operations ?? []).length === 0 && (d.shortcuts ?? []).length === 0 && (
                              <Controller
                                control={form.control}
                                name={'expressionText' as never}
                                render={({ field, fieldState }) => (
                                  <Field>
                                    {isReadOnly ? (
                                      // Read-only (including refOnly): render static text, same
                                      // as ConditionSection's own readOnly branch —
                                      // renderExpressionEditor's rich editor has no readOnly
                                      // awareness of its own, so calling it here would let the
                                      // user type into a fully-interactive-looking editor whose
                                      // changes silently never persist (Codex review, PR #494).
                                      <pre className="studio-scroll text-xs font-mono bg-muted/50 rounded p-2 whitespace-pre-wrap overflow-auto max-h-40">
                                        {(field.value as string | undefined) || '(empty)'}
                                      </pre>
                                    ) : renderExpressionEditor ? (
                                      renderExpressionEditor({
                                        value: field.value ?? '',
                                        onChange: (val: string) => {
                                          field.onChange(val);
                                          if (expressionError) setExpressionError(null);
                                        },
                                        onBlur: () => {
                                          field.onBlur();
                                          handleExpressionBlur();
                                        },
                                        error: expressionError,
                                        placeholder: 'Enter function expression...'
                                      })
                                    ) : (
                                      <Textarea
                                        {...field}
                                        value={field.value ?? ''}
                                        data-slot="expression-editor"
                                        aria-invalid={fieldState.invalid}
                                        aria-label="Function expression"
                                        onBlur={() => {
                                          field.onBlur();
                                          handleExpressionBlur();
                                        }}
                                        onChange={(e) => {
                                          field.onChange(e);
                                          if (expressionError) setExpressionError(null);
                                        }}
                                        rows={4}
                                        className={`text-sm font-mono resize-y ${expressionError ? 'border-destructive' : ''}`}
                                        placeholder="Enter function expression..."
                                      />
                                    )}
                                    {expressionError && (
                                      <p data-slot="expression-error" className="text-xs text-destructive mt-0.5">
                                        {expressionError}
                                      </p>
                                    )}
                                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                  </Field>
                                )}
                              />
                            )}
                          </FieldSet>

                          {/* Configured sections share form state and host actions. */}
                        </>
                      )}
                    </>
                  )
                },
                ...(!renderFunctionBodyEditor
                  ? [
                      {
                        id: 'conditions',
                        label: 'Conditions',
                        content: <EditorSections names={['ConditionSection']} />
                      }
                    ]
                  : []),
                { id: 'doc', label: 'Doc', content: <EditorSections names={['MetadataSection']} /> },
                { id: 'meta', label: 'Meta', content: <EditorSections names={['AnnotationSection']} /> }
              ]}
              details={<InspectorMetadataDetails targets={targets} />}
              footer={<InspectorFooter errors={nodeMeta.errors} status={saveStatus} />}
            />
          </MetadataTargetProvider>
        </div>
      </FormProvider>
    </EditorActionsProvider>
  );
}

export { FunctionForm };
