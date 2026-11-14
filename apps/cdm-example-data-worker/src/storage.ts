// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import type { CatalogDatabase, CatalogArtifacts } from './catalog/catalog.js';

export function d1BenchmarkDatabase(db: D1Database): CatalogDatabase {
  return {
    async query({ sql, params }) {
      return (
        await db
          .prepare(sql)
          .bind(...params)
          .all<unknown>()
      ).results;
    },
    async values({ sql, params }) {
      return db
        .prepare(sql)
        .bind(...params)
        .raw<unknown[]>();
    },
    async batch(statements) {
      await db.batch(statements.map(({ sql, params }) => db.prepare(sql).bind(...params)));
    }
  };
}

export function r2BenchmarkArtifacts(bucket: R2Bucket): CatalogArtifacts {
  return {
    async get(key) {
      const object = await bucket.get(key);
      if (!object) return undefined;
      // A v1 JSON snapshot can expand its bounded 2 MiB text through JSON escaping.
      if (object.size > 16 * 1024 * 1024) throw new Error('Benchmark artifact exceeds its size limit.');
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await object.arrayBuffer());
    },
    async put(key, content) {
      await bucket.put(key, content, {
        httpMetadata: { contentType: key.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8' }
      });
    }
  };
}
