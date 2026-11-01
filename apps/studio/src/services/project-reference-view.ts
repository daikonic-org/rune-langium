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
import type { WorkspaceFile } from './workspace.js';

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
    signal: AbortSignal
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
    const services = createRuneDslServices(EmptyFileSystem);
    // Current worker-decoded publications already carry the canonical index. Only
    // legacy entries missing it require reconstruction here.
    const fallback = entries.filter((entry) => {
      const info = referenceInfo.get(entry.uri);
      return !info || !info.exports || !info.lsp;
    });
    const hydrated = hydrateModelDocuments(services, fallback);
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
        ...(entry.file.refOnly ? { bundleId: entry.file.bundleId } : {})
      });
      signal.throwIfAborted();
    }
    await install(documents);
    signal.throwIfAborted();
    const namespace = (uri: string) =>
      referenceInfo.get(uri)?.lsp?.metadata.namespace ?? namespaceFromModelName(roots.get(uri)?.model.name ?? '') ?? '';
    return {
      ...state,
      files: files.map((file) => (file.refOnly ? { ...file, namespace: namespace(pathToUri(file.path)) } : file)),
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
  },
  {
    op: 'prepareProjectReferenceView',
    capture: 0,
    sanitizeError: (e) => ({ signature: e instanceof Error ? e.name : 'Error' })
  }
);

/** UI consumers require linked ASTs; revive only the worker's materialized closure. */
export const materializeProjectReferenceView = withInstrumentation(
  function materializeProjectReferenceView(
    view: WorkspaceState,
    additions: readonly import('@rune-langium/core').RosettaModel[]
  ): WorkspaceState {
    const canonical = (uri: string) => URI.parse(uri).toString();
    const files = new Map(view.files.map((file) => [canonical(pathToUri(file.path)), file]));
    const parsed = new Map(view.parsedModels.map((entry) => [entry.filePath, entry]));
    const wanted = new Set(parsed.keys());
    for (const model of additions) {
      const uri = (model as unknown as { $textRegion?: { documentURI?: string } }).$textRegion?.documentURI;
      const file = uri && files.get(canonical(uri));
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
    const hydrated = hydrateModelDocuments(createRuneDslServices(EmptyFileSystem), entries);
    const parsedModels = entries.map((entry, index) => ({
      filePath: entry.file.path,
      source: entry.file.content,
      serializedModelJson: entry.json,
      model: hydrated[index]!.model
    }));
    return { ...view, parsedModels, models: hydrated.map((entry) => entry.model) };
  },
  { op: 'materializeProjectReferenceView', capture: 0 }
);
