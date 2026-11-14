// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { expect, it, vi } from 'vitest';
import {
  BenchmarkSeriesSchema,
  benchmarkUrl,
  fetchBenchmarkSnapshot,
  readBenchmarkSnapshot,
  renderBenchmarkProvider
} from '../src/market-data.js';
import { benchmarkFeeds, benchmarkFetch, benchmarkWindow } from '../../../test/helpers/benchmark-feeds.js';
import { benchmarkCsv } from '../src/market-data/csv.js';

it.each(BenchmarkSeriesSchema.options)(
  'acquires and reopens %s with raw provenance and correct rate/index units',
  async (series) => {
    const fetcher = vi.fn(benchmarkFetch);
    const snapshot = await fetchBenchmarkSnapshot(series, benchmarkWindow, {
      fetcher,
      now: () => '2026-11-13T12:00:00.000Z'
    });
    const { observations } = await readBenchmarkSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(snapshot.content).toBe(benchmarkFeeds[series].content);
    expect(snapshot.source).toMatchObject({
      retrievedAt: '2026-11-13T12:00:00.000Z',
      lastModified: 'Fri, 13 Nov 2026 07:05:17 GMT',
      etag: '"fixture"'
    });
    expect(observations.map((row) => row.value)).toEqual(benchmarkFeeds[series].expected);
    expect(observations.map((row) => row.date)).toEqual(['2026-11-02', '2026-11-03']);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/^https:/),
      expect.objectContaining({ redirect: 'error', credentials: 'omit', signal: expect.any(AbortSignal) })
    );
    if (series === 'sofr') expect(observations[1]?.revision).toBe('R');
    if (series === 'estr') expect(observations[1]?.status).toBe('P');
  }
);

it('sends observation date ranges and exact official series, including BoE dates and ECB keys', () => {
  expect(benchmarkUrl('sofr', benchmarkWindow)).toBe(
    'https://markets.newyorkfed.org/api/rates/secured/sofr/search.json?startDate=2026-11-02&endDate=2026-11-03'
  );
  const boe = new URL(benchmarkUrl('sonia', benchmarkWindow));
  expect(Object.fromEntries(boe.searchParams)).toMatchObject({
    Datefrom: '02/Nov/2026',
    Dateto: '03/Nov/2026',
    SeriesCodes: 'IUDSOIA',
    CSVF: 'TN'
  });
  expect(new URL(benchmarkUrl('estr-index', benchmarkWindow)).pathname).toBe('/service/data/EST/B.EU000A2QQF08.CI');
});

it.each([
  { startDate: '2026-02-29', endDate: '2026-03-01' },
  { startDate: '2026-11-03', endDate: '2026-11-02' },
  { startDate: '2025-01-01', endDate: '2026-01-02' }
])('rejects invalid, reversed or oversized date windows before fetching', async (window) => {
  const fetcher = vi.fn(benchmarkFetch);
  await expect(fetchBenchmarkSnapshot('sofr', window, { fetcher })).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it('rejects saved content corruption and mismatched provenance', async () => {
  const snapshot = await fetchBenchmarkSnapshot('sofr', benchmarkWindow, { fetcher: benchmarkFetch });
  await expect(readBenchmarkSnapshot({ ...snapshot, content: snapshot.content + ' ' })).rejects.toThrow('checksum');
  await expect(
    readBenchmarkSnapshot({ ...snapshot, source: { ...snapshot.source, url: 'https://example.com' } })
  ).rejects.toThrow('identity');
});

it.each([
  ['wrong series', benchmarkFeeds.sofr.content.replaceAll('SOFR', 'EFFR')],
  ['missing value', '{"refRates":[{"effectiveDate":"2026-11-02","type":"SOFR","revisionIndicator":""}]}'],
  ['duplicate date', benchmarkFeeds.sofr.content.replaceAll('2026-11-03', '2026-11-02')],
  ['outside window', benchmarkFeeds.sofr.content.replaceAll('2026-11-03', '2026-11-04')],
  ['nonfinite value', benchmarkFeeds.sofr.content.replace('4.32', '1e999')]
])('rejects %s without returning partial observations', async (_name, content) => {
  await expect(
    fetchBenchmarkSnapshot('sofr', benchmarkWindow, { fetcher: async () => new Response(content) })
  ).rejects.toThrow();
});

it.each([
  benchmarkFeeds.estr.content.replaceAll(',PC,0,', ',IX,0,'),
  benchmarkFeeds.estr.content.replaceAll(',PC,0,', ',PC,2,'),
  benchmarkFeeds.estr.content.replaceAll('EST.B.EU000A2X2A25.WT', 'EST.B.Other.WT'),
  '<html>temporarily unavailable</html>',
  'NOT_THE_SERIES\r\n'
])('rejects wrong ECB identities, units and error pages', async (content) => {
  await expect(
    fetchBenchmarkSnapshot('estr', benchmarkWindow, { fetcher: async () => new Response(content) })
  ).rejects.toThrow();
});

it('accepts a valid empty publication window without inventing weekend fixings', async () => {
  const snapshot = await fetchBenchmarkSnapshot('sonia', benchmarkWindow, {
    fetcher: async () => new Response('DATE,IUDSOIA\r\n')
  });
  expect((await readBenchmarkSnapshot(snapshot)).observations).toEqual([]);
});

it('retains CSV text through BOMs, blank lines, quoted newlines and escaped quotes', () => {
  expect(benchmarkCsv('\uFEFFDATE,VALUE,NOTE\r\n\r\n2026-11-02,4.33,"First, ""quoted""\r\nsecond line"\r\n')).toEqual({
    headers: ['DATE', 'VALUE', 'NOTE'],
    rows: [{ DATE: '2026-11-02', VALUE: '4.33', NOTE: 'First, "quoted"\r\nsecond line' }]
  });
});

it.each(['', 'A,\n1,2\n', 'A,A\n1,2\n', 'A,B\n1\n', 'A,B\n1,2,3\n', 'A\n"unclosed', 'A\n"closed"bad', 'A\nnot"quoted'])(
  'rejects malformed CSV rather than shifting columns',
  (content) => {
    expect(() => benchmarkCsv(content)).toThrow();
  }
);

it('reports unavailable HTTP responses, cancels oversized bodies and forwards caller cancellation', async () => {
  await expect(
    fetchBenchmarkSnapshot('sofr', benchmarkWindow, { fetcher: async () => new Response('', { status: 503 }) })
  ).rejects.toThrow('sofr data unavailable (503)');
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
    },
    cancel
  });
  await expect(
    fetchBenchmarkSnapshot('sofr', benchmarkWindow, { fetcher: async () => new Response(body) })
  ).rejects.toThrow('size limit');
  expect(cancel).toHaveBeenCalledOnce();
  const controller = new AbortController();
  controller.abort();
  const fetcher: typeof fetch = async (_input, options) => {
    options?.signal?.throwIfAborted();
    return new Response();
  };
  await expect(
    fetchBenchmarkSnapshot('sofr', benchmarkWindow, { fetcher, signal: controller.signal })
  ).rejects.toThrow();
});

it('refuses ambiguous provider snapshots before generating source', async () => {
  const snapshot = await fetchBenchmarkSnapshot('sofr', benchmarkWindow, { fetcher: benchmarkFetch });
  await expect(renderBenchmarkProvider([snapshot, snapshot])).rejects.toThrow('one snapshot per');
  await expect(renderBenchmarkProvider([])).rejects.toThrow('one snapshot per');
});
