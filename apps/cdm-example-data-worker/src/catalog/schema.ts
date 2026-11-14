// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { sqliteTable, text, integer, check, index, primaryKey } from 'drizzle-orm/sqlite-core';
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
