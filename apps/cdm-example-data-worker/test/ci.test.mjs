// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Cloudflare from 'cloudflare';
import { remoteBenchmarkCatalog } from '../scripts/remote.mjs';
import { runBenchmarkRefresh, refreshArguments } from '../scripts/refresh.mjs';
import { nativeBenchmarkCatalog } from './helpers/catalog.ts';
import { benchmarkFetch, benchmarkWindow } from '../../../test/helpers/benchmark-feeds.ts';
import { fetchBenchmarkSnapshot } from '@rune-langium/project-runtime/market-data';
import { listBenchmarkSnapshots } from '../src/catalog/catalog.ts';

const directories = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const d of directories) await rm(d, { recursive: true, force: true });
  directories.length = 0;
});
async function directory() {
  const d = await mkdtemp(join(tmpdir(), 'rune-example-ci-'));
  directories.push(d);
  return d;
}
it('bounds default/manual windows before doing work', () => {
  expect(refreshArguments([], new Date('2026-11-13T20:17:00Z')).window).toEqual({
    startDate: '2026-11-07',
    endDate: '2026-11-13'
  });
  expect(() => refreshArguments(['--start', '2026-11-01'])).toThrow('both');
  expect(() => refreshArguments(['--start', '2025-01-01', '--end', '2026-12-31'])).toThrow();
});
it('dry-runs without cloud credentials or catalog mutation', async () => {
  const report = join(await directory(), 'report.json');
  vi.stubGlobal('fetch', benchmarkFetch);
  expect(
    await runBenchmarkRefresh(
      ['--start', benchmarkWindow.startDate, '--end', benchmarkWindow.endDate, '--dry-run', '--report', report],
      {}
    )
  ).toBe(0);
  expect(JSON.parse(await readFile(report, 'utf8'))).toMatchObject({ success: true, dryRun: true });
});
it('reports aggregate failure while preserving independent complete publications', async () => {
  const report = join(await directory(), 'report.json'),
    store = nativeBenchmarkCatalog();
  vi.stubGlobal('fetch', async (input, init) =>
    String(input).includes('bankofengland')
      ? Promise.reject(new Error('secret-do-not-report'))
      : benchmarkFetch(input, init)
  );
  try {
    expect(
      await runBenchmarkRefresh(
        ['--start', benchmarkWindow.startDate, '--end', benchmarkWindow.endDate, '--report', report],
        {},
        store
      )
    ).toBe(1);
    const text = await readFile(report, 'utf8'),
      result = JSON.parse(text);
    expect(result.results.filter((r) => r.outcome === 'updated')).toHaveLength(4);
    expect(text).not.toContain('secret-do-not-report');
    expect(await listBenchmarkSnapshots(store.db, 'estr')).toHaveLength(1);
  } finally {
    store.close();
  }
});
it('imports previously downloaded v1 captures offline through the same publisher', async () => {
  const d = await directory(),
    path = join(d, 'snapshot.json'),
    report = join(d, 'report.json');
  const snapshot = await fetchBenchmarkSnapshot('sofr', benchmarkWindow, { fetcher: benchmarkFetch });
  await writeFile(path, JSON.stringify(snapshot));
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('offline');
    })
  );
  const store = nativeBenchmarkCatalog();
  try {
    expect(await runBenchmarkRefresh(['--import', path, '--report', report], {}, store)).toBe(0);
    expect(await listBenchmarkSnapshots(store.db, 'sofr')).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    store.close();
  }
});
it('uses the official SDK without changing numeric/null bindings and uses Wrangler migrations', async () => {
  const calls = [];
  const api = new Cloudflare({
    apiToken: 'test',
    fetch: async (input, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      return Response.json({
        success: true,
        result: input.toString().endsWith('/raw')
          ? [{ success: true, results: { columns: ['value'], rows: [[42]] } }]
          : (body.batch ?? [body]).map(() => ({ success: true, results: [] }))
      });
    }
  });
  let migrationConfig;
  const store = remoteBenchmarkCatalog(
    {
      CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
      CDM_EXAMPLE_DATA_DATABASE_ID: 'ddcb3693-f556-4d88-a75b-5fd9b2f4aec6',
      CLOUDFLARE_API_TOKEN: 'test'
    },
    {
      api,
      execute: async (_command, args) => {
        migrationConfig = JSON.parse(await readFile(args.at(-1), 'utf8'));
      }
    }
  );
  await store.db.batch([{ sql: 'SELECT ?,?', params: [null, 42] }]);
  expect(calls[0]).toEqual({ batch: [{ sql: 'SELECT ?,?', params: [null, 42] }] });
  expect(await store.db.values({ sql: 'SELECT 42', params: [] })).toEqual([[42]]);
  await store.migrate();
  expect(migrationConfig.d1_databases[0]).toMatchObject({
    binding: 'DB',
    database_id: 'ddcb3693-f556-4d88-a75b-5fd9b2f4aec6'
  });
});
