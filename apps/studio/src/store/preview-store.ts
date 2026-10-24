// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { create } from 'zustand';
import { qualifiedNameFromNodeId, type EditorState } from '@rune-langium/visual-editor';
import { expandPreviewField } from '@rune-langium/codegen/export';
import type { FormPreviewSchema, PreviewField, PreviewSourceMapEntry } from '@rune-langium/codegen/export';
import type { ValidationDiagnostic } from '@rune-langium/codegen/instances';
import { useOutputStore, fmtLine } from './output-store.js';
import { useActivityStore } from './activity-store.js';
import { allocateOpId } from '../services/op-log.js';
import { createInstanceValidateMessage } from '../services/codegen-service.js';
import {
  buildArmValue,
  buildDefaultValue,
  buildDefaultValues,
  fieldLeafKey,
  resolveArmPaths,
  splitChoiceArmFields
} from '../services/preview-validator.js';

export interface FormPreviewTarget {
  id: string;
  namespace: string;
  name: string;
  kind: string;
  sourceUri?: string;
  sourceIndex?: number;
  sourceRange?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export type PreviewStaleReason = 'parse-error' | 'generation-error' | 'unsupported-target' | 'no-files';

export type PreviewStatus =
  | { state: 'waiting'; targetId?: string }
  | { state: 'ready'; targetId: string }
  | { state: 'invalid'; targetId: string }
  | { state: 'stale'; targetId?: string; reason: PreviewStaleReason; message: string }
  | { state: 'unavailable'; targetId?: string; reason: PreviewStaleReason; message: string };

export interface PreviewSampleState {
  targetId: string;
  values: Record<string, unknown>;
  serialized: string;
  errors: Record<string, string>;
  valid: boolean;
  validated: boolean;
  validationPending?: boolean;
  updatedAt: number;
}

interface PreviewStoreState {
  targets: FormPreviewTarget[];
  selectedTargetId?: string;
  /** Explicit selection intent, independent of refreshed model/generated data. */
  navigationRequest?: { targetId: string; revision: number };
  selectedTarget?: FormPreviewTarget;
  lastResolvedTarget?: FormPreviewTarget;
  schemas: Map<string, FormPreviewSchema>;
  samples: Map<string, PreviewSampleState>;
  status: PreviewStatus;
  executionResults: Map<string, { output: unknown; error?: string }>;
  /** Remaining lazy-hydration retry attempts per preview targetId, mirrored
   *  from HydrationOrchestrator.getRemainingAttempts() for UI display. */
  hydrationRetriesRemaining: Record<string, number>;
}

interface PreviewStoreActions {
  setAvailableTargets(targets: FormPreviewTarget[], selectionRekey?: EditorState['selectionRekey']): void;
  selectTarget(targetId: string | undefined): void;
  beginPreviewGeneration(targetId: string): void;
  receivePreviewResult(schema: FormPreviewSchema): void;
  receivePreviewStale(input: { targetId?: string; reason: PreviewStaleReason; message: string }): void;
  getFieldSource(targetId: string | undefined, fieldPath: string): PreviewSourceMapEntry | undefined;
  ensureSample(targetId: string, values: Record<string, unknown>): void;
  updateSampleValues(targetId: string, values: Record<string, unknown>, validated: boolean): void;
  dispatchValidate(targetId: string, data: Record<string, unknown>): void;
  receiveValidateResult(requestId: string, diagnostics: ValidationDiagnostic[]): void;
  resetSample(targetId: string, values: Record<string, unknown>): void;
  setSampleValues(targetId: string, values: Record<string, unknown>): void;
  clearSample(targetId: string): void;
  resetPreviewState(): void;
  receiveExecutionResult(funcName: string, output: unknown): void;
  receiveExecutionError(funcName: string, error: string): void;
  clearExecutionResult(funcName: string): void;
  setWorkerRef(worker: Worker | null): void;
  dispatchExecute(funcName: string, inputs: Record<string, unknown>): void;
  setHydrationRetriesRemaining(targetId: string, remaining: number): void;
  clearHydrationRetriesRemaining(targetId: string): void;
}

type PreviewStore = PreviewStoreState & PreviewStoreActions;

const initialState: PreviewStoreState = {
  targets: [],
  selectedTargetId: undefined,
  selectedTarget: undefined,
  lastResolvedTarget: undefined,
  schemas: new Map(),
  samples: new Map(),
  status: { state: 'waiting' },
  executionResults: new Map(),
  hydrationRetriesRemaining: {}
};

let navigationRevision = 0;
let dispatchExecuteCounter = 0;
let _lastExecuteRequestId = '';
let workerRef: Worker | null = null;
const executeSpans = new Map<string, { opId: number; startedAt: number }>();
let dispatchValidateCounter = 0;
const pendingValidateRequests = new Map<string, string>(); // requestId -> targetId
// Tracks the LATEST outstanding validate requestId per targetId so an
// out-of-order response (an older request's result arriving after a newer
// one) can be dropped instead of overwriting fresher diagnostics with stale
// ones — mirrors instance-store.ts's identical latestValidateRequestForInstance.
const latestValidateRequestForTarget = new Map<string, string>();

function serializeSampleValues(values: Record<string, unknown>): string {
  return JSON.stringify(values, null, 2);
}

function reconcileScalarValue(field: PreviewField, current: unknown): unknown {
  switch (field.kind) {
    case 'boolean':
      return typeof current === 'boolean' ? current : false;
    case 'number':
      if (typeof current === 'number') {
        return current;
      }
      if (typeof current === 'string' && current.trim() !== '') {
        const parsed = Number(current);
        return Number.isFinite(parsed) ? parsed : '';
      }
      return '';
    case 'enum':
      return typeof current === 'string' ? current : buildDefaultValue(field);
    case 'unknown':
    case 'string':
      return typeof current === 'string' ? current : '';
    case 'object':
    case 'array':
      return buildDefaultValue(field);
  }
}

function reconcileFieldValue(
  field: PreviewField,
  current: unknown,
  definitions: FormPreviewSchema['definitions']
): unknown {
  switch (field.kind) {
    case 'object': {
      if (current === undefined && (!field.required || field.definitionId)) {
        return undefined;
      }
      const record =
        current && typeof current === 'object' && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
      const expanded = expandPreviewField(field, definitions);
      // Preserve authored data if a response lacks its deferred definition.
      if (expanded.kind !== 'object' || (field.definitionId && expanded === field)) return record;
      return reconcileFieldsObject(expanded.children ?? [], expanded.choiceArmPaths, record, definitions);
    }
    case 'array': {
      const items = Array.isArray(current) ? current : [];
      const [child] = field.children ?? [];
      return child ? items.map((item) => reconcileFieldValue(child, item, definitions)) : [];
    }
    default:
      return reconcileScalarValue(field, current);
  }
}

// Reconciles a field list against `current` values while honoring
// Choice-arm exclusivity (issue #434 round 2): a non-arm field always
// reconciles independently, but at most ONE Choice-ancestor arm survives —
// whichever arm is already present in `current`, or the first arm as a
// fallback that always materializes a real value via `buildArmValue`
// (mirrors `buildDefaultFieldsObject`'s identical "only the selected/first
// arm gets a value" invariant, so a schema refresh never leaves a
// previously-unselected arm's stale default sitting alongside the real
// selection).
function reconcileFieldsObject(
  fields: PreviewField[],
  armPaths: string[] | undefined,
  current: Record<string, unknown>,
  definitions: FormPreviewSchema['definitions']
): Record<string, unknown> {
  const { armFields, otherFields } = splitChoiceArmFields(fields, armPaths);
  const entries: Array<[string, unknown]> = otherFields.map((field) => [
    fieldLeafKey(field.path),
    reconcileFieldValue(field, current[fieldLeafKey(field.path)], definitions)
  ]);
  const selected = armFields.find((arm) => current[fieldLeafKey(arm.path)] !== undefined) ?? armFields[0];
  if (selected) {
    const reconciled = reconcileFieldValue(selected, current[fieldLeafKey(selected.path)], definitions);
    entries.push([fieldLeafKey(selected.path), reconciled === undefined ? buildArmValue(selected) : reconciled]);
  }
  return Object.fromEntries(entries);
}

function reconcileSampleValues(
  fields: PreviewField[],
  armPaths: string[] | undefined,
  values: Record<string, unknown> | undefined,
  definitions: FormPreviewSchema['definitions']
): Record<string, unknown> {
  return reconcileFieldsObject(fields, armPaths, values ?? {}, definitions);
}

function sameSourceRange(left: FormPreviewTarget['sourceRange'], right: FormPreviewTarget['sourceRange']): boolean {
  if (!left || !right) {
    return false;
  }
  return left.start.line === right.start.line && left.start.character === right.start.character;
}

function findRenamedTarget(
  targets: FormPreviewTarget[],
  previousTarget: FormPreviewTarget | undefined
): FormPreviewTarget | undefined {
  if (!previousTarget?.sourceUri) {
    return undefined;
  }
  return targets.find(
    (target) =>
      target.kind === previousTarget.kind &&
      target.sourceUri === previousTarget.sourceUri &&
      ((target.sourceIndex !== undefined &&
        previousTarget.sourceIndex !== undefined &&
        target.sourceIndex === previousTarget.sourceIndex) ||
        sameSourceRange(target.sourceRange, previousTarget.sourceRange))
  );
}

function remapTargetState<T>(map: Map<string, T>, fromTargetId: string, toTargetId: string): Map<string, T> {
  if (fromTargetId === toTargetId || !map.has(fromTargetId)) {
    return map;
  }
  const next = new Map(map);
  const value = next.get(fromTargetId);
  next.delete(fromTargetId);
  if (value !== undefined) {
    next.set(toTargetId, value);
  }
  return next;
}

function mergeTargetIdentity(
  target: FormPreviewTarget | undefined,
  previousTarget: FormPreviewTarget | undefined
): FormPreviewTarget | undefined {
  if (!target) {
    return target;
  }
  if (target.sourceUri || target.sourceIndex !== undefined || target.sourceRange || !previousTarget) {
    return target;
  }
  return {
    ...target,
    sourceUri: previousTarget.sourceUri,
    sourceIndex: previousTarget.sourceIndex,
    sourceRange: previousTarget.sourceRange
  };
}

function retargetStatus(status: PreviewStatus, targetId: string): PreviewStatus {
  switch (status.state) {
    case 'ready':
      return { state: 'ready', targetId };
    case 'invalid':
      return { state: 'invalid', targetId };
    case 'stale':
      return { state: 'stale', targetId, reason: status.reason, message: status.message };
    case 'unavailable':
      return { state: 'unavailable', targetId, reason: status.reason, message: status.message };
    default:
      return { state: 'waiting', targetId };
  }
}

export const usePreviewStore = create<PreviewStore>((set, get) => ({
  ...initialState,

  setAvailableTargets(targets, selectionRekey) {
    const { selectedTargetId, selectedTarget: previousTarget, lastResolvedTarget, status } = get();
    const renameAnchor = previousTarget ?? lastResolvedTarget;
    const selectedTarget = mergeTargetIdentity(
      selectedTargetId ? targets.find((target) => target.id === selectedTargetId) : undefined,
      renameAnchor
    );
    const explicitRename =
      renameAnchor &&
      selectionRekey &&
      (selectionRekey.from === renameAnchor.id || selectionRekey.intermediateIds?.includes(renameAnchor.id))
        ? targets.find((target) => target.id === selectionRekey?.to)
        : undefined;
    const renamedTarget = selectedTarget ? undefined : (explicitRename ?? findRenamedTarget(targets, renameAnchor));

    const previousTargetId = selectedTargetId ?? renameAnchor?.id;

    if (renamedTarget && previousTargetId) {
      const schemas = remapTargetState(get().schemas, previousTargetId, renamedTarget.id);
      const previousSample = get().samples.get(previousTargetId);
      const samples = remapTargetState(get().samples, previousTargetId, renamedTarget.id);
      if (previousSample) {
        samples.set(renamedTarget.id, { ...previousSample, targetId: renamedTarget.id });
      }
      set({
        targets,
        selectedTargetId: renamedTarget.id,
        navigationRequest: undefined,
        selectedTarget: renamedTarget,
        lastResolvedTarget: renamedTarget,
        schemas,
        samples,
        status: retargetStatus(status, renamedTarget.id)
      });
      return;
    }

    if (selectedTargetId && !selectedTarget) {
      const schemas = new Map(get().schemas);
      schemas.delete(selectedTargetId);
      const samples = new Map(get().samples);
      samples.delete(selectedTargetId);
      set({
        targets,
        selectedTargetId: undefined,
        navigationRequest: undefined,
        selectedTarget: undefined,
        lastResolvedTarget: renameAnchor,
        schemas,
        samples,
        status: { state: 'waiting' }
      });
      return;
    }

    set({
      targets,
      selectedTargetId: selectedTarget ? selectedTarget.id : undefined,
      selectedTarget,
      lastResolvedTarget: selectedTarget ?? renameAnchor
    });
  },

  selectTarget(targetId) {
    if (!targetId) {
      set({
        selectedTargetId: undefined,
        navigationRequest: undefined,
        selectedTarget: undefined,
        status: { state: 'waiting' }
      });
      return;
    }
    const previousTarget = get().selectedTarget ?? get().lastResolvedTarget;
    const selectedTarget = mergeTargetIdentity(
      get().targets.find((target) => target.id === targetId),
      previousTarget
    );
    if (!selectedTarget) {
      return;
    }
    set({
      selectedTargetId: selectedTarget.id,
      navigationRequest: { targetId: selectedTarget.id, revision: ++navigationRevision },
      selectedTarget,
      lastResolvedTarget: selectedTarget,
      status: selectedTarget ? { state: 'waiting', targetId } : { state: 'waiting' }
    });
  },

  beginPreviewGeneration(targetId) {
    if (get().selectedTargetId === targetId) set({ status: { state: 'waiting', targetId } });
  },

  receivePreviewResult(schema) {
    const schemas = new Map(get().schemas);
    schemas.set(schema.targetId, schema);
    const existingSample = get().samples.get(schema.targetId);
    const samples = new Map(get().samples);
    // Choice-aware seeding (issue #434 round 2) — this is the REAL app's
    // sample-creation path: CodegenProvider calls receivePreviewResult
    // before FormPreviewPanel ever mounts, so its own ensureSample effect
    // is a no-op here. Must use the SAME armPaths derivation and default
    // builders FormPreviewPanel uses, or the store's initial sample
    // disagrees with what the panel would have seeded (Codex review round
    // 2 on PR #444).
    const armPaths = resolveArmPaths(schema);
    const sampleValues = existingSample
      ? reconcileSampleValues(schema.fields, armPaths, existingSample.values, schema.definitions)
      : buildDefaultValues(schema.fields, armPaths);
    samples.set(schema.targetId, {
      targetId: schema.targetId,
      values: sampleValues,
      serialized: serializeSampleValues(sampleValues),
      errors: {},
      valid: true,
      validated: false,
      updatedAt: Date.now()
    });
    set({
      schemas,
      samples,
      status: { state: 'ready', targetId: schema.targetId }
    });
  },

  receivePreviewStale(input) {
    if (input.targetId && get().selectedTargetId !== input.targetId) {
      return;
    }
    const hasLastGood = input.targetId ? get().schemas.has(input.targetId) : false;
    set({
      status: hasLastGood ? { state: 'stale', ...input } : { state: 'unavailable', ...input }
    });
  },

  getFieldSource(targetId, fieldPath) {
    if (!targetId) return undefined;
    return get()
      .schemas.get(targetId)
      ?.sourceMap?.find((entry) => entry.fieldPath === fieldPath);
  },

  ensureSample(targetId, values) {
    if (get().samples.has(targetId)) {
      return;
    }
    const samples = new Map(get().samples);
    samples.set(targetId, {
      targetId,
      values,
      serialized: serializeSampleValues(values),
      errors: {},
      valid: true,
      validated: false,
      updatedAt: Date.now()
    });
    set({ samples });
  },

  // Edits invalidate previous diagnostics; only the latest worker response
  // can mark the new values as validated.
  updateSampleValues(targetId, values, validated) {
    latestValidateRequestForTarget.delete(targetId);
    const samples = new Map(get().samples);
    samples.set(targetId, {
      targetId,
      values,
      serialized: serializeSampleValues(values),
      errors: {},
      valid: true,
      validated,
      validationPending: validated,
      updatedAt: Date.now()
    });
    const currentStatus = get().status;
    set({
      samples,
      status:
        currentStatus.state === 'stale' || currentStatus.state === 'unavailable'
          ? currentStatus
          : { state: 'ready', targetId }
    });
  },

  dispatchValidate(targetId, data) {
    if (!workerRef) return;
    const worker = workerRef;
    dispatchValidateCounter++;
    const requestId = `validate:${targetId}:${dispatchValidateCounter}`;
    pendingValidateRequests.set(requestId, targetId);
    latestValidateRequestForTarget.set(targetId, requestId);
    worker.postMessage(createInstanceValidateMessage(qualifiedNameFromNodeId(targetId), data, requestId));
  },

  receiveValidateResult(requestId, diagnostics) {
    const targetId = pendingValidateRequests.get(requestId);
    if (!targetId) return;
    pendingValidateRequests.delete(requestId);
    // Drop an out-of-order response: only the LATEST request issued for
    // this target is allowed to write errors/valid.
    if (latestValidateRequestForTarget.get(targetId) !== requestId) return;
    const sample = get().samples.get(targetId);
    if (!sample) return;
    const errors: Record<string, string> = Object.fromEntries(diagnostics.map((d) => [d.path, d.message]));
    const valid = diagnostics.length === 0;
    const samples = new Map(get().samples);
    samples.set(targetId, { ...sample, errors, valid, validationPending: false });
    const currentStatus = get().status;
    const nextStatus: PreviewStatus =
      currentStatus.state === 'stale' || currentStatus.state === 'unavailable'
        ? currentStatus
        : sample.validated && !valid
          ? { state: 'invalid', targetId }
          : { state: 'ready', targetId };
    set({ samples, status: nextStatus });
  },

  resetSample(targetId, values) {
    // Invalidate any validate request still in flight for the PRE-reset
    // values. receiveValidateResult's staleness guard only rejects a
    // response once a NEWER request has been recorded for the target —
    // resetSample doesn't dispatch a new one (unlike updateSampleValues,
    // which is always immediately followed by a fresh dispatchValidate),
    // so without this the old in-flight response would still pass that
    // guard and attach diagnostics computed for the discarded values onto
    // the just-reset defaults.
    latestValidateRequestForTarget.delete(targetId);
    const samples = new Map(get().samples);
    samples.set(targetId, {
      targetId,
      values,
      serialized: serializeSampleValues(values),
      errors: {},
      valid: true,
      validated: false,
      updatedAt: Date.now()
    });
    const currentStatus = get().status;
    set({
      samples,
      status:
        currentStatus.state === 'stale' || currentStatus.state === 'unavailable'
          ? currentStatus
          : { state: 'ready', targetId }
    });
  },

  setSampleValues(targetId, values) {
    const samples = new Map(get().samples);
    samples.set(targetId, {
      targetId,
      values,
      serialized: serializeSampleValues(values),
      errors: {},
      valid: true,
      validated: false,
      updatedAt: Date.now()
    });
    set({ samples });
  },

  clearSample(targetId) {
    const samples = new Map(get().samples);
    samples.delete(targetId);
    set({ samples });
  },

  receiveExecutionResult(funcName, output) {
    // A missing span means either this funcName was never dispatched, or its
    // in-flight span was discarded by resetPreviewState() (e.g. unloading
    // the model mid-execution) before this result arrived — in both cases
    // the result belongs to an execution the app no longer tracks, so it
    // must not be written back into the (possibly just-reset) store nor
    // surfaced as a functionExecute op-log/activity entry.
    const span = executeSpans.get(funcName);
    if (!span) return;
    executeSpans.delete(funcName);
    const executionResults = new Map(get().executionResults);
    executionResults.set(funcName, { output });
    set({ executionResults });
    const durationMs = performance.now() - span.startedAt;
    useOutputStore.getState().addLine(fmtLine('functionExecute', 'executed', funcName), 'success', {
      op: 'functionExecute',
      subject: funcName,
      durationMs,
      opId: span.opId
    });
    useActivityStore.getState().addActivity('functionExecute', true, `${funcName} executed`, {
      subject: funcName,
      durationMs,
      opId: span.opId
    });
  },

  receiveExecutionError(funcName, error) {
    // See receiveExecutionResult's comment: a missing span means this result
    // belongs to a discarded/untracked execution and must be dropped.
    const span = executeSpans.get(funcName);
    if (!span) return;
    executeSpans.delete(funcName);
    const executionResults = new Map(get().executionResults);
    executionResults.set(funcName, { output: undefined, error });
    set({ executionResults });
    const durationMs = performance.now() - span.startedAt;
    useOutputStore.getState().addLine(fmtLine('functionExecute', 'execute failed', error), 'error', {
      op: 'functionExecute',
      subject: funcName,
      durationMs,
      opId: span.opId
    });
    useActivityStore.getState().addActivity('functionExecute', false, `${funcName} execute failed · ${error}`, {
      subject: funcName,
      durationMs,
      opId: span.opId
    });
  },

  clearExecutionResult(funcName) {
    const executionResults = new Map(get().executionResults);
    executionResults.delete(funcName);
    set({ executionResults });
  },

  setWorkerRef(worker) {
    workerRef = worker;
  },

  dispatchExecute(funcName, inputs) {
    if (!workerRef) return;
    const worker = workerRef;
    dispatchExecuteCounter++;
    const requestId = `exec:${funcName}:${dispatchExecuteCounter}`;
    _lastExecuteRequestId = requestId;
    executeSpans.set(funcName, { opId: allocateOpId(), startedAt: performance.now() });
    worker.postMessage({
      type: 'preview:execute',
      funcName,
      inputs,
      requestId
    });
  },

  setHydrationRetriesRemaining(targetId, remaining) {
    set((s) => ({
      hydrationRetriesRemaining: { ...s.hydrationRetriesRemaining, [targetId]: remaining }
    }));
  },

  clearHydrationRetriesRemaining(targetId) {
    set((s) => {
      if (!(targetId in s.hydrationRetriesRemaining)) return s;
      const next = { ...s.hydrationRetriesRemaining };
      delete next[targetId];
      return { hydrationRetriesRemaining: next };
    });
  },

  resetPreviewState() {
    set({
      targets: [],
      selectedTargetId: undefined,
      navigationRequest: undefined,
      selectedTarget: undefined,
      lastResolvedTarget: undefined,
      schemas: new Map(),
      samples: new Map(),
      status: { state: 'waiting' },
      executionResults: new Map(),
      hydrationRetriesRemaining: {}
    });
    // CodegenProvider owns the transport lifetime; workspace resets only discard preview data.
    executeSpans.clear();
    pendingValidateRequests.clear();
    latestValidateRequestForTarget.clear();
  }
}));
