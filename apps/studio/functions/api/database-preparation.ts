// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';
import {
  PreparationRequest,
  ExecutionIdentity,
  EXECUTION_LIMITS,
  readExecutionJson,
  type PreparationService
} from '@rune-langium/worker-core/execution';
import { jsonResponse } from '@rune-langium/worker-core/http';
import { withInstrumentation } from '../../src/services/instrumentation/core.js';
import { withEdgeInstrumentation } from '../lib/instrumentation-sink.js';

export interface PreparationEnv {
  CDM_EXECUTION?: PreparationService;
}

/** Authenticate before entering the private execution service; never forward credentials to submitted code. */
export const handleDatabasePreparation = withInstrumentation(
  async function handleDatabasePreparation(request: Request, env: PreparationEnv, fetcher: typeof fetch = fetch) {
    const reply = (status: number, error: string) =>
      jsonResponse(
        status,
        { error },
        {
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        }
      );
    if (request.method !== 'POST') return reply(405, 'POST required.');
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ') || authorization.length > 4096)
      return reply(401, 'Connect GitHub to prepare example data.');
    if (!env.CDM_EXECUTION) return reply(503, 'Hosted data preparation is unavailable.');
    let input: PreparationRequest;
    try {
      input = PreparationRequest.parse(await readExecutionJson(request.body, EXECUTION_LIMITS.requestBytes));
    } catch {
      return reply(400, 'Invalid preparation request.');
    }
    let identity: ExecutionIdentity;
    try {
      const response = await fetcher('https://api.github.com/user', {
        headers: { Authorization: authorization, Accept: 'application/vnd.github+json', 'User-Agent': 'Rune-Studio' },
        redirect: 'error',
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) {
        await response.body?.cancel();
        return reply(
          response.status === 401 || response.status === 403 ? 401 : 503,
          'GitHub authentication unavailable.'
        );
      }
      identity = z.object(ExecutionIdentity.shape).parse(await readExecutionJson(response.body, 64 * 1024));
    } catch {
      return reply(503, 'GitHub authentication unavailable.');
    }
    try {
      const result = await env.CDM_EXECUTION.execute(input, identity);
      return jsonResponse(200, result, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    } catch {
      return reply(403, 'Data preparation is not authorized or could not complete.');
    }
  },
  {
    op: 'handleDatabasePreparation',
    capture: 0,
    sanitizeError: (error) => ({ signature: error instanceof Error ? error.name : 'Error' })
  }
);

export const onRequest: PagesFunction<PreparationEnv> = withEdgeInstrumentation(
  withInstrumentation(({ request, env }) => handleDatabasePreparation(request, env), {
    op: 'databasePreparationRequest',
    capture: 0,
    sanitizeError: (error) => ({ signature: error instanceof Error ? error.name : 'Error' })
  })
);
