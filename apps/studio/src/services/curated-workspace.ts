// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { CuratedCohortSchema, type CuratedManifest } from '@rune-langium/curated-schema';
import {
  fetchCuratedManifest,
  fetchCuratedNamespace,
  CuratedBundleUnavailableError,
  type CuratedFetcher,
  type CuratedDocument
} from './curated-fetch.js';
import { closeNamespacesFromManifest } from './curated-closure.js';
import { withInstrumentation } from './instrumentation/core.js';

class CuratedManifestMissingError extends CuratedBundleUnavailableError {}

export const curatedArtifactKey = withInstrumentation(
  function curatedArtifactKey(bundleId: string, artifact: string): string {
    return JSON.stringify([bundleId, artifact]);
  },
  { op: 'curatedArtifactKey' }
);

interface CuratedWorkspace {
  bundles: Array<{ id: string; manifest: CuratedManifest; documents: CuratedDocument[] }>;
  closure: Set<string>;
  graph: NonNullable<CuratedManifest['namespaces']>;
  artifacts: Array<{ key: string; bundleId: string; namespace: string; documentCount?: number }>;
}

/** Load one cross-bundle namespace closure before any document is hydrated. */
export const loadCuratedWorkspace = withInstrumentation(
  async function loadCuratedWorkspace(
    requestedBundles: ReadonlyArray<{ id: string; version: string }>,
    seeds: ReadonlySet<string>,
    fetcher?: CuratedFetcher,
    includeAllWhenUnseeded = false,
    knownArtifacts: ReadonlySet<string> = new Set()
  ): Promise<CuratedWorkspace> {
    const bundles = new Map(requestedBundles.map((bundle) => [bundle.id, bundle]));
    const manifests = new Map<string, CuratedManifest>();
    while (manifests.size < bundles.size) {
      const pending = [...bundles.values()].filter((bundle) => !manifests.has(bundle.id));
      // A floating root establishes the cohort before any other floating
      // pointer is read. Once pinned, independent manifests can load together.
      const firstFloatingRoot =
        manifests.size === 0 && requestedBundles.some((root) => !CuratedCohortSchema.safeParse(root.version).success);
      const wave = firstFloatingRoot ? pending.slice(0, 1) : pending;
      const fetched = await Promise.all(
        wave.map(async (bundle) => ({
          bundle,
          manifest: await fetchCuratedManifest(bundle.id, bundle.version, fetcher)
        }))
      );
      for (const { bundle, manifest } of fetched) {
        if (!manifest?.namespaces || Object.keys(manifest.namespaces).length === 0) {
          throw new CuratedManifestMissingError(bundle.id, bundle.version);
        }
        // Resolve floating roots through the first cohort encountered, including
        // explicitly loaded dependencies whose latest pointers may still be older.
        if (manifest.cohort && requestedBundles.some((root) => root.version !== manifest.cohort)) {
          if (
            requestedBundles.some(
              (root) => CuratedCohortSchema.safeParse(root.version).success && root.version !== manifest.cohort
            )
          ) {
            throw new CuratedBundleUnavailableError(
              bundle.id,
              bundle.version,
              undefined,
              new Error('Conflicting manifest cohorts')
            );
          }
          return loadCuratedWorkspace(
            requestedBundles.map((root) => ({ id: root.id, version: manifest.cohort! })),
            seeds,
            fetcher,
            includeAllWhenUnseeded,
            knownArtifacts
          );
        }
        manifests.set(bundle.id, manifest);
        for (const [id, version] of Object.entries(manifest.dependencies ?? {})) {
          const existing = bundles.get(id);
          if (
            existing &&
            existing.version !== version &&
            (CuratedCohortSchema.safeParse(existing.version).success || CuratedCohortSchema.safeParse(version).success)
          ) {
            throw new CuratedBundleUnavailableError(id, version, undefined, new Error('Conflicting bundle versions'));
          }
          if (!existing) bundles.set(id, { id, version });
        }
      }
    }
    const graph: NonNullable<CuratedManifest['namespaces']> = Object.assign(
      {},
      ...[...manifests.values()].map((manifest) => manifest.namespaces)
    );
    const roots =
      seeds.size === 0 && includeAllWhenUnseeded
        ? requestedBundles.flatMap((bundle) => Object.keys(manifests.get(bundle.id)!.namespaces!))
        : seeds;
    const closure = closeNamespacesFromManifest(roots, graph);
    const loaded: CuratedWorkspace['bundles'] = [...manifests].map(([id, manifest]) => ({
      id,
      manifest,
      documents: []
    }));
    const artifacts: CuratedWorkspace['artifacts'] = [];
    const jobs: Array<{
      bundle: (typeof loaded)[number];
      namespace: string;
      artifact: string;
      key: string;
      reference: CuratedWorkspace['artifacts'][number];
    }> = [];
    for (const bundle of loaded) {
      for (const namespace of closure) {
        const artifact = bundle.manifest.namespaces?.[namespace]?.artifact;
        if (!artifact) continue;
        const key = curatedArtifactKey(bundle.id, artifact);
        const reference = { key, bundleId: bundle.id, namespace };
        artifacts.push(reference);
        if (!knownArtifacts.has(key)) jobs.push({ bundle, namespace, artifact, key, reference });
      }
    }
    // Fill each freed slot immediately, but publish in manifest/closure order.
    const fetched: CuratedDocument[][] = [];
    let next = 0;
    let failed = false;
    await Promise.all(
      Array.from({ length: Math.min(8, jobs.length) }, async () => {
        while (!failed) {
          const index = next++;
          const job = jobs[index];
          if (!job) return;
          try {
            fetched[index] = await fetchCuratedNamespace(
              job.bundle.id,
              bundles.get(job.bundle.id)!.version,
              job.artifact,
              fetcher
            );
          } catch (error) {
            failed = true;
            throw error;
          }
        }
      })
    );
    for (const [index, job] of jobs.entries()) {
      job.reference.documentCount = fetched[index]!.length;
      job.bundle.documents.push(
        ...fetched[index]!.map((doc) => ({ ...doc, artifactKey: job.key, namespace: job.namespace }))
      );
    }
    return { bundles: loaded, closure, graph, artifacts };
  },
  { op: 'loadCuratedWorkspace' }
);

export const curatedWorkspaceErrorResponse = withInstrumentation(
  function curatedWorkspaceErrorResponse(error: unknown): Response | undefined {
    if (!(error instanceof CuratedBundleUnavailableError)) return undefined;
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof CuratedManifestMissingError ? 'curated_manifest_missing' : 'curated_bundle_unavailable',
        bundleId: error.bundleId,
        version: error.version,
        upstreamStatus: error.status
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  },
  { op: 'curatedWorkspaceErrorResponse' }
);
