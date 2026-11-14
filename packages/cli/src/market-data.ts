// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  BenchmarkSeriesSchema,
  fetchBenchmarkSnapshot,
  readBenchmarkSnapshot,
  renderBenchmarkProvider,
  fetchBenchmarkSelection,
  benchmarkSnapshotId
} from '@rune-langium/project-runtime/market-data';

export interface MarketDataCommandOptions {
  start: string;
  end: string;
  output: string;
  series?: string[];
  json?: boolean;
  catalog?: string;
}

/** Fetch all selected series before creating an exclusive output directory; never replace project work. */
export async function runMarketData(options: MarketDataCommandOptions): Promise<number> {
  try {
    const series = (options.series ?? BenchmarkSeriesSchema.options).map((name) => BenchmarkSeriesSchema.parse(name));
    if (!series.length || new Set(series).size !== series.length) throw new Error('Choose distinct benchmark series.');
    const directory = resolve(options.output);
    const exists = await lstat(directory).then(
      () => true,
      (error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
        throw error;
      }
    );
    if (exists) throw new Error('Benchmark output already exists; choose a new directory.');
    const catalog = options.catalog
      ? await fetchBenchmarkSelection(options.catalog, series, { startDate: options.start, endDate: options.end })
      : undefined;
    const inputs =
      catalog?.snapshots ??
      (await Promise.all(
        series.map((name) => fetchBenchmarkSnapshot(name, { startDate: options.start, endDate: options.end }))
      ));
    const snapshots = await Promise.all(inputs.map(async (input) => (await readBenchmarkSnapshot(input)).snapshot));
    const source = catalog?.source ?? (await renderBenchmarkProvider(snapshots));
    await mkdir(dirname(directory), { recursive: true });
    await mkdir(directory);
    for (const snapshot of snapshots)
      await writeFile(
        resolve(
          directory,
          catalog ? `snapshot-${await benchmarkSnapshotId(snapshot)}.json` : `${snapshot.series}.json`
        ),
        JSON.stringify(snapshot, null, 2) + '\n',
        {
          flag: 'wx'
        }
      );
    await writeFile(resolve(directory, 'market-observations.rosetta'), source, { flag: 'wx' });
    if (catalog)
      await writeFile(resolve(directory, 'selection.json'), JSON.stringify(catalog.selection, null, 2) + '\n', {
        flag: 'wx'
      });
    const result = {
      status: 'success',
      directory,
      provider: 'market-observations.rosetta',
      ...(catalog ? { selection: 'selection.json' } : {}),
      series: catalog
        ? catalog.selection.datasets.map((dataset) => ({
            series: dataset.series,
            observations: dataset.snapshots.reduce((count, member) => count + member.dates.length, 0),
            generation: dataset.generation,
            snapshots: dataset.snapshots.map((member) => member.id)
          }))
        : await Promise.all(
            snapshots.map(async (snapshot) => ({
              series: snapshot.series,
              observations: (await readBenchmarkSnapshot(snapshot)).observations.length,
              sha256: snapshot.source.sha256
            }))
          )
    };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Saved ${snapshots.length} benchmark snapshots and Rune provider to ${directory}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Benchmark acquisition failed.';
    if (options.json) console.log(JSON.stringify({ status: 'failed', message }));
    else console.error(message);
    return 1;
  }
}
