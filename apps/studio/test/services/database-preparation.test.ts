// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, it, vi } from 'vitest';
import { prepareHostedDatabase } from '../../src/services/database-preparation.js';

const request = {
  schemaVersion: 1 as const,
  projectRevision: 'a'.repeat(64),
  code: 'export default () => 1',
  input: {}
};
const result = {
  schemaVersion: 1,
  executionId: '9eff0b54-f949-47ad-9fd0-794cce5cd58a',
  projectRevision: request.projectRevision,
  queryCount: 0,
  value: 1
};
it('rejects stale revision results and canceled preparation before dispatch', async () => {
  await expect(
    prepareHostedDatabase(request, {
      token: 'test',
      fetcher: async () => Response.json({ ...result, projectRevision: 'b'.repeat(64) })
    })
  ).rejects.toThrow('revision');
  const fetcher = vi.fn<typeof fetch>();
  const signal = AbortSignal.abort(new Error('Canceled preparation.'));
  await expect(prepareHostedDatabase(request, { token: 'test', signal, fetcher })).rejects.toThrow('Canceled');
  expect(fetcher).not.toHaveBeenCalled();
});
it('does not reflect a remote error body or include credentials in the request payload', async () => {
  const fetcher: typeof fetch = async (url, init) => {
    expect(url).toBe('/api/database-preparation');
    expect(String(init?.body)).not.toContain('private-test-token');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer private-test-token');
    return new Response('private-sql-and-credential', { status: 403 });
  };
  await expect(prepareHostedDatabase(request, { token: 'private-test-token', fetcher })).rejects.toThrow(
    'Hosted data preparation unavailable.'
  );
});
