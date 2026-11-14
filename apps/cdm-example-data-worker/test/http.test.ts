// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { z } from 'zod';
import { projectFileRevision } from '@rune-langium/project-config';
import { handleBenchmarkRead } from '../src/index.js';
import { d1BenchmarkDatabase, r2BenchmarkArtifacts } from '../src/storage.js';
import { publishBenchmarkSnapshot } from '../src/catalog/catalog.js';
import {
  fetchBenchmarkSelection,
  fetchBenchmarkSnapshot,
  BenchmarkSeriesSchema
} from '@rune-langium/project-runtime/market-data';
import { benchmarkFetch, benchmarkWindow } from '../../../test/helpers/benchmark-feeds.js';

const mf = new Miniflare(
  convertV4MiniflareOptions({
    port: 0,
    workers: [
      {
        name: 'test',
        modules: [
          { type: 'ESModule', path: 'worker.js', contents: 'export default {fetch(){return new Response("test")}}' }
        ],
        compatibilityDate: '2026-11-13',
        d1Databases: ['DB'],
        r2Buckets: ['ARTIFACTS']
      }
    ]
  })
);
let env: Env;
beforeAll(async () => {
  env = await mf.getBindings<Env>('test');
  for (const migration of readMigrationFiles({
    migrationsFolder: fileURLToPath(new NodeURL('../migrations', import.meta.url))
  }))
    await env.DB.batch(migration.sql.map((sql) => env.DB.prepare(sql)));
  for (const series of BenchmarkSeriesSchema.options) {
    const snapshot = await fetchBenchmarkSnapshot(series, benchmarkWindow, {
      fetcher: benchmarkFetch,
      now: () => '2026-11-13T12:00:00.000Z'
    });
    await publishBenchmarkSnapshot(d1BenchmarkDatabase(env.DB), r2BenchmarkArtifacts(env.ARTIFACTS), snapshot);
  }
});
afterAll(async () => {
  await mf.dispose();
});
const request = (path: string) => handleBenchmarkRead(new Request(`https://example.test${path}`), env);

it('serves admitted datasets, versioned history and observations through actual D1/R2 bindings', async () => {
  const datasets = z
    .object({ datasets: z.array(z.unknown()) })
    .parse(await (await request('/market-data/datasets')).json());
  expect(datasets.datasets).toHaveLength(6);
  const response = await request('/market-data/series/sofr/observations?start=2026-11-02&end=2026-11-03');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(
    z
      .object({ observations: z.array(z.object({ value: z.number() })) })
      .parse(await response.json())
      .observations.map((x) => x.value)
  ).toEqual([0.0433, 0.0432]);
  const history = z
    .object({ snapshots: z.array(z.object({ id: z.string() })) })
    .parse(await (await request('/market-data/series/sofr/snapshots')).json());
  expect(history.snapshots).toHaveLength(1);
  const snapshot = await request(`/market-data/snapshots/${history.snapshots[0]?.id}`);
  expect(snapshot.headers.get('cache-control')).toContain('immutable');
});

it('downloads a pinned portable selection with no direct official-feed requests', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => handleBenchmarkRead(new Request(String(input)), env));
  const data = await fetchBenchmarkSelection('https://example.test', ['sofr'], benchmarkWindow, { fetcher });
  expect(data.snapshots).toHaveLength(1);
  expect(data.source).toContain('0.0433');
  expect(data.selection.datasets[0]?.snapshots[0]?.dates).toEqual(['2026-11-02', '2026-11-03']);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(([input]) => String(input).startsWith('https://example.test/market-data/'))).toBe(
    true
  );
});

it('rejects writes, unknown datasets, invalid windows and arbitrary object keys', async () => {
  expect(
    (await handleBenchmarkRead(new Request('https://example.test/market-data/ingest', { method: 'POST' }), env)).status
  ).toBe(405);
  expect((await request('/market-data/series/term-sofr/snapshots')).status).toBe(400);
  expect((await request('/market-data/series/sofr/observations?start=2026-02-29&end=2026-03-01')).status).toBe(400);
  expect((await request('/market-data/raw/arbitrary')).status).toBe(404);
  expect((await request(`/market-data/snapshots/${'a'.repeat(64)}`)).status).toBe(404);
});

it('retains recurrence, confirmations and pinned generations through real D1/R2 and the read API', async () => {
  const db = d1BenchmarkDatabase(env.DB),
    artifacts = r2BenchmarkArtifacts(env.ARTIFACTS);
  const now = '2026-11-14T13:00:00.000Z';
  const snapshot = await fetchBenchmarkSnapshot('sofr-index', benchmarkWindow, {
    fetcher: benchmarkFetch,
    now: () => '2026-11-13T12:00:00.000Z'
  });
  const content = snapshot.content.replace('1.12345678', '1.22345678');
  const correction = {
    ...snapshot,
    content,
    source: { ...snapshot.source, retrievedAt: '2026-11-13T13:00:00.000Z', sha256: await projectFileRevision(content) }
  };
  await publishBenchmarkSnapshot(db, artifacts, correction, { now });
  const recurrence = await publishBenchmarkSnapshot(
    db,
    artifacts,
    {
      ...snapshot,
      source: { ...snapshot.source, retrievedAt: '2026-11-13T14:00:00.000Z' }
    },
    { now }
  );
  expect(recurrence).toMatchObject({ generation: 3, outcome: 'updated' });
  expect(
    await publishBenchmarkSnapshot(
      db,
      artifacts,
      {
        ...snapshot,
        source: { ...snapshot.source, retrievedAt: now }
      },
      { now }
    )
  ).toEqual({ ...recurrence, outcome: 'unchanged' });
  await publishBenchmarkSnapshot(
    db,
    artifacts,
    {
      ...correction,
      source: { ...correction.source, retrievedAt: '2026-11-13T15:00:00.000Z' }
    },
    { now }
  );
  const response = await request('/market-data/series/sofr-index/observations?start=2026-11-02&end=2026-11-03');
  expect(response.status).toBe(200);
  const observations = z
    .object({ generation: z.number(), observations: z.array(z.object({ snapshot_id: z.string(), value: z.number() })) })
    .parse(await response.json());
  expect(observations.generation).toBe(4);
  expect(observations.observations[0]).toMatchObject({ snapshot_id: recurrence.snapshotId, value: 1.12345678 });
  const pinned = z
    .object({ observations: z.array(z.object({ value: z.number() })) })
    .parse(
      await (
        await request('/market-data/series/sofr-index/observations?start=2026-11-02&end=2026-11-03&generation=2')
      ).json()
    );
  expect(pinned.observations[0]?.value).toBe(1.22345678);
  const selected = await fetchBenchmarkSelection('https://example.test', ['sofr-index'], benchmarkWindow, {
    fetcher: async (input) => handleBenchmarkRead(new Request(String(input)), env)
  });
  expect(selected.selection.datasets[0]?.snapshots[0]?.id).toBe(recurrence.snapshotId);
  expect(selected.source).toContain('1.12345678');
});
