// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { canonicalProjectJson, projectFileRevision } from '@rune-langium/project-config';
import { CatalogWindow, marketDecimalValue } from '@rune-langium/project-runtime/market-data';

const base = 'https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/';
export const SONIA_OIS_URLS = [base + 'latest-yield-curve-data.zip', base + 'oisddata.zip'] as const;
export const SONIA_OIS_DATASET = {
  series: 'sonia-ois',
  provider: 'Bank of England',
  currency: 'GBP',
  benchmark: 'GBP-SONIA',
  type: 'fitted-ois-curve',
  sourceUnit: 'percent',
  unit: 'annual-decimal-rate',
  compounding: 'continuous',
  dayCount: 'ACT/365.FIXED',
  accessScope: 'internal-noncommercial',
  terms: 'https://www.bankofengland.co.uk/legal',
  publication: 'Following business day; archive history may be revised.'
} as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const decimal = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/)
  .max(64);
export const SoniaOisPoint = z.strictObject({
  date: z.iso.date(),
  kind: z.enum(['spot', 'instantaneous-forward']),
  grid: z.enum(['monthly', 'semiannual']),
  maturityMonths: z.number().int().positive().max(600),
  maturityYears: decimal,
  sourceValue: decimal,
  workbook: z.string().min(1).max(150)
});
export const SoniaOisSnapshot = z.strictObject({
  schemaVersion: z.literal(1),
  series: z.literal('sonia-ois'),
  decoder: z.literal('boe-ois-xlsx-v1'),
  window: CatalogWindow,
  source: z.strictObject({
    url: z.enum(SONIA_OIS_URLS),
    sha256: hash,
    retrievedAt: z.iso.datetime(),
    workbooks: z
      .array(z.strictObject({ name: z.string().min(1).max(150), sha256: hash }))
      .min(1)
      .max(20)
  }),
  points: z.array(SoniaOisPoint).max(100000)
});
export type SoniaOisSnapshot = z.infer<typeof SoniaOisSnapshot>;
export const SoniaOisAcquisition = z.strictObject({
  snapshot: SoniaOisSnapshot,
  archiveBase64: z.string().max(24 * 1024 * 1024)
});

/** Validate the CI reader's versioned intermediate; hosts never implement another XLSX decoder. */
export function readSoniaOisSnapshot(input: unknown): SoniaOisSnapshot {
  const snapshot = SoniaOisSnapshot.parse(input);
  const books = new Set(snapshot.source.workbooks.map((book) => book.name));
  if (books.size !== snapshot.source.workbooks.length) throw new Error('Duplicate curve workbook identity.');
  for (const name of books)
    if (!/^OIS daily data(?: current month|_[0-9]{4} to (?:[0-9]{4}|present))\.xlsx$/.test(name))
      throw new Error('Unexpected curve workbook identity.');
  let previous = '';
  const groups = new Map<string, Set<string>>();
  for (const point of snapshot.points) {
    const key = [point.date, point.kind, point.grid, String(point.maturityMonths).padStart(3, '0')].join(':');
    if (key <= previous) throw new Error('Curve points must be distinct and canonically ordered.');
    previous = key;
    if (
      !books.has(point.workbook) ||
      point.date < snapshot.window.startDate ||
      point.date > snapshot.window.endDate ||
      point.date > snapshot.source.retrievedAt.slice(0, 10)
    )
      throw new Error('Curve date/workbook differs from capture identity.');
    const years = Number(point.maturityYears);
    if (
      !Number.isFinite(years) ||
      Math.abs(years * 12 - point.maturityMonths) > 0.000001 ||
      (point.grid === 'monthly' ? point.maturityMonths > 60 : point.maturityMonths % 6 !== 0)
    )
      throw new Error('Invalid curve maturity convention.');
    if (!Number.isFinite(Number(marketDecimalValue(point.sourceValue, 'percent'))))
      throw new Error('Non-finite curve value.');
    const set = groups.get(point.date) ?? new Set<string>();
    set.add(point.kind + ':' + point.grid);
    groups.set(point.date, set);
  }
  if ([...groups.values()].some((group) => group.size !== 4))
    throw new Error('Incomplete curve date: all four grids required.');
  return snapshot;
}
export async function soniaOisSnapshotId(snapshot: SoniaOisSnapshot): Promise<string> {
  return projectFileRevision(
    canonicalProjectJson({ dataset: SONIA_OIS_DATASET, snapshot: readSoniaOisSnapshot(snapshot) })
  );
}
export async function readSoniaOisAcquisition(input: unknown) {
  const { snapshot: supplied, archiveBase64 } = SoniaOisAcquisition.parse(input);
  const snapshot = readSoniaOisSnapshot(supplied);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(archiveBase64))
    throw new Error('Invalid curve archive encoding.');
  const bytes = Uint8Array.from(atob(archiveBase64), (character) => character.charCodeAt(0));
  if (bytes.length > 16 * 1024 * 1024) throw new Error('Curve archive too large.');
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  if (digest !== snapshot.source.sha256) throw new Error('Curve archive checksum mismatch.');
  return { snapshot, archiveBase64 };
}
