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
import { EmptyFileSystem, URI } from 'langium';
import type { Data } from '@rune-langium/core';
import {
  createReferenceArtifactDecoder,
  prepareReferenceArtifact
} from '../../src/services/reference-artifact-decoder.js';
import { curatedArtifactCache } from '../../src/services/curated-artifact-cache.js';
import { projectFileRevision } from '@rune-langium/project-config';

afterEach(() => vi.restoreAllMocks());
async function fixture(indexed = false) {
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
        documents: [
          {
            path: 'payment.rosetta',
            modelJson,
            ...(indexed
              ? {
                  exports: [{ name: 'Payment', type: 'Data', path: '/elements@0' }]
                }
              : {})
          }
        ]
      })
    )
  };
}
it.each([false, true])('prepares and caches canonical scope even with publication index=%s', async (indexed) => {
  const { bytes, modelJson } = await fixture(indexed);
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
  expect(first.documents[0]!.exports).toContainEqual({ name: 'reference.Payment', type: 'Data', path: '/elements@0' });
  const next = (await prepareReferenceArtifact(bytes)).documents[0]!;
  expect(next.lsp).toEqual(first.documents[0]!.lsp);
  expect(next.exports).toEqual(first.documents[0]!.exports);
  expect(write).toHaveBeenCalledOnce();
});

it.each(['reference.Payment', 'ref.Payment'])('lazily loads an indexed publication through %s', async (typeName) => {
  const { createParserWorkerHarness } = await import('../workers/parser-worker-harness.js');
  const { _testInternals } = await import('../../src/workers/parser-worker.js');
  const worker = createParserWorkerHarness();
  const { bytes } = await fixture(true);
  const artifact = await prepareReferenceArtifact(bytes);
  const document = artifact.documents[0]!;
  const referenceUri = 'file:///[cdm]/payment.rosetta';
  const ownerUri = 'file:///owner.rosetta';
  const source = `namespace local\nimport reference.* as ref\ntype Owned:\n payment ${typeName} (1..1)`;
  const installed = await worker.send({
    type: 'parseWorkspace',
    id: typeName,
    files: [
      {
        name: referenceUri,
        content: 'namespace reference',
        serializedModelJson: document.modelJson,
        exports: document.exports!
      },
      { name: ownerUri, content: source }
    ]
  });
  expect(installed).toMatchObject({ errors: {} });
  expect(worker.findExport('reference.Payment')).toBeDefined();
  const owner = _testInternals().services.shared.workspace.LangiumDocuments.getDocument(URI.parse(ownerUri))!;
  const owned = (owner.parseResult.value as import('@rune-langium/core').RosettaModel).elements[0] as Data;
  expect(owned.attributes[0]!.typeCall!.type?.ref).toMatchObject({ $type: 'Data', name: 'Payment' });
  expect(worker.hasDeferredModel(referenceUri)).toBe(false);
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

it('overlaps bounded derived-cache reads and retains document order despite out-of-order completion', async () => {
  const documents = Array.from({ length: 9 }, (_, index) => ({
    path: `model-${index}.rosetta`,
    modelJson: JSON.stringify({ $type: 'RosettaModel', name: `model${index}`, imports: [], elements: [] })
  }));
  const byHash = new Map(
    await Promise.all(
      documents.map(async (doc, index) => [await projectFileRevision(doc.modelJson), { doc, index }] as const)
    )
  );
  let active = 0,
    peak = 0;
  vi.spyOn(curatedArtifactCache, 'referenceDerived').mockImplementation(async (hash) => {
    const { doc, index } = byHash.get(hash)!;
    peak = Math.max(peak, ++active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5 + (3 - (index % 4)) * 5));
      return { metadata: readLspModelMetadata(doc.modelJson), compact: doc.modelJson, exports: [] };
    } finally {
      active--;
    }
  });
  const value = await prepareReferenceArtifact(
    gzipSync(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'langium-json-serializer',
        modelId: 'cdm',
        version: '2026-10-31',
        langiumVersion: '4.4.0',
        documents
      })
    )
  );
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(4);
  expect(active).toBe(0);
  expect(value.documents.map((doc) => doc.path)).toEqual(documents.map((doc) => doc.path));
  expect(value.documents.every((doc) => doc.lsp?.metadata.hasImplementationSources === false)).toBe(true);
});
