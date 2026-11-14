// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import {
  BenchmarkSeriesSchema,
  fetchBenchmarkSnapshot,
  readBenchmarkSnapshot
} from '@rune-langium/project-runtime/market-data';
import { CatalogWindow, BenchmarkRunSchema, publishBenchmarkSnapshot, recordBenchmarkRun } from './catalog.js';
import type { CatalogArtifacts, CatalogDatabase } from './catalog-schema.js';

/** Every admitted dataset is attempted; a failed source cannot suppress independent complete publications. */
export async function refreshBenchmarkCatalog(options: {
  db: CatalogDatabase;
  artifacts: CatalogArtifacts;
  series?: string[];
  window: { startDate: string; endDate: string };
  runId: string;
  fetcher?: typeof fetch;
  now?: () => string;
  dryRun?: boolean;
}) {
  const series = z
    .array(BenchmarkSeriesSchema)
    .min(1)
    .max(6)
    .parse(options.series ?? BenchmarkSeriesSchema.options);
  CatalogWindow.parse(options.window);
  if (new Set(series).size !== series.length) throw new Error('Choose distinct benchmark series.');
  BenchmarkRunSchema.shape.id.parse(options.runId);
  const timestamp = () => z.iso.datetime().parse(options.now?.() ?? new Date().toISOString());
  const results: z.infer<typeof BenchmarkRunSchema>[] = [];
  for (const name of series) {
    let phase: 'acquire' | 'publish' | 'complete' = 'acquire';
    try {
      const snapshot = await fetchBenchmarkSnapshot(name, options.window, { fetcher: options.fetcher, now: timestamp });
      const { observations } = await readBenchmarkSnapshot(snapshot);
      phase = 'publish';
      const publication = options.dryRun
        ? undefined
        : await publishBenchmarkSnapshot(options.db, options.artifacts, snapshot, { now: timestamp() });
      results.push(
        BenchmarkRunSchema.parse({
          id: options.runId,
          series: name,
          checkedAt: timestamp(),
          phase: 'complete',
          outcome: publication?.outcome ?? (observations.length ? 'updated' : 'empty'),
          ...(publication ? { snapshotId: publication.snapshotId } : {}),
          ...(observations.length ? { latestDate: observations.at(-1)?.date } : {})
        })
      );
    } catch {
      // Public/CI reports intentionally exclude raw SDK/source errors, URLs and credentials.
      results.push(
        BenchmarkRunSchema.parse({ id: options.runId, series: name, checkedAt: timestamp(), outcome: 'failed', phase })
      );
    }
    const result = results.at(-1);
    if (result && !options.dryRun) {
      try {
        await recordBenchmarkRun(options.db, result);
      } catch {
        result.outcome = 'failed';
        result.phase = 'publish';
      }
    }
  }
  return {
    schemaVersion: 1,
    dryRun: options.dryRun ?? false,
    window: options.window,
    checkedAt: timestamp(),
    success: results.every((result) => result.outcome !== 'failed'),
    results
  };
}
