// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { afterEach, expect, it } from 'vitest';
import { projectFileRevision } from '@rune-langium/project-config';
import { fetchBenchmarkSnapshot, renderBenchmarkSelection } from '@rune-langium/project-runtime/market-data';
import {
  publishBenchmarkSnapshot,
  queryBenchmarkObservations,
  createBenchmarkSelection,
  readCatalogSnapshot,
  listBenchmarkSnapshots,
  listBenchmarkRuns,
  refreshBenchmarkCatalog,
  type CatalogDatabase
} from '../src/catalog/catalog.js';
import { nativeBenchmarkCatalog, initializeBenchmarkCatalog } from './helpers/catalog.js';
import { benchmarkFetch, benchmarkWindow } from '../../../test/helpers/benchmark-feeds.js';

const opened: ReturnType<typeof nativeBenchmarkCatalog>[] = [];
afterEach(() => {
  for (const db of opened) db.close();
  opened.length = 0;
});
async function setup() {
  const catalog = nativeBenchmarkCatalog();
  opened.push(catalog);
  await initializeBenchmarkCatalog(catalog.db);
  return catalog;
}
async function capture() {
  return fetchBenchmarkSnapshot('sofr', benchmarkWindow, {
    fetcher: benchmarkFetch,
    now: () => '2026-11-13T12:00:00.000Z'
  });
}
const now = '2026-11-14T13:00:00.000Z';

it('imports existing snapshots offline, deduplicates unchanged content, and retains original provenance', async () => {
  const c = await setup(),
    snapshot = await capture();
  const first = await publishBenchmarkSnapshot(c.db, c.artifacts, snapshot, { now });
  const repeated = await publishBenchmarkSnapshot(
    c.db,
    c.artifacts,
    { ...snapshot, source: { ...snapshot.source, retrievedAt: now } },
    { now }
  );
  expect(repeated).toEqual({ ...first, outcome: 'unchanged' });
  expect((await listBenchmarkSnapshots(c.db, 'sofr')).length).toBe(1);
  expect(await readCatalogSnapshot(c.db, c.artifacts, first.snapshotId)).toEqual(snapshot);
  expect((await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow)).observations.map((x) => x.value)).toEqual([
    0.0433, 0.0432
  ]);
  expect(c.files.get(`market-data/raw/${snapshot.source.sha256}.txt`)).toBe(snapshot.content);
});

it('keeps pinned revisions, refuses stale publication, and recovers staged rows on retry', async () => {
  const c = await setup(),
    snapshot = await capture();
  const original = await publishBenchmarkSnapshot(c.db, c.artifacts, snapshot, { now });
  const pinned = await createBenchmarkSelection(c.db, ['sofr'], benchmarkWindow);
  const content = snapshot.content.replace('4.33', '4.55');
  const correction = {
    ...snapshot,
    content,
    source: { ...snapshot.source, retrievedAt: now, sha256: await projectFileRevision(content) }
  };
  await expect(publishBenchmarkSnapshot(c.db, c.artifacts, correction, { now, expectedGeneration: 0 })).rejects.toThrow(
    'generation changed'
  );
  expect(await createBenchmarkSelection(c.db, ['sofr'], benchmarkWindow)).toEqual(pinned);
  const next = await publishBenchmarkSnapshot(c.db, c.artifacts, correction, { now });
  expect(next.generation).toBe(2);
  expect((await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow)).observations[0]?.value).toBe(0.0455);
  expect(
    (await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow, { generation: 1 })).observations[0]?.value
  ).toBe(0.0433);
  expect(
    await renderBenchmarkSelection(pinned, [await readCatalogSnapshot(c.db, c.artifacts, original.snapshotId)])
  ).toContain('0.0433');
  expect((await listBenchmarkSnapshots(c.db, 'sofr', 2))[0]?.id).toBe(original.snapshotId);
});

it('cannot expose half-loaded rows or snapshots when publication is interrupted', async () => {
  const c = await setup(),
    snapshot = await capture();
  let interrupt = true;
  const db: CatalogDatabase = {
    ...c.db,
    async batch(statements) {
      if (interrupt && statements.some((s) => s.sql.includes('INSERT INTO benchmark_publications')))
        throw new Error('interrupted');
      await c.db.batch(statements);
    }
  };
  await expect(publishBenchmarkSnapshot(db, c.artifacts, snapshot, { now })).rejects.toThrow('interrupted');
  expect(await listBenchmarkSnapshots(c.db, 'sofr')).toEqual([]);
  expect((await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow)).observations).toEqual([]);
  const id = (await c.db.query({ sql: 'SELECT id FROM benchmark_snapshots', params: [] }))[0];
  expect(id).toBeDefined();
  interrupt = false;
  const result = await publishBenchmarkSnapshot(db, c.artifacts, snapshot, { now });
  expect(await readCatalogSnapshot(c.db, c.artifacts, result.snapshotId)).toEqual(snapshot);
});

it('rejects corrupt artifacts before acceptance and rejects invalid query bounds', async () => {
  const c = await setup(),
    snapshot = await capture();
  await expect(
    publishBenchmarkSnapshot(c.db, c.artifacts, { ...snapshot, content: 'corrupt' }, { now })
  ).rejects.toThrow('checksum');
  await expect(
    queryBenchmarkObservations(c.db, 'sofr', { startDate: '2026-02-29', endDate: '2026-03-01' })
  ).rejects.toThrow();
  await expect(queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow, { limit: 10000 })).rejects.toThrow();
  await expect(readCatalogSnapshot(c.db, c.artifacts, '../raw')).rejects.toThrow();
  expect(await listBenchmarkSnapshots(c.db, 'sofr')).toEqual([]);
});

it('does not let an older historical capture override a newer correction', async () => {
  const c = await setup(),
    snapshot = await capture();
  const content = snapshot.content.replace('4.33', '4.55');
  await publishBenchmarkSnapshot(
    c.db,
    c.artifacts,
    {
      ...snapshot,
      content,
      source: { ...snapshot.source, retrievedAt: now, sha256: await projectFileRevision(content) }
    },
    { now }
  );
  await publishBenchmarkSnapshot(c.db, c.artifacts, snapshot, { now });
  expect((await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow)).observations[0]?.value).toBe(0.0455);
  const first = await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow, { limit: 1 });
  const second = await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow, {
    limit: 1,
    after: first.observations[0]?.date,
    generation: first.generation
  });
  expect(second.observations.map((x) => x.date)).toEqual(['2026-11-03']);
});

it('continues other datasets after a feed failure and publishes only sanitized run receipts', async () => {
  const c = await setup();
  const report = await refreshBenchmarkCatalog({
    ...c,
    runId: 'test:1',
    window: benchmarkWindow,
    now: () => now,
    fetcher: async (input, init) =>
      String(input).includes('bankofengland')
        ? Promise.reject(new Error('secret upstream failure'))
        : benchmarkFetch(input, init)
  });
  expect(report.success).toBe(false);
  expect(report.results.filter((r) => r.outcome === 'failed').map((r) => r.series)).toEqual(['sonia', 'sonia-index']);
  expect(report.results.filter((r) => r.outcome === 'updated')).toHaveLength(4);
  expect((await listBenchmarkSnapshots(c.db, 'estr')).length).toBe(1);
  const runs = await listBenchmarkRuns(c.db);
  expect(runs).toHaveLength(6);
  expect(JSON.stringify(runs)).not.toContain('secret');
});

it('dry-runs all six series without writing SQL, objects or misleading publication IDs', async () => {
  const c = await setup();
  const report = await refreshBenchmarkCatalog({
    ...c,
    runId: 'test:dry',
    window: benchmarkWindow,
    now: () => now,
    fetcher: benchmarkFetch,
    dryRun: true
  });
  expect(report.success).toBe(true);
  expect(c.files.size).toBe(0);
  expect(await listBenchmarkRuns(c.db)).toEqual([]);
  expect(report.results.every((r) => !r.snapshotId)).toBe(true);
});
