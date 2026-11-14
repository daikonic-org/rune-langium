// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, it, vi } from 'vitest';
import { handleDatabasePreparation } from '../api/database-preparation.js';
import type { PreparationService } from '@rune-langium/worker-core/execution';

const payload = { schemaVersion: 1, projectRevision: 'a'.repeat(64), code: 'export default () => 1', input: {} };
const request = (token?: string, body = JSON.stringify(payload)) =>
  new Request('https://studio.test/api/database-preparation', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body
  });
it('rejects missing/invalid credentials before invoking the private executor', async () => {
  const execute = vi.fn<PreparationService['execute']>();
  const env = { CDM_EXECUTION: { execute } };
  expect((await handleDatabasePreparation(request(), env)).status).toBe(401);
  expect(
    (await handleDatabasePreparation(request('private-test-token'), env, async () => new Response('', { status: 401 })))
      .status
  ).toBe(401);
  expect(execute).not.toHaveBeenCalled();
});
it('fails closed on missing service, oversized/invalid JSON and private runtime errors', async () => {
  expect((await handleDatabasePreparation(request('test'), {})).status).toBe(503);
  const execute = vi.fn<PreparationService['execute']>(async () => {
    throw new Error('private-secret-and-sql');
  });
  const env = { CDM_EXECUTION: { execute } };
  expect((await handleDatabasePreparation(request('test', 'x'.repeat(600000)), env)).status).toBe(400);
  expect(execute).not.toHaveBeenCalled();
  const response = await handleDatabasePreparation(request('test'), env, async () =>
    Response.json({ id: 123, login: 'tester' })
  );
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain('private-secret-and-sql');
});
