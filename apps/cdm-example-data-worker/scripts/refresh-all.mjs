// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { parseArgs } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { BenchmarkSeriesSchema } from '@rune-langium/project-runtime/market-data';
import { runBenchmarkRefresh, refreshArguments } from './refresh.mjs';
import { runSoniaOisRefresh } from './refresh-curves.mjs';

/** A failed fixing source cannot suppress curve acquisition, or vice versa. */
export async function runCatalogRefresh(args, env = process.env, injected, runners = {}) {
  const { values } = parseArgs({
    args,
    options: {
      start: { type: 'string' },
      end: { type: 'string' },
      series: { type: 'string' },
      report: { type: 'string' },
      'dry-run': { type: 'boolean' }
    }
  });
  const series = values.series?.split(',') ?? [...BenchmarkSeriesSchema.options, 'sonia-ois'];
  if (
    !series.length ||
    new Set(series).size !== series.length ||
    series.some((s) => ![...BenchmarkSeriesSchema.options, 'sonia-ois'].includes(s))
  )
    throw new Error('Choose distinct supported catalog datasets.');
  const path = resolve(values.report ?? '../../dist/market-data-refresh/report.json');
  const common = [
    ...(values.start ? ['--start', values.start] : []),
    ...(values.end ? ['--end', values.end] : []),
    ...(values['dry-run'] ? ['--dry-run'] : [])
  ];
  refreshArguments(common); // Validate before credentials, network or writes.
  const reports = [];
  const jobs = [];
  const fixings = series.filter((s) => s !== 'sonia-ois');
  if (fixings.length)
    jobs.push({
      run: runners.benchmarks ?? runBenchmarkRefresh,
      args: [...common, '--series', fixings.join(',')],
      file: 'benchmarks.json',
      datasets: fixings
    });
  if (series.includes('sonia-ois'))
    jobs.push({
      run: runners.curves ?? runSoniaOisRefresh,
      args: common,
      file: 'curves.json',
      datasets: ['sonia-ois']
    });
  for (const job of jobs) {
    const report = join(dirname(path), job.file);
    const failed = () => job.datasets.map((series) => ({ series, outcome: 'failed', phase: 'initialize' }));
    try {
      await job.run([...job.args, '--report', report], env, injected);
      const result = JSON.parse(await readFile(report, 'utf8'));
      reports.push({ ...result, results: !result.success && !result.results.length ? failed() : result.results });
    } catch {
      reports.push({ success: false, results: failed() });
    }
  }
  const result = {
    schemaVersion: 1,
    dryRun: values['dry-run'] ?? false,
    success: reports.every((r) => r.success),
    results: reports.flatMap((r) => r.results)
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(result, null, 2) + '\n');
  return result.success ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = await runCatalogRefresh(process.argv.slice(2));
  } catch {
    console.error('Invalid catalog refresh configuration.');
    process.exitCode = 1;
  }
}
