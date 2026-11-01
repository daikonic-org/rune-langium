// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { afterEach, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
  parse,
  createRuneDslServices,
  serializeRuneModel,
  compactLspModelJson,
  readLspModelMetadata
} from '@rune-langium/core';
import { EmptyFileSystem } from 'langium';
import {
  createReferenceArtifactDecoder,
  prepareReferenceArtifact
} from '../../src/services/reference-artifact-decoder.js';
import { curatedArtifactCache } from '../../src/services/curated-artifact-cache.js';
import { projectFileRevision } from '@rune-langium/project-config';

afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const source = 'namespace reference\ntype Payment:\n amount number (1..1)';
  const parsed = await parse(source);
  const services = createRuneDslServices(EmptyFileSystem);
  const modelJson = serializeRuneModel(services.RuneDsl.serializer.JsonSerializer, parsed.value!);
  return {
    modelJson,
    bytes: gzipSync(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'langium-json-serializer',
        modelId: 'cdm',
        version: '2026-10-31',
        langiumVersion: '4.4.0',
        documents: [{ path: 'payment.rosetta', modelJson }]
      })
    )
  };
}
it('prepares canonical index/metadata/compaction and restores derived data on the next decode', async () => {
  const { bytes, modelJson } = await fixture();
  const hash = await projectFileRevision(modelJson);
  let stored: Awaited<ReturnType<typeof curatedArtifactCache.referenceDerived>>;
  vi.spyOn(curatedArtifactCache, 'referenceDerived').mockImplementation(async (key) =>
    key === hash ? stored : undefined
  );
  const write = vi.spyOn(curatedArtifactCache, 'putReferenceDerived').mockImplementation(async (_key, value) => {
    stored = value;
  });
  const first = await prepareReferenceArtifact(bytes);
  expect(first.documents[0]!.lsp).toEqual({
    metadata: readLspModelMetadata(modelJson),
    compact: compactLspModelJson(modelJson)
  });
  expect(first.documents[0]!.exports).toContainEqual({ name: 'Payment', type: 'Data', path: '/elements@0' });
  expect((await prepareReferenceArtifact(bytes)).documents[0]!.lsp).toEqual(first.documents[0]!.lsp);
  expect(write).toHaveBeenCalledOnce();
});
it('deduplicates concurrent verified decodes without sharing cancellation and bounds retained payloads', async () => {
  const { bytes } = await fixture();
  const value = await prepareReferenceArtifact(bytes);
  let release!: () => void;
  const decode = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return value;
  });
  const cached = createReferenceArtifactDecoder(decode);
  const abort = new AbortController();
  const first = cached(bytes, 'one', abort.signal);
  const second = cached(bytes, 'one', new AbortController().signal);
  abort.abort();
  release();
  await expect(first).rejects.toThrow();
  await expect(second).resolves.toBe(value);
  await expect(cached(bytes, 'one', new AbortController().signal)).resolves.toBe(value);
  expect(decode).toHaveBeenCalledOnce();
  const unretained = vi.fn(async () => value);
  const bounded = createReferenceArtifactDecoder(unretained, 1);
  await bounded(bytes, 'one', new AbortController().signal);
  await bounded(bytes, 'one', new AbortController().signal);
  expect(unretained).toHaveBeenCalledTimes(2);
});
it('evicts failed decodes and rejects corrupt artifacts', async () => {
  const { bytes } = await fixture();
  const decode = vi
    .fn()
    .mockRejectedValueOnce(new Error('failed'))
    .mockResolvedValueOnce(await prepareReferenceArtifact(bytes));
  const cached = createReferenceArtifactDecoder(decode);
  await expect(cached(bytes, 'one', new AbortController().signal)).rejects.toThrow('failed');
  await expect(cached(bytes, 'one', new AbortController().signal)).resolves.toBeDefined();
  await expect(prepareReferenceArtifact(new Uint8Array([1, 2, 3]))).rejects.toThrow();
});

it('reuses the decoder through resolver capture, review loading and cached activation', async () => {
  const { createReferenceArtifacts } = await import('../../../../test/helpers/project-reference-artifacts.js');
  const { createMemoryReferenceCache, resolveProjectReferences, loadLockedReferences } =
    await import('@rune-langium/project-runtime/references');
  const fixture = await createReferenceArtifacts();
  const decode = vi.fn(prepareReferenceArtifact);
  const transport = { ...fixture.transport, decodeArtifact: createReferenceArtifactDecoder(decode) };
  const cache = createMemoryReferenceCache();
  const signal = new AbortController().signal;
  const { lock, diagnostics } = await resolveProjectReferences(fixture.snapshot, transport, signal, cache);
  expect(diagnostics).toEqual([]);
  for (let open = 0; open < 2; open++) {
    expect((await loadLockedReferences(lock!, transport, cache, signal)).diagnostics).toEqual([]);
  }
  expect(decode).toHaveBeenCalledTimes(2); // One decode for each of the two immutable cohorts.
});
