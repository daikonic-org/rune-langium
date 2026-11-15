// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { astToModel, type TypeGraphNode } from '@rune-langium/visual-editor';
import { curatedArtifactCache } from './curated-artifact-cache.js';
import { curatedArtifactIdentity } from './curated-artifact-identity.js';
import { curatedCacheClient } from './curated-cache-client.js';
import { curatedHydrationDocuments, parseCuratedCacheSeeds, type CuratedCacheSeed } from './curated-cache-seeds.js';
import { fetchCuratedNamespace } from './curated-fetch.js';
import { inspectCuratedNamespace } from './workspace.js';
import { projectReferenceUri } from '@rune-langium/project-runtime/context';
import type { ReferenceDocument } from '@rune-langium/project-runtime/references';
import { readCuratedDeclarationModels } from './curated-declaration-models.js';
import { withInstrumentation } from './instrumentation/core.js';

export type CuratedDeclarationSource =
  | CuratedCacheSeed
  | { namespace: string; documents: Parameters<typeof inspectCuratedNamespace>[0] };

// Bound foreground work; large namespaces retain the ordinary worker/linking path.
const MAX_CAPTURED_DECLARATION_CHARACTERS = 2_000_000;

/** Read only the verified documents already owned by the managed reference capture. */
export const capturedDeclarationSource = withInstrumentation(
  function capturedDeclarationSource(
    references: readonly ReferenceDocument[],
    namespace: string
  ): CuratedDeclarationSource | undefined {
    const selected = references.filter((document) => document.lsp?.metadata.namespace === namespace);
    if (
      selected.reduce((total, document) => total + (document.serialized?.length ?? 0), 0) >
      MAX_CAPTURED_DECLARATION_CHARACTERS
    )
      return undefined;
    const documents = selected.flatMap((document) =>
      document.serialized ? [{ uri: projectReferenceUri(document.uri), serializedModel: document.serialized }] : []
    );
    return documents.length && documents.length === selected.length ? { namespace, documents } : undefined;
  },
  { op: 'capturedDeclarationSource', capture: 0 }
);

/** Read one namespace without publishing any partial workspace state. */
export const loadCuratedDeclarations = withInstrumentation(
  async function loadCuratedDeclarations(
    source: CuratedDeclarationSource,
    signal: AbortSignal
  ): Promise<TypeGraphNode[]> {
    if (!('documents' in source) && parseCuratedCacheSeeds([source]).length !== 1) return [];
    const release = curatedCacheClient.foreground();
    try {
      const project = async (documents: Parameters<typeof inspectCuratedNamespace>[0]) => {
        signal.throwIfAborted();
        const models = await ('documents' in source
          ? readCuratedDeclarationModels(documents)
          : inspectCuratedNamespace(documents));
        signal.throwIfAborted();
        return astToModel(models.filter((model) => model.name === source.namespace)).nodes;
      };
      if ('documents' in source) return await project(source.documents);
      const seed = source;
      const stored = await curatedArtifactCache.documents(seed.key);
      if (stored?.every((doc) => doc.bundleId === seed.bundleId && doc.namespace === seed.namespace)) {
        try {
          const nodes = await project(stored);
          if (nodes.length) return nodes;
        } catch {
          signal.throwIfAborted();
          // A corrupt cache entry must not prevent the ordinary network read.
        }
      }
      signal.throwIfAborted();
      const identity = curatedArtifactIdentity(seed.key)!;
      const documents = curatedHydrationDocuments(
        (
          await fetchCuratedNamespace(
            seed.bundleId,
            seed.version,
            identity.artifact,
            (url, init) =>
              fetch(url, { ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) }),
            { retain: false }
          )
        ).map((doc) => ({ ...doc, namespace: seed.namespace, artifactKey: seed.key })),
        seed.bundleId
      );
      const nodes = await project(documents);
      if (nodes.length) void curatedArtifactCache.seedDocuments(seed.key, documents);
      return nodes;
    } finally {
      release();
    }
  },
  { op: 'loadCuratedDeclarations', capture: 0 }
);
