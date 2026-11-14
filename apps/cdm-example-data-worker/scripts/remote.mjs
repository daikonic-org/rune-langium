// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import Cloudflare from 'cloudflare';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const result = z.object({
  result: z.array(z.object({ success: z.literal(true), results: z.array(z.unknown()).optional() }))
});
const rawResult = z.object({
  result: z.array(z.object({ success: z.literal(true), results: z.object({ rows: z.array(z.array(z.unknown())) }) }))
});

/** CI uses the official SDK and Wrangler clients; Workers use their bindings instead. */
export function remoteBenchmarkCatalog(env = process.env, options = {}) {
  const account = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .parse(env.CLOUDFLARE_ACCOUNT_ID);
  const database = z.uuid().parse(env.CDM_EXAMPLE_DATA_DATABASE_ID);
  const token = z.string().min(1).parse(env.CLOUDFLARE_API_TOKEN);
  const bucket = z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/)
    .parse(env.CDM_EXAMPLE_DATA_BUCKET || 'rune-cdm-example-data');
  const api = options.api ?? new Cloudflare({ apiToken: token, maxRetries: 2, timeout: 30_000 });
  const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  const execute = options.execute ?? run;
  const request = async (body, count) => {
    const page = result.parse(await api.d1.database.query(database, { account_id: account, ...body }));
    if (page.result.length !== count) throw new Error('D1 returned an incomplete benchmark batch.');
    return page.result;
  };
  const db = {
    async query(statement) {
      return (await request(statement, 1))[0]?.results ?? [];
    },
    async values(statement) {
      const page = rawResult.parse(await api.d1.database.raw(database, { account_id: account, ...statement }));
      if (page.result.length !== 1) throw new Error('D1 returned incomplete benchmark rows.');
      return page.result[0].results.rows;
    },
    async batch(statements) {
      if (statements.length) await request({ batch: statements }, statements.length);
    }
  };
  const transfer = async (action, key, content) => {
    if (
      !/^market-data\/(raw\/[a-f0-9]{64}\.txt|snapshots\/[a-f0-9]{64}\.json|curves\/(?:raw|snapshots)\/[a-f0-9]{64}\.json)$/.test(
        key
      )
    )
      throw new Error('Invalid benchmark object key.');
    const directory = await mkdtemp(join(tmpdir(), 'rune-cdm-example-data-'));
    const path = join(directory, 'object');
    try {
      if (action === 'put') await writeFile(path, content, { flag: 'wx' });
      await execute(
        process.execPath,
        [wrangler, 'r2', 'object', action, `${bucket}/${key}`, '--file', path, '--remote'],
        {
          timeout: 60_000,
          maxBuffer: 512 * 1024,
          env: { ...env, WRANGLER_SEND_METRICS: 'false' },
          cwd: fileURLToPath(new URL('..', import.meta.url))
        }
      );
      if (action === 'get') {
        if ((await stat(path)).size > (key.startsWith('market-data/curves/') ? 40 : 16) * 1024 * 1024)
          throw new Error('Benchmark object exceeds its size limit.');
        return await readFile(path, 'utf8');
      }
    } catch (error) {
      if (
        action === 'get' &&
        error instanceof Error &&
        'stderr' in error &&
        typeof error.stderr === 'string' &&
        error.stderr.includes('The specified key does not exist.')
      )
        return undefined;
      throw new Error('Benchmark object transfer failed.');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
  const migrate = async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rune-market-migrations-'));
    try {
      const path = join(directory, 'wrangler.json');
      await writeFile(
        path,
        JSON.stringify({
          name: 'rune-cdm-example-data',
          compatibility_date: '2026-11-13',
          d1_databases: [
            {
              binding: 'DB',
              database_name: 'rune-cdm-example-data',
              database_id: database,
              migrations_dir: fileURLToPath(new URL('../migrations', import.meta.url))
            }
          ]
        })
      );
      await execute(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'DB', '--remote', '--config', path], {
        timeout: 120_000,
        maxBuffer: 512 * 1024,
        env: { ...env, WRANGLER_SEND_METRICS: 'false' },
        cwd: fileURLToPath(new URL('..', import.meta.url))
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
  return {
    db,
    migrate,
    artifacts: { get: (key) => transfer('get', key), put: (key, content) => transfer('put', key, content) }
  };
}
