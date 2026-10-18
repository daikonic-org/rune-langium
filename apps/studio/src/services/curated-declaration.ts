// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { astToModel, type TypeGraphNode } from '@rune-langium/visual-editor';
import { curatedArtifactCache } from './curated-artifact-cache.js';
import { curatedArtifactIdentity } from './curated-artifact-identity.js';
import { curatedCacheClient } from './curated-cache-client.js';
import { curatedHydrationDocuments, parseCuratedCacheSeeds, type CuratedCacheSeed } from './curated-cache-seeds.js';
import { fetchCuratedNamespace } from './curated-fetch.js';
import { inspectCuratedNamespace } from './workspace.js';
import { withInstrumentation } from './instrumentation/core.js';

/** Read one pinned namespace without publishing any partial workspace state. */
export const loadCuratedDeclaration = withInstrumentation(
  async function loadCuratedDeclaration(
    seed: CuratedCacheSeed,
    nodeId: string,
    signal: AbortSignal
  ): Promise<TypeGraphNode | undefined> {
    if (parseCuratedCacheSeeds([seed]).length !== 1) return undefined;
    const release = curatedCacheClient.foreground();
    try {
      const project = async (documents: Parameters<typeof inspectCuratedNamespace>[0]) => {
        signal.throwIfAborted();
        const models = await inspectCuratedNamespace(documents);
        signal.throwIfAborted();
        return astToModel(models.filter((model) => model.name === seed.namespace)).nodes.find(
          (node) => node.id === nodeId
        );
      };
      const stored = await curatedArtifactCache.documents(seed.key);
      if (stored?.every((doc) => doc.bundleId === seed.bundleId && doc.namespace === seed.namespace)) {
        try {
          const node = await project(stored);
          if (node) return node;
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
      const node = await project(documents);
      if (node) void curatedArtifactCache.seedDocuments(seed.key, documents);
      return node;
    } finally {
      release();
    }
  },
  { op: 'loadCuratedDeclaration', capture: 0 }
);
