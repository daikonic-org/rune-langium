// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CatalogWindow, refreshBenchmarkCatalog, publishBenchmarkSnapshot } from '../dist/catalog/catalog.js';
import { remoteBenchmarkCatalog } from './remote.mjs';

export function refreshArguments(args, now = new Date()) {
  const { values } = parseArgs({
    args,
    options: {
      start: { type: 'string' },
      end: { type: 'string' },
      series: { type: 'string' },
      report: { type: 'string', default: '../../dist/market-data-refresh/report.json' },
      'dry-run': { type: 'boolean', default: false },
      import: { type: 'string', multiple: true }
    }
  });
  if (Boolean(values.start) !== Boolean(values.end)) throw new Error('Supply both start and end dates.');
  const endDate = values.end ?? now.toISOString().slice(0, 10);
  const start = new Date(`${endDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 6);
  const window = CatalogWindow.parse({ startDate: values.start ?? start.toISOString().slice(0, 10), endDate });
  return {
    window,
    series: values.series?.split(','),
    report: resolve(values.report),
    dryRun: values['dry-run'],
    imports: values.import
  };
}

export async function runBenchmarkRefresh(args, env = process.env, injected) {
  const options = refreshArguments(args);
  const denied = async () => {
    throw new Error('Dry run attempted a catalog write.');
  };
  const store =
    injected ??
    (options.dryRun
      ? { db: { query: denied, values: denied, batch: denied }, artifacts: { get: denied, put: denied } }
      : remoteBenchmarkCatalog(env));
  const runId = `github:${env.GITHUB_RUN_ID ?? 'local'}:${env.GITHUB_RUN_ATTEMPT ?? '1'}`;
  let report;
  try {
    if (!options.dryRun) await store.migrate();
    if (options.imports?.length) {
      const { readFile } = await import('node:fs/promises');
      const results = [];
      for (const path of options.imports) {
        try {
          const { stat } = await import('node:fs/promises');
          if ((await stat(path)).size > 16 * 1024 * 1024) throw new Error('Snapshot import too large.');
          const snapshot = JSON.parse(await readFile(path, 'utf8'));
          if (options.dryRun) {
            const { readBenchmarkSnapshot } = await import('@rune-langium/project-runtime/market-data');
            await readBenchmarkSnapshot(snapshot);
            results.push({ outcome: 'validated' });
          } else results.push(await publishBenchmarkSnapshot(store.db, store.artifacts, snapshot));
        } catch {
          results.push({ outcome: 'failed', phase: 'import' });
        }
      }
      report = {
        schemaVersion: 1,
        dryRun: options.dryRun,
        success: results.every((r) => r.outcome !== 'failed'),
        results
      };
    } else
      report = await refreshBenchmarkCatalog({
        ...store,
        window: options.window,
        series: options.series,
        runId,
        dryRun: options.dryRun
      });
  } catch {
    report = { schemaVersion: 1, success: false, results: [], error: 'Catalog initialization failed.' };
  }
  await mkdir(dirname(options.report), { recursive: true });
  await writeFile(options.report, JSON.stringify(report, null, 2) + '\n');
  return report.success ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = await runBenchmarkRefresh(process.argv.slice(2));
  } catch {
    console.error('Invalid benchmark refresh configuration.');
    process.exitCode = 1;
  }
}
