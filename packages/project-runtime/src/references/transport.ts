// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import {
  CURATED_MIRROR_BASE,
  CURATED_MODEL_IDS,
  CuratedManifestSchema,
  validateReferenceCatalog
} from '@rune-langium/curated-schema';
import { ReferenceFailure, type ReferenceTransport } from './types.js';
export type ReferenceFetcher = (url: string, init?: RequestInit) => Promise<Response>;
/** Hosts inject authenticated/service-binding fetchers; locked URLs stay on the configured mirror. */
export function createReferenceTransport(
  fetcher: ReferenceFetcher = fetch,
  baseUrl = CURATED_MIRROR_BASE
): ReferenceTransport {
  const base = new URL(baseUrl);
  const checked = (input: string) => {
    const url = new URL(input);
    if (
      url.origin !== base.origin ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/curated\/[^/]+\/artifacts\//.test(url.pathname)
    )
      throw new ReferenceFailure('REFERENCE_URL', 'Reference artifact is outside the configured immutable mirror.');
    return url.href;
  };
  return {
    async nightly(id, signal) {
      if (!(CURATED_MODEL_IDS as readonly string[]).includes(id))
        throw new ReferenceFailure('REFERENCE_NIGHTLY_UNAVAILABLE', 'Unknown Nightly model: ' + id);
      signal.throwIfAborted();
      const response = await fetcher(new URL(`/curated/${id}/manifest.json`, base).href, { signal, cache: 'no-store' });
      signal.throwIfAborted();
      if (!response.ok)
        throw new ReferenceFailure(
          'REFERENCE_NIGHTLY_UNAVAILABLE',
          `Nightly mirror unavailable: ${id} (HTTP ${response.status})`
        );
      const manifest = CuratedManifestSchema.parse(await response.json());
      signal.throwIfAborted();
      if (manifest.modelId !== id)
        throw new ReferenceFailure('REFERENCE_NIGHTLY_UNAVAILABLE', 'Nightly model identity mismatch: ' + id);
      return manifest;
    },
    async catalog(id, signal) {
      signal.throwIfAborted();
      const response = await fetcher(new URL('/releases/' + encodeURIComponent(id), base).href, { signal });
      signal.throwIfAborted();
      if (!response.ok)
        throw new ReferenceFailure(
          'REFERENCE_RELEASE_UNAVAILABLE',
          `Release catalog unavailable: ${id} (HTTP ${response.status})`
        );
      const catalog = validateReferenceCatalog(await response.json());
      signal.throwIfAborted();
      return catalog;
    },
    async artifact(url, signal) {
      signal.throwIfAborted();
      const response = await fetcher(checked(url), { signal, headers: { 'Accept-Encoding': 'identity' } });
      if (!response.ok)
        throw new ReferenceFailure(
          'REFERENCE_ARTIFACT_UNAVAILABLE',
          `Reference artifact unavailable (HTTP ${response.status})`
        );
      const bytes = new Uint8Array(await response.arrayBuffer());
      signal.throwIfAborted();
      return bytes;
    }
  };
}
