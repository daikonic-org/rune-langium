// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSoniaOisRefresh, curveAcquisitionPartitions } from '../scripts/refresh-curves.mjs';
import { runCatalogRefresh } from '../scripts/refresh-all.mjs';
import { acquisition } from './helpers/curves.js';
import { nativeBenchmarkCatalog } from './helpers/catalog.js';
import { querySoniaOisCurve } from '../src/catalog/curves.js';

it('partitions a month boundary without silently substituting an incomplete archive for current-month data', () => {
  expect(curveAcquisitionPartitions({ startDate: '2026-10-29', endDate: '2026-11-04' }, '2026-11-05')).toEqual([
    { startDate: '2026-10-29', endDate: '2026-10-31', source: 'archive' },
    { startDate: '2026-11-01', endDate: '2026-11-04', source: 'latest' }
  ]);
  expect(curveAcquisitionPartitions({ startDate: '2026-10-01', endDate: '2026-10-20' }, '2026-11-05')[0].source).toBe(
    'archive'
  );
  expect(curveAcquisitionPartitions({ startDate: '2026-11-01', endDate: '2026-11-04' }, '2026-11-05')[0].source).toBe(
    'latest'
  );
});
it('validates a saved intermediate without network, credentials or dry-run writes, then imports through the same publisher', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sonia-ci-'));
  const store = nativeBenchmarkCatalog();
  try {
    const path = join(directory, 'input.json'),
      report = join(directory, 'report.json');
    await writeFile(path, JSON.stringify(await acquisition()));
    const args = ['--import', path, '--report', report];
    const denied = {
      migrate() {
        throw new Error('Dry run wrote');
      }
    };
    expect(await runSoniaOisRefresh([...args, '--dry-run'], {}, denied)).toBe(0);
    expect(JSON.parse(await readFile(report, 'utf8'))).toMatchObject({
      dryRun: true,
      success: true,
      results: [{ pointCount: 4, outcome: 'updated' }]
    });
    expect(await runSoniaOisRefresh(args, {}, store)).toBe(0);
    expect(
      (await querySoniaOisCurve(store.db, { date: '2026-11-06', kind: 'spot', grid: 'monthly' })).points[0].value
    ).toBe('0.0425');
    const text = await readFile(report, 'utf8');
    expect(text).not.toContain('archiveBase64');
    expect(text).not.toContain('bankofengland');
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
it('attempts curves when the fixing refresh fails and aggregates sanitized outcomes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sonia-ci-'));
  const called = [];
  try {
    const report = join(directory, 'report.json');
    const runner = (name, success) => async (args) => {
      called.push(name);
      const path = args[args.indexOf('--report') + 1];
      await writeFile(
        path,
        JSON.stringify({ success, results: [{ series: name, outcome: success ? 'updated' : 'failed' }] })
      );
      return success ? 0 : 1;
    };
    expect(
      await runCatalogRefresh(['--series', 'sofr,sonia-ois', '--report', report, '--dry-run'], {}, undefined, {
        benchmarks: runner('sofr', false),
        curves: runner('sonia-ois', true)
      })
    ).toBe(1);
    expect(called).toEqual(['sofr', 'sonia-ois']);
    expect(JSON.parse(await readFile(report, 'utf8'))).toMatchObject({
      success: false,
      results: [
        { series: 'sofr', outcome: 'failed' },
        { series: 'sonia-ois', outcome: 'updated' }
      ]
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('reports empty captures without a catalog publication or credential requirement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sonia-empty-'));
  try {
    const path = join(directory, 'input.json'),
      report = join(directory, 'report.json');
    const empty = await acquisition();
    empty.snapshot.points = [];
    await writeFile(path, JSON.stringify(empty));
    expect(
      await runSoniaOisRefresh(
        ['--import', path, '--report', report],
        {},
        {
          migrate() {
            throw new Error('Unexpected write');
          }
        }
      )
    ).toBe(0);
    expect(JSON.parse(await readFile(report, 'utf8'))).toMatchObject({
      success: true,
      results: [{ outcome: 'empty', pointCount: 0 }]
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('names every affected dataset when a runner cannot initialize without exposing its exception', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-init-'));
  try {
    const report = join(directory, 'report.json');
    const failed = async () => {
      throw new Error('private-credential-error');
    };
    expect(
      await runCatalogRefresh(['--series', 'sofr,sonia,sonia-ois', '--report', report], {}, undefined, {
        benchmarks: failed,
        curves: failed
      })
    ).toBe(1);
    const text = await readFile(report, 'utf8');
    expect(text).not.toContain('private-credential-error');
    expect(JSON.parse(text).results.map((r) => r.series)).toEqual(['sofr', 'sonia', 'sonia-ois']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
