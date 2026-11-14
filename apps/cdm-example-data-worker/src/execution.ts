// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { WorkerEntrypoint, RpcTarget } from 'cloudflare:workers';
import {
  PreparationRequest,
  PreparationResult,
  ExecutionIdentity,
  EXECUTION_LIMITS,
  assertExecutionJson
} from '@rune-langium/worker-core/execution';
import { createReadConnection } from './query-policy.js';
import { d1BenchmarkDatabase } from './storage.js';
import driver from './generated/driver-source.json' with { type: 'json' };

class DatabaseConnection extends RpcTarget {
  #connection: ReturnType<typeof createReadConnection>;
  constructor(connection: ReturnType<typeof createReadConnection>) {
    super();
    this.#connection = connection;
  }
  query(sql: unknown, params: unknown, method: unknown) {
    return this.#connection.query(sql, params, method);
  }
}
declare abstract class ModuleRunner extends WorkerEntrypoint {
  run(connection: DatabaseConnection, input: PreparationRequest['input']): Promise<string>;
}

const RUNNER_SOURCE = `
import { WorkerEntrypoint } from 'cloudflare:workers';
const stringify = JSON.stringify.bind(JSON);
const encoder = new TextEncoder();
const encode = encoder.encode.bind(encoder);
export class Runner extends WorkerEntrypoint {
  async run(connection, input) {
    const { default: prepare } = await import('./user.js');
    const value = await prepare(connection, input);
    const text = stringify(value);
    if (typeof text !== 'string' || encode(text).byteLength > ${EXECUTION_LIMITS.resultBytes})
      throw new Error('Preparation result is too large.');
    return text;
  }
}`;

/** Private service binding entrypoint; no public SQL or code-execution route. */
export class DatabaseExecution extends WorkerEntrypoint<Env> {
  async execute(input: unknown, principal: unknown): Promise<PreparationResult> {
    const identity = ExecutionIdentity.parse(principal);
    const allowed = this.env.EXECUTION_ALLOWED_GITHUB_IDS.split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (!allowed.includes(String(identity.id))) throw new Error('Database preparation is not authorized.');
    assertExecutionJson(input);
    const request = PreparationRequest.parse(input);
    const connection = createReadConnection(d1BenchmarkDatabase(this.env.DB));
    const executionId = crypto.randomUUID();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const worker = this.env.EXECUTION_LOADER.load({
        compatibilityDate: '2026-11-13',
        mainModule: 'runner.js',
        modules: { 'runner.js': RUNNER_SOURCE, 'user.js': request.code, 'driver.js': driver.source },
        globalOutbound: null,
        env: {},
        limits: { cpuMs: EXECUTION_LIMITS.cpuMs, subRequests: EXECUTION_LIMITS.queries }
      });
      const runner = worker.getEntrypoint<ModuleRunner>('Runner', {
        limits: { cpuMs: EXECUTION_LIMITS.cpuMs, subRequests: EXECUTION_LIMITS.queries }
      });
      const text = await Promise.race([
        runner.run(new DatabaseConnection(connection), request.input),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Preparation timed out.')), EXECUTION_LIMITS.wallMs);
        })
      ]);
      if (new TextEncoder().encode(text).byteLength > EXECUTION_LIMITS.resultBytes)
        throw new Error('Result too large.');
      const value: unknown = JSON.parse(text);
      assertExecutionJson(value);
      return PreparationResult.parse({
        schemaVersion: 1,
        executionId,
        projectRevision: request.projectRevision,
        value,
        queryCount: connection.queryCount
      });
    } catch {
      throw new Error('Database preparation failed.');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      connection.close();
    }
  }
}
