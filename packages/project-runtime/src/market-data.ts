// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { projectFileRevision } from '@rune-langium/project-config';
import { readStreamBytes } from './read-stream.js';
import { benchmarkCsv } from './market-data/csv.js';

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
const MAX_BYTES = 2 * 1024 * 1024;
const windowSchema = z
  .strictObject({ startDate: z.iso.date(), endDate: z.iso.date() })
  .superRefine((window, context) => {
    const days = (Date.parse(window.endDate) - Date.parse(window.startDate)) / 86400000;
    if (days < 0 || days > 365)
      context.addIssue({ code: 'custom', message: 'Choose an ordered window of at most 366 dates.' });
  });
export const BenchmarkSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  series: BenchmarkSeriesSchema,
  window: windowSchema,
  source: z.strictObject({
    url: z.url(),
    retrievedAt: z.iso.datetime(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    lastModified: z.string().optional(),
    etag: z.string().optional()
  }),
  content: z.string().max(MAX_BYTES)
});
/** Exact saved response bytes represented as UTF-8 text; normalized observations are derived, never duplicated. */
export type BenchmarkSnapshot = z.infer<typeof BenchmarkSnapshotSchema>;
export interface BenchmarkObservation {
  date: string;
  sourceValue: string;
  value: number;
  status?: string;
  revision?: string;
}
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function boeDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${months[Number(month) - 1]}/${year}`;
}

/** Fixed official endpoints only; saved URLs are provenance, not future fetch instructions. */
export function benchmarkUrl(series: BenchmarkSeries, window: { startDate: string; endDate: string }): string {
  BenchmarkSeriesSchema.parse(series);
  windowSchema.parse(window);
  const definition = BENCHMARK_SERIES[series];
  if (definition.provider === 'ny-fed') {
    const url = new URL(`https://markets.newyorkfed.org/api/rates/secured/${definition.series}/search.json`);
    url.search = new URLSearchParams({ startDate: window.startDate, endDate: window.endDate }).toString();
    return url.href;
  }
  if (definition.provider === 'boe') {
    const url = new URL('https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp');
    url.search = new URLSearchParams({
      'csv.x': 'yes',
      Datefrom: boeDate(window.startDate),
      Dateto: boeDate(window.endDate),
      SeriesCodes: definition.series,
      CSVF: 'TN',
      UsingCodes: 'Y',
      VPD: 'Y',
      VFD: 'N'
    }).toString();
    return url.href;
  }
  const url = new URL(`https://data-api.ecb.europa.eu/service/data/EST/${definition.series}`);
  url.search = new URLSearchParams({
    startPeriod: window.startDate,
    endPeriod: window.endDate,
    format: 'csvdata'
  }).toString();
  return url.href;
}

/** Convert decimal percent spellings before numeric conversion, avoiding binary division artifacts. */
function decimalValue(text: string, unit: Definition['unit']): string {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) || text.length > 64)
    throw new Error('Expected a finite decimal benchmark value.');
  const sign = text.startsWith('-') ? '-' : '';
  const [whole = '', fraction = ''] = text.replace(/^-/, '').split('.');
  const padded = whole.padStart(3, '0');
  return unit === 'percent' ? `${sign}${padded.slice(0, -2)}.${padded.slice(-2)}${fraction}` : text;
}
const nyFed = z.object({
  refRates: z.array(
    z.object({
      effectiveDate: z.iso.date(),
      type: z.string(),
      percentRate: z.number().optional(),
      index: z.number().optional(),
      revisionIndicator: z.string()
    })
  )
});

/** Verify provenance and derive the same observations for acquisition, reopening and Rune materialization. */
export async function readBenchmarkSnapshot(
  input: unknown
): Promise<{ snapshot: BenchmarkSnapshot; observations: BenchmarkObservation[] }> {
  const snapshot = BenchmarkSnapshotSchema.parse(input);
  const definition = BENCHMARK_SERIES[snapshot.series];
  if (snapshot.source.url !== benchmarkUrl(snapshot.series, snapshot.window))
    throw new Error('Benchmark source identity differs from its series/window.');
  if (new TextEncoder().encode(snapshot.content).length > MAX_BYTES)
    throw new Error('Benchmark response exceeds its size limit.');
  if ((await projectFileRevision(snapshot.content)) !== snapshot.source.sha256)
    throw new Error('Benchmark response checksum mismatch.');
  const observations: BenchmarkObservation[] = [];
  const add = (date: string, sourceValue: string, metadata: { status?: string; revision?: string } = {}) => {
    z.iso.date().parse(date);
    if (date < snapshot.window.startDate || date > snapshot.window.endDate)
      throw new Error('Benchmark date outside the requested window.');
    const value = Number(decimalValue(sourceValue, definition.unit));
    if (!Number.isFinite(value) || (definition.unit === 'index' && value <= 0))
      throw new Error('Invalid benchmark value.');
    observations.push({ date, sourceValue, value, ...metadata });
  };
  if (definition.provider === 'ny-fed') {
    const data = nyFed.parse(JSON.parse(snapshot.content.replace(/^\uFEFF/, '')));
    for (const row of data.refRates) {
      if (row.type !== definition.series.toUpperCase()) throw new Error('Unexpected NY Fed benchmark series.');
      const value = definition.unit === 'percent' ? row.percentRate : row.index;
      if (value === undefined) throw new Error('Missing NY Fed benchmark value.');
      add(row.effectiveDate, String(value), { revision: row.revisionIndicator });
    }
  } else {
    const { headers, rows } = benchmarkCsv(snapshot.content);
    const required =
      definition.provider === 'boe'
        ? ['DATE', definition.series]
        : ['KEY', 'TIME_PERIOD', 'OBS_VALUE', 'OBS_STATUS', 'UNIT_MEASURE', 'UNIT_MULT'];
    if (!required.every((name) => headers.includes(name))) throw new Error('Unexpected benchmark CSV series/header.');
    for (const row of rows) {
      if (definition.provider === 'boe') {
        const match = /^(\d{2}) ([A-Za-z]{3}) (\d{4})$/.exec(row.DATE ?? '');
        const month = months.indexOf(match?.[2] ?? '') + 1;
        if (!match || !month || row[definition.series] === undefined)
          throw new Error('Unexpected Bank of England series/date.');
        add(`${match[3]}-${String(month).padStart(2, '0')}-${match[1]}`, row[definition.series] ?? '');
      } else {
        if (
          row.KEY !== `EST.${definition.series}` ||
          row.UNIT_MEASURE !== (definition.unit === 'percent' ? 'PC' : 'IX') ||
          row.UNIT_MULT !== '0'
        )
          throw new Error('Unexpected ECB series or units.');
        add(row.TIME_PERIOD ?? '', row.OBS_VALUE ?? '', { status: row.OBS_STATUS ?? '' });
      }
    }
  }
  if (new Set(observations.map((row) => row.date)).size !== observations.length)
    throw new Error('Duplicate benchmark observation date.');
  observations.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { snapshot, observations };
}

/** Acquisition is explicit and bounded; builds and calculations never call this function implicitly. */
export async function fetchBenchmarkSnapshot(
  series: BenchmarkSeries,
  window: { startDate: string; endDate: string },
  options: { fetcher?: typeof fetch; signal?: AbortSignal; now?: () => string } = {}
): Promise<BenchmarkSnapshot> {
  const url = benchmarkUrl(series, window);
  const timeout = AbortSignal.timeout(30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await (options.fetcher ?? fetch)(url, {
    signal,
    credentials: 'omit',
    redirect: 'error',
    headers: { Accept: 'application/json,text/csv,*/*', 'User-Agent': 'RuneBenchmarks/0.1' }
  });
  if (!response.ok) throw new Error(`${series} data unavailable (${response.status}).`);
  if (!response.body) throw new Error(`${series} returned no response body.`);
  const bytes = await readStreamBytes(response.body, MAX_BYTES, 'Benchmark response exceeds its size limit.');
  const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const snapshot = BenchmarkSnapshotSchema.parse({
    schemaVersion: 1,
    series,
    window,
    source: {
      url,
      retrievedAt: options.now?.() ?? new Date().toISOString(),
      sha256: await projectFileRevision(content),
      ...(response.headers.get('last-modified') ? { lastModified: response.headers.get('last-modified') } : {}),
      ...(response.headers.get('etag') ? { etag: response.headers.get('etag') } : {})
    },
    content
  });
  await readBenchmarkSnapshot(snapshot);
  return snapshot;
}

/** Produce an ordinary portable override, retaining the canonical missing/ambiguous-date guards in its callers. */
export async function renderBenchmarkProvider(inputs: readonly unknown[]): Promise<string> {
  const decoded = await Promise.all(inputs.map(readBenchmarkSnapshot));
  if (!decoded.length || new Set(decoded.map(({ snapshot }) => snapshot.series)).size !== decoded.length)
    throw new Error('Supply one snapshot per benchmark series.');
  decoded.sort((a, b) => (a.snapshot.series < b.snapshot.series ? -1 : a.snapshot.series > b.snapshot.series ? 1 : 0));
  const branches = decoded.map(({ snapshot, observations }) => {
    const definition = BENCHMARK_SERIES[snapshot.series];
    const records = observations.map((row) => {
      const [year, month, day] = row.date.split('-').map(Number);
      return `DatedValue { date: date { year: ${year}, month: ${month}, day: ${day} }, value: ${decimalValue(row.sourceValue, definition.unit)} }`;
    });
    return `if code = FloatingRateIndexEnum -> ${definition.cdmCode}\n        then ${records.length ? `[\n            ${records.join(',\n            ')}\n        ]` : 'empty'}`;
  });
  const supported = decoded
    .map(({ snapshot }) => `code = FloatingRateIndexEnum -> ${BENCHMARK_SERIES[snapshot.series].cdmCode}`)
    .join(' or ');
  return `// SPDX-License-Identifier: MIT
// Generated benchmark provider; snapshot responses retain their source terms.
${decoded.map(({ snapshot }) => `// ${snapshot.series}: ${snapshot.source.url}\n// Retrieved ${snapshot.source.retrievedAt}; SHA-256 ${snapshot.source.sha256}`).join('\n')}
override namespace impl.cdm.market
version "1.0.0"
import cdm.base.math.DatedValue
import cdm.base.datetime.PeriodEnum
import cdm.base.staticdata.asset.rates.FloatingRateIndexEnum
import cdm.observable.asset.InterestRateIndex
import cdm.observable.asset.FloatingRateIndex

func ReadMarketObservations:
    inputs:
        index InterestRateIndex (1..1)
        dates date (1..*)
    output:
        observations DatedValue (0..*)
    alias floating: index as FloatingRateIndex
    alias code: floating -> floatingRateIndex
    alias tenor: floating -> indexTenor
    condition BenchmarkIndexSupported:
        floating exists and (${supported})
    condition BenchmarkTenorSupported:
        tenor is absent or (tenor -> period = PeriodEnum -> D and tenor -> periodMultiplier = 1)
    set observations:
        (${branches.join('\n        else ')}\n        else empty) filter [dates contains (item -> date)]
`;
}
