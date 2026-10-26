// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { createInstanceGenerateSchemaMessage, createInstanceValidateMessage } from '../services/codegen-service.js';
import { listInstanceFiles, readInstance } from '../opfs/instances-fs.js';
import type { OpfsFs } from '../opfs/opfs-fs.js';
import type { InstanceProvenance, InstanceRecord, ValidationDiagnostic } from '@rune-langium/codegen/instances';
import type { FormPreviewSchema } from '@rune-langium/codegen/export';
import type { PreviewStaleReason } from './preview-store.js';
import { useOutputStore, fmtLine } from './output-store.js';
import type { InstanceReadiness } from '../services/instance-readiness.js';
import {
  flushPersistedInstance,
  instancePersistenceContext,
  persistDelete,
  persistInstance,
  type ExampleRepository
} from './instance-persistence.js';
import { create } from 'zustand';

function ulid(): string {
  // Time-sortable enough for Phase 1's uniqueness needs; swap for a real
  // ulid library only if cross-session collision resistance ever matters.
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// Module-level, like preview-store.ts's workerRef/dispatchExecuteCounter —
// not store state, since a Worker instance isn't serializable/comparable
// the way zustand state is expected to be.
let workerRef: Worker | undefined;
let readinessRef: InstanceReadiness | undefined;
let requestCounter = 0;
const pendingRequests = new Map<string, { instanceId: string; epoch: number }>();
// Tracks the LATEST outstanding validate requestId per instance so an
// out-of-order response (an older request's result arriving after a newer
// one, e.g. from rapid edits) can be dropped instead of overwriting fresher
// diagnostics with stale ones (finding #9).
const latestValidateRequestForInstance = new Map<string, string>(); // instanceId -> requestId

function invalidateValidationRequests(instanceId: string): void {
  latestValidateRequestForInstance.delete(instanceId);
  for (const [requestId, pending] of pendingRequests) {
    if (pending.instanceId === instanceId) pendingRequests.delete(requestId);
  }
}

// Separate module-level map for instance-editing's schema fetches — must
// never collide with dispatchValidate's pendingRequests above. These now
// dispatch on their own `instance:generateSchema`/`instance:generateSchemaResult`
// worker message channel (finding #6/#7) rather than reusing
// `preview:generate`/`preview:result` (usePreviewStore's own target-
// selection channel) — sharing that channel let an instance schema fetch
// silently overwrite the codegen worker's `lastPreviewTargetId`, corrupting
// which target the Preview perspective re-generates on the next workspace
// file change.
let schemaRequestCounter = 0;
const pendingSchemaRequests = new Map<string, { typeFqn: string; epoch: number }>();
const latestSchemaRequestForType = new Map<string, string>();
const preparationControllers = new Map<string, AbortController>();

// Production records use the active repository. The private OPFS context remains
// available for typed legacy adapters; neither context is serializable store state.
let opfsFs: OpfsFs | undefined;
let opfsWorkspaceRoot: string | undefined;
let exampleRepository: ExampleRepository | undefined;

export interface CreateInstanceInput {
  data?: unknown;
  provenance?: InstanceProvenance;
  typeIdentity?: InstanceRecord['typeIdentity'];
}

export type InstanceSaveState =
  | { state: 'unsaved' | 'saving' | 'saved'; revision: number }
  | { state: 'failed'; revision: number; message: string; retained?: true };

function cloneData<T>(value: T): T {
  return structuredClone(value);
}

function uniqueName(name: string, instances: Record<string, InstanceRecord>, exceptId?: string): string {
  const existing = new Set(
    Object.values(instances)
      .filter((record) => record.id !== exceptId)
      .map((record) => record.name)
  );
  if (!existing.has(name)) return name;
  let suffix = 2;
  while (existing.has(`${name} ${suffix}`)) suffix++;
  return `${name} ${suffix}`;
}

interface InstanceStoreState {
  instances: Record<string, InstanceRecord>;
  validationErrors: Record<string, ValidationDiagnostic[]>;
  validationStatus: Record<string, 'pending' | 'valid' | 'invalid' | 'unavailable'>;
  schemas: Map<string, FormPreviewSchema>;
  schemaErrors: Map<string, { reason: PreviewStaleReason; message: string }>;
  saveStates: Record<string, InstanceSaveState>;
  recordRevisions: Record<string, number>;
  workspaceEpoch: number;
  createInstance(typeFqn: string, name: string, input?: CreateInstanceInput): string;
  updateInstanceData(id: string, data: Record<string, unknown>): void;
  renameInstance(id: string, name: string): void;
  duplicateInstance(id: string): string;
  removeInstance(id: string): Promise<void>;
  retrySave(id: string): Promise<void>;
  flushInstance(id: string): Promise<void>;
  flushSaves(workspaceId: string): Promise<void>;
  saveRecord(record: InstanceRecord): void;
  markSaveFailed(id: string, revision: number, error: unknown): void;
  setWorker(worker: Worker | undefined): void;
  setReadiness(readiness: InstanceReadiness | undefined): void;
  prepareInstance(id: string): Promise<void>;
  retryInstance(id: string): Promise<void>;
  revalidateInstances(): void;
  advanceWorkspaceEpoch(): void;
  dispatchValidate(id: string): void;
  receiveValidateResult(requestId: string, diagnostics: ValidationDiagnostic[]): void;
  dispatchGenerateSchema(typeFqn: string): void;
  receiveSchemaResult(requestId: string, schema: FormPreviewSchema): boolean;
  discardSchemaResult(requestId: string): string | undefined;
  receiveSchemaStale(requestId: string, reason: PreviewStaleReason, message: string): boolean;
  handleWorkerFailure(message: string): void;
  setOpfsContext(fs: OpfsFs, workspaceRoot: string): void;
  setExampleRepository(repository: ExampleRepository | undefined): void;
  loadInstancesFromOpfs(): Promise<void>;
}

export const useInstanceStore = create<InstanceStoreState>((set, get) => ({
  instances: {},
  validationErrors: {},
  validationStatus: {},
  schemas: new Map(),
  schemaErrors: new Map(),
  saveStates: {},
  recordRevisions: {},
  workspaceEpoch: 0,

  createInstance(typeFqn, name, input) {
    const id = ulid();
    const now = Date.now();
    const state = get();
    const record: InstanceRecord = {
      id,
      name: uniqueName(name.trim() || 'Untitled example', state.instances),
      typeFqn,
      ...(input?.typeIdentity ? { typeIdentity: cloneData(input.typeIdentity) } : {}),
      data: cloneData(input?.data ?? {}),
      ...(input?.provenance ? { provenance: cloneData(input.provenance) } : {}),
      createdAt: now,
      modifiedAt: now
    };
    const context = instancePersistenceContext(opfsFs, opfsWorkspaceRoot, exampleRepository);
    set((current) => ({
      instances: { ...current.instances, [id]: record },
      recordRevisions: { ...current.recordRevisions, [id]: 1 },
      saveStates: {
        ...current.saveStates,
        [id]: { state: context ? 'saving' : 'unsaved', revision: 1 }
      }
    }));
    if (context) {
      void persistInstance(context, record).then(
        () => {
          const current = get();
          if (current.recordRevisions[id] === 1 && current.workspaceEpoch === state.workspaceEpoch) {
            set((latest) => ({ saveStates: { ...latest.saveStates, [id]: { state: 'saved', revision: 1 } } }));
          }
        },
        (error: unknown) => {
          if (get().workspaceEpoch === state.workspaceEpoch) get().markSaveFailed(id, 1, error);
        }
      );
    }
    // Validate immediately (round-5 finding #2) — mirrors the exact
    // dispatchValidate(id) call already used at the end of
    // updateInstanceData and in loadInstancesFromOpfs's per-loaded-id loop.
    // Without this, a brand-new instance's `data: {}` was never checked
    // against required fields, and InstanceInspectorPanel treats a missing
    // validationErrors[id] entry as "Valid" — so a new instance of a type
    // with required fields showed as valid until the user happened to edit
    // it. dispatchValidate already no-ops gracefully if workerRef isn't set
    // yet, so this is safe to call unconditionally.
    if (readinessRef) void get().prepareInstance(id);
    else get().dispatchValidate(id);
    return id;
  },

  // `data` is a full replacement, not a shallow merge — the caller (the
  // generalized FormPreviewPanel's onValuesChange, via InstanceFormPanel)
  // always supplies the complete top-level values tree, matching how
  // usePreviewStore's updateSample already treats its `values` argument.
  updateInstanceData(id, data) {
    let updated: InstanceRecord | undefined;
    set((state) => {
      const existing = state.instances[id];
      if (!existing) return state;
      updated = { ...existing, data, modifiedAt: Date.now() };
      return { instances: { ...state.instances, [id]: updated } };
    });
    if (updated) get().saveRecord(updated);
    if (readinessRef) void get().prepareInstance(id);
    else get().dispatchValidate(id);
  },

  renameInstance(id, name) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Example name cannot be empty.');
    const record = get().instances[id];
    if (!record) return;
    const renamed = { ...record, name: uniqueName(trimmed, get().instances, id), modifiedAt: Date.now() };
    set((state) => ({ instances: { ...state.instances, [id]: renamed } }));
    get().saveRecord(renamed);
    if (readinessRef && preparationControllers.has(id)) void get().prepareInstance(id);
  },

  duplicateInstance(id) {
    const record = get().instances[id];
    if (!record) throw new Error('Instance no longer exists.');
    return get().createInstance(record.typeFqn, record.name, {
      data: cloneData(record.data),
      ...(record.typeIdentity ? { typeIdentity: cloneData(record.typeIdentity) } : {}),
      ...(record.provenance ? { provenance: cloneData(record.provenance) } : {})
    });
  },

  async removeInstance(id) {
    const epoch = get().workspaceEpoch;
    const record = get().instances[id];
    if (!record) return;
    preparationControllers.get(id)?.abort();
    preparationControllers.delete(id);
    const context = instancePersistenceContext(opfsFs, opfsWorkspaceRoot, exampleRepository);
    const revision = get().recordRevisions[id] ?? 0;
    if (context) {
      set((state) => ({ saveStates: { ...state.saveStates, [id]: { state: 'saving', revision } } }));
      try {
        await persistDelete(context, id);
      } catch (error) {
        if (get().workspaceEpoch !== epoch) throw error;
        const message = error instanceof Error ? error.message : String(error);
        set((state) => ({
          saveStates: { ...state.saveStates, [id]: { state: 'failed', revision, message } }
        }));
        useOutputStore.getState().addLine(fmtLine('instance', 'failed to delete saved example', message), 'error', {
          op: 'instance',
          subject: id
        });
        throw error;
      }
    }
    if (get().workspaceEpoch !== epoch) return;
    set((state) => {
      const { [id]: _removed, ...rest } = state.instances;
      const { [id]: _saveState, ...saveStates } = state.saveStates;
      const { [id]: _revision, ...recordRevisions } = state.recordRevisions;
      return { instances: rest, saveStates, recordRevisions };
    });
  },

  async retrySave(id) {
    const record = get().instances[id];
    if (!record) throw new Error('Instance no longer exists.');
    get().saveRecord(record);
    await get().flushInstance(id);
  },

  async flushInstance(id) {
    const context = instancePersistenceContext(opfsFs, opfsWorkspaceRoot, exampleRepository);
    await flushPersistedInstance(context, id);
    const state = get().saveStates[id];
    if (state?.state === 'failed') throw new Error(state.message);
  },

  async flushSaves(workspaceId) {
    const repository = exampleRepository;
    if (repository?.workspaceId !== workspaceId) return;
    const epoch = get().workspaceEpoch;
    do {
      await Promise.all(
        Object.entries(get().saveStates)
          .filter(([, state]) => state.state !== 'failed' || !state.retained)
          .map(([id]) => get().flushInstance(id))
      );
      if (exampleRepository !== repository || get().workspaceEpoch !== epoch)
        throw new Error('Workspace changed while saving examples.');
    } while (Object.values(get().saveStates).some((state) => state.state === 'saving'));
  },

  saveRecord(record) {
    const context = instancePersistenceContext(opfsFs, opfsWorkspaceRoot, exampleRepository);
    const epoch = get().workspaceEpoch;
    const nextRevision = (get().recordRevisions[record.id] ?? 0) + 1;
    const snapshot = cloneData(record);
    set((state) => ({
      recordRevisions: { ...state.recordRevisions, [record.id]: nextRevision },
      saveStates: {
        ...state.saveStates,
        [record.id]: { state: context ? 'saving' : 'unsaved', revision: nextRevision }
      }
    }));
    if (!context) return;
    void persistInstance(context, snapshot).then(
      () => {
        const current = get();
        if (current.workspaceEpoch !== epoch || current.recordRevisions[record.id] !== nextRevision) return;
        set((state) => ({
          saveStates: { ...state.saveStates, [record.id]: { state: 'saved', revision: nextRevision } }
        }));
      },
      (error: unknown) => {
        if (get().workspaceEpoch === epoch) get().markSaveFailed(record.id, nextRevision, error);
      }
    );
  },

  markSaveFailed(id, revision, error) {
    const current = get();
    if (current.recordRevisions[id] !== revision) return;
    const message = error instanceof Error ? error.message : String(error);
    set((state) => ({
      saveStates: { ...state.saveStates, [id]: { state: 'failed', revision, message } }
    }));
    useOutputStore
      .getState()
      .addLine(fmtLine('instance', `failed to save "${current.instances[id]?.name ?? id}"`, message), 'error', {
        op: 'instance',
        subject: id
      });
  },

  setWorker(worker) {
    workerRef = worker;
  },

  setReadiness(readiness) {
    readinessRef = readiness;
    if (!readiness) return;
    for (const id of Object.keys(get().instances)) void get().prepareInstance(id);
  },

  async prepareInstance(id) {
    const record = get().instances[id];
    const readiness = readinessRef;
    if (!record) return;
    if (!readiness) {
      get().dispatchGenerateSchema(record.typeFqn);
      get().dispatchValidate(id);
      return;
    }

    preparationControllers.get(id)?.abort();
    const controller = new AbortController();
    preparationControllers.set(id, controller);
    // The previous validation describes an older record revision. Fence its
    // reply before readiness synchronizes files for this revision.
    invalidateValidationRequests(id);
    const epoch = get().workspaceEpoch;
    const revision = record.modifiedAt;
    set((state) => ({
      validationStatus: { ...state.validationStatus, [id]: 'pending' },
      validationErrors: Object.fromEntries(Object.entries(state.validationErrors).filter(([key]) => key !== id))
    }));

    try {
      await readiness.ensure(record.typeFqn, controller.signal);
      const current = get().instances[id];
      if (controller.signal.aborted || get().workspaceEpoch !== epoch || !current || current.modifiedAt !== revision) {
        return;
      }
      get().dispatchGenerateSchema(current.typeFqn);
      get().dispatchValidate(id);
    } catch (error) {
      if (controller.signal.aborted || get().workspaceEpoch !== epoch || !get().instances[id]) return;
      const message = error instanceof Error ? error.message : String(error);
      set((state) => ({
        validationStatus: { ...state.validationStatus, [id]: 'unavailable' },
        schemaErrors: new Map(state.schemaErrors).set(record.typeFqn, { reason: 'generation-error', message })
      }));
    } finally {
      if (preparationControllers.get(id) === controller) preparationControllers.delete(id);
    }
  },

  retryInstance(id) {
    return get().prepareInstance(id);
  },

  revalidateInstances() {
    for (const id of Object.keys(get().instances)) {
      const record = get().instances[id];
      if (!record) continue;
      set((state) => ({ validationStatus: { ...state.validationStatus, [id]: 'pending' } }));
      get().dispatchGenerateSchema(record.typeFqn);
      get().dispatchValidate(id);
    }
  },

  advanceWorkspaceEpoch() {
    for (const controller of preparationControllers.values()) controller.abort();
    preparationControllers.clear();
    pendingRequests.clear();
    pendingSchemaRequests.clear();
    latestSchemaRequestForType.clear();
    set((state) => ({
      workspaceEpoch: state.workspaceEpoch + 1,
      validationErrors: {},
      validationStatus: {},
      schemas: new Map(),
      schemaErrors: new Map()
    }));
  },

  dispatchValidate(id) {
    const record = get().instances[id];
    if (!record) return;
    if (!workerRef) {
      const message = 'Instance validation is unavailable because the preview worker is not ready.';
      set((state) => ({
        validationStatus: { ...state.validationStatus, [id]: 'unavailable' },
        schemaErrors: new Map(state.schemaErrors).set(record.typeFqn, { reason: 'generation-error', message })
      }));
      return;
    }
    requestCounter++;
    const requestId = `validate:${id}:${requestCounter}`;
    pendingRequests.set(requestId, { instanceId: id, epoch: get().workspaceEpoch });
    latestValidateRequestForInstance.set(id, requestId);
    set((state) => ({ validationStatus: { ...state.validationStatus, [id]: 'pending' } }));
    workerRef.postMessage(
      createInstanceValidateMessage(record.typeFqn, record.data as Record<string, unknown>, requestId)
    );
  },

  receiveValidateResult(requestId, diagnostics) {
    const pending = pendingRequests.get(requestId);
    if (!pending) return;
    pendingRequests.delete(requestId);
    const { instanceId: id, epoch } = pending;
    if (epoch !== get().workspaceEpoch) return;
    // Drop an out-of-order response: only the LATEST request issued for
    // this instance is allowed to write validationErrors (finding #9).
    if (latestValidateRequestForInstance.get(id) !== requestId) return;
    set((state) => ({
      validationErrors: { ...state.validationErrors, [id]: diagnostics },
      validationStatus: {
        ...state.validationStatus,
        [id]:
          state.validationStatus[id] === 'unavailable' ? 'unavailable' : diagnostics.length === 0 ? 'valid' : 'invalid'
      }
    }));
  },

  // Dispatches unconditionally (does not gate on schemas.has(typeFqn)) —
  // mirrors usePreviewStore's own target-change effect, which always
  // re-requests on selection rather than trusting a cache that could be
  // stale relative to in-flight file edits. Callers are responsible for
  // only invoking this once per mount / typeFqn change.
  dispatchGenerateSchema(typeFqn) {
    if (!workerRef) return;
    schemaRequestCounter++;
    const requestId = `schema:${typeFqn}:${schemaRequestCounter}`;
    pendingSchemaRequests.set(requestId, { typeFqn, epoch: get().workspaceEpoch });
    latestSchemaRequestForType.set(typeFqn, requestId);
    workerRef.postMessage(createInstanceGenerateSchemaMessage(typeFqn, requestId));
  },

  receiveSchemaResult(requestId, schema) {
    const pending = pendingSchemaRequests.get(requestId);
    if (!pending || pending.epoch !== get().workspaceEpoch) return false;
    pendingSchemaRequests.delete(requestId);
    if (latestSchemaRequestForType.get(pending.typeFqn) !== requestId) return false;
    set((state) => {
      const schemas = new Map(state.schemas);
      schemas.set(schema.targetId, schema);
      const schemaErrors = new Map(state.schemaErrors);
      schemaErrors.delete(schema.targetId);
      return { schemas, schemaErrors };
    });
    return true;
  },

  discardSchemaResult(requestId) {
    const pending = pendingSchemaRequests.get(requestId);
    if (!pending || pending.epoch !== get().workspaceEpoch) return undefined;
    pendingSchemaRequests.delete(requestId);
    return latestSchemaRequestForType.get(pending.typeFqn) === requestId ? pending.typeFqn : undefined;
  },

  receiveSchemaStale(requestId, reason, message) {
    const pending = pendingSchemaRequests.get(requestId);
    if (!pending || pending.epoch !== get().workspaceEpoch) return false;
    const { typeFqn } = pending;
    pendingSchemaRequests.delete(requestId);
    if (latestSchemaRequestForType.get(typeFqn) !== requestId) return false;
    set((state) => {
      // Also drop any previously-cached schema for this typeFqn (Codex
      // round-2 finding #3) — InstanceFormPanel checks `schema` BEFORE
      // `schemaError` when computing its status, so a stale response that
      // left an old cached schema in place would keep the panel rendering
      // the OUTDATED schema and never surface the new failure.
      const schemas = new Map(state.schemas);
      schemas.delete(typeFqn);
      const schemaErrors = new Map(state.schemaErrors);
      schemaErrors.set(typeFqn, { reason, message });
      const validationStatus = { ...state.validationStatus };
      for (const [id, record] of Object.entries(state.instances)) {
        if (record.typeFqn === typeFqn) validationStatus[id] = 'unavailable';
      }
      return { schemas, schemaErrors, validationStatus };
    });
    return true;
  },

  handleWorkerFailure(message) {
    pendingRequests.clear();
    pendingSchemaRequests.clear();
    latestValidateRequestForInstance.clear();
    latestSchemaRequestForType.clear();
    set((state) => {
      const validationStatus = { ...state.validationStatus };
      const schemaErrors = new Map(state.schemaErrors);
      for (const [id, record] of Object.entries(state.instances)) {
        validationStatus[id] = 'unavailable';
        schemaErrors.set(record.typeFqn, { reason: 'generation-error', message });
      }
      return { validationStatus, schemaErrors };
    });
  },

  // Wires the shared `OpfsFs` + active workspace root (finding #1) — set
  // from wherever in the component tree both become available (see
  // App.tsx's workspace-manager effect). Immediately clears in-memory
  // instances (a workspace switch must not leak the PREVIOUS workspace's
  // instances while the new workspace's are being loaded) and kicks off
  // `loadInstancesFromOpfs` fire-and-forget, mirroring the
  // fire-and-forget `dispatchValidate` pattern already used elsewhere in
  // this store.
  //
  // Also clears `schemas`/`schemaErrors` (round-3 finding #2) — a cached
  // schema is keyed by type FQN, not by workspace, so a stale schema for
  // the SAME FQN from the PREVIOUS workspace (a different model shape, or
  // simply answered before the worker's file state caught up) could
  // otherwise be read by InstanceFormPanel before the fresh
  // `dispatchGenerateSchema` request for the new workspace resolves.
  //
  // Also clears the module-level `pendingSchemaRequests` map (round-4
  // finding #2) — clearing `schemas`/`schemaErrors` state alone isn't
  // enough: a schema request dispatched from the PREVIOUS workspace can
  // still be in flight at switch time, and if its `requestId` is left in
  // `pendingSchemaRequests`, `receiveSchemaResult`/`receiveSchemaStale`
  // will still recognize it as owned and accept it once it lands —
  // repopulating `schemas` for that type FQN with data from the WRONG
  // (previous) workspace's model. `pendingRequests`/
  // `latestValidateRequestForInstance` (the analogous validate-request
  // tracking) do NOT need the same treatment: they're keyed by instance id
  // (a ulid), not by type FQN, so a stale validate response landing after a
  // switch writes into `validationErrors` under an id that cannot collide
  // with any instance id in the new workspace — there's no reused key for
  // it to corrupt.
  setExampleRepository(repository) {
    if (exampleRepository === repository) return;
    exampleRepository = repository;
    opfsFs = undefined;
    opfsWorkspaceRoot = undefined;
    get().advanceWorkspaceEpoch();
    set({ instances: {}, saveStates: {}, recordRevisions: {} });
    if (repository) void get().loadInstancesFromOpfs();
  },

  setOpfsContext(fs, workspaceRoot) {
    if (!exampleRepository && opfsFs === fs && opfsWorkspaceRoot === workspaceRoot) return;
    exampleRepository = undefined;
    opfsFs = fs;
    opfsWorkspaceRoot = workspaceRoot;
    get().advanceWorkspaceEpoch();
    set({ instances: {}, saveStates: {}, recordRevisions: {} });
    void get().loadInstancesFromOpfs();
  },

  async loadInstancesFromOpfs() {
    if (!exampleRepository && (!opfsFs || !opfsWorkspaceRoot)) return;
    const repository = exampleRepository;
    const epoch = get().workspaceEpoch;
    const fs = opfsFs!;
    const workspaceRoot = opfsWorkspaceRoot!;
    try {
      const restored = repository ? await repository.load() : undefined;
      for (const issue of restored?.diagnostics ?? [])
        useOutputStore.getState().addLine(fmtLine('example', issue.message, issue.path), 'warn', { op: 'example' });
      const files = restored ? [] : await listInstanceFiles(fs, workspaceRoot);
      const ids = files.map((f) => f.replace(/\.json$/, ''));
      const records =
        restored?.records ??
        (await Promise.all(
          ids.map(async (id) => {
            try {
              return await readInstance(fs, workspaceRoot, id);
            } catch (err) {
              console.error(`[instance-store] Failed to read persisted instance "${id}" from OPFS:`, err);
              // Dropped silently otherwise — a corrupted/unreadable instance
              // file looks indistinguishable from the user having deleted it.
              useOutputStore
                .getState()
                .addLine(
                  fmtLine(
                    'instance',
                    `could not load saved example "${id}"`,
                    err instanceof Error ? err.message : String(err)
                  ),
                  'warn',
                  {
                    op: 'instance',
                    subject: id
                  }
                );
              return undefined;
            }
          })
        ));
      const loaded = Object.fromEntries(records.filter((record) => !!record).map((record) => [record!.id, record!]));
      // Only apply if this OPFS context is still the current one — guards
      // against a rapid workspace switch resolving out of order.
      if (
        get().workspaceEpoch === epoch &&
        exampleRepository === repository &&
        (repository || (opfsFs === fs && opfsWorkspaceRoot === workspaceRoot))
      ) {
        // Merge, don't wholesale-replace (round-7 finding #2): `loaded` is
        // the base, with any instances already present in current state
        // layered on top. setOpfsContext synchronously cleared `instances`
        // to `{}` before this async load started, and
        // updateInstanceData/removeInstance both require an existing
        // state.instances[id] entry to act on — so they can't have touched
        // any OPFS-loaded-but-not-yet-applied id. The only entries that can
        // exist in state.instances at the time this set() runs are ones
        // created via createInstance during this exact async gap, so
        // layering them on top of `loaded` is safe (not a stale-workspace
        // leak; the opfsFs/opfsWorkspaceRoot guard above already handles
        // the cross-workspace-switch case).
        set((state) => {
          const instances = { ...loaded, ...state.instances };
          return {
            instances,
            recordRevisions: Object.fromEntries(
              Object.keys(instances).map((id) => [id, state.recordRevisions[id] ?? 1])
            ),
            saveStates: Object.fromEntries(
              Object.keys(instances).map((id) => [
                id,
                state.saveStates[id] ??
                  (restored?.failures?.[id]
                    ? { state: 'failed', revision: 1, message: restored.failures[id], retained: true }
                    : { state: 'saved', revision: 1 })
              ])
            )
          };
        });
        // Dispatch validation for every restored instance (round-3 finding
        // #3) — without this, `validationErrors` stays empty for records
        // loaded from OPFS (e.g. imported/raw JSON missing a required
        // field) and the Inspector reports them as "Valid" until the user
        // happens to edit one, which is the only other path that calls
        // dispatchValidate. `dispatchValidate` already no-ops if the worker
        // isn't wired up yet (matches the pattern used everywhere else in
        // this store), so this is safe to call unconditionally; if the
        // worker isn't ready yet at load time, those instances simply
        // aren't revalidated until touched — a smaller gap than today's
        // "never revalidated at all".
        for (const id of Object.keys(loaded)) {
          try {
            if (readinessRef) void get().prepareInstance(id);
            else get().dispatchValidate(id);
          } catch (err) {
            // The instance itself already loaded successfully (set() above
            // already applied it) — this is only a validation-dispatch
            // failure (e.g. a terminated worker), not a load failure, so it
            // must NOT be reported as "failed to load saved examples"
            // (Codex P2) — and must not abort the loop for the remaining
            // restored instances either.
            console.error(`[instance-store] Failed to dispatch validation for restored instance "${id}":`, err);
            useOutputStore
              .getState()
              .addLine(
                fmtLine(
                  'instance',
                  `could not validate restored instance "${id}"`,
                  err instanceof Error ? err.message : String(err)
                ),
                'warn',
                { op: 'instance', subject: id }
              );
          }
        }
      }
    } catch (err) {
      if (get().workspaceEpoch !== epoch) return;
      console.error('[instance-store] Failed to load instances from OPFS:', err);
      // Whole-list failure: the instance list stays empty/stale with no
      // explanation otherwise — the highest-blast-radius case in this file.
      useOutputStore
        .getState()
        .addLine(
          fmtLine('instance', 'failed to load saved examples', err instanceof Error ? err.message : String(err)),
          'error',
          { op: 'instance' }
        );
    }
  }
}));
