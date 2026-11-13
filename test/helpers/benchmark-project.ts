// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { createCuratedRuneProject } from './curated-rune-project.js';
import { marketDirectory, marketIndex } from './cdm-market-observations.js';
import { benchmarkFetch, benchmarkWindow } from './benchmark-feeds.js';
import {
  BENCHMARK_SERIES,
  BenchmarkSeriesSchema,
  fetchBenchmarkSnapshot,
  renderBenchmarkProvider,
  type BenchmarkSeries
} from '../../packages/project-runtime/src/market-data.js';

/** Publish/install the same pinned model and materialized provider for target and managed-worker checks. */
export async function createBenchmarkProject(saved?: readonly unknown[]) {
  const snapshots =
    saved ??
    (await Promise.all(
      BenchmarkSeriesSchema.options.map((series) =>
        fetchBenchmarkSnapshot(series, benchmarkWindow, { fetcher: benchmarkFetch })
      )
    ));
  return createCuratedRuneProject(marketDirectory, {
    uri: 'file:///model/benchmark.rosetta',
    content: await renderBenchmarkProvider(snapshots)
  });
}

export function benchmarkIndex(series: BenchmarkSeries, tenor?: { period: string; periodMultiplier: number }) {
  const original = marketIndex({ id: 'benchmark', function: 'GetMarketRates', dates: [], index: 'sofr' });
  return {
    floatingRateIndex: {
      ...original.floatingRateIndex,
      floatingRateIndex: { value: BENCHMARK_SERIES[series].cdmCode, meta: {} },
      indexTenor: tenor
    }
  };
}
