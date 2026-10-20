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
  type ReactElement
} from 'react';
import {
  expandPreviewField,
  type FormPreviewSchema,
  type PreviewField,
  type PreviewSourceMapEntry
} from '@rune-langium/codegen/export';

import { TemporalPreviewInput, TEMPORAL_INPUT_HELP } from './TemporalPreviewInput.js';
import { qualifiedNameFromNodeId } from '@rune-langium/visual-editor';
import { Button } from '@rune-langium/design-system/ui/button';
import { Checkbox } from '@rune-langium/design-system/ui/checkbox';
import { Input } from '@rune-langium/design-system/ui/input';
import { FieldSet, FieldLegend } from '@rune-langium/design-system/ui/field';
import { RadioGroup, RadioGroupItem } from '@rune-langium/design-system/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@rune-langium/design-system/ui/select';
import { Spinner } from '@rune-langium/design-system/ui/spinner';
import { Plus, Minus } from 'lucide-react';
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

export interface PreviewPresentation {
  mode: 'scratch' | 'instance';
  showPayload: boolean;
  showHeader: boolean;
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
  onCreateInstance?: (seed: InstanceSeed) => void;
}

export const FormPreviewPanel = withInstrumentation(
  function FormPreviewPanel({
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
    onCreateInstance
  }: FormPreviewPanelProps): ReactElement {
    const isControlled = values !== undefined;
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

    const handleFieldBlur = useCallback(() => {
      if (isControlled || !schema || !activeSample || schema.kind === 'function') return;
      applyValidation(activeSample.values, true);
    }, [activeSample, applyValidation, isControlled, schema]);

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
          aria-label="Form preview"
          data-testid="panel-formPreview"
          className="studio-scroll flex h-full flex-col overflow-auto p-3 mr-[0px]"
        >
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
        aria-label="Form preview"
        data-testid="panel-formPreview"
        className="studio-scroll flex h-full flex-col overflow-auto"
      >
        {presentation.showHeader ? (
          <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
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
                  Create instance…
                </Button>
              ) : null}
            </div>
          </header>
        ) : null}
        <p
          role={status.state === 'invalid' ? 'alert' : 'status'}
          aria-live="polite"
          className="px-3 pt-2 text-xs text-muted-foreground"
        >
          {summaryMessage}
        </p>
        {activeSample?.validated && activeSample.errors[''] ? (
          <p role="alert" className="px-3 pt-1 text-xs text-destructive">
            {activeSample.errors['']}
          </p>
        ) : null}
        <PreviewDefinitions value={schema.definitions}>
          <form className="preview-panel__body studio-scroll space-y-3 overflow-auto p-3">
            {schema.kind === 'choice' ? (
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
            ) : (
              <>
                {rootArmFields.length > 0 ? (
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
                ) : null}
                {rootOtherFields.map((field) => (
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
                ))}
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
            {schema.kind === 'function' ? (
              <div className="preview-panel__function-controls border-t border-border pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={executionState === 'running'}
                  onClick={handleRun}
                >
                  {executionState === 'running' ? 'Executing…' : 'Run'}
                </Button>
                {executionError ? (
                  <div className="execution-error mt-2 text-xs">
                    <span className="text-xs font-medium text-destructive">Error:</span>{' '}
                    <span className="text-xs text-destructive">{presentPreviewError(executionError, schema)}</span>
                  </div>
                ) : null}
                {executionResult !== undefined ? (
                  <div className="execution-result mt-2">
                    <span className="text-2xs font-medium text-muted-foreground">Output:</span>
                    <pre className="preview-panel__sample-output studio-scroll mt-0.5 overflow-auto p-2 text-2xs leading-5 text-foreground">
                      {JSON.stringify(executionResult, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : null}
            {presentation.showPayload ? (
              <details className="preview-panel__sample" data-testid="sample-data-view" open>
                <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-foreground">Sample data</summary>
                <div className="space-y-2 border-t border-border p-2">
                  <pre
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
              </details>
            ) : null}
          </form>
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
// `ChoiceFieldGroup`'s single-selection radio UI instead of as ordinary
// always-present fields. Imported from preview-validator.ts, which also
// needs it (and the choice-aware default-value builders below) to keep
// `usePreviewStore`'s sample seeding/reconciliation in agreement with this
// component's rendering on which fields are mutually-exclusive arms — see
// that module for the shared implementation (Codex review round 2 on PR
// #444: a second, Choice-unaware copy of this default-seeding logic in
// preview-store.ts let the real app's store-seeded initial sample disagree
// with what this component would have seeded).

// ---------------------------------------------------------------------------
// ChoiceFieldGroup — renders choice schemas as a radio group
// ---------------------------------------------------------------------------

interface ChoiceFieldGroupProps {
  fields: PreviewField[];
  sample?: PreviewSampleState;
  lookupFieldSource: (fieldPath: string) => PreviewSourceMapEntry | undefined;
  isResolvingReferences: boolean;
  onFieldBlur: () => void;
  onFieldChange: (fieldPath: string, value: unknown, arrayIndices?: number[], validate?: boolean) => void;
  onArrayAdd: (field: PreviewField, arrayIndices?: number[]) => void;
  onArrayRemove: (field: PreviewField, index: number, arrayIndices?: number[]) => void;
  onObjectToggle: (field: PreviewField, present: boolean, arrayIndices?: number[]) => void;
  onArmSelect: (arms: PreviewField[], selected: PreviewField, arrayIndices?: number[]) => void;
  arrayIndices?: number[];
}

function ChoiceFieldGroup({
  fields,
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
}: ChoiceFieldGroupProps): ReactElement {
  const groupId = useId();
  // Determine which option is currently active by checking which field has a
  // value present in the sample — no fallback to `fields[0]`. Every REAL
  // sample (uncontrolled, via usePreviewStore's Choice-aware
  // receivePreviewResult/ensureSample seeding, or a controlled caller that
  // seeds real defaults) already has the first arm's key present, so this
  // lookup finds a match without needing one. A fallback here would
  // fabricate a visually "selected" radio for a genuinely empty sample —
  // e.g. a freshly created controlled instance whose `values` starts as
  // `{}` before any default is seeded — contradicting the underlying data
  // (Codex review round 2 on PR #444). No arm selected is the honest
  // rendering of that state.
  const activeField = fields.find((f) => {
    const v = getValueAtPath(sample?.values ?? {}, pathToSegments(f.path, arrayIndices));
    return v !== undefined;
  });

  const handleOptionChange = (field: PreviewField) => {
    // Single atomic transformation via onArmSelect — see its definition
    // for why composing this from separate onObjectToggle/onFieldChange/
    // onFieldBlur calls (each re-reading the same not-yet-updated sample)
    // silently discarded all but the last one's effect (issue #434).
    onArmSelect(fields, field, arrayIndices);
  };

  return (
    <FieldSet className="gap-2 p-2">
      <FieldLegend variant="label" className="text-muted-foreground">
        Choose one option
      </FieldLegend>
      <RadioGroup
        value={activeField?.path ?? ''}
        onValueChange={(path) => {
          const field = fields.find((f) => f.path === path);
          if (field) handleOptionChange(field);
        }}
      >
        {fields.map((field) => {
          const radioId = `${groupId}-${field.path}`;
          const isActive = activeField?.path === field.path;
          return (
            <div key={field.path} className="space-y-1">
              <label htmlFor={radioId} className="flex items-center gap-2 text-xs font-medium">
                <RadioGroupItem id={radioId} value={field.path} />
                {field.label}
              </label>
              {isActive && (field.kind === 'object' || field.kind === 'array') && field.children ? (
                <ChoiceArmChildren
                  field={field}
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
              ) : isActive && field.kind !== 'object' && field.kind !== 'array' ? (
                <div className="ml-5 border-l border-border pl-3">
                  <PreviewFieldControl
                    field={field}
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
                    isChoiceArm
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </RadioGroup>
    </FieldSet>
  );
}

interface ChoiceArmChildrenProps {
  field: PreviewField;
  sample?: PreviewSampleState;
  lookupFieldSource: (fieldPath: string) => PreviewSourceMapEntry | undefined;
  isResolvingReferences: boolean;
  onFieldBlur: () => void;
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
  const field = expandPreviewField(inputField, definitions);
  if (field.kind !== 'object' && field.kind !== 'array') return null;
  const choiceArmPaths = field.kind === 'object' ? field.choiceArmPaths : undefined;
  const { armFields, otherFields } = splitChoiceArmFields(field.children ?? [], choiceArmPaths);
  if (armFields.length === 0 && otherFields.length === 0) return null;
  return (
    <div className="ml-5 space-y-1.5 border-l border-border pl-3">
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
      {otherFields.map((child) => (
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
      ))}
    </div>
  );
}

interface PreviewFieldControlProps {
  field: PreviewField;
  sample?: PreviewSampleState;
  lookupFieldSource: (fieldPath: string) => PreviewSourceMapEntry | undefined;
  isResolvingReferences: boolean;
  onFieldBlur: () => void;
  onFieldChange: (fieldPath: string, value: unknown, arrayIndices?: number[], validate?: boolean) => void;
  onArrayAdd: (field: PreviewField, arrayIndices?: number[]) => void;
  onArrayRemove: (field: PreviewField, index: number, arrayIndices?: number[]) => void;
  onObjectToggle: (field: PreviewField, present: boolean, arrayIndices?: number[]) => void;
  onArmSelect: (arms: PreviewField[], selected: PreviewField, arrayIndices?: number[]) => void;
  arrayIndices?: number[];
  isChoiceArm?: boolean;
}

function PreviewFieldControl({
  field: inputField,
  sample,
  lookupFieldSource, // oxlint-disable-line only-used-in-recursion
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
  const field = expandPreviewField(inputField, definitions);
  const fieldPath = formatFieldPath(field.path, arrayIndices);
  const fieldError = sample?.validated ? sample.errors[fieldPath] : undefined;

  if (field.kind === 'object') {
    const value = getValueAtPath(sample?.values ?? {}, pathToSegments(field.path, arrayIndices));
    const isPresent = value !== undefined;
    const renderChildren = field.definitionId ? isPresent : field.required || isPresent;
    const objectLabel = resolvedFieldLabel(field, arrayIndices);
    // A NESTED Data-extends-Choice reference (issue #434) — route its
    // Choice-ancestor-derived arm children through ChoiceFieldGroup's
    // single-selection radio UI, same as the schema-root case above; the
    // Data type's own (non-arm) attributes still render as plain fields.
    const { armFields, otherFields } = splitChoiceArmFields(field.children ?? [], field.choiceArmPaths);
    return (
      <FieldSet data-field-path={fieldPath} tabIndex={-1} className="gap-1.5 p-2">
        <FieldLegend variant="label" className="text-muted-foreground">
          {/* Inline +/- icon button replaces the verbose
              "Add <FieldLabel>" / "Remove <FieldLabel>" text — the
              field label itself already names the section, so the
              button only needs to convey the operation. Icon-only
              buttons keep dense forms readable; aria-label preserves
              the original phrasing for screen readers. The "Section
              omitted from the sample" caption was removed too — the
              empty section (no nested children rendered) is enough
              affordance that the section isn't populated. */}
          <span className="inline-flex items-center gap-1.5">
            {objectLabel}
            {!field.required || (field.definitionId && !isPresent) ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => onObjectToggle(field, !isPresent, arrayIndices)}
                aria-label={isPresent ? `Remove ${objectLabel}` : `Add ${objectLabel}`}
                title={isPresent ? `Remove ${objectLabel}` : `Add ${objectLabel}`}
              >
                {isPresent ? <Minus className="size-3" /> : <Plus className="size-3" />}
              </Button>
            ) : null}
          </span>
        </FieldLegend>
        {renderChildren && armFields.length > 0 ? (
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
        {renderChildren &&
          otherFields.map((child) => (
            <PreviewFieldControl
              key={`${child.path}-${arrayIndices?.join('-') ?? 'root'}`}
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
          ))}
        {fieldError ? <FieldError message={fieldError} /> : null}
      </FieldSet>
    );
  }

  if (field.kind === 'array') {
    const values = getValueAtPath(sample?.values ?? {}, pathToSegments(field.path, arrayIndices));
    const items = Array.isArray(values) ? values : [];
    const arrayError = sample?.validated ? sample.errors[formatFieldPath(field.path, arrayIndices)] : undefined;
    const [child] = field.children ?? [];

    return (
      <FieldSet data-field-path={fieldPath} tabIndex={-1} className="gap-1.5 p-2">
        <FieldLegend variant="label" className="text-muted-foreground">
          {/* Inline + icon button for "add another item to the array",
              same pattern as the optional-object section. aria-label
              preserves the original "Add <Field> item" phrasing for
              screen readers. */}
          <span className="inline-flex items-center gap-1.5">
            {field.label}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => onArrayAdd(field, arrayIndices)}
              aria-label={`Add ${field.label} item`}
              title={`Add ${field.label} item`}
            >
              <Plus className="size-3" />
            </Button>
          </span>
        </FieldLegend>
        {arrayError ? <FieldError message={arrayError} /> : null}
        {child
          ? items.map((_, index) => (
              <div key={`${field.path}-item-${index}`} className="space-y-1 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xs text-muted-foreground inline-flex items-center gap-1.5">
                    {child.label} {index + 1}
                    {/* − icon replaces the verbose "Remove <Field> N"
                        text per the same +/- treatment as the section
                        toggle and the array add. aria-label keeps the
                        full phrasing for screen readers. */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onArrayRemove(field, index, arrayIndices)}
                      aria-label={`Remove ${child.label} ${index + 1}`}
                      title={`Remove ${child.label} ${index + 1}`}
                    >
                      <Minus className="size-3" />
                    </Button>
                  </span>
                </div>
                <PreviewFieldControl
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
                  arrayIndices={[...(arrayIndices ?? []), index]}
                />
              </div>
            ))
          : null}
      </FieldSet>
    );
  }

  if (field.kind === 'enum') {
    const value = getValueAtPath(sample?.values ?? {}, pathToSegments(field.path, arrayIndices));
    const stringValue = typeof value === 'string' && value !== '' ? value : undefined;
    const fieldLabel = resolvedFieldLabel(field, arrayIndices);
    // Select items need non-empty values. Keep the clear option separate from
    // the sample value so an unset optional enum remains absent for Zod.
    const CLEAR_SENTINEL = '__rune_enum_unset__';
    return (
      <div className="block text-xs font-medium">
        <span className="block">{fieldLabel}</span>
        <Select
          value={stringValue}
          onValueChange={(next) => {
            onFieldChange(field.path, next === CLEAR_SENTINEL ? undefined : next, arrayIndices, true);
          }}
        >
          <SelectTrigger size="sm" aria-label={fieldLabel} className="mt-0.5 w-full text-xs">
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
        {fieldError ? <FieldError message={fieldError} /> : null}
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

  const value = getValueAtPath(sample?.values ?? {}, pathToSegments(field.path, arrayIndices));
  const inputType = field.kind === 'number' ? 'number' : 'text';

  if (field.kind === 'boolean') {
    return (
      <label data-field-path={fieldPath} className="flex items-center gap-2 text-xs font-medium">
        <Checkbox
          aria-label={resolvedFieldLabel(field, arrayIndices)}
          checked={Boolean(value)}
          // A checkbox toggle is a discrete commit — onFieldChange commits the
          // new value and the controlled re-render re-validates. Don't also
          // call onFieldBlur() here: it reads the pre-commit closure value
          // (stale) and would validate the old state (Codex/Copilot PR #225).
          onCheckedChange={(checked) => onFieldChange(field.path, checked === true, arrayIndices)}
        />
        <span>{resolvedFieldLabel(field, arrayIndices)}</span>
        {fieldError ? <FieldError message={fieldError} /> : null}
      </label>
    );
  }

  return (
    <label data-field-path={fieldPath} className="block text-xs font-medium">
      <span>{resolvedFieldLabel(field, arrayIndices)}</span>
      {field.format ? (
        <TemporalPreviewInput
          format={field.format}
          label={resolvedFieldLabel(field, arrayIndices)}
          value={typeof value === 'string' ? value : ''}
          onChange={(next) => onFieldChange(field.path, next, arrayIndices)}
          onBlur={onFieldBlur}
        />
      ) : (
        <Input
          aria-label={resolvedFieldLabel(field, arrayIndices)}
          type={inputType}
          value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
          className="mt-0.5 h-7 text-xs"
          onChange={(event) => onFieldChange(field.path, getInputValue(field, event), arrayIndices)}
          onBlur={onFieldBlur}
        />
      )}
      {fieldError ? (
        <FieldError
          message={
            field.format && fieldError.includes('Invalid string:') ? TEMPORAL_INPUT_HELP[field.format] : fieldError
          }
        />
      ) : null}
    </label>
  );
}

function FieldError({ message }: { message: string }): ReactElement {
  return (
    <p role="alert" className="mt-1 text-xs text-destructive">
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
    return 'Ready to run function';
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
  const arrayIndex = arrayIndices && arrayIndices.length > 0 ? arrayIndices[arrayIndices.length - 1] : undefined;
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
