// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import sqliteParser from 'node-sql-parser/build/sqlite.js';
import { z } from 'zod';
import { EXECUTION_LIMITS } from '@rune-langium/worker-core/execution';
import type { CatalogDatabase } from './catalog/catalog-schema.js';
import { sqliteProxyResult } from './catalog/orm.js';

const parser = new sqliteParser.Parser();
const scalar = z.union([z.string().max(2048), z.number().finite(), z.null()]);
const parameters = z.array(scalar).max(128);
const views = new Set(['select::null::benchmark_data', 'select::null::sonia_ois_data']);
const functions = new Set([
  'abs',
  'round',
  'min',
  'max',
  'sum',
  'count',
  'avg',
  'coalesce',
  'ifnull',
  'nullif',
  'date',
  'strftime',
  'substr',
  'lower',
  'upper',
  'length'
]);
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse and canonicalize one read query; client method names do not grant SQL authority. */
export function admittedSelect(input: unknown): string {
  const sql = z.string().min(1).max(EXECUTION_LIMITS.queryCharacters).parse(input);
  const parsed = parser.parse(sql, { database: 'Sqlite' });
  const ast = Array.isArray(parsed.ast) ? parsed.ast : [parsed.ast];
  if (ast.length !== 1 || ast[0]?.type !== 'select') throw new Error('One SELECT required.');
  const root: unknown = ast[0];
  if (
    !record(root) ||
    !Array.isArray(root.from) ||
    root.from.length !== 1 ||
    !record(root.from[0]) ||
    !root.from[0].table ||
    (Array.isArray(root.columns) && root.columns.length > 32)
  )
    throw new Error('Query shape unavailable.');
  if (!parsed.tableList.length || parsed.tableList.some((table) => !views.has(table)))
    throw new Error('Query references an unavailable relation.');
  const pending: unknown[] = [ast[0]];
  let nodes = 0;
  while (pending.length) {
    if (++nodes > 1500) throw new Error('Query too complex.');
    const node = pending.pop();
    if (Array.isArray(node)) {
      pending.push(...node);
      continue;
    }
    if (!record(node)) continue;
    if (node.type === 'select' && node !== root) throw new Error('Nested queries unavailable.');
    if (node.with || node.into || node.locking_read) throw new Error('Query clause unavailable.');
    if (node.type === 'function' || node.type === 'aggr_func') {
      const name =
        typeof node.name === 'string'
          ? node.name
          : record(node.name) && Array.isArray(node.name.name) && record(node.name.name[0])
            ? node.name.name[0].value
            : undefined;
      if (typeof name !== 'string' || !functions.has(name.toLowerCase())) throw new Error('SQL function unavailable.');
    }
    pending.push(...Object.values(node));
  }
  return parser.sqlify(ast[0], { database: 'Sqlite' });
}

/** One shared budget covers concurrent statements and is revoked on every exit path. */
export function createReadConnection(db: Pick<CatalogDatabase, 'values'>, options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const expiresAt = now() + EXECUTION_LIMITS.wallMs;
  let closed = false,
    count = 0,
    rowsRead = 0,
    bytesRead = 0;
  const active = () => {
    if (closed || now() >= expiresAt) throw new Error('Database connection expired.');
  };
  return {
    close() {
      closed = true;
    },
    get queryCount() {
      return count;
    },
    async query(sql: unknown, params: unknown, method: unknown) {
      active();
      if (++count > EXECUTION_LIMITS.queries) {
        closed = true;
        throw new Error('Query budget exceeded.');
      }
      if (method !== 'all' && method !== 'values' && method !== 'get') throw new Error('Read methods only.');
      const canonical = admittedSelect(sql);
      const bindings = parameters.parse(params);
      const limit = method === 'get' ? 1 : EXECUTION_LIMITS.rowsPerQuery;
      const readLimit = method === 'get' ? 1 : limit + 1;
      const rows = z
        .array(z.array(scalar))
        .max(readLimit)
        .parse(
          await db.values({
            sql: `SELECT * FROM (${canonical}) AS _execution_read LIMIT ?`,
            params: [...bindings, readLimit]
          })
        );
      active();
      rowsRead += rows.length;
      bytesRead += new TextEncoder().encode(JSON.stringify(rows)).byteLength;
      if (rows.length > limit || rowsRead > EXECUTION_LIMITS.rowsPerRun || bytesRead > EXECUTION_LIMITS.resultBytes) {
        closed = true;
        throw new Error('Database result budget exceeded.');
      }
      return sqliteProxyResult(rows, method);
    }
  };
}
