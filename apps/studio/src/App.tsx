// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * App — Root component for Rune DSL Studio (T089, T028).
 *
 * Orchestrates file loading, parsing, the editor page,
 * and LSP client lifecycle.
 */

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import '@xyflow/react/dist/style.css';
import '@rune-langium/visual-editor/styles.css';
import type { RosettaModel } from '@rune-langium/core';
import { Spinner } from '@rune-langium/design-system/ui/spinner';
import type { WorkspaceFile } from './services/workspace.js';
import {
  parseWorkspaceFiles,
  mergeModelFiles,
  mergeCuratedRefOnlyFiles,
  loadCuratedNamespaceSource,
  subscribeCuratedCacheRecovery,
  invalidateCuratedCacheRecovery
} from './services/workspace.js';
import { useModelStore } from './store/model-store.js';
import { usePreviewStore } from './store/preview-store.js';
import { useCodegenStore } from './store/codegen-store.js';
import { getModelSource } from './services/model-registry.js';
import type { LoadedModel } from './types/model-types.js';
import { BASE_TYPE_FILES } from './resources/base-types.js';
import * as persistence from './workspace/persistence.js';
import type { CuratedModelBinding, WorkspaceRecord } from './workspace/persistence.js';
import { LAYOUT_SCHEMA_VERSION } from './shell/layout-factory.js';
import { deleteWorkspaceFiles, loadWorkspaceFiles, saveWorkspaceFiles } from './workspace/workspace-files.js';
import { WorkspaceManager } from './workspace/workspace-manager.js';
import { StudioToastProvider, useStudioToast } from './components/StudioToastProvider.js';
import { useOutputStore, fmtLine } from './store/output-store.js';
import { useActivityStore } from './store/activity-store.js';
import { allocateOpId } from './services/op-log.js';
import { recordPerf, recordPerfStart } from './services/perf-log.js';
import { useInstanceStore } from './store/instance-store.js';
import { getOrCreateSyncEngine, disposeSyncEngine } from './services/git-sync.js';
import { ActivityBar } from './shell/ActivityBar.js';
import { AppHeader } from './shell/AppHeader.js';
import { PerspectiveHost } from './shell/perspectives/PerspectiveHost.js';
import { StudioProviders } from './shell/providers/StudioProviders.js';
import { usePerspectiveStore } from './store/perspective-store.js';
import { hydrateTelemetrySettings, useTelemetrySettingsStore } from './store/telemetry-settings.js';
import { installTelemetryCapture } from './services/telemetry-capture.js';
import { installTelemetryShipper } from './services/telemetry-shipper.js';
import { createTelemetryClient } from './services/telemetry.js';
import { config } from './config.js';
import { useEditorStore } from '@rune-langium/visual-editor';
import './test-api.js';
import { setRuneStudioTestApi } from './test-api.js';
import { withInstrumentation } from './services/instrumentation/core.js';

/**
 * Mount-time workspace boot state machine (T028 / 014-US2).
 *
 *   checking   → initial; we are calling listRecents() / loadWorkspace()
 *   restoring  → a recent workspace was found; about to surface it
 *   start      → no recent (or restore failed) → show the empty start page
 *   restored   → a workspace was restored — body[data-workspace-active=true]
 */
type BootState = 'checking' | 'restoring' | 'start' | 'restored';

const STUDIO_VERSION = '0.1.0';

function makeWorkspaceId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ws-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Project the in-memory `loadedModels` map into the persistable
 * `CuratedModelBinding[]` shape stored on `WorkspaceRecord.curatedModels`.
 *
 * Only curated bundles (sources with an `archiveUrl`) round-trip — the
 * custom-URL / git-clone path doesn't have a stable identity to re-load
 * on restore, so persisting it would surface stale entries we couldn't
 * resolve back to a registry source. See `CuratedModelBinding` for the
 * schema.
 *
 * Prod-smoke 2026-05-20 (Defect D1): the prior wiring loaded curated
 * bundles into the in-memory store but never wrote them back to IDB.
 * On refresh the workspace rehydrated with `curatedModels: []` and the
 * 4768-type explorer collapsed to the 22 built-in types because nothing
 * triggered a re-load.
 */
function deriveCuratedBindings(
  loadedModels: Map<string, LoadedModel>,
  retainedBindings: readonly CuratedModelBinding[] = []
): CuratedModelBinding[] {
  const bindings = new Map(retainedBindings.map((binding) => [binding.modelId, binding]));
  for (const model of loadedModels.values()) {
    if (!model.source.archiveUrl) continue;
    bindings.set(model.source.id, {
      modelId: model.source.id,
      loadedVersion: model.commitHash || 'latest',
      loadedAt: new Date(model.loadedAt).toISOString(),
      updateAvailable: false
    });
  }
  // Stable order so the equality check below doesn't flap on Map iteration order.
  return [...bindings.values()].sort((a, b) => a.modelId.localeCompare(b.modelId));
}

/**
 * Equality check for `CuratedModelBinding[]` that skips `loadedAt` (a
 * timestamp that drifts on every re-load even when the bundle identity
 * is unchanged). Used to short-circuit the persist effect so a tab-focus
 * re-render doesn't rewrite IDB on every render.
 */
function curatedBindingsEqual(a: CuratedModelBinding[], b: CuratedModelBinding[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!;
    const right = b[i]!;
    if (left.modelId !== right.modelId) return false;
    if (left.loadedVersion !== right.loadedVersion) return false;
    if (left.updateAvailable !== right.updateAvailable) return false;
  }
  return true;
}

function sameLoadedModelSources(a: ReadonlyMap<string, LoadedModel>, b: ReadonlyMap<string, LoadedModel>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, model] of b) {
    const previous = a.get(id);
    if (!previous) return false;
    if (
      previous.source !== model.source ||
      previous.commitHash !== model.commitHash ||
      previous.loadedAt !== model.loadedAt
    ) {
      return false;
    }
    if (!model.source.archiveUrl && previous.files !== model.files) return false;
  }
  return true;
}

function deriveWorkspaceName(files: readonly WorkspaceFile[]): string {
  const firstFile = files[0];
  if (!firstFile) {
    return 'Workspace';
  }

  const rootFolder = firstFile.path.split('/')[0];
  if (files.length > 1 && rootFolder && rootFolder !== firstFile.name) {
    return rootFolder;
  }

  return firstFile.name.replace(/\.rosetta$/i, '') || 'Workspace';
}

function AppContent() {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [models, setModels] = useState<RosettaModel[]>([]);
  const [parsedModels, setParsedModels] = useState<Array<{ filePath: string; model: RosettaModel }>>([]);
  const [parseErrors, setParseErrors] = useState<Map<string, string[]>>(new Map());
  const [deferredExports, setDeferredExports] = useState<
    Array<{ filePath: string; namespace: string; exports: Array<{ type: string; name: string }> }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [bootState, setBootState] = useState<BootState>('checking');
  const [restoredWorkspace, setRestoredWorkspace] = useState<WorkspaceRecord | null>(null);
  // Tracks the workspace.id for which the in-memory model-store has settled
  // (every curated binding declared on the workspace has finished its load
  // attempt — success or failure — since the most recent restoreWorkspace).
  // Until this matches the active workspace.id, the curated-binding persist
  // effect is a no-op so a switch A→B can't accidentally write A's bundles
  // (which still live in the global model-store during B's restore) into B's
  // record. See restoreWorkspace + the persist effect for the lifecycle.
  //
  // Stored in state (not a ref) because the persist effect needs to re-run
  // when sync completes — refs don't trigger re-renders, so the effect would
  // see stale values.
  const [curatedSyncedWorkspaceId, setCuratedSyncedWorkspaceId] = useState<string | null>(null);

  const reparseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceManagerRef = useRef<WorkspaceManager | null>(null);
  // Incremented for every edit-time reparse request so stale async results
  // (older syntax errors finishing after newer valid text) cannot overwrite
  // the current Problems/status-bar state.
  const editParseTokenRef = useRef(0);
  // Incremented before each model-merge parse; only the matching result is
  // applied, preventing stale async results from overwriting newer state.
  const modelParseTokenRef = useRef(0);
  const lastModelMergeRef = useRef<ReadonlyMap<string, LoadedModel> | null>(null);
  // Tracks the latest files state so the model-loading effect can read it
  // synchronously without stale-closure issues. Starts as [] (matching the
  // `files` initial state) and is kept in sync via the effect below.
  const filesRef = useRef<WorkspaceFile[]>([]);
  const workspaceEpochRef = useRef(0);
  // Tracks the latest loaded reference models so syncWorkspaceToEditor can
  // preserve them without calling useModelStore.getState() (which is not
  // available in the test mock of useModelStore).
  const loadedModelsRef = useRef<Map<string, LoadedModel>>(new Map());
  // Declared selections survive failed loads until the model is observed loaded.
  const unavailableCuratedBindingsRef = useRef(new Map<string, CuratedModelBinding>());
  const { showToast, showLoadingToast, dismissToast } = useStudioToast();

  const reportWorkspaceError = useCallback((message: string, error: unknown) => {
    console.warn(`[App] ${message}:`, error);
    setWorkspaceError(message);
    useOutputStore
      .getState()
      .addLine(fmtLine('workspace', message, error instanceof Error ? error.message : undefined), 'error');
    useActivityStore.getState().addActivity('workspace', false, message);
  }, []);

  useEffect(() => {
    if (!workspaceError) {
      return;
    }
    showToast({
      title: 'Workspace error',
      description: workspaceError,
      variant: 'destructive',
      duration: 5000
    });
  }, [showToast, workspaceError]);

  useEffect(() => {
    if (!workspaceNotice) {
      return;
    }
    showToast({
      title: 'Workspace notice',
      description: workspaceNotice,
      duration: 4000
    });
  }, [showToast, workspaceNotice]);

  const applyParseResult = useCallback(
    (
      result: Awaited<ReturnType<typeof parseWorkspaceFiles>>,
      options: { preserveSemanticModelOnErrors?: boolean } = {}
    ) => {
      setParseErrors(result.errors);
      const hasParseErrors = result.errors.size > 0;
      if (!hasParseErrors || !options.preserveSemanticModelOnErrors) {
        setModels(result.models);
        setParsedModels(result.parsedModels);
        setDeferredExports(result.deferredExports ?? []);
        // Surface curated bundle contents into the model-store so ModelLoader's
        // "(N files)" badge + the curated file picker reflect what /api/parse
        // hydrated. The routed parse path is the only place the studio learns
        // which docs belong to each curated bundle (the curated-loader stays
        // metadata-only by design — see model-store.buildArchiveLoader).
        if (result.curatedRefOnlyFiles) {
          const store = useModelStore.getState();
          const previousModels = store.models;
          const curatedFilesWithSource = Object.fromEntries(
            Object.entries(result.curatedRefOnlyFiles).map(([bundleId, files]) => {
              const priorByPath = new Map(previousModels.get(bundleId)?.files.map((file) => [file.path, file]));
              return [
                bundleId,
                files.map((file) => {
                  const prior = priorByPath.get(file.path);
                  return !file.sourceLoaded && prior?.sourceLoaded && prior.artifactKey === file.artifactKey
                    ? { ...file, content: prior.content, sourceLoaded: true }
                    : file;
                })
              ];
            })
          );
          for (const [bundleId, curatedFiles] of Object.entries(curatedFilesWithSource)) {
            store.setCuratedFiles(bundleId, curatedFiles);
          }
          const currentModels = useModelStore.getState().models;
          if (currentModels !== previousModels) {
            setFiles((currentFiles) => mergeCuratedRefOnlyFiles(currentFiles, curatedFilesWithSource, currentModels));
          }
        }
      }
      setWorkspaceNotice(result.parseMode === 'main-thread-fallback' ? (result.fallbackMessage ?? null) : null);
    },
    []
  );

  useEffect(() => subscribeCuratedCacheRecovery((result) => applyParseResult(result)), [applyParseResult]);

  // On-demand curated namespace hydration.
  //
  // When the explorer selects a node in a namespace that hasn't been
  // hydrated yet, ExplorePerspective calls `requestNamespaceHydration(ns)`.
  // That appends to `pendingHydrationNamespaces`, which triggers this effect.
  // We re-parse with the cumulative union of already-hydrated + pending
  // namespaces — the worker uses replacement semantics, so the full set must
  // be sent every time to keep previously-hydrated namespaces alive.
  // After the parse completes, `markNamespacesHydrated` moves the names from
  // pending → hydrated, which empties `pendingHydration` and the effect's
  // guard (`length === 0`) short-circuits on the next run — no infinite loop.
  // On failure, `dequeuePendingHydration` removes the failed names (without
  // marking hydrated) so re-selecting/re-expanding them re-queues and retries.
  const pendingHydration = useEditorStore((s) => s.pendingHydrationNamespaces);
  useEffect(() => {
    if (pendingHydration.length === 0) return;
    let cancelled = false;
    const epoch = workspaceEpochRef.current;
    const hydratedSoFar = useEditorStore.getState().hydratedNamespaces;
    const requested = [...new Set([...hydratedSoFar, ...pendingHydration])];
    // Background process with no natural "done" UI state of its own (unlike
    // e.g. ExportDialog's own generating phase) — surface it as a toast so
    // it's visible even if the user has navigated away from the node/panel
    // that triggered it.
    const label = pendingHydration.length === 1 ? pendingHydration[0] : `${pendingHydration.length} namespaces`;
    const toastId = showLoadingToast({ description: `Loading ${label}…` });
    void parseWorkspaceFiles(files, { hydrateNamespaces: requested, requireCuratedHydration: true })
      .then((result) => {
        if (cancelled || epoch !== workspaceEpochRef.current) return;
        applyParseResult(result, { preserveSemanticModelOnErrors: true });
        if (result.errors.size > 0) {
          // The last valid semantic model is still in use. Keep this namespace
          // retryable rather than claiming its new declarations were applied.
          useEditorStore.getState().dequeuePendingHydration(pendingHydration);
          return;
        }
        // Mark exactly the set sent in THIS parse (not whatever is pending when
        // the promise resolves) so a request arriving mid-flight isn't lost.
        useEditorStore.getState().markNamespacesHydrated(pendingHydration);
      })
      .catch((err) => {
        if (cancelled || epoch !== workspaceEpochRef.current) return;
        // Dequeue the failed namespaces (without marking hydrated) so the user
        // can retry by re-selecting/re-expanding them; keep the last valid graph.
        useEditorStore.getState().dequeuePendingHydration(pendingHydration);
        reportWorkspaceError('Failed to hydrate the selected namespace; keeping the last valid graph', err);
      })
      .finally(() => {
        if (!cancelled) dismissToast(toastId);
      });
    return () => {
      cancelled = true;
      dismissToast(toastId);
    };
    // `files` in deps: an edit during an in-flight hydration re-fires this and
    // issues a second round-trip; the `cancelled` flag discards the stale result,
    // so it's a wasted request but correctness-safe.
  }, [pendingHydration, files, applyParseResult, reportWorkspaceError, showLoadingToast, dismissToast]);

  const invalidateWorkspaceParses = useCallback(() => {
    invalidateCuratedCacheRecovery();
    workspaceEpochRef.current += 1;
    editParseTokenRef.current += 1;
    modelParseTokenRef.current += 1;
    if (reparseTimerRef.current) {
      clearTimeout(reparseTimerRef.current);
      reparseTimerRef.current = null;
    }
    useEditorStore.getState().resetHydration();
    return workspaceEpochRef.current;
  }, []);

  const reconcileWorkspaceModels = useCallback((bindings: readonly CuratedModelBinding[]) => {
    unavailableCuratedBindingsRef.current = new Map(bindings.map((binding) => [binding.modelId, binding]));
    // Some component tests supply a hook-only store mock.
    const store = useModelStore.getState?.();
    if (!store) {
      loadedModelsRef.current = new Map();
      return;
    }
    const declaredIds = new Set(bindings.map((binding) => binding.modelId));
    for (const id of store.loading?.keys() ?? []) {
      if (!declaredIds.has(id)) store.cancel(id);
    }
    for (const id of store.models.keys()) {
      if (!declaredIds.has(id)) store.unload(id);
    }
    for (const id of store.errors?.keys() ?? []) {
      if (!declaredIds.has(id)) store.dismissError(id);
    }
    // React's subscription effect runs later; activation must merge the
    // reconciled snapshot now, rather than the previous render's models.
    loadedModelsRef.current = useModelStore.getState().models;
    lastModelMergeRef.current = loadedModelsRef.current;
  }, []);

  const clearWorkspaceState = useCallback(() => {
    unavailableCuratedBindingsRef.current.clear();
    invalidateWorkspaceParses();
    filesRef.current = [];
    setFiles([]);
    setModels([]);
    setParsedModels([]);
    setParseErrors(new Map());
    setDeferredExports([]);
    setCuratedSyncedWorkspaceId(null);
    setWorkspaceError(null);
    setWorkspaceNotice(null);
    const editor = useEditorStore.getState();
    editor.loadDeferredExports([]);
    editor.loadModels([]);
    editor.selectNode(null);
    useEditorStore.temporal.getState().clear();
    usePreviewStore.getState().resetPreviewState();
    useCodegenStore.getState().resetCodegenState();
  }, [invalidateWorkspaceParses]);

  const syncWorkspaceToEditor = useCallback(
    async (workspaceFiles: WorkspaceFile[]) => {
      setLoading(true);
      const epoch = invalidateWorkspaceParses();
      try {
        // Start with the built-in base types and the user's workspace files.
        let mergedFiles: WorkspaceFile[] = [...BASE_TYPE_FILES.map((file) => ({ ...file })), ...workspaceFiles];
        // Preserve any reference model files that are already loaded so that
        // switching/restoring a workspace doesn't silently drop them.
        for (const model of loadedModelsRef.current.values()) {
          mergedFiles = mergeModelFiles(mergedFiles, model);
        }
        filesRef.current = mergedFiles;
        setFiles(mergedFiles);
        // LSP doc-set sync is owned by LspProvider, which re-syncs on the
        // `files` state it reads from useWorkspace() (filtering bundle-marker
        // and ref-only files). App only sets the files here.

        const result = await parseWorkspaceFiles(mergedFiles, {
          hydrateNamespaces: useEditorStore.getState().activeHydrationNamespaces()
        });
        if (epoch !== workspaceEpochRef.current) return;
        applyParseResult(result);
        setWorkspaceError(null);
      } catch (error) {
        if (epoch !== workspaceEpochRef.current) return;
        reportWorkspaceError('Failed to parse workspace files', error);
        throw error;
      } finally {
        if (epoch === workspaceEpochRef.current) setLoading(false);
      }
    },
    [applyParseResult, invalidateWorkspaceParses, reportWorkspaceError]
  );

  const createWorkspaceRecord = useCallback(async (name: string): Promise<WorkspaceRecord> => {
    const now = new Date().toISOString();
    // Auto-suffix the name when an existing workspace already claims it
    // (Defect D2 / prod-smoke 2026-05-20): the switcher / recents list
    // surfaced two identical `untitled BROWSER` entries with no way to
    // distinguish which was which. Disambiguate at creation time so every
    // workspace record carries a unique label.
    const recents = await persistence
      .listRecents()
      .catch(() => [] as Awaited<ReturnType<typeof persistence.listRecents>>);
    const takenNames = new Set(recents.map((r) => r.name));
    let uniqueName = name;
    if (takenNames.has(uniqueName)) {
      let suffix = 2;
      while (takenNames.has(`${name} (${suffix})`)) suffix += 1;
      uniqueName = `${name} (${suffix})`;
    }
    const workspace: WorkspaceRecord = {
      id: makeWorkspaceId(),
      name: uniqueName,
      kind: 'browser-only',
      createdAt: now,
      lastOpenedAt: now,
      layout: {
        version: LAYOUT_SCHEMA_VERSION,
        writtenBy: STUDIO_VERSION,
        dockview: null
      },
      tabs: [],
      activeTabPath: null,
      curatedModels: [],
      schemaVersion: 1
    };

    await saveWorkspaceFiles(workspace.id, []);
    await persistence.saveWorkspace(workspace);
    return workspace;
  }, []);

  // Async activation must check the current identity before publishing results.
  const restoredWorkspaceRef = useRef<WorkspaceRecord | null>(null);
  useEffect(() => {
    restoredWorkspaceRef.current = restoredWorkspace;
  }, [restoredWorkspace]);

  const restoreWorkspace = useCallback(
    async (workspace: WorkspaceRecord): Promise<'restored' | 'empty' | 'superseded'> => {
      clearWorkspaceState();
      const activationEpoch = workspaceEpochRef.current;
      reconcileWorkspaceModels(workspace.curatedModels ?? []);
      const restoredFiles = await loadWorkspaceFiles(workspace.id);
      if (activationEpoch !== workspaceEpochRef.current) return 'superseded';
      if (restoredFiles.length === 0 && (workspace.curatedModels?.length ?? 0) === 0) {
        reconcileWorkspaceModels([]);
        restoredWorkspaceRef.current = null;
        setRestoredWorkspace(null);
        return 'empty';
      }

      const nextWorkspace = {
        ...workspace,
        lastOpenedAt: new Date().toISOString()
      };
      await persistence.saveWorkspace(nextWorkspace);
      if (activationEpoch !== workspaceEpochRef.current) return 'superseded';
      // Mark curated-bindings sync as "pending for this workspace" BEFORE
      // updating restoredWorkspace, so the persist effect sees a non-matching
      // synced id on its first run after the switch and bails out. Without
      // this gate, persisting fires immediately with whatever is currently
      // in the global model-store — which during an A→B switch still holds
      // A's bundles, overwriting B's saved curatedModels with stale state
      // (Codex P1, PR #220).
      setCuratedSyncedWorkspaceId(null);
      restoredWorkspaceRef.current = nextWorkspace;
      setRestoredWorkspace(nextWorkspace);
      try {
        await syncWorkspaceToEditor(restoredFiles);
        if (restoredWorkspaceRef.current?.id !== nextWorkspace.id) return 'superseded';

        // Replay any curated bundles bound to this workspace (D1 fix). Without
        // this, refresh / switch-workspace would drop CDM/FpML/etc. because
        // the in-memory model-store starts empty on every mount.
        //
        // We schedule the loads in parallel and await them all here so the
        // sync-settled flag flips only after the in-memory store reflects
        // the workspace's declared bindings. `load(source)` resolves on both
        // success and failure (errors land in the store's `errors` map), so
        // a single slow / failing archive can't pin the flag at `null`
        // forever. Loads still run in parallel — total cost is bounded by
        // the slowest load, not the sum.
        //
        // `useModelStore.getState()` is gated on `declared.length > 0` so
        // tests that mock `useModelStore` as a bare hook (without a `.getState`
        // method) — which is fine when the workspace has no curated bindings —
        // continue to work unchanged. The pre-existing wiring did the same.
        const declared = workspace.curatedModels ?? [];
        if (declared.length > 0) {
          const modelStoreLoad = useModelStore.getState().load;
          const loadPromises: Promise<void>[] = [];
          for (const binding of declared) {
            const source = getModelSource(binding.modelId);
            if (!source) continue;
            loadPromises.push(modelStoreLoad(source));
          }
          if (loadPromises.length > 0) {
            // Don't surface errors here — each failed load already records its
            // error in the model-store and the UI shows it via ModelLoader.
            await Promise.allSettled(loadPromises);
          }
        }
      } finally {
        // Flip the gate even if `syncWorkspaceToEditor` or a curated load
        // threw — `restoredWorkspace` was already set above, and the persist
        // effect needs the gate to open so any genuinely loaded bundles
        // (including those that succeeded before the throw) reach IDB. Parse
        // errors live in a separate channel (`reportWorkspaceError`) and
        // don't invalidate the curated-binding snapshot. Without the
        // try/finally a parse failure during the very first restore would
        // strand the gate closed for the remainder of the session.
        if (restoredWorkspaceRef.current?.id === nextWorkspace.id) {
          setCuratedSyncedWorkspaceId(nextWorkspace.id);
        }
      }
      return restoredWorkspaceRef.current?.id === nextWorkspace.id ? 'restored' : 'superseded';
    },
    [clearWorkspaceState, reconcileWorkspaceModels, syncWorkspaceToEditor]
  );

  // Restore the most recently opened workspace on mount when its metadata and
  // saved files are still available; otherwise fall back to the start page.
  useEffect(() => {
    let cancelled = false;
    (async function bootRestore() {
      try {
        const recents = await persistence.listRecents();
        if (cancelled) return;
        if (recents.length === 0) {
          setBootState('start');
          return;
        }
        const top = recents[0]!;
        const ws = await persistence.loadWorkspace(top.id);
        if (cancelled) return;
        if (!ws) {
          setBootState('start');
          return;
        }
        setBootState('restoring');
        const restored = await restoreWorkspace(ws);
        if (cancelled || restored === 'superseded') return;
        if (restored === 'empty') {
          // Restore yielded zero user files — show the no-workspace shell with
          // the Workspaces launcher rather than an empty Explore surface.
          setBootState('start');
          usePerspectiveStore.getState().setActivePerspective('workspaces');
          return;
        }
        setBootState('restored');
        // A restored workspace has user files, so
        // userFiles.length > 0 here — jump straight to the explore perspective.
        usePerspectiveStore.getState().setActivePerspective('explore');
      } catch (err) {
        if (cancelled) return;
        reportWorkspaceError('Workspace restore failed; showing the start page instead', err);
        setBootState('start');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportWorkspaceError, restoreWorkspace]);

  // Tag the body so the dock chrome / e2e selectors can detect that an
  // editor is mounted (T028 contract). Cleared on unmount so the next
  // test case starts clean.
  useEffect(() => {
    document.body.setAttribute('data-studio-app', 'true');
    return () => {
      document.body.removeAttribute('data-studio-app');
    };
  }, []);

  // Read the persisted per-user telemetry opt-in once at mount. Fire-and-
  // forget (not awaited) so it never blocks first paint — defaults to
  // disabled (opt-in, not opt-out) until this resolves.
  useEffect(() => {
    void hydrateTelemetrySettings();
  }, []);

  // Client capture (window.onerror / unhandledrejection / long-task
  // PerformanceObserver) + shipper are installed only while the user has
  // actually opted in — never install-then-gate-at-emit-time. Subscribing
  // to the live `enabled` value (not a one-shot read at mount) means
  // checking the Settings toggle ON takes effect immediately instead of
  // requiring a reload, and returning the teardown functions from this
  // effect means React 19 StrictMode's dev-mode mount->cleanup->mount
  // tears down cleanly instead of leaking duplicate listeners/intervals.
  const telemetryEnabled = useTelemetrySettingsStore((s) => s.enabled);
  useEffect(() => {
    if (!telemetryEnabled) return;
    const uninstallCapture = installTelemetryCapture();
    const uninstallShipper = installTelemetryShipper(
      // Same deployment configuration model-store.ts's pre-existing client
      // uses (config.telemetryEndpoint/config.telemetryEnabled), not the
      // hardcoded-to-prod resolveTelemetryEndpoint()/enabled:true this had
      // before — a user's per-user opt-in must still respect the
      // deployment-level VITE_ENABLE_TELEMETRY kill switch and any
      // staging/custom VITE_TELEMETRY_ENDPOINT override, not bypass them.
      createTelemetryClient({
        endpoint: config.telemetryEndpoint,
        enabled: config.telemetryEnabled && !config.devMode,
        studioVersion: STUDIO_VERSION,
        uaClass: navigator.userAgent.includes('Mobile') ? 'mobile' : 'desktop'
      }),
      // Only backfill spans that predate this install when this transition
      // to enabled came from loading an already-persisted, returning
      // user's consent — never for a fresh explicit Settings-checkbox
      // toggle this session, which must not retroactively ship whatever
      // pre-consent activity happened to be sitting in the stores. A
      // one-shot getState() read (not the reactive `telemetryEnabled`
      // above) is correct here: this effect body only runs at the moment
      // of the true->transition, so this captures exactly "why did THIS
      // transition happen."
      { backfillPreInstall: useTelemetrySettingsStore.getState().enabledFromHydration }
    );
    return () => {
      uninstallCapture();
      uninstallShipper();
    };
  }, [telemetryEnabled]);

  // Theme — defaults to Daikonic. Override via ?theme=<name> query param
  // or localStorage. Use ?theme=default to revert to Refactory Dark.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryTheme = params.get('theme');
    const stored = window.localStorage.getItem('rune-studio:theme');
    const theme = queryTheme ?? stored ?? 'daikonic';
    if (queryTheme) window.localStorage.setItem('rune-studio:theme', queryTheme);
    if (theme && theme !== 'default') {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, []);

  // Keep filesRef in sync so the model-loading effect below can read the
  // current file list without stale-closure issues.
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Keep loadedModelsRef in sync so syncWorkspaceToEditor can read it
  // without needing useModelStore.getState() (unavailable in tests).
  const loadedModels = useModelStore((s) => s.models);
  useEffect(() => {
    loadedModelsRef.current = loadedModels;
  }, [loadedModels]);

  // Persist curated-bundle bindings whenever the active workspace has one
  // and the in-memory set changes. Without this, a refresh / switch / close
  // path rehydrates the workspace from IDB with `curatedModels: []` and the
  // explorer collapses from N curated namespaces to just the built-in 22
  // types (D1). The equality guard short-circuits the IDB write when the
  // binding identity is unchanged so a per-keystroke re-render doesn't
  // churn IndexedDB. Equality skips `loadedAt` because timestamps would
  // flap every load even when the bundle id+version is identical.
  //
  // Codex P1 (PR #220): the effect MUST wait for workspace-specific model
  // sync to complete before writing. During a switch A → B, the global
  // model-store still holds A's bundles for the brief window between
  // `setRestoredWorkspace(B)` and the completion of B's curated reloads.
  // Without `curatedSyncedWorkspaceId === restoredWorkspace.id`, the
  // first effect run after the switch would derive A's bundles, compare
  // against B's declared set, and overwrite B's record with stale A data.
  // `restoreWorkspace` flips the synced id ONLY after Promise.allSettled
  // over the declared loads, so by the time this gate opens the model-
  // store is a faithful projection of B's declared bindings.
  useEffect(() => {
    if (!restoredWorkspace) return;
    if (curatedSyncedWorkspaceId !== restoredWorkspace.id) return;
    for (const model of loadedModels.values()) {
      if (model.source.archiveUrl) unavailableCuratedBindingsRef.current.delete(model.source.id);
    }
    const nextBindings = deriveCuratedBindings(loadedModels, [...unavailableCuratedBindingsRef.current.values()]);
    const prevBindings = restoredWorkspace.curatedModels ?? [];
    if (curatedBindingsEqual(prevBindings, nextBindings)) return;
    const nextWorkspace = { ...restoredWorkspace, curatedModels: nextBindings };
    void persistence.saveWorkspace(nextWorkspace).catch((err) => {
      reportWorkspaceError('Failed to save curated bundle bindings to browser storage', err);
    });
    setRestoredWorkspace(nextWorkspace);
  }, [curatedSyncedWorkspaceId, loadedModels, reportWorkspaceError, restoredWorkspace]);

  useEffect(() => {
    if (bootState === 'restored') {
      document.body.setAttribute('data-workspace-active', 'true');
      return () => {
        document.body.removeAttribute('data-workspace-active');
      };
    }
    return undefined;
  }, [bootState]);

  // Cleanup reparse timer on unmount
  useEffect(() => {
    return () => {
      if (reparseTimerRef.current) clearTimeout(reparseTimerRef.current);
    };
  }, []);

  // LSP transport/client lifecycle is owned by LspProvider (mounted by
  // StudioProviders). It connects once on mount, re-syncs the doc-set on
  // useWorkspace().files changes, and exposes reconnect via useLsp().

  const handleFilesLoaded = useCallback(
    async (loadedFiles: WorkspaceFile[], targetWorkspaceId?: string) => {
      // Reference models selected on the launcher seed a new workspace.
      // An active workspace's bindings belong only to that workspace.
      const launcherModels = restoredWorkspaceRef.current ? new Map<string, LoadedModel>() : loadedModelsRef.current;
      clearWorkspaceState();
      const activationEpoch = workspaceEpochRef.current;
      setBootState('start');
      setLoading(true);
      try {
        let workspace = targetWorkspaceId ? await persistence.loadWorkspace(targetWorkspaceId) : null;
        if (activationEpoch !== workspaceEpochRef.current) return;
        let createdWorkspace = false;
        if (!workspace) {
          workspace = await createWorkspaceRecord(deriveWorkspaceName(loadedFiles));
          createdWorkspace = true;
        }
        if (launcherModels.size > 0) {
          workspace = { ...workspace, curatedModels: deriveCuratedBindings(launcherModels, workspace.curatedModels) };
          await persistence.saveWorkspace(workspace);
        }
        if (activationEpoch !== workspaceEpochRef.current) {
          if (createdWorkspace) {
            await persistence.deleteWorkspace(workspace.id);
            await deleteWorkspaceFiles(workspace.id);
          }
          return;
        }
        reconcileWorkspaceModels(workspace.curatedModels ?? []);
        restoredWorkspaceRef.current = workspace;
        setRestoredWorkspace(workspace);
        await saveWorkspaceFiles(workspace.id, loadedFiles);
        if (activationEpoch !== workspaceEpochRef.current) return;
        await syncWorkspaceToEditor(loadedFiles);
        if (restoredWorkspaceRef.current?.id !== workspace.id) return;
        setCuratedSyncedWorkspaceId(workspace.id);
        setBootState('restored');
        usePerspectiveStore.getState().setActivePerspective('explore');
      } catch (error) {
        if (activationEpoch === workspaceEpochRef.current) {
          setLoading(false);
          reportWorkspaceError('Failed to load workspace files', error);
        }
      }
    },
    [clearWorkspaceState, createWorkspaceRecord, reconcileWorkspaceModels, reportWorkspaceError, syncWorkspaceToEditor]
  );

  /**
   * Handle file content changes (e.g., from source editor edits).
   * Updates files immediately and debounce-reparses after 500ms idle.
   */
  const handleFilesChange = useCallback(
    (updatedFiles: WorkspaceFile[]) => {
      setFiles(updatedFiles);
      // LSP doc-set sync runs in LspProvider on the `files` change it observes.

      if (restoredWorkspace) {
        // Fire-and-forget from this caller's perspective (never awaited), so
        // its real completion time is otherwise invisible to anything
        // outside this closure. Fires on every editor transaction (up to
        // once per keystroke), so this is recorded via perf-log — NOT
        // useActivityStore.addActivity — to avoid flooding the user-visible
        // Activity panel's 200-entry ring buffer with a row per keystroke
        // and evicting the meaningful, infrequent entries it's meant to
        // hold. See perf-log.ts.
        const saveOpId = allocateOpId();
        recordPerfStart('workspaceSave', saveOpId);
        const saveStartedAt = performance.now();
        void saveWorkspaceFiles(restoredWorkspace.id, updatedFiles)
          .then(() => {
            recordPerf({
              op: 'workspaceSave',
              ok: true,
              durationMs: performance.now() - saveStartedAt,
              ts: performance.now(),
              opId: saveOpId
            });
          })
          .catch((err) => {
            recordPerf({
              op: 'workspaceSave',
              ok: false,
              durationMs: performance.now() - saveStartedAt,
              ts: performance.now(),
              opId: saveOpId
            });
            reportWorkspaceError('Failed to save workspace changes to browser storage; edits remain in memory', err);
          });
      }

      // Debounced reparse — wait for typing to settle. Same observability
      // rationale as the save above (perf-log, not the Activity panel): the
      // 500ms debounce plus the parse itself has no externally visible
      // completion signal otherwise, and fires up to once per keystroke.
      if (reparseTimerRef.current) clearTimeout(reparseTimerRef.current);
      editParseTokenRef.current += 1;
      const token = editParseTokenRef.current;
      const reparseOpId = allocateOpId();
      recordPerfStart('reparse', reparseOpId);
      // Captured BEFORE the timer is scheduled, not inside its callback —
      // the debounce wait is real, user-observed latency (the time from
      // "stopped typing" to "graph reflects it"), not just the parse call
      // itself. Measuring only the callback body would systematically
      // under-report by ~500ms.
      const reparseStartedAt = performance.now();
      reparseTimerRef.current = setTimeout(async () => {
        try {
          const result = await parseWorkspaceFiles(updatedFiles, {
            hydrateNamespaces: useEditorStore.getState().activeHydrationNamespaces()
          });
          // Superseded by a newer edit before this one finished — not the
          // operation that settled, so no perf entry for it.
          if (token !== editParseTokenRef.current) return;
          // Preserve the last valid graph/model while the user is mid-edit on
          // syntactically invalid text. The Problems panel still updates from
          // `parseErrors`, but the semantic workbench no longer flickers into a
          // partial recovery state for transient CodeMirror transactions.
          applyParseResult(result, { preserveSemanticModelOnErrors: true });
          recordPerf({
            op: 'reparse',
            ok: true,
            durationMs: performance.now() - reparseStartedAt,
            ts: performance.now(),
            opId: reparseOpId
          });
        } catch (error) {
          // Superseded by a newer edit before this one finished — same
          // check as the success path above. Without it, a stale reparse
          // that's already been discarded (a newer one is authoritative,
          // and may well have succeeded) still recorded itself as a
          // 'reparse failed' perf entry and surfaced a misleading error
          // toast for an attempt nothing depends on anymore.
          if (token !== editParseTokenRef.current) return;
          recordPerf({
            op: 'reparse',
            ok: false,
            durationMs: performance.now() - reparseStartedAt,
            ts: performance.now(),
            opId: reparseOpId
          });
          reportWorkspaceError('Failed to re-parse updated files; keeping the last valid graph', error);
        }
      }, 500);
    },
    [applyParseResult, reportWorkspaceError, restoredWorkspace]
  );

  const handleReset = useCallback(() => {
    clearWorkspaceState();
    reconcileWorkspaceModels([]);
    restoredWorkspaceRef.current = null;
    setRestoredWorkspace(null);
    setLoading(false);
    setBootState('start');
    usePerspectiveStore.getState().setActivePerspective('workspaces');
  }, [clearWorkspaceState, reconcileWorkspaceModels]);

  /** Switch to a recent workspace from the start page list (T029). */
  const handleSwitchWorkspace = useCallback(
    async (workspaceId: string) => {
      try {
        const ws = await persistence.loadWorkspace(workspaceId);
        if (!ws) {
          reportWorkspaceError('The selected workspace no longer exists in browser storage', workspaceId);
          return;
        }
        setBootState('restoring');
        const restored = await restoreWorkspace(ws);
        if (restored === 'superseded') return;
        if (restored === 'empty') {
          setBootState('start');
          setWorkspaceError(null);
          setWorkspaceNotice(null);
          // No files in this workspace — stay on the launcher.
          usePerspectiveStore.getState().setActivePerspective('workspaces');
          return;
        }
        setBootState('restored');
        setWorkspaceError(null);
        setWorkspaceNotice(null);
        // Workspace has files — move to the explore perspective.
        usePerspectiveStore.getState().setActivePerspective('explore');
      } catch (err) {
        reportWorkspaceError('Failed to switch workspaces', err);
      }
    },
    [reportWorkspaceError, restoreWorkspace]
  );

  useEffect(() => {
    setRuneStudioTestApi((current) => ({
      ...current,
      replaceWorkspaceFiles: async (workspaceFiles: WorkspaceFile[]) => {
        if (restoredWorkspace) {
          await saveWorkspaceFiles(restoredWorkspace.id, workspaceFiles);
        }
        await syncWorkspaceToEditor(workspaceFiles);
      },
      switchWorkspace: handleSwitchWorkspace,
      loadFiles: handleFilesLoaded
    }));
    return () => {
      setRuneStudioTestApi((current) => {
        if (!current) {
          return current;
        }
        const next = { ...current };
        delete next.replaceWorkspaceFiles;
        delete next.switchWorkspace;
        return next;
      });
    };
  }, [handleFilesLoaded, handleSwitchWorkspace, restoredWorkspace, syncWorkspaceToEditor]);

  const handleCreateWorkspace = handleReset;

  const getWorkspaceManager = useCallback(async (): Promise<WorkspaceManager> => {
    if (workspaceManagerRef.current) return workspaceManagerRef.current;
    const opfsRoot = await navigator.storage.getDirectory();
    workspaceManagerRef.current = new WorkspaceManager({
      opfsRoot,
      studioVersion: STUDIO_VERSION,
      tabId: `tab-${Date.now()}`
    });
    return workspaceManagerRef.current;
  }, []);

  // Sync-engine lifecycle: instantiate the engine when a git-backed workspace
  // becomes active and dispose it when the active workspace changes or is
  // cleared. A single effect watching `restoredWorkspace` covers every
  // transition — boot restore, workspace switch, reset, and delete.
  const prevRestoredWorkspaceIdRef = useRef<string | null>(null);
  useEffect(() => {
    const ws = restoredWorkspace;
    const prevId = prevRestoredWorkspaceIdRef.current;
    prevRestoredWorkspaceIdRef.current = ws?.id ?? null;

    // Dispose the engine for whichever workspace just became inactive.
    if (prevId && prevId !== ws?.id) {
      disposeSyncEngine(prevId);
    }

    // Instantiate the engine for the newly active git-backed workspace.
    if (!ws || ws.kind !== 'git-backed') return;
    const workspaceId = ws.id;
    const gitBacking = ws.gitBacking;
    let cancelled = false;
    void (async () => {
      try {
        const wm = await getWorkspaceManager();
        if (cancelled) return; // workspace changed during async getWorkspaceManager
        const fs = wm.getFs();
        // Token is no longer pre-loaded here — the engine's onAuth loads it
        // lazily on each isomorphic-git call so rotated tokens are always used.
        getOrCreateSyncEngine({ fs, workspaceId, gitBacking });
      } catch (err) {
        if (!cancelled) {
          console.warn('[git-sync] Failed to instantiate sync engine:', err);
          useOutputStore
            .getState()
            .addLine(fmtLine('git', 'sync engine failed', err instanceof Error ? err.message : String(err)), 'warn');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getWorkspaceManager, restoredWorkspace]);

  // Instance-store OPFS persistence wiring (spec 023 Task 13 bot-review
  // finding #1) — mirrors the sync-engine lifecycle effect above, but
  // unconditional on workspace kind: instance persistence is a data-layer
  // concern independent of git-backing, so it must wire up for EVERY
  // workspace (browser-only included), not just git-backed ones. Runs
  // `useInstanceStore.getState().setOpfsContext(fs, workspaceRoot)` — the
  // same `OpfsFs` the WorkspaceManager already owns, at that workspace's
  // `/${id}` root (the convention `WorkspaceManager.create`/`createGitBacked`
  // already use for `/${id}/files` and `/${id}/.studio`).
  useEffect(() => {
    if (!restoredWorkspace) return;
    const workspaceId = restoredWorkspace.id;
    let cancelled = false;
    void (async () => {
      try {
        const wm = await getWorkspaceManager();
        if (cancelled) return; // workspace changed during async getWorkspaceManager
        useInstanceStore.getState().setOpfsContext(wm.getFs(), `/${workspaceId}`);
      } catch (err) {
        if (!cancelled) {
          console.warn('[instance-store] Failed to wire OPFS persistence context:', err);
          useOutputStore
            .getState()
            .addLine(
              fmtLine(
                'workspace',
                'instance persistence unavailable',
                err instanceof Error ? err.message : String(err)
              ),
              'warn'
            );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getWorkspaceManager, restoredWorkspace]);

  const handleCreateGitBackedWorkspace = useCallback(
    async (input: { name: string; repoUrl: string; branch: string; user: string; token: string }) => {
      const wm = await getWorkspaceManager();
      // Prefer the caller-supplied name (FileLoader → GitHubWorkspaceFlow sends
      // `${user}/${repo}`); fall back to a URL-derived repo name only if the
      // caller omitted it.
      const fallbackName =
        input.repoUrl
          .replace(/\.git$/, '')
          .split('/')
          .pop() ?? 'workspace';
      const ws = await wm.createGitBacked({
        name: input.name || fallbackName,
        repoUrl: input.repoUrl,
        branch: input.branch,
        user: input.user,
        token: input.token
      });
      return { id: ws.id };
    },
    [getWorkspaceManager]
  );

  const handleGitHubWorkspaceCreated = useCallback(
    async (workspaceId: string) => {
      try {
        const loadedFiles = await loadWorkspaceFiles(workspaceId);
        if (loadedFiles.length > 0) {
          const wsFiles: WorkspaceFile[] = loadedFiles.map((f) => ({
            name: f.path.split('/').pop() ?? f.path,
            path: f.path,
            content: f.content,
            dirty: false,
            readOnly: false
          }));
          // Load INTO the freshly created git-backed workspace — pass it
          // explicitly so the launcher's "always create new" default does not
          // spawn a duplicate non-git workspace, and `restoredWorkspace` points
          // at the git workspace (activating its sync engine).
          handleFilesLoaded(wsFiles, workspaceId);
        }
      } catch (err) {
        reportWorkspaceError('Failed to load cloned workspace', err);
      }
    },
    [handleFilesLoaded, reportWorkspaceError]
  );

  /** Delete a recent workspace from the recents store (T029). */
  const handleDeleteWorkspace = useCallback(
    async (workspaceId: string) => {
      try {
        await persistence.deleteWorkspace(workspaceId);
        await deleteWorkspaceFiles(workspaceId);
        if (restoredWorkspace?.id === workspaceId) {
          handleReset();
        }
        setWorkspaceError(null);
        setWorkspaceNotice(null);
      } catch (err) {
        reportWorkspaceError('Failed to delete the selected workspace', err);
      }
    },
    [handleReset, reportWorkspaceError, restoredWorkspace]
  );

  // Merge reference model files into workspace when models change and re-parse
  // so the graph and explorer reflect the loaded reference types.
  useEffect(() => {
    const previousModels = lastModelMergeRef.current;
    lastModelMergeRef.current = loadedModels;
    if (previousModels && sameLoadedModelSources(previousModels, loadedModels)) {
      // setCuratedFiles publishes a result already applied by this App. A
      // pending model-merge parse predates that result and must not overwrite it.
      modelParseTokenRef.current += 1;
      return;
    }
    const epoch = workspaceEpochRef.current;
    const prev = filesRef.current;
    const hadModelFiles = prev.some((f) => f.path.startsWith('['));
    // Skip the no-op case: no models loaded and none to clean up.
    // When models are removed (size === 0 but hadModelFiles === true) we
    // still run so their read-only entries are stripped from the file set.
    if (loadedModels.size === 0 && !hadModelFiles) return;

    let merged = prev.filter((f) => !f.path.startsWith('['));
    for (const model of loadedModels.values()) {
      merged = mergeModelFiles(merged, model);
    }
    setFiles(merged);
    // LSP doc-set sync runs in LspProvider on the `files` change it observes.
    modelParseTokenRef.current += 1;
    const token = modelParseTokenRef.current;
    parseWorkspaceFiles(merged, { hydrateNamespaces: useEditorStore.getState().activeHydrationNamespaces() })
      .then((result) => {
        if (token !== modelParseTokenRef.current || epoch !== workspaceEpochRef.current) return;
        applyParseResult(result, { preserveSemanticModelOnErrors: true });
      })
      .catch((err) => {
        if (token !== modelParseTokenRef.current || epoch !== workspaceEpochRef.current) return;
        reportWorkspaceError(
          'Failed to re-parse the workspace after loading reference models; keeping the last valid graph',
          err
        );
      });
  }, [applyParseResult, loadedModels, reportWorkspaceError]);

  const userFiles = files.filter((f) => !f.readOnly);
  const hasWorkspace = userFiles.length > 0;
  const hasExploreContent = hasWorkspace || loadedModels.size > 0;

  const loadCuratedSource = useCallback(
    async (bundleId: string, version: string, namespace: string, expectedArtifactKey?: string) => {
      const epoch = workspaceEpochRef.current;
      const { artifactKey, documents } = await loadCuratedNamespaceSource(
        bundleId,
        version,
        namespace,
        expectedArtifactKey
      );
      if (epoch !== workspaceEpochRef.current) return;
      if (documents.length === 0) throw new Error('No source files are available for this namespace');
      const sourceByPath = new Map(
        documents
          .filter((doc) => doc.uri.startsWith(`${bundleId}/`))
          .map((doc) => [`[${bundleId}]/${doc.uri.slice(bundleId.length + 1)}`, doc.content])
      );
      if (sourceByPath.size === 0) return;
      const store = useModelStore.getState();
      const model = store.models.get(bundleId);
      if (model) {
        store.setCuratedFiles(
          bundleId,
          model.files.map((file) => {
            const content = sourceByPath.get(`[${bundleId}]/${file.path}`);
            return content === undefined || (file.artifactKey && file.artifactKey !== artifactKey)
              ? file
              : { ...file, content, sourceLoaded: true };
          })
        );
      }
      setFiles((current) => {
        let changed = false;
        const updated = current.map((file) => {
          const content = sourceByPath.get(file.path);
          if (
            content === undefined ||
            (file.artifactKey && file.artifactKey !== artifactKey) ||
            (file.content === content && file.sourceLoaded)
          )
            return file;
          changed = true;
          return { ...file, content, sourceLoaded: true };
        });
        return changed ? updated : current;
      });
    },
    []
  );

  // Build the WorkspaceActionsContext value from App's handlers so
  // WorkspacesPerspective (and any future perspective) can call them
  // without prop-drilling through PerspectiveHost.
  const workspaceActionsValue = useMemo(
    () => ({
      files,
      onFilesLoaded: handleFilesLoaded,
      createGitBackedWorkspace: handleCreateGitBackedWorkspace,
      onGitHubWorkspaceCreated: handleGitHubWorkspaceCreated,
      onOpenWorkspace: handleSwitchWorkspace,
      onCreateWorkspace: handleCreateWorkspace,
      onDeleteWorkspace: handleDeleteWorkspace,
      // EditorPage-facing actions (formerly EditorPage props), now sourced
      // from context so App no longer threads them through <EditorPage>.
      onFilesChange: handleFilesChange,
      loadCuratedSource,
      onClose: handleReset,
      onSwitchWorkspace: handleSwitchWorkspace
    }),
    [
      files,
      handleFilesLoaded,
      handleCreateGitBackedWorkspace,
      handleGitHubWorkspaceCreated,
      handleSwitchWorkspace,
      handleCreateWorkspace,
      handleDeleteWorkspace,
      handleFilesChange,
      loadCuratedSource,
      handleReset
    ]
  );

  // WorkspaceState published to WorkspaceProvider — the current-model data
  // ExplorePerspective and the Lsp/Codegen providers read via useWorkspace().
  const workspaceStateValue = useMemo(
    () => ({
      workspaceId: restoredWorkspace?.id,
      workspaceKind: restoredWorkspace?.kind,
      workspaceName: restoredWorkspace?.name,
      fileCount: files.filter((f) => !f.readOnly).length,
      files,
      models,
      parsedModels,
      deferredExports,
      parseErrors
    }),
    [restoredWorkspace, files, models, parsedModels, deferredExports, parseErrors]
  );

  return (
    <StudioProviders state={workspaceStateValue} actions={workspaceActionsValue}>
      <div className="studio-app flex flex-col h-full text-foreground bg-background">
        {/* Screen-reader + test accessible file count — always in DOM so the
         * App-restore test can confirm file loading without ExplorePerspective mounted. */}
        {userFiles.length > 0 && (
          <span className="sr-only" role="status" aria-live="polite">
            {userFiles.length} file(s)
          </span>
        )}
        <AppHeader hasWorkspace={hasWorkspace} hasExploreContent={hasExploreContent} />

        <main className="flex-1 overflow-hidden relative">
          {(bootState === 'checking' || bootState === 'restoring') && (
            <div
              className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground text-md"
              data-testid="boot-spinner"
            >
              <Spinner className="size-8 text-primary" />
              <p>{bootState === 'restoring' ? 'Restoring workspace…' : 'Loading…'}</p>
            </div>
          )}

          {bootState !== 'checking' && bootState !== 'restoring' && loading && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground text-md">
              <Spinner className="size-8 text-primary" />
              <p>Parsing files…</p>
            </div>
          )}

          {/* Single app shell — rendered whenever past boot/restoring,
           * regardless of whether a workspace is loaded. ActivityBar +
           * PerspectiveHost are always reachable so the Workspaces launcher
           * (WorkspacesPerspective) is available from the rail. PerspectiveHost
           * owns the Explore workbench (ExplorePerspective), which it keeps
           * mounted (display:none when inactive) and falls back away from when
           * no workspace exists. The start-page JSX lives INSIDE
           * WorkspacesPerspective. Workspace data flows to ExplorePerspective
           * and the perspectives via context (useWorkspace / useLsp /
           * useWorkspaceActions) — all provided by StudioProviders. */}
          {bootState !== 'checking' && bootState !== 'restoring' && !loading && (
            <div className="flex h-full w-full min-h-0">
              <ActivityBar hasWorkspace={hasWorkspace} hasExploreContent={hasExploreContent} />
              <PerspectiveHost
                hasWorkspace={hasWorkspace}
                hasExploreContent={hasExploreContent}
                workspaceId={restoredWorkspace?.id}
                workspaceKind={restoredWorkspace?.kind}
                files={files}
              />
            </div>
          )}
        </main>
      </div>
    </StudioProviders>
  );
}

export const App = withInstrumentation(
  function App() {
    return (
      <StudioToastProvider>
        <AppContent />
      </StudioToastProvider>
    );
  },
  { op: 'App' }
);
