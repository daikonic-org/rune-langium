// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { fileURLToPath, URL } from 'node:url';
import type { CatalogArtifacts, CatalogDatabase } from '../../src/catalog/catalog.js';

/** Exercise the real portable SQL with Node's native SQLite, without a mock SQL interpreter. */
export function nativeBenchmarkCatalog(filename = ':memory:') {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db: CatalogDatabase = {
    async query({ sql, params }) {
      return sqlite.prepare(sql).all(...params);
    },
    async values({ sql, params }) {
      const prepared = sqlite.prepare(sql);
      prepared.setReturnArrays(true);
      return z.array(z.array(z.unknown())).parse(prepared.all(...params));
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        for (const { sql, params } of statements) sqlite.prepare(sql).run(...params);
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
  const files = new Map<string, string>();
  const artifacts: CatalogArtifacts = {
    async get(key) {
      return files.get(key);
    },
    async put(key, content) {
      files.set(key, content);
    }
  };
  return { db, artifacts, files, sqlite, close: () => sqlite.close(), migrate: () => initializeBenchmarkCatalog(db) };
}

export async function initializeBenchmarkCatalog(db: CatalogDatabase): Promise<void> {
  const migrations = readMigrationFiles({
    migrationsFolder: fileURLToPath(new URL('../../migrations', import.meta.url))
  });
  for (const migration of migrations) await db.batch(migration.sql.map((sql) => ({ sql, params: [] })));
}
