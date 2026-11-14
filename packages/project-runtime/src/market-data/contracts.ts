// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { BenchmarkSeriesSchema } from './registry.js';

export const MAX_BYTES = 2 * 1024 * 1024;
export const windowSchema = z
  .strictObject({ startDate: z.iso.date(), endDate: z.iso.date() })
  .superRefine((window, context) => {
    const days = (Date.parse(window.endDate) - Date.parse(window.startDate)) / 86400000;
    if (days < 0 || days > 365)
      context.addIssue({ code: 'custom', message: 'Choose an ordered window of at most 366 dates.' });
  });
export const BenchmarkSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  series: BenchmarkSeriesSchema,
  window: windowSchema,
  source: z.strictObject({
    url: z.url(),
    retrievedAt: z.iso.datetime(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    lastModified: z.string().optional(),
    etag: z.string().optional()
  }),
  content: z.string().max(MAX_BYTES)
});
/** Exact saved response bytes represented as UTF-8 text; normalized observations are derived, never duplicated. */
export type BenchmarkSnapshot = z.infer<typeof BenchmarkSnapshotSchema>;
export interface BenchmarkObservation {
  date: string;
  sourceValue: string;
  value: number;
  status?: string;
  revision?: string;
}
