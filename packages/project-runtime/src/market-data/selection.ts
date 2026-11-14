// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { projectFileRevision } from '@rune-langium/project-config';
import { BenchmarkSeriesSchema } from './registry.js';
import { BenchmarkSnapshotSchema } from './contracts.js';
export const CatalogSnapshotId = z.string().regex(/^[a-f0-9]{64}$/);
const id = CatalogSnapshotId;
const date = z.iso.date();
export const CatalogWindow = BenchmarkSnapshotSchema.shape.window;
export const BENCHMARK_DECODER = 'benchmark-v1';

export const BenchmarkSelectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  decoder: z.literal(BENCHMARK_DECODER),
  window: CatalogWindow,
  datasets: z
    .array(
      z.strictObject({
        series: BenchmarkSeriesSchema,
        generation: z.number().int().nonnegative(),
        snapshots: z.array(z.strictObject({ id, dates: z.array(date).min(1).max(366) })).max(366),
        terms: z.strictObject({ url: z.url(), attribution: z.string().max(2000) })
      })
    )
    .min(1)
    .max(6)
});
export type BenchmarkSelection = z.infer<typeof BenchmarkSelectionSchema>;

export async function benchmarkSnapshotId(input: unknown): Promise<string> {
  return projectFileRevision(JSON.stringify(BenchmarkSnapshotSchema.parse(input)));
}
