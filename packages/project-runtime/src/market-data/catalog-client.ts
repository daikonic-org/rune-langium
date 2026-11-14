// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { BenchmarkSeriesSchema, renderBenchmarkSelection } from '../market-data.js';
import { readStreamBytes } from '../read-stream.js';
import { BenchmarkSelectionSchema, benchmarkSnapshotId, CatalogWindow } from './selection.js';

/** Explicit acquisition only: the manifest pins both the capture IDs and the chosen dates within them. */
export async function fetchBenchmarkSelection(
  origin: string,
  series: string[],
  window: { startDate: string; endDate: string },
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {}
) {
  const base = new URL(origin);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol !== 'https:' &&
      !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)))
  )
    throw new Error('Use an HTTPS catalog origin or a local development origin.');
  if (!['/', '/market-data', '/market-data/'].includes(base.pathname))
    throw new Error('Use the catalog origin, without a nested path.');
  z.array(BenchmarkSeriesSchema).min(1).max(6).parse(series);
  if (new Set(series).size !== series.length) throw new Error('Choose distinct benchmark series.');
  CatalogWindow.parse(window);
  let bytesRead = 0;
  const json = async (path: string, maxBytes: number): Promise<unknown> => {
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000);
    const response = await (options.fetcher ?? fetch)(new URL(path, base.origin), {
      signal,
      redirect: 'error',
      credentials: 'omit',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok || !response.body) throw new Error(`Catalog acquisition failed (${response.status}).`);
    const bytes = await readStreamBytes(response.body, maxBytes, 'Catalog response exceeds its size limit.');
    bytesRead += bytes.byteLength;
    if (bytesRead > 64 * 1024 * 1024) throw new Error('Catalog selection exceeds 64 MiB; choose a smaller window.');
    return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes));
  };
  const query = new URLSearchParams({ series: series.join(','), start: window.startDate, end: window.endDate });
  const selection = BenchmarkSelectionSchema.parse(await json(`/market-data/selection?${query}`, 1024 * 1024));
  if (
    selection.window.startDate !== window.startDate ||
    selection.window.endDate !== window.endDate ||
    selection.datasets.length !== series.length ||
    new Set(selection.datasets.map((d) => d.series)).size !== series.length ||
    selection.datasets.some((d) => !series.includes(d.series))
  )
    throw new Error('Catalog selection differs from the requested identities/window.');
  const snapshots: unknown[] = [];
  const ids = new Set(selection.datasets.flatMap((dataset) => dataset.snapshots.map((snapshot) => snapshot.id)));
  for (const id of ids) {
    const snapshot = await json(`/market-data/snapshots/${id}`, 16 * 1024 * 1024);
    if ((await benchmarkSnapshotId(snapshot)) !== id) throw new Error('Catalog snapshot identity mismatch.');
    snapshots.push(snapshot);
  }
  const source = await renderBenchmarkSelection(selection, snapshots);
  return { selection, snapshots, source };
}
