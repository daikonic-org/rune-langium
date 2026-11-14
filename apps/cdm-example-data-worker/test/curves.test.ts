// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { acquisition } from './helpers/curves.js';
import { nativeBenchmarkCatalog } from './helpers/catalog.js';
import { publishSoniaOisSnapshot, querySoniaOisCurve, readSoniaOisCatalogSnapshot } from '../src/catalog/curves.js';
import { readSoniaOisAcquisition, readSoniaOisSnapshot, soniaOisSnapshotId } from '../src/catalog/curve-contracts.js';
import type { CatalogDatabase } from '../src/catalog/catalog-schema.js';

const query = { date: '2026-11-06', kind: 'spot', grid: 'monthly' };
it('publishes private fitted curves with exact source text, normalized units and explicit grids', async () => {
  const store = nativeBenchmarkCatalog();
  try {
    await store.migrate();
    const data = await acquisition();
    const accepted = await publishSoniaOisSnapshot(store.db, store.artifacts, data, {
      now: '2026-11-14T01:00:00.000Z'
    });
    expect(accepted.generation).toBe(1);
    const row = await querySoniaOisCurve(store.db, query);
    expect(row).toMatchObject({
      dataset: {
        currency: 'GBP',
        benchmark: 'GBP-SONIA',
        compounding: 'continuous',
        dayCount: 'ACT/365.FIXED',
        accessScope: 'internal-noncommercial'
      },
      points: [{ sourceValue: '4.25', value: '0.0425', maturityMonths: 12 }]
    });
    expect(await readSoniaOisCatalogSnapshot(store.db, store.artifacts, accepted.snapshotId)).toEqual(data.snapshot);
    expect((await querySoniaOisCurve(store.db, { ...query, date: '2026-11-07' }))?.points).toEqual([]);
    expect(await querySoniaOisCurve(store.db, { ...query, date: '2027-01-01' })).toBeUndefined();
  } finally {
    store.close();
  }
});
it('deduplicates unchanged captures and preserves historical revision pins including A to B to A', async () => {
  const store = nativeBenchmarkCatalog();
  try {
    await store.migrate();
    const a = await acquisition();
    const first = await publishSoniaOisSnapshot(store.db, store.artifacts, a);
    const same = await acquisition('synthetic archive A', '4.25', '2026-11-14T00:10:00.000Z');
    expect(await publishSoniaOisSnapshot(store.db, store.artifacts, same)).toMatchObject({
      generation: 1,
      outcome: 'unchanged',
      snapshotId: first.snapshotId
    });
    const second = await publishSoniaOisSnapshot(
      store.db,
      store.artifacts,
      await acquisition('synthetic archive B', '4.5', '2026-11-14T00:20:00.000Z')
    );
    expect(second.generation).toBe(2);
    expect((await querySoniaOisCurve(store.db, { ...query, generation: 1 }))?.points[0]?.sourceValue).toBe('4.25');
    expect((await querySoniaOisCurve(store.db, query))?.points[0]?.sourceValue).toBe('4.5');
    expect(
      (await querySoniaOisCurve(store.db, { ...query, snapshotId: first.snapshotId }))?.points[0]?.sourceValue
    ).toBe('4.25');
    expect(
      (
        await publishSoniaOisSnapshot(
          store.db,
          store.artifacts,
          await acquisition('synthetic archive A', '4.25', '2026-11-14T00:30:00.000Z')
        )
      ).generation
    ).toBe(3);
    expect(await publishSoniaOisSnapshot(store.db, store.artifacts, a)).toMatchObject({
      generation: 1,
      outcome: 'unchanged'
    });
    expect((await querySoniaOisCurve(store.db, query))?.generation).toBe(3);
  } finally {
    store.close();
  }
});
it('keeps interrupted staging invisible and resumes safely', async () => {
  const store = nativeBenchmarkCatalog();
  try {
    await store.migrate();
    const data = await acquisition();
    const failing: CatalogDatabase = {
      ...store.db,
      async batch(statements) {
        if (statements.some((s) => s.sql.includes('insert into "curve_points"'))) {
          await store.db.batch(statements.slice(0, 2));
          throw new Error('interrupt');
        }
        return store.db.batch(statements);
      }
    };
    await expect(publishSoniaOisSnapshot(failing, store.artifacts, data)).rejects.toThrow('interrupt');
    expect(await querySoniaOisCurve(store.db, query)).toBeUndefined();
    expect(
      await readSoniaOisCatalogSnapshot(store.db, store.artifacts, await soniaOisSnapshotId(data.snapshot))
    ).toBeUndefined();
    expect((await publishSoniaOisSnapshot(store.db, store.artifacts, data)).generation).toBe(1);
    expect((await querySoniaOisCurve(store.db, query))?.points).toHaveLength(1);
  } finally {
    store.close();
  }
});
it('refuses stale generation publication and corrupted/missing immutable artifacts', async () => {
  const store = nativeBenchmarkCatalog();
  try {
    await store.migrate();
    const first = await publishSoniaOisSnapshot(store.db, store.artifacts, await acquisition());
    await expect(
      publishSoniaOisSnapshot(store.db, store.artifacts, await acquisition('synthetic archive B', '4.6'), {
        expectedGeneration: 0
      })
    ).rejects.toThrow('generation');
    expect((await querySoniaOisCurve(store.db, query))?.generation).toBe(1);
    const key = `market-data/curves/snapshots/${first.snapshotId}.json`;
    const original = store.files.get(key)!;
    store.files.set(key, original.replace('4.25', '5.25'));
    await expect(readSoniaOisCatalogSnapshot(store.db, store.artifacts, first.snapshotId)).rejects.toThrow('integrity');
    store.files.delete(key);
    await expect(readSoniaOisCatalogSnapshot(store.db, store.artifacts, first.snapshotId)).rejects.toThrow(
      'unavailable'
    );
  } finally {
    store.close();
  }
});
it('rejects changed archive bytes, partial grids, duplicate nodes, source drift and future captures', async () => {
  const data = await acquisition();
  await expect(readSoniaOisAcquisition({ ...data, archiveBase64: btoa('changed') })).rejects.toThrow('checksum');
  expect(() => readSoniaOisSnapshot({ ...data.snapshot, points: data.snapshot.points.slice(1) })).toThrow('Incomplete');
  expect(() =>
    readSoniaOisSnapshot({ ...data.snapshot, points: [data.snapshot.points[0], ...data.snapshot.points] })
  ).toThrow('distinct');
  expect(() =>
    readSoniaOisSnapshot({ ...data.snapshot, source: { ...data.snapshot.source, url: 'https://example.com' } })
  ).toThrow();
  const store = nativeBenchmarkCatalog();
  try {
    await store.migrate();
    await expect(
      publishSoniaOisSnapshot(store.db, store.artifacts, data, { now: '2026-11-13T00:00:00.000Z' })
    ).rejects.toThrow('future');
  } finally {
    store.close();
  }
});
