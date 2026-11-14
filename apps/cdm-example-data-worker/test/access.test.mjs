// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import Cloudflare from 'cloudflare';
import { checkCatalogAccess } from '../scripts/check-access.mjs';

const env = {
  CLOUDFLARE_API_TOKEN: 'private-credential',
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  CDM_EXAMPLE_DATA_DATABASE_ID: '37b42f1a-7101-4ccd-936c-0f70ca4d682c'
};

it.each([200, 403])('checks each service independently when D1 returns HTTP %i', async (status) => {
  const calls = [];
  let object;
  const api = new Cloudflare({
    apiToken: env.CLOUDFLARE_API_TOKEN,
    maxRetries: 0,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push({ path: url.pathname, method: init.method, body: init.body });
      if (url.pathname.endsWith('/query'))
        return Response.json(
          status === 200
            ? { success: true, result: [{ success: true, results: [] }] }
            : { success: false, errors: [{ code: 10000, message: env.CLOUDFLARE_API_TOKEN }] },
          { status }
        );
      if (init.method === 'PUT') object = init.body;
      if (init.method === 'GET') return new Response(object);
      return Response.json({ success: true, result: {} });
    }
  });
  const report = await checkCatalogAccess(env, { api });
  expect(report.success).toBe(status === 200);
  expect(report.results.map((result) => result.operation)).toEqual([
    'd1-read',
    'd1-write',
    'r2-write',
    'r2-read',
    'r2-delete'
  ]);
  const queries = calls.filter((call) => call.path.endsWith('/query')).map((call) => JSON.parse(call.body).sql);
  expect(queries).toEqual(['SELECT 1', 'UPDATE curve_heads SET generation = generation WHERE 0']);
  const objects = calls.filter((call) => !call.path.endsWith('/query'));
  expect(objects.map((call) => call.method)).toEqual(['PUT', 'GET', 'DELETE']);
  expect(new Set(objects.map((call) => call.path)).size).toBe(1);
  expect(objects[0].path).toContain('/objects/permission-check-');
  expect(JSON.stringify(report)).not.toContain(env.CLOUDFLARE_API_TOKEN);
  if (status === 403) expect(report.results[0]).toMatchObject({ success: false, httpStatus: 403 });
});

it('cleans up the temporary object even if its readback fails', async () => {
  const methods = [];
  const api = new Cloudflare({
    apiToken: env.CLOUDFLARE_API_TOKEN,
    maxRetries: 0,
    fetch: async (input, init) => {
      if (String(input).endsWith('/query'))
        return Response.json({ success: true, result: [{ success: true, results: [] }] });
      methods.push(init.method);
      if (init.method === 'GET') return new Response('incorrect content');
      return Response.json({ success: true, result: {} });
    }
  });
  expect(await checkCatalogAccess(env, { api })).toMatchObject({
    success: false,
    results: expect.arrayContaining([
      { operation: 'r2-read', success: false },
      { operation: 'r2-delete', success: true }
    ])
  });
  expect(methods).toEqual(['PUT', 'GET', 'DELETE']);
});
