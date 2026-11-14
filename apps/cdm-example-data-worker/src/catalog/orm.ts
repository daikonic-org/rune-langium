// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { drizzle, type RemoteCallback, type SqliteRemoteResult } from 'drizzle-orm/sqlite-proxy';
import { z } from 'zod';
import * as schema from './schema.js';
import type { CatalogDatabase, CatalogStatement } from './catalog-schema.js';

const bindings = z.array(z.union([z.string(), z.number().finite(), z.null()]));
export function catalogStatement(query: { toSQL(): { sql: string; params: unknown[] } }): CatalogStatement {
  const { sql, params } = query.toSQL();
  return { sql, params: bindings.parse(params) };
}

/** A missing get row is absent; an empty all/values result remains an array. */
export function sqliteProxyResult(rows: unknown[][], method: Parameters<RemoteCallback>[2]): SqliteRemoteResult {
  return { rows: method === 'get' ? rows[0] : rows };
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
      return sqliteProxyResult(rows, method);
    },
    { schema }
  );
}
