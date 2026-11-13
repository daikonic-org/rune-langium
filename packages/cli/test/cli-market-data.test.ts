// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMarketData } from '../src/market-data.js';
import { benchmarkFetch } from '../../../test/helpers/benchmark-feeds.js';
import { readBenchmarkSnapshot } from '@rune-langium/project-runtime/market-data';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rune-benchmarks-'));
  vi.stubGlobal('fetch', vi.fn(benchmarkFetch));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
const options = () => ({
  start: '2026-11-02',
  end: '2026-11-03',
  output: join(root, 'model', 'benchmarks'),
  json: true
});

it('writes all six verified snapshots and an ordinary Rune override into a new directory', async () => {
  expect(await runMarketData(options())).toBe(0);
  expect(await readdir(options().output)).toHaveLength(7);
  expect(await readFile(join(options().output, 'market-observations.rosetta'), 'utf8')).toContain(
    'override namespace impl.cdm.market'
  );
  const stored = JSON.parse(await readFile(join(options().output, 'estr.json'), 'utf8'));
  expect((await readBenchmarkSnapshot(stored)).observations[0]?.value).toBe(0.025);
  expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])).status).toBe('success');
});
it('leaves existing output and user edits untouched', async () => {
  await mkdir(options().output, { recursive: true });
  await writeFile(join(options().output, 'mine.rosetta'), 'user work');
  expect(await runMarketData(options())).toBe(1);
  expect(await readdir(options().output)).toEqual(['mine.rosetta']);
  expect(await readFile(join(options().output, 'mine.rosetta'), 'utf8')).toBe('user work');
  expect(fetch).not.toHaveBeenCalled();
});
it('does not create partial output when a selected feed fails', async () => {
  vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
  expect(await runMarketData(options())).toBe(1);
  expect(await readdir(root)).toEqual([]);
});
it('rejects unknown series before network access and emits a JSON failure receipt', async () => {
  expect(await runMarketData({ ...options(), series: ['term-sofr'] })).toBe(1);
  expect(fetch).not.toHaveBeenCalled();
  expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])).status).toBe('failed');
});
