// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { eq, and, lt, lte, gte, desc, asc, sql, getTableColumns } from 'drizzle-orm';
import { catalogOrm, catalogStatement } from './orm.js';
import { heads, snapshots, confirmations, observations as storedObservations, publications, runs } from './schema.js';
import { projectFileRevision } from '@rune-langium/project-config';
import {
  BENCHMARK_SERIES,
  BenchmarkSeriesSchema,
  readBenchmarkSnapshot,
  type BenchmarkSeries,
  benchmarkTerms,
  BENCHMARK_DECODER,
  CatalogSnapshotId,
  CatalogWindow,
  BenchmarkSelectionSchema,
  benchmarkSnapshotId,
  type BenchmarkSelection
} from '@rune-langium/project-runtime/market-data';
import type { CatalogArtifacts, CatalogDatabase, CatalogStatement } from './catalog-schema.js';

export type { CatalogArtifacts, CatalogDatabase, CatalogStatement } from './catalog-schema.js';
export { refreshBenchmarkCatalog } from './refresh.js';
export { BENCHMARK_DECODER, CatalogSnapshotId, CatalogWindow };
const id = CatalogSnapshotId;
const iso = z.iso.datetime();
const date = z.iso.date();
const metadata = z.object({
  id,
  series: BenchmarkSeriesSchema,
  derivation: id,
  artifact_key: z.string(),
  source_hash: id,
  captured_at: iso,
  ingested_at: iso,
  start_date: date,
  end_date: date,
  observation_count: z.number().int().min(0).max(366),
  decoder: z.literal(BENCHMARK_DECODER)
});
const publishedMetadata = metadata.extend({ generation: z.number().int().positive() });
export const CatalogObservation = z.object({
  snapshot_id: id,
  date,
  source_value: z.string(),
  value: z.string().transform(Number).pipe(z.number().finite()),
  status: z.string().nullable(),
  revision: z.string().nullable()
});
export { BenchmarkSelectionSchema, benchmarkSnapshotId, type BenchmarkSelection };
const headSchema = z.object({ generation: z.number().int().nonnegative() });
const statement = (sql: string, params: CatalogStatement['params'] = []): CatalogStatement => ({ sql, params });
export class CatalogConflictError extends Error {}

function confirmationStatement(snapshotId: string, capturedAt: string, expected: number): CatalogStatement {
  return statement(
    `INSERT INTO benchmark_confirmations(snapshot_id,last_seen_at)
    SELECT p.snapshot_id,MAX(s.captured_at,?) FROM benchmark_publications p
    JOIN benchmark_snapshots s ON s.id=p.snapshot_id JOIN benchmark_heads h ON h.series=p.series
    WHERE p.snapshot_id=? AND h.generation=?
    ON CONFLICT(snapshot_id) DO UPDATE SET last_seen_at=MAX(benchmark_confirmations.last_seen_at,excluded.last_seen_at)`,
    [capturedAt, snapshotId, expected]
  );
}

export function benchmarkDatasetCatalog() {
  return BenchmarkSeriesSchema.options.map((series) => {
    const { series: sourceSeries, ...definition } = BENCHMARK_SERIES[series];
    return { series, sourceSeries, ...definition, terms: benchmarkTerms(series) };
  });
}

async function head(db: CatalogDatabase, series: BenchmarkSeries): Promise<number> {
  const rows = await catalogOrm(db)
    .select({ generation: heads.generation })
    .from(heads)
    .where(eq(heads.series, series));
  return rows.length ? headSchema.parse(rows[0]).generation : 0;
}

export async function readCatalogSnapshot(db: CatalogDatabase, artifacts: CatalogArtifacts, snapshotId: string) {
  const rows = await catalogOrm(db)
    .select({ ...getTableColumns(snapshots), generation: publications.generation })
    .from(snapshots)
    .innerJoin(publications, eq(publications.snapshot_id, snapshots.id))
    .where(eq(snapshots.id, id.parse(snapshotId)));
  if (!rows.length) return undefined;
  const record = publishedMetadata.parse(rows[0]);
  const content = await artifacts.get(record.artifact_key);
  if (content === undefined) throw new Error('Published benchmark artifact is unavailable.');
  const decoded = await readBenchmarkSnapshot(JSON.parse(content));
  if ((await benchmarkSnapshotId(decoded.snapshot)) !== record.id || decoded.snapshot.series !== record.series)
    throw new Error('Published benchmark artifact integrity mismatch.');
  return decoded.snapshot;
}

/** Stage immutable artifacts/rows; a transactional generation change alone makes them visible. */
export async function publishBenchmarkSnapshot(
  db: CatalogDatabase,
  artifacts: CatalogArtifacts,
  input: unknown,
  options: { now?: string; expectedGeneration?: number } = {}
): Promise<{ snapshotId: string; generation: number; outcome: 'updated' | 'unchanged' | 'empty' }> {
  const decoded = await readBenchmarkSnapshot(input);
  const now = iso.parse(options.now ?? new Date().toISOString());
  if (Date.parse(decoded.snapshot.source.retrievedAt) > Date.parse(now))
    throw new Error('Benchmark capture time is in the future.');
  const { snapshot, observations } = decoded;
  const snapshotId = await benchmarkSnapshotId(snapshot);
  const capturedAt = new Date(snapshot.source.retrievedAt).toISOString();
  // An exact replay retains its original publication; it cannot reactivate an old capture.
  const acceptedReplay = await catalogOrm(db)
    .select({ generation: publications.generation })
    .from(publications)
    .where(eq(publications.snapshot_id, snapshotId));
  if (acceptedReplay.length) {
    await readCatalogSnapshot(db, artifacts, snapshotId);
    return { snapshotId, generation: headSchema.parse(acceptedReplay[0]).generation, outcome: 'unchanged' };
  }
  const expected = options.expectedGeneration ?? (await head(db, snapshot.series));
  z.number().int().nonnegative().parse(expected);
  const derivation = await projectFileRevision(
    JSON.stringify({
      decoder: BENCHMARK_DECODER,
      series: decoded.snapshot.series,
      window: decoded.snapshot.window,
      source: decoded.snapshot.source.sha256
    })
  );
  const found = await catalogOrm(db)
    .select({ ...getTableColumns(snapshots), generation: publications.generation })
    .from(snapshots)
    .innerJoin(publications, eq(publications.snapshot_id, snapshots.id))
    .leftJoin(confirmations, eq(confirmations.snapshot_id, snapshots.id))
    .where(
      and(
        eq(snapshots.series, snapshot.series),
        lte(publications.generation, expected),
        lte(snapshots.start_date, snapshot.window.endDate),
        gte(snapshots.end_date, snapshot.window.startDate)
      )
    )
    .orderBy(desc(sql`COALESCE(${confirmations.last_seen_at},${snapshots.captured_at})`), desc(publications.generation))
    .limit(1);
  if (found.length) {
    const previous = publishedMetadata.parse(found[0]);
    if (previous.derivation === derivation) {
      await readCatalogSnapshot(db, artifacts, previous.id);
      // Keep unchanged rechecks newer than late backfills without rewriting immutable provenance.
      await db.batch([confirmationStatement(previous.id, capturedAt, expected)]);
      if ((await head(db, snapshot.series)) !== expected)
        throw new CatalogConflictError('Catalog generation changed; retry publication.');
      return { snapshotId: previous.id, generation: previous.generation, outcome: 'unchanged' };
    }
  }
  const artifactKey = `market-data/snapshots/${snapshotId}.json`;
  const content = JSON.stringify(snapshot);
  const rawKey = `market-data/raw/${snapshot.source.sha256}.txt`;
  for (const [key, body] of [
    [rawKey, snapshot.content],
    [artifactKey, content]
  ]) {
    if (!key || body === undefined) throw new Error('Invalid benchmark artifact.');
    const existing = await artifacts.get(key);
    if (existing !== undefined && existing !== body) throw new Error('Immutable benchmark artifact differs.');
    if (existing === undefined) await artifacts.put(key, body);
    if ((await artifacts.get(key)) !== body) throw new Error('Benchmark artifact readback failed.');
  }
  await catalogOrm(db).insert(heads).values({ series: snapshot.series }).onConflictDoNothing().run();
  await catalogOrm(db)
    .insert(snapshots)
    .values({
      id: snapshotId,
      series: snapshot.series,
      derivation,
      artifact_key: artifactKey,
      source_hash: snapshot.source.sha256,
      captured_at: capturedAt,
      ingested_at: new Date(now).toISOString(),
      start_date: snapshot.window.startDate,
      end_date: snapshot.window.endDate,
      observation_count: observations.length,
      decoder: BENCHMARK_DECODER
    })
    .onConflictDoNothing()
    .run();
  // Each bounded batch can be retried after interruption; staged rows are never queryable by readers.
  for (let offset = 0; offset < observations.length; offset += 50) {
    await db.batch(
      observations.slice(offset, offset + 50).map((row) =>
        catalogStatement(
          catalogOrm(db)
            .insert(storedObservations)
            .values({
              snapshot_id: snapshotId,
              date: row.date,
              source_value: row.sourceValue,
              value: String(row.value),
              status: row.status ?? null,
              revision: row.revision ?? null
            })
            .onConflictDoNothing()
        )
      )
    );
  }
  await db.batch([
    statement(
      `INSERT INTO benchmark_publications(series,generation,snapshot_id)
      SELECT h.series,h.generation+1,s.id FROM benchmark_heads h JOIN benchmark_snapshots s ON s.series=h.series
      WHERE h.series=? AND h.generation=? AND s.id=? AND s.observation_count=
      (SELECT count(*) FROM benchmark_observations WHERE snapshot_id=s.id)`,
      [snapshot.series, expected, snapshotId]
    ),
    confirmationStatement(snapshotId, capturedAt, expected),
    statement(
      `UPDATE benchmark_heads SET generation=? WHERE series=? AND generation=?
      AND EXISTS(SELECT 1 FROM benchmark_publications WHERE snapshot_id=? AND generation=?)`,
      [expected + 1, snapshot.series, expected, snapshotId, expected + 1]
    )
  ]);
  const accepted = await catalogOrm(db)
    .select({ generation: publications.generation })
    .from(publications)
    .where(eq(publications.snapshot_id, snapshotId));
  if (!accepted.length) throw new CatalogConflictError('Catalog generation changed; retry publication.');
  return {
    snapshotId,
    generation: headSchema.parse(accepted[0]).generation,
    outcome: observations.length ? 'updated' : 'empty'
  };
}

export async function listBenchmarkSnapshots(
  db: CatalogDatabase,
  series: BenchmarkSeries,
  beforeGeneration?: number,
  limit = 50
) {
  BenchmarkSeriesSchema.parse(series);
  z.number().int().positive().max(100).parse(limit);
  if (beforeGeneration !== undefined) z.number().int().positive().parse(beforeGeneration);
  const rows = await catalogOrm(db)
    .select({ ...getTableColumns(snapshots), generation: publications.generation })
    .from(publications)
    .innerJoin(snapshots, eq(snapshots.id, publications.snapshot_id))
    .where(
      and(eq(publications.series, series), lt(publications.generation, beforeGeneration ?? Number.MAX_SAFE_INTEGER))
    )
    .orderBy(desc(publications.generation))
    .limit(limit);
  return publishedMetadata.array().parse(rows);
}

/** A generation pins candidates; capture/confirmation time keeps late historical imports behind fresh observations. */
export async function queryBenchmarkObservations(
  db: CatalogDatabase,
  series: BenchmarkSeries,
  window: { startDate: string; endDate: string },
  options: { generation?: number; after?: string; limit?: number } = {}
) {
  BenchmarkSeriesSchema.parse(series);
  CatalogWindow.parse(window);
  const current = await head(db, series);
  const generation = z
    .number()
    .int()
    .nonnegative()
    .max(current)
    .parse(options.generation ?? current);
  const limit = z
    .number()
    .int()
    .min(1)
    .max(366)
    .parse(options.limit ?? 366);
  if (options.after !== undefined) date.parse(options.after);
  const rows = await db.query(
    statement(
      `WITH candidates AS (SELECT o.*, ROW_NUMBER() OVER (PARTITION BY o.date
      ORDER BY COALESCE(c.last_seen_at,s.captured_at) DESC,p.generation DESC) choice
      FROM benchmark_observations o JOIN benchmark_snapshots s ON s.id=o.snapshot_id
      JOIN benchmark_publications p ON p.snapshot_id=s.id
      LEFT JOIN benchmark_confirmations c ON c.snapshot_id=s.id
      WHERE s.series=? AND p.generation<=? AND o.date>=? AND o.date<=?)
      SELECT snapshot_id,date,source_value,value,status,revision FROM candidates
      WHERE choice=1 AND date>? ORDER BY date LIMIT ?`,
      [series, generation, window.startDate, window.endDate, options.after ?? '', limit]
    )
  );
  return { generation, observations: CatalogObservation.array().parse(rows) };
}

export async function createBenchmarkSelection(
  db: CatalogDatabase,
  series: BenchmarkSeries[],
  window: { startDate: string; endDate: string }
): Promise<BenchmarkSelection> {
  CatalogWindow.parse(window);
  z.array(BenchmarkSeriesSchema).min(1).max(6).parse(series);
  if (new Set(series).size !== series.length) throw new Error('Choose distinct benchmark series.');
  const datasets = [];
  for (const name of series) {
    const { generation, observations } = await queryBenchmarkObservations(db, name, window);
    const members = new Map<string, string[]>();
    for (const row of observations) {
      const dates = members.get(row.snapshot_id) ?? [];
      dates.push(row.date);
      members.set(row.snapshot_id, dates);
    }
    datasets.push({
      series: name,
      generation,
      snapshots: [...members].map(([id, dates]) => ({ id, dates })),
      terms: benchmarkTerms(name)
    });
  }
  return BenchmarkSelectionSchema.parse({ schemaVersion: 1, decoder: BENCHMARK_DECODER, window, datasets });
}

export const BenchmarkRunSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9:._/-]{1,160}$/),
  series: BenchmarkSeriesSchema,
  checkedAt: iso,
  outcome: z.enum(['updated', 'unchanged', 'empty', 'failed']),
  phase: z.enum(['acquire', 'publish', 'complete']),
  snapshotId: id.optional(),
  latestDate: date.optional()
});
export async function recordBenchmarkRun(db: CatalogDatabase, input: unknown) {
  const run = BenchmarkRunSchema.parse(input);
  const value = {
    id: run.id,
    series: run.series,
    checked_at: run.checkedAt,
    outcome: run.outcome,
    phase: run.phase,
    snapshot_id: run.snapshotId ?? null,
    latest_date: run.latestDate ?? null
  };
  await catalogOrm(db)
    .insert(runs)
    .values(value)
    .onConflictDoUpdate({ target: [runs.id, runs.series], set: value })
    .run();
}

export async function listBenchmarkRuns(db: CatalogDatabase, limit = 20) {
  z.number().int().min(1).max(100).parse(limit);
  return z
    .array(
      z.object({
        id: z.string(),
        series: BenchmarkSeriesSchema,
        checked_at: iso,
        outcome: BenchmarkRunSchema.shape.outcome,
        phase: BenchmarkRunSchema.shape.phase,
        snapshot_id: id.nullable(),
        latest_date: date.nullable()
      })
    )
    .parse(
      await catalogOrm(db)
        .select()
        .from(runs)
        .orderBy(desc(runs.checked_at), desc(runs.id), asc(runs.series))
        .limit(limit)
    );
}
