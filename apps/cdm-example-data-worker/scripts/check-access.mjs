// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import Cloudflare from 'cloudflare';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { remoteBenchmarkCatalog } from './remote.mjs';

/** Exercise the CI credential without publishing data or changing catalog rows. */
export async function checkCatalogAccess(env = process.env, options = {}) {
  const api = options.api ?? new Cloudflare({ apiToken: env.CLOUDFLARE_API_TOKEN, maxRetries: 0, timeout: 30_000 });
  const catalog = remoteBenchmarkCatalog(env, { api });
  const results = [];
  const attempt = async (operation, run) => {
    try {
      await run();
      results.push({ operation, success: true });
      return true;
    } catch (error) {
      results.push({
        operation,
        success: false,
        ...(error instanceof Cloudflare.APIError ? { httpStatus: error.status } : {})
      });
      return false;
    }
  };
  await attempt('d1-read', () => catalog.db.query({ sql: 'SELECT 1', params: [] }));
  await attempt('d1-write', () =>
    catalog.db.query({ sql: 'UPDATE curve_heads SET generation = generation WHERE 0', params: [] })
  );
  const key = `permission-check-${randomUUID()}.txt`;
  const location = {
    account_id: env.CLOUDFLARE_ACCOUNT_ID,
    bucket_name: env.CDM_EXAMPLE_DATA_BUCKET || 'rune-cdm-example-data'
  };
  const body = 'rune-cdm-example-data permission check';
  try {
    if (await attempt('r2-write', () => api.r2.buckets.objects.upload(key, body, location)))
      await attempt('r2-read', async () => {
        const response = await api.r2.buckets.objects.get(key, location);
        if ((await response.text()) !== body) throw new Error('Permission-check object differs.');
      });
  } finally {
    await attempt('r2-delete', () => api.r2.buckets.objects.delete(key, location));
  }
  return { success: results.every((result) => result.success), results };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const report = await checkCatalogAccess();
    console.log(JSON.stringify(report));
    process.exitCode = report.success ? 0 : 1;
  } catch {
    console.error('Catalog permission check could not initialize; check its configured account/database/secret.');
    process.exitCode = 1;
  }
}
