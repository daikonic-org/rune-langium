// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { z } from 'zod';
import * as schema from './schema.js';
import type { CatalogDatabase, CatalogStatement } from './catalog-schema.js';

const bindings = z.array(z.union([z.string(), z.number().finite(), z.null()]));
export function catalogStatement(query: { toSQL(): { sql: string; params: unknown[] } }): CatalogStatement {
  const { sql, params } = query.toSQL();
  return { sql, params: bindings.parse(params) };
}

/** Drizzle's supported proxy driver shares one typed query layer across native SQLite, D1 bindings and CI HTTP. */
export function catalogOrm(db: CatalogDatabase) {
  return drizzle(
    async (sql: string, params: unknown[], method) => {
      const statement = { sql, params: bindings.parse(params) };
      if (method === 'run') {
        await db.batch([statement]);
        return { rows: [] };
      }
      const rows = await db.values(statement);
      return { rows: method === 'get' ? (rows[0] ?? []) : rows };
    },
    { schema }
  );
}
