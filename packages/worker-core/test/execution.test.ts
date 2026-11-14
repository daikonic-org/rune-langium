// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { assertExecutionJson, readExecutionJson } from '../src/execution.js';

it('limits streamed JSON bytes and cancels the transport on rejection', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(' '.repeat(100)));
    },
    cancel() {
      cancelled = true;
    }
  });
  await expect(readExecutionJson(stream, 20)).rejects.toThrow('large');
  expect(cancelled).toBe(true);
  expect(await readExecutionJson(new Response('{"ok":true}').body, 50)).toEqual({ ok: true });
});
it('rejects deep/non-JSON values before recursive schema validation', () => {
  let nested: unknown = null;
  for (let index = 0; index < 40; index++) nested = [nested];
  expect(() => assertExecutionJson(nested)).toThrow('complex');
  expect(() => assertExecutionJson({ value: Infinity })).toThrow('plain JSON');
  expect(() => assertExecutionJson(new Date())).toThrow('plain JSON');
  expect(() => assertExecutionJson({ values: [1, '2', null] })).not.toThrow();
});
