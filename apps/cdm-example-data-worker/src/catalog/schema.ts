// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { sqliteTable, sqliteView, text, integer, check, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const heads = sqliteTable(
  'benchmark_heads',
  {
    series: text().primaryKey(),
    generation: integer().notNull().default(0)
  },
  (t) => [check('generation_nonnegative', sql`${t.generation} >= 0`)]
);
export const snapshots = sqliteTable(
  'benchmark_snapshots',
  {
    id: text().primaryKey(),
    series: text()
      .notNull()
      .references(() => heads.series),
    derivation: text().notNull(),
    artifact_key: text().notNull(),
    source_hash: text().notNull(),
    captured_at: text().notNull(),
    ingested_at: text().notNull(),
    start_date: text().notNull(),
    end_date: text().notNull(),
    observation_count: integer().notNull(),
    decoder: text().notNull()
  },
  (t) => [
    check('observation_bound', sql`${t.observation_count} BETWEEN 0 AND 366`),
    check('decoder_version', sql`${t.decoder} = 'benchmark-v1'`),
    index('benchmark_snapshot_series').on(t.series, t.captured_at)
  ]
);
export const confirmations = sqliteTable('benchmark_confirmations', {
  snapshot_id: text()
    .primaryKey()
    .references(() => snapshots.id),
  last_seen_at: text().notNull()
});
export const observations = sqliteTable(
  'benchmark_observations',
  {
    snapshot_id: text()
      .notNull()
      .references(() => snapshots.id),
    date: text().notNull(),
    source_value: text().notNull(),
    value: text().notNull(),
    status: text(),
    revision: text()
  },
  (t) => [
    primaryKey({ columns: [t.snapshot_id, t.date] }),
    index('benchmark_observation_date').on(t.date, t.snapshot_id)
  ]
);
export const publications = sqliteTable(
  'benchmark_publications',
  {
    series: text()
      .notNull()
      .references(() => heads.series),
    generation: integer().notNull(),
    snapshot_id: text()
      .notNull()
      .unique()
      .references(() => snapshots.id)
  },
  (t) => [primaryKey({ columns: [t.series, t.generation] }), check('generation_positive', sql`${t.generation} > 0`)]
);
export const runs = sqliteTable(
  'benchmark_runs',
  {
    id: text().notNull(),
    series: text().notNull(),
    checked_at: text().notNull(),
    outcome: text().notNull(),
    phase: text().notNull(),
    snapshot_id: text(),
    latest_date: text()
  },
  (t) => [
    primaryKey({ columns: [t.id, t.series] }),
    check('run_outcome', sql`${t.outcome} IN ('updated','unchanged','empty','failed')`),
    check('run_phase', sql`${t.phase} IN ('acquire','publish','complete')`)
  ]
);

// Curves have a separate observation grain and private source rights; fixing APIs cannot select these rows.
export const curveHeads = sqliteTable(
  'curve_heads',
  {
    series: text().primaryKey(),
    generation: integer().notNull().default(0)
  },
  (t) => [check('curve_generation_nonnegative', sql`${t.generation} >= 0`)]
);
export const curveSnapshots = sqliteTable(
  'curve_snapshots',
  {
    id: text().primaryKey(),
    series: text()
      .notNull()
      .references(() => curveHeads.series),
    derivation: text().notNull(),
    artifact_key: text().notNull(),
    raw_key: text().notNull(),
    source_hash: text().notNull(),
    captured_at: text().notNull(),
    ingested_at: text().notNull(),
    start_date: text().notNull(),
    end_date: text().notNull(),
    point_count: integer().notNull(),
    decoder: text().notNull(),
    access_scope: text().notNull(),
    metadata: text().notNull()
  },
  (t) => [
    check('curve_point_bound', sql`${t.point_count} BETWEEN 1 AND 100000`),
    check('curve_decoder', sql`${t.decoder} = 'boe-ois-xlsx-v1'`),
    check('curve_access', sql`${t.access_scope} = 'internal-noncommercial'`),
    index('curve_snapshot_series').on(t.series, t.captured_at)
  ]
);
export const curveConfirmations = sqliteTable('curve_confirmations', {
  snapshot_id: text()
    .primaryKey()
    .references(() => curveSnapshots.id),
  last_seen_at: text().notNull()
});
export const curvePoints = sqliteTable(
  'curve_points',
  {
    snapshot_id: text()
      .notNull()
      .references(() => curveSnapshots.id),
    date: text().notNull(),
    kind: text().notNull(),
    grid: text().notNull(),
    maturity_months: integer().notNull(),
    maturity_years: text().notNull(),
    source_value: text().notNull(),
    value: text().notNull(),
    workbook: text().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.snapshot_id, t.date, t.kind, t.grid, t.maturity_months] }),
    check('curve_kind', sql`${t.kind} IN ('spot','instantaneous-forward')`),
    check('curve_grid', sql`${t.grid} IN ('monthly','semiannual')`),
    index('curve_date').on(t.date, t.snapshot_id)
  ]
);
export const curvePublications = sqliteTable(
  'curve_publications',
  {
    series: text()
      .notNull()
      .references(() => curveHeads.series),
    generation: integer().notNull(),
    snapshot_id: text()
      .notNull()
      .unique()
      .references(() => curveSnapshots.id)
  },
  (t) => [
    primaryKey({ columns: [t.series, t.generation] }),
    check('curve_generation_positive', sql`${t.generation} > 0`)
  ]
);
export const curveRuns = sqliteTable(
  'curve_runs',
  {
    id: text().notNull(),
    series: text().notNull(),
    checked_at: text().notNull(),
    outcome: text().notNull(),
    phase: text().notNull(),
    snapshot_id: text(),
    latest_date: text(),
    point_count: integer().notNull().default(0)
  },
  (t) => [
    primaryKey({ columns: [t.id, t.series] }),
    check('curve_run_outcome', sql`${t.outcome} IN ('updated','unchanged','empty','failed')`),
    check('curve_run_phase', sql`${t.phase} IN ('acquire','publish','complete')`)
  ]
);

// Only accepted publications appear in execution connections, including historical vintages.
export const benchmarkData = sqliteView('benchmark_data', {
  series: text().notNull(),
  snapshot_id: text().notNull(),
  generation: integer().notNull(),
  date: text().notNull(),
  source_value: text().notNull(),
  value: text().notNull(),
  captured_at: text().notNull(),
  confirmed_at: text().notNull()
}).as(sql`SELECT s.series, o.snapshot_id, p.generation, o.date, o.source_value, o.value,
  s.captured_at, COALESCE(c.last_seen_at,s.captured_at) AS confirmed_at
  FROM benchmark_observations o JOIN benchmark_snapshots s ON s.id=o.snapshot_id
  JOIN benchmark_publications p ON p.snapshot_id=s.id
  JOIN benchmark_heads h ON h.series=p.series AND p.generation<=h.generation
  LEFT JOIN benchmark_confirmations c ON c.snapshot_id=s.id`);

export const soniaOisData = sqliteView('sonia_ois_data', {
  snapshot_id: text().notNull(),
  generation: integer().notNull(),
  date: text().notNull(),
  kind: text().notNull(),
  grid: text().notNull(),
  maturity_months: integer().notNull(),
  maturity_years: text().notNull(),
  source_value: text().notNull(),
  value: text().notNull(),
  captured_at: text().notNull(),
  confirmed_at: text().notNull()
}).as(sql`SELECT o.snapshot_id, p.generation, o.date, o.kind, o.grid, o.maturity_months,
  o.maturity_years, o.source_value, o.value, s.captured_at,
  COALESCE(c.last_seen_at,s.captured_at) AS confirmed_at
  FROM curve_points o JOIN curve_snapshots s ON s.id=o.snapshot_id
  JOIN curve_publications p ON p.snapshot_id=s.id
  JOIN curve_heads h ON h.series=p.series AND p.generation<=h.generation
  LEFT JOIN curve_confirmations c ON c.snapshot_id=s.id`);
