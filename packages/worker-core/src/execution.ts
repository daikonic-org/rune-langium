// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { z } from 'zod';

export const EXECUTION_LIMITS = {
  requestBytes: 512 * 1024,
  sourceCharacters: 256 * 1024,
  resultBytes: 1024 * 1024,
  wallMs: 10000,
  cpuMs: 1000,
  queries: 24,
  queryCharacters: 16384,
  rowsPerQuery: 600,
  rowsPerRun: 2400
} as const;

export const PreparationRequest = z.strictObject({
  schemaVersion: z.literal(1),
  projectRevision: z.string().regex(/^[a-f0-9]{64}$/),
  code: z.string().min(1).max(EXECUTION_LIMITS.sourceCharacters),
  input: z.json()
});
export type PreparationRequest = z.infer<typeof PreparationRequest>;
export const PreparationResult = z.strictObject({
  schemaVersion: z.literal(1),
  executionId: z.uuid(),
  projectRevision: PreparationRequest.shape.projectRevision,
  value: z.json(),
  queryCount: z.number().int().nonnegative().max(EXECUTION_LIMITS.queries)
});
export type PreparationResult = z.infer<typeof PreparationResult>;
export const ExecutionIdentity = z.strictObject({
  id: z.number().int().positive(),
  login: z.string().regex(/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i)
});
export type ExecutionIdentity = z.infer<typeof ExecutionIdentity>;
export interface PreparationService {
  execute(request: PreparationRequest, identity: ExecutionIdentity): Promise<PreparationResult>;
}

/** Bound the transport before JSON/Zod decoding; shared by Pages and the browser client. */
export async function readExecutionJson(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<unknown> {
  if (!body) throw new Error('Execution body required.');
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '',
    bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error('Execution body too large.');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    assertExecutionJson(value);
    return value;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Prevent recursive schema validation/stringification from visiting unbounded JSON trees. */
export function assertExecutionJson(value: unknown): void {
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const next = pending.pop();
    if (!next) break;
    if (++nodes > 20000 || next.depth > 32) throw new Error('Execution JSON too complex.');
    const item = next.value;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') continue;
    if (typeof item === 'number' && Number.isFinite(item)) continue;
    if (Array.isArray(item)) {
      for (const child of item) pending.push({ value: child, depth: next.depth + 1 });
    } else if (typeof item === 'object' && item !== null && Object.getPrototypeOf(item) === Object.prototype) {
      for (const child of Object.values(item)) pending.push({ value: child, depth: next.depth + 1 });
    } else throw new Error('Execution requires plain JSON.');
  }
}
