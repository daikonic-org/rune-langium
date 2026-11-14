// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { transform } from 'sucrase';
import { withInstrumentation } from './instrumentation/core.js';
import {
  PreparationRequest,
  PreparationResult,
  EXECUTION_LIMITS,
  assertExecutionJson,
  readExecutionJson
} from '@rune-langium/worker-core/execution';

/** The host transport runs preparation code; its query module uses an ordinary injected SQLite connection. */
export const prepareHostedDatabase = withInstrumentation(
  async function prepareHostedDatabase(
    request: PreparationRequest,
    options: { token: string; signal?: AbortSignal; fetcher?: typeof fetch }
  ): Promise<PreparationResult> {
    assertExecutionJson(request);
    const source = PreparationRequest.parse(request);
    const code = transform(source.code, {
      transforms: ['typescript'],
      filePath: 'preparation.ts',
      disableESTransforms: true
    }).code;
    const body = JSON.stringify({ ...source, code });
    if (new TextEncoder().encode(body).byteLength > EXECUTION_LIMITS.requestBytes)
      throw new Error('Preparation request too large.');
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(EXECUTION_LIMITS.wallMs + 5000)])
      : AbortSignal.timeout(EXECUTION_LIMITS.wallMs + 5000);
    signal.throwIfAborted();
    const response = await (options.fetcher ?? fetch)('/api/database-preparation', {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' },
      body,
      signal,
      redirect: 'error'
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        response.status === 401 ? 'Connect GitHub to prepare example data.' : 'Hosted data preparation unavailable.'
      );
    }
    const result = PreparationResult.parse(await readExecutionJson(response.body, EXECUTION_LIMITS.resultBytes + 2048));
    if (result.projectRevision !== source.projectRevision)
      throw new Error('Preparation revision differs from its request.');
    if (signal.aborted) throw signal.reason;
    return result;
  },
  {
    op: 'prepareHostedDatabase',
    capture: 0,
    sanitizeError: (error) => ({ signature: error instanceof Error ? error.name : 'Error' })
  }
);
