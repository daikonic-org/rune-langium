// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import {
  createRuneDslServices,
  hydrateModelDocuments,
  namespaceFromModelName,
  readLspModelMetadata
} from '@rune-langium/core';
import { projectSourcePaths } from '@rune-langium/project-config';
import { EmptyFileSystem, URI } from 'langium';
import { projectReferenceUri } from '@rune-langium/project-runtime/context';
import type { ProjectRuntimeInput } from './project-runtime-input.js';
import type { WorkspaceState } from '../shell/providers/workspace-context.js';
import type { HydrateRequest } from '../workers/parser-worker.js';
import { pathToUri } from '../utils/uri.js';
import { withInstrumentation } from './instrumentation/core.js';
import { linkDocument, type WorkspaceFile } from './workspace.js';
import { isRecord } from './message-guards.js';
import { allocateOpId } from './op-log.js';
import { recordPerf, recordPerfStart } from './perf-log.js';

export type ProjectReferenceInventory = Pick<WorkspaceState, 'files' | 'deferredExports' | 'curatedCacheSeeds'>;

/** A reconstructed graph must have its own scopes before UI consumers read lazy references. */
async function hydrateReferenceView(entries: ReadonlyArray<{ uri: string; json: string }>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const services = createRuneDslServices(EmptyFileSystem);
  const hydrated = hydrateModelDocuments(services, entries);
  await services.shared.workspace.DocumentBuilder.build(
    hydrated.map((entry) => entry.document),
    { validation: false, eagerLinking: false }
  );
  signal?.throwIfAborted();
  return { services, hydrated };
}

/** Editable inventory stays live; only locked reference files come from a captured view. */
export const mergeProjectReferenceFiles = withInstrumentation(
  function mergeProjectReferenceFiles(current: readonly WorkspaceFile[], references: readonly WorkspaceFile[]) {
    return [
      ...current.filter((file) => (!file.readOnly && !file.refOnly) || file.path.startsWith('system://')),
      ...references.filter((file) => file.refOnly && !file.path.startsWith('system://'))
    ];
  },
  { op: 'mergeProjectReferenceFiles', capture: 0 }
);

export const prepareProjectReferenceView = withInstrumentation(
  async function prepareProjectReferenceView(
    input: ProjectRuntimeInput,
    state: WorkspaceState,
    install: (documents: HydrateRequest['documents']) => Promise<void>,
    signal: AbortSignal,
    link: typeof linkDocument = linkDocument,
    onInventory?: (inventory: ProjectReferenceInventory) => void
  ): Promise<WorkspaceState> {
    const sources = new Set(projectSourcePaths(input.snapshot.files, input.snapshot.project.build.sources));
    const references: WorkspaceFile[] = [];
    const referenceInfo = new Map(input.referenceDocuments.map((doc) => [projectReferenceUri(doc.uri), doc]));
    for (const entry of input.referenceDocuments) {
      if (!entry.serialized) throw new Error('Locked semantic document is unavailable: ' + entry.uri);
      const path = projectReferenceUri(entry.uri).slice('file:///'.length);

      references.push({
        path,
        name: entry.uri,
        content: entry.content,
        serializedModelJson: entry.serialized,
        readOnly: true,
        refOnly: true,
        sourceLoaded: true,
        dirty: false,
        bundleId: entry.uri.split('/')[0]
      });
    }
    const files = mergeProjectReferenceFiles(state.files, references);
    const original = new Map(state.parsedModels.map((entry) => [entry.filePath, entry]));
    const entries = files
      .filter((file) => sources.has(file.path) || file.refOnly || file.path.startsWith('system://'))
      .map((file) => {
        const parsed = original.get(file.path);
        const serialized = file.refOnly
          ? file.serializedModelJson
          : parsed?.source === file.content
            ? parsed.serializedModelJson
            : undefined;
        if (!serialized) throw new Error('Waiting for the parser snapshot of the current source: ' + file.path);
        return { file, json: serialized, uri: pathToUri(file.path) };
      });
    signal.throwIfAborted();
    // Current worker-decoded publications already carry the canonical index. Only
    // legacy entries missing it require reconstruction here.
    const fallback = entries.filter((entry) => {
      const info = referenceInfo.get(entry.uri);
      return !info || !info.exports || !info.lsp;
    });
    const { services, hydrated } = await hydrateReferenceView(fallback, signal);
    const roots = new Map(fallback.map((entry, index) => [entry.uri, hydrated[index]!]));
    const documents: HydrateRequest['documents'] = [];
    for (const entry of entries) {
      const info = referenceInfo.get(entry.uri);
      const root = roots.get(entry.uri);
      const exports =
        info?.lsp && info.exports
          ? info.exports
          : (await services.RuneDsl.references.ScopeComputation.collectExportedSymbols(root!.document)).map(
              ({ name, type, path }) => ({ name, type, path })
            );
      documents.push({
        uri: entry.uri,
        content: entry.file.content,
        serializedModel: entry.json,
        exports,
        ...(info?.lsp ? { references: info.lsp.metadata.references } : {}),
        ...(entry.file.refOnly ? { bundleId: entry.file.bundleId } : {})
      });
      signal.throwIfAborted();
    }
    await install(documents);
    signal.throwIfAborted();
    const namespace = (uri: string) =>
      referenceInfo.get(uri)?.lsp?.metadata.namespace ?? namespaceFromModelName(roots.get(uri)?.model.name ?? '') ?? '';
    // Scope requests rebuild from workspace files, including the index for deferred references.
    const exportsByUri = new Map(documents.map(({ uri, exports }) => [uri, exports]));
    const view: WorkspaceState = {
      ...state,
      files: files.map((file) => {
        if (!file.refOnly) return file;
        const uri = pathToUri(file.path);
        return { ...file, namespace: namespace(uri), exports: exportsByUri.get(uri) };
      }),
      models: hydrated.map((entry) => entry.model),
      parsedModels: fallback.map((entry) => ({
        filePath: entry.file.path,
        model: roots.get(entry.uri)!.model,
        source: entry.file.content,
        serializedModelJson: entry.json
      })),
      deferredExports: documents.map((doc) => ({
        filePath: entries.find((entry) => entry.uri === doc.uri)!.file.path,
        namespace: namespace(doc.uri),
        exports:
          referenceInfo.get(doc.uri)?.lsp?.metadata.declarations ??
          readLspModelMetadata(doc.serializedModel).declarations ??
          []
      })),
      curatedCacheSeeds: []
    };
    // Verified text and declaration ownership do not require the local dependency graph to be linked.
    onInventory?.({ files: view.files, deferredExports: view.deferredExports, curatedCacheSeeds: [] });
    // Concrete local models are published as ready. Their inherited members and
    // type references must therefore share a linked graph with their dependencies.
    if (fallback.length === entries.length) return view;
    const local = entries.filter((entry) => sources.has(entry.file.path));
    if (local.length) {
      // One traversal captures shared dependencies once, rather than repeating
      // their serialization and transfer for every installed implementation.
      const result = await link(
        local[0]!.uri,
        'uris',
        local.slice(1).map((entry) => entry.uri)
      );
      signal.throwIfAborted();
      if (!result.linked || result.errors.length)
        throw new Error(
          result.errors.join('\n') || 'Local reference dependencies are unavailable: ' + local[0]!.file.path
        );
      return materializeProjectReferenceView(view, result.materializedUris ?? result.newModels, signal);
    }
    return view;
  },
  {
    op: 'prepareProjectReferenceView',
    capture: 0,
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

/** UI consumers require scope-ready ASTs; revive only the worker's materialized closure. */
export const materializeProjectReferenceView = withInstrumentation(
  async function materializeProjectReferenceView(
    view: WorkspaceState,
    additions: readonly (import('@rune-langium/core').RosettaModel | string)[],
    signal?: AbortSignal
  ): Promise<WorkspaceState> {
    signal?.throwIfAborted();
    const canonical = (uri: string) => URI.parse(uri).toString();
    const files = new Map(view.files.map((file) => [canonical(pathToUri(file.path)), file]));
    const parsed = new Map(view.parsedModels.map((entry) => [entry.filePath, entry]));
    // The HTTP parser records file:///name while the editor uses
    // file:///workspace/name. Accept only aliases proved by this capture's
    // canonical serialized metadata, and never guess through an ambiguous alias.
    let sourceFiles: Map<string, WorkspaceFile | undefined> | undefined;
    const legacySourceFile = (uri: string) => {
      if (!sourceFiles) {
        sourceFiles = new Map();
        for (const entry of parsed.values()) {
          if (!entry.serializedModelJson) continue;
          const sourceUri = readLspModelMetadata(entry.serializedModelJson).sourceUri;
          const file = view.files.find((file) => file.path === entry.filePath);
          if (!sourceUri || !file) continue;
          const key = canonical(sourceUri);
          sourceFiles.set(key, !sourceFiles.has(key) || sourceFiles.get(key) === file ? file : undefined);
        }
      }
      return sourceFiles.get(uri);
    };
    const wanted = new Set(parsed.keys());
    for (const model of additions) {
      const uri =
        typeof model === 'string'
          ? model
          : '$textRegion' in model && isRecord(model.$textRegion) && typeof model.$textRegion.documentURI === 'string'
            ? model.$textRegion.documentURI
            : undefined;
      const file = uri && (files.get(canonical(uri)) ?? legacySourceFile(canonical(uri)));
      if (!file) throw new Error('The linked reference document is not in the current verified view.');
      wanted.add(file.path);
    }
    if (wanted.size === parsed.size) return view;
    const entries = [...wanted].map((path) => {
      const file = view.files.find((file) => file.path === path)!;
      const json = file.refOnly ? file.serializedModelJson : parsed.get(path)?.serializedModelJson;
      if (!json) throw new Error('The current reference/source snapshot is unavailable: ' + path);
      return { file, json, uri: pathToUri(path) };
    });
    const startedAt = performance.now();
    const opId = allocateOpId();
    recordPerfStart('referenceMaterialize', opId);
    let ok = false;
    try {
      const { hydrated } = await hydrateReferenceView(entries, signal);
      const parsedModels = entries.map((entry, index) => ({
        filePath: entry.file.path,
        source: entry.file.content,
        serializedModelJson: entry.json,
        model: hydrated[index]!.model
      }));
      ok = true;
      return { ...view, parsedModels, models: hydrated.map((entry) => entry.model) };
    } finally {
      recordPerf({
        op: 'referenceMaterialize',
        ok,
        opId,
        durationMs: performance.now() - startedAt,
        ts: performance.now()
      });
    }
  },
  { op: 'materializeProjectReferenceView', capture: 0 }
);
