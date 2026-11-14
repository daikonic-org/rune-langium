// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { BenchmarkSeriesSchema } from '@rune-langium/project-runtime/market-data';
import {
  benchmarkDatasetCatalog,
  createBenchmarkSelection,
  listBenchmarkRuns,
  listBenchmarkSnapshots,
  queryBenchmarkObservations,
  readCatalogSnapshot,
  CatalogWindow
} from './catalog/catalog.js';
import { jsonResponse } from '@rune-langium/worker-core/http';
import { d1BenchmarkDatabase, r2BenchmarkArtifacts } from './storage.js';

/** The public service has no ingest endpoint, arbitrary object lookup, SQL endpoint or source-fetch capability. */
export async function handleBenchmarkRead(request: Request, env: Env): Promise<Response> {
  const reply = (status: number, body: unknown, immutable = false) =>
    jsonResponse(status, body, {
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
  if (request.method !== 'GET') return jsonResponse(405, { error: 'GET required.' }, { Allow: 'GET' });
  const url = new URL(request.url),
    params = url.searchParams;
  const db = d1BenchmarkDatabase(env.DB),
    artifacts = r2BenchmarkArtifacts(env.ARTIFACTS);
  try {
    if (url.pathname === '/market-data/datasets')
      return reply(200, { schemaVersion: 1, datasets: benchmarkDatasetCatalog() });
    if (url.pathname === '/market-data/runs')
      return reply(200, { runs: await listBenchmarkRuns(db, Number(params.get('limit') ?? 20)) });
    const snapshot = /^\/market-data\/snapshots\/([a-f0-9]{64})$/.exec(url.pathname);
    if (snapshot?.[1]) {
      const data = await readCatalogSnapshot(db, artifacts, snapshot[1]);
      return data ? reply(200, data, true) : reply(404, { error: 'Snapshot not found.' });
    }
    if (url.pathname === '/market-data/selection') {
      const series = z
        .array(BenchmarkSeriesSchema)
        .min(1)
        .max(6)
        .refine((values) => new Set(values).size === values.length)
        .parse((params.get('series') ?? BenchmarkSeriesSchema.options.join(',')).split(','));
      const window = CatalogWindow.parse({ startDate: params.get('start'), endDate: params.get('end') });
      return reply(200, await createBenchmarkSelection(db, series, window));
    }
    const seriesPath = /^\/market-data\/series\/([^/]+)\/(observations|snapshots)$/.exec(url.pathname);
    if (seriesPath) {
      const series = BenchmarkSeriesSchema.parse(seriesPath[1]);
      if (seriesPath[2] === 'snapshots')
        return reply(200, {
          snapshots: await listBenchmarkSnapshots(
            db,
            series,
            params.has('before') ? Number(params.get('before')) : undefined,
            Number(params.get('limit') ?? 50)
          )
        });
      const window = CatalogWindow.parse({ startDate: params.get('start'), endDate: params.get('end') });
      const data = await queryBenchmarkObservations(db, series, window, {
        generation: params.has('generation') ? Number(params.get('generation')) : undefined,
        after: params.get('after') ?? undefined,
        limit: Number(params.get('limit') ?? 366)
      });
      return reply(200, data);
    }
    return reply(404, { error: 'Market-data route not found.' });
  } catch (error) {
    if (error instanceof z.ZodError) return reply(400, { error: 'Invalid market-data query.' });
    console.error('market-data.read.failed');
    return reply(503, { error: 'Market-data catalog unavailable.' });
  }
}

export default { fetch: handleBenchmarkRead } satisfies ExportedHandler<Env>;
