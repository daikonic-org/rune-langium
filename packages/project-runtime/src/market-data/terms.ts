// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { BENCHMARK_SERIES, type BenchmarkSeries } from './registry.js';

/** Dataset rights travel with portable selections and generated provider source. */
export function benchmarkTerms(series: BenchmarkSeries): { url: string; attribution: string } {
  switch (BENCHMARK_SERIES[series].provider) {
    case 'boe':
      return {
        url: 'https://www.bankofengland.co.uk/legal',
        attribution:
          'SONIA and/or SONIA Compounded Index data licensed under the Open Government Licence v3.0 and copyright the Governor and Company of the Bank of England. The trade marks “Bank of England” and “SONIA” are registered trade marks of the Bank of England.'
      };
    case 'ecb':
      return {
        url: 'https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html',
        attribution: 'Source: European Central Bank. Rates converted from percent to decimal; index levels unchanged.'
      };
    case 'ny-fed':
      return {
        url: 'https://www.newyorkfed.org/aboutthefed/terms_of_use.html',
        attribution:
          'Source: Federal Reserve Bank of New York. Rates converted from percent to decimal; index levels unchanged.'
      };
  }
}
