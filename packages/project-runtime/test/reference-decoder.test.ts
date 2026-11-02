// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { expect, it, vi } from 'vitest';
import { createReferenceArtifacts } from '../../../test/helpers/project-reference-artifacts.js';
import {
  createMemoryReferenceCache,
  decodeReferenceArtifact,
  loadLockedReferences,
  resolveProjectReferences
} from '../src/references/index.js';
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
