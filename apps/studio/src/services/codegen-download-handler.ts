// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

/** Shared download pipeline for Pages requests and dedicated browser workers. */

import JSZip from 'jszip';
import {
  IMPLEMENTED_TARGETS,
  TARGET_DESCRIPTORS,
  type ExportSelection,
  type GeneratorDiagnostic,
  type GeneratorOptions,
  type GeneratorOutput,
  type Target
} from '@rune-langium/codegen/export';
import { loadCuratedWorkspace, curatedWorkspaceErrorResponse } from './curated-workspace.js';
import { withInstrumentation, Capture } from './instrumentation/core.js';
import type { ExportArtifactManifest } from './export-artifact.js';
import type { ProjectRuntimeInput } from './project-runtime-input.js';
import { BuildTargetSchema, type BuildTarget } from '@rune-langium/project-config';

interface CodegenRequestBody {
  projectTarget?: BuildTarget;
  files: Array<{ path: string; content: string }>;
  target: Target;
  /**
   * Per-target option blocks. Mirrors `GeneratorOptions` from
   * @rune-langium/codegen — `options.<target>.layout` selects per-
   * namespace vs whole-model emission per spec §3.1. When the layout
   * is omitted, this function injects the opinionated Pages-Function
   * default for the target (019 spec §10.1) — barrel for Zod/TS,
   * single-file for JSON Schema.
   */
  options?: Omit<GeneratorOptions, 'target' | 'namespaces' | 'selection' | 'projectBindings' | 'projectResources'>;
  /**
   * Optional curated-bundle hydration list. When present, the function
   * fetches each bundle's pre-parsed serialized AST via the
   * `CURATED_MIRROR` service binding (same pattern as /api/parse) and
   * passes the deserialized documents alongside user files to
   * `generate()`. Enables curated-only workspaces (CDM, FpML, rune-dsl)
   * to be served by Download.
   *
   * 019 Task #88.
   */
  curatedBundles?: Array<{ id: string; version: string }>;
  /**
   * Pre-loaded serialized curated docs (path A). Used only when
   * `curatedBundles` is absent — see `loadAllDocuments`. When present
   * without `curatedBundles`, the server deserializes these directly and
   * performs NO manifest/namespace fetch. NOT trusted as complete when
   * `curatedBundles` is also present: the studio's on-demand hydration can
   * leave this set missing namespaces the dependency-closed `namespaces`
   * selection actually needs, so `curatedBundles`'s independently-fetched
   * closure takes priority whenever both are sent (2026-07 codegen-400
   * investigation).
   */
  curatedDocs?: Array<{ uri: string; serializedModel: string }>;
  /**
   * Optional namespace allowlist (019 spec §5.1/§5.3). The Download config
   * modal sends the dependency-closed subset (selected ∪ transitively
   * pulled). Passed straight through to `generate()` as `options.namespaces`.
   * Absent for legacy/direct callers → all namespaces emitted.
   */
  namespaces?: string[];
  /** Optional declaration roots emitted in addition to selected namespaces. */
  selection?: ExportSelection;
  /** Return a ZIP artifact envelope with an inspectable manifest. */
  artifactEnvelope?: 1;
  /** Named project builds use the same strict library defaults as the native CLI. */
  projectBuild?: boolean;
}

/**
 * Per-target opinionated layout default applied by `/api/codegen` when
 * the request omits `options.<target>.layout`. 019 spec §10.1: the
 * library default stays `'per-namespace'` so CLI users see no change;
 * the Pages Function flips to the bundled shape so the studio's
 * Download button delivers a drop-in artifact.
 */
const PAGES_FUNCTION_DEFAULT_LAYOUT: Partial<Record<Target, string>> = {
  zod: 'barrel',
  typescript: 'barrel',
  'json-schema': 'single-file',
  sql: 'single-file',
  markdown: 'barrel'
};

// 019 Task #88 — curated bundles ride through the `CURATED_MIRROR`
// service binding (same wiring as /api/parse, declared in wrangler.toml).
// Local dev and tests can omit the binding; the function falls back to
// global fetch against the public curated-mirror URL.
export interface CodegenDownloadEnv {
  CURATED_MIRROR?: {
    fetch: (input: string | Request, init?: RequestInit) => Promise<Response>;
  };
}

function jsonError(status: number, error: string, diagnostics: readonly GeneratorDiagnostic[] = []): Response {
  return new Response(JSON.stringify({ ok: false, error, diagnostics }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Module-scope cache of hydrated curated documents, reused across requests
 * that land on the SAME warm Worker isolate (issue #432). `loadAllDocuments`'s
 * Path C (curatedBundles present) always fetches the manifest + every
 * namespace artifact server-to-server and deserializes them — deliberately,
 * since trusting client-supplied `curatedDocs` as a complete substitute
 * caused a real incident (silently-incomplete codegen output; see
 * `loadAllDocuments`'s own doc comment). But re-running that exact same
 * fetch+deserialize is pure waste when the SAME curated selection is
 * requested again in short order — most commonly the studio's Download
 * modal switching target format (TypeScript → Zod) for the identical
 * namespace closure. Keyed on exactly what determines the fetched
 * document set (`curatedBundles`, `namespaces`) — never on `target` or
 * `options`, which only affect what `generate()` does with the SAME
 * documents afterward — so a hit is guaranteed to be the identical
 * document set Path C would have produced from scratch.
 *
 * Scoped to the curated-only case (`body.files.length === 0`): a request
 * with user-authored files isn't cached at all, since their content isn't
 * part of the cache key — caching would risk serving one request's user
 * files' worth of `docs` to a later request with DIFFERENT user file
 * content under the same curated key.
 *
 * Capped at ONE retained entry (Codex review round 1 on PR #445) — a
 * hydrated curated closure (CDM in particular) can itself run tens of MB;
 * `loadAllDocuments`'s own doc comment notes CDM hydration can approach
 * the Worker's 128 MiB limit on its own. Bounding only by entry COUNT
 * (the original design capped at 4) doesn't bound memory: an isolate
 * cycling through a few large, DISTINCT curated selections within the TTL
 * window could retain several such closures simultaneously and reproduce
 * the exact OOM this fix exists to avoid. A single entry still serves the
 * primary use case (switching target format for the SAME closure) fully,
 * while capping retained memory to roughly one closure's worth — the same
 * order of magnitude a single in-flight request already requires.
 *
 * Stores the hydration PROMISE, not just the resolved result (Codex review
 * round 4 on PR #445) — two concurrent requests for the SAME key could
 * otherwise both observe a miss and both independently fetch+hydrate the
 * same (potentially CDM-sized) closure at once, doubling peak memory for
 * no benefit. Registering the promise synchronously, before awaiting it,
 * means a second concurrent request for the same key finds it already
 * registered and just awaits the SAME in-flight work instead of starting
 * its own.
 *
 * `cachedAt` is the REGISTRATION time at first, but `pending` exempts the
 * entry from TTL eviction until hydration actually settles (Codex review
 * round 6 on PR #445) — a `cachedAt` anchored to registration alone would
 * make a still-hydrating entry for a large/slow closure eligible for TTL
 * pruning before it even finishes, so a later request for the same key
 * could evict it mid-flight and start a REDUNDANT parallel hydration,
 * defeating the coalescing round 4 added. `cachedAt` is bumped to the
 * actual completion time on success, so the TTL window measures freshness
 * from when the entry became usable, not from when hydration started.
 *
 * `pending` only spans HYDRATION, though — it goes false the moment
 * `loadAllDocuments` settles, well before the consuming request is done
 * WALKING the resulting documents through `generate()` (which, for an
 * async emitter like Excel, can itself take real time and hold the whole
 * closure in memory). `activeConsumers` tracks that separately: one
 * pending-until-settled entry per request currently between "hydration
 * resolved" and "generate() + response finished" for THIS entry. Both
 * `pruneDocumentCache` and the eviction/wait logic in `onRequestPost`
 * treat `pending || activeConsumers.length > 0` as "busy" — without this,
 * a settled-but-still-being-walked entry looked idle to a concurrent
 * different-key miss, which would evict it and start a second (possibly
 * CDM-sized) hydration while THIS entry's documents were still alive and
 * in active use on another request's stack (Codex review round 9 on PR
 * #445).
 */
const DOCUMENT_CACHE_MAX_ENTRIES = 1;
const DOCUMENT_CACHE_TTL_MS = 5 * 60 * 1000;
const documentCache = new Map<
  string,
  {
    promise: ReturnType<typeof loadAllDocuments>;
    cachedAt: number;
    pending: boolean;
    activeConsumers: Array<Promise<void>>;
  }
>();

/**
 * `JSON.stringify` over structured arrays, NOT string concatenation (Codex
 * review round 1 on PR #445) — `namespaces` entries are arbitrary
 * request-supplied strings (only checked to be `string[]`, never
 * restricted in content), so joining with `,`/`@`/`|` lets differently-
 * shaped requests collide: `['cdm.a,cdm.b']` (one namespace whose name
 * contains a comma) and `['cdm.a', 'cdm.b']` (two namespaces) previously
 * produced the IDENTICAL key. A collision here isn't just a wasted cache
 * slot — it can cache one request's (possibly empty/wrong) documents
 * under a key a later, differently-shaped but colliding request would
 * then incorrectly hit.
 *
 * `curatedBundles` ORDER is preserved, NOT sorted (Codex review round 4 on
 * PR #445) — `loadAllDocuments`'s Path C loop processes `curatedBundles`
 * in request order, and downstream namespace-walking resolves a symbol
 * that collides across two bundles via last-one-wins `Map.set` semantics.
 * `[A, B]` and `[B, A]` can therefore produce genuinely different
 * documents when bundles share a colliding declaration — sorting here
 * would let a reversed-order request incorrectly reuse a cached result
 * built with the opposite precedence. `namespaces` order, by contrast, IS
 * safe to normalize: every consumer (`loadAllDocuments`'s `seeds` Set,
 * `runGenerate`'s allowlist Set) treats it as an unordered set.
 */
function documentCacheKey(
  curatedBundles: ReadonlyArray<{ id: string; version: string }>,
  requestedNamespaces: readonly string[]
): string {
  const bundles = curatedBundles.map((b) => [b.id, b.version] as const);
  const namespaces = [...requestedNamespaces].sort();
  return JSON.stringify([bundles, namespaces]);
}

/** Hydrating, or still being walked by an active `generate()` call — see the cache's own doc comment. */
function isDocumentCacheEntryBusy(entry: { pending: boolean; activeConsumers: Array<Promise<void>> }): boolean {
  return entry.pending || entry.activeConsumers.length > 0;
}

/**
 * Evicts expired SETTLED-and-idle entries, then the oldest-inserted
 * entries over the cap. A busy entry — still `pending`, or still being
 * walked by an active `generate()` call (round 9) — is exempt from TTL
 * eviction (Codex review round 6 on PR #445) — see the cache's own doc
 * comment.
 */
function pruneDocumentCache(now: number): void {
  for (const [key, entry] of documentCache) {
    if (!isDocumentCacheEntryBusy(entry) && now - entry.cachedAt >= DOCUMENT_CACHE_TTL_MS) {
      documentCache.delete(key);
    }
  }
  while (documentCache.size > DOCUMENT_CACHE_MAX_ENTRIES) {
    const oldestKey = documentCache.keys().next().value;
    if (oldestKey === undefined) break;
    documentCache.delete(oldestKey);
  }
}

export const __resetDocumentCacheForTests = withInstrumentation(
  function __resetDocumentCacheForTests(): void {
    documentCache.clear();
  },
  { op: '__resetDocumentCacheForTests' }
);

// Test-only accessors — cache keys/state never captured (no production
// telemetry value; keys may embed request-specific identifiers).
export const __documentCacheKeysForTests = withInstrumentation(
  function __documentCacheKeysForTests(): string[] {
    return Array.from(documentCache.keys());
  },
  { op: '__documentCacheKeysForTests' }
);

export const __documentCacheIsBusyForTests = withInstrumentation(
  function __documentCacheIsBusyForTests(): boolean {
    const [entry] = documentCache.values();
    return entry !== undefined && isDocumentCacheEntryBusy(entry);
  },
  {
    op: '__documentCacheIsBusyForTests',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' ? value : undefined)
  }
);

function isExportSelection(value: unknown): value is ExportSelection {
  if (!value || typeof value !== 'object') return false;
  const selection = value as { namespaces?: unknown; declarations?: unknown };
  return (
    Array.isArray(selection.namespaces) &&
    selection.namespaces.every((namespace) => typeof namespace === 'string') &&
    Array.isArray(selection.declarations) &&
    selection.declarations.every(
      (declaration) =>
        declaration &&
        typeof declaration === 'object' &&
        typeof (declaration as { namespace?: unknown }).namespace === 'string' &&
        typeof (declaration as { name?: unknown }).name === 'string' &&
        typeof (declaration as { kind?: unknown }).kind === 'string'
    )
  );
}

function isValidRequest(body: unknown): body is CodegenRequestBody {
  if (!body || typeof body !== 'object') return false;
  if ('project' in body) return false;
  const options = (body as { options?: unknown }).options;
  if (options && typeof options === 'object' && ('projectBindings' in options || 'projectResources' in options))
    return false;
  if ('projectTarget' in body && !BuildTargetSchema.safeParse(body.projectTarget).success) return false;
  const b = body as { files?: unknown; target?: unknown; curatedBundles?: unknown; curatedDocs?: unknown };
  if (
    !Array.isArray(b.files) ||
    !b.files.every(
      (f) =>
        f &&
        typeof f === 'object' &&
        typeof (f as { path?: unknown }).path === 'string' &&
        typeof (f as { content?: unknown }).content === 'string'
    ) ||
    typeof b.target !== 'string'
  ) {
    return false;
  }
  // Copilot review on PR #168 — when `curatedBundles` is supplied, it
  // must be an array of `{ id: string, version: string }`. A malformed
  // value used to produce an opaque 500 at the fetch site;
  // now it's a 400 with the validator's documented shape message.
  if (b.curatedBundles !== undefined) {
    if (
      !Array.isArray(b.curatedBundles) ||
      !b.curatedBundles.every(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          typeof (entry as { id?: unknown }).id === 'string' &&
          typeof (entry as { version?: unknown }).version === 'string'
      )
    ) {
      return false;
    }
  }
  // Path A — when `curatedDocs` is supplied, each entry must be
  // `{ uri: string, serializedModel: string }`. A non-array or
  // structurally invalid entry is rejected with a 400.
  if (b.curatedDocs !== undefined) {
    if (
      !Array.isArray(b.curatedDocs) ||
      !b.curatedDocs.every(
        (d) =>
          d &&
          typeof d === 'object' &&
          typeof (d as { uri?: unknown }).uri === 'string' &&
          typeof (d as { serializedModel?: unknown }).serializedModel === 'string'
      )
    ) {
      return false;
    }
  }
  // 019 §5.3 — `namespaces`, when present, must be an array of strings.
  const ns = (body as { namespaces?: unknown }).namespaces;
  if (ns !== undefined) {
    if (!Array.isArray(ns) || !ns.every((n) => typeof n === 'string')) {
      return false;
    }
  }
  const projectBuild = (body as { projectBuild?: unknown }).projectBuild;
  if (projectBuild !== undefined && typeof projectBuild !== 'boolean') return false;
  const selection = (body as { selection?: unknown }).selection;
  if (selection !== undefined && !isExportSelection(selection)) return false;
  if (selection !== undefined && ns !== undefined) return false;
  if (
    (body as { artifactEnvelope?: unknown }).artifactEnvelope !== undefined &&
    (body as { artifactEnvelope?: unknown }).artifactEnvelope !== 1
  ) {
    return false;
  }
  return true;
}

/** Namespace seeds for curated hydration; selection controls final emission. */
function requestedNamespaces(body: CodegenRequestBody): readonly string[] {
  if (!body.selection) return body.namespaces ?? [];
  return [...new Set([...body.selection.namespaces, ...body.selection.declarations.map((item) => item.namespace)])];
}

/**
 * Remap a `.rune`-style file name to a `.rosetta` URI so the Langium
 * service registry (which only registers the `.rosetta` parser) can
 * dispatch correctly. Internal to the server-side parse only — the
 * generated outputs use the namespace-derived path from
 * `getTargetRelativePath`, not the input file names.
 */
function toRosettaUri(name: string, URI: typeof import('langium').URI): import('langium').URI {
  const remapped = name.replace(/\.[^./\\]+$/, '.rosetta');
  return URI.parse(`file:///${remapped}`);
}

/**
 * Convert a curated-doc key (`${bundleId}/${docPath}` — the format every
 * `cd.uri`/`curatedDoc.uri` in this file is always in) to the EXACT URI
 * scheme the curated-mirror bakes into serialized cross-document
 * references: `file:///[${bundleId}]/${docPath}`.
 *
 * `apps/curated-mirror-worker/src/namespace-graph.ts::refUriToCuratedKey`
 * is the inverse of this conversion — it's how the manifest's per-
 * namespace `deps` graph gets built from the SAME embedded refs, and its
 * own doc comment documents the exact scheme:
 * `file:///%5Bcdm%5D/<doc.path>#/elements@0` (URL-encoded `file:///[cdm]/...`).
 *
 * Registering hydrated documents under any OTHER scheme (this code
 * previously used `curated:///${cd.uri}`) means a cross-document
 * reference can never resolve, regardless of hydration order — Langium's
 * JsonSerializer resolves `.ref` by looking up the reference's embedded
 * target URI (fixed at serialization time, unrelated to whatever scheme
 * the consumer later registers documents under) in `LangiumDocuments`.
 * Confirmed live: an unresolved `Data.superType.ref`'s error was literally
 * "Could not find document for URI: file:///%5Bcdm%5D/.../event-workflow-
 * type.rosetta..." while this file registered that same document under
 * `curated:/cdm/.../event-workflow-type.rosetta` — same document, wrong
 * scheme, so the lookup always missed (2026-07 cross-document reference
 * resolution investigation).
 */
function curatedKeyToUri(key: string, URI: typeof import('langium').URI): import('langium').URI {
  const slash = key.indexOf('/');
  if (slash < 0) return URI.parse(`file:///[${key}]`);
  return URI.parse(`file:///[${key.slice(0, slash)}]/${key.slice(slash + 1)}`);
}

/**
 * Combined loader for user-authored files + curated-bundle documents.
 * Hydrates both into a single `LangiumDocument[]` that `generate()`
 * can consume.
 *
 * User files take the parse path (raw .rune source → Langium parser →
 * resolved AST). Curated bundles take the deserialize path: each
 * pre-parsed `modelJson` is rebuilt into a Langium AST via
 * `JsonSerializer.deserialize`, then wrapped in a synthetic
 * `LangiumDocument` so it shares the same shape as the parsed
 * user-file documents.
 *
 * The codegen package only reads `doc.uri` and `doc.parseResult.value`
 * from each document — both fields are populated by the path above,
 * so the emitters don't need to know which path produced each doc.
 *
 * 019 Task #88.
 */
async function loadAllDocuments(
  files: ReadonlyArray<{ path: string; content: string }>,
  curatedBundles: ReadonlyArray<{ id: string; version: string }>,
  curatedFetcher: ((url: string, init?: RequestInit) => Promise<Response>) | undefined,
  requestedNamespaces: readonly string[],
  curatedDocs: ReadonlyArray<{ uri: string; serializedModel: string }>
): Promise<{
  docs: import('langium').LangiumDocument[];
  curatedError?: Response;
  namespaces?: string[];
  resolvedCohorts?: Record<string, string>;
}> {
  const [{ createRuneDslServices, hydrateModelDocuments }, { EmptyFileSystem, URI }] = await Promise.all([
    import('@rune-langium/core'),
    import('langium')
  ]);
  const { RuneDsl } = createRuneDslServices(EmptyFileSystem);
  const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
  const builder = RuneDsl.shared.workspace.DocumentBuilder;

  const docs: import('langium').LangiumDocument[] = [];

  // User-authored files — parse via Langium.
  if (files.length > 0) {
    const parsed = files.map((f) => factory.fromString(f.content, toRosettaUri(f.path, URI)));
    docs.push(...parsed);
  }

  // Closure seeds: namespaces the user files import, plus the request's
  // dependency-closed namespace subset (the modal cascade output). Imports are
  // syntactic — readable from the parsed AST without a link.
  const seeds = new Set<string>(requestedNamespaces);
  for (const doc of docs) {
    const model = doc.parseResult?.value as { imports?: Array<{ importedNamespace?: unknown }> } | undefined;
    for (const imp of model?.imports ?? []) {
      if (typeof imp.importedNamespace === 'string' && imp.importedNamespace.length > 0) {
        seeds.add(imp.importedNamespace);
      }
    }
  }

  // Path C — fetch only the import closure via the manifest. Preferred
  // whenever bundle info is available, even if curatedDocs was ALSO sent:
  // curatedDocs reflects whatever the client's workspace happens to have
  // ALREADY hydrated via on-demand navigation, which is not guaranteed to
  // cover the full dependency-closed `namespaces` selection this request
  // asks for. Trusting an incomplete curatedDocs set silently produced
  // "unknown-attribute"/"unresolved-enum-reference" diagnostics for
  // namespaces one `extends`/`import` hop away from what was actually
  // hydrated — diagnostics that looked like real corpus/codegen bugs but
  // were actually missing input (2026-07 codegen-400 investigation). This
  // avoids loading the whole serialized workspace artifact (which OOMs on
  // CDM at 128 MiB) — the manifest records the dependency graph so we walk
  // it here without fetching+parsing any documents upfront.
  let namespaces: string[] | undefined;
  let resolvedCohorts: Record<string, string> | undefined;
  if (curatedBundles.length > 0) {
    try {
      const loaded = await loadCuratedWorkspace(curatedBundles, seeds, curatedFetcher, true);
      namespaces = [...new Set([...requestedNamespaces, ...loaded.closure])];
      resolvedCohorts = Object.fromEntries(
        loaded.bundles.flatMap((bundle) => (bundle.manifest.cohort ? [[bundle.id, bundle.manifest.cohort]] : []))
      );
      const entries = loaded.bundles.flatMap((bundle) =>
        bundle.documents.map((entry) => ({ uri: curatedKeyToUri(entry.uri, URI), json: entry.serializedModel }))
      );
      docs.push(
        ...hydrateModelDocuments({ RuneDsl, shared: RuneDsl.shared }, entries).map((result) => result.document)
      );
    } catch (err) {
      const curatedError = curatedWorkspaceErrorResponse(err);
      if (curatedError) return { docs: [], curatedError };
      throw err;
    }
  } else if (curatedDocs.length > 0) {
    // Path A fallback — no bundle info was supplied at all, so there's no
    // manifest to independently verify/backfill against. Deserialize
    // exactly what the client sent, same as before this hardening.
    //
    // hydrateModelDocuments (batch, not hydrateModelDocument per-doc) is
    // required here for the same reason as Path C: Langium's JsonSerializer
    // resolves a cross-document reference via a one-shot lookup against
    // whatever's ALREADY registered at deserialize time, so hydrating one
    // document at a time permanently bakes in an unresolved `.ref` for
    // anything pointing at a sibling document later in the list. And
    // curatedKeyToUri (not `curated:///${cd.uri}`) is required so those
    // references — baked into the serialized JSON under the curated
    // mirror's own URI scheme — can resolve at all (see hydrateModelDocuments'
    // and curatedKeyToUri's own doc comments).
    const results = hydrateModelDocuments(
      { RuneDsl, shared: RuneDsl.shared },
      curatedDocs.map((cd) => ({ uri: curatedKeyToUri(cd.uri, URI), json: cd.serializedModel }))
    );
    docs.push(...results.map((r) => r.document));
  }

  // Build only the user-file docs. Curated docs are hydrated (not
  // Langium-linked): hydrateModelDocuments already resolves their
  // cross-document references via its own two-pass registration (see its
  // doc comment) — Builder.build on a hydrated doc would try to re-link
  // references through the normal Linker/ScopeProvider path and fail
  // since the Langium service hasn't indexed them that way.
  if (files.length > 0) {
    const userDocs = docs.slice(0, files.length);
    await builder.build(userDocs, { validation: false });
  }

  return { docs, namespaces, ...(resolvedCohorts ? { resolvedCohorts } : {}) };
}

function hasParserErrors(docs: ReadonlyArray<import('langium').LangiumDocument>): GeneratorDiagnostic[] {
  // Use the shape from packages/codegen/src/diagnostics.ts so the
  // response envelope is uniform with codegen-emitted diagnostics.
  const diagnostics: GeneratorDiagnostic[] = [];
  for (const doc of docs) {
    for (const err of doc.parseResult.parserErrors) {
      diagnostics.push({
        severity: 'error',
        code: 'parse-error',
        message: err.message
      });
    }
  }
  return diagnostics;
}

function fatalDiagnostics(outputs: readonly GeneratorOutput[]): GeneratorDiagnostic[] {
  return outputs.flatMap((o) => o.diagnostics.filter((d) => d.severity === 'error'));
}

function downloadFilename(target: Target, outputs: readonly GeneratorOutput[], artifactEnvelope = false): string {
  if (artifactEnvelope) return `${target}-output.zip`;
  const descriptor = TARGET_DESCRIPTORS[target];
  // Multi-file results are always returned as a zip via `zipResponse`,
  // regardless of contract. Codex review on PR #165 caught that a
  // whole-model emitter returning workbook + sidecar manifest would
  // previously have been served the zip's bytes under the `model.xlsx`
  // filename — i.e., the browser would save a zip body as if it were
  // a workbook. Length check takes precedence so the filename stays
  // truthful to the body.
  if (outputs.length > 1) {
    return `${target}-output.zip`;
  }
  // Single-output path. Whole-model emitters embed the bundled path
  // (`model.xlsx`, `schema.graphql`) in `relativePath`; per-namespace
  // emitters embed `<ns>/<base><ext>`.
  if (descriptor.contract === 'whole-model') {
    return outputs[0]?.relativePath ?? `model${descriptor.extension}`;
  }
  return outputs[0]?.relativePath.split('/').pop() ?? `${target}-output${descriptor.extension}`;
}

function singleArtifactResponse(target: Target, output: GeneratorOutput, filename: string): Response {
  const descriptor = TARGET_DESCRIPTORS[target];
  const contentType = descriptor.mimeType ?? 'text/plain; charset=utf-8';
  // Whole-model binary emitters set `output.binary` (Uint8Array); text
  // emitters set `output.content` (string). Phase 0 only ships text
  // emitters but the contract supports both. The cast through ArrayBuffer
  // is for the CF Workers `BodyInit` type, which doesn't accept typed
  // array views directly the way the DOM lib does.
  const body: BodyInit = output.binary
    ? (output.binary.buffer.slice(
        output.binary.byteOffset,
        output.binary.byteOffset + output.binary.byteLength
      ) as ArrayBuffer)
    : output.content;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
}

async function zipResponse(outputs: readonly GeneratorOutput[], filename: string): Promise<Response> {
  const zip = new JSZip();
  for (const output of outputs) {
    if (output.binary !== undefined) {
      zip.file(output.relativePath, output.binary);
    } else {
      zip.file(output.relativePath, output.content);
    }
  }
  // Generate the zip as a Node-buffer / ArrayBuffer so the CF Workers
  // `BodyInit` accepts it directly (Uint8Array isn't on the union).
  const body = await zip.generateAsync({ type: 'arraybuffer' });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
}

function isSafeArtifactPath(path: string): boolean {
  return path.length > 0 && !path.startsWith('/') && !path.split('/').includes('..') && path !== '.rune/export.json';
}

async function artifactEnvelopeResponse(
  target: Target,
  outputs: readonly GeneratorOutput[],
  filename: string,
  selection: ExportSelection | undefined,
  resolvedSelection?: ExportArtifactManifest['resolvedSelection'],
  resolvedCohorts?: ExportArtifactManifest['resolvedCohorts'],
  projectReceipt?: ExportArtifactManifest['projectReceipt']
): Promise<Response> {
  const zip = new JSZip();
  const files: ExportArtifactManifest['files'] = [];
  const paths = new Set<string>();
  for (const output of outputs) {
    if (!isSafeArtifactPath(output.relativePath) || paths.has(output.relativePath)) {
      throw new Error(`Unsafe or duplicate generated artifact path '${output.relativePath}'.`);
    }
    paths.add(output.relativePath);
    const payload = output.binary ?? output.content;
    zip.file(output.relativePath, payload);
    files.push({
      path: output.relativePath,
      kind: output.binary ? 'binary' : 'text',
      ...(output.mimeType ? { mimeType: output.mimeType } : {}),
      bytes: typeof payload === 'string' ? new TextEncoder().encode(payload).byteLength : payload.byteLength
    });
  }
  const manifest: ExportArtifactManifest = {
    version: 1,
    target,
    ...(projectReceipt ? { projectReceipt } : {}),
    ...(selection ? { selection } : {}),
    ...(resolvedSelection ? { resolvedSelection } : {}),
    ...(resolvedCohorts && Object.keys(resolvedCohorts).length > 0 ? { resolvedCohorts } : {}),
    files,
    diagnostics: outputs.flatMap((output) => output.diagnostics)
  };
  zip.file('.rune/export.json', JSON.stringify(manifest));
  return new Response(await zip.generateAsync({ type: 'arraybuffer' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Rune-Export-Filename': filename
    }
  });
}

/**
 * Build the `GeneratorOptions` to pass to `generate()`, filling in the
 * Pages-Function-opinionated layout default for the target when the
 * request omits one. The library default stays `'per-namespace'` so a
 * direct caller (CLI / test fixture) that passes
 * `options.<target>.layout: 'per-namespace'` keeps that choice — we
 * only fill in when nothing was set.
 */
function applyPagesFunctionDefaults(body: CodegenRequestBody): Record<string, unknown> {
  const result: Record<string, unknown> = { target: body.target, ...body.options };
  // 019 §5.3 — forward the namespace allowlist to generate(). Empty array
  // is treated as "no filter" (omit) so an accidental empty selection
  // doesn't silently emit nothing; the modal disables Generate on an empty
  // set, and direct callers that want everything just omit the field.
  if (Array.isArray(body.namespaces) && body.namespaces.length > 0) {
    result.namespaces = body.namespaces;
  }
  if (body.selection) result.selection = body.selection;
  if (body.projectBuild) return { ...result, strict: true };
  const target = body.target;
  const serverDefault = PAGES_FUNCTION_DEFAULT_LAYOUT[target];
  if (!serverDefault) return result;
  const existingBlock = (result[target] as { layout?: string } | undefined) ?? {};
  if (existingBlock.layout) return result; // caller explicitly set it
  result[target] = { ...existingBlock, layout: serverDefault };
  return result;
}

// Manually wrapped (Cloudflare Pages Function arrow export — codemod-blind).
// `request`/`env`/the request body (raw model files + codegen options) and
// the Response outputs all carry raw user model content or may carry
// secret env bindings — never captured.
export const handleCodegenDownload = withInstrumentation(
  async ({
    request,
    env,
    project
  }: {
    request: Request;
    env?: CodegenDownloadEnv;
    project?: ProjectRuntimeInput;
  }): Promise<Response> => {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError(400, 'Malformed JSON body');
    }
    if (!isValidRequest(raw)) {
      return jsonError(
        400,
        'Request must be { files: [{path, content}], target: <Target>, options?, curatedBundles? }'
      );
    }
    const body = raw;
    if (body.projectTarget && !project)
      return jsonError(400, 'A named project target requires a captured managed project.');

    // Target gating. `IMPLEMENTED_TARGETS` is the single source of truth
    // for which emitters this build has; mirrors the studio table's
    // filter so the server doesn't accept a click the UI would never
    // have sent.
    if (!(IMPLEMENTED_TARGETS as readonly string[]).includes(body.target)) {
      return jsonError(400, `Target '${body.target}' is not implemented in this build`);
    }

    const curatedBundles = body.curatedBundles ?? [];
    const curatedDocs = body.curatedDocs ?? [];
    // 019 Task #88 — a pure curated workspace ships zero user files but a
    // non-empty curated source: either curatedBundles (path C) OR pre-loaded
    // curatedDocs (path A). All three empty is the genuine bad-input case.
    if (!project && body.files.length === 0 && curatedBundles.length === 0 && curatedDocs.length === 0) {
      return jsonError(400, 'files / curatedBundles / curatedDocs: at least one must be non-empty');
    }

    try {
      const curatedFetcher = env?.CURATED_MIRROR
        ? (url: string, init?: RequestInit) => env.CURATED_MIRROR!.fetch(url, init)
        : undefined;

      // Prune unconditionally, regardless of whether THIS request is
      // cacheable (Codex review round 2 on PR #445) — an isolate that served
      // one curated-only request and then a run of requests with user files
      // (never cacheable, cacheKey undefined below) would otherwise never
      // prune again, leaving an EXPIRED entry strongly referenced for the
      // isolate's full lifetime instead of the advertised 5-minute TTL.
      const now = Date.now();
      pruneDocumentCache(now);

      const cacheKey =
        body.files.length === 0 && curatedBundles.length > 0
          ? documentCacheKey(curatedBundles, requestedNamespaces(body))
          : undefined;

      let documents: import('langium').LangiumDocument[];
      let resolvedNamespaces: string[] | undefined;
      let resolvedCohorts: Record<string, string> | undefined;
      let projectGraph: import('@rune-langium/project-runtime/effective').EffectiveProject | undefined;
      // Set whenever this request is consuming a cache entry (whether it
      // just registered it or coalesced onto an existing one) — released in
      // the outer `finally` below, which now spans from registration all the
      // way through the response (round 10; see the entry's own doc comment
      // for why this can no longer be an identity-guarded, post-`await`
      // registration).
      let releaseDocumentCacheConsumer: (() => void) | undefined;
      try {
        if (project) {
          const { applyEffectiveProject } = await import('@rune-langium/project-runtime/effective');
          const graph = await applyEffectiveProject(project);
          projectGraph = graph;
          documents = [...graph.documents];
          resolvedCohorts = Object.fromEntries(
            Object.entries(project.snapshot.lock?.references ?? {}).map(([id, entry]) => [id, entry.cohort])
          );
          if (body.projectTarget) {
            const { projectTargetNamespaces } = await import('@rune-langium/project-runtime/browser');
            const { namespaceFromModelName, isRosettaModel } = await import('@rune-langium/core');
            const available = new Set(
              documents.flatMap((document) =>
                isRosettaModel(document.parseResult.value)
                  ? [namespaceFromModelName(document.parseResult.value.name)].filter((name): name is string =>
                      Boolean(name)
                    )
                  : []
              )
            );
            body.selection = {
              namespaces: projectTargetNamespaces(project.snapshot, body.projectTarget, available),
              declarations: []
            };
          }
        } else if (cacheKey) {
          let entry = documentCache.get(cacheKey);
          if (!entry) {
            // A miss means the cache is either empty or holds a DIFFERENT
            // (mismatched) entry. That entry's promise can't be cancelled — if
            // it's still `pending`, its hydration keeps running to completion
            // in ITS OWN request handler regardless of what we do here; if
            // it's already settled but still has active consumers, THEIR
            // `generate()` calls are still walking its documents (round 9).
            // Starting a NEW hydration immediately would let two (possibly
            // CDM-sized) closures process concurrently, doubling peak memory
            // and risking the very resource-limit crash this cache exists to
            // prevent (Codex review round 7 on PR #445). Capture whatever to
            // wait for — the hydration promise (harmless no-op if already
            // settled) plus any active-consumer completions — before clearing,
            // so the replacement hydration can be chained to start only once
            // everything using the evicted entry has vacated.
            const stalePending: Array<ReturnType<typeof loadAllDocuments> | Promise<void>> = [];
            for (const e of documentCache.values()) {
              if (isDocumentCacheEntryBusy(e)) stalePending.push(e.promise, ...e.activeConsumers);
            }
            // Clear it BEFORE starting hydration, not after, so at most one
            // entry is ever resident in the MAP at a time, including during
            // hydration itself (round 2). Then register the hydration PROMISE,
            // synchronously, before awaiting it — this whole
            // get/clear/create/set/prune sequence contains no `await`, so it's
            // atomic with respect to any other in-flight request: a second
            // concurrent request for the SAME key that reaches this code next
            // finds the promise already registered and just awaits it, instead
            // of independently fetching+hydrating the same closure a second
            // time (round 4). The actual `loadAllDocuments` call is deferred
            // inside a `.then()` chained after `stalePending` settles, rather
            // than `await`ed inline here, so this synchronous section still
            // never yields — a same-key request arriving before `stalePending`
            // settles still finds this entry already registered and coalesces
            // onto it normally.
            documentCache.clear();
            const promise = (
              stalePending.length > 0 ? Promise.allSettled(stalePending) : Promise.resolve(undefined)
            ).then(() =>
              loadAllDocuments(body.files, curatedBundles, curatedFetcher, requestedNamespaces(body), curatedDocs)
            );
            const newEntry = { promise, cachedAt: now, pending: true, activeConsumers: [] };
            entry = newEntry;
            documentCache.set(cacheKey, newEntry);
            // Re-prune immediately after registering (round 3) — the
            // pre-hydration clear above only protects THIS request's own
            // miss; two concurrent requests for DIFFERENT keys can each clear
            // an (already empty, or the other's not-yet-registered) cache and
            // each register their own entry, leaving two until something
            // re-prunes. Pruning right after `set` bounds that window to the
            // gap between two concurrent `set` calls. `newEntry.pending` keeps
            // this specific entry exempt from the TTL half of that prune until
            // it settles (round 6).
            pruneDocumentCache(now);
            // Settle handling, guarded by identity throughout (only act if
            // THIS exact entry is still the one registered) so a stale,
            // now-orphaned hydration's later settlement can't affect a NEWER,
            // unrelated registration for the same key that replaced it in
            // between (e.g. key K's slow hydration outlives an interleaved
            // different-key clear that evicted it, then a third request
            // re-registers K fresh).
            //
            // On success: bump `cachedAt` to the actual completion time and
            // clear `pending` — the TTL window should measure freshness from
            // when the entry became usable, not from registration (round 6).
            // A resolved `curatedError` is left for the awaiting code below to
            // delete (same effect, no need to duplicate it here).
            //
            // On REJECTION: evict outright (round 5) — loadAllDocuments can
            // throw (e.g. a malformed namespace artifact), not just return a
            // structured error, and a rejected promise left cached would
            // poison every identical request for the rest of the TTL window
            // even if the failure was transient.
            promise.then(
              (result) => {
                if (!result.curatedError && documentCache.get(cacheKey) === newEntry) {
                  newEntry.cachedAt = Date.now();
                  newEntry.pending = false;
                }
              },
              () => {
                if (documentCache.get(cacheKey) === newEntry) {
                  documentCache.delete(cacheKey);
                }
              }
            );
          }
          // Register a consumption reservation on `entry` SYNCHRONOUSLY, right
          // here — before awaiting its hydration, not after (Codex review
          // round 10 on PR #445). Registering it post-`await`, guarded by
          // `documentCache.get(cacheKey) === entry`, left a race: a
          // different-key request could evict THIS entry while it was still
          // `pending` (its `stalePending` capture would correctly wait for
          // hydration, since `entry.promise` alone was still in scope) but,
          // once hydration settled, the identity check here would fail (the
          // entry's gone from the map) and skip registering the reservation
          // entirely — so THIS request's subsequent `generate()` walk became
          // completely invisible to any busy-check, and the evictor's already-
          // snapshotted wait-list had no way to retroactively include it.
          // Registering synchronously, before the `await`, closes that gap:
          // `entry` is a plain object this request holds a direct reference
          // to regardless of whether it's still the map's resident value, so
          // pushing onto `entry.activeConsumers` needs no identity guard — any
          // OTHER request that captures `entry` (via `documentCache.values()`)
          // before evicting it will already see this reservation, whether
          // `entry` is still pending or has since settled. Released in the
          // outer `finally` below, which now spans hydration through the
          // response so every exit path (a `curatedError` return here, a 400,
          // a thrown error, or success) releases it exactly once.
          let resolveConsumption!: () => void;
          const consumption = new Promise<void>((resolve) => {
            resolveConsumption = resolve;
          });
          entry.activeConsumers.push(consumption);
          releaseDocumentCacheConsumer = () => {
            resolveConsumption();
            const index = entry.activeConsumers.indexOf(consumption);
            if (index !== -1) entry.activeConsumers.splice(index, 1);
          };

          const result = await entry.promise;
          if (result.curatedError) {
            // Don't leave a failed hydration cached for a later request to
            // reuse — identity-guarded for the same reason as the rejection
            // handler above — and .clone() the Response, since this exact
            // instance may be shared with another request that coalesced onto
            // the same promise (a Response body can only be consumed once).
            if (documentCache.get(cacheKey) === entry) {
              documentCache.delete(cacheKey);
            }
            return result.curatedError.clone();
          }
          documents = result.docs;
          resolvedNamespaces = result.namespaces;
          resolvedCohorts = result.resolvedCohorts;
        } else {
          // A non-cacheable request (has user files, so its own document set
          // can't safely be reused by a later request) can still compete for
          // memory with whatever's resident in `documentCache` when it ALSO
          // hydrates curated content (`curatedBundles.length > 0`) — a settled
          // cached closure stays strongly referenced in the map for its whole
          // TTL window, and a pending one keeps hydrating regardless of what
          // this request does — as can a settled entry still being walked by
          // another request's `generate()` call (round 9). Building a SECOND
          // (possibly CDM-sized) closure alongside any of those risks the same
          // resource-limit crash the cache exists to prevent (Codex review
          // round 8 on PR #445). Evict an idle settled entry outright (nothing
          // to wait for) and serialize behind a busy one, exactly as the
          // cacheable path does (rounds 7/9), before starting this request's
          // own hydration. Scoped to `curatedBundles.length > 0` — a pure
          // user-file request never competes for curated-closure memory, so
          // there's nothing to protect against and no reason to pay the
          // eviction/wait cost.
          if (curatedBundles.length > 0 && documentCache.size > 0) {
            const stalePending: Array<ReturnType<typeof loadAllDocuments> | Promise<void>> = [];
            for (const e of documentCache.values()) {
              if (isDocumentCacheEntryBusy(e)) stalePending.push(e.promise, ...e.activeConsumers);
            }
            documentCache.clear();
            if (stalePending.length > 0) {
              await Promise.allSettled(stalePending);
            }
          }
          const result = await loadAllDocuments(
            body.files,
            curatedBundles,
            curatedFetcher,
            requestedNamespaces(body),
            curatedDocs
          );
          if (result.curatedError) return result.curatedError;
          documents = result.docs;
          resolvedNamespaces = result.namespaces;
          resolvedCohorts = result.resolvedCohorts;
        }

        const parseErrors = hasParserErrors(documents);
        if (parseErrors.length > 0) {
          return jsonError(400, 'One or more files failed to parse', parseErrors);
        }

        // Lazy-import `generate` so the function cold-start doesn't pay
        // for the codegen bundle on requests that fail at the parse step.
        //
        // Apply the Pages Function's opinionated layout default for the
        // target (019 Phase 0.5.5) — the studio's Download flow delegates
        // its layout choice to the server, so `body.options.<target>.layout`
        // is only set when a caller wants to override the server's choice.
        const { generate, generateSelected, unknownExportSelectionDiagnostics } =
          await import('@rune-langium/codegen/export');
        const generatorOptions = applyPagesFunctionDefaults(body);
        if (projectGraph) {
          const { assertProjectGenerationCapabilities } = await import('@rune-langium/project-runtime/effective');
          assertProjectGenerationCapabilities(
            projectGraph,
            body.selection ??
              (body.namespaces?.length
                ? { namespaces: resolvedNamespaces ?? body.namespaces, declarations: [] }
                : undefined),
            body.target
          );
          generatorOptions.projectBindings = projectGraph.implementationBindings;
          generatorOptions.projectResources = projectGraph.bindings;
        }
        if (resolvedNamespaces && body.namespaces) generatorOptions.namespaces = resolvedNamespaces;
        const selectedGeneration = body.selection
          ? await generateSelected(documents, body.selection, generatorOptions)
          : undefined;
        const selectionReceipt = selectedGeneration?.selection;
        const unknownSelectionDiagnostics = selectionReceipt ? unknownExportSelectionDiagnostics(selectionReceipt) : [];
        if (unknownSelectionDiagnostics.length) {
          return jsonError(
            400,
            'One or more selected export roots do not exist in the workspace',
            unknownSelectionDiagnostics.map((diagnostic) => ({
              severity: 'error' as const,
              code: diagnostic.code,
              message: diagnostic.message
            }))
          );
        }
        const outputs = selectedGeneration?.outputs ?? (await generate(documents, generatorOptions));

        const errors = fatalDiagnostics(outputs);
        if (errors.length > 0) {
          return jsonError(400, 'Code generation produced errors', errors);
        }
        if (outputs.length === 0) {
          return jsonError(400, 'No output was generated (workspace had no namespaces)');
        }

        const filename = downloadFilename(body.target, outputs, body.artifactEnvelope === 1);
        if (body.artifactEnvelope === 1) {
          return artifactEnvelopeResponse(
            body.target,
            outputs,
            filename,
            body.selection,
            selectionReceipt
              ? {
                  explicit: selectionReceipt.explicit,
                  included: selectionReceipt.included,
                  requiredBy: Object.fromEntries(selectionReceipt.requiredBy)
                }
              : undefined,
            resolvedCohorts,
            project?.receipt
          );
        }
        if (outputs.length === 1) {
          return singleArtifactResponse(body.target, outputs[0]!, filename);
        }
        return zipResponse(outputs, filename);
      } finally {
        // Covers the WHOLE window from cache-entry registration/coalescing
        // through the response — release the active-consumer reservation
        // (round 10), if one was registered above, regardless of which exit
        // path is taken (a `curatedError` return, a 400, a thrown error
        // caught by the outer `catch`, or success).
        releaseDocumentCacheConsumer?.();
      }
    } catch (err) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          diagnostics: []
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  },
  { op: 'onRequestPost' }
);
