// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import { and, eq, lte, gte, desc, asc, sql, getTableColumns } from 'drizzle-orm';
import { canonicalProjectJson, projectFileRevision } from '@rune-langium/project-config';
import { marketDecimalValue } from '@rune-langium/project-runtime/market-data';
import { catalogOrm, catalogStatement } from './orm.js';
import { curveHeads, curveSnapshots, curvePoints, curvePublications, curveConfirmations } from './schema.js';
import type { CatalogDatabase, CatalogArtifacts, CatalogStatement } from './catalog-schema.js';
import { CatalogConflictError, CatalogSnapshotId } from './catalog.js';
import { putImmutableCatalogArtifact } from './artifacts.js';
import { SONIA_OIS_DATASET, SoniaOisPoint, readSoniaOisAcquisition, soniaOisSnapshotId } from './curve-contracts.js';

const generation = z.number().int().nonnegative();
const published = z.object({
  id: CatalogSnapshotId,
  series: z.literal('sonia-ois'),
  derivation: CatalogSnapshotId,
  artifact_key: z.string(),
  raw_key: z.string(),
  captured_at: z.iso.datetime(),
  generation: generation.positive()
});
const statement = (sql: string, params: CatalogStatement['params']): CatalogStatement => ({ sql, params });
async function head(db: CatalogDatabase) {
  const rows = await catalogOrm(db)
    .select({ generation: curveHeads.generation })
    .from(curveHeads)
    .where(eq(curveHeads.series, 'sonia-ois'));
  return rows.length ? z.object({ generation }).parse(rows[0]).generation : 0;
}

/** Private catalog read only. The public fixing API cannot address curve snapshots or raw objects. */
export async function readSoniaOisCatalogSnapshot(
  db: CatalogDatabase,
  artifacts: CatalogArtifacts,
  snapshotId: string
) {
  const rows = await catalogOrm(db)
    .select({ ...getTableColumns(curveSnapshots), generation: curvePublications.generation })
    .from(curveSnapshots)
    .innerJoin(curvePublications, eq(curvePublications.snapshot_id, curveSnapshots.id))
    .where(eq(curveSnapshots.id, CatalogSnapshotId.parse(snapshotId)));
  if (!rows.length) return undefined;
  const metadata = published.parse(rows[0]);
  const content = await artifacts.get(metadata.artifact_key),
    raw = await artifacts.get(metadata.raw_key);
  if (content === undefined || raw === undefined) throw new Error('Published curve artifact unavailable.');
  const acquisition = await readSoniaOisAcquisition({ snapshot: JSON.parse(content), archiveBase64: JSON.parse(raw) });
  if ((await soniaOisSnapshotId(acquisition.snapshot)) !== snapshotId)
    throw new Error('Published curve integrity mismatch.');
  return acquisition.snapshot;
}

/** Complete immutable source artifacts and point rows are staged before the final transactional visibility gate. */
export async function publishSoniaOisSnapshot(
  db: CatalogDatabase,
  artifacts: CatalogArtifacts,
  input: unknown,
  options: { now?: string; expectedGeneration?: number } = {}
) {
  const { snapshot, archiveBase64 } = await readSoniaOisAcquisition(input);
  if (!snapshot.points.length) throw new Error('Empty curve capture has no publication.');
  const now = z.iso.datetime().parse(options.now ?? new Date().toISOString());
  if (Date.parse(snapshot.source.retrievedAt) > Date.parse(now))
    throw new Error('Curve capture time is in the future.');
  const snapshotId = await soniaOisSnapshotId(snapshot);
  const accepted = await catalogOrm(db)
    .select({ generation: curvePublications.generation })
    .from(curvePublications)
    .where(eq(curvePublications.snapshot_id, snapshotId));
  if (accepted.length) {
    await readSoniaOisCatalogSnapshot(db, artifacts, snapshotId);
    return {
      snapshotId,
      generation: z.object({ generation }).parse(accepted[0]).generation,
      outcome: 'unchanged' as const
    };
  }
  const expected = generation.parse(options.expectedGeneration ?? (await head(db)));
  const derivation = await projectFileRevision(
    canonicalProjectJson({
      decoder: snapshot.decoder,
      window: snapshot.window,
      source: snapshot.source.sha256,
      workbooks: snapshot.source.workbooks,
      points: snapshot.points
    })
  );
  const previous = await catalogOrm(db)
    .select({ ...getTableColumns(curveSnapshots), generation: curvePublications.generation })
    .from(curveSnapshots)
    .innerJoin(curvePublications, eq(curvePublications.snapshot_id, curveSnapshots.id))
    .leftJoin(curveConfirmations, eq(curveConfirmations.snapshot_id, curveSnapshots.id))
    .where(
      and(
        eq(curveSnapshots.series, 'sonia-ois'),
        lte(curvePublications.generation, expected),
        lte(curveSnapshots.start_date, snapshot.window.endDate),
        gte(curveSnapshots.end_date, snapshot.window.startDate)
      )
    )
    .orderBy(
      desc(sql`COALESCE(${curveConfirmations.last_seen_at},${curveSnapshots.captured_at})`),
      desc(curvePublications.generation)
    )
    .limit(1);
  if (previous.length) {
    const old = published.parse(previous[0]);
    if (old.derivation === derivation) {
      await readSoniaOisCatalogSnapshot(db, artifacts, old.id);
      await db.batch([
        statement(
          `INSERT INTO curve_confirmations(snapshot_id,last_seen_at)
        SELECT p.snapshot_id,? FROM curve_publications p JOIN curve_heads h ON h.series=p.series
        WHERE p.snapshot_id=? AND h.generation=?
        ON CONFLICT(snapshot_id) DO UPDATE SET last_seen_at=MAX(curve_confirmations.last_seen_at,excluded.last_seen_at)`,
          [snapshot.source.retrievedAt, old.id, expected]
        )
      ]);
      if ((await head(db)) !== expected) throw new CatalogConflictError('Curve generation changed.');
      return { snapshotId: old.id, generation: old.generation, outcome: 'unchanged' as const };
    }
  }
  const artifactKey = `market-data/curves/snapshots/${snapshotId}.json`;
  const rawKey = `market-data/curves/raw/${snapshot.source.sha256}.json`;
  await putImmutableCatalogArtifact(artifacts, rawKey, JSON.stringify(archiveBase64));
  await putImmutableCatalogArtifact(artifacts, artifactKey, canonicalProjectJson(snapshot));
  await catalogOrm(db).insert(curveHeads).values({ series: 'sonia-ois' }).onConflictDoNothing().run();
  await catalogOrm(db)
    .insert(curveSnapshots)
    .values({
      id: snapshotId,
      series: 'sonia-ois',
      derivation,
      artifact_key: artifactKey,
      raw_key: rawKey,
      source_hash: snapshot.source.sha256,
      captured_at: snapshot.source.retrievedAt,
      ingested_at: now,
      start_date: snapshot.window.startDate,
      end_date: snapshot.window.endDate,
      point_count: snapshot.points.length,
      decoder: snapshot.decoder,
      access_scope: SONIA_OIS_DATASET.accessScope,
      metadata: canonicalProjectJson(SONIA_OIS_DATASET)
    })
    .onConflictDoNothing()
    .run();
  for (let offset = 0; offset < snapshot.points.length; offset += 50)
    await db.batch(
      snapshot.points.slice(offset, offset + 50).map((point) =>
        catalogStatement(
          catalogOrm(db)
            .insert(curvePoints)
            .values({
              snapshot_id: snapshotId,
              date: point.date,
              kind: point.kind,
              grid: point.grid,
              maturity_months: point.maturityMonths,
              maturity_years: point.maturityYears,
              source_value: point.sourceValue,
              value: marketDecimalValue(point.sourceValue, 'percent'),
              workbook: point.workbook
            })
            .onConflictDoNothing()
        )
      )
    );
  await db.batch([
    statement(
      `INSERT INTO curve_publications(series,generation,snapshot_id)
      SELECT h.series,h.generation+1,s.id FROM curve_heads h JOIN curve_snapshots s ON s.series=h.series
      WHERE h.series=? AND h.generation=? AND s.id=? AND s.point_count=(SELECT count(*) FROM curve_points WHERE snapshot_id=s.id)`,
      ['sonia-ois', expected, snapshotId]
    ),
    statement(
      `INSERT INTO curve_confirmations(snapshot_id,last_seen_at) SELECT snapshot_id,? FROM curve_publications WHERE snapshot_id=?`,
      [snapshot.source.retrievedAt, snapshotId]
    ),
    statement(
      `UPDATE curve_heads SET generation=? WHERE series=? AND generation=?
      AND EXISTS(SELECT 1 FROM curve_publications WHERE snapshot_id=? AND generation=?)`,
      [expected + 1, 'sonia-ois', expected, snapshotId, expected + 1]
    )
  ]);
  const readback = await catalogOrm(db)
    .select({ generation: curvePublications.generation })
    .from(curvePublications)
    .where(eq(curvePublications.snapshot_id, snapshotId));
  if (!readback.length) throw new CatalogConflictError('Curve generation changed; retry publication.');
  await readSoniaOisCatalogSnapshot(db, artifacts, snapshotId);
  return {
    snapshotId,
    generation: z.object({ generation }).parse(readback[0]).generation,
    outcome: 'updated' as const
  };
}

/** Exact-date internal query, with an explicit snapshot or bounded generation when reproducibility is needed. */
export async function querySoniaOisCurve(db: CatalogDatabase, input: unknown) {
  const query = z
    .strictObject({
      date: z.iso.date(),
      kind: SoniaOisPoint.shape.kind,
      grid: SoniaOisPoint.shape.grid,
      snapshotId: CatalogSnapshotId.optional(),
      generation: generation.positive().optional()
    })
    .parse(input);
  if (query.snapshotId && query.generation) throw new Error('Choose snapshot or generation.');
  const selected = await catalogOrm(db)
    .select({ ...getTableColumns(curveSnapshots), generation: curvePublications.generation })
    .from(curveSnapshots)
    .innerJoin(curvePublications, eq(curvePublications.snapshot_id, curveSnapshots.id))
    .leftJoin(curveConfirmations, eq(curveConfirmations.snapshot_id, curveSnapshots.id))
    .where(
      and(
        eq(curveSnapshots.series, 'sonia-ois'),
        lte(curveSnapshots.start_date, query.date),
        gte(curveSnapshots.end_date, query.date),
        query.snapshotId ? eq(curveSnapshots.id, query.snapshotId) : undefined,
        query.generation ? lte(curvePublications.generation, query.generation) : undefined
      )
    )
    .orderBy(
      desc(sql`COALESCE(${curveConfirmations.last_seen_at},${curveSnapshots.captured_at})`),
      desc(curvePublications.generation)
    )
    .limit(1);
  if (!selected.length) return undefined;
  const metadata = published.parse(selected[0]);
  const points = await catalogOrm(db)
    .select({
      maturityMonths: curvePoints.maturity_months,
      maturityYears: curvePoints.maturity_years,
      sourceValue: curvePoints.source_value,
      value: curvePoints.value,
      workbook: curvePoints.workbook
    })
    .from(curvePoints)
    .where(
      and(
        eq(curvePoints.snapshot_id, metadata.id),
        eq(curvePoints.date, query.date),
        eq(curvePoints.kind, query.kind),
        eq(curvePoints.grid, query.grid)
      )
    )
    .orderBy(asc(curvePoints.maturity_months))
    .limit(600);
  return {
    dataset: SONIA_OIS_DATASET,
    snapshotId: metadata.id,
    generation: metadata.generation,
    date: query.date,
    kind: query.kind,
    grid: query.grid,
    points
  };
}
