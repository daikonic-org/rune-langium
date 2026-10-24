// @instrumentation-codemod-applied
// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { createRuneDslServices, hydrateModelDocuments, namespaceFromModelName } from '@rune-langium/core';
import { projectSourcePaths } from '@rune-langium/project-config';
import { EmptyFileSystem } from 'langium';
import { projectReferenceUri } from '@rune-langium/project-runtime/context';
import type { ProjectRuntimeInput } from './project-runtime-input.js';
import type { WorkspaceState } from '../shell/providers/workspace-context.js';
import type { HydrateRequest } from '../workers/parser-worker.js';
import { pathToUri } from '../utils/uri.js';
import { withInstrumentation } from './instrumentation/core.js';

export const prepareProjectReferenceView = withInstrumentation(
  async function prepareProjectReferenceView(
    input: ProjectRuntimeInput,
    state: WorkspaceState,
    install: (documents: HydrateRequest['documents']) => Promise<void>,
    signal: AbortSignal
  ): Promise<WorkspaceState> {
    const sources = new Set(projectSourcePaths(input.snapshot.files, input.snapshot.project.build.sources));
    const files = state.files.filter(
      (file) => (!file.readOnly && !file.refOnly && sources.has(file.path)) || file.path.startsWith('system://')
    );
    const referencePaths = new Map<string, string>();
    for (const entry of input.referenceDocuments) {
      if (!entry.serialized) throw new Error('Locked semantic document is unavailable: ' + entry.uri);
      const path = projectReferenceUri(entry.uri).slice('file:///'.length);
      referencePaths.set(path, entry.uri);
      files.push({
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
    const original = new Map(state.parsedModels.map((entry) => [entry.filePath, entry]));
    const entries = files.map((file) => {
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
    const hydrated = hydrateModelDocuments(services, entries);
    const documents: HydrateRequest['documents'] = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!,
        root = hydrated[i]!;
      const descriptions = await services.RuneDsl.references.ScopeComputation.collectExportedSymbols(root.document);
      signal.throwIfAborted();
      documents.push({
        uri: entry.uri,
        content: entry.file.content,
        serializedModel: entry.json,
        exports: descriptions.map(({ name, type, path }) => ({ name, type, path }))
      });
    }
    signal.throwIfAborted();
    await install(documents);
    signal.throwIfAborted();
    return {
      ...state,
      files: files.map((file, index) =>
        file.refOnly ? { ...file, namespace: namespaceFromModelName(hydrated[index]!.model.name ?? '') ?? '' } : file
      ),
      models: hydrated.map((entry) => entry.model),
      parsedModels: hydrated.map((entry, index) => ({
        filePath: entries[index]!.file.path,
        model: entry.model,
        source: entries[index]!.file.content,
        serializedModelJson: entries[index]!.json
      })),
      deferredExports: hydrated.map((entry, index) => ({
        filePath: referencePaths.get(entries[index]!.file.path) ?? entries[index]!.file.path,
        namespace: namespaceFromModelName(entry.model.name ?? '') ?? '',
        exports: entry.model.elements.flatMap((node) =>
          'name' in node && typeof node.name === 'string' ? [{ type: node.$type, name: node.name }] : []
        )
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
