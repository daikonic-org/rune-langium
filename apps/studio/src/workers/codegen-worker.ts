// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/// <reference lib="webworker" />

import { Temporal } from '@js-temporal/polyfill';
import { withInstrumentation } from '../services/instrumentation/core.js';

/**
 * Dedicated worker for running @rune-langium/codegen off the main thread.
 * Accepts code-preview and form-preview messages, tracks the latest request
 * identity per surface, and echoes request ids back so the UI can discard
 * stale replies after files or selections change.
 *
 *   codegen:setFiles         — Install the workspace file set without generating.
 *   codegen:generate         — (Re-)generate using the current file set.
 *   preview:setFiles         — Update the workspace file set and re-run the last preview target.
 *   preview:generate         — (Re-)generate the selected form-preview target.
 *   instance:validate        — Validate an instance's data against its type's structural + condition rules.
 *   instance:generateSchema  — Fetch a FormPreviewSchema for instance-editing, on its OWN request/response
 *                              pair — deliberately NOT `preview:generate`/`preview:result`, so it never
 *                              touches `lastPreviewTargetId`/`lastPreviewRequestId` (finding #6/#7 fix;
 *                              those touch the target `preview:setFiles` re-runs on a workspace file
 *                              change, and previously an instance schema fetch could silently corrupt it).
 *
 * Responds with:
 *   codegen:result              — On success; returns the full generated file set for the target.
 *   codegen:outdated            — When files are missing or contain parse errors.
 *   codegen:error                — When generation itself fails unexpectedly.
 *   preview:result               — On success; returns the generated form-preview schema.
 *   preview:stale                — When preview inputs are missing, unsupported, or stale.
 *   instance:validateResult      — Structural + condition diagnostics for an `instance:validate` request.
 *   instance:generateSchemaResult — On success; returns the generated form-preview schema.
 *   instance:generateSchemaStale  — When schema inputs are missing, unsupported, or stale.
 */

import type { LangiumDocument } from 'langium';
import { URI, AstUtils } from 'langium';
import { transform } from 'sucrase';
import {
  createRuneDslServices,
  hydrateModelDocuments,
  getExpressionOwners,
  getExpressionRegions,
  getFunctionImplementationRegion,
  getNodeSourceRegion,
  isRosettaFunction,
  namespaceFromModelName,
  type RosettaModel,
  type RuneDslIndexManager
} from '@rune-langium/core';
import {
  generate,
  generatePreviewSchemas,
  emitStandaloneZodSchema,
  RUNTIME_HELPER_JS_SOURCE,
  normalizePreviewInputs,
  selectTypeScriptProjection,
  resolveExportSelection,
  resolveEffectiveProjectTargetId,
  generatePythonModule,
  selectPythonProjection
} from '@rune-langium/codegen/export';
import type {
  Target,
  FormPreviewSchema,
  GeneratorOutput,
  GeneratorDiagnostic,
  PythonModule
} from '@rune-langium/codegen/export';
import { findDataNode, getActiveConditionPredicates } from '@rune-langium/codegen/instances';
import type { ValidationDiagnostic } from '@rune-langium/codegen/instances';
import { qualifiedNameFromNodeId, makeNodeId } from '@rune-langium/visual-editor/identifiers';
import type { PreviewWorkerRequest, ProjectionRequest } from '../services/codegen-service.js';
import { z } from 'zod';
import { buildEffectiveProject, type EffectiveProject } from '@rune-langium/project-runtime/effective';
import { projectReceiptMatches } from '@rune-langium/project-runtime/receipt';
import { readProjectResolutionContext } from '@rune-langium/project-runtime/context';
import type { ProjectResolutionReceipt } from '@rune-langium/core/project-contract';
import type { ProjectRuntimeInput } from '../services/project-runtime-input.js';
import { projectOperationError } from '../services/project-worker-bridge.js';
import { formatGeneratedProjection } from '../services/projection-format.js';
import { isWorkerGlobalScope } from './runtime-guards.js';
import { installInstrumentationWorkerSink } from '../services/instrumentation/worker-sink.js';

// Gated behind `isWorkerGlobalScope()` for the same reason as the message
// listener at the bottom of this file: no main-bundle code statically
// imports this module today, but the moment something does (e.g. a
// re-exported type), an unguarded top-level `installInstrumentationWorkerSink`
// would run during that main-thread import with `self` being `window` and
// hijack the main thread's `configureInstrumentation` slot away from the
// browser sink installed at bootstrap (PR #214 precedent).
if (isWorkerGlobalScope()) {
  installInstrumentationWorkerSink((msg) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg));
}

// ---------------------------------------------------------------------------
// Message types (inbound)
// ---------------------------------------------------------------------------

interface FileEntry {
  uri: string;
  content: string;
  /**
   * Pre-serialized Langium AST for curated bundle files. When present,
   * `buildDocuments` deserializes this directly instead of parsing
   * `content` (which is empty for curated refOnly entries). 019
   * Task #88 follow-up.
   */
  serializedModelJson?: string;
}

interface SetFilesMessage {
  type: 'codegen:setFiles';
  files: FileEntry[];
}

interface GenerateMessage {
  type: 'codegen:generate';
  target?: Target;
  requestId?: string;
  selection?: Parameters<typeof resolveExportSelection>[1];
  regenerate?: boolean;
}

interface PreviewExecuteMessage {
  type: 'preview:execute';
  funcName: string;
  inputs: Record<string, unknown>;
  requestId: string;
}

interface InstanceValidateMessage {
  functionInputs?: boolean;
  type: 'instance:validate';
  typeFqn: string;
  data: Record<string, unknown>;
  requestId: string;
}

interface InstanceGenerateSchemaMessage {
  type: 'instance:generateSchema';
  typeFqn: string;
  requestId: string;
}

type InboundMessage = SetFilesMessage | GenerateMessage;
type WorkerOperation =
  | InboundMessage
  | PreviewWorkerRequest
  | PreviewExecuteMessage
  | InstanceValidateMessage
  | ProjectionRequest
  | InstanceGenerateSchemaMessage;
type WorkerInboundMessage = WorkerOperation & { projectReceipt?: ProjectResolutionReceipt };

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const { RuneDsl } = createRuneDslServices();
const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
const builder = RuneDsl.shared.workspace.DocumentBuilder;

interface ProjectGeneration {
  receipt?: ProjectResolutionReceipt;
  ready: Promise<EffectiveProject>;
}
let projectGeneration: ProjectGeneration | undefined;

/** Capture the generation before an operation yields; late results never borrow a newer receipt. */
function operationScope() {
  const generation = projectGeneration;
  const receipt = generation?.receipt;
  return {
    postMessage(message: Record<string, unknown>) {
      if (generation !== projectGeneration) return;
      (self as unknown as DedicatedWorkerGlobalScope).postMessage({
        ...message,
        ...(receipt ? { projectReceipt: receipt } : {})
      });
    }
  };
}

async function applyProject(input: ProjectRuntimeInput): Promise<EffectiveProject> {
  const context = await readProjectResolutionContext(input.resolution);
  const graph = await buildEffectiveProject(input.snapshot, input.referenceDocuments);
  if (
    !projectReceiptMatches(context.context.receipt, input.receipt) ||
    !projectReceiptMatches(graph.receipt, input.receipt)
  )
    throw new Error('Project receipt does not match the captured source and configuration.');
  if (graph.diagnostics.some((issue) => issue.severity === 'error'))
    throw new Error(graph.diagnostics.map((issue) => issue.message).join('\n'));
  return graph;
}

function rejectProjectOperation(message: WorkerInboundMessage, error: string) {
  if (!('requestId' in message) || !message.requestId) return;
  const response = projectOperationError(message as unknown as Record<string, unknown>, error);
  if (response)
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({
      ...response,
      ...(message.projectReceipt ? { projectReceipt: message.projectReceipt } : {})
    });
}

let currentCodegenFiles: FileEntry[] = [];
let currentPreviewFiles: FileEntry[] = [];
let lastTarget: Target = 'zod';
let lastCodegenRequestId: string | undefined;
let lastPreviewTargetId: string | undefined;
let lastPreviewRequestId: string | undefined;
let previewFilesVersion = 0;
let previewFilesRevision = 0;
let previewVersionStartRevision = 0;
const documentsCache = new Map<string, VersionedEntry<{ all: LangiumDocument[]; valid: LangiumDocument[] }>>();
const previewSchemaCache = new Map<string, VersionedEntry<FormPreviewSchema[]>>();
const previewGenerateCache = new Map<string, VersionedEntry<GeneratorOutput[]>>();
const previewPythonCache = new Map<string, VersionedEntry<PythonModule>>();
let codegenFilesVersion = 0;
// One result per output target, rather than retaining every visited declaration.
const codegenGenerateCache = new Map<string, VersionedEntry<{ selectionKey: string; results: GeneratorOutput[] }>>();
const standaloneValidatorCache = new Map<string, VersionedEntry<StandaloneValidatorResult>>();

// Curated documents are relinked as a BATCH once per `preview:setFiles`
// (the only message that ever carries new curated content) and cached here
// for `buildDocuments()` to read on every `runPreview`/`runInstanceSchema`/
// `executeFunction`/`validateInstance` call. See `hydrateCuratedDocuments`.
let cachedCuratedDocuments: LangiumDocument[] = [];
let indexedCuratedDocuments: LangiumDocument[] | undefined;
let lastCuratedEntries: FileEntry[] = [];

// Shared trace boundaries capture timings only, never source, ASTs or instance values.
const previewStageTelemetry = {
  level: 'trace',
  capture: 0,
  sanitizeError: () => ({ signature: 'preview-stage-error' })
} as const;
const previewStages = {
  hydrateDocuments: withInstrumentation(hydrateCuratedDocuments, {
    ...previewStageTelemetry,
    op: 'previewHydrateDocuments'
  }),
  buildDocuments: withInstrumentation(buildDocuments, { ...previewStageTelemetry, op: 'previewBuildDocuments' }),
  generateSchema: withInstrumentation(runPreview, { ...previewStageTelemetry, op: 'previewGenerateSchema' }),
  generateProjection: withInstrumentation(runProjection, { ...previewStageTelemetry, op: 'previewGenerateProjection' }),
  executeFunction: withInstrumentation(executeFunction, { ...previewStageTelemetry, op: 'previewExecuteFunction' })
};

function isPreviewUserEntryParseable(entry: FileEntry): boolean {
  const lowerUri = entry.uri.toLowerCase();
  // Defensive guard: preview input should only parse real source files.
  // List-only curated refs use synthetic extensionless URIs plus empty content;
  // routing them through Langium's parser triggers "no services for the
  // extension ''". Hydrated curated entries are handled separately through
  // `serializedModelJson`.
  return lowerUri.endsWith('.rosetta') && entry.content.trim().length > 0;
}

function hasDocumentErrors(document: LangiumDocument): boolean {
  const hasDiagnostics = (document.diagnostics ?? []).some((diagnostic) => diagnostic.severity === 1);
  const hasLexerErrors = document.parseResult.lexerErrors.length > 0;
  const hasParserErrors = document.parseResult.parserErrors.length > 0;
  return hasDiagnostics || hasLexerErrors || hasParserErrors;
}

function curatedEntriesChanged(next: FileEntry[]): boolean {
  if (next.length !== lastCuratedEntries.length) return true;
  return next.some((entry, i) => {
    const prev = lastCuratedEntries[i];
    return !prev || prev.uri !== entry.uri || prev.serializedModelJson !== entry.serializedModelJson;
  });
}

/**
 * Relinks curated documents as a batch via `hydrateModelDocuments`
 * (`packages/core`'s shared-object-graph deserialization — see its doc comment) and caches the result in `cachedCuratedDocuments`
 * for `buildDocuments()` to read.
 *
 * Called once per `preview:setFiles` — the only message that ever carries
 * new curated content (`codegen:setFiles` carries user-authored files
 * only) — NOT from inside `buildDocuments()` itself, which runs on every
 * `runPreview`/`runInstanceSchema`/`executeFunction`/`validateInstance`
 * call and would turn this batch relink (up to 8 re-deserialize rounds
 * over every curated entry) into a real performance regression versus the
 * old idempotent per-entry lookup.
 *
 * `serializedModelJson` strings are passed through unchanged from the main
 * thread for a given curated document (they're immutable per-session
 * snapshots). `curatedEntriesChanged` compares them with `!==`, which for
 * string primitives is always a full value comparison (JS strings have no
 * separate "reference identity" the way objects do) — so this is a
 * complete content comparison of the curated set on every
 * `preview:setFiles`, not a cheap identity check. It is still far cheaper
 * than running the relink unconditionally, which is the actual cost this
 * guards against.
 */
function hydrateCuratedDocuments(entries: FileEntry[]): void {
  const curatedEntries = entries.filter((e) => Boolean(e.serializedModelJson));
  if (!curatedEntriesChanged(curatedEntries)) return; // identical set — skip the relink entirely
  lastCuratedEntries = curatedEntries;
  // Remove exports for replaced/unloaded artifacts as well as registering new ones below.
  for (const document of cachedCuratedDocuments) RuneDsl.shared.workspace.IndexManager.removeContent(document.uri);
  try {
    cachedCuratedDocuments = hydrateModelDocuments(
      { RuneDsl, shared: RuneDsl.shared },
      curatedEntries.map((entry) => ({ uri: entry.uri, json: entry.serializedModelJson! }))
    ).map((r) => r.document);
  } catch (err) {
    // hydrateModelDocuments does not isolate per-entry deserialize failures
    // the way the old per-entry loop did (one bad curated doc now skips the
    // whole curated batch for this build rather than just itself). Accepted
    // trade-off — see design doc §Background/Root Cause. If this proves too
    // coarse in practice, add per-entry isolation to hydrateModelDocuments
    // itself in packages/core, not a local workaround here (DRY).
    console.warn('[codegen-worker] Failed to hydrate curated documents; excluded from preview.', err);
    cachedCuratedDocuments = [];
  }
}

// ---------------------------------------------------------------------------
// Versioned cache primitive
// ---------------------------------------------------------------------------

/**
 * Every cache in this file is invalidated by comparing a stored version
 * number against a live counter (`previewFilesVersion`/`codegenFilesVersion`)
 * bumped whenever the relevant file set changes — never by content hashing
 * or a TTL.
 */
interface VersionedEntry<T> {
  version: number;
  value: T;
}

/**
 * Returns the full `VersionedEntry`, not just its `value` — callers that
 * feed this result into a FURTHER downstream cache (e.g. `buildDocuments()`'s
 * result feeding `previewSchemaCache`/`previewGenerateCache`) must tag that
 * downstream entry with the version returned here, not with whatever the
 * live counter reads at that later point. Re-sampling the live counter
 * after this call already reflects a file-set change that this specific
 * result predates — see `getOrComputeAsync`'s own doc comment for the
 * concrete failure mode.
 */
function getOrCompute<T>(
  cache: Map<string, VersionedEntry<T>>,
  key: string,
  version: number,
  compute: () => T
): VersionedEntry<T> {
  const cached = cache.get(key);
  if (cached && cached.version === version) return cached;
  const entry: VersionedEntry<T> = { version, value: compute() };
  // Never let a write tagged with a STALE version (an out-of-order caller
  // whose own input predates a concurrently-already-cached, newer entry —
  // see this function's doc comment) clobber that newer entry. This call's
  // own request is still answered with a freshly-computed, correctly-tagged
  // result; it just isn't allowed to regress the shared cache.
  if (!cached || cached.version < version) {
    cache.set(key, entry);
  }
  return entry;
}

/**
 * Async variant. Captures `getVersion()` BEFORE awaiting `compute()`, and
 * tags the result with that captured version regardless of what `getVersion()`
 * reads once `compute()` resolves.
 *
 * The write guard compares against the CACHE's own current state, not
 * `getVersion()` re-invoked — mirrors `getOrCompute`'s guard above. Re-reading
 * `getVersion()` here would work for a caller passing a live counter
 * (`buildDocuments()`'s `() => previewFilesVersion`) but is a no-op for a
 * caller passing a closure over an already-fixed version (`executeFunction`/
 * `runCodegen`'s `() => documentsVersion`, threaded forward from an earlier
 * `getOrComputeAsync` call per this cache's own doc comment) — that closure
 * returns the same value both before and after `await compute()`, so the
 * "still current?" check would trivially always pass, letting an
 * out-of-order caller (started under an older version, but whose OWN
 * `compute()` — e.g. `generate()` — takes longer than a concurrent newer
 * call's) overwrite an already-cached newer entry with its stale one. The
 * cache-state comparison catches this uniformly for both kinds of callers.
 *
 * Returns the full `VersionedEntry`, tagged with `versionAtStart` even when
 * the write was skipped — callers that feed this result into a FURTHER
 * downstream cache must tag that entry with THIS version, not the live
 * counter (see `getOrCompute`'s doc comment for the concrete failure mode).
 * `buildDocuments()`, `executeFunction`, and `runCodegen` all thread this
 * returned `version` forward into their own `getOrCompute`/`getOrComputeAsync`
 * calls for exactly this reason.
 */
async function getOrComputeAsync<T>(
  cache: Map<string, VersionedEntry<T>>,
  key: string,
  getVersion: () => number,
  compute: () => Promise<T>
): Promise<VersionedEntry<T>> {
  const versionAtStart = getVersion();
  const cached = cache.get(key);
  if (cached && cached.version === versionAtStart) return cached;
  const value = await compute();
  const entry: VersionedEntry<T> = { version: versionAtStart, value };
  const cachedNow = cache.get(key);
  if (!cachedNow || cachedNow.version < versionAtStart) {
    cache.set(key, entry);
  }
  return entry;
}

interface StandaloneValidatorResult {
  validator: z.ZodTypeAny | undefined;
  diagnostics: GeneratorDiagnostic[];
}

/**
 * Compiles `typeFqn`'s real Zod schema via `emitStandaloneZodSchema`
 * (packages/codegen/src/emit/standalone-schema.ts) and evaluates it through
 * `runInWorkerSandbox` — the same hardened `new Function` path
 * `executeFunction`/`validateInstance`'s condition predicates already use;
 * do not add a second one.
 *
 * Fully synchronous — `emitStandaloneZodSchema` and the sandbox eval both
 * have no `await` anywhere in this call — so its cache (below) uses the
 * sync `getOrCompute`, not `getOrComputeAsync`.
 */
function compileStandaloneValidator(
  documents: LangiumDocument[],
  typeFqn: string,
  functionInputs = false
): StandaloneValidatorResult {
  const { code, diagnostics, schemaName } = functionInputs
    ? emitStandaloneZodSchema(documents, typeFqn, { functionInputs: true })
    : emitStandaloneZodSchema(documents, typeFqn);
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { validator: undefined, diagnostics };
  }
  // emitStandaloneZodSchema always names the target's own schema constant
  // `${bareName}Schema` (zod-emitter.ts's schemaName convention), and
  // typeFqn's own bare name (its final `.`-segment) is exactly that name.
  const targetName = typeFqn.slice(typeFqn.lastIndexOf('.') + 1);
  try {
    const stripped = transpileGeneratedTypeScript(code.replace(/^import .*;$/gm, ''), `${typeFqn}.zod.ts`);
    const validator = runInWorkerSandbox(
      `const exports = {};\n${stripped}`,
      'z',
      z,
      `exports[${JSON.stringify(schemaName ?? `${targetName}Schema`)}]`
    ) as z.ZodTypeAny;
    return { validator, diagnostics };
  } catch (err) {
    return {
      validator: undefined,
      diagnostics: [
        ...diagnostics,
        {
          severity: 'error',
          code: 'compile-error',
          message: err instanceof Error ? err.message : String(err)
        }
      ]
    };
  }
}

// ---------------------------------------------------------------------------
// Generation logic
// ---------------------------------------------------------------------------

async function runCodegen(
  target: Target,
  requestId?: string,
  selection?: GenerateMessage['selection'],
  regenerate = false
): Promise<void> {
  const scope = operationScope();

  if (!projectGeneration && (selection ? currentPreviewFiles : currentCodegenFiles).length === 0) {
    scope.postMessage({
      type: 'codegen:outdated',
      target,
      requestId,
      message: 'No files are loaded for code preview.'
    });
    return;
  }

  try {
    // Captured before the only `await` below, mirroring buildDocuments()'s
    // own guard — a codegen:setFiles that arrives while this call is
    // suspended in builder.build bumps codegenFilesVersion out from under
    // `documents`, which is already stale by then. Tagging the downstream
    // codegenGenerateCache write with THIS captured version (not the live
    // counter re-sampled after the build) ensures a stale-derived result
    // is never marked valid for the new version.
    const project = projectGeneration;
    const documentsVersion = selection || project ? previewFilesVersion : codegenFilesVersion;

    let documents: LangiumDocument[];
    const invalidDocumentUris = new Set<string>();
    if (selection) {
      const allDocuments = (await previewStages.buildDocuments(true)).value;
      for (const document of allDocuments) {
        if (hasDocumentErrors(document)) invalidDocumentUris.add(document.uri.toString());
      }
      const resolved = resolveExportSelection(allDocuments, selection);
      if (documentsVersion !== previewFilesVersion) return;
      if (resolved.unknown.length || resolved.unknownNamespaces.length) {
        scope.postMessage({
          type: 'codegen:outdated',
          target,
          requestId,
          message: 'Selected source is unavailable or invalid. Fix or reload it to refresh the code preview.'
        });
        return;
      }
      documents = resolved.documents;
    } else if (project) {
      documents = (await previewStages.buildDocuments(true)).value;
    } else {
      documents = currentCodegenFiles.map(({ uri, content }) => factory.fromString(content, URI.parse(uri)));
      await builder.build(documents, { validation: false, eagerLinking: false });
    }

    const hasErrors =
      documents.some(hasDocumentErrors) ||
      (selection &&
        documents.some((document) =>
          AstUtils.streamAllContents(document.parseResult.value).some((node) =>
            AstUtils.streamReferences(node).some(({ reference }) => {
              const targetUri = reference.error?.targetDescription?.documentUri;
              return targetUri !== undefined && invalidDocumentUris.has(targetUri.toString());
            })
          )
        ));

    if (hasErrors) {
      scope.postMessage({
        type: 'codegen:outdated',
        target,
        requestId,
        message: 'Fix model errors to refresh the code preview.'
      });
      return;
    }

    const selectionKey = JSON.stringify(selection ?? null);
    if (regenerate || codegenGenerateCache.get(target)?.value.selectionKey !== selectionKey)
      codegenGenerateCache.delete(target);
    const {
      value: { results }
    } = await getOrComputeAsync(
      codegenGenerateCache,
      target,
      () => documentsVersion,
      async () => ({ selectionKey, results: await generate(documents, { target }) })
    );

    if (documentsVersion !== (selection || project ? previewFilesVersion : codegenFilesVersion)) return;

    // 018 Task 0.7 follow-up — when every output carries an error
    // diagnostic AND no content (the shape returned by `runGenerate`
    // for not-yet-implemented targets), surface it as `codegen:error`
    // so the panel shows "Preview unavailable" instead of misleading
    // "Generated (X)" with empty content.
    const allOutputsAreErrors =
      results.length > 0 && results.every((r) => r.content === '' && r.diagnostics.some((d) => d.severity === 'error'));
    if (allOutputsAreErrors) {
      const firstError = results[0]!.diagnostics.find((d) => d.severity === 'error');
      scope.postMessage({
        type: 'codegen:error',
        target,
        requestId,
        message: firstError?.message ?? 'Code generation produced only errors.'
      });
      return;
    }

    scope.postMessage({
      type: 'codegen:result',
      target,
      requestId,
      files: results.map((result) => ({
        relativePath: result.relativePath,
        content: result.content,
        sourceMap: result.sourceMap
      }))
    });
  } catch (err) {
    console.error('[codegen-worker] Generation error:', err);
    scope.postMessage({
      type: 'codegen:error',
      target,
      requestId,
      message: err instanceof Error ? err.message : 'Code generation failed.'
    });
  }
}

async function buildDocuments(includeInvalid = false): Promise<VersionedEntry<LangiumDocument[]>> {
  const generation = projectGeneration;
  if (generation) {
    const version = previewFilesVersion;
    const graph = await generation.ready;
    return { version, value: [...graph.documents] };
  }
  const entry = await getOrComputeAsync(
    documentsCache,
    'documents',
    () => previewFilesVersion,
    async () => {
      if (!projectGeneration && currentPreviewFiles.length === 0) {
        return { all: [], valid: [] };
      }

      // 019 Task #88 follow-up: split into user files (parse path) and
      // curated files (deserialize path). Curated entries arrive with
      // `serializedModelJson` set (the pre-parsed Langium AST) and
      // `content === ''` — parsing an empty string would produce a parse
      // error and the doc would be filtered out, leaving form preview
      // unable to find curated types. Hydrate them via the serializer
      // instead.
      const curatedDocuments = cachedCuratedDocuments;
      if (indexedCuratedDocuments !== curatedDocuments) {
        // Hydration restores references inside curated snapshots. Raw user source
        // additionally needs their exports in Langium's index, without rebuilding
        // the already-linked corpus. Cache this work by hydrated batch identity.
        const exportedSymbols = await Promise.all(
          curatedDocuments.map((document) => RuneDsl.references.ScopeComputation.collectExportedSymbols(document))
        );
        // A workspace/artifact switch can arrive while symbol collection yields.
        // Publish only the current batch, never exports from a cancelled snapshot.
        if (cachedCuratedDocuments !== curatedDocuments) return { all: [], valid: [] };
        curatedDocuments.forEach((document, index) => {
          (RuneDsl.shared.workspace.IndexManager as RuneDslIndexManager).registerExports(
            document.uri,
            exportedSymbols[index]!
          );
        });
        indexedCuratedDocuments = curatedDocuments;
      }
      const userEntries = currentPreviewFiles.filter((e) => !e.serializedModelJson && isPreviewUserEntryParseable(e));

      const userDocuments: LangiumDocument[] = userEntries.map(({ uri, content }) =>
        factory.fromString(content, URI.parse(uri))
      );
      if (userDocuments.length > 0) {
        await builder.build(userDocuments, { validation: false, eagerLinking: false });
      }

      // Curated docs come pre-linked from the curated-mirror build (CI runs
      // Langium with a higher heap budget than the browser can spare).
      // Build here would try to re-link and fail because the live Langium
      // service hasn't indexed cross-references.
      //
      // Codex review on PR #169: use `factory.fromModel` + add to the
      // service's document store. The earlier synthetic doc literal
      // (`{ uri, parseResult: { value, [], [] } }`) skipped Langium's
      // LangiumDocument ownership, which `RuneDslLinker.loadAstNode`
      // relies on to resolve cross-references through `.ref`. For curated
      // models with typed fields, refs would silently fail to resolve and
      // the preview / codegen output would be missing typed children.
      //
      // The batch relink itself already ran once in `hydrateCuratedDocuments`
      // (called from the `preview:setFiles` handler) — this just reads the
      // cached result rather than re-registering/re-linking on every build.
      // Keep invalid documents in the shared cache so selected exports can
      // resolve their complete dependency closure before rejecting errors.
      // Other preview consumers receive the filtered view below.
      const validUserDocuments = userDocuments.filter((d) => !hasDocumentErrors(d));
      if (validUserDocuments.length < userDocuments.length) {
        console.warn(
          `[codegen-worker] ${
            userDocuments.length - validUserDocuments.length
          } user file(s) had parse errors and were excluded from preview.`
        );
      }
      return { all: [...userDocuments, ...curatedDocuments], valid: [...validUserDocuments, ...curatedDocuments] };
    }
  );
  return { version: entry.version, value: includeInvalid ? entry.value.all : entry.value.valid };
}

function generatedPreviewSchemaForTarget(
  schemas: Awaited<ReturnType<typeof generatePreviewSchemas>>,
  targetId: string
) {
  const [, targetKind] = targetId.split('#', 2);
  return targetKind === 'RosettaFunction'
    ? schemas.find((candidate) => candidate.kind === 'function')
    : schemas.find((candidate) => candidate.kind !== 'function');
}

async function runPreview(targetId: string, requestId: string): Promise<void> {
  const scope = operationScope();

  if (!projectGeneration && currentPreviewFiles.length === 0) {
    scope.postMessage({
      type: 'preview:stale',
      targetId,
      requestId,
      reason: 'no-files',
      message: 'No files are loaded for form preview.'
    });
    return;
  }

  try {
    const [generatorTargetId] = targetId.split('#', 2);
    const { version: documentsVersion, value: documents } = await previewStages.buildDocuments();
    if (documents.length === 0) {
      scope.postMessage({
        type: 'preview:stale',
        targetId,
        requestId,
        reason: 'parse-error',
        message: 'No valid files to generate a form preview from.'
      });
      return;
    }

    // Tagged with `documentsVersion` (the version `documents` was ACTUALLY
    // built from), not the live `previewFilesVersion` — a `buildDocuments()`
    // call suspended across a `preview:setFiles` returns documents that
    // predate the live counter; caching under the live counter would mark
    // that stale-derived schema as valid for the new version.
    const { value: schemas } = getOrCompute(previewSchemaCache, targetId, documentsVersion, () =>
      generatePreviewSchemas(documents, { targetId: generatorTargetId })
    );
    const schema = generatedPreviewSchemaForTarget(schemas, targetId);
    if (!schema) {
      scope.postMessage({
        type: 'preview:stale',
        targetId,
        requestId,
        reason: 'unsupported-target',
        message: `No form preview schema is available for ${targetId}.`
      });
      return;
    }

    scope.postMessage({ type: 'preview:result', targetId, requestId, schema: { ...schema, targetId } });
  } catch (err) {
    console.error('[codegen-worker] Preview generation error:', err);
    scope.postMessage({
      type: 'preview:stale',
      targetId,
      requestId,
      reason: 'generation-error',
      message: err instanceof Error ? err.message : 'Preview generation failed.'
    });
  }
}

/**
 * Instance-editing's schema fetches (finding #6/#7 fix) — deliberately
 * separate from `runPreview`: it does NOT read or write module-level
 * `lastPreviewTargetId`/`lastPreviewRequestId`, so it can never corrupt
 * which target `preview:setFiles` re-runs for the Preview perspective.
 * Reuses `buildDocuments`/`generatePreviewSchemas`, the same structural
 * source `runPreview` and `validateInstance` already use.
 */
async function runInstanceSchema(typeFqn: string, requestId: string): Promise<void> {
  const scope = operationScope();

  if (!projectGeneration && currentPreviewFiles.length === 0) {
    scope.postMessage({
      type: 'instance:generateSchemaStale',
      requestId,
      reason: 'no-files',
      message: 'No files are loaded for form preview.'
    });
    return;
  }

  try {
    const [targetId] = typeFqn.split('#', 2);
    const { version: documentsVersion, value: documents } = await previewStages.buildDocuments();
    if (documents.length === 0) {
      scope.postMessage({
        type: 'instance:generateSchemaStale',
        requestId,
        reason: 'parse-error',
        message: 'No valid files to generate a form preview from.'
      });
      return;
    }

    // See runPreview's identical comment — tagged with documentsVersion,
    // not the live previewFilesVersion.
    const { value: schemas } = getOrCompute(previewSchemaCache, typeFqn, documentsVersion, () =>
      generatePreviewSchemas(documents, { targetId })
    );
    const schema = generatedPreviewSchemaForTarget(schemas, typeFqn);
    if (!schema) {
      scope.postMessage({
        type: 'instance:generateSchemaStale',
        requestId,
        reason: 'unsupported-target',
        message: `No form preview schema is available for ${typeFqn}.`
      });
      return;
    }

    scope.postMessage({ type: 'instance:generateSchemaResult', requestId, schema: { ...schema, targetId: typeFqn } });
  } catch (err) {
    console.error('[codegen-worker] Instance schema generation error:', err);
    scope.postMessage({
      type: 'instance:generateSchemaStale',
      requestId,
      reason: 'generation-error',
      message: err instanceof Error ? err.message : 'Instance schema generation failed.'
    });
  }
}

// ---------------------------------------------------------------------------
// TypeScript → JavaScript transpilation for @rune-langium/codegen output
// ---------------------------------------------------------------------------

/** Parse and erase TypeScript syntax without using a host module resolver. */
function transpileGeneratedTypeScript(tsCode: string, moduleName: string): string {
  try {
    return transform(tsCode, {
      transforms: ['typescript', 'imports'],
      filePath: moduleName,
      disableESTransforms: true
    }).code;
  } catch (error) {
    throw new Error(
      `Unable to transpile generated module '${moduleName}': ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Hardened `new Function(...)` execution — shared sandbox wrapper
// ---------------------------------------------------------------------------

/**
 * Runs `jsSource` (with the runtime-helper bundle prepended) inside
 * `new Function(...)`, evaluates `returnExpr` as the final statement, and
 * returns its result. `argValue` is bound to the parameter named `argName`
 * inside that source.
 *
 * The `new Function(...)` constructor evaluates the given source in a
 * dedicated module-level scope, but it is NOT a sandbox:
 * - Identifier shadowing (`fetch`, `WebSocket`, `XMLHttpRequest`, `importScripts`
 *   passed as params) prevents direct calls to those names from the evaluated
 *   code, but `globalThis.fetch` etc. remain reachable.
 * - Other Worker globals (`postMessage`, `self`, `addEventListener`) are not
 *   shadowed.
 * - This worker runs in a dedicated Web Worker context, so the blast radius is
 *   limited to that worker, but the evaluated code can still exfil via globalThis.
 * - For stronger isolation, rely on the Cloudflare Workers / browser CSP to
 *   block network egress at the runtime level.
 *
 * Shared by `executeFunction` (generated Rune func bodies) and the
 * `instance:validate` handler (condition predicates) — the single hardened-
 * execution path in this worker; do not add a second one.
 *
 * react-doctor false positive: this is `new Function`, not `eval`, but the rule
 * flags both. Disable comment preserved.
 */
function runInWorkerSandbox(
  jsSource: string,
  argName: string,
  argValue: unknown,
  returnExpr: string,
  includeRuntimeHelpers = true
): unknown {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  // react-doctor-disable-next-line react-doctor/no-eval
  const wrapper = new Function(
    argName,
    'Temporal',
    'fetch',
    'WebSocket',
    'XMLHttpRequest',
    'importScripts',
    `${includeRuntimeHelpers ? `${RUNTIME_HELPER_JS_SOURCE}\n\n` : ''}${jsSource}\nreturn ${returnExpr};`
  );
  return wrapper(argValue, Temporal, undefined, undefined, undefined, undefined);
}

interface GeneratedModuleRecord {
  exports: Record<string, unknown>;
}

interface GeneratedModuleRuntime {
  module: GeneratedModuleRecord;
  require: (specifier: string) => Record<string, unknown>;
}

function normalizeGeneratedModulePath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/');
}

function resolveGeneratedModulePath(importer: string, specifier: string): string {
  if (!specifier.startsWith('.')) {
    throw new Error(`Generated preview module '${importer}' requested unsupported dependency '${specifier}'.`);
  }
  const lastSlash = importer.lastIndexOf('/');
  const directory = lastSlash === -1 ? '' : importer.slice(0, lastSlash);
  const joined = normalizeGeneratedModulePath(`${directory}/${specifier}`);
  return joined.replace(/\.js$/, '.ts');
}

/** Evaluate generated modules with a require closure over generated outputs. */
function createGeneratedModuleLoader(outputs: readonly GeneratorOutput[]): {
  load: (relativePath: string) => Record<string, unknown>;
} {
  const sources = new Map<string, string>();
  for (const output of outputs) {
    const path = normalizeGeneratedModulePath(output.relativePath);
    // Content is the complete emitted module. Snippets cannot resolve imports
    // or sibling calls and are therefore not a valid execution source.
    const source = output.content;
    if (source) sources.set(path, source);
  }
  const modules = new Map<string, GeneratedModuleRecord>();

  const load = (relativePath: string): Record<string, unknown> => {
    const path = normalizeGeneratedModulePath(relativePath).replace(/\.js$/, '.ts');
    const existing = modules.get(path);
    if (existing) return existing.exports;
    const source = sources.get(path);
    if (source === undefined) throw new Error(`Generated preview module '${path}' was not emitted.`);

    const module: GeneratedModuleRecord = { exports: {} };
    // Cache before evaluation so generated recursive functions/modules can
    // observe the same CommonJS export object during a cycle.
    modules.set(path, module);
    const runtime: GeneratedModuleRuntime = {
      module,
      require: (specifier) =>
        specifier === '@js-temporal/polyfill' ? { Temporal } : load(resolveGeneratedModulePath(path, specifier))
    };
    const javascript = transpileGeneratedTypeScript(source, path);
    runInWorkerSandbox(
      `const exports = $rune$module.module.exports;\nconst require = $rune$module.require;\n${javascript}`,
      '$rune$module',
      runtime,
      '$rune$module.module.exports',
      false
    );
    return module.exports;
  };

  return { load };
}

// ---------------------------------------------------------------------------
// Function execution
// ---------------------------------------------------------------------------

async function runProjection(request: ProjectionRequest): Promise<void> {
  const scope = operationScope();
  try {
    const current = () =>
      request.filesRevision >= previewVersionStartRevision &&
      request.filesRevision <= previewFilesRevision &&
      currentPreviewFiles.some((file) => file.uri === request.subject.uri && file.content === request.source);
    if (!current()) throw new Error('The source changed. Refresh the generated view.');
    const { version, value: documents } = await previewStages.buildDocuments();
    let subject = { ...request.subject, uri: URI.parse(request.subject.uri).toString() };
    if (
      request.kind === 'function' ||
      currentPreviewFiles.find((file) => file.uri === request.subject.uri)?.serializedModelJson
    ) {
      const owner = getExpressionOwners(documents.map((doc) => doc.parseResult.value as RosettaModel)).find((node) => {
        const doc = AstUtils.getDocument(node);
        const namespace = namespaceFromModelName((doc.parseResult.value as RosettaModel).name) ?? 'unknown';
        return (
          (request.kind !== 'function' || isRosettaFunction(node)) &&
          doc.uri.toString() === subject.uri &&
          makeNodeId(namespace, node.name, node.$type) === subject.nodeId
        );
      });
      if (!owner) throw new Error('The expression owner is unavailable.');
      // Published model coordinates may predate the original-source artifact.
      // Resolve the display boundary from the actual bytes, keeping the linked
      // immutable model for emission and its internal provenance lookup.
      const sourceModel = factory.fromString(request.source, URI.parse(request.subject.uri)).parseResult;
      if (sourceModel.parserErrors.length || sourceModel.lexerErrors.length)
        throw new Error('The original source could not be parsed.');
      const sourceOwner = getExpressionOwners([sourceModel.value as RosettaModel]).find(
        (node) => node.$type === owner.$type && node.name === owner.name
      );
      if (!sourceOwner) throw new Error('The expression owner is unavailable.');
      if (request.kind === 'function' && isRosettaFunction(sourceOwner)) {
        const body = getFunctionImplementationRegion(sourceOwner, request.source);
        if (body.from !== subject.region.from || body.to !== subject.region.to)
          throw new Error('The function source region changed. Refresh the generated view.');
        subject = { ...subject, region: getNodeSourceRegion(owner) };
      } else {
        const sourceRegion = getExpressionRegions(sourceOwner).find(
          (entry) => entry.region.from === subject.region.from && entry.region.to === subject.region.to
        );
        const linkedRegion =
          sourceRegion &&
          getExpressionRegions(owner).find(
            (entry) => entry.kind === sourceRegion.kind && entry.index === sourceRegion.index
          );
        if (!linkedRegion) throw new Error('The expression source region changed. Refresh the generated view.');
        subject = { ...subject, region: linkedRegion.region };
      }
    }
    const fqn = qualifiedNameFromNodeId(subject.nodeId);
    const separator = fqn.lastIndexOf('.');
    const selectedDocuments = resolveExportSelection(documents, {
      declarations: [
        { namespace: fqn.slice(0, separator), name: fqn.slice(separator + 1), kind: subject.nodeId.split('#')[1]! }
      ],
      namespaces: []
    }).documents;
    const cacheKey = JSON.stringify(['projection', request.language, subject.nodeId]);
    if (request.language === 'python') {
      const { value: module } = await getOrComputeAsync(
        previewPythonCache,
        cacheKey,
        () => version,
        () => Promise.resolve(generatePythonModule(selectedDocuments))
      );
      if (version !== previewFilesVersion || !current())
        throw new Error('The source changed. Refresh the generated view.');
      const projection = await formatGeneratedProjection(
        { ...selectPythonProjection(module, subject, request.kind, 'body'), subject: request.subject },
        request.kind
      );
      if (version !== previewFilesVersion || !current())
        throw new Error('The source changed. Refresh the generated view.');
      scope.postMessage({ type: 'projection:result', requestId: request.requestId, projection });
      return;
    }
    const { value: outputs } = await getOrComputeAsync(
      previewGenerateCache,
      cacheKey,
      () => version,
      () => generate(selectedDocuments, { target: 'typescript' })
    );
    if (version !== previewFilesVersion || !current())
      throw new Error('The source changed. Refresh the generated view.');
    const projection = await formatGeneratedProjection(
      {
        ...selectTypeScriptProjection(outputs, subject, request.kind, 'body'),
        subject: request.subject
      },
      request.kind
    );
    if (version !== previewFilesVersion || !current())
      throw new Error('The source changed. Refresh the generated view.');
    scope.postMessage({ type: 'projection:result', requestId: request.requestId, projection });
  } catch (error) {
    scope.postMessage({
      type: 'projection:error',
      requestId: request.requestId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function serializePreviewOutput(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (
    value instanceof Temporal.PlainDate ||
    value instanceof Temporal.PlainTime ||
    value instanceof Temporal.PlainDateTime ||
    value instanceof Temporal.ZonedDateTime
  ) {
    return value.toJSON();
  }
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const result = Array.isArray(value) ? [] : {};
  if (Array.isArray(result) && Array.isArray(value)) result.length = value.length;
  seen.set(value, result);
  for (const [key, entry] of Object.entries(value)) {
    Object.defineProperty(result, key, {
      value: serializePreviewOutput(entry, seen),
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  return result;
}

async function executeFunction(
  funcName: string,
  inputs: Record<string, unknown>,
  requestId: string,
  checksOnly = false
): Promise<void> {
  const scope = operationScope();
  let functionFqn = qualifiedNameFromNodeId(funcName);

  try {
    const { version: documentsVersion, value: documents } = await previewStages.buildDocuments();
    if (projectGeneration) functionFqn = resolveEffectiveProjectTargetId(documents, functionFqn, 'RosettaFunction');
    // Tagged with documentsVersion (fixed — `documents` is an immutable local
    // array once obtained, so no further staleness can be introduced during
    // this call), not the live previewFilesVersion — see runPreview's
    // identical comment for why re-sampling the live counter here would be
    // wrong.
    const results =
      documents.length > 0
        ? (
            await getOrComputeAsync(
              previewGenerateCache,
              'generate:typescript:input-checks',
              () => documentsVersion,
              () => generate(documents, { target: 'typescript', typescript: { inputChecks: true } })
            )
          ).value
        : [];

    // Matches both the bare function name and the namespace-qualified form
    // (`${ns}.${func.name}`, derived the same way runCodegen's own cache
    // population always did). The real UI caller (FormPreviewPanel.tsx) always
    // passes the qualified `schema.targetId`, not the bare `schema.title` —
    // two namespaces can share a bare func name, and only the qualified form
    // disambiguates which one to run; the bare-name branch here exists only
    // for callers (tests, `instance:execute`-style future callers) that don't
    // have a namespace-qualified name to give.
    let selectedModulePath: string | undefined;
    let selectedTargetId = functionFqn;
    let selectedExportName: string | undefined;
    let inputCheckExportName: string | undefined;
    let parameterNames: readonly string[] = [];
    for (const result of results) {
      const ns = result.relativePath.replace(/\//g, '.').replace(/\.ts$/, '');
      const func = result.funcs.find((f) => f.name === functionFqn || `${ns}.${f.name}` === functionFqn);
      if (func) {
        selectedExportName = func.exportName ?? func.name;
        inputCheckExportName = func.inputCheckExportName;
        parameterNames = func.parameterNames;
        selectedModulePath = result.relativePath;
        selectedTargetId = `${ns}.${func.name}`;
        break;
      }
    }

    if (selectedModulePath === undefined) throw new Error(`Function '${functionFqn}' not found in generated code.`);

    const { value: compiled } = getOrCompute(
      standaloneValidatorCache,
      `function-inputs:${selectedTargetId}`,
      documentsVersion,
      () => compileStandaloneValidator(documents, selectedTargetId, true)
    );
    if (!compiled.validator) {
      throw new Error(`Input validation unavailable: ${compiled.diagnostics[0]?.message ?? 'unknown error'}`);
    }
    const adaptedInputs = runInWorkerSandbox(
      '',
      '$rune$inputs',
      { inputs, documents, targetId: selectedTargetId, normalizePreviewInputs },
      '$rune$inputs.normalizePreviewInputs($rune$inputs.documents, $rune$inputs.targetId, $rune$inputs.inputs, { field: runeToField, reference: runeToReference })'
    );
    const validation = compiled.validator.safeParse(adaptedInputs);
    if (!validation.success) {
      if (checksOnly) {
        scope.postMessage({
          type: 'instance:validateResult',
          requestId,
          diagnostics: translateValidationIssues(validation.error.issues, [])
        });
        return;
      }
      throw new Error(
        validation.error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`).join('; ')
      );
    }

    // Load the complete generated module so function calls, metadata helpers,
    // and imports from sibling generated modules share one module graph.
    // Execution still goes through runInWorkerSandbox — see its threat-model
    // comment.
    const modules = createGeneratedModuleLoader(results);
    const exports = modules.load(selectedModulePath);
    const bareName = checksOnly ? inputCheckExportName : (selectedExportName ?? funcName);
    if (!bareName) throw new Error('Function input checks are unavailable.');
    const functionValue = exports[bareName];
    if (typeof functionValue !== 'function') {
      throw new Error(`Generated module '${selectedModulePath}' does not export function '${bareName}'.`);
    }
    const validatedInputs = validation.data;
    if (typeof validatedInputs !== 'object' || validatedInputs === null)
      throw new Error('The function input schema did not return a field record.');
    const output = runInWorkerSandbox(
      '',
      '$rune$function',
      { functionValue, args: parameterNames.map((name) => Reflect.get(validatedInputs, name)) },
      '$rune$function.functionValue(...$rune$function.args)'
    );

    if (checksOnly) {
      scope.postMessage({ type: 'instance:validateResult', requestId, diagnostics: [] });
      return;
    }
    scope.postMessage({
      type: 'preview:execute-result',
      requestId,
      funcName,
      output: serializePreviewOutput(output)
    });
  } catch (e) {
    if (checksOnly) {
      const message = e instanceof Error ? e.message : String(e);
      scope.postMessage({
        type: 'instance:validateResult',
        requestId,
        ...(message.startsWith('Diagnostic:') ? {} : { unavailable: message }),
        diagnostics: [{ path: '', message }]
      });
      return;
    }
    scope.postMessage({
      type: 'preview:execute-error',
      requestId,
      funcName,
      error: e instanceof Error ? e.message : String(e)
    });
  }
}

// ---------------------------------------------------------------------------
// Instance validation
// ---------------------------------------------------------------------------

function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  return path
    .filter((segment): segment is string | number => typeof segment === 'string' || typeof segment === 'number')
    .map((segment) => (typeof segment === 'number' ? `[${segment}]` : segment))
    .join('.')
    .replace(/\.\[/g, '[');
}

/**
 * Attribute condition issues only when the message matches the active condition
 * selected by the issue path, or the sole active condition for a root-path issue.
 * Preserve full structural paths so the form can attach errors to their controls.
 */
function translateValidationIssues(
  issues: z.ZodError['issues'],
  activeConditionNames: string[]
): ValidationDiagnostic[] {
  const conditionNameSet = new Set(activeConditionNames);
  const soleConditionName = activeConditionNames.length === 1 ? activeConditionNames[0] : undefined;
  return issues.map((issue) => {
    const first = issue.path[0];
    const conditionName =
      issue.path.length === 0
        ? soleConditionName
        : typeof first === 'string' && conditionNameSet.has(first)
          ? first
          : undefined;
    if (conditionName && issue.message.startsWith(conditionName)) {
      return { path: conditionName, message: issue.message, conditionName };
    }
    return { path: formatIssuePath(issue.path), message: issue.message };
  });
}

async function validateInstance(typeFqn: string, data: Record<string, unknown>, requestId: string): Promise<void> {
  const scope = operationScope();

  try {
    const { version: documentsVersion, value: documents } = await previewStages.buildDocuments();
    if (projectGeneration)
      typeFqn = resolveEffectiveProjectTargetId(documents, qualifiedNameFromNodeId(typeFqn), 'Data');
    const { value: compiled } = getOrCompute(standaloneValidatorCache, typeFqn, documentsVersion, () =>
      compileStandaloneValidator(documents, typeFqn)
    );

    if (!compiled.validator) {
      const firstError = compiled.diagnostics.find((d) => d.severity === 'error');
      scope.postMessage({
        type: 'instance:validateResult',
        requestId,
        diagnostics: [
          { path: '', message: `Structural validation unavailable: ${firstError?.message ?? 'unknown error'}` }
        ]
      });
      return;
    }

    // Condition NAMES are still needed to attribute a Zod issue back to a
    // named Rune condition (translateValidationIssues) — the predicates
    // themselves are no longer executed separately; the real schema already
    // embeds every active condition as a .refine()/.superRefine().
    const dataNode = findDataNode(typeFqn, documents);
    const activeConditionNames = dataNode ? getActiveConditionPredicates(dataNode).map(({ name }) => name) : [];

    const result = compiled.validator.safeParse(data);
    const diagnostics: ValidationDiagnostic[] = result.success
      ? []
      : translateValidationIssues(result.error.issues, activeConditionNames);

    scope.postMessage({ type: 'instance:validateResult', requestId, diagnostics });
  } catch (err) {
    console.error('[codegen-worker] Instance validation error:', err);
    scope.postMessage({
      type: 'instance:validateResult',
      requestId,
      diagnostics: [{ path: '', message: err instanceof Error ? err.message : 'Instance validation failed.' }]
    });
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

// Gate the listener behind `isWorkerGlobalScope()` (shared with parser-worker
// via ./runtime-guards.ts). Currently no main-bundle code statically imports
// this module, but the moment something does — e.g. a re-export of a type
// definition — the unguarded `self.addEventListener` would re-create the
// same `TypeError: Cannot read properties of undefined (reading 'type')`
// crash that PR #214 fixed for parser-worker.
if (isWorkerGlobalScope()) {
  (self as unknown as DedicatedWorkerGlobalScope).addEventListener(
    'message',
    (e: MessageEvent<WorkerInboundMessage>) => {
      const msg = e.data;
      if (
        msg.type !== 'preview:setFiles' &&
        msg.type !== 'codegen:setFiles' &&
        (projectGeneration
          ? !projectGeneration.receipt || !projectReceiptMatches(projectGeneration.receipt, msg.projectReceipt)
          : Boolean(msg.projectReceipt))
      ) {
        rejectProjectOperation(
          msg,
          'The requested project revision has not been applied. Refresh the project and retry.'
        );
        return;
      }

      if (msg.type === 'codegen:setFiles') {
        currentCodegenFiles = msg.files;
        codegenFilesVersion++;
      } else if (msg.type === 'codegen:generate') {
        if (msg.target !== undefined) {
          lastTarget = msg.target;
        }
        if (msg.requestId) {
          lastCodegenRequestId = msg.requestId;
        }
        runCodegen(lastTarget, lastCodegenRequestId, msg.selection, msg.regenerate).catch(console.error);
      } else if (msg.type === 'preview:setFiles') {
        const changed =
          msg.files.length !== currentPreviewFiles.length ||
          msg.files.some((file, index) => {
            const previous = currentPreviewFiles[index];
            return (
              !previous ||
              previous.uri !== file.uri ||
              previous.content !== file.content ||
              previous.serializedModelJson !== file.serializedModelJson
            );
          });
        const previousProject = projectGeneration;
        const reuse =
          msg.project &&
          previousProject?.receipt &&
          projectReceiptMatches(previousProject.receipt, msg.project.receipt);
        const ready = reuse
          ? previousProject.ready
          : msg.project
            ? applyProject(msg.project)
            : msg.projectUnavailable
              ? Promise.reject<EffectiveProject>(new Error(msg.projectUnavailable))
              : undefined;
        const generation = reuse
          ? previousProject
          : ready
            ? { ready, ...(msg.project ? { receipt: { ...msg.project.receipt } } : {}) }
            : undefined;
        projectGeneration = generation;
        if (!generation) previewStages.hydrateDocuments(msg.files);
        currentPreviewFiles = msg.files;
        if (changed || generation !== previousProject) {
          previewFilesVersion++;
          previewVersionStartRevision = msg.filesRevision;
        }
        // The provider owns this monotonic sequence. Echo the exact revision
        // that installed so a readiness waiter cannot resolve from another
        // dispatch's receipt.
        previewFilesRevision = msg.filesRevision;
        if (msg.requestId) lastPreviewRequestId = msg.requestId;
        const requestId = msg.requestId ?? lastPreviewRequestId;
        const acknowledge = (projectError?: string) => {
          if (generation !== projectGeneration) {
            if (msg.requestId)
              (self as unknown as DedicatedWorkerGlobalScope).postMessage({
                type: 'preview:files-ready',
                requestId: msg.requestId,
                filesRevision: msg.filesRevision,
                projectError: 'The project changed before this revision could be applied.'
              });
            return;
          }
          if (msg.requestId)
            (self as unknown as DedicatedWorkerGlobalScope).postMessage({
              type: 'preview:files-ready',
              requestId: msg.requestId,
              filesRevision: msg.filesRevision,
              ...(projectError ? { projectError } : generation?.receipt ? { projectReceipt: generation.receipt } : {})
            });
          if (!projectError && lastPreviewTargetId && requestId)
            previewStages.generateSchema(lastPreviewTargetId, requestId).catch(console.error);
        };
        if (generation)
          void generation.ready.then(
            () => acknowledge(),
            (error) => acknowledge(error instanceof Error ? error.message : String(error))
          );
        else acknowledge();
      } else if (msg.type === 'preview:generate') {
        lastPreviewTargetId = msg.targetId;
        lastPreviewRequestId = msg.requestId;
        previewStages.generateSchema(msg.targetId, msg.requestId).catch(console.error);
      } else if (msg.type === 'preview:execute') {
        const { funcName, inputs, requestId } = msg;
        previewStages.executeFunction(funcName, inputs, requestId).catch(console.error);
      } else if (msg.type === 'projection:generate') {
        previewStages.generateProjection(msg).catch(console.error);
      } else if (msg.type === 'instance:validate') {
        const { typeFqn, data, requestId } = msg;
        (msg.functionInputs
          ? executeFunction(typeFqn, data, requestId, true)
          : validateInstance(typeFqn, data, requestId)
        ).catch(console.error);
      } else if (msg.type === 'instance:generateSchema') {
        const { typeFqn, requestId } = msg;
        runInstanceSchema(typeFqn, requestId).catch(console.error);
      }
    }
  );
}
