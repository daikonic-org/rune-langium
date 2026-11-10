// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { afterEach, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { createReferenceArtifacts } from '../../../test/helpers/project-reference-artifacts.js';
import {
  createMemoryReferenceCache,
  decodeReferenceArtifact,
  decodeReferenceArtifactAsync,
  loadLockedReferences,
  resolveProjectReferences
} from '../src/references/index.js';

afterEach(() => vi.unstubAllGlobals());

it.each([true, false])('validates async artifacts identically with native gzip=%s', async (native) => {
  if (!native) vi.stubGlobal('DecompressionStream', undefined);
  const fixture = await createReferenceArtifacts();
  const artifacts = [...fixture.artifacts].filter(([url]) => url.endsWith('.serialized.json.gz'));
  expect(artifacts.length).toBeGreaterThan(0);
  for (const [, bytes] of artifacts) {
    expect(await decodeReferenceArtifactAsync(bytes)).toEqual(decodeReferenceArtifact(bytes));
    await expect(decodeReferenceArtifactAsync(bytes.subarray(0, bytes.length - 5))).rejects.toThrow();
  }
  await expect(decodeReferenceArtifactAsync(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  await expect(decodeReferenceArtifactAsync(gzipSync('invalid JSON'))).rejects.toThrow();
  await expect(decodeReferenceArtifactAsync(gzipSync('{"schemaVersion":99}'))).rejects.toThrow();
});

it('passes verified bytes to the injected decoder on resolve and offline locked open', async () => {
  const fixture = await createReferenceArtifacts();
  const decodeArtifact = vi.fn(async (bytes: Uint8Array) => decodeReferenceArtifact(bytes));
  const transport = { ...fixture.transport, decodeArtifact };
  const cache = createMemoryReferenceCache();
  const signal = new AbortController().signal;
  const { lock, diagnostics } = await resolveProjectReferences(fixture.snapshot, transport, signal, cache);
  expect(diagnostics).toEqual([]);
  expect(decodeArtifact).toHaveBeenCalledTimes(2);
  const offline = {
    ...transport,
    artifact: vi.fn(async () => {
      throw new Error('offline');
    })
  };
  expect((await loadLockedReferences(lock!, offline, cache, signal)).diagnostics).toEqual([]);
  expect(offline.artifact).not.toHaveBeenCalled();
  const corrupt = { get: async () => new Uint8Array([1]), put: async () => {} };
  decodeArtifact.mockClear();
  expect((await loadLockedReferences(lock!, offline, corrupt, signal)).diagnostics[0]?.code).toBe(
    'REFERENCE_UNAVAILABLE'
  );
  expect(decodeArtifact).not.toHaveBeenCalled();
});
