// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { afterEach, expect, it } from 'vitest';
import { projectFileRevision } from '@rune-langium/project-config';
import {
  fetchBenchmarkSnapshot,
  renderBenchmarkSelection,
  type BenchmarkSnapshot
} from '@rune-langium/project-runtime/market-data';
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
async function recapture(snapshot: BenchmarkSnapshot, retrievedAt: string, content = snapshot.content) {
  return {
    ...snapshot,
    content,
    source: { ...snapshot.source, retrievedAt, sha256: await projectFileRevision(content) }
  };
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

it('publishes A after an intervening B, retaining old pins and deduplicating subsequent unchanged polls', async () => {
  const c = await setup(),
    snapshot = await capture();
  const first = await publishBenchmarkSnapshot(c.db, c.artifacts, snapshot, { now });
  const firstPin = await createBenchmarkSelection(c.db, ['sofr'], benchmarkWindow);
  const correction = await recapture(snapshot, '2026-11-13T13:00:00.000Z', snapshot.content.replace('4.33', '4.55'));
  const second = await publishBenchmarkSnapshot(c.db, c.artifacts, correction, { now });
  const secondPin = await createBenchmarkSelection(c.db, ['sofr'], benchmarkWindow);
  const recurrence = await recapture(snapshot, '2026-11-13T14:00:00.000Z');
  const third = await publishBenchmarkSnapshot(c.db, c.artifacts, recurrence, { now });
  expect(third).toMatchObject({ generation: 3, outcome: 'updated' });
  expect(third.snapshotId).not.toBe(first.snapshotId);
  expect((await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow)).observations.map((x) => x.value)).toEqual([
    0.0433, 0.0432
  ]);
  expect((await createBenchmarkSelection(c.db, ['sofr'], benchmarkWindow)).datasets[0]?.snapshots).toEqual([
    { id: third.snapshotId, dates: ['2026-11-02', '2026-11-03'] }
  ]);
  expect(await readCatalogSnapshot(c.db, c.artifacts, third.snapshotId)).toEqual(recurrence);
  expect(await renderBenchmarkSelection(firstPin, [snapshot])).toContain('0.0433');
  expect(await renderBenchmarkSelection(secondPin, [correction])).toContain('0.0455');
  expect(
    (await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow, { generation: 1 })).observations[0]
  ).toMatchObject({
    snapshot_id: first.snapshotId,
    value: 0.0433
  });
  expect(
    (await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow, { generation: 2 })).observations[0]
  ).toMatchObject({
    snapshot_id: second.snapshotId,
    value: 0.0455
  });
  expect(await publishBenchmarkSnapshot(c.db, c.artifacts, await recapture(snapshot, now), { now })).toEqual({
    ...third,
    outcome: 'unchanged'
  });
  expect(await publishBenchmarkSnapshot(c.db, c.artifacts, snapshot, { now })).toEqual({
    ...first,
    outcome: 'unchanged'
  });
  expect((await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow)).observations[0]?.snapshot_id).toBe(
    third.snapshotId
  );
  expect(await listBenchmarkSnapshots(c.db, 'sofr')).toHaveLength(3);
  expect([...c.files.keys()].filter((key) => key.startsWith('market-data/raw/'))).toHaveLength(2);
});

it('keeps an unchanged confirmation ahead of a later imported older capture without changing provenance or pins', async () => {
  const c = await setup(),
    snapshot = await capture();
  const first = await publishBenchmarkSnapshot(c.db, c.artifacts, snapshot, { now });
  expect(
    await publishBenchmarkSnapshot(c.db, c.artifacts, await recapture(snapshot, '2026-11-13T14:00:00.000Z'), { now })
  ).toEqual({ ...first, outcome: 'unchanged' });
  const backfill = await recapture(snapshot, '2026-11-13T13:00:00.000Z', snapshot.content.replace('4.33', '4.55'));
  await publishBenchmarkSnapshot(c.db, c.artifacts, backfill, { now });
  const pinned = await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow);
  expect(pinned.generation).toBe(2);
  expect(pinned.observations[0]).toMatchObject({ snapshot_id: first.snapshotId, value: 0.0433 });
  // Delayed confirmations must not move a capture's last-seen time backwards.
  await publishBenchmarkSnapshot(c.db, c.artifacts, await recapture(snapshot, '2026-11-13T12:30:00.000Z'), { now });
  expect(await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow)).toEqual(pinned);
  await publishBenchmarkSnapshot(c.db, c.artifacts, await recapture(backfill, now), { now });
  expect((await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow)).observations[0]?.value).toBe(0.0455);
  expect(await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow, { generation: pinned.generation })).toEqual(
    pinned
  );
  expect(await readCatalogSnapshot(c.db, c.artifacts, first.snapshotId)).toEqual(snapshot);
});

it('detects intervening overlapping windows while ignoring disjoint windows and other series', async () => {
  const c = await setup(),
    snapshot = await capture();
  const first = await publishBenchmarkSnapshot(c.db, c.artifacts, snapshot, { now });
  const disjoint = await fetchBenchmarkSnapshot(
    'sofr',
    { startDate: '2026-11-04', endDate: '2026-11-05' },
    {
      fetcher: async () =>
        new Response(snapshot.content.replaceAll('2026-11-02', '2026-11-04').replaceAll('2026-11-03', '2026-11-05')),
      now: () => '2026-11-13T12:30:00.000Z'
    }
  );
  await publishBenchmarkSnapshot(c.db, c.artifacts, disjoint, { now });
  await publishBenchmarkSnapshot(
    c.db,
    c.artifacts,
    await fetchBenchmarkSnapshot('estr', benchmarkWindow, {
      fetcher: benchmarkFetch,
      now: () => '2026-11-13T12:30:00.000Z'
    }),
    { now }
  );
  expect(
    await publishBenchmarkSnapshot(c.db, c.artifacts, await recapture(snapshot, '2026-11-13T13:00:00.000Z'), { now })
  ).toEqual({ ...first, outcome: 'unchanged' });
  const partial = await fetchBenchmarkSnapshot(
    'sofr',
    { startDate: '2026-11-02', endDate: '2026-11-02' },
    {
      fetcher: async () =>
        new Response(
          JSON.stringify({
            refRates: [{ effectiveDate: '2026-11-02', type: 'SOFR', percentRate: 4.55, revisionIndicator: 'R' }]
          })
        ),
      now: () => '2026-11-13T14:00:00.000Z'
    }
  );
  await publishBenchmarkSnapshot(c.db, c.artifacts, partial, { now });
  const previous = await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow);
  expect(previous.observations.map((x) => x.value)).toEqual([0.0455, 0.0432]);
  const next = await publishBenchmarkSnapshot(c.db, c.artifacts, await recapture(snapshot, now), { now });
  expect(next).toMatchObject({ generation: 4, outcome: 'updated' });
  expect((await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow)).observations.map((x) => x.value)).toEqual([
    0.0433, 0.0432
  ]);
  expect(await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow, { generation: previous.generation })).toEqual(
    previous
  );
});

it('refuses an unchanged confirmation if another capture publishes after its generation check', async () => {
  const c = await setup(),
    snapshot = await capture();
  await publishBenchmarkSnapshot(c.db, c.artifacts, snapshot, { now });
  const correction = await recapture(snapshot, now, snapshot.content.replace('4.33', '4.55'));
  const db: CatalogDatabase = {
    ...c.db,
    async batch(statements) {
      await publishBenchmarkSnapshot(c.db, c.artifacts, correction, { now });
      await c.db.batch(statements);
    }
  };
  await expect(
    publishBenchmarkSnapshot(db, c.artifacts, await recapture(snapshot, '2026-11-13T14:00:00.000Z'), { now })
  ).rejects.toThrow('generation changed');
  expect((await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow)).observations[0]?.value).toBe(0.0455);
});

it('reads pre-migration snapshots without confirmation rows and refuses deduplication of a corrupt stored capture', async () => {
  const c = await setup(),
    snapshot = await capture();
  const first = await publishBenchmarkSnapshot(c.db, c.artifacts, snapshot, { now });
  await publishBenchmarkSnapshot(
    c.db,
    c.artifacts,
    await recapture(snapshot, '2026-11-13T11:00:00.000Z', snapshot.content.replace('4.33', '4.55')),
    { now }
  );
  c.sqlite.exec('DELETE FROM benchmark_confirmations');
  const pinned = await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow);
  expect(pinned.observations[0]?.snapshot_id).toBe(first.snapshotId);
  expect(
    await publishBenchmarkSnapshot(c.db, c.artifacts, await recapture(snapshot, '2026-11-13T10:00:00.000Z'), { now })
  ).toEqual({ ...first, outcome: 'unchanged' });
  expect(await queryBenchmarkObservations(c.db, 'sofr', benchmarkWindow)).toEqual(pinned);
  expect(
    await publishBenchmarkSnapshot(c.db, c.artifacts, await recapture(snapshot, '2026-11-13T13:00:00.000Z'), { now })
  ).toEqual({ ...first, outcome: 'unchanged' });
  c.files.set(`market-data/snapshots/${first.snapshotId}.json`, JSON.stringify(await recapture(snapshot, now)));
  await expect(publishBenchmarkSnapshot(c.db, c.artifacts, await recapture(snapshot, now), { now })).rejects.toThrow(
    'integrity mismatch'
  );
  expect(await listBenchmarkSnapshots(c.db, 'sofr')).toHaveLength(2);
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
