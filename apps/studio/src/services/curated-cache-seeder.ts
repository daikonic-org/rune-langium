// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from './instrumentation/core.js';
import { curatedArtifactCache } from './curated-artifact-cache.js';
import { curatedArtifactIdentity } from './curated-artifact-identity.js';
import { fetchCuratedNamespace } from './curated-fetch.js';
import { curatedHydrationDocuments, parseCuratedCacheSeeds, type CuratedCacheSeed } from './curated-cache-seeds.js';

const FOREGROUND_LEASE_MS = 15_000;

/** One bounded download queue shared by all connected tabs; no Langium/workspace state. */
export const createCuratedCacheSeeder = withInstrumentation(
  function createCuratedCacheSeeder(
    options: {
      cache?: Pick<typeof curatedArtifactCache, 'documentKeys' | 'seedDocuments'>;
      fetchNamespace?: typeof fetchCuratedNamespace;
      delayMs?: number;
    } = {}
  ) {
    const cache = options.cache ?? curatedArtifactCache;
    const fetchNamespace = options.fetchNamespace ?? fetchCuratedNamespace;
    const delay = options.delayMs ?? 1500;
    const clients = new Map<number, { seeds: CuratedCacheSeed[]; foregroundUntil: number }>();
    const finished = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let stopped = false;
    let storageFull = false;
    let active: { seed: CuratedCacheSeed; abort: AbortController } | undefined;

    function schedule() {
      if (timer) clearTimeout(timer);
      if (stopped || storageFull || running || clients.size === 0) return;
      timer = setTimeout(() => {
        timer = undefined;
        void run();
      }, delay);
    }

    function reconcile() {
      const keys = new Set([...clients.values()].flatMap((client) => client.seeds.map((seed) => seed.key)));
      for (const key of finished) if (!keys.has(key)) finished.delete(key);
      if (active && !keys.has(active.seed.key)) active.abort.abort();
      schedule();
    }

    async function run() {
      if (stopped || storageFull || running) return;
      if ([...clients.values()].some((client) => client.foregroundUntil > Date.now())) {
        schedule();
        return;
      }
      const queue = [...clients.values()].flatMap((client) => client.seeds);
      const first = queue.find((candidate) => !finished.has(candidate.key));
      if (!first) return;
      let seed = first;
      const abort = new AbortController();
      active = { seed, abort };
      running = true;
      try {
        const known = await cache.documentKeys();
        if (abort.signal.aborted) return;
        const stored = new Set(known);
        for (const candidate of queue) if (stored.has(candidate.key)) finished.add(candidate.key);
        const next = queue.find((candidate) => !finished.has(candidate.key));
        if (!next) return;
        seed = next;
        active = { seed, abort };
        const identity = curatedArtifactIdentity(seed.key)!;
        const documents = await fetchNamespace(
          seed.bundleId,
          seed.version,
          identity.artifact,
          (url, init) =>
            fetch(url, { ...init, signal: AbortSignal.any([abort.signal, ...(init?.signal ? [init.signal] : [])]) }),
          { retain: false }
        );
        if (abort.signal.aborted) return;
        // Drop the decompressed response after its atomic write. Prefetch never
        // populates per-tab documents or retains the corpus in a second JS cache.
        const hydrated = curatedHydrationDocuments(
          documents.map((doc) => ({ ...doc, artifactKey: seed.key, namespace: seed.namespace })),
          seed.bundleId
        );
        if (!(await cache.seedDocuments(seed.key, hydrated))) storageFull = true;
        else finished.add(seed.key);
      } catch {
        // Interrupted foreground work can retry; other failures wait for a new worker.
        if (!abort.signal.aborted) finished.add(seed.key);
      } finally {
        active = undefined;
        running = false;
        schedule();
      }
    }

    return {
      seed(clientId: number, value: unknown) {
        const seeds = parseCuratedCacheSeeds(value);
        const existing = clients.get(clientId);
        clients.set(clientId, { seeds, foregroundUntil: existing?.foregroundUntil ?? 0 });
        reconcile();
      },
      foreground(clientId: number, foreground: boolean) {
        const client = clients.get(clientId) ?? { seeds: [], foregroundUntil: 0 };
        client.foregroundUntil = foreground ? Date.now() + FOREGROUND_LEASE_MS : 0;
        clients.set(clientId, client);
        if (foreground) active?.abort.abort();
        schedule();
      },
      disconnect(clientId: number) {
        clients.delete(clientId);
        reconcile();
      },
      close() {
        stopped = true;
        if (timer) clearTimeout(timer);
        active?.abort.abort();
        clients.clear();
      }
    };
  },
  { op: 'createCuratedCacheSeeder', level: 'trace', capture: 0 }
);
