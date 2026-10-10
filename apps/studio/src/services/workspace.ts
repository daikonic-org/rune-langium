// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/**
 * Workspace service — manages multi-file loading, dirty tracking,
 * and cross-file resolution for the studio app (T083, T098, T100, T102).
 */

import {
  type ExpressionScopeEntry,
  type SourceRegion,
  parse,
  parseWorkspace,
  createRuneDslServices,
  serializeRuneModel,
  type RosettaModel
} from '@rune-langium/core';
import type { ExportSelection } from '@rune-langium/codegen/export';
import { requestCodegenDownload } from './codegen-download-client.js';
import { sanitizeDownloadFilename } from './export.js';
import { OperationTimeoutError, withAbortTimeout } from './with-abort-timeout.js';
import { EmptyFileSystem } from 'langium';
import { nameFromNodeId, kindFromNodeId } from '@rune-langium/visual-editor/identifiers';
import { CURATED_MODEL_IDS, type CuratedSerializedDocument } from '@rune-langium/curated-schema';
import type { CachedFile, LoadedModel } from '../types/model-types.js';
import type {
  WorkerRequest,
  ExpressionScopeRequest,
  ExpressionScopeResponse,
  ParseResponse,
  ParseWorkspaceResponse,
  LinkDocumentRequest,
  LinkDocumentResponse,
  HydrateRequest,
  HydrateResponse
} from '../workers/parser-worker.js';
import { isParseResponse, isParseWorkspaceResponse, isLinkDocumentResponse } from '../workers/parser-worker.js';
import { useCodegenStore } from '../store/codegen-store.js';
import { useOutputStore, fmtLine } from '../store/output-store.js';
import { routeTelemetryRecord } from './instrumentation/browser-sink.js';
import { isTelemetryRecordMessage } from './instrumentation/worker-sink.js';
import { withInstrumentation, Capture } from './instrumentation/core.js';
import { pathToUri } from '../utils/uri.js';
import { curatedArtifactCache } from './curated-artifact-cache.js';

/** Known curated bundle ids — guards deferredExports filePath prefixes so user
 *  files that happen to live under `${bundleId}/...` aren't mis-grouped. */
const CURATED_BUNDLE_IDS = new Set<string>(CURATED_MODEL_IDS);
export const PARSE_ROUTER_TIMEOUT_MS = 45_000;
type HydrationDocument = HydrateRequest['documents'][number];

// The worker replaces its document set on every parse. Keep immutable curated
// artifacts here so a delta HTTP response can still supply a full worker set.
const curatedDocumentCache = new Map<string, HydrationDocument[]>();
const curatedSourceCache = new Map<string, Map<string, string>>();
const restoredCuratedKeys = new Set<string>();
let curatedCacheEpoch = 0;
let routedParseRevision = 0;
interface CuratedParseOptions {
  curatedBundles?: Array<{ id: string; version: string }>;
  hydrateNamespaces?: string[];
  requireCuratedHydration?: boolean;
}
interface CuratedLinkRecovery {
  revision: number;
  epoch: number;
  files: Array<{ name: string; content: string }>;
  options: CuratedParseOptions;
  keys: Set<string>;
  pending?: Promise<boolean>;
}
let curatedLinkRecovery: CuratedLinkRecovery | undefined;
const curatedRecoveryListeners = new Set<(result: ParseWorkspaceFilesResult) => void>();

export const subscribeCuratedCacheRecovery = withInstrumentation(
  function subscribeCuratedCacheRecovery(listener: (result: ParseWorkspaceFilesResult) => void): () => void {
    curatedRecoveryListeners.add(listener);
    return () => {
      curatedRecoveryListeners.delete(listener);
    };
  },
  { op: 'subscribeCuratedCacheRecovery' }
);

function routedWorkspaceResult(response: ParseWorkspaceResponse): ParseWorkspaceFilesResult {
  return {
    models: response.models,
    parsedModels: response.parsedModels,
    errors: new Map(Object.entries(response.errors)),
    parseMode: 'router',
    deferredExports: response.deferredExports,
    curatedRefOnlyFiles: response.curatedRefOnlyFiles
  };
}

/** Cancels workspace-owned recovery while retaining reusable immutable artifacts. */
export const invalidateCuratedCacheRecovery = withInstrumentation(
  function invalidateCuratedCacheRecovery(): void {
    routedParseRevision += 1;
    curatedLinkRecovery = undefined;
  },
  { op: 'invalidateCuratedCacheRecovery' }
);

export const resetCuratedDocumentCache = withInstrumentation(
  function resetCuratedDocumentCache(): void {
    curatedCacheEpoch += 1;
    invalidateCuratedCacheRecovery();
    curatedDocumentCache.clear();
    curatedSourceCache.clear();
    restoredCuratedKeys.clear();
  },
  { op: 'resetCuratedDocumentCache' }
);

function withCuratedSource(documents: HydrationDocument[], sources: ReadonlyMap<string, string>): HydrationDocument[] {
  return documents.map((doc) =>
    sources.has(doc.uri) ? { ...doc, content: sources.get(doc.uri)!, sourceLoaded: true } : doc
  );
}

function retainCuratedSource(artifactKey: string, documents: Array<{ uri: string; content: string }>): void {
  const sources = new Map(documents.map(({ uri, content }) => [uri, content]));
  curatedSourceCache.set(artifactKey, sources);
  const cached = curatedDocumentCache.get(artifactKey);
  if (cached) curatedDocumentCache.set(artifactKey, withCuratedSource(cached, sources));
}

export const loadCuratedNamespaceSource = withInstrumentation(
  async function loadCuratedNamespaceSource(
    bundleId: string,
    version: string,
    namespace: string,
    expectedArtifactKey?: string
  ): Promise<{ artifactKey: string; documents: Array<{ uri: string; content: string }> }> {
    const cacheEpoch = curatedCacheEpoch;
    if (expectedArtifactKey && !curatedSourceCache.has(expectedArtifactKey)) {
      const documents = await curatedArtifactCache.source(expectedArtifactKey);
      if (documents && cacheEpoch === curatedCacheEpoch) {
        retainCuratedSource(expectedArtifactKey, documents);
      }
    }
    if (expectedArtifactKey && curatedSourceCache.has(expectedArtifactKey)) {
      return {
        artifactKey: expectedArtifactKey,
        documents: [...curatedSourceCache.get(expectedArtifactKey)!].map(([uri, content]) => ({ uri, content }))
      };
    }
    const response = await withAbortTimeout(
      (signal) =>
        fetch('/api/curated-source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bundleId, version, namespace, expectedArtifactKey }),
          signal
        }),
      PARSE_ROUTER_TIMEOUT_MS
    );
    if (!response.ok) {
      const failure = (await response.json().catch(() => null)) as { error?: unknown } | null;
      throw new Error(
        typeof failure?.error === 'string' ? failure.error : `/api/curated-source HTTP ${response.status}`
      );
    }
    const result = (await response.json()) as {
      artifactKey: string;
      documents: Array<{ uri: string; content: string }>;
    };
    if (
      typeof result.artifactKey !== 'string' ||
      (expectedArtifactKey && result.artifactKey !== expectedArtifactKey) ||
      !Array.isArray(result.documents) ||
      result.documents.some((doc) => typeof doc.uri !== 'string' || typeof doc.content !== 'string')
    ) {
      throw new Error('Invalid curated source response');
    }
    if (cacheEpoch !== curatedCacheEpoch) return result;
    retainCuratedSource(result.artifactKey, result.documents);
    await curatedArtifactCache.putSource(result.artifactKey, result.documents);
    return result;
  },
  { op: 'loadCuratedNamespaceSource' }
);

class ParseRouterHttpError extends Error {
  constructor(readonly status: number) {
    super(`/api/parse HTTP ${status}`);
  }
}

export interface WorkspaceFile {
  name: string;
  path: string;
  content: string;
  /** Curated source is fetched separately when this namespace is viewed. */
  sourceLoaded?: boolean;
  dirty: boolean;
  /** When true, the file is a system/built-in file and cannot be edited. */
  readOnly?: boolean;
  /** Optional precomputed serialized Langium model JSON used by the parser worker. */
  serializedModelJson?: CuratedSerializedDocument['modelJson'];
  /**
   * Optional exports manifest for deferred deserialization (ADR 007 Phase 4).
   * When present alongside serializedModelJson, the parser worker registers
   * these symbols in the IndexManager without deserializing the full AST.
   */
  exports?: Array<{ type: string; name: string; path: string }>;
  /**
   * The curated bundle id this file belongs to (e.g. "cdm", "fpml").
   * Set by mergeModelFiles from LoadedModel.source.id. Used by
   * collectCuratedBundlesFromWorkspace to build the curatedBundles list for
   * the /api/parse router. Absent on user-authored files.
   */
  bundleId?: string;
  /**
   * The curated bundle version (commitHash / date stamp) for this file,
   * e.g. "2026-04-25". Set by mergeModelFiles from LoadedModel.commitHash.
   * Used alongside bundleId to form { id, version } entries for /api/parse.
   */
  bundleVersion?: string;
  /** Curated namespace for per-namespace source loading. */
  namespace?: string;
  /** Immutable published artifact identity; source and model must match it. */
  artifactKey?: string;
  /**
   * Curated reference file: excluded from workspace authoring and local LSP
   * synchronization. Source is loaded on demand for read-only display;
   * catalog-only entries have empty content until then.
   */
  refOnly?: boolean;
}

export interface WorkspaceLoadProgress {
  phase: 'reading' | 'syncing' | 'complete';
  loaded: number;
  total: number;
}

export interface WorkspaceState {
  files: WorkspaceFile[];
  models: RosettaModel[];
  parsedModels: ParsedWorkspaceModel[];
  errors: Map<string, string[]>;
  loading: boolean;
}

export interface ParsedWorkspaceModel {
  filePath: string;
  model: RosettaModel;
  /** Exact input whose coordinates this model describes; absent for deferred source. */
  source?: string;
  serializedModelJson?: string;
}

export type ParseMode = 'worker' | 'router' | 'main-thread-fallback';

export interface ParseFileResult {
  model: RosettaModel | null;
  errors: string[];
  parseMode: ParseMode;
  fallbackMessage?: string;
}

export interface ParseWorkspaceFilesResult {
  models: RosettaModel[];
  parsedModels: ParsedWorkspaceModel[];
  errors: Map<string, string[]>;
  parseMode: ParseMode;
  fallbackMessage?: string;
  /**
   * When the routed parse path succeeds, this carries the curated docs
   * grouped by bundleId so callers can populate LoadedModel.files in the
   * model-store with reference-only entries (path + serialized model,
   * plus source content only when that namespace was viewed). Drives the
   * studio file count + curated file picker.
   * Absent for main-thread fallback parses (curated source is unknown
   * client-side in that path).
   */
  curatedRefOnlyFiles?: Record<string, CachedFile[]>;
  deferredExports?: Array<{
    filePath: string;
    namespace: string;
    exports: Array<{ type: string; name: string }>;
  }>;
}

// ---------------------------------------------------------------------------
// Worker-based parsing (T098) — fallback to main thread if worker fails
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let requestId = 0;
let workerInitError: Error | null = null;
const WORKER_FALLBACK_MESSAGE =
  'Parser worker unavailable — using in-browser parsing, which may feel slower on large workspaces.';

/** Used when the /api/parse router fails (network error, 5xx, etc.).  The
 *  parser worker is not involved in the workspace parse path; only the
 *  server-side Pages Function is unavailable. */
const ROUTER_FALLBACK_MESSAGE =
  'Server-side parsing unavailable — using in-browser parsing, which may feel slower on large workspaces.';

function formatWorkerFallbackMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `${WORKER_FALLBACK_MESSAGE} (${detail})`;
}

function formatRouterFallbackMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `${ROUTER_FALLBACK_MESSAGE} (${detail})`;
}

async function parseWorkspaceFilesOnMainThread(
  files: WorkspaceFile[],
  options: {
    parseMode: Extract<ParseMode, 'main-thread-fallback'>;
    fallbackMessage?: string;
  }
): Promise<ParseWorkspaceFilesResult> {
  // Defensive guard (layer 2): only pass files whose URI the in-browser Langium
  // can actually parse. The service registry is keyed on extension, and only
  // ".rosetta" is registered.  This single-condition filter is intentionally
  // coarse: curated entries (serializedModelJson set) are already stripped by
  // the router-failure catch before this function is called (layer 1), but
  // bundle-marker files (path ends with /.bundle-marker, yielding an empty
  // extension) are caught here.  The `.rosetta` suffix check is the safety net
  // for any other extensionless or non-rosetta URI that reaches this layer.
  const parseable = files.filter((f) => f.path.toLowerCase().endsWith('.rosetta'));

  const results = await parseWorkspace(
    parseable.map((file) => ({
      uri: file.path,
      content: file.content
    }))
  );
  const models: RosettaModel[] = [];
  const parsedModels: ParsedWorkspaceModel[] = [];
  const serializer = createRuneDslServices(EmptyFileSystem).RuneDsl.serializer.JsonSerializer;
  const errors = new Map<string, string[]>();

  // Index results against `parseable` (NOT the original `files`) so indices align.
  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const file = parseable[i]!;
    if (result.value) {
      models.push(result.value);
      parsedModels.push({
        filePath: file.path,
        model: result.value,
        source: file.content,
        serializedModelJson: serializeRuneModel(serializer, result.value)
      });
    }
    const fileErrors = result.parserErrors.map((err) => err.message);
    if (fileErrors.length > 0) {
      errors.set(file.path, fileErrors);
    }
  }

  return {
    models,
    parsedModels,
    errors,
    parseMode: options.parseMode,
    fallbackMessage: options.fallbackMessage
  };
}

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../workers/parser-worker.ts', import.meta.url), {
      type: 'module'
    });
    // Persistent relay for the parser worker's `telemetry:record` messages.
    // Unlike codegen-worker's messages (owned by CodegenProvider.tsx's
    // persistent handleMessage listener), this worker only otherwise gets
    // PER-REQUEST listeners below (workerRequest's `handler`), which match
    // on a response `id` and silently drop anything without one — an
    // id-less `telemetry:record` message would never reach routeTelemetryRecord
    // without this dedicated listener.
    worker.addEventListener('message', (e: MessageEvent<unknown>) => {
      if (isTelemetryRecordMessage(e.data)) routeTelemetryRecord(e.data.record);
    });
    workerInitError = null;
    return worker;
  } catch (error) {
    // Worker not available (e.g., in test env or SSR)
    workerInitError = error instanceof Error ? error : new Error(String(error));
    return null;
  }
}

function resetWorkerState(nextError: Error): void {
  if (worker) {
    worker.terminate();
  }
  worker = null;
  workerInitError = nextError;
}

function workerRequest(msg: Extract<WorkerRequest, { type: 'parse' }>): Promise<ParseResponse>;
function workerRequest(msg: Extract<WorkerRequest, { type: 'parseWorkspace' }>): Promise<ParseWorkspaceResponse>;
function workerRequest(msg: LinkDocumentRequest): Promise<LinkDocumentResponse>;
function workerRequest(msg: HydrateRequest): Promise<HydrateResponse>;
function workerRequest(msg: ExpressionScopeRequest): Promise<ExpressionScopeResponse>;
function workerRequest(
  msg: WorkerRequest
): Promise<ParseResponse | ParseWorkspaceResponse | LinkDocumentResponse | HydrateResponse | ExpressionScopeResponse> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    if (!w) {
      reject(workerInitError ?? new Error('Worker not available'));
      return;
    }

    const id = msg.id;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const clearPendingTimeout = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    };
    const cleanupListeners = () => {
      w.removeEventListener('error', errorHandler);
      w.removeEventListener('messageerror', messageErrorHandler);
      w.removeEventListener('message', handler);
    };
    const handler = (e: MessageEvent) => {
      if (e.data?.id === id) {
        clearPendingTimeout();
        cleanupListeners();
        if (msg.type === 'parse') {
          if (!isParseResponse(e.data)) {
            const error = new Error('Worker returned an invalid parse response');
            resetWorkerState(error);
            reject(error);
            return;
          }
          resolve(e.data);
          return;
        }
        if (msg.type === 'linkDocument') {
          if (!isLinkDocumentResponse(e.data)) {
            const error = new Error('Worker returned an invalid linkDocument response');
            resetWorkerState(error);
            reject(error);
            return;
          }
          resolve(e.data);
          return;
        }
        if (msg.type === 'expressionScope') {
          const data = e.data as ExpressionScopeResponse;
          if (data.type !== 'expressionScopeResult' || !Array.isArray(data.entries)) {
            reject(new Error('Worker returned an invalid expression scope'));
            return;
          }
          resolve(data);
          return;
        }
        if (msg.type === 'hydrate') {
          // HydrateResponse: { type: 'hydrateResult', id, ok, error? }
          const data = e.data as HydrateResponse;
          if (data.type !== 'hydrateResult') {
            const error = new Error('Worker returned an invalid hydrate response');
            resetWorkerState(error);
            reject(error);
            return;
          }
          resolve(data);
          return;
        }
        if (!isParseWorkspaceResponse(e.data)) {
          const error = new Error('Worker returned an invalid workspace parse response');
          resetWorkerState(error);
          reject(error);
          return;
        }
        resolve(e.data);
      }
    };
    const errorHandler = (event: ErrorEvent) => {
      clearPendingTimeout();
      cleanupListeners();
      const error = new Error(event.message || 'Worker error');
      resetWorkerState(error);
      reject(error);
    };
    const messageErrorHandler = () => {
      clearPendingTimeout();
      cleanupListeners();
      const error = new Error('Worker message could not be deserialized');
      resetWorkerState(error);
      reject(error);
    };
    w.addEventListener('message', handler);
    w.addEventListener('error', errorHandler);
    w.addEventListener('messageerror', messageErrorHandler);
    try {
      w.postMessage(msg);
    } catch (error) {
      clearPendingTimeout();
      cleanupListeners();
      const workerError =
        error instanceof Error ? error : new Error(error ? String(error) : 'Worker postMessage failed');
      resetWorkerState(workerError);
      reject(workerError);
      return;
    }

    // Timeout after 30s
    timeoutId = setTimeout(() => {
      cleanupListeners();
      const error = new Error('Worker timeout');
      resetWorkerState(error);
      reject(error);
    }, 30000);
  });
}

export const parseFile = withInstrumentation(
  async function parseFile(content: string, uri?: string): Promise<ParseFileResult> {
    // Try worker first (T098)
    try {
      const id = String(++requestId);
      const response = await workerRequest({
        type: 'parse',
        id,
        content,
        uri
      });
      return { model: response.model, errors: response.errors, parseMode: 'worker' };
    } catch (error) {
      // Fallback to main thread
      console.warn('[workspace] parseFile worker fallback:', error);
      useOutputStore.getState().addLine(fmtLine('parse', 'worker unavailable, using main thread'), 'warn');
    }

    // Main-thread fallback
    try {
      const result = await parse(content, uri);
      const errors: string[] = [];
      if (result.parserErrors && result.parserErrors.length > 0) {
        for (const err of result.parserErrors) {
          errors.push(err.message);
        }
      }
      return {
        model: result.value,
        errors,
        parseMode: 'main-thread-fallback',
        fallbackMessage: WORKER_FALLBACK_MESSAGE
      };
    } catch (e) {
      return {
        model: null,
        errors: [(e as Error).message],
        parseMode: 'main-thread-fallback',
        fallbackMessage: formatWorkerFallbackMessage(e)
      };
    }
    // `content` is raw user model source and the output's `model`/`errors`
    // carry raw AST/message text — never captured. `parseMode` and error
    // counts are safe structural summaries.
  },
  {
    op: 'parseFile',
    capture: Capture.Output,
    sanitize: (value, which) => {
      if (which !== 'output') return undefined;
      const result = value as ParseFileResult;
      return { parseMode: result.parseMode, errorCount: result.errors.length };
    }
  }
);

export const collectCuratedBundlesFromWorkspace = withInstrumentation(
  function collectCuratedBundlesFromWorkspace(
    files: ReadonlyArray<WorkspaceFile>
  ): Array<{ id: string; version: string }> {
    const seen = new Map<string, string>(); // id → version
    for (const file of files) {
      if (file.bundleId && file.bundleVersion && !seen.has(file.bundleId)) {
        seen.set(file.bundleId, file.bundleVersion);
      }
    }
    return Array.from(seen.entries()).map(([id, version]) => ({ id, version }));
    // Output entries are {id, version} for curated bundles only — `id` is one
    // of the fixed CURATED_MODEL_IDS values and `version` is a commit hash —
    // both safe.
  },
  {
    op: 'collectCuratedBundlesFromWorkspace',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' ? value : undefined)
  }
);

export const collectCuratedDocsFromWorkspace = withInstrumentation(
  function collectCuratedDocsFromWorkspace(
    files: ReadonlyArray<WorkspaceFile>
  ): Array<{ uri: string; serializedModel: string }> {
    const docs: Array<{ uri: string; serializedModel: string }> = [];
    for (const f of files) {
      if (f.path.endsWith(BUNDLE_MARKER_SUFFIX)) continue;
      if (typeof f.serializedModelJson === 'string' && f.serializedModelJson.length > 0) {
        docs.push({ uri: f.path, serializedModel: f.serializedModelJson });
      }
    }
    return docs;
    // `serializedModel` is raw serialized AST text — never captured; only a count.
  },
  {
    op: 'collectCuratedDocsFromWorkspace',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' && Array.isArray(value) ? { count: value.length } : undefined)
  }
);

export const collectCuratedSourcesForCodegen = withInstrumentation(
  function collectCuratedSourcesForCodegen(files: ReadonlyArray<WorkspaceFile>): {
    curatedBundles: Array<{ id: string; version: string }>;
    curatedDocs: Array<{ uri: string; serializedModel: string }>;
  } {
    const curatedBundles = collectCuratedBundlesFromWorkspace(files);
    const curatedDocs = curatedBundles.length === 0 ? collectCuratedDocsFromWorkspace(files) : [];
    return { curatedBundles, curatedDocs };
  },
  {
    op: 'collectCuratedSourcesForCodegen',
    capture: Capture.Output,
    sanitize: (value, which) => {
      if (which !== 'output') return undefined;
      const result = value as { curatedBundles: unknown[]; curatedDocs: unknown[] };
      return { bundleCount: result.curatedBundles.length, docCount: result.curatedDocs.length };
    }
  }
);

/** Raw source includes read-only system definitions; curated entries have their own transport. */
export const collectRawWorkspaceSources = withInstrumentation(
  function collectRawWorkspaceSources(files: readonly WorkspaceFile[]): Array<{ path: string; content: string }> {
    return files
      .filter((file) => !file.bundleId && !file.serializedModelJson && !file.refOnly)
      .map(({ path, content }) => ({ path, content }));
  },
  { op: 'collectRawWorkspaceSources' }
);

export const parseWorkspaceFiles = withInstrumentation(
  async function parseWorkspaceFiles(
    files: WorkspaceFile[],
    options: { hydrateNamespaces?: string[]; requireCuratedHydration?: boolean } = {}
  ): Promise<ParseWorkspaceFilesResult> {
    invalidateCuratedCacheRecovery();
    const capturedFiles = files.map((file) => ({ ...file }));
    const wantsHydration = (options.hydrateNamespaces?.length ?? 0) > 0;
    if (files.length === 0 && !wantsHydration) {
      return { models: [], parsedModels: [], errors: new Map(), parseMode: 'router' };
    }

    // User files go as raw content; curated files become bundle metadata only
    // (via collectCuratedBundlesFromWorkspace below). A user file is one WITHOUT a
    // `bundleId` — that's the canonical marker every curated file carries. The
    // older `!serializedModelJson` proxy missed list-only deferredExports
    // namespaces (bundleId + refOnly, but NO serializedModelJson): those leaked
    // through and got POSTed to /api/parse as bogus files named
    // `[bundleId]/<namespace>`, which Langium rejects with "no services for the
    // extension '.'" → 500, collapsing the curated catalog to the user closure.
    const userFiles = collectRawWorkspaceSources(capturedFiles).map(({ path, content }) => ({ name: path, content }));
    const curatedBundles = collectCuratedBundlesFromWorkspace(capturedFiles);

    try {
      const response = await parseWorkspaceViaRouter(userFiles, {
        curatedBundles,
        hydrateNamespaces: options.hydrateNamespaces,
        requireCuratedHydration: options.requireCuratedHydration
      });
      return routedWorkspaceResult(response);
    } catch (error) {
      // Browser-only parsing cannot supply a requested curated namespace.
      // Let App dequeue the failed hydration instead of marking it hydrated
      // from a user-file-only fallback result.
      if (options.requireCuratedHydration) throw error;
      // Router failed (network error, Pages Function unavailable, etc.) — fall back
      // to synchronous main-thread parsing so the editor stays functional.
      console.warn('[workspace] parseWorkspaceFiles via router failed:', error);
      useOutputStore
        .getState()
        .addLine(
          fmtLine(
            'parse',
            'router unavailable, falling back to browser parse',
            error instanceof Error ? error.message : String(error)
          ),
          'warn'
        );
      // Layer 1 filter: only hand user-authored .rosetta files to the in-browser
      // Langium parser.  Two conditions are checked:
      //   1. `!f.serializedModelJson` — excludes curated entries (which may have a
      //      .rosetta path such as "[cdm]/types/Trade.rosetta" but are pre-parsed
      //      server-side and must not be re-parsed in-browser).
      //   2. `f.path.toLowerCase().endsWith('.rosetta')` — excludes bundle-marker
      //      files (e.g. "[cdm]/.bundle-marker") whose extensionless URI causes
      //      Langium's getServices() to throw "no services for the extension ''".
      // Together these mirror the router path's `userFiles` filter so the fallback
      // never dead-ends on mixed workspaces.
      const parseableFiles = capturedFiles.filter(
        (f) => !f.serializedModelJson && f.path.toLowerCase().endsWith('.rosetta')
      );
      return parseWorkspaceFilesOnMainThread(parseableFiles, {
        parseMode: 'main-thread-fallback',
        fallbackMessage: formatRouterFallbackMessage(error)
      });
    }
    // `files` (input) and models/parsedModels/deferredExports/curatedRefOnlyFiles
    // (output) all carry raw model source, AST, or user type/namespace names —
    // never captured. Only structural counts are safe.
  },
  {
    op: 'parseWorkspaceFiles',
    capture: Capture.Output,
    sanitize: (value, which) => {
      if (which !== 'output') return undefined;
      const result = value as ParseWorkspaceFilesResult;
      return { parseMode: result.parseMode, modelCount: result.models.length, errorCount: result.errors.size };
    }
  }
);

export const _resetParserWorkerForTests = withInstrumentation(
  function _resetParserWorkerForTests(): void {
    if (worker) {
      worker.terminate();
    }
    worker = null;
    requestId = 0;
    workerInitError = null;
  },
  { op: '_resetParserWorkerForTests' }
);

// ---------------------------------------------------------------------------
// Server-side parse routing (019 Phase 0) — POST /api/parse with hydration
// ---------------------------------------------------------------------------

export const parseWorkspaceViaRouter = withInstrumentation(
  async function parseWorkspaceViaRouter(
    files: Array<{ name: string; content: string }>,
    options: CuratedParseOptions = {},
    retryCachedHydration = true
  ): Promise<ParseWorkspaceResponse> {
    const cacheEpoch = curatedCacheEpoch;
    invalidateCuratedCacheRecovery();
    const revision = routedParseRevision;
    const assertCurrentRecovery = () => {
      if (!retryCachedHydration && (revision !== routedParseRevision || cacheEpoch !== curatedCacheEpoch)) {
        throw new Error('Curated cache recovery was superseded by a newer workspace parse');
      }
    };
    const restoredKeys = new Set<string>();
    const capturedFiles = files.map((file) => ({ ...file }));
    const sourceByPath = new Map(capturedFiles.map((file) => [file.name, file.content]));
    const requestParse = (knownCuratedArtifacts: string[]) =>
      withAbortTimeout(async (signal) => {
        const response = await fetch('/api/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: capturedFiles,
            curatedBundles: options.curatedBundles ?? [],
            hydrateNamespaces: options.hydrateNamespaces ?? [],
            knownCuratedArtifacts
          }),
          signal
        });
        if (!response.ok) throw new ParseRouterHttpError(response.status);
        return response.json();
      }, PARSE_ROUTER_TIMEOUT_MS);
    let data: {
      ok: boolean;
      models: ParseWorkspaceResponse['models'];
      deferredExports: ParseWorkspaceResponse['deferredExports'];
      errors: ParseWorkspaceResponse['errors'];
      hydrationState: { documents: HydrateRequest['documents'] };
      requiredCuratedArtifacts?: Array<{ key: string; bundleId: string; namespace: string; documentCount?: number }>;
      dependencyGraph?: Record<string, string[]>;
    };
    const fetchParse = async (known: string[]): Promise<typeof data> => {
      try {
        return (await requestParse(known)) as typeof data;
      } catch (error) {
        const transient =
          error instanceof OperationTimeoutError || (error instanceof ParseRouterHttpError && error.status >= 500);
        if (!transient || !options.requireCuratedHydration) throw error;
        return (await requestParse(known)) as typeof data;
      }
    };
    const persistentKeys =
      retryCachedHydration && options.curatedBundles?.length ? await curatedArtifactCache.documentKeys() : [];
    data = await fetchParse([...new Set([...curatedDocumentCache.keys(), ...persistentKeys])]);
    assertCurrentRecovery();

    if (!data.ok) {
      // Same reason as above: bubble up to the outer fallback with the full
      // workspace inputs rather than reparsing only user files in-place.
      throw new Error('/api/parse returned ok:false');
    }

    const assembleDocuments = async (result: typeof data): Promise<HydrationDocument[] | null> => {
      if (!result.requiredCuratedArtifacts) return result.hydrationState.documents;
      const received = new Map<string, HydrationDocument[]>();
      const userDocuments: HydrationDocument[] = [];
      for (const doc of result.hydrationState.documents) {
        if (!doc.bundleId || !doc.artifactKey) {
          userDocuments.push(doc);
          continue;
        }
        const group = received.get(doc.artifactKey) ?? [];
        group.push(doc);
        received.set(doc.artifactKey, group);
      }
      const nextCache = new Map(curatedDocumentCache);
      for (const [key, docs] of received) nextCache.set(key, docs);
      const curatedDocuments: HydrationDocument[] = [];
      for (const artifact of result.requiredCuratedArtifacts) {
        if (retryCachedHydration && !nextCache.has(artifact.key)) {
          const stored = await curatedArtifactCache.documents(artifact.key);
          if (
            stored &&
            stored.every((doc) => doc.bundleId === artifact.bundleId && doc.namespace === artifact.namespace)
          ) {
            nextCache.set(artifact.key, stored);
            restoredKeys.add(artifact.key);
            if (cacheEpoch === curatedCacheEpoch) restoredCuratedKeys.add(artifact.key);
          }
        }
        const docs = nextCache.get(artifact.key) ?? (artifact.documentCount === 0 ? [] : undefined);
        if (!docs || (artifact.documentCount !== undefined && docs.length !== artifact.documentCount)) return null;
        const sources = curatedSourceCache.get(artifact.key);
        const loaded = sources ? withCuratedSource(docs, sources) : docs;
        nextCache.set(artifact.key, loaded);
        curatedDocuments.push(...loaded);
      }
      for (const artifact of result.requiredCuratedArtifacts) {
        if (cacheEpoch === curatedCacheEpoch) curatedDocumentCache.set(artifact.key, nextCache.get(artifact.key)!);
        if (received.has(artifact.key) || artifact.documentCount === 0) {
          restoredCuratedKeys.delete(artifact.key);
          await curatedArtifactCache.putDocuments(artifact.key, nextCache.get(artifact.key)!);
        }
      }
      return [...userDocuments, ...curatedDocuments];
    };
    let hydrationDocuments = await assembleDocuments(data);
    assertCurrentRecovery();
    if (!hydrationDocuments) {
      // A stale/missing browser receipt must never produce a partly linked graph.
      data = await fetchParse([]);
      assertCurrentRecovery();
      if (!data.ok) throw new Error('/api/parse returned ok:false');
      hydrationDocuments = await assembleDocuments(data);
      assertCurrentRecovery();
      if (!hydrationDocuments) throw new Error('/api/parse omitted required curated artifacts');
    }

    const deferredExports = [...(data.deferredExports ?? [])];
    const deferredPaths = new Set(deferredExports.map((entry) => entry.filePath));
    for (const doc of hydrationDocuments) {
      if (!doc.bundleId || !doc.namespace || deferredPaths.has(doc.uri)) continue;
      deferredExports.push({
        filePath: doc.uri,
        namespace: doc.namespace,
        exports: doc.exports.map(({ type, name }) => ({ type, name }))
      });
      deferredPaths.add(doc.uri);
    }

    // Publish the cross-namespace dep graph (spec §5.2) into the codegen store
    // so the Download config modal can drive its auto-select cascade. Absent /
    // fail-soft responses leave it `{}` (modal shows no cascade hints).
    useCodegenStore.getState().setDependencyGraph(data.dependencyGraph ?? {});

    // Deserialize ONLY the user-document hydration entries into RosettaModel
    // instances for the graph view. Curated corpus documents stay in
    // hydrationState so the worker hydrate path can register their exports
    // for cross-reference resolution, but we deliberately keep them out of
    // `models[]` / `parsedModels[]` — pushing them through here defeats the
    // lazy/deferred-corpus design (the whole reason curated docs serialize to
    // JSON in the first place) and reintroduces multi-megabyte main-thread
    // deserialization on every debounced edit parse.
    const userFileNames = new Set(sourceByPath.keys());
    const services = createRuneDslServices(EmptyFileSystem).RuneDsl;
    const models: RosettaModel[] = [];
    const parsedModels: ParsedWorkspaceModel[] = [];
    // Build a quick lookup: filePath → namespace from the response's
    // deferredExports so curated entries get a real namespace rather than
    // an empty string (Copilot review: CachedFile.namespace is declared
    // non-optional). User-file entries are handled in the same loop.
    const namespaceByFilePath = new Map<string, string>();
    for (const d of deferredExports) {
      namespaceByFilePath.set(d.filePath, d.namespace);
    }
    // Collect curated docs as refOnly CachedFile entries grouped by bundleId.
    // The server stamps each hydration doc with an explicit `bundleId` field
    // (apps/studio/functions/api/parse.ts) so we don't infer bundle
    // membership from the URI prefix — the previous prefix inference
    // false-positive'd for user files under `${bundleId}/path` (Codex P2
    // review of PR #163).
    const curatedRefOnlyFiles: Record<string, CachedFile[]> = {};
    for (const doc of hydrationDocuments) {
      // doc.uri is the bare filePath emitted by /api/parse + curated-fetch
      // (no `file://` prefix). The legacy `file:///` strip is retained for
      // backwards compatibility with any in-flight payloads.
      const filePath = doc.uri.replace(/^file:\/\/\//, '');
      if (userFileNames.has(filePath)) {
        try {
          const model = services.serializer.JsonSerializer.deserialize<RosettaModel>(doc.serializedModel);
          models.push(model);
          parsedModels.push({
            filePath,
            model,
            source: sourceByPath.get(filePath),
            serializedModelJson: doc.serializedModel
          });
        } catch (err) {
          console.warn('[workspace] failed to deserialize hydration model for', doc.uri, err);
        }
        continue;
      }
      // Not a user file. Use the explicit bundleId stamped by the server;
      // if it's missing (e.g. older deployments mid-rollout) we skip the
      // entry rather than guess from the URI — silently grouping under
      // the wrong key was the original Codex bug.
      const bundleId = doc.bundleId;
      if (!bundleId) continue;
      // Strip the `${bundleId}/` prefix from the uri so the path within
      // the bundle is preserved without the redundant id prefix on disk.
      const pathInBundle = filePath.startsWith(`${bundleId}/`) ? filePath.slice(bundleId.length + 1) : filePath;
      const entry: CachedFile = {
        path: pathInBundle,
        content: doc.content,
        sourceLoaded: doc.sourceLoaded ?? Boolean(doc.content),
        artifactKey: doc.artifactKey,
        namespace: namespaceByFilePath.get(filePath) ?? '',
        serializedModelJson: doc.serializedModel,
        exports: doc.exports,
        refOnly: true
      };
      (curatedRefOnlyFiles[bundleId] ??= []).push(entry);
    }

    // ── Restore "loaded" status for bundles outside the import closure ──────────
    // The manifest fast-path hydrates ONLY the user's import closure into
    // hydrationState, so a curated bundle that no user file imports yields zero
    // hydrationState docs → zero curatedRefOnlyFiles → LoadedModel.files stays []
    // → ModelLoader's 30s hydration timeout fires → "load failed". deferredExports
    // lists EVERY namespace in each loaded bundle; register the list-only ones
    // (those not already added from the closure above) as refOnly entries so the
    // bundle reads as loaded. They carry no serializedModelJson — their ASTs
    // hydrate on demand when the namespace is browsed.
    const seenPathByBundle = new Map<string, Set<string>>();
    for (const [bid, entries] of Object.entries(curatedRefOnlyFiles)) {
      seenPathByBundle.set(bid, new Set(entries.map((e) => e.path)));
    }
    for (const d of deferredExports) {
      const slash = d.filePath.indexOf('/');
      if (slash < 0) continue; // user-file entry: no bundle prefix
      const bundleId = d.filePath.slice(0, slash);
      if (!CURATED_BUNDLE_IDS.has(bundleId)) continue;
      const pathInBundle = d.filePath.slice(slash + 1);
      // Only list-only manifest namespaces belong here — their filePath is the
      // synthetic `${bundleId}/${namespace}`. Closure docs (already added above)
      // and user files under a `${bundleId}/...` path have a different shape and
      // must be skipped, avoiding the `${bundleId}/...` false-positive class.
      if (d.filePath !== `${bundleId}/${d.namespace}`) continue;
      const seen = seenPathByBundle.get(bundleId) ?? new Set<string>();
      if (seen.has(pathInBundle)) continue; // already added from the closure
      seen.add(pathInBundle);
      seenPathByBundle.set(bundleId, seen);
      (curatedRefOnlyFiles[bundleId] ??= []).push({
        path: pathInBundle,
        content: '',
        sourceLoaded: false,
        namespace: d.namespace,
        // CachedFile.exports needs {type,name,path}; deferredExports omits path
        // (no AST yet). Path is only used to locate a node once hydrated.
        exports: (d.exports ?? []).map((e) => ({ ...e, path: '' })),
        refOnly: true
      });
    }

    // Hydrate the browser worker with ALL server-parsed documents + exports
    // (user AND curated) so subsequent linkDocument calls can resolve cross-
    // references. Two failure modes are distinguished:
    //
    //   1. Worker REACHABLE but reports `ok: false` — a real hydration
    //      failure. linkDocument lookups would silently miss the affected
    //      docs. Throw so the caller either falls back for ordinary parsing
    //      or reports failed curated hydration.
    //   2. Worker UNREACHABLE (e.g. running in jsdom without a real Worker,
    //      worker crashed, postMessage timeout) — log + accept the degraded
    //      state. linkDocument will fail downstream but the graph still
    //      renders from the deserialized models above. Throwing here would
    //      regress test envs that don't ship the parser worker.
    assertCurrentRecovery();
    try {
      const hydrateResponse = await workerRequest({
        type: 'hydrate',
        id: `hydrate:${Date.now()}`,
        documents: hydrationDocuments
      });
      if (hydrateResponse.type === 'hydrateResult' && !hydrateResponse.ok) {
        throw new Error(`worker hydration failed: ${hydrateResponse.error ?? 'unknown'}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith('worker hydration failed')) {
        if (retryCachedHydration && restoredKeys.size) {
          for (const key of restoredKeys) {
            curatedDocumentCache.delete(key);
            restoredCuratedKeys.delete(key);
          }
          await curatedArtifactCache.discardDocuments([...restoredKeys]);
          return parseWorkspaceViaRouter(capturedFiles, options, false);
        }
        // Case 1 — worker explicitly rejected. Bubble up.
        throw err;
      }
      // Case 2 — worker unreachable. Log and continue with deserialized models.
      console.warn('[workspace] browser worker unreachable during hydrate; cross-ref resolution may be degraded:', msg);
    }

    if (revision === routedParseRevision && cacheEpoch === curatedCacheEpoch) {
      curatedLinkRecovery = {
        revision,
        epoch: cacheEpoch,
        files: capturedFiles,
        options: {
          ...options,
          curatedBundles: options.curatedBundles?.map((bundle) => ({ ...bundle })),
          hydrateNamespaces: options.hydrateNamespaces?.slice()
        },
        keys: new Set(
          hydrationDocuments.flatMap((doc) =>
            doc.artifactKey && restoredCuratedKeys.has(doc.artifactKey) ? [doc.artifactKey] : []
          )
        )
      };
    }

    return {
      type: 'parseWorkspaceResult',
      id: `routed:${Date.now()}`,
      models,
      parsedModels,
      deferredExports,
      errors: data.errors,
      curatedRefOnlyFiles
    };
    // Same raw-content concerns as parseWorkspaceFiles above — only counts.
  },
  {
    op: 'parseWorkspaceViaRouter',
    capture: Capture.Output,
    sanitize: (value, which) => {
      if (which !== 'output') return undefined;
      const result = value as ParseWorkspaceResponse;
      return { modelCount: result.models.length };
    }
  }
);

export const requestExpressionScope = withInstrumentation(
  async function requestExpressionScope(
    uri: string,
    nodeId: string,
    region: SourceRegion,
    files?: readonly WorkspaceFile[]
  ): Promise<ExpressionScopeEntry[]> {
    const snapshot = files
      ?.filter((file) => !file.path.endsWith(BUNDLE_MARKER_SUFFIX) && (!file.refOnly || file.serializedModelJson))
      .map((file) => ({
        name: pathToUri(file.path),
        content: file.content,
        serializedModelJson: file.serializedModelJson,
        exports: file.exports
      }));
    const response = await workerRequest({
      type: 'expressionScope',
      id: String(++requestId),
      uri: pathToUri(uri),
      name: nameFromNodeId(nodeId),
      kind: kindFromNodeId(nodeId),
      region,
      files: snapshot
    });
    if (response.type !== 'expressionScopeResult') throw new Error('Unexpected expression scope response');
    if (response.error) throw new Error(response.error);
    return response.entries;
  },
  { op: 'requestExpressionScope' }
);

export const linkDocument = withInstrumentation(
  async function linkDocument(uri: string): Promise<{ linked: boolean; errors: string[]; newModels: RosettaModel[] }> {
    try {
      const id = String(++requestId);
      const recovery = curatedLinkRecovery;
      let response = await workerRequest({
        type: 'linkDocument',
        id,
        uri
      });
      if (
        isLinkDocumentResponse(response) &&
        response.invalidArtifactKeys?.some((key) => recovery?.keys.has(key)) &&
        recovery &&
        (curatedLinkRecovery === recovery || recovery.pending) &&
        recovery.epoch === curatedCacheEpoch
      ) {
        recovery.pending ??= (async () => {
          const keys = [...recovery.keys];
          for (const key of keys) {
            curatedDocumentCache.delete(key);
            restoredCuratedKeys.delete(key);
          }
          await curatedArtifactCache.discardDocuments(keys);
          if (curatedLinkRecovery !== recovery || recovery.epoch !== curatedCacheEpoch) return false;
          const refreshed = await parseWorkspaceViaRouter(recovery.files, recovery.options, false);
          if (routedParseRevision !== recovery.revision + 1 || recovery.epoch !== curatedCacheEpoch) return false;
          const result = routedWorkspaceResult(refreshed);
          for (const listener of curatedRecoveryListeners) listener(result);
          return true;
        })();
        if (await recovery.pending) {
          response = await workerRequest({ type: 'linkDocument', id: String(++requestId), uri });
        }
      }
      if (isLinkDocumentResponse(response)) {
        return { linked: response.linked, errors: response.errors, newModels: response.newModels };
      }
      return { linked: false, errors: ['Unexpected response'], newModels: [] };
    } catch (error) {
      console.warn('[workspace] linkDocument failed:', error);
      useOutputStore
        .getState()
        .addLine(fmtLine('parse', 'link failed', error instanceof Error ? error.message : String(error)), 'error');
      return { linked: false, errors: [(error as Error).message], newModels: [] };
    }
    // `uri` (input) and errors/newModels (output) may reference user model
    // content — never captured; `linked` alone is a safe boolean.
  },
  {
    op: 'linkDocument',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' ? { linked: (value as { linked: boolean }).linked } : undefined)
  }
);

export const readFileList = withInstrumentation(
  async function readFileList(
    fileList: FileList,
    onProgress?: (progress: WorkspaceLoadProgress) => void
  ): Promise<WorkspaceFile[]> {
    const results: WorkspaceFile[] = [];

    // Collect rosetta file indices first
    const indices: number[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (file && file.name.endsWith('.rosetta')) {
        indices.push(i);
      }
    }

    const total = indices.length;
    const CHUNK_SIZE = 10;

    for (let chunk = 0; chunk < indices.length; chunk += CHUNK_SIZE) {
      const end = Math.min(chunk + CHUNK_SIZE, indices.length);
      // Reads within a chunk are independent files, so run them concurrently;
      // the chunking itself still exists to yield to the UI thread below.
      const chunkFiles = await Promise.all(
        Array.from({ length: end - chunk }, async (_, offset): Promise<WorkspaceFile> => {
          const file = fileList[indices[chunk + offset]!]!;
          const content = await file.text();
          return {
            name: file.name,
            path: file.webkitRelativePath || file.name,
            content,
            dirty: false
          };
        })
      );
      results.push(...chunkFiles);
      onProgress?.({ phase: 'reading', loaded: results.length, total });

      // Yield to the UI thread between chunks
      if (end < indices.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    return results;
    // `fileList` (raw browser Files, names may be user-chosen/sensitive) and
    // the output's file contents — never captured; only a count.
  },
  {
    op: 'readFileList',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' && Array.isArray(value) ? { count: value.length } : undefined)
  }
);

export const updateFileContent = withInstrumentation(
  function updateFileContent(files: readonly WorkspaceFile[], path: string, newContent: string): WorkspaceFile[] {
    return files.map((f) => (f.path === path ? { ...f, content: newContent, dirty: true } : f));
  },
  { op: 'updateFileContent' }
);

export const createWorkspaceFile = withInstrumentation(
  function createWorkspaceFile(name: string, content: string): WorkspaceFile {
    return {
      name,
      path: name,
      content,
      dirty: true
    };
  },
  { op: 'createWorkspaceFile' }
);

/**
 * Default starter template for a blank Rune file — a minimal `namespace`
 * declaration plus a commented stub so the editor/graph has something to
 * render without being completely empty.
 */
const BLANK_TEMPLATE = `namespace example

// Start typing — autocomplete, validation, and the graph update as you go.
//
// type Party:
//   name string (1..1)
`;

export const uniqueFilePath = withInstrumentation(
  function uniqueFilePath(candidate: string, existingFiles: ReadonlyArray<WorkspaceFile>): string {
    const paths = new Set(existingFiles.map((f) => f.path));
    if (!paths.has(candidate)) return candidate;
    const dotIndex = candidate.lastIndexOf('.');
    const base = dotIndex === -1 ? candidate : candidate.slice(0, dotIndex);
    const ext = dotIndex === -1 ? '' : candidate.slice(dotIndex);
    let n = 2;
    let next = `${base}-${n}${ext}`;
    while (paths.has(next)) {
      n += 1;
      next = `${base}-${n}${ext}`;
    }
    return next;
    // `candidate`/existing paths may echo user-chosen filenames — never captured.
  },
  { op: 'uniqueFilePath' }
);

export const createBlankWorkspaceFile = withInstrumentation(
  function createBlankWorkspaceFile(existingFiles: ReadonlyArray<WorkspaceFile>): WorkspaceFile {
    const userFiles = existingFiles.filter((f) => !f.readOnly);
    const candidate = uniqueFilePath('untitled.rosetta', userFiles);
    return createWorkspaceFile(candidate, BLANK_TEMPLATE);
  },
  { op: 'createBlankWorkspaceFile' }
);

// ---------------------------------------------------------------------------
// Model file merging (T008) — integrate loaded reference models
// ---------------------------------------------------------------------------

/**
 * Merge loaded model files into the workspace as read-only entries.
 * Model files are prefixed with the model source ID to avoid path collisions.
 * Existing user files are preserved; model files are appended.
 *
 * 019 Phase 0: When a curated bundle was loaded via the server-side parse
 * path (Task 0.5a), `model.files` will be empty. In that case a synthetic
 * bundle-marker entry is inserted so that collectCuratedBundlesFromWorkspace
 * can still find the bundle id+version to include in /api/parse requests.
 * The marker is excluded from /api/parse's `userFiles` filter (via the
 * truthy `serializedModelJson`) and from LSP sync in App.tsx (filtered by
 * BUNDLE_MARKER_SUFFIX). Callers that iterate over model files for display
 * (e.g. namespace explorer) should filter out bundle-marker paths.
 */
export const BUNDLE_MARKER_SUFFIX = '/.bundle-marker';

/** Files available for workspace authoring controls such as tabs and search. */
// oxlint-disable-next-line rune/no-uninstrumented-export -- Pure per-file render predicate; tracing every file would add noise.
export function isUserWorkspaceFile(file: WorkspaceFile): boolean {
  return !file.readOnly && !file.refOnly && !file.path.endsWith(BUNDLE_MARKER_SUFFIX);
}

export const mergeModelFiles = withInstrumentation(
  function mergeModelFiles(currentFiles: WorkspaceFile[], model: LoadedModel): WorkspaceFile[] {
    // Remove any previous files from this model source
    const userFiles = currentFiles.filter((f) => !f.path.startsWith(`[${model.source.id}]/`));

    // Convert model files to read-only workspace files.
    // bundleId and bundleVersion are propagated from the LoadedModel so that
    // parseWorkspaceFiles / collectCuratedBundlesFromWorkspace can build the
    // curatedBundles list for /api/parse without touching the model-store.
    const modelFiles: WorkspaceFile[] = model.files.map((f: CachedFile) => ({
      name: f.path.split('/').pop() ?? f.path,
      path: `[${model.source.id}]/${f.path}`,
      content: f.content,
      dirty: false,
      readOnly: true,
      serializedModelJson: f.serializedModelJson,
      exports: f.exports,
      bundleId: model.source.id,
      bundleVersion: model.commitHash,
      namespace: f.namespace,
      artifactKey: f.artifactKey,
      refOnly: f.refOnly,
      sourceLoaded: f.sourceLoaded
    }));

    // 019 Phase 0: when no files were extracted (server-side parse path),
    // insert a synthetic bundle-marker so collectCuratedBundlesFromWorkspace
    // can find the bundle id+version without the corpus files being present.
    // The marker has a truthy serializedModelJson so parseWorkspaceFiles
    // excludes it from the userFiles sent to the server. App.tsx filters it
    // from syncWorkspaceFiles via BUNDLE_MARKER_SUFFIX to avoid LSP noise.
    if (modelFiles.length === 0) {
      modelFiles.push({
        name: '.bundle-marker',
        path: `[${model.source.id}]${BUNDLE_MARKER_SUFFIX}`,
        content: '',
        dirty: false,
        readOnly: true,
        // Non-empty string → excluded from userFiles by `!f.serializedModelJson` filter.
        serializedModelJson: '{}',
        bundleId: model.source.id,
        bundleVersion: model.commitHash
      });
    }

    return [...userFiles, ...modelFiles];
    // `model.source.id` is either a curated id or an already-hashed custom-URL
    // id (see model-registry.ts) — safe. File contents (input and output) are
    // never captured.
  },
  {
    op: 'mergeModelFiles',
    capture: Capture.Input,
    sanitize: (value, which) => {
      if (which !== 'input') return undefined;
      const [, model] = value as [WorkspaceFile[], LoadedModel];
      return { modelSourceId: model.source.id, fileCount: model.files.length };
    }
  }
);

export const mergeCuratedRefOnlyFiles = withInstrumentation(
  function mergeCuratedRefOnlyFiles(
    currentFiles: WorkspaceFile[],
    curatedRefOnlyFiles: Record<string, CachedFile[]>,
    loadedModels: ReadonlyMap<string, LoadedModel>
  ): WorkspaceFile[] {
    let mergedFiles = currentFiles;
    for (const [bundleId, entries] of Object.entries(curatedRefOnlyFiles)) {
      const existingModel = loadedModels.get(bundleId);
      if (!existingModel) continue;
      mergedFiles = mergeModelFiles(mergedFiles, { ...existingModel, files: entries });
    }
    return mergedFiles;
  },
  {
    op: 'mergeCuratedRefOnlyFiles',
    capture: Capture.Input,
    sanitize: (value, which) => {
      if (which !== 'input') return undefined;
      const [, curatedRefOnlyFiles] = value as [WorkspaceFile[], Record<string, unknown>];
      return { bundleCount: Object.keys(curatedRefOnlyFiles).length };
    }
  }
);

// `sourceId` is safe (see mergeModelFiles above); the returned file list
// still carries other files' raw content, so only input is captured.
export const removeModelFiles = withInstrumentation(
  function removeModelFiles(currentFiles: WorkspaceFile[], sourceId: string): WorkspaceFile[] {
    return currentFiles.filter((f) => !f.path.startsWith(`[${sourceId}]/`));
  },
  {
    op: 'removeModelFiles',
    capture: Capture.Input,
    sanitize: (value, which) => (which === 'input' ? { sourceId: (value as [WorkspaceFile[], string])[1] } : undefined)
  }
);

// ---------------------------------------------------------------------------
// External file change detection (T102)
// ---------------------------------------------------------------------------

export type FileChangeAction = 'keep' | 'reload';

export interface FileChangeEvent {
  path: string;
  newContent: string;
}

export const detectExternalChanges = withInstrumentation(
  async function detectExternalChanges(
    currentFiles: WorkspaceFile[],
    newFileList: FileList
  ): Promise<FileChangeEvent[]> {
    const changes: FileChangeEvent[] = [];
    const newFiles = await readFileList(newFileList);
    const currentByPath = new Map(currentFiles.map((f) => [f.path, f]));

    for (const newFile of newFiles) {
      const existing = currentByPath.get(newFile.path);
      if (existing && existing.content !== newFile.content) {
        changes.push({ path: newFile.path, newContent: newFile.content });
      }
    }

    return changes;
    // `changes[].newContent` is raw file content — never captured; only a count.
  },
  {
    op: 'detectExternalChanges',
    capture: Capture.Output,
    sanitize: (value, which) =>
      which === 'output' && Array.isArray(value) ? { changedCount: value.length } : undefined
  }
);

export const applyFileChanges = withInstrumentation(
  function applyFileChanges(
    files: WorkspaceFile[],
    changes: FileChangeEvent[],
    decisions: Map<string, FileChangeAction>
  ): WorkspaceFile[] {
    return files.map((f) => {
      const decision = decisions.get(f.path);
      if (decision === 'reload') {
        const change = changes.find((c) => c.path === f.path);
        if (change) {
          return { ...f, content: change.newContent, dirty: false };
        }
      }
      return f;
    });
  },
  { op: 'applyFileChanges' }
);

/**
 * Error raised by downloadTargetViaRouter so callers can read the
 * per-diagnostic detail of an /api/codegen failure without re-parsing
 * the response. Mirrors the function's JSON envelope (spec §7.6).
 */
export class CodegenDownloadError extends Error {
  readonly status: number;
  readonly diagnostics: ReadonlyArray<{ severity: string; code: string; message: string }>;
  constructor(
    message: string,
    status: number,
    diagnostics: ReadonlyArray<{ severity: string; code: string; message: string }> = []
  ) {
    super(message);
    this.name = 'CodegenDownloadError';
    this.status = status;
    this.diagnostics = diagnostics;
  }
}

/** Decode the documented /api/codegen failure envelope into its shared error type. */
export const throwCodegenDownloadError = withInstrumentation(
  async function throwCodegenDownloadError(response: Response): Promise<never> {
    let envelope: { ok?: boolean; error?: string; diagnostics?: unknown } = {};
    try {
      envelope = (await response.json()) as typeof envelope;
    } catch {
      // A gateway can return a non-JSON failure before the application handler.
    }
    const diagnostics = Array.isArray(envelope.diagnostics)
      ? (envelope.diagnostics as ReadonlyArray<{ severity: string; code: string; message: string }>)
      : [];
    throw new CodegenDownloadError(
      envelope.error ?? `/api/codegen HTTP ${response.status}`,
      response.status,
      diagnostics
    );
  },
  { op: 'throwCodegenDownloadError' }
);

/**
 * Sanitize a filename so it's safe to assign to `<a download="...">`.
 * Strips control chars (incl. CR/LF, which could enable header-style
 * injection on rare browsers), reduces path-separator characters to
 * the basename, and removes any embedded quotes. Falls back to the
 * caller's default when the result is empty.
 *
 * Defense-in-depth: the server we control returns well-formed
 * filenames, but a malicious or compromised response shouldn't be
 * able to coerce the browser into saving with a path-traversal name.
 */
/**
 * Pull the `filename="..."` value from a Content-Disposition header.
 * Falls back to the given default when the header is missing or
 * malformed. Always passes the extracted value through
 * `sanitizeDownloadFilename` so a hostile server response can't inject
 * control chars or path components into the browser's save dialog
 * (Copilot review on PR #165).
 */
function parseContentDispositionFilename(header: string | null, fallback: string): string {
  if (!header) return fallback;
  // Matches filename="value" (preferred) or unquoted filename=value.
  const match = /filename\*?=("([^"]+)"|([^;]+))/i.exec(header);
  if (!match) return fallback;
  const raw = (match[2] ?? match[3] ?? '').trim();
  return sanitizeDownloadFilename(raw, fallback);
}

/**
 * Trigger a browser save for `blob` using the document API. Creates a
 * temporary anchor with an object URL, clicks it, then revokes the URL.
 */
function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export const downloadTargetViaRouter = withInstrumentation(
  async function downloadTargetViaRouter(
    files: Array<{ path: string; content: string }>,
    target: string,
    options: Record<string, unknown> = {},
    curatedBundles: ReadonlyArray<{ id: string; version: string }> = [],
    namespaces: ReadonlyArray<string> = [],
    curatedDocs: ReadonlyArray<{ uri: string; serializedModel: string }> = [],
    selection?: ExportSelection,
    signal?: AbortSignal
  ): Promise<void> {
    const body: Record<string, unknown> = { files, target, options };
    // Send BOTH when available — NOT mutually exclusive. The server prefers
    // curatedBundles (it independently fetches + dependency-closes the
    // correct namespace set from the manifest) and only falls back to
    // curatedDocs when no bundle info was supplied at all. curatedDocs alone
    // can be silently incomplete relative to `namespaces`: it reflects
    // whatever the client's workspace has ALREADY hydrated via on-demand
    // navigation, which doesn't necessarily cover the full dependency-closed
    // selection this request asks for (found via the 2026-07 /api/codegen
    // 400 investigation — a Download for one curated anchor type produced
    // "unknown-attribute"/"unresolved-enum-reference" diagnostics for
    // completely unrelated types, because curatedDocs was missing a few
    // namespaces one `extends`/`import` hop away that the server trusted as
    // complete purely because it was non-empty).
    if (curatedDocs.length > 0) {
      body.curatedDocs = curatedDocs;
    }
    if (curatedBundles.length > 0) {
      body.curatedBundles = curatedBundles;
    }
    // §5.3 — forward the modal's dependency-closed namespace subset. Empty =
    // no filter (emit everything), matching the server's interpretation.
    if (selection && namespaces.length > 0) {
      throw new TypeError('Declaration selection cannot be combined with a legacy namespace allowlist.');
    }
    if (namespaces.length > 0) {
      body.namespaces = namespaces;
    }
    if (selection) body.selection = selection;
    const response = await requestCodegenDownload(body, signal);

    if (!response.ok) {
      return throwCodegenDownloadError(response);
    }

    const blob = await response.blob();
    const filename = parseContentDispositionFilename(response.headers.get('Content-Disposition'), `${target}-output`);
    triggerBlobDownload(blob, filename);
    // `target` is one of a fixed, app-defined set of codegen language ids
    // (typescript/json-schema/sql/xsd/openapi/...) — safe. `files`/`options`/
    // `namespaces`/`curatedDocs` may carry user model content — never captured.
  },
  {
    op: 'downloadTargetViaRouter',
    capture: Capture.Input,
    sanitize: (value, which) => {
      if (which !== 'input') return undefined;
      const [files, target, , curatedBundles, namespaces] = value as [
        unknown[],
        string,
        unknown,
        ReadonlyArray<unknown> | undefined,
        ReadonlyArray<unknown> | undefined
      ];
      return {
        target,
        fileCount: files.length,
        curatedBundleCount: curatedBundles?.length ?? 0,
        namespaceCount: namespaces?.length ?? 0
      };
    }
  }
);
