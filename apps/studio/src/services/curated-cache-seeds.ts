// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { withInstrumentation } from './instrumentation/core.js';
import { z } from 'zod';
import { CuratedModelIdSchema } from '@rune-langium/curated-schema';
import { curatedArtifactIdentity } from './curated-artifact-identity.js';
import type { CuratedDocument } from './curated-fetch.js';

const SeedSchema = z
  .object({
    key: z.string().max(1024),
    bundleId: CuratedModelIdSchema,
    version: z.string().min(1).max(256),
    namespace: z.string().min(1).max(256)
  })
  .refine((seed) => {
    const identity = curatedArtifactIdentity(seed.key);
    // The manifest owns this mapping; publisher-sanitized filenames can differ
    // from their namespace (for example FpML's trailing-dot namespace).
    return identity?.bundleId === seed.bundleId;
  });

export type CuratedCacheSeed = z.infer<typeof SeedSchema>;

/** Only immutable, public manifest metadata crosses the cache-worker boundary. */
export const parseCuratedCacheSeeds = withInstrumentation(
  function parseCuratedCacheSeeds(value: unknown): CuratedCacheSeed[] {
    const result = z.array(SeedSchema).max(512).safeParse(value);
    return result.success ? result.data : [];
  },
  { op: 'parseCuratedCacheSeeds', level: 'trace', capture: 0 }
);

/** Canonical parser transport for both server hydration and background cache fills. */
export const curatedHydrationDocuments = withInstrumentation(
  function curatedHydrationDocuments(documents: CuratedDocument[], bundleId: string) {
    return documents.map((doc) => ({ ...doc, content: '', sourceLoaded: false, bundleId }));
  },
  { op: 'curatedHydrationDocuments', level: 'trace', capture: 0 }
);

export type CuratedCacheMessage =
  | { type: 'seed'; seeds: CuratedCacheSeed[] }
  | { type: 'foreground'; active: boolean }
  | { type: 'dispose' };
