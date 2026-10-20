// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * TypeAliasForm — structured editor form for a TypeAlias node.
 *
 * Phase 5d / US3 of `013-z2f-editor-migration`. Applies the Phase-3
 * z2f template:
 *
 * - `useZodForm(RosettaTypeAliasSchema, …)` drives validation off the
 *   canonical AST schema (per R1). The graph node is passed straight
 *   into `defaultValues` (per R11) — no projection layer.
 * - `useInspectorExternalSync(form, data, (n) => formValuesProjection(n, nodeMeta))`
 *   re-binds pristine field state when the host swaps to a different node
 *   (per R4). The form consumes the AST shape directly; the projection
 *   only threads the typed gap and seeds the UI-only `comments` field.
 * - `<EditorActionsProvider>` wraps the form body so any
 *   declaratively-rendered section components (Phase 7 / US5) can
 *   derive their commit callbacks from `EditorFormActions` + `nodeId`
 *   without prop-drilling.
 * - `useAutoSave(commitFn, 500)` is preserved verbatim per R8 — the
 *   debounced rename action keeps its existing timing semantics.
 *
 * TypeAlias-specific surface:
 *   1. **Header**: editable name + "TypeAlias" badge.
 *   2. **Wrapped type** (the primary affordance): a `<TypeSelector>`
 *      bound to `typeCall.type` of the AST node. The `typeCall.arguments`
 *      path stays hidden (configured in `z2f.config.ts`).
 *
 * @module
 */

import { getEditorFieldSchema } from '../../schemas/editor-field-schema.js';
import { SCHEMA_BY_TYPE } from '../../schemas/schema-by-type.js';
import { useInspectorExternalSync } from '../../hooks/useInspectorExternalSync.js';
import { useCallback } from 'react';
import { useWatch } from 'react-hook-form';
import { Badge } from '@rune-langium/design-system/ui/badge';
import { TypeHeader, INSPECTOR_FORM_HEADER_CLASS, INSPECTOR_FORM_CLASS } from '../TypeHeader.js';
import { InspectorFrame } from './inspector/InspectorFrame.js';
import { InspectorFooter } from './inspector/InspectorFooter.js';
import { useInspectorTargets, type InspectorHostProps } from '../forms/metadata/useInspectorTargets.js';
import { MetadataTargetProvider } from '../forms/metadata/MetadataTargetContext.js';
import { EditorSections } from '../forms/sections/EditorSections.js';
import { InspectorTypeField } from './inspector/InspectorTypeField.js';
import { useInspectorCommitLifecycle } from '../../hooks/editor-commit-lifecycle.js';
import { useAutoSave } from '../../hooks/useAutoSave.js';
import { useLatestRef } from '../../hooks/useLatestRef.js';
import { useZodForm } from '@zod-to-form/react';
import { EditorFormProvider as FormProvider } from '../forms/EditorFormProvider.js';
import { editorOptimization } from '../forms/editor-optimization.js';

import { RosettaTypeAliasSchema } from '../../generated/zod-schemas.js';
import { EditorActionsProvider } from '../forms/sections/EditorActionsContext.js';
import { formValuesProjection } from './identity-projection.js';
import type {
  AnyGraphNode,
  GraphNodeMeta,
  TypeAliasFormActions,
  ExpressionEditorSlotProps,
  NavigateToNodeCallback,
  TypeOption
} from '../../types.js';
import type { ReactNode } from 'react';

const EMPTY_TYPES: TypeOption[] = [];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TypeAliasFormProps extends InspectorHostProps {
  /** Node ID of the TypeAlias being edited. */
  nodeId: string;
  /** Data payload for the selected type alias node (AnyGraphNode with $type='RosettaTypeAlias'). */
  data: AnyGraphNode;
  /** TypeAlias editor form action callbacks. */
  actions: TypeAliasFormActions;
  /** Available type options for the wrapped-type selector. */
  availableTypes?: TypeOption[];
  /** Optional render-prop for a rich expression editor (parity slot — unused for TypeAlias). */
  renderExpressionEditor?: (props: ExpressionEditorSlotProps) => ReactNode;
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

function TypeAliasForm({
  nodeId,
  data,
  actions,
  availableTypes = EMPTY_TYPES,
  onNavigateToNode,
  allNodeIds,
  readOnly: readOnlyProp,
  refOnly,
  meta: nodeMeta,
  scopeKey,
  parseEpoch,
  saveStatus,
  registerCommitFlush
}: TypeAliasFormProps) {
  // ---- Form setup (useZodForm + upstream useExternalSync, R11 / R4) -------
  // Drive validation off the canonical AST schema; pass the graph node
  // straight into `defaultValues` (RosettaTypeAliasSchema is a
  // z.looseObject so any graph-only keys are accepted as extras).

  const { form } = useZodForm(RosettaTypeAliasSchema, {
    optimization: editorOptimization,
    // RosettaTypeAliasSchema is z.looseObject — extra graph-only keys
    // are accepted as extras. `formValuesProjection` covers the typed gap
    // between the AnyGraphNode runtime shape and z2f's parameterised
    // `Partial<output<Schema>>` constraint.
    defaultValues: formValuesProjection<typeof RosettaTypeAliasSchema>(data, nodeMeta),
    mode: 'onChange',
    errorDisplay: 'afterTouched'
  });

  // Re-bind pristine field state when the caller swaps to a different node
  // (object identity is the contract). `keepDirty: true` preserves the
  // pre-migration `keepDirtyValues: true` semantics so in-flight user
  // edits are not stomped by a graph push.
  useInspectorExternalSync(form, data, (n) => formValuesProjection<typeof RosettaTypeAliasSchema>(n, nodeMeta), {
    parseEpoch
  });

  // Track committed (graph-confirmed) data for diffing
  const committedRef = useLatestRef(data);

  // ---- Name auto-save (debounced) ------------------------------------------

  const lifecycle = useInspectorCommitLifecycle(registerCommitFlush);

  const commitName = useCallback(
    (newName: string) => {
      if (!getEditorFieldSchema(SCHEMA_BY_TYPE.RosettaTypeAlias!, 'name')?.safeParse(newName.trim()).success) return;
      if (newName && newName.trim() && newName !== committedRef.current.name) {
        lifecycle.flush();
        actions.renameType(nodeId, newName.trim());
      }
    },
    [nodeId, actions, lifecycle.flush]
  );

  const debouncedName = useAutoSave(commitName, 500);

  // ---- Wrapped-type selector (TypeAlias-specific primary affordance) ------
  //
  // Selecting a type updates the form's `typeCall.type` so subsequent
  // graph commits (and visual snapshot of the form) reflect the new
  // wrapped type. The graph-mutation surface for TypeAlias does not
  // expose a dedicated "set wrapped type" action today — the form-state
  // update is the visible behaviour. A future extension may funnel this
  // through a dedicated action without changing the JSX.

  const handleTypeSelect = useCallback(
    (value: string | null) => {
      const opt = value ? availableTypes.find((o) => o.value === value) : undefined;
      const label = opt?.label ?? '';
      // Qualify the wrapped-type ref with its namespace when it lives in a
      // DIFFERENT namespace than this alias — otherwise `typeAlias A: Price`
      // reparses as the local/ambiguous `Price` instead of the selected
      // `nsB.Price`. Mirrors the cross-namespace inheritance qualify in
      // useModelSourceSync (`${targetNs}.${bare}`). A local/bare type keeps its
      // unqualified name.
      const refText = opt?.namespace && opt.namespace !== nodeMeta.namespace ? `${opt.namespace}.${label}` : label;
      // Update the form's typeCall.type — RHF tolerates the looseObject
      // extras at the nested `type` key.
      form.setValue('typeCall.type' as never, { $refText: refText } as never, { shouldDirty: true });
      // Propagate the wrapped-type change to the graph store so edits
      // reach source (mirrors updateOutputType in FunctionForm).
      actions.updateTypeAliasType(nodeId, refText);
    },
    [availableTypes, form, actions, nodeId, nodeMeta.namespace]
  );

  // ---- Resolve current wrapped-type for display ----------------------------
  //
  // Prefer the live form state so the selector reflects in-flight edits;
  // fall back to the AST node when the form has not yet observed the
  // typeCall path (initial render before any edit).

  const watchedTypeRef = useWatch({
    control: form.control,
    name: 'typeCall.type' as never
  }) as { $refText?: string } | undefined;
  const dataTypeRef = (data as { typeCall?: { type?: { $refText?: string } } }).typeCall?.type?.$refText;
  const currentTypeLabel = watchedTypeRef?.$refText ?? dataTypeRef ?? '';
  const currentTypeValue = currentTypeLabel
    ? (availableTypes.find((opt) => opt.label === currentTypeLabel)?.value ?? null)
    : null;

  // ---- Render --------------------------------------------------------------

  const isReadOnly = Boolean(readOnlyProp || nodeMeta.isReadOnly);

  const targets = useInspectorTargets({
    nodeId,
    root: data,
    fields: [],
    collection: 'attributes',
    actions,
    scopeKey,
    parseEpoch,
    readOnly: isReadOnly
  });

  return (
    <EditorActionsProvider nodeId={nodeId} actions={actions} readOnly={isReadOnly} sourceCommentsOnly>
      <FormProvider
        {...form}
        canonicalType="RosettaTypeAlias"
        schema={RosettaTypeAliasSchema}
        registerCommitFlush={lifecycle.register}
        additionalCommitFlush={debouncedName.flush}
      >
        <div data-slot="type-alias-form" className={INSPECTOR_FORM_CLASS}>
          <MetadataTargetProvider value={targets.rootBinding}>
            <InspectorFrame
              header={
                <TypeHeader
                  kind="typeAlias"
                  namespace={nodeMeta.namespace}
                  control={form.control}
                  onNameChange={debouncedName}
                  placeholder="Type alias name"
                  nameAriaLabel="Type alias name"
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
              }
              sections={[
                {
                  id: 'type',
                  label: 'Type',
                  content: (
                    <>
                      {' '}
                      <InspectorTypeField
                        label="Wrapped type"
                        value={currentTypeValue ?? null}
                        displayName={currentTypeLabel}
                        options={availableTypes}
                        onSelect={handleTypeSelect}
                        placeholder="Select wrapped type..."
                        emptyLabel="No wrapped type"
                        onNavigateToNode={onNavigateToNode}
                        allNodeIds={allNodeIds}
                        disabled={isReadOnly}
                      />
                      <EditorSections names={['MetadataSection']} />
                    </>
                  )
                }
              ]}
              footer={<InspectorFooter errors={nodeMeta.errors} status={saveStatus} />}
            />
          </MetadataTargetProvider>
        </div>
      </FormProvider>
    </EditorActionsProvider>
  );
}

export { TypeAliasForm };
