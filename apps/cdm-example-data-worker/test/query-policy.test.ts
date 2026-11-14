// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { drizzle, eq, benchmarkData } from '../src/driver.js';
import { admittedSelect, createReadConnection } from '../src/query-policy.js';
import { publishBenchmarkSnapshot } from '../src/catalog/catalog.js';
import { nativeBenchmarkCatalog } from './helpers/catalog.js';
import { fetchBenchmarkSnapshot } from '@rune-langium/project-runtime/market-data';
import { benchmarkFetch, benchmarkWindow } from '../../../test/helpers/benchmark-feeds.js';

it('runs ordinary Drizzle queries over accepted data and preserves column semantics', async () => {
  const store = nativeBenchmarkCatalog();
  try {
    await store.migrate();
    const snapshot = await fetchBenchmarkSnapshot('sofr', benchmarkWindow, { fetcher: benchmarkFetch });
    await publishBenchmarkSnapshot(store.db, store.artifacts, snapshot);
    const connection = createReadConnection(store.db);
    const db = drizzle((sql, params, method) => connection.query(sql, params, method));
    expect(
      await db
        .select({ date: benchmarkData.date, value: benchmarkData.value })
        .from(benchmarkData)
        .where(eq(benchmarkData.series, 'sofr'))
        .orderBy(benchmarkData.date)
    ).toEqual([
      { date: '2026-11-02', value: '0.0433' },
      { date: '2026-11-03', value: '0.0432' }
    ]);
    expect((await connection.query('SELECT date FROM benchmark_data ORDER BY date', [], 'get')).rows).toEqual([
      '2026-11-02'
    ]);
    connection.close();
    await expect(connection.query('SELECT * FROM benchmark_data', [], 'all')).rejects.toThrow('expired');
  } finally {
    store.close();
  }
});

it.each([
  'DELETE FROM benchmark_data',
  'UPDATE benchmark_data SET value=0',
  'SELECT * FROM benchmark_data; DELETE FROM benchmark_heads',
  'PRAGMA table_info(benchmark_heads)',
  'SELECT * FROM benchmark_heads',
  'SELECT * FROM sqlite_master',
  'SELECT * FROM main.benchmark_data',
  'SELECT * FROM benchmark_data UNION SELECT * FROM curve_points',
  'WITH benchmark_data AS (SELECT * FROM curve_points) SELECT * FROM benchmark_data',
  'SELECT randomblob(1000000000) FROM benchmark_data',
  'SELECT load_extension(?) FROM benchmark_data',
  'SELECT * FROM pragma_table_info(?)',
  'SELECT a.* FROM benchmark_data a CROSS JOIN benchmark_data b',
  'SELECT * FROM benchmark_data WHERE value IN (SELECT value FROM benchmark_data)'
])('rejects unauthorized SQL before database access: %s', async (sql) => {
  let calls = 0;
  const connection = createReadConnection({
    async values() {
      calls++;
      return [];
    }
  });
  await expect(connection.query(sql, [], 'all')).rejects.toThrow();
  expect(calls).toBe(0);
});

it('keeps staged captures outside the connection until their publication commits', async () => {
  const store = nativeBenchmarkCatalog();
  try {
    await store.migrate();
    const source = await fetchBenchmarkSnapshot('sofr', benchmarkWindow, { fetcher: benchmarkFetch });
    const failing = {
      ...store.db,
      async batch(statements: Parameters<typeof store.db.batch>[0]) {
        if (statements.some((statement) => statement.sql.includes('INSERT INTO benchmark_publications')))
          throw new Error('Publish interrupted.');
        return store.db.batch(statements);
      }
    };
    await expect(publishBenchmarkSnapshot(failing, store.artifacts, source)).rejects.toThrow();
    const connection = createReadConnection(store.db);
    expect((await connection.query('SELECT * FROM benchmark_data', [], 'all')).rows).toEqual([]);
    expect((await publishBenchmarkSnapshot(store.db, store.artifacts, source)).outcome).toBe('updated');
    expect((await connection.query('SELECT * FROM benchmark_data', [], 'all')).rows).toHaveLength(2);
  } finally {
    store.close();
  }
});

it('bounds concurrent calls, expiration and response size without granting writes through method names', async () => {
  let now = 0,
    calls = 0;
  const connection = createReadConnection(
    {
      async values() {
        calls++;
        return [];
      }
    },
    { now: () => now }
  );
  await expect(connection.query('SELECT * FROM benchmark_data', [], 'run')).rejects.toThrow('Read');
  await Promise.all(Array.from({ length: 23 }, () => connection.query('SELECT * FROM benchmark_data', [], 'all')));
  await expect(connection.query('SELECT * FROM benchmark_data', [], 'all')).rejects.toThrow('budget');
  expect(calls).toBe(23);
  const expired = createReadConnection(
    {
      async values() {
        return [];
      }
    },
    { now: () => now }
  );
  now = 10000;
  await expect(expired.query('SELECT * FROM benchmark_data', [], 'all')).rejects.toThrow('expired');
  const large = createReadConnection({
    async values() {
      return Array.from({ length: 601 }, () => ['0']);
    }
  });
  await expect(large.query('SELECT * FROM benchmark_data', [], 'all')).rejects.toThrow('budget');
  expect(admittedSelect('SELECT count(*) FROM benchmark_data')).toContain('COUNT');
});
