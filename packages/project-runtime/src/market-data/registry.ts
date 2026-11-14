// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';

export const BenchmarkSeriesSchema = z.enum(['sofr', 'sonia', 'estr', 'sofr-index', 'sonia-index', 'estr-index']);
export type BenchmarkSeries = z.infer<typeof BenchmarkSeriesSchema>;
type Definition = { provider: 'ny-fed' | 'boe' | 'ecb'; series: string; cdmCode: string; unit: 'percent' | 'index' };
/** Exact public series and CDM identities; term, average and vendor variants are deliberately distinct. */
export const BENCHMARK_SERIES: Readonly<Record<BenchmarkSeries, Readonly<Definition>>> = {
  sofr: { provider: 'ny-fed', series: 'sofr', cdmCode: 'USD_SOFR', unit: 'percent' },
  sonia: { provider: 'boe', series: 'IUDSOIA', cdmCode: 'GBP_SONIA', unit: 'percent' },
  estr: { provider: 'ecb', series: 'B.EU000A2X2A25.WT', cdmCode: 'EUR_EuroSTR', unit: 'percent' },
  'sofr-index': { provider: 'ny-fed', series: 'sofrai', cdmCode: 'USD_SOFR_Compounded_Index', unit: 'index' },
  'sonia-index': { provider: 'boe', series: 'IUDZOS2', cdmCode: 'GBP_SONIA_Compounded_Index', unit: 'index' },
  'estr-index': { provider: 'ecb', series: 'B.EU000A2QQF08.CI', cdmCode: 'EUR_EuroSTR_Compounded_Index', unit: 'index' }
};
