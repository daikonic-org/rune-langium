// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { CuratedCohortSchema, CuratedSha256Schema } from './artifact-identity.js';
const text = z.string().min(1);
export const ReferenceReleaseSchema = z
  .object({
    modelId: text,
    repository: z.url().refine((value) => value.startsWith('https://'), 'Repository must use HTTPS.'),
    tag: text,
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    manifest: z.url(),
    cohort: CuratedCohortSchema,
    checksum: CuratedSha256Schema,
    dependencies: z.record(text, z.object({ modelId: text, release: text })),
    toolchain: text
  })
  .superRefine((release, ctx) => {
    const url = release.manifest;
    if (
      !url.startsWith('https://') ||
      !url.endsWith(`/curated/${release.modelId}/artifacts/${release.cohort}/manifest.json`) ||
      /[?#]/.test(url)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['manifest'],
        message: 'Release manifest must identify its immutable model cohort.'
      });
    for (const [key, dependency] of Object.entries(release.dependencies))
      if (key !== dependency.modelId)
        ctx.addIssue({
          code: 'custom',
          path: ['dependencies', key],
          message: 'Dependency key must equal its model identity.'
        });
  });
export const ReferenceCatalogSchema = z
  .object({ schemaVersion: z.literal(1), releases: z.array(ReferenceReleaseSchema) })
  .superRefine((catalog, ctx) => {
    const seen = new Set<string>();
    catalog.releases.forEach((release, index) => {
      const key = JSON.stringify([release.modelId, release.repository, release.tag]);
      if (seen.has(key))
        ctx.addIssue({ code: 'custom', path: ['releases', index], message: 'Ambiguous duplicate release mapping.' });
      seen.add(key);
    });
  });
export type ReferenceRelease = z.infer<typeof ReferenceReleaseSchema>;
export type ReferenceCatalog = z.infer<typeof ReferenceCatalogSchema>;
export function validateReferenceCatalog(input: unknown): ReferenceCatalog {
  return ReferenceCatalogSchema.parse(input);
}
