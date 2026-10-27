// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { recordOperation } from '../../services/operation-feedback.js';
import type React from 'react';
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useEditorStore } from '@rune-langium/visual-editor';
import { useStudioToast } from '../../components/StudioToastProvider.js';
import { resolveEditorFilePath } from '../explore-file-nav-store.js';
import { useWorkspace } from './workspace-context.js';
import { useProject } from './project-context.js';
import { createProjectWorkerBridge } from '../../services/project-worker-bridge.js';
import { createProjectCaptureBarrier } from '../../services/project-capture-barrier.js';
import { projectReceiptMatches } from '@rune-langium/project-runtime/receipt';
import type { ProjectResolutionReceipt } from '@rune-langium/core/project-contract';
import { usePreviewStore } from '../../store/preview-store.js';
import { useCodegenStore } from '../../store/codegen-store.js';
import { useInstanceStore } from '../../store/instance-store.js';
import { useOutputStore, fmtLine } from '../../store/output-store.js';
import { useActivityStore } from '../../store/activity-store.js';
import {
  createPreviewGenerateMessage,
  createPreviewSetFilesMessage,
  isPreviewWorkerMessage,
  isPreviewExecuteResultMessage,
  isPreviewExecuteErrorMessage,
  isPreviewFilesReadyMessage,
  isInstanceValidateResultMessage,
  isInstanceGenerateSchemaResultMessage,
  isInstanceGenerateSchemaStaleMessage,
  type PreviewFileEntry
} from '../../services/codegen-service.js';
import { createInstanceReadiness } from '../../services/instance-readiness.js';
import { createPreviewSessionClient, isPrototypeSessionRequest } from '../../services/preview-session-client.js';
import type { InstanceReadiness } from '../../services/instance-readiness.js';
import {
  ProjectPreviewReadinessContext,
  PreviewSessionContext,
  type PreviewSessionFactory
} from './preview-session-context.js';
import { pathToUri } from '../../utils/uri.js';
import { getRuneStudioTestApi } from '../../test-api.js';
import { BUNDLE_MARKER_SUFFIX, type WorkspaceFile } from '../../services/workspace.js';
import type { CodegenWorkerMessage } from '../../components/CodePreviewPanel.js';
import { HydrationOrchestrator, MAX_HYDRATION_RETRIES_PER_TARGET } from '../../services/hydration-orchestrator.js';
import type { DeferredExportEntry } from '../../workers/parser-worker.js';
import { routeTelemetryRecord } from '../../services/instrumentation/browser-sink.js';
import { isTelemetryRecordMessage } from '../../services/instrumentation/worker-sink.js';
import { withInstrumentation } from '../../services/instrumentation/core.js';
import { RetryExhaustedError } from '../../services/instrumentation/errors.js';
import type { InstrumentationNamespace } from '../../services/instrumentation/namespace.js';

/** Only catalog stubs need hydration; complete serialized definitions are already in the worker file set. */
function curatedDeferredExports(
  deferredExports: DeferredExportEntry[],
  files: readonly WorkspaceFile[]
): DeferredExportEntry[] {
  // /api/parse includes user declarations in deferredExports so Explorer can
  // locate them. They are already present in the worker's source file set;
  // requesting curated hydration for one can never complete.
  const availablePaths = new Set(
    files.filter((file) => !file.bundleId || Boolean(file.serializedModelJson)).map((file) => file.path)
  );
  return deferredExports.filter(
    (entry) => !availablePaths.has(resolveEditorFilePath(entry.filePath, files) ?? entry.filePath)
  );
}

/**
 * Find curated namespaces exporting an unresolved name. Several namespaces
 * may export the same name, so every candidate is hydrated before retrying.
 */
function findNamespacesForExport(deferredExports: DeferredExportEntry[], name: string): string[] {
  return deferredExports.filter((entry) => entry.exports.some((e) => e.name === name)).map((entry) => entry.namespace);
}

function findNamespacesForType(deferredExports: DeferredExportEntry[], typeFqn: string): string[] {
  return deferredExports
    .filter((entry) => entry.exports.some((entryExport) => `${entry.namespace}.${entryExport.name}` === typeFqn))
    .map((entry) => entry.namespace);
}

function findUnhydratedNamespacesForUnresolved(
  deferredExports: DeferredExportEntry[],
  files: readonly WorkspaceFile[],
  names: readonly string[],
  hydratedNamespaces: readonly string[]
): string[] {
  const hydrated = new Set(hydratedNamespaces);
  const curatedExports = curatedDeferredExports(deferredExports, files);
  return [...new Set(names.flatMap((name) => findNamespacesForExport(curatedExports, name)))].filter(
    (namespace) => !hydrated.has(namespace)
  );
}

/** Extracts the referenced type names out of a form-preview schema's
 *  `unsupportedFeatures` list's `unresolved-reference:<name>` entries. */
function extractUnresolvedNames(unsupportedFeatures: string[] | undefined): string[] {
  return (unsupportedFeatures ?? [])
    .filter((f) => f.startsWith('unresolved-reference:'))
    .map((f) => f.slice('unresolved-reference:'.length));
}

const reportHydrationRetryExhausted = withInstrumentation(
  function reportHydrationRetryExhausted(targetId: string, attempts: number): never {
    throw new RetryExhaustedError(targetId, attempts);
  },
  {
    op: 'hydrationRetryExhausted',
    // Handled: the call site below wraps this in an empty try/catch,
    // deliberately swallowing it to preserve existing UX (established in
    // the original instrumentation-wrapper plan's Task 8) — 'warn', not
    // the default 'error'. namespace: 'curated' is what makes the Toast
    // and Activity sinks pick it up: today, exhausting the curated-
    // hydration retry budget gives the user zero feedback; this is the
    // first thing that changes that.
    handled: true,
    namespace: 'curated' satisfies InstrumentationNamespace,
    message: 'Preview refresh exhausted its retry budget',
    // targetId is deliberately NOT captured: a preview target can be a
    // user-authored type fqn, not just a curated id. Error-class name +
    // attempt count are structurally safe.
    sanitizeError: (err) => ({
      signature: err instanceof Error ? err.name : 'Error',
      context: err instanceof RetryExhaustedError ? { attempts: err.attempts } : undefined
    })
  }
);

export const CodegenProvider = withInstrumentation(
  function CodegenProvider({ children }: { children: React.ReactNode }): React.ReactElement {
    const { files, deferredExports, workspaceId } = useWorkspace();
    const { runtime: projectRuntime } = useProject();
    const projectRuntimeRef = useRef(projectRuntime);
    projectRuntimeRef.current = projectRuntime;
    const captureBarrierRef = useRef<ReturnType<typeof createProjectCaptureBarrier> | null>(null);
    if (!captureBarrierRef.current) captureBarrierRef.current = createProjectCaptureBarrier();
    useLayoutEffect(() => {
      captureBarrierRef.current!.update(workspaceId, projectRuntime);
    }, [workspaceId, projectRuntime]);
    useEffect(() => () => captureBarrierRef.current?.reset(), []);
    const [codegenWorker, setCodegenWorker] = useState<Worker | null>(null);
    const [previewSessionFactory, setPreviewSessionFactory] = useState<PreviewSessionFactory | null>(null);

    const previewRequestSequenceRef = useRef(0);
    const currentPreviewRequestIdRef = useRef<string | undefined>(undefined);
    const codegenCurrentRequestIdRef = useRef<string>('');
    const orchestratorRef = useRef<HydrationOrchestrator | null>(null);
    const readinessRef = useRef<InstanceReadiness | null>(null);
    const hydrationNonce = useEditorStore((state) => state.hydrationNonce);
    const filesRef = useRef(files);
    const deferredExportsRef = useRef(deferredExports);
    const workspaceEpochRef = useRef(0);
    const committedFilesVersionRef = useRef(0);
    const committedHydratedNamespacesRef = useRef(new Set<string>());
    const workerFilesRevisionRef = useRef(0);
    const instanceHydrationSequenceRef = useRef(0);
    const workerFileWaitersRef = useRef(
      new Map<
        string,
        {
          epoch: number;
          filesRevision: number;
          receipt?: ProjectResolutionReceipt;
          resolve: (revision: number) => void;
          reject: (reason: Error) => void;
        }
      >()
    );
    const workspaceCommitWaitersRef = useRef(
      new Set<{ afterVersion: number; namespace: string; resolve: () => void; reject: (reason: Error) => void }>()
    );
    filesRef.current = files;
    deferredExportsRef.current = deferredExports;

    // A hydration callback is delivered from the editor store before React has
    // committed App's merged curated files. This layout effect is the concrete
    // boundary after which filesRef is a real committed workspace snapshot.
    useLayoutEffect(() => {
      const version = ++committedFilesVersionRef.current;
      const definedNamespaces = new Set(
        files.flatMap((file) => (file.serializedModelJson && file.namespace ? [file.namespace] : []))
      );
      committedHydratedNamespacesRef.current = new Set(
        useEditorStore.getState().hydratedNamespaces.filter((namespace) => definedNamespaces.has(namespace))
      );
      for (const waiter of workspaceCommitWaitersRef.current) {
        // A closure can already contain this namespace; marking it hydrated
        // then commits no new files. Still wait for this React commit before
        // acknowledging that existing serialized definition to the worker.
        if (version > waiter.afterVersion && definedNamespaces.has(waiter.namespace)) {
          workspaceCommitWaitersRef.current.delete(waiter);
          waiter.resolve();
        }
      }
    }, [files, hydrationNonce]);

    const { showToast } = useStudioToast();
    const previewSelectedTargetId = usePreviewStore((s) => s.selectedTargetId);
    const setWorkerRef = usePreviewStore((s) => s.setWorkerRef);
    const receivePreviewResult = usePreviewStore((s) => s.receivePreviewResult);
    const receivePreviewStale = usePreviewStore((s) => s.receivePreviewStale);
    const receiveExecutionResult = usePreviewStore((s) => s.receiveExecutionResult);
    const receiveExecutionError = usePreviewStore((s) => s.receiveExecutionError);
    const receiveValidateResult = usePreviewStore((s) => s.receiveValidateResult);
    const setHydrationRetriesRemaining = usePreviewStore((s) => s.setHydrationRetriesRemaining);
    const clearHydrationRetriesRemaining = usePreviewStore((s) => s.clearHydrationRetriesRemaining);

    // Owns the HydrationOrchestrator instance for this provider's lifetime.
    // Constructed inside a mount effect (not lazily on render) so it survives
    // React StrictMode's mount→unmount→remount double-invoke cleanly: the
    // cleanup disposes the orchestrator (unsubscribing from useEditorStore),
    // and the second mount constructs a fresh one — no leaked subscriptions.
    useEffect(() => {
      let lastHydrationNonce = useEditorStore.getState().hydrationNonce;
      const orchestrator = new HydrationOrchestrator({
        getHydratedNamespaces: () => useEditorStore.getState().hydratedNamespaces,
        getPendingHydrationNamespaces: () => useEditorStore.getState().pendingHydrationNamespaces,
        requestNamespaceHydration: (ns) => useEditorStore.getState().requestNamespaceHydration(ns),
        // useEditorStore.subscribe takes a single listener `(state) => void` —
        // no selector argument (the store is plain create() + temporal, not
        // wrapped in subscribeWithSelector; a two-argument form would silently
        // be ignored). Diff hydrationNonce manually to detect a hydration round.
        subscribeToHydrationChange: (onChange) =>
          useEditorStore.subscribe((state, previous) => {
            if (state.hydrationNonce !== lastHydrationNonce) {
              lastHydrationNonce = state.hydrationNonce;
              const preview = usePreviewStore.getState();
              const target = preview.selectedTarget;
              if (
                target &&
                preview.status.state === 'unavailable' &&
                preview.status.reason === 'unsupported-target' &&
                previous.pendingHydrationNamespaces.includes(target.namespace) &&
                state.hydratedNamespaces.includes(target.namespace)
              )
                preview.beginPreviewGeneration(target.id);
              onChange();
            }
          })
      });
      orchestratorRef.current = orchestrator;
      return () => {
        orchestrator.dispose();
        orchestratorRef.current = null;
      };
    }, []);

    const handlePreviewWorkerFailure = useCallback(
      (baseMessage: string, error: unknown, targetId?: string, options?: { toast?: boolean }) => {
        const detail =
          error instanceof Error
            ? error.message
            : typeof error === 'object' && error && 'type' in error && error.type === 'messageerror'
              ? 'A preview worker message could not be deserialized.'
              : typeof error === 'object' && error && 'message' in error && typeof error.message === 'string'
                ? error.message
                : 'Reload Studio to restore form preview.';
        receivePreviewStale({
          targetId,
          reason: 'generation-error',
          message: `${baseMessage} ${detail}`.trim()
        });
        console.error(`[CodegenProvider] ${baseMessage}`, error);
        recordOperation('preview', `${baseMessage} ${detail}`, 'error', {
          op: 'preview',
          subject: targetId
        });
        if (options?.toast ?? true) {
          showToast({
            title: 'Form preview unavailable',
            description: `${baseMessage} ${detail}`.trim(),
            variant: 'destructive'
          });
        }
      },
      [receivePreviewStale, showToast]
    );

    const syncWorkerFiles = useCallback(
      (worker: Worker, signal?: AbortSignal): Promise<number> => {
        const runtime = projectRuntimeRef.current;
        const project = runtime?.status === 'captured' ? runtime.input : undefined;
        const codegenFiles: Array<{ uri: string; content: string }> = [];
        const previewFiles: PreviewFileEntry[] = [];
        for (const file of filesRef.current) {
          if (!file.readOnly) codegenFiles.push({ uri: pathToUri(file.path), content: file.content });
          if (file.path.endsWith(BUNDLE_MARKER_SUFFIX) || (file.refOnly && !file.serializedModelJson)) continue;
          previewFiles.push({
            uri: pathToUri(file.path),
            content: file.content,
            // The captured project already owns these serialized bytes. Sending
            // them here too clones the entire cohort twice into the worker.
            ...(project && file.refOnly
              ? { refOnly: true }
              : file.serializedModelJson
                ? { serializedModelJson: file.serializedModelJson }
                : {})
          });
        }
        const requestId = `preview:files:${++previewRequestSequenceRef.current}`;
        const filesRevision = ++workerFilesRevisionRef.current;
        const epoch = workspaceEpochRef.current;
        const projectUnavailable =
          runtime && runtime.status !== 'legacy' && !project
            ? runtime.diagnostics.map((issue) => issue.message).join('\n') ||
              'Applying the current project configuration…'
            : undefined;
        currentPreviewRequestIdRef.current = requestId;
        return new Promise<number>((resolve, reject) => {
          const abort = () => {
            workerFileWaitersRef.current.delete(requestId);
            reject(new DOMException('Worker file synchronization was cancelled.', 'AbortError'));
          };
          if (signal?.aborted) return abort();
          signal?.addEventListener('abort', abort, { once: true });
          workerFileWaitersRef.current.set(requestId, {
            epoch,
            filesRevision,
            receipt: project?.receipt,
            resolve: (revision) => {
              signal?.removeEventListener('abort', abort);
              resolve(revision);
            },
            reject: (reason) => {
              signal?.removeEventListener('abort', abort);
              reject(reason);
            }
          });
          try {
            worker.postMessage({
              type: 'codegen:setFiles',
              files: codegenFiles
            });
            worker.postMessage({
              ...createPreviewSetFilesMessage(previewFiles, requestId, filesRevision),
              ...(project ? { project } : {}),
              ...(projectUnavailable ? { projectUnavailable } : {})
            });
          } catch (error) {
            workerFileWaitersRef.current.delete(requestId);
            signal?.removeEventListener('abort', abort);
            handlePreviewWorkerFailure('Preview worker could not process updated files.', error);
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      },
      [handlePreviewWorkerFailure]
    );

    const prepareWorkerFiles = useCallback(
      (worker: Worker, signal: AbortSignal) => {
        const runtime = projectRuntimeRef.current;
        if (!runtime || runtime.status === 'legacy') return syncWorkerFiles(worker, signal);
        return captureBarrierRef.current!.waitCurrent(signal).then(() => syncWorkerFiles(worker, signal));
      },
      [syncWorkerFiles]
    );

    const waitForCommittedWorkspaceFiles = useCallback(
      (afterVersion: number, namespace: string, signal: AbortSignal): Promise<void> => {
        if (signal.aborted)
          return Promise.reject(new DOMException('Instance preparation was cancelled.', 'AbortError'));
        if (committedFilesVersionRef.current > afterVersion) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
          const waiter = {
            afterVersion,
            namespace,
            resolve: () => {
              signal.removeEventListener('abort', abort);
              resolve();
            },
            reject: (reason: Error) => {
              signal.removeEventListener('abort', abort);
              reject(reason);
            }
          };
          const abort = () => {
            workspaceCommitWaitersRef.current.delete(waiter);
            reject(new DOMException('Instance preparation was cancelled.', 'AbortError'));
          };
          signal.addEventListener('abort', abort, { once: true });
          workspaceCommitWaitersRef.current.add(waiter);
        });
      },
      []
    );

    const hydrateNamespaceForInstance = useCallback(
      (namespace: string, signal: AbortSignal): Promise<void> => {
        const orchestrator = orchestratorRef.current;
        if (!orchestrator) return Promise.reject(new Error('Curated hydration is unavailable.'));
        const targetId = `instance-readiness:${++instanceHydrationSequenceRef.current}`;
        return new Promise<void>((resolve, reject) => {
          let settled = false;
          const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', onAbort);
            if (error) reject(error);
            else resolve();
          };
          const onAbort = () => finish(new DOMException('Instance preparation was cancelled.', 'AbortError'));
          if (signal.aborted) return onAbort();
          signal.addEventListener('abort', onAbort, { once: true });
          orchestrator.requestHydration(namespace, {
            retryFor: {
              targetId,
              onRetry: () => {
                // HydrationOrchestrator intentionally fires on both success and
                // dequeue-after-failure. Instance readiness must distinguish
                // those outcomes rather than retrying a failed namespace forever.
                if (useEditorStore.getState().hydratedNamespaces.includes(namespace)) {
                  if (committedHydratedNamespacesRef.current.has(namespace)) {
                    finish();
                  } else {
                    const versionBeforeCommit = committedFilesVersionRef.current;
                    void waitForCommittedWorkspaceFiles(versionBeforeCommit, namespace, signal).then(
                      () => finish(),
                      (error: unknown) => finish(error instanceof Error ? error : new Error(String(error)))
                    );
                  }
                } else {
                  finish(new Error(`Could not hydrate curated namespace ${namespace}. Retry to try again.`));
                }
              }
            }
          });
        });
      },
      [waitForCommittedWorkspaceFiles]
    );

    useEffect(() => {
      workspaceEpochRef.current++;
      useInstanceStore.getState().advanceWorkspaceEpoch();
    }, [workspaceId]);

    // Initialise dedicated codegen worker once on mount.
    useEffect(() => {
      let worker: Worker | null = null;
      try {
        worker =
          getRuneStudioTestApi()?.createCodegenWorker?.() ??
          new Worker(new URL('../../workers/codegen-worker.ts', import.meta.url), {
            type: 'module'
          });
        worker = createProjectWorkerBridge(worker, () => {
          const runtime = projectRuntimeRef.current;
          return { managed: Boolean(runtime && runtime.status !== 'legacy'), receipt: runtime?.input?.receipt };
        });
        setCodegenWorker(worker);
      } catch (error) {
        setCodegenWorker(null);
        handlePreviewWorkerFailure('Preview worker could not start.', error);
        return;
      }
      return () => {
        // Cleanup runs only on unmount (handlePreviewWorkerFailure is stable),
        // so no setCodegenWorker(null) here — the component is going away and a
        // state update on unmount is pointless.
        worker?.terminate();
      };
    }, [handlePreviewWorkerFailure]);

    // Normal workspace updates use the same file-sync receipt as instance
    // readiness. This effect precedes the selected-target effect so that a
    // selected target's explicit preview request remains the current reply.
    useEffect(() => {
      if (!codegenWorker) return;
      const epoch = workspaceEpochRef.current;
      void syncWorkerFiles(codegenWorker)
        .then(() => {
          if (workspaceEpochRef.current === epoch) useInstanceStore.getState().revalidateInstances();
        })
        .catch(() => {
          // Worker failure is reported by the shared synchronization path.
        });
    }, [codegenWorker, files, syncWorkerFiles, projectRuntime?.input, projectRuntime?.status]);

    // Trigger form preview whenever the selected target changes. Files are
    // already current from the effect above; this effect only updates the target.
    useEffect(() => {
      if (!codegenWorker || !previewSelectedTargetId) return;
      if (projectRuntime && projectRuntime.status !== 'legacy' && projectRuntime.status !== 'captured') return;
      usePreviewStore.getState().beginPreviewGeneration(previewSelectedTargetId);
      const requestId = `preview:${previewSelectedTargetId}:${++previewRequestSequenceRef.current}`;
      currentPreviewRequestIdRef.current = requestId;
      try {
        codegenWorker.postMessage(createPreviewGenerateMessage(previewSelectedTargetId, requestId));
      } catch (error) {
        handlePreviewWorkerFailure(
          'Preview worker could not start generation for the selected type.',
          error,
          previewSelectedTargetId
        );
      }
    }, [
      codegenWorker,
      handlePreviewWorkerFailure,
      previewSelectedTargetId,
      projectRuntime?.input,
      projectRuntime?.status
    ]);

    useEffect(() => {
      if (!codegenWorker) return;
      setWorkerRef(codegenWorker);
      const readiness = createInstanceReadiness({
        findNamespaces: (typeFqn) =>
          findNamespacesForType(curatedDeferredExports(deferredExportsRef.current, filesRef.current), typeFqn),
        findNamespacesForUnresolved: (names) =>
          findUnhydratedNamespacesForUnresolved(
            deferredExportsRef.current,
            filesRef.current,
            names,
            useEditorStore.getState().hydratedNamespaces
          ),
        hydrate: hydrateNamespaceForInstance,
        waitForWorkerFiles: (signal) => prepareWorkerFiles(codegenWorker, signal)
      });
      readinessRef.current = readiness;
      setPreviewSessionFactory(() => () => createPreviewSessionClient(codegenWorker, readiness));
      useInstanceStore.getState().setWorker(codegenWorker);
      useInstanceStore.getState().setReadiness(readiness);
      function handleMessage(e: MessageEvent<unknown>) {
        const msg = e.data;
        if (isTelemetryRecordMessage(msg)) {
          routeTelemetryRecord(msg.record);
          return;
        }
        if (isPreviewFilesReadyMessage(msg)) {
          const waiter = workerFileWaitersRef.current.get(msg.requestId);
          if (!waiter) return;
          workerFileWaitersRef.current.delete(msg.requestId);
          if (waiter.epoch !== workspaceEpochRef.current) {
            waiter.reject(new Error('Workspace changed before worker files were ready.'));
          } else if (waiter.filesRevision !== msg.filesRevision) {
            waiter.reject(
              new Error(`Worker acknowledged files revision ${msg.filesRevision}; expected ${waiter.filesRevision}.`)
            );
          } else if (msg.projectError) {
            waiter.reject(new Error(msg.projectError));
          } else if (
            waiter.receipt ? !projectReceiptMatches(waiter.receipt, msg.projectReceipt) : Boolean(msg.projectReceipt)
          ) {
            waiter.reject(new Error('Worker project receipt does not match the requested source and configuration.'));
          } else {
            waiter.resolve(msg.filesRevision);
          }
          return;
        }
        if (isPreviewExecuteResultMessage(msg)) {
          if (isPrototypeSessionRequest(msg.requestId)) return;
          receiveExecutionResult(msg.funcName, msg.output, msg.requestId);
          return;
        }
        if (isPreviewExecuteErrorMessage(msg)) {
          if (isPrototypeSessionRequest(msg.requestId)) return;
          receiveExecutionError(msg.funcName, msg.error, msg.requestId);
          return;
        }
        if (isInstanceValidateResultMessage(msg)) {
          useInstanceStore.getState().receiveValidateResult(msg.requestId, msg.diagnostics);
          receiveValidateResult(msg.requestId, msg.diagnostics);
          return;
        }
        // Instance-store's schema fetches use their OWN `instance:generateSchema`/
        // `instance:generateSchemaResult`/`instance:generateSchemaStale` worker
        // messages (finding #6/#7 fix) — a completely distinct channel from
        // `preview:generate`/`preview:result`/`preview:stale`, so there's no
        // ambiguity to disambiguate here and no risk of leaking into
        // usePreviewStore (or of an instance schema fetch corrupting the
        // codegen worker's `lastPreviewTargetId`/`lastPreviewRequestId`, which
        // `preview:setFiles` re-runs preview generation against).
        if (isInstanceGenerateSchemaResultMessage(msg)) {
          if (isPrototypeSessionRequest(msg.requestId)) return;
          const unresolvedNamespaces = findUnhydratedNamespacesForUnresolved(
            deferredExportsRef.current,
            filesRef.current,
            extractUnresolvedNames(msg.schema.unsupportedFeatures),
            useEditorStore.getState().hydratedNamespaces
          );
          if (unresolvedNamespaces.length === 0) {
            useInstanceStore.getState().receiveSchemaResult(msg.requestId, msg.schema);
            return;
          }
          const controller = new AbortController();
          void readiness.hydrateSchemaDependencies(msg.schema, controller.signal).then(
            (hydrated) => {
              const store = useInstanceStore.getState();
              if (!hydrated) {
                store.receiveSchemaResult(msg.requestId, msg.schema);
                return;
              }
              const typeFqn = store.discardSchemaResult(msg.requestId);
              if (!typeFqn) return;
              store.dispatchGenerateSchema(typeFqn);
              for (const [id, instance] of Object.entries(store.instances)) {
                if (instance.typeFqn === typeFqn) store.dispatchValidate(id);
              }
            },
            () => useInstanceStore.getState().receiveSchemaResult(msg.requestId, msg.schema)
          );
          return;
        }
        if (isInstanceGenerateSchemaStaleMessage(msg)) {
          useInstanceStore.getState().receiveSchemaStale(msg.requestId, msg.reason, msg.message);
          return;
        }
        // Preview messages below — execution messages above bypass stale-check
        // since they carry their own funcName-based keying
        if (!isPreviewWorkerMessage(e.data)) return;
        if (e.data.requestId !== currentPreviewRequestIdRef.current) {
          return;
        }
        if (e.data.type === 'preview:result') {
          receivePreviewResult(e.data.schema);
          const targetId = e.data.schema.targetId;
          const unresolvedNames = extractUnresolvedNames(e.data.schema.unsupportedFeatures);
          const orchestrator = orchestratorRef.current;
          if (orchestrator) {
            if (unresolvedNames.length === 0) {
              orchestrator.markResolved(targetId);
              clearHydrationRetriesRemaining(targetId);
            } else {
              const namespacesToHydrate = new Set(
                findUnhydratedNamespacesForUnresolved(
                  deferredExportsRef.current,
                  filesRef.current,
                  unresolvedNames,
                  useEditorStore.getState().hydratedNamespaces
                )
              );
              if (namespacesToHydrate.size === 0) {
                // No unresolved name maps to a known deferred (curated, not-yet-
                // hydrated) export -- every one is genuinely unresolved (a typo, a
                // type absent from the curated manifest, etc). Don't spend a retry
                // attempt on a round that can't possibly hydrate anything: doing so
                // would silently drain this target's budget on noise, potentially
                // starving a LATER round where a real, resolvable reference shows up
                // on the same target.
                clearHydrationRetriesRemaining(targetId);
              } else {
                const canRetry = orchestrator.beginRetryRound(targetId);
                if (canRetry) {
                  for (const namespace of namespacesToHydrate) {
                    orchestrator.requestHydration(namespace, {
                      retryFor: {
                        targetId,
                        onRetry: () => {
                          // Deferred by one macrotask: onRetry fires synchronously from
                          // inside markNamespacesHydrated's zustand set() call, which can
                          // race ahead of this component's OWN files-sync effect (which
                          // resends preview:setFiles with the newly-hydrated content one
                          // React commit later). Without this defer, the retry can reach
                          // the worker before the new content does and fail identically,
                          // burning an attempt for no reason (self-healing via the next
                          // requestHydration round regardless, but this makes it
                          // deterministic instead of relying on the cap to paper over
                          // the race — see design doc §Architecture "Retry-post ordering").
                          // The live-selection re-check below additionally guards
                          // against a race with the user switching the Form Preview
                          // selection to a different target while this retry was
                          // in flight — without it, this callback would clobber
                          // currentPreviewRequestIdRef for whatever is now selected.
                          usePreviewStore.getState().beginPreviewGeneration(targetId);
                          setTimeout(() => {
                            if (!codegenWorker) return;
                            if (usePreviewStore.getState().selectedTargetId !== targetId) return;
                            const requestId = `preview:${targetId}:${++previewRequestSequenceRef.current}`;
                            currentPreviewRequestIdRef.current = requestId;
                            codegenWorker.postMessage(createPreviewGenerateMessage(targetId, requestId));
                          }, 0);
                        }
                      }
                    });
                  }
                } else {
                  try {
                    reportHydrationRetryExhausted(targetId, MAX_HYDRATION_RETRIES_PER_TARGET);
                  } catch {
                    // Preserves today's observable UX. This catch exists ONLY so the throw
                    // routes through instrumentation's error-capture path without changing
                    // control flow for anything downstream of this handler.
                  }
                }
                setHydrationRetriesRemaining(targetId, orchestrator.getRemainingAttempts(targetId));
              }
            }
          }
        } else {
          receivePreviewStale(e.data);
        }
      }
      function handleWorkerFailure(event: ErrorEvent | MessageEvent<unknown>) {
        const baseMessage =
          event.type === 'messageerror' ? 'Preview worker rejected a message.' : 'Preview worker crashed.';
        // `syncWorkerFiles` waits for an explicit files-ready receipt. A worker
        // failure means that receipt can no longer arrive, so reject every
        // pending waiter before reporting the failure; otherwise instance
        // readiness remains pending forever and its downstream timeout never
        // starts.
        for (const waiter of workerFileWaitersRef.current.values()) {
          waiter.reject(new Error(baseMessage));
        }
        workerFileWaitersRef.current.clear();
        // A terminated worker cannot acknowledge a later file sync. Clearing
        // state runs this effect's cleanup, detaches it from all consumers,
        // and makes later work fail as unavailable instead of waiting forever.
        setCodegenWorker(null);
        useInstanceStore.getState().handleWorkerFailure(baseMessage);
        // A genuine 'error' event on this shared worker is ALSO handled by
        // handleCodegenWorkerError below (same worker, both listeners fire),
        // which already shows its own crash toast (Codex P2) — suppress this
        // one so a single crash doesn't produce two destructive toasts.
        // 'messageerror' has no such duplicate handler, so it still toasts.
        handlePreviewWorkerFailure(baseMessage, event, usePreviewStore.getState().selectedTargetId, {
          toast: event.type !== 'error'
        });
      }
      codegenWorker.addEventListener('message', handleMessage as EventListener);
      codegenWorker.addEventListener('error', handleWorkerFailure as EventListener);
      codegenWorker.addEventListener('messageerror', handleWorkerFailure as EventListener);
      return () => {
        codegenWorker.removeEventListener('message', handleMessage as EventListener);
        codegenWorker.removeEventListener('error', handleWorkerFailure as EventListener);
        codegenWorker.removeEventListener('messageerror', handleWorkerFailure as EventListener);
        // Clear the preview store's worker ref so a terminated worker is not left
        // dangling after unmount (else a later dispatchExecute would post to a
        // dead worker and be silently dropped). Symmetric with setWorkerRef above;
        // CodegenProvider is a singleton so there is no remount race. (Codex P2)
        setWorkerRef(null);
        readiness.dispose();
        readinessRef.current = null;
        setPreviewSessionFactory(null);
        useInstanceStore.getState().setReadiness(undefined);
        useInstanceStore.getState().setWorker(undefined);
        for (const waiter of workerFileWaitersRef.current.values()) {
          waiter.reject(new Error('Code generation worker was detached.'));
        }
        workerFileWaitersRef.current.clear();
        for (const waiter of workspaceCommitWaitersRef.current) {
          waiter.reject(new Error('Code generation worker was detached.'));
        }
        workspaceCommitWaitersRef.current.clear();
      };
    }, [
      codegenWorker,
      handlePreviewWorkerFailure,
      receivePreviewResult,
      receivePreviewStale,
      receiveExecutionResult,
      receiveExecutionError,
      receiveValidateResult,
      setHydrationRetriesRemaining,
      clearHydrationRetriesRemaining,
      setWorkerRef,
      hydrateNamespaceForInstance,
      syncWorkerFiles,
      prepareWorkerFiles
    ]);

    // ---------------------------------------------------------------------------
    // Codegen preview — single worker owner (Codex P2 fix).
    //
    // CodegenProvider is the sole owner of the codegen:generate request/response cycle.
    // CodePreviewPanel and ExportPerspective are pure-display consumers of
    // useCodegenStore. This prevents double-subscription when both surfaces are
    // simultaneously mounted (Explore dock keep-alive + Export perspective).
    // ---------------------------------------------------------------------------

    // Effect 1: listen for codegen worker responses and dispatch into the store.
    useEffect(() => {
      if (!codegenWorker) return;

      function handleCodegenMessage(e: MessageEvent<CodegenWorkerMessage>) {
        const msg = e.data;
        if (msg.type !== 'codegen:result' && msg.type !== 'codegen:outdated' && msg.type !== 'codegen:error') {
          return; // not a codegen response — handled by preview listener above
        }
        if (msg.requestId !== codegenCurrentRequestIdRef.current) {
          return; // stale response
        }
        const store = useCodegenStore.getState();
        switch (msg.type) {
          case 'codegen:result':
            store.receiveCodePreviewResult({ target: msg.target, files: msg.files });
            useActivityStore
              .getState()
              .addActivity('gen', true, `${msg.target} · ${msg.files.length} file${msg.files.length === 1 ? '' : 's'}`);
            break;
          case 'codegen:outdated':
            store.markCodePreviewStale({ target: msg.target, message: msg.message });
            break;
          case 'codegen:error':
            useOutputStore.getState().addLine(fmtLine('codegen', msg.message), 'error');
            useActivityStore.getState().addActivity('gen', false, msg.message);
            store.markCodePreviewUnavailable({ target: msg.target, message: msg.message });
            break;
        }
      }

      function handleCodegenWorkerError(event: ErrorEvent) {
        console.error('[CodegenProvider] Codegen worker error (codegen:generate):', event.message, event.error);
        const store = useCodegenStore.getState();
        store.markCodePreviewUnavailable({
          target: store.codePreviewTarget,
          message: 'Code preview worker crashed — reload Studio.'
        });
        recordOperation('codegen', `Worker crashed: ${event.message}`, 'error');
        showToast({
          title: 'Code preview worker crashed',
          description: 'Reload Studio to restore code preview.',
          variant: 'destructive'
        });
      }

      codegenWorker.addEventListener('message', handleCodegenMessage as EventListener);
      codegenWorker.addEventListener('error', handleCodegenWorkerError as EventListener);
      return () => {
        codegenWorker.removeEventListener('message', handleCodegenMessage as EventListener);
        codegenWorker.removeEventListener('error', handleCodegenWorkerError as EventListener);
      };
    }, [codegenWorker, showToast]);

    // Effect 2: kick off code generation when the active target changes.
    // Mirrors the removed CodePreviewPanel effect (018 Task 0.8).
    const codegenActiveTarget = useCodegenStore((s) => s.activeTarget);
    const codegenPreviewTarget = useCodegenStore((s) => s.codePreviewTarget);
    const refreshRevision = useCodegenStore((s) => s.refreshRevision);
    const dispatchedRefreshRevisionRef = useRef(refreshRevision);
    const selectedCodeTarget = usePreviewStore((s) => s.selectedTarget);
    useEffect(() => {
      if (!codegenWorker || codegenActiveTarget === undefined) return;
      const selectionKey = JSON.stringify([
        workspaceId,
        selectedCodeTarget?.namespace,
        selectedCodeTarget?.name,
        selectedCodeTarget?.kind
      ]);
      const requestId = useCodegenStore.getState().beginCodePreviewRequest(codegenPreviewTarget, selectionKey);
      codegenCurrentRequestIdRef.current = requestId;
      const controller = new AbortController();
      void (async () => {
        if (selectedCodeTarget) {
          if (!readinessRef.current) throw new Error('Selected preview preparation is unavailable.');
          await readinessRef.current.ensure(
            `${selectedCodeTarget.namespace}.${selectedCodeTarget.name}`,
            controller.signal
          );
        } else {
          await prepareWorkerFiles(codegenWorker, controller.signal);
        }
        if (controller.signal.aborted || codegenCurrentRequestIdRef.current !== requestId) return;
        codegenWorker.postMessage({
          type: 'codegen:generate',
          target: codegenPreviewTarget,
          requestId,
          regenerate: refreshRevision !== dispatchedRefreshRevisionRef.current,
          ...(selectedCodeTarget
            ? {
                selection: {
                  declarations: [
                    {
                      namespace: selectedCodeTarget.namespace,
                      name: selectedCodeTarget.name,
                      kind: selectedCodeTarget.kind
                    }
                  ],
                  namespaces: []
                }
              }
            : {})
        });
        dispatchedRefreshRevisionRef.current = refreshRevision;
      })().catch((err) => {
        if (controller.signal.aborted || codegenCurrentRequestIdRef.current !== requestId) return;
        console.error('[CodegenProvider] Failed to request code generation:', err);
        useCodegenStore.getState().markCodePreviewUnavailable({
          target: codegenPreviewTarget,
          message: 'Code preview worker is unavailable.'
        });
        recordOperation('codegen', err instanceof Error ? err.message : 'Generation request failed', 'error');
        showToast({
          title: 'Code preview unavailable',
          description: err instanceof Error ? err.message : 'Could not reach the code preview worker.',
          variant: 'destructive'
        });
      });
      return () => controller.abort();
    }, [
      codegenWorker,
      codegenActiveTarget,
      codegenPreviewTarget,
      selectedCodeTarget,
      workspaceId,
      files,
      refreshRevision,
      prepareWorkerFiles,
      projectRuntime?.input,
      projectRuntime?.status,
      showToast
    ]);

    const ensureSavedProject = useCallback(
      async (revision: string, signal: AbortSignal) => {
        const input = await captureBarrierRef.current!.wait(revision, signal);
        if (!codegenWorker) throw new Error('The preview worker is unavailable.');
        await syncWorkerFiles(codegenWorker, signal);
        const current = await captureBarrierRef.current!.wait(revision, signal);
        if (!projectReceiptMatches(input.receipt, current.receipt))
          throw new Error('Project changed before its saved revision was applied.');
        return current;
      },
      [codegenWorker, syncWorkerFiles]
    );
    return (
      <ProjectPreviewReadinessContext.Provider value={{ ensureSaved: ensureSavedProject }}>
        <PreviewSessionContext.Provider value={previewSessionFactory}>{children}</PreviewSessionContext.Provider>
      </ProjectPreviewReadinessContext.Provider>
    );
  },
  { op: 'CodegenProvider' }
);
