// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import type { BenchmarkSeries } from '../../packages/project-runtime/src/market-data/registry.js';

// Synthetic data in the official response formats; never downloaded during tests.
export const benchmarkWindow = { startDate: '2026-11-02', endDate: '2026-11-03' };
export const benchmarkFeeds: Record<BenchmarkSeries, { content: string; expected: number[] }> = {
  sofr: {
    content: JSON.stringify({
      refRates: [
        { effectiveDate: '2026-11-03', type: 'SOFR', percentRate: 4.32, revisionIndicator: 'R' },
        { effectiveDate: '2026-11-02', type: 'SOFR', percentRate: 4.33, revisionIndicator: '' }
      ]
    }),
    expected: [0.0433, 0.0432]
  },
  sonia: { content: '\uFEFFDATE,IUDSOIA\r\n02 Nov 2026,4.2\r\n03 Nov 2026,-0.01\r\n', expected: [0.042, -0.0001] },
  estr: {
    content:
      'KEY,TIME_PERIOD,OBS_VALUE,OBS_STATUS,UNIT_MEASURE,UNIT_MULT,COMMENT_OBS\r\nEST.B.EU000A2X2A25.WT,2026-11-02,2.5,A,PC,0,"quoted, detail\r\nsecond line"\r\nEST.B.EU000A2X2A25.WT,2026-11-03,0,P,PC,0,"a ""quote"""\r\n',
    expected: [0.025, 0]
  },
  'sofr-index': {
    content: JSON.stringify({
      refRates: [
        { effectiveDate: '2026-11-02', type: 'SOFRAI', index: 1.12345678, average30day: 4.33, revisionIndicator: '' },
        { effectiveDate: '2026-11-03', type: 'SOFRAI', index: 1.1236, revisionIndicator: '' }
      ]
    }),
    expected: [1.12345678, 1.1236]
  },
  'sonia-index': {
    content: 'DATE,IUDZOS2\r\n02 Nov 2026,123.12345678\r\n03 Nov 2026,123.456\r\n',
    expected: [123.12345678, 123.456]
  },
  'estr-index': {
    content:
      'KEY,TIME_PERIOD,OBS_VALUE,OBS_STATUS,UNIT_MEASURE,UNIT_MULT\r\nEST.B.EU000A2QQF08.CI,2026-11-02,110.12345678,A,IX,0\r\nEST.B.EU000A2QQF08.CI,2026-11-03,110.456,A,IX,0\r\n',
    expected: [110.12345678, 110.456]
  }
};

export const benchmarkFetch: typeof fetch = async (input) => {
  const url = new URL(String(input));
  let series: BenchmarkSeries;
  if (url.hostname === 'markets.newyorkfed.org') series = url.pathname.includes('/sofrai/') ? 'sofr-index' : 'sofr';
  else if (url.hostname === 'www.bankofengland.co.uk')
    series = url.searchParams.get('SeriesCodes') === 'IUDZOS2' ? 'sonia-index' : 'sonia';
  else if (url.hostname === 'data-api.ecb.europa.eu') series = url.pathname.endsWith('.CI') ? 'estr-index' : 'estr';
  else throw new Error('Unexpected test source host.');
  return new Response(benchmarkFeeds[series].content, {
    headers: { 'last-modified': 'Fri, 13 Nov 2026 07:05:17 GMT', etag: '"fixture"' }
  });
};
