// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { beforeAll, afterAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import {
  PreparationResult,
  type PreparationRequest,
  type ExecutionIdentity,
  type PreparationService
} from '@rune-langium/worker-core/execution';
import { publishBenchmarkSnapshot } from '../src/catalog/catalog.js';
import { publishSoniaOisSnapshot } from '../src/catalog/curves.js';
import { d1BenchmarkDatabase, r2BenchmarkArtifacts } from '../src/storage.js';
import { fetchBenchmarkSnapshot } from '@rune-langium/project-runtime/market-data';
import { benchmarkFetch, benchmarkWindow } from '../../../test/helpers/benchmark-feeds.js';
import { acquisition } from './helpers/curves.js';
import { handleDatabasePreparation } from '../../studio/functions/api/database-preparation.js';
import { prepareHostedDatabase } from '../../studio/src/services/database-preparation.js';
import prepareMarketData from '../examples/prepare-market-data.js';
import { nativeBenchmarkCatalog } from './helpers/catalog.js';
import { createReadConnection } from '../src/query-policy.js';

let mf: Miniflare;
let service: PreparationService;
const capturedSnapshot = () =>
  fetchBenchmarkSnapshot('sofr', benchmarkWindow, {
    fetcher: benchmarkFetch,
    now: () => '2026-11-14T00:00:00.000Z'
  });
beforeAll(async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new NodeURL('../src/worker.ts', import.meta.url))],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'esnext',
    external: ['cloudflare:workers']
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      port: 0,
      workers: [
        {
          name: 'data',
          modules: [{ type: 'ESModule', path: 'worker.js', contents: bundle.outputFiles[0]!.text }],
          compatibilityDate: '2026-11-13',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: ['DB'],
          r2Buckets: ['ARTIFACTS'],
          workerLoaders: { EXECUTION_LOADER: {} },
          bindings: { EXECUTION_ALLOWED_GITHUB_IDS: '123' }
        },
        {
          name: 'gateway',
          modules: [
            {
              type: 'ESModule',
              path: 'gateway.js',
              contents: `
      export default { async fetch(request, env) {
        const { payload, identity } = await request.json();
        try { return Response.json(await env.EXEC.execute(payload, identity)); }
        catch { return new Response('Execution rejected.', { status: 403 }); }
      }};`
            }
          ],
          compatibilityDate: '2026-11-13',
          serviceBindings: { EXEC: { name: 'data', entrypoint: 'DatabaseExecution' } }
        }
      ]
    })
  );
  const env = await mf.getBindings<Env>('data');
  for (const migration of readMigrationFiles({
    migrationsFolder: fileURLToPath(new NodeURL('../migrations', import.meta.url))
  }))
    await env.DB.batch(migration.sql.map((sql) => env.DB.prepare(sql)));
  const db = d1BenchmarkDatabase(env.DB),
    artifacts = r2BenchmarkArtifacts(env.ARTIFACTS);
  await publishBenchmarkSnapshot(db, artifacts, await capturedSnapshot());
  await publishSoniaOisSnapshot(db, artifacts, await acquisition());
  const gateway = await mf.getWorker('gateway');
  service = {
    async execute(payload, identity) {
      const response = await gateway.fetch('https://private.test/', {
        method: 'POST',
        body: JSON.stringify({ payload, identity })
      });
      if (!response.ok) throw new Error('Execution rejected.');
      return PreparationResult.parse(await response.json());
    }
  };
}, 30000);
afterAll(async () => {
  await mf?.dispose();
});

const identity: ExecutionIdentity = { id: 123, login: 'tester' };
function request(code: string): PreparationRequest {
  return { schemaVersion: 1, projectRevision: 'a'.repeat(64), code, input: {} };
}
const queryCode = `
import { drizzle, eq, benchmarkData } from './driver.js';
export default async function(connection) {
  const db = drizzle((sql, params, method) => connection.query(sql, params, method));
  return db.select({ date: benchmarkData.date, value: benchmarkData.value, snapshot: benchmarkData.snapshot_id })
    .from(benchmarkData).where(eq(benchmarkData.series, 'sofr')).orderBy(benchmarkData.date);
}`;

it('executes normal Drizzle query code in a real isolated Worker against private D1', async () => {
  const result = await service.execute(request(queryCode), identity);
  expect(result).toMatchObject({
    projectRevision: 'a'.repeat(64),
    queryCount: 1,
    value: [
      { date: '2026-11-02', value: '0.0433' },
      { date: '2026-11-03', value: '0.0432' }
    ]
  });
});
it('runs the browser preparation transport through authenticated Pages and the private binding', async () => {
  const fetcher: typeof fetch = async (url, init) =>
    handleDatabasePreparation(
      new Request(new URL(String(url), 'https://studio.test'), init),
      { CDM_EXECUTION: service },
      async (_url, options) => {
        expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer test-only');
        return Response.json({ id: 123, login: 'tester', ignored: 'GitHub extra fields' });
      }
    );
  const result = await prepareHostedDatabase(request(queryCode), {
    token: 'test-only',
    fetcher
  });
  expect(result.queryCount).toBe(1);
  expect(result.value).toHaveLength(2);
});
it('runs the same pinned preparation example on standalone SQLite and hosted D1', async () => {
  const input = {
    series: 'sofr',
    startDate: benchmarkWindow.startDate,
    endDate: benchmarkWindow.endDate,
    curveDate: '2026-11-06',
    fixingGeneration: 1,
    curveGeneration: 1
  };
  const store = nativeBenchmarkCatalog();
  try {
    await store.migrate();
    await publishBenchmarkSnapshot(store.db, store.artifacts, await capturedSnapshot());
    await publishSoniaOisSnapshot(store.db, store.artifacts, await acquisition());
    const connection = createReadConnection(store.db);
    const standalone = await prepareMarketData(connection, input);
    connection.close();
    // Packaging changes only the driver module specifier; the query module is the actual example source.
    const source = (await readFile(new NodeURL('../examples/prepare-market-data.ts', import.meta.url), 'utf8')).replace(
      '../src/driver.js',
      './driver.js'
    );
    const hosted = await prepareHostedDatabase(
      { ...request(source), input },
      {
        token: 'test-only',
        fetcher: async (url, init) =>
          handleDatabasePreparation(
            new Request(new URL(String(url), 'https://studio.test'), init),
            { CDM_EXECUTION: service },
            async () => Response.json(identity)
          )
      }
    );
    expect(hosted.value).toEqual(standalone);
    expect(standalone.fixings).toHaveLength(2);
    expect(standalone.curve).toMatchObject([{ value: '0.0425', maturity_months: 12 }]);
    expect(standalone.fixings.every((row) => row.snapshot_id.length === 64 && row.generation === 1)).toBe(true);
  } finally {
    store.close();
  }
});
it('refuses unapproved identities and denies SQL/HTTP execution on the public handler', async () => {
  await expect(service.execute(request(queryCode), { id: 456, login: 'tester' })).rejects.toThrow();
  const data = await mf.getWorker('data');
  expect(
    (await data.fetch('https://private.test/execute', { method: 'POST', body: JSON.stringify(request(queryCode)) }))
      .status
  ).toBe(405);
});
it.each([
  `export default async () => { await fetch('https://example.com'); return 'escape'; }`,
  `export default async () => { const c = await import('cloudflare:sockets'); return c.connect('example.com:80'); }`,
  `export default async connection => connection.query('DELETE FROM benchmark_data', [], 'all')`,
  `export default async connection => connection.query('SELECT * FROM curve_points', [], 'all')`,
  `export default async connection => connection.query('SELECT * FROM benchmark_data', [], 'run')`,
  `export default () => 'x'.repeat(1048577)`
])('blocks untrusted escape/bypass code: %s', async (code) => {
  await expect(service.execute(request(code), identity)).rejects.toThrow('Execution rejected');
});
it("does not inherit DB, artifacts, publisher credentials or another run's module state", async () => {
  const code = `let count = 0; export default (_db) => ({ count: ++count, publisher: typeof globalThis.CLOUDFLARE_API_TOKEN, db: typeof globalThis.DB });`;
  const [a, b] = await Promise.all([
    service.execute(request(code), identity),
    service.execute(request(code), identity)
  ]);
  expect(a.value).toEqual({ count: 1, publisher: 'undefined', db: 'undefined' });
  expect(b.value).toEqual(a.value);
});
