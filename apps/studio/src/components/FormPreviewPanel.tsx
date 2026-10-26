// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type ReactElement,
  type ReactNode
} from 'react';
import {
  expandPreviewField,
  metadataPreviewField,
  type FormPreviewSchema,
  type PreviewField,
  type PreviewSourceMapEntry
} from '@rune-langium/codegen/export';

import { TemporalPreviewInput, TEMPORAL_INPUT_HELP } from './TemporalPreviewInput.js';
import { FormPresentation, PreviewLayoutGroup, useNumericPresentation } from './FormPresentation.js';
import { PreviewNumberInput } from './PreviewNumberInput.js';
import { qualifiedNameFromNodeId } from '@rune-langium/visual-editor';
import { Button } from '@rune-langium/design-system/ui/button';
import { Checkbox } from '@rune-langium/design-system/ui/checkbox';
import { Input } from '@rune-langium/design-system/ui/input';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Disclosure
} from '@rune-langium/design-system/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@rune-langium/design-system/ui/dialog';
import { PreviewObjectGrid, type PreviewGridColumn, type PreviewGridRow } from './PreviewObjectGrid.js';
import './form-preview.css';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@rune-langium/design-system/ui/select';
import { Spinner } from '@rune-langium/design-system/ui/spinner';
import { Plus, Minus, ArrowUpRight, ArrowLeft, ChevronRight } from 'lucide-react';
import {
  usePreviewStore,
  type FormPreviewTarget,
  type PreviewSampleState,
  type PreviewStatus
} from '../store/preview-store.js';
import { useOutputStore, fmtLine } from '../store/output-store.js';
import {
  buildArmValue,
  buildDefaultObjectValue,
  buildDefaultValue,
  buildDefaultValues,
  resolveArmPaths,
  splitChoiceArmFields
} from '../services/preview-validator.js';
import { withInstrumentation } from '../services/instrumentation/core.js';

const PreviewDefinitions = createContext<FormPreviewSchema['definitions']>(undefined);
interface PreviewDetailEntry {
  field: PreviewField;
  arrayIndices?: number[];
}
const PreviewDetailNavigation = createContext<{
  open(field: PreviewField, arrayIndices: number[] | undefined, origin: HTMLElement): void;
} | null>(null);

export interface PreviewPresentation {
  mode: 'scratch' | 'instance';
  showPayload: boolean;
  showHeader: boolean;
  showLayoutToolbar?: boolean;
  showExecutionControls?: boolean;
  showStatusSummary?: boolean;
  readOnly?: boolean;
}

export type PayloadView =
  | { kind: 'instance'; value: unknown }
  | { kind: 'inputs'; value: Record<string, unknown> }
  | { kind: 'result'; value: unknown };

export interface InstanceSeed {
  typeFqn: string;
  data: Record<string, unknown>;
}

const SCRATCH_PRESENTATION: PreviewPresentation = {
  mode: 'scratch',
  showPayload: true,
  showHeader: true
};

export interface FormPreviewPanelProps {
  ariaLabel?: string;
  schema?: FormPreviewSchema;
  status: PreviewStatus;
  target?: FormPreviewTarget;
  getFieldSource?: (fieldPath: string) => PreviewSourceMapEntry | undefined;
  onExecute?: (funcName: string, inputs: Record<string, unknown>) => void;
  values?: Record<string, unknown>;
  onValuesChange?: (values: Record<string, unknown>) => void;
  /** Controlled-mode only — sourced from the real worker-validated
   *  diagnostics (e.g. InstanceFormPanel reading instance-store.ts's
   *  validationErrors). Ignored in uncontrolled mode, which reads its own
   *  errors/valid/validated from usePreviewStore's samples map instead. */
  errors?: Record<string, string>;
  valid?: boolean;
  validated?: boolean;
  presentation?: PreviewPresentation;
  layoutToolbarStart?: ReactNode;
  layoutEditing?: boolean;
  onLayoutEditingChange?(editing: boolean): void;
  layoutParentPath?: string;
  onCreateInstance?: (seed: InstanceSeed) => void;
}

export const FormPreviewPanel = withInstrumentation(
  function FormPreviewPanel({
    ariaLabel = 'Form preview',
    schema,
    status,
    target: _target,
    getFieldSource,
    onExecute,
    values,
    onValuesChange,
    errors: controlledErrors,
    valid: controlledValid,
    validated: controlledValidated,
    presentation = SCRATCH_PRESENTATION,
    onCreateInstance,
    layoutToolbarStart,
    layoutEditing,
    onLayoutEditingChange,
    layoutParentPath
  }: FormPreviewPanelProps): ReactElement {
    const isControlled = values !== undefined;
    const [detailState, setDetailState] = useState<{ targetId: string; stack: PreviewDetailEntry[] }>({
      targetId: '',
      stack: []
    });
    const detailOrigin = useRef<HTMLElement | null>(null);
    useEffect(() => {
      setDetailState({ targetId: schema?.targetId ?? '', stack: [] });
    }, [schema?.targetId]);
    const ensureSample = usePreviewStore((s) => s.ensureSample);
    const updateSampleValues = usePreviewStore((s) => s.updateSampleValues);
    const dispatchValidate = usePreviewStore((s) => s.dispatchValidate);
    const resetSample = usePreviewStore((s) => s.resetSample);
    const sample = usePreviewStore((s) => (schema ? s.samples.get(schema.targetId) : undefined));
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
    const [executionState, setExecutionState] = useState<'idle' | 'running'>('idle');

    // Namespace-qualified `targetId` (`${namespace}.${name}`), NOT the bare
    // `title` — two different namespaces can declare a func with the same
    // bare name, and `title` alone can't disambiguate which one the worker's
    // executeFunction should actually run.
    const funcName = schema?.kind === 'function' ? schema.targetId : undefined;
    const storeExecResult = usePreviewStore((s) => (funcName ? s.executionResults.get(funcName) : undefined));
    // Remaining lazy-hydration retry attempts for the CURRENTLY selected target
    // (Task 3's hydrationRetriesRemaining, mirrored from
    // HydrationOrchestrator.getRemainingAttempts()). Per-*target* granularity,
    // not per-individual-unresolved-reference-name: a Data type with several
    // simultaneously-unresolved fields shares this one flag, so all of them
    // switch to a "resolving…" state together rather than each independently
    // guessing whether ITS OWN reference is the one being retried.
    const hydrationRetriesRemaining = usePreviewStore((s) =>
      schema ? s.hydrationRetriesRemaining[schema.targetId] : undefined
    );
    const isResolvingReferences = hydrationRetriesRemaining !== undefined && hydrationRetriesRemaining > 0;
    const loggedUnsupportedSchemaRef = useRef<FormPreviewSchema | undefined>(undefined);

    // Seed from any execution result already cached in the store at mount
    // time — e.g. the dock panel was closed (unmounting this component) then
    // reopened while the store still holds a prior run's result. Without this,
    // the sync branch below only reacts to storeExecResult CHANGING, and
    // useState(storeExecResult) below initializes prevStoreExecResult to that
    // same already-current value, so the branch never fires and the cached
    // output stayed hidden until the next execution (Codex review).
    const [executionResult, setExecutionResult] = useState<unknown>(() =>
      storeExecResult && !storeExecResult.error ? storeExecResult.output : undefined
    );
    const [executionError, setExecutionError] = useState<string | null>(() => storeExecResult?.error ?? null);

    // Adjusted during render (React's blessed pattern) rather than in
    // effects, so switching functions or a new execution result lands in the
    // same render instead of flashing the prior function's stale result for
    // one frame first. Order matters: a funcName change takes priority over a
    // same-render storeExecResult change, matching the original two-effects'
    // declaration-order commit sequencing (the funcName effect ran second and
    // so always won when both fired together).
    //
    // Tracked via useState, NOT plain refs: a ref mutation made during render
    // is not rolled back if React discards/retries this render under
    // concurrent rendering, while the accompanying setExecutionState/
    // setExecutionResult/setExecutionError calls ARE rolled back (they never
    // committed) — so a bare `.current = ...` assignment could leave the
    // retry believing the new function/result was already handled and keep
    // displaying the previous function's output indefinitely (Codex review).
    const [prevFuncName, setPrevFuncName] = useState(funcName);
    const [prevStoreExecResult, setPrevStoreExecResult] = useState(storeExecResult);
    if (funcName !== prevFuncName) {
      setExecutionState('idle');
      // Seed from the NEWLY selected function's own cached result, if it has
      // one, rather than unconditionally blanking — otherwise switching to a
      // function that was already executed earlier in this session hides its
      // cached output until it's re-run, and the trailing prevStoreExecResult
      // sync below would mark it "seen" so the branch below never picks it up
      // retroactively either (same root cause as the mount-time case above).
      if (storeExecResult) {
        setExecutionResult(storeExecResult.error ? undefined : storeExecResult.output);
        setExecutionError(storeExecResult.error ?? null);
      } else {
        setExecutionResult(undefined);
        setExecutionError(null);
      }
    } else if (storeExecResult && storeExecResult !== prevStoreExecResult) {
      if (storeExecResult.error) {
        setExecutionError(storeExecResult.error);
      } else {
        setExecutionResult(storeExecResult.output);
      }
      setExecutionState('idle');
    }
    if (funcName !== prevFuncName) setPrevFuncName(funcName);
    if (storeExecResult !== prevStoreExecResult) setPrevStoreExecResult(storeExecResult);

    useEffect(() => {
      if (!schema?.unsupportedFeatures?.length) return;
      // `cyclic-type:` entries are informational only (see
      // summarizeUnsupportedFeatures) — a schema whose ONLY entries are
      // `cyclic-type:` renders every field successfully and must not log a
      // blank "unsupported preview features" warning (Codex PR #459 review,
      // round 3).
      const summary = summarizeUnsupportedFeatures(schema.unsupportedFeatures);
      if (!summary) return;
      if (loggedUnsupportedSchemaRef.current === schema) return;
      loggedUnsupportedSchemaRef.current = schema;
      useOutputStore.getState().addLine(fmtLine('preview', 'unsupported preview features', summary), 'warn', {
        op: 'preview',
        subject: schema.targetId
      });
    }, [schema]);

    const defaultValues = useMemo(() => {
      if (!schema) return {};
      return buildDefaultValues(schema.fields, resolveArmPaths(schema));
    }, [schema]);
    const lookupFieldSource = useCallback(
      (fieldPath: string) =>
        getFieldSource?.(fieldPath) ?? schema?.sourceMap?.find((entry) => entry.fieldPath === fieldPath),
      [getFieldSource, schema]
    );

    useEffect(() => {
      if (isControlled || !schema) return;
      ensureSample(schema.targetId, defaultValues);
    }, [defaultValues, ensureSample, isControlled, schema]);

    const activeSample = useMemo<PreviewSampleState | undefined>(() => {
      if (!schema) return undefined;
      if (isControlled) {
        return {
          targetId: schema.targetId,
          values: values ?? defaultValues,
          serialized: JSON.stringify(values ?? defaultValues, null, 2),
          errors: controlledErrors ?? {},
          valid: controlledValid ?? true,
          validated: controlledValidated ?? false,
          updatedAt: 0
        };
      }
      return (
        sample ?? {
          targetId: schema.targetId,
          values: defaultValues,
          serialized: JSON.stringify(defaultValues, null, 2),
          errors: {},
          valid: true,
          validated: false,
          updatedAt: 0
        }
      );
    }, [controlledErrors, controlledValid, controlledValidated, defaultValues, isControlled, sample, schema, values]);

    const showStatusOnly = !schema || status.state === 'unavailable' || schema.schemaVersion !== 1;

    const applyValidation = useCallback(
      (nextValues: Record<string, unknown>, validated: boolean) => {
        if (!schema) return;
        if (isControlled) {
          // Structural + condition validation already round-trips through
          // the worker via the caller's own onValuesChange handler (e.g.
          // InstanceFormPanel's updateInstanceData → dispatchValidate) —
          // this component only forwards the edit. `validated` is not used
          // here; the errors/valid/validated PROPS (sourced from that real
          // round trip) drive activeSample above instead of a locally
          // computed approximation.
          onValuesChange?.(nextValues);
          return;
        }
        if (schema.kind === 'function') {
          // Run validates function inputs in the worker before execution.
          // instance:validate remains the Data/Choice validation entry point.
          updateSampleValues(schema.targetId, nextValues, false);
          return;
        }
        updateSampleValues(schema.targetId, nextValues, validated);
        if (validated) {
          dispatchValidate(schema.targetId, nextValues);
        }
      },
      [dispatchValidate, isControlled, onValuesChange, schema, updateSampleValues]
    );

    const handleFieldBlur = useCallback(
      (event?: FocusEvent<HTMLElement>) => {
        // Explicitly marked list actions validate their own transaction. Avoid moving their click target
        // with a blur-result error immediately before the button's click is dispatched.
        if (
          event?.relatedTarget instanceof HTMLElement &&
          event.relatedTarget.closest('[data-preview-validates]') &&
          event.currentTarget.closest('.preview-fields')?.contains(event.relatedTarget)
        )
          return;
        // Subsequent edits already validate their latest payload in handleFieldChange.
        if (isControlled || !schema || !activeSample || activeSample.validated || schema.kind === 'function') return;
        applyValidation(activeSample.values, true);
      },
      [activeSample, applyValidation, isControlled, schema]
    );

    const handleFieldChange = useCallback(
      (fieldPath: string, value: unknown, arrayIndices?: number[], validate = false) => {
        if (!schema || !activeSample) return;
        const nextValues = setValueAtPath(
          activeSample.values,
          pathToSegments(fieldPath, arrayIndices),
          value
        ) as Record<string, unknown>;
        applyValidation(nextValues, validate || activeSample.validated);
      },
      [activeSample, applyValidation, schema]
    );

    const handleArrayAdd = useCallback(
      (field: PreviewField, arrayIndices?: number[]) => {
        if (!schema || !activeSample) return;
        const segments = pathToSegments(field.path, arrayIndices);
        const current = getValueAtPath(activeSample.values, segments);
        const items = Array.isArray(current) ? [...current] : [];
        if (field.kind !== 'array') {
          return;
        }
        const [child] = field.children ?? [];
        if (!child) {
          return;
        }
        items.push(buildDefaultValue(child));
        const nextValues = setValueAtPath(activeSample.values, segments, items) as Record<string, unknown>;
        applyValidation(nextValues, true);
      },
      [activeSample, applyValidation, schema]
    );

    const handleArrayRemove = useCallback(
      (field: PreviewField, index: number, arrayIndices?: number[]) => {
        if (!schema || !activeSample) return;
        const segments = pathToSegments(field.path, arrayIndices);
        const current = getValueAtPath(activeSample.values, segments);
        const items = Array.isArray(current) ? [...current] : [];
        items.splice(index, 1);
        const arrayPath = formatFieldPath(field.path, arrayIndices);
        setDetailState((current) => {
          const affected = current.stack.findIndex((entry) => {
            const path = formatFieldPath(entry.field.path, entry.arrayIndices);
            const rest = path.startsWith(`${arrayPath}[`) ? path.slice(arrayPath.length + 1) : '';
            return rest !== '' && Number.parseInt(rest, 10) >= index;
          });
          return affected < 0 ? current : { ...current, stack: current.stack.slice(0, affected) };
        });
        const nextValues = setValueAtPath(activeSample.values, segments, items) as Record<string, unknown>;
        applyValidation(nextValues, true);
      },
      [activeSample, applyValidation, schema]
    );

    const handleObjectToggle = useCallback(
      (field: PreviewField, present: boolean, arrayIndices?: number[]) => {
        if (!schema || !activeSample) return;
        const segments = pathToSegments(field.path, arrayIndices);
        const nextValues = (
          present
            ? setValueAtPath(activeSample.values, segments, buildDefaultObjectValue(field))
            : removeValueAtPath(activeSample.values, segments)
        ) as Record<string, unknown>;
        applyValidation(nextValues, activeSample.validated);
      },
      [activeSample, applyValidation, schema]
    );

    // Selecting a Choice arm (issue #434) must unset every OTHER arm and set
    // the chosen one as a single atomic transformation of activeSample.values.
    // ChoiceFieldGroup previously composed this from separate onObjectToggle/
    // onFieldChange/onFieldBlur calls, each independently re-reading the SAME
    // (unchanged-until-next-render) activeSample.values closure — React 18
    // batches the state updates from all of them into one re-render, so only
    // the LAST call's transformation actually survived, discarding the
    // others (a latent bug, never reachable before this fix since
    // ChoiceFieldGroup was only ever wired to the top-level kind:'choice'
    // case, which this exact multi-arm-removal path never exercised in
    // practice). Folding every arm's removal/selection into one `nextValues`
    // fold, applied in a single applyValidation call, fixes this at the
    // source rather than papering over one call site.
    const handleArmSelect = useCallback(
      (arms: PreviewField[], selected: PreviewField, arrayIndices?: number[]) => {
        if (!schema || !activeSample) return;
        let nextValues = activeSample.values;
        for (const arm of arms) {
          const segments = pathToSegments(arm.path, arrayIndices);
          nextValues = (
            arm.path === selected.path
              ? setValueAtPath(nextValues, segments, buildArmValue(arm))
              : removeValueAtPath(nextValues, segments)
          ) as Record<string, unknown>;
        }
        applyValidation(nextValues, true);
      },
      [activeSample, applyValidation, schema]
    );

    const handleRun = useCallback(() => {
      if (!funcName || !activeSample || !onExecute) return;
      setExecutionState('running');
      setExecutionResult(undefined);
      setExecutionError(null);
      onExecute(funcName, activeSample.values);
    }, [activeSample, funcName, onExecute]);

    const handleReset = useCallback(() => {
      if (!schema) return;
      if (isControlled) {
        // errors/valid/validated are owned by the caller (props, sourced
        // from instance-store.ts's real validationErrors) — no local state
        // to reset here. onValuesChange triggers the real worker round
        // trip, which updates those props once it resolves.
        onValuesChange?.(defaultValues);
      } else {
        resetSample(schema.targetId, defaultValues);
      }
      setCopyFeedback(null);
    }, [defaultValues, isControlled, onValuesChange, resetSample, schema]);

    const handleCopySample = useCallback(async () => {
      if (!activeSample) {
        return;
      }
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        setCopyFeedback('Clipboard access is unavailable in this browser.');
        return;
      }
      try {
        await navigator.clipboard.writeText(activeSample.serialized);
        setCopyFeedback('Sample data copied.');
      } catch (error) {
        console.error('[FormPreviewPanel] Failed to copy sample data:', error);
        useOutputStore
          .getState()
          .addLine(
            fmtLine('preview', 'copy sample data failed', error instanceof Error ? error.message : String(error)),
            'error'
          );
        setCopyFeedback('Copy failed. Check clipboard permissions and try again.');
      }
    }, [activeSample]);

    const summaryMessage = schema ? getSummaryMessage(schema, status, activeSample) : undefined;
    // `cyclic-type:` entries are informational only — a schema whose ONLY
    // unsupportedFeatures entries are `cyclic-type:` rendered every field
    // successfully and must not show a blank "Unsupported preview features:"
    // banner (Codex PR #459 review, round 3).
    const unsupportedSummary = schema?.unsupportedFeatures?.length
      ? summarizeUnsupportedFeatures(schema.unsupportedFeatures)
      : '';

    if (showStatusOnly) {
      const isWaiting = status.state === 'waiting' && status.targetId;
      return (
        <section
          aria-label={ariaLabel}
          data-testid="panel-formPreview"
          className="studio-scroll flex h-full flex-col overflow-auto px-panel-x py-panel-y"
        >
          {layoutToolbarStart}
          {isWaiting ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-3.5 shrink-0" />
              <span role="status" aria-live="polite">
                {getStatusOnlyMessage(schema, status)}
              </span>
            </div>
          ) : (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {getStatusOnlyMessage(schema, status)}
            </p>
          )}
        </section>
      );
    }

    // A Data-extends-Choice (or typeAlias-extends-Choice) schema's own
    // top-level `kind` isn't `'choice'` — schema.choiceArmPaths carries the
    // same "which fields.path values are Choice-ancestor arms" signal that
    // PreviewObjectField.choiceArmPaths carries for a NESTED reference
    // (issue #434). Route those root-level arm fields through
    // ChoiceFieldGroup too, not just the genuine `kind === 'choice'` case.
    const { armFields: rootArmFields, otherFields: rootOtherFields } = splitChoiceArmFields(
      schema.fields,
      schema.choiceArmPaths
    );

    return (
      <section
        role="region"
        aria-label={ariaLabel}
        data-testid="panel-formPreview"
        className="studio-scroll flex h-full flex-col overflow-auto"
      >
        {presentation.showHeader ? (
          <header className="flex items-center justify-between gap-3 border-b border-border px-panel-x py-panel-y">
            <h2 className="truncate text-sm font-semibold">{schema.title}</h2>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button type="button" variant="ghost" size="xs" onClick={handleCopySample}>
                Copy
              </Button>
              <Button type="button" variant="ghost" size="xs" onClick={handleReset}>
                {presentation.mode === 'instance' ? 'Reset values' : 'Reset'}
              </Button>
              {onCreateInstance && (schema.kind === 'data' || schema.kind === 'choice') ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    onCreateInstance({
                      typeFqn: qualifiedNameFromNodeId(schema.targetId),
                      data: structuredClone(activeSample?.values ?? {})
                    })
                  }
                >
                  Create example…
                </Button>
              ) : null}
            </div>
          </header>
        ) : null}
        <PreviewDefinitions value={schema.definitions}>
          <FormPresentation
            toolbarStart={layoutToolbarStart}
            showToolbar={presentation.showLayoutToolbar}
            editing={layoutEditing}
            onEditingChange={onLayoutEditingChange}
          >
            {presentation.showStatusSummary !== false && (
              <p
                role={status.state === 'invalid' ? 'alert' : 'status'}
                aria-live="polite"
                className="px-panel-x pt-panel-y text-xs text-muted-foreground"
              >
                {summaryMessage}
              </p>
            )}
            {activeSample?.validated && activeSample.errors[''] ? (
              <p role="alert" className="px-panel-x pt-panel-y text-xs text-destructive">
                {activeSample.errors['']}
              </p>
            ) : null}

            <PreviewDetailNavigation
              value={{
                open: (field, arrayIndices, origin) => {
                  if (detailState.targetId !== schema.targetId || detailState.stack.length === 0)
                    detailOrigin.current = origin;
                  setDetailState((current) => ({
                    targetId: schema.targetId,
                    stack: [...(current.targetId === schema.targetId ? current.stack : []), { field, arrayIndices }]
                  }));
                }
              }}
            >
              <form
                onSubmit={(event) => event.preventDefault()}
                className="preview-fields preview-panel__body studio-scroll space-y-3 overflow-auto px-panel-x py-panel-y"
              >
                {schema.kind === 'choice' ? (
                  <fieldset disabled={presentation.readOnly} className="contents">
                    <ChoiceFieldGroup
                      fields={schema.fields}
                      sample={activeSample}
                      lookupFieldSource={lookupFieldSource}
                      isResolvingReferences={isResolvingReferences}
                      onFieldBlur={handleFieldBlur}
                      onFieldChange={handleFieldChange}
                      onArrayAdd={handleArrayAdd}
                      onArrayRemove={handleArrayRemove}
                      onObjectToggle={handleObjectToggle}
                      onArmSelect={handleArmSelect}
                    />
                  </fieldset>
                ) : (
                  <>
                    {rootArmFields.length > 0 ? (
                      <fieldset disabled={presentation.readOnly} className="contents">
                        <ChoiceFieldGroup
                          fields={rootArmFields}
                          sample={activeSample}
                          lookupFieldSource={lookupFieldSource}
                          isResolvingReferences={isResolvingReferences}
                          onFieldBlur={handleFieldBlur}
                          onFieldChange={handleFieldChange}
                          onArrayAdd={handleArrayAdd}
                          onArrayRemove={handleArrayRemove}
                          onObjectToggle={handleObjectToggle}
                          onArmSelect={handleArmSelect}
                        />
                      </fieldset>
                    ) : null}
                    <PreviewLayoutGroup
                      symbol={`${schema.kind ?? 'data'}:${qualifiedNameFromNodeId(schema.targetId)}`}
                      parentPath={layoutParentPath}
                      fields={rootOtherFields}
                      renderField={(field) => (
                        <fieldset disabled={presentation.readOnly} className="contents">
                          <PreviewFieldControl
                            key={field.path}
                            field={field}
                            sample={activeSample}
                            lookupFieldSource={lookupFieldSource}
                            isResolvingReferences={isResolvingReferences}
                            onFieldBlur={handleFieldBlur}
                            onFieldChange={handleFieldChange}
                            onArrayAdd={handleArrayAdd}
                            onArrayRemove={handleArrayRemove}
                            onObjectToggle={handleObjectToggle}
                            onArmSelect={handleArmSelect}
                          />
                        </fieldset>
                      )}
                    />
                  </>
                )}
                {isResolvingReferences || unsupportedSummary ? (
                  isResolvingReferences ? (
                    <div role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Spinner className="size-3 shrink-0" />
                      <span>
                        Resolving reference… ({hydrationRetriesRemaining}{' '}
                        {hydrationRetriesRemaining === 1 ? 'retry' : 'retries'} left)
                      </span>
                    </div>
                  ) : (
                    <div role="status" className="text-xs text-muted-foreground">
                      Unsupported preview features: {unsupportedSummary}
                    </div>
                  )
                ) : null}
                {schema.kind === 'function' && presentation.showExecutionControls !== false ? (
                  <div className="preview-panel__function-controls border-t border-border pt-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={executionState === 'running' || !!schema.executionUnavailable}
                      onClick={handleRun}
                    >
                      {executionState === 'running' ? 'Executing…' : 'Run'}
                    </Button>
                    {schema.executionUnavailable ? (
                      <p role="status" className="text-xs text-muted-foreground">
                        {schema.executionUnavailable}
                      </p>
                    ) : null}
                    {executionError ? (
                      <div className="execution-error mt-2 text-xs">
                        <span className="text-xs font-medium text-destructive">Error:</span>{' '}
                        <span className="text-xs text-destructive">{presentPreviewError(executionError, schema)}</span>
                      </div>
                    ) : null}
                    {executionResult !== undefined ? (
                      <div className="execution-result mt-2">
                        <span className="text-2xs font-medium text-muted-foreground">Output:</span>
                        <pre
                          tabIndex={0}
                          className="preview-panel__sample-output studio-scroll mt-0.5 overflow-auto p-2 text-2xs leading-5 text-foreground"
                        >
                          {JSON.stringify(executionResult, null, 2)}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {presentation.showPayload ? (
                  <Disclosure label="Sample data" className="preview-panel__sample" data-testid="sample-data-view" open>
                    <div className="space-y-2 border-t border-border p-2">
                      <pre
                        tabIndex={0}
                        aria-label="Sample data output"
                        className="preview-panel__sample-output studio-scroll max-h-56 overflow-auto p-2 text-2xs leading-5 text-foreground"
                        data-testid="sample-data-output"
                      >
                        {activeSample?.serialized ?? '{}'}
                      </pre>
                      <p role="status" aria-live="polite" className="text-2xs text-muted-foreground">
                        {copyFeedback ?? 'Sample data stays in-memory until you explicitly copy it.'}
                      </p>
                    </div>
                  </Disclosure>
                ) : null}
              </form>
              <PreviewDetailsDialog
                stack={detailState.targetId === schema.targetId ? detailState.stack : []}
                returnFocus={detailOrigin}
                onClose={() => setDetailState({ targetId: schema.targetId, stack: [] })}
                onBack={(index) =>
                  setDetailState((current) => ({ ...current, stack: current.stack.slice(0, index + 1) }))
                }
                controls={{
                  sample: activeSample,
                  lookupFieldSource,
                  isResolvingReferences,
                  onFieldBlur: handleFieldBlur,
                  onFieldChange: handleFieldChange,
                  onArrayAdd: handleArrayAdd,
                  onArrayRemove: handleArrayRemove,
                  onObjectToggle: handleObjectToggle,
                  onArmSelect: handleArmSelect
                }}
              />
            </PreviewDetailNavigation>
          </FormPresentation>
        </PreviewDefinitions>
      </section>
    );
  },
  { op: 'FormPreviewPanel' }
);

// splitChoiceArmFields (issue #434) — used at both the schema-root level (a
// Data-extends-Choice schema whose own top-level `kind` isn't `'choice'`)
// and inside `PreviewFieldControl`'s object-field branch (a NESTED
// Data-extends-Choice reference) so arm fields render through
// `ChoiceFieldGroup`'s single-selection dropdown instead of as ordinary
// always-present fields. Imported from preview-validator.ts, which also
// needs it (and the choice-aware default-value builders below) to keep
// `usePreviewStore`'s sample seeding/reconciliation in agreement with this
// component's rendering on which fields are mutually-exclusive arms — see
// that module for the shared implementation (Codex review round 2 on PR
// #444: a second, Choice-unaware copy of this default-seeding logic in
// preview-store.ts let the real app's store-seeded initial sample disagree
// with what this component would have seeded).

// ---------------------------------------------------------------------------
// ChoiceFieldGroup — renders choice schemas as a dropdown
// ---------------------------------------------------------------------------

interface ChoiceFieldGroupProps {
  fields: PreviewField[];
  label?: string;
  sample?: PreviewSampleState;
  lookupFieldSource: (fieldPath: string) => PreviewSourceMapEntry | undefined;
  isResolvingReferences: boolean;
  onFieldBlur: (event?: FocusEvent<HTMLElement>) => void;
  onFieldChange: (fieldPath: string, value: unknown, arrayIndices?: number[], validate?: boolean) => void;
  onArrayAdd: (field: PreviewField, arrayIndices?: number[]) => void;
  onArrayRemove: (field: PreviewField, index: number, arrayIndices?: number[]) => void;
  onObjectToggle: (field: PreviewField, present: boolean, arrayIndices?: number[]) => void;
  onArmSelect: (arms: PreviewField[], selected: PreviewField, arrayIndices?: number[]) => void;
  arrayIndices?: number[];
}

function ChoiceFieldGroup({ fields, label = 'Choose one option', ...controls }: ChoiceFieldGroupProps): ReactElement {
  const id = useId();
  const details = useContext(PreviewDetailNavigation);
  const activeField = fields.find(
    (field) =>
      getValueAtPath(controls.sample?.values ?? {}, pathToSegments(field.path, controls.arrayIndices)) !== undefined
  );
  return (
    <div className="preview-choice">
      <span id={id} className="preview-field__label">
        {label}
      </span>
      <div className="preview-choice__selector">
        <Select
          value={activeField?.path ?? null}
          onValueChange={(path) => {
            const field = fields.find((candidate) => candidate.path === path);
            if (field && field.path !== activeField?.path) controls.onArmSelect(fields, field, controls.arrayIndices);
          }}
        >
          <SelectTrigger aria-labelledby={id} className="w-full">
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            {fields.map((field) => (
              <SelectItem key={field.path} value={field.path}>
                {field.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activeField && (activeField.kind === 'object' || activeField.kind === 'array') && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Open ${activeField.label} details`}
            onClick={(event) => details?.open(activeField, controls.arrayIndices, event.currentTarget)}
          >
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
      {activeField ? (
        activeField.kind === 'object' ? (
          <ChoiceArmChildren field={activeField} {...controls} />
        ) : (
          <PreviewFieldControl field={activeField} {...controls} isChoiceArm />
        )
      ) : null}
    </div>
  );
}

interface ChoiceArmChildrenProps {
  field: PreviewField;
  sample?: PreviewSampleState;
  lookupFieldSource: (fieldPath: string) => PreviewSourceMapEntry | undefined;
  isResolvingReferences: boolean;
  onFieldBlur: (event?: FocusEvent<HTMLElement>) => void;
  onFieldChange: (fieldPath: string, value: unknown, arrayIndices?: number[], validate?: boolean) => void;
  onArrayAdd: (field: PreviewField, arrayIndices?: number[]) => void;
  onArrayRemove: (field: PreviewField, index: number, arrayIndices?: number[]) => void;
  onObjectToggle: (field: PreviewField, present: boolean, arrayIndices?: number[]) => void;
  onArmSelect: (arms: PreviewField[], selected: PreviewField, arrayIndices?: number[]) => void;
  arrayIndices?: number[];
}

// Renders an ACTIVE Choice arm's own children (issue #434 round 3) —
// mirrors PreviewFieldControl's object-kind branch below: when the arm's
// Data type itself extends ANOTHER Choice (a doubly-nested Choice, carrying
// its own `field.choiceArmPaths`), those nested arm fields must route
// through a NESTED ChoiceFieldGroup too, not render as flat always-present
// controls alongside the arm's ordinary attributes — the "mutually
// exclusive selection" invariant this whole component exists to enforce,
// one level deeper. The prior code rendered every child directly, letting
// multiple mutually-exclusive nested values be entered simultaneously
// (Codex review round 2 on PR #444).
function ChoiceArmChildren({
  field: inputField,
  sample,
  lookupFieldSource,
  isResolvingReferences,
  onFieldBlur,
  onFieldChange,
  onArrayAdd,
  onArrayRemove,
  onObjectToggle,
  onArmSelect,
  arrayIndices
}: ChoiceArmChildrenProps): ReactElement | null {
  const definitions = useContext(PreviewDefinitions);
  const expandedField = expandPreviewField(inputField, definitions);
  const field = metadataPreviewField(
    expandedField,
    getValueAtPath(sample?.values ?? {}, pathToSegments(expandedField.path, arrayIndices))
  );
  if (field.kind !== 'object' && field.kind !== 'array') return null;
  const choiceArmPaths = field.kind === 'object' ? field.choiceArmPaths : undefined;
  const { armFields, otherFields } = splitChoiceArmFields(field.children ?? [], choiceArmPaths);
  if (armFields.length === 0 && otherFields.length === 0) return null;
  return (
    <PreviewLayoutGroup
      symbol={
        field.typeSymbol ??
        (field.kind === 'object' && field.referencedTypeFqn ? `data:${field.referencedTypeFqn}` : undefined)
      }
      parentPath={field.declaredPath ?? field.path}
      fields={otherFields}
      renderField={(child) => (
        <PreviewFieldControl
          key={child.path}
          field={child}
          sample={sample}
          lookupFieldSource={lookupFieldSource}
          isResolvingReferences={isResolvingReferences}
          onFieldBlur={onFieldBlur}
          onFieldChange={onFieldChange}
          onArrayAdd={onArrayAdd}
          onArrayRemove={onArrayRemove}
          onObjectToggle={onObjectToggle}
          onArmSelect={onArmSelect}
          arrayIndices={arrayIndices}
        />
      )}
    >
      {armFields.length > 0 ? (
        <ChoiceFieldGroup
          fields={armFields}
          sample={sample}
          lookupFieldSource={lookupFieldSource}
          isResolvingReferences={isResolvingReferences}
          onFieldBlur={onFieldBlur}
          onFieldChange={onFieldChange}
          onArrayAdd={onArrayAdd}
          onArrayRemove={onArrayRemove}
          onObjectToggle={onObjectToggle}
          onArmSelect={onArmSelect}
          arrayIndices={arrayIndices}
        />
      ) : null}
    </PreviewLayoutGroup>
  );
}

interface PreviewFieldControlProps {
  field: PreviewField;
  sample?: PreviewSampleState;
  lookupFieldSource: (fieldPath: string) => PreviewSourceMapEntry | undefined;
  isResolvingReferences: boolean;
  onFieldBlur: (event?: FocusEvent<HTMLElement>) => void;
  onFieldChange: (fieldPath: string, value: unknown, arrayIndices?: number[], validate?: boolean) => void;
  onArrayAdd: (field: PreviewField, arrayIndices?: number[]) => void;
  onArrayRemove: (field: PreviewField, index: number, arrayIndices?: number[]) => void;
  onObjectToggle: (field: PreviewField, present: boolean, arrayIndices?: number[]) => void;
  onArmSelect: (arms: PreviewField[], selected: PreviewField, arrayIndices?: number[]) => void;
  arrayIndices?: number[];
  isChoiceArm?: boolean;
}

function PreviewObjectField({
  field,
  ...controls
}: PreviewFieldControlProps & { field: Extract<PreviewField, { kind: 'object' }> }): ReactElement {
  const id = useId();
  const [expanded, setExpanded] = useState(true);
  const details = useContext(PreviewDetailNavigation);
  const fieldPath = formatFieldPath(field.path, controls.arrayIndices);
  const value = getValueAtPath(controls.sample?.values ?? {}, pathToSegments(field.path, controls.arrayIndices));
  const present = value !== undefined;
  const materialized = field.definitionId ? present : field.required || present;
  const label = resolvedFieldLabel(field, controls.arrayIndices);
  const error = controls.sample?.validated ? controls.sample.errors[fieldPath] : undefined;
  return (
    <div role="group" aria-labelledby={id} data-field-path={fieldPath} tabIndex={-1} className="preview-object">
      <Collapsible open={expanded && materialized} onOpenChange={setExpanded}>
        <div className="preview-section-heading">
          <CollapsibleTrigger
            disabled={!materialized}
            render={<button type="button" className="preview-object__disclosure" />}
          >
            <ChevronRight
              className={`size-3.5 shrink-0 transition-transform ${expanded && materialized ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
            <span id={id}>{label}</span>
          </CollapsibleTrigger>
          <div className="flex shrink-0 items-center gap-1">
            {materialized && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Open ${label} details`}
                title={`Open ${label} details`}
                onClick={(event) => details?.open(field, controls.arrayIndices, event.currentTarget)}
              >
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </Button>
            )}
            {(!field.required || (field.definitionId && !present)) && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => {
                  controls.onObjectToggle(field, !present, controls.arrayIndices);
                  setExpanded(!present);
                }}
                aria-label={present ? `Remove ${label}` : `Add ${label}`}
                title={present ? `Remove ${label}` : `Add ${label}`}
              >
                {present ? (
                  <Minus className="size-3" aria-hidden="true" />
                ) : (
                  <Plus className="size-3" aria-hidden="true" />
                )}
              </Button>
            )}
          </div>
        </div>
        {!materialized && <p className="preview-object__summary">Not added</p>}
        {materialized && !expanded && <p className="preview-object__summary">{previewValueText(value)}</p>}
        <CollapsibleContent>
          <ChoiceArmChildren field={field} {...controls} />
        </CollapsibleContent>
      </Collapsible>
      {error && <FieldError message={error} />}
    </div>
  );
}

function previewValueText(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Not set';
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') {
    const count = Object.values(value).filter((child) => child !== undefined && child !== null && child !== '').length;
    return `${count} field${count === 1 ? '' : 's'} set`;
  }
  return String(value);
}

function PreviewArrayField({
  field,
  ...controls
}: PreviewFieldControlProps & { field: Extract<PreviewField, { kind: 'array' }> }): ReactElement {
  const id = useId();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const definitions = useContext(PreviewDefinitions);
  const details = useContext(PreviewDetailNavigation);
  const fieldPath = formatFieldPath(field.path, controls.arrayIndices);
  const value = getValueAtPath(controls.sample?.values ?? {}, pathToSegments(field.path, controls.arrayIndices));
  const items = Array.isArray(value) ? value : [];
  const child = field.children?.[0] && expandPreviewField(field.children[0], definitions);
  const error = controls.sample?.validated ? controls.sample.errors[fieldPath] : undefined;
  const remove = (index: number) => {
    controls.onArrayRemove(field, index, controls.arrayIndices);
    setSelectedIndex((current) =>
      current === index ? null : current !== null && current > index ? current - 1 : current
    );
  };
  const { armFields, otherFields } = splitChoiceArmFields(
    child?.kind === 'object' ? (child.children ?? []) : [],
    child?.kind === 'object' ? child.choiceArmPaths : undefined
  );
  const scalarColumns = otherFields
    .filter((column) => !['object', 'array', 'unknown'].includes(column.kind))
    .slice(0, armFields.length ? 2 : 3);
  const columns: PreviewGridColumn[] = [
    ...(armFields.length ? [{ path: '$choice', label: 'Type' }] : []),
    ...scalarColumns.map((column) => ({ path: column.path, label: column.label }))
  ];
  if (!columns.length) columns.push({ path: '$summary', label: 'Value' });
  const rows: PreviewGridRow[] = child
    ? items.map((_, index) => {
        const indices = [...(controls.arrayIndices ?? []), index];
        const path = formatFieldPath(child.path, indices);
        const activeArm = armFields.find(
          (arm) => getValueAtPath(controls.sample?.values ?? {}, pathToSegments(arm.path, indices)) !== undefined
        );
        const cells = columns.map((column) => {
          const cellPath =
            column.path === '$choice'
              ? formatFieldPath(activeArm?.path ?? child.path, indices)
              : column.path === '$summary'
                ? path
                : formatFieldPath(column.path, indices);
          const cellValue =
            column.path === '$choice'
              ? activeArm?.label
              : getValueAtPath(
                  controls.sample?.values ?? {},
                  pathToSegments(column.path === '$summary' ? child.path : column.path, indices)
                );
          return {
            path: cellPath,
            text: previewValueText(cellValue),
            empty: cellValue === undefined || cellValue === null || cellValue === '',
            error: controls.sample?.validated ? controls.sample.errors[cellPath] : undefined
          };
        });
        return {
          path,
          label: `${field.label} ${index + 1}`,
          cells,
          issues: controls.sample?.validated
            ? Object.keys(controls.sample.errors).filter(
                (key) => key === path || key.startsWith(`${path}.`) || key.startsWith(`${path}[`)
              ).length
            : 0
        };
      })
    : [];
  return (
    <div role="group" aria-labelledby={id} data-field-path={fieldPath} tabIndex={-1} className="preview-collection">
      <div className="preview-section-heading">
        <div className="flex min-w-0 items-baseline gap-2">
          <span id={id} className="preview-field__label">
            {field.label}
          </span>
          <span className="preview-collection__count">
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          data-preview-validates
          onClick={() => controls.onArrayAdd(field, controls.arrayIndices)}
          aria-label={`Add ${field.label} item`}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add
        </Button>
      </div>
      {child?.kind === 'object' ? (
        <PreviewObjectGrid
          label={field.label}
          columns={columns}
          rows={rows}
          selectedIndex={selectedIndex !== null && selectedIndex < items.length ? selectedIndex : null}
          onSelect={setSelectedIndex}
          onOpen={(index, origin) => {
            setSelectedIndex(index);
            details?.open(child, [...(controls.arrayIndices ?? []), index], origin);
          }}
          onRemove={remove}
        />
      ) : child ? (
        <div className="preview-scalar-list">
          {items.map((_, index) => (
            <div className="preview-scalar-list__row" key={`${field.path}-${index}`}>
              <PreviewFieldControl
                field={child}
                {...controls}
                arrayIndices={[...(controls.arrayIndices ?? []), index]}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                data-preview-validates
                onClick={() => remove(index)}
                aria-label={`Remove ${child.label} ${index + 1}`}
                title={`Remove ${child.label} ${index + 1}`}
              >
                <Minus className="size-3" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      {child?.kind !== 'object' && items.length === 0 && <p className="preview-object-grid__empty">No items yet.</p>}
      {error && <FieldError message={error} />}
    </div>
  );
}

function PreviewDetailsDialog({
  stack,
  returnFocus,
  onClose,
  onBack,
  controls
}: {
  stack: PreviewDetailEntry[];
  returnFocus: { current: HTMLElement | null };
  onClose(): void;
  onBack(index: number): void;
  controls: Omit<PreviewFieldControlProps, 'field' | 'arrayIndices' | 'isChoiceArm'>;
}): ReactElement | null {
  const active = stack[stack.length - 1];
  if (!active) return null;
  const title = resolvedFieldLabel(active.field, active.arrayIndices);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="preview-detail-dialog" finalFocus={returnFocus}>
        <DialogHeader className="preview-detail-dialog__header">
          {stack.length > 1 && (
            <nav aria-label="Item detail path" className="preview-detail-dialog__path">
              <Button type="button" variant="ghost" size="xs" onClick={() => onBack(stack.length - 2)}>
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                Back
              </Button>
              {stack.slice(0, -1).map((entry, index) => (
                <Button
                  key={`${entry.field.path}-${index}`}
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => onBack(index)}
                >
                  {resolvedFieldLabel(entry.field, entry.arrayIndices)}
                </Button>
              ))}
            </nav>
          )}
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {formatFieldPath(active.field.path, active.arrayIndices)}
          </DialogDescription>
        </DialogHeader>
        <div className="preview-detail-dialog__body preview-fields studio-scroll">
          {active.field.kind === 'object' ? (
            <ChoiceArmChildren field={active.field} {...controls} arrayIndices={active.arrayIndices} />
          ) : (
            <PreviewFieldControl field={active.field} {...controls} arrayIndices={active.arrayIndices} />
          )}
        </div>
        <footer className="preview-detail-dialog__footer">
          <span>Changes apply as you edit.</span>
          <Button type="button" size="sm" onClick={onClose}>
            Done
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function PreviewFieldControl({
  field: inputField,
  sample,
  lookupFieldSource: lookupDeclaredSource, // oxlint-disable-line only-used-in-recursion
  isResolvingReferences,
  onFieldBlur,
  onFieldChange,
  onArrayAdd,
  onArrayRemove,
  onObjectToggle,
  onArmSelect,
  arrayIndices,
  isChoiceArm = false
}: PreviewFieldControlProps): ReactElement {
  const definitions = useContext(PreviewDefinitions);
  const inputId = useId();
  const expandedField = expandPreviewField(inputField, definitions);
  const field = metadataPreviewField(
    expandedField,
    getValueAtPath(sample?.values ?? {}, pathToSegments(expandedField.path, arrayIndices))
  );
  const numericPresentation = useNumericPresentation(
    field.declaredPath ? { ...field, path: field.declaredPath } : field
  );
  const lookupFieldSource = (path: string) =>
    lookupDeclaredSource(path === field.path ? (field.declaredPath ?? path) : path);
  const fieldPath = formatFieldPath(field.path, arrayIndices);
  const [interaction, setInteraction] = useState<string>();
  const interactionKey = `${sample?.targetId ?? ''}:${fieldPath}`;
  const value = getValueAtPath(sample?.values ?? {}, pathToSegments(field.path, arrayIndices));
  const emptyNumber = field.kind === 'number' && (value === '' || value === undefined || value === null);
  const rawError = sample?.validated ? sample.errors[fieldPath] : undefined;
  const fieldError = emptyNumber && interaction !== interactionKey ? undefined : rawError;
  const numericMessage =
    field.kind === 'number' && fieldError
      ? emptyNumber
        ? `${resolvedFieldLabel(field, arrayIndices)} is required.`
        : typeof value !== 'number' && fieldError.startsWith('Invalid input: expected number')
          ? `Enter a number for ${resolvedFieldLabel(field, arrayIndices)}.`
          : fieldError
      : fieldError;
  const errorId = `${inputId}-error`;
  const validationAttributes = {
    'aria-invalid': fieldError ? true : undefined,
    'aria-describedby': fieldError ? errorId : undefined
  };

  const controls = {
    sample,
    lookupFieldSource,
    isResolvingReferences,
    onFieldBlur,
    onFieldChange,
    onArrayAdd,
    onArrayRemove,
    onObjectToggle: (target: PreviewField, present: boolean, indices?: number[]) =>
      onObjectToggle(
        !present && target.path === field.path ? { ...target, path: inputField.path } : target,
        present,
        indices
      ),
    onArmSelect,
    arrayIndices
  };
  if (field.kind === 'object') return <PreviewObjectField field={field} {...controls} />;
  if (field.kind === 'array') return <PreviewArrayField field={field} {...controls} />;

  if (field.kind === 'enum') {
    const value = getValueAtPath(sample?.values ?? {}, pathToSegments(field.path, arrayIndices));
    const stringValue = typeof value === 'string' && value !== '' ? value : undefined;
    const fieldLabel = resolvedFieldLabel(field, arrayIndices);
    // Select items need non-empty values. Keep the clear option separate from
    // the sample value so an unset optional enum remains absent for Zod.
    const CLEAR_SENTINEL = '__rune_enum_unset__';
    return (
      <div className="preview-field" data-field-path={fieldPath}>
        <span className="preview-field__label">{fieldLabel}</span>
        <Select
          value={stringValue}
          onValueChange={(next) => {
            const clearPath =
              next === CLEAR_SENTINEL && inputField.metadata?.kind === 'field' && !field.required
                ? inputField.path
                : field.path;
            onFieldChange(clearPath, next === CLEAR_SENTINEL ? undefined : next, arrayIndices, true);
          }}
        >
          <SelectTrigger size="sm" aria-label={fieldLabel} className="w-full" {...validationAttributes}>
            <SelectValue placeholder={field.required || isChoiceArm ? undefined : 'Select…'} />
          </SelectTrigger>
          <SelectContent>
            {!field.required && !isChoiceArm ? (
              <SelectItem value={CLEAR_SENTINEL} className="text-xs text-muted-foreground">
                Select…
              </SelectItem>
            ) : null}
            {(field.enumValues ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value} className="text-xs">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {fieldError ? <FieldError id={errorId} message={fieldError} /> : null}
      </div>
    );
  }

  if (field.kind === 'unknown') {
    // While a hydration retry for this target is in flight, suppress the
    // per-field "could not be resolved" diagnostic — the aggregate
    // resolving indicator below already communicates the target-level
    // state, and re-deriving a per-field resolving message here would
    // contradict the "per-target, not per-reference-name" granularity
    // hydrationRetriesRemaining is scoped to (Task 6 design doc §Components #6).
    return (
      <div role="status" className="text-xs text-muted-foreground">
        {isResolvingReferences ? field.label : `${field.label}: ${field.description ?? 'Unsupported field'}`}
      </div>
    );
  }

  if (field.kind === 'boolean') {
    return (
      <div data-field-path={fieldPath} className="preview-boolean">
        <Checkbox
          id={inputId}
          aria-label={resolvedFieldLabel(field, arrayIndices)}
          {...validationAttributes}
          checked={Boolean(value)}
          // A checkbox toggle is a discrete commit — onFieldChange commits the
          // new value and the controlled re-render re-validates. Don't also
          // call onFieldBlur() here: it reads the pre-commit closure value
          // (stale) and would validate the old state (Codex/Copilot PR #225).
          onCheckedChange={(checked) => onFieldChange(field.path, checked === true, arrayIndices)}
        />
        <label htmlFor={inputId} className="preview-field__label">
          {resolvedFieldLabel(field, arrayIndices)}
        </label>
        {fieldError ? <FieldError id={errorId} message={fieldError} /> : null}
      </div>
    );
  }

  return (
    <div data-field-path={fieldPath} className="preview-field">
      <label htmlFor={inputId} className="preview-field__label">
        {resolvedFieldLabel(field, arrayIndices)}
      </label>
      {field.format ? (
        <TemporalPreviewInput
          id={inputId}
          {...validationAttributes}
          format={field.format}
          label={resolvedFieldLabel(field, arrayIndices)}
          value={typeof value === 'string' ? value : ''}
          onChange={(next, validate) =>
            onFieldChange(
              field.path,
              next === '' && !field.required && !isChoiceArm ? undefined : next,
              arrayIndices,
              validate
            )
          }
          onBlur={onFieldBlur}
        />
      ) : field.kind === 'number' ? (
        <PreviewNumberInput
          id={inputId}
          {...validationAttributes}
          aria-label={resolvedFieldLabel(field, arrayIndices)}
          value={value}
          format={numericPresentation}
          aria-required={field.required || undefined}
          placeholder={field.required ? 'Required' : undefined}
          onValueChange={(next) => {
            setInteraction(interactionKey);
            onFieldChange(field.path, next, arrayIndices);
          }}
          onBlur={(event) => {
            setInteraction(interactionKey);
            onFieldBlur(event);
          }}
        />
      ) : (
        <Input
          id={inputId}
          {...validationAttributes}
          aria-label={resolvedFieldLabel(field, arrayIndices)}
          type="text"
          value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
          onChange={(event) => onFieldChange(field.path, getInputValue(field, event), arrayIndices)}
          onBlur={onFieldBlur}
        />
      )}
      {fieldError ? (
        <FieldError
          id={errorId}
          message={
            field.format && fieldError.includes('Invalid string:') ? TEMPORAL_INPUT_HELP[field.format] : numericMessage!
          }
        />
      ) : null}
    </div>
  );
}

function FieldError({ id, message }: { id?: string; message: string }): ReactElement {
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-destructive">
      {message}
    </p>
  );
}

function getStatusOnlyMessage(schema: FormPreviewSchema | undefined, status: PreviewStatus): string {
  if (!schema) {
    if (status.state === 'waiting' && status.targetId) {
      return 'Generating preview for the selected type…';
    }

    if (status.state === 'unavailable') {
      return status.message;
    }

    return 'Select a type from the graph, file tree, or source editor to preview a generated form.';
  }

  return status.state === 'unavailable' ? status.message : 'Preview unavailable.';
}

function summarizeUnsupportedFeatures(features: string[]): string {
  const unresolvedRefs: string[] = [];
  const recursiveRefs: string[] = [];
  const other: string[] = [];

  for (const feature of features) {
    if (feature.startsWith('unresolved-reference:')) {
      unresolvedRefs.push(feature.slice('unresolved-reference:'.length));
    } else if (feature.startsWith('recursive-reference:')) {
      recursiveRefs.push(feature.slice('recursive-reference:'.length));
    } else if (feature.startsWith('cyclic-type:')) {
      // Informational only (packages/codegen/src/preview-schema.ts's
      // FieldContext.cyclicTypes doc comment) — this type participates in
      // a reference cycle somewhere, but THIS occurrence still rendered
      // its real fields; it was never truncated, so it must not be
      // reported alongside `recursive-reference` as "skipped" (Codex PR
      // #459 review, round 2). Any actually-truncated occurrence of the
      // same cycle already carries its own `recursive-reference` entry.
    } else {
      other.push(feature);
    }
  }

  const parts: string[] = [];
  if (unresolvedRefs.length > 0) {
    parts.push(
      `reference${unresolvedRefs.length === 1 ? '' : 's'} could not be resolved: ${unresolvedRefs.join(', ')}`
    );
  }
  if (recursiveRefs.length > 0) {
    parts.push(`recursive reference${recursiveRefs.length === 1 ? '' : 's'} skipped: ${recursiveRefs.join(', ')}`);
  }
  if (other.length > 0) {
    parts.push(other.join(', '));
  }

  return parts.join('; ');
}

function getSummaryMessage(schema: FormPreviewSchema, status: PreviewStatus, sample?: PreviewSampleState): string {
  if (schema.status === 'unsupported') {
    return 'Limited preview — unsupported features are listed below.';
  }

  if (status.state === 'stale') {
    return `Stale preview: ${status.message}`;
  }

  if (schema.kind === 'function') {
    return schema.executionUnavailable ? 'Execution unavailable' : 'Ready to run function';
  }

  if (!sample?.validated) {
    return 'Ready to validate sample';
  }

  if (sample.validationPending) {
    return 'Validating sample';
  }

  if (status.state === 'invalid' || !sample.valid) {
    const count = Object.keys(sample.errors).length;
    return count > 0 ? `Invalid sample (${count} issue${count === 1 ? '' : 's'})` : 'Invalid sample';
  }

  return 'Valid sample';
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function formatSourceLocation(source: PreviewSourceMapEntry): string {
  return `${basenameFromUri(source.sourceUri)}:${source.sourceLine}:${source.sourceChar}`;
}

function basenameFromUri(uri: string): string {
  const normalized = uri.replace(/^file:\/\//, '');
  const segments = normalized.split('/').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1]! : normalized;
}

function resolvedFieldLabel(field: PreviewField, arrayIndices?: number[]): string {
  const arrayIndex =
    field.path.endsWith('[]') && arrayIndices?.length ? arrayIndices[arrayIndices.length - 1] : undefined;
  return arrayIndex === undefined ? field.label : `${field.label} ${arrayIndex + 1}`;
}

function getInputValue(field: PreviewField, event: ChangeEvent<HTMLInputElement>): unknown {
  if (field.kind === 'number') {
    if (event.target.value === '') {
      // '' (not undefined) — matches buildDefaultValue's own "no value
      // yet" representation for a number field; the real generated Zod
      // schema's number preprocessing already normalizes '' and undefined
      // identically. Returning undefined here made a Choice arm's presence
      // check (`value !== undefined`) read a cleared numeric arm as
      // "unselected" mid-edit — unchecking its radio and unmounting the
      // input the user was actively typing into (Codex review round 3 on
      // PR #444).
      return '';
    }
    return Number.isNaN(event.target.valueAsNumber) ? '' : event.target.valueAsNumber;
  }
  return event.target.value;
}

function pathToSegments(path: string, arrayIndices: number[] = []): Array<string | number> {
  const segments: Array<string | number> = [];
  let nextArrayIndex = 0;
  for (const part of path.split('.')) {
    if (part.endsWith('[]')) {
      segments.push(part.slice(0, -2));
      const arrayIndex = arrayIndices[nextArrayIndex];
      nextArrayIndex += 1;
      if (arrayIndex !== undefined) {
        segments.push(arrayIndex);
      }
    } else {
      segments.push(part);
    }
  }
  return segments;
}

function formatFieldPath(path: string, arrayIndices: number[] = []): string {
  let nextArrayIndex = 0;
  return path.replace(/\[\]/g, () => {
    const index = arrayIndices[nextArrayIndex];
    nextArrayIndex += 1;
    return index === undefined ? '[]' : `[${index}]`;
  });
}

function getValueAtPath(value: unknown, segments: Array<string | number>): unknown {
  let current = value;
  for (const segment of segments) {
    if (current == null) return undefined;
    current = (current as Record<string, unknown>)[segment as keyof typeof current];
  }
  return current;
}

function setValueAtPath(value: unknown, segments: Array<string | number>, nextValue: unknown): unknown {
  if (segments.length === 0) return nextValue;
  const [head, ...rest] = segments;
  if (head === undefined) {
    return nextValue;
  }

  if (typeof head === 'number') {
    const array = Array.isArray(value) ? [...value] : [];
    array[head] = setValueAtPath(array[head], rest, nextValue);
    return array;
  }

  const record =
    value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
  record[head] = setValueAtPath(record[head], rest, nextValue);
  return record;
}

function removeValueAtPath(value: unknown, segments: Array<string | number>): unknown {
  if (segments.length === 0) {
    return undefined;
  }
  const [head, ...rest] = segments;
  if (head === undefined) {
    return value;
  }

  if (typeof head === 'number') {
    if (!Array.isArray(value)) return value;
    const next = [...value];
    if (rest.length === 0) {
      next.splice(head, 1);
      return next;
    }
    next[head] = removeValueAtPath(next[head], rest);
    return next;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const record = { ...(value as Record<string, unknown>) };
  if (rest.length === 0) {
    delete record[head];
    return record;
  }
  record[head] = removeValueAtPath(record[head], rest);
  return record;
}

function presentPreviewError(message: string, schema: FormPreviewSchema): string {
  return message
    .split('; ')
    .map((error) => {
      if (!error.includes('Invalid string:')) return error;
      const path = error.slice(0, error.indexOf(':')).replace(/\[\d+\]/g, '[]');
      const find = (fields: PreviewField[]): PreviewField | undefined => {
        for (const input of fields) {
          const field = expandPreviewField(input, schema.definitions);
          if (field.path === path) return field;
          if ((field.kind === 'array' || field.kind === 'object') && path.startsWith(field.path)) {
            const nested = find(field.children ?? []);
            if (nested) return nested;
          }
        }
        return undefined;
      };
      const field = find(schema.fields);
      return field && 'format' in field && field.format
        ? `${error.slice(0, error.indexOf(':'))}: ${TEMPORAL_INPUT_HELP[field.format]}`
        : error;
    })
    .join('; ');
}
