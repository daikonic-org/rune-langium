// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { compactLspModelJson, readLspModelMetadata, closeNamespaceDependencies } from '@rune-langium/core';
import { URI } from 'langium';
import type { ParsedWorkspaceModel, WorkspaceFile } from './workspace.js';
import { pathToUri } from '../utils/uri.js';
import { expandWildcard } from './curated-closure.js';
import { withInstrumentation, Capture } from './instrumentation/core.js';

export interface LspModelCacheEntry {
  source: string;
  compact: string;
  metadata: ReturnType<typeof readLspModelMetadata>;
}
const canonicalUri = (path: string) => URI.parse(pathToUri(path)).toString();

/** Retain browser models, but send only the active namespace's semantic closure. */
export const collectLspWorkspaceModels = withInstrumentation(
  function collectLspWorkspaceModels(
    files: ReadonlyArray<WorkspaceFile>,
    parsedModels: ParsedWorkspaceModel[],
    cache: Map<string, LspModelCacheEntry>,
    activeFile?: string,
    additionalRoots: readonly string[] = []
  ): Array<{ uri: string; modelJson: string }> {
    const parsed = new Map(parsedModels.map((entry) => [entry.filePath, entry.serializedModelJson]));
    const current = new Map<string, LspModelCacheEntry>();
    const uriNamespaces = new Map<string, string>();
    for (const file of files) {
      if (file.path.startsWith('system:')) continue;
      const source = file.serializedModelJson ?? parsed.get(file.path);
      if (!source || source === '{}') continue;
      const uri = canonicalUri(file.path);
      let entry = cache.get(uri);
      if (entry?.source !== source) {
        entry = { source, compact: compactLspModelJson(source), metadata: readLspModelMetadata(source) };
        cache.set(uri, entry);
      }
      current.set(uri, entry);
      if (entry.metadata.namespace) {
        uriNamespaces.set(uri, entry.metadata.namespace);
        if (entry.metadata.sourceUri)
          uriNamespaces.set(canonicalUri(entry.metadata.sourceUri), entry.metadata.namespace);
      }
    }
    for (const uri of cache.keys()) if (!current.has(uri)) cache.delete(uri);
    const activeNamespace = activeFile ? current.get(canonicalUri(activeFile))?.metadata.namespace : undefined;
    if (!activeNamespace && !additionalRoots.length) return [];
    const allNamespaces = new Set(uriNamespaces.values());
    const deps = new Map<string, Set<string>>();
    for (const entry of current.values()) {
      const { namespace, imports, references } = entry.metadata;
      if (!namespace) continue;
      const targets = deps.get(namespace) ?? new Set<string>();
      for (const pattern of imports) for (const target of expandWildcard(pattern, allNamespaces)) targets.add(target);
      for (const reference of references) {
        const target = uriNamespaces.get(canonicalUri(reference));
        if (target) targets.add(target);
      }
      deps.set(namespace, targets);
    }
    const closure = new Set(
      [...(activeNamespace ? [activeNamespace] : []), ...additionalRoots].flatMap((namespace) => [
        ...closeNamespaceDependencies(namespace, deps)
      ])
    );
    return [...current]
      .filter(([, entry]) => entry.metadata.namespace && closure.has(entry.metadata.namespace))
      .map(([uri, entry]) => ({ uri, modelJson: entry.compact }));
  },
  {
    op: 'collectLspWorkspaceModels',
    capture: Capture.Output,
    sanitize: (value, which) => (which === 'output' ? { documentCount: (value as unknown[]).length } : undefined)
  }
);
