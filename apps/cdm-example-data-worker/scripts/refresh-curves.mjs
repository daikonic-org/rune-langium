// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, stat, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { refreshArguments } from './refresh.mjs';
import { remoteBenchmarkCatalog } from './remote.mjs';
import { readSoniaOisAcquisition, SONIA_OIS_URLS } from '../dist/catalog/curve-contracts.js';
import { publishSoniaOisSnapshot } from '../dist/catalog/curves.js';

const execute = promisify(execFile);
/** Current-month workbooks and the monthly archive have different publication coverage. */
export function curveAcquisitionPartitions(window, today = new Date().toISOString().slice(0, 10), source) {
  if (source) {
    if (!['latest', 'archive'].includes(source)) throw new Error('Invalid curve source profile.');
    return [{ ...window, source }];
  }
  const month = today.slice(0, 7) + '-01';
  if (window.startDate >= month) return [{ ...window, source: 'latest' }];
  if (window.endDate < month) return [{ ...window, source: 'archive' }];
  const previous = new Date(month + 'T00:00:00Z');
  previous.setUTCDate(0);
  return [
    { startDate: window.startDate, endDate: previous.toISOString().slice(0, 10), source: 'archive' },
    { startDate: month, endDate: window.endDate, source: 'latest' }
  ];
}
/** The maintained native spreadsheet reader stays in CI; Workers and browser runtimes never load it. */
export async function runSoniaOisRefresh(args, env = process.env, injected) {
  const { values } = parseArgs({
    args,
    options: {
      start: { type: 'string' },
      end: { type: 'string' },
      source: { type: 'string' },
      report: { type: 'string' },
      'dry-run': { type: 'boolean' },
      import: { type: 'string' }
    }
  });
  const options = refreshArguments([
    '--report',
    values.report ?? '../../dist/market-data-refresh/curves.json',
    ...(values.start ? ['--start', values.start] : []),
    ...(values.end ? ['--end', values.end] : []),
    ...(values['dry-run'] ? ['--dry-run'] : [])
  ]);
  const partitions = curveAcquisitionPartitions(options.window, undefined, values.source);
  const directory = await mkdtemp(join(tmpdir(), 'rune-sonia-ois-'));
  let phase = 'acquire',
    store,
    report;
  const checkedAt = () => new Date().toISOString();
  const result = {
    id: env.GITHUB_RUN_ID
      ? `github:${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT ?? '1'}`
      : `local:${crypto.randomUUID()}`,
    series: 'sonia-ois',
    pointCount: 0
  };
  try {
    const acquisitions = [];
    for (const [index, partition] of (values.import ? [partitions[0]] : partitions).entries()) {
      const path = values.import ? resolve(values.import) : join(directory, `acquisition-${index}.json`);
      if (!values.import) {
        const archive = join(directory, `source-${index}.zip`);
        const response = await execute(
          'curl',
          [
            '--fail',
            '--location',
            '--proto',
            '=https',
            '--proto-redir',
            '=https',
            '--max-redirs',
            '3',
            '--silent',
            '--show-error',
            '--max-time',
            '45',
            SONIA_OIS_URLS[partition.source === 'latest' ? 0 : 1]
          ],
          { encoding: 'buffer', timeout: 50000, maxBuffer: 16 * 1024 * 1024 }
        );
        const capturedAt = new Date().toISOString();
        await writeFile(archive, response.stdout, { flag: 'wx' });
        await execute(
          env.PYTHON_BINARY ?? 'python3',
          [
            fileURLToPath(new URL('./sonia-ois/read.py', import.meta.url)),
            '--start',
            partition.startDate,
            '--end',
            partition.endDate,
            '--source',
            partition.source,
            '--archive',
            archive,
            '--retrieved-at',
            capturedAt,
            '--output',
            path
          ],
          { timeout: 90000, maxBuffer: 1024 * 1024 }
        );
      }
      if ((await stat(path)).size > 40 * 1024 * 1024) throw new Error('Curve import exceeds its bound.');
      const acquisition = await readSoniaOisAcquisition(JSON.parse(await readFile(path, 'utf8')));
      if (
        !values.import &&
        (acquisition.snapshot.window.startDate !== partition.startDate ||
          acquisition.snapshot.window.endDate !== partition.endDate)
      )
        throw new Error('Curve acquisition window mismatch.');
      acquisitions.push(acquisition);
    }
    const nonempty = acquisitions.filter((a) => a.snapshot.points.length);
    result.pointCount = nonempty.reduce((n, a) => n + a.snapshot.points.length, 0);
    result.latestDate = nonempty
      .map((a) => a.snapshot.points.at(-1).date)
      .sort()
      .at(-1);
    phase = 'publish';
    result.outcome = nonempty.length ? 'updated' : 'empty';
    if (!options.dryRun && nonempty.length) {
      store = injected ?? remoteBenchmarkCatalog(env);
      await store.migrate();
      const publications = [];
      for (const acquisition of nonempty)
        publications.push(await publishSoniaOisSnapshot(store.db, store.artifacts, acquisition));
      result.publications = publications;
      if (publications.every((p) => p.outcome === 'unchanged')) result.outcome = 'unchanged';
      if (publications.length === 1) result.snapshotId = publications[0].snapshotId;
    }
    phase = 'complete';
  } catch {
    result.outcome = 'failed';
  } finally {
    result.phase = phase;
    result.checkedAt = checkedAt();
    if (store)
      try {
        await store.db.batch([
          {
            sql: `INSERT INTO curve_runs(id,series,checked_at,outcome,phase,snapshot_id,latest_date,point_count)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id,series) DO UPDATE SET checked_at=excluded.checked_at,outcome=excluded.outcome,
        phase=excluded.phase,snapshot_id=excluded.snapshot_id,latest_date=excluded.latest_date,point_count=excluded.point_count`,
            params: [
              result.id,
              result.series,
              result.checkedAt,
              result.outcome,
              result.phase,
              result.snapshotId ?? null,
              result.latestDate ?? null,
              result.pointCount
            ]
          }
        ]);
      } catch {
        result.outcome = 'failed';
        result.phase = 'publish';
      }
    report = {
      schemaVersion: 1,
      dryRun: options.dryRun,
      window: options.window,
      success: result.outcome !== 'failed',
      results: [result]
    };
    await mkdir(dirname(options.report), { recursive: true });
    await writeFile(options.report, JSON.stringify(report, null, 2) + '\n');
    await rm(directory, { recursive: true, force: true });
  }
  return report.success ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = await runSoniaOisRefresh(process.argv.slice(2));
  } catch {
    console.error('Invalid curve refresh configuration.');
    process.exitCode = 1;
  }
}
