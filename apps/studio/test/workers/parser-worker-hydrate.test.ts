// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  HydrateRequest,
  HydrateResponse,
  WorkerRequest,
  WorkerResponse
} from '../../src/workers/parser-worker.js';

describe('HydrateRequest type', () => {
  it('is included in WorkerRequest union', () => {
    expectTypeOf<HydrateRequest>().toMatchTypeOf<WorkerRequest>();
  });

  it('has documents array with embedded exports field', () => {
    const req: HydrateRequest = {
      type: 'hydrate',
      id: 'h1',
      documents: [
        {
          uri: 'file:///x.rune',
          content: '',
          serializedModel: '{}',
          exports: [{ type: 'Data', name: 'T', path: 'x.T' }]
        }
      ]
    };
    expectTypeOf(req.documents).toBeArray();
  });
});

describe('HydrateResponse type', () => {
  it('is included in WorkerResponse union', () => {
    expectTypeOf<HydrateResponse>().toMatchTypeOf<WorkerResponse>();
  });
});

describe('hydrate handler', () => {
  it('links user documents without publishing duplicate graph models, and still publishes curated documents', async () => {
    const { createParserWorkerHarness } = await import('./parser-worker-harness.js');
    const harness = createParserWorkerHarness();
    await harness.send({
      type: 'hydrate',
      id: 'owned',
      documents: [
        {
          uri: 'file:///user.rosetta',
          content: '',
          serializedModel: harness.serializeSample('user', 'User'),
          exports: []
        },
        {
          uri: 'file:///[cdm]/curated.rosetta',
          content: '',
          bundleId: 'cdm',
          serializedModel: harness.serializeSample('curated', 'Curated'),
          exports: []
        }
      ]
    });
    const user = await harness.send({ type: 'linkDocument', id: 'user', uri: 'file:///user.rosetta' });
    expect(user).toMatchObject({ linked: true, newModels: [] });
    const curated = await harness.send({ type: 'linkDocument', id: 'curated', uri: 'file:///[cdm]/curated.rosetta' });
    expect(curated.type).toBe('linkDocumentResult');
    if (curated.type !== 'linkDocumentResult') throw new Error('Unexpected response');
    expect(curated.newModels).toHaveLength(1);
    expect(curated.newModels[0]?.name).toBe('curated');
  });
  it("registers serialized models and exports in the worker's shared state", async () => {
    const { createParserWorkerHarness } = await import('./parser-worker-harness.js');
    const harness = createParserWorkerHarness();

    const docUri = 'file:///cdm.base.math.rune';
    const result = await harness.send({
      type: 'hydrate',
      id: 'h1',
      documents: [
        {
          uri: docUri,
          content: 'namespace cdm.base.math\ntype Quantity:\n  amount number (1..1)\n',
          serializedModel: harness.serializeSample('cdm.base.math', 'Quantity'),
          exports: [{ type: 'Data', name: 'Quantity', path: 'cdm.base.math.Quantity' }]
        }
      ]
    });

    expect(result.type).toBe('hydrateResult');
    expect((result as { ok: boolean }).ok).toBe(true);

    // Directly verify side effects: the deferred-model map and index must be populated.
    expect(harness.hasDeferredModel(docUri)).toBe(true);
    expect(harness.findExport('Quantity')).toEqual(
      expect.objectContaining({ name: 'Quantity', path: 'cdm.base.math.Quantity' })
    );

    harness.dispose();
  });

  it('reports ok: false when given a malformed documents array', async () => {
    const { createParserWorkerHarness } = await import('./parser-worker-harness.js');
    const harness = createParserWorkerHarness();

    // Pass null as documents so handleHydrate throws when iterating.
    const result = await harness.send({
      type: 'hydrate',
      id: 'h2',
      documents: null as unknown as Array<never>
    });

    expect((result as { ok: boolean }).ok).toBe(false);

    harness.dispose();
  });
});

it('retains linked documents for an identical install and can return a selected snapshot again', async () => {
  const { createParserWorkerHarness } = await import('./parser-worker-harness.js');
  const harness = createParserWorkerHarness();
  const documents = [
    {
      uri: 'file:///[cdm]/repeat.rosetta',
      content: '',
      bundleId: 'cdm',
      serializedModel: harness.serializeSample('repeat', 'Repeat'),
      exports: []
    }
  ];
  await harness.send({ type: 'hydrate', id: 'first', documents });
  const first = await harness.send({ type: 'linkDocument', id: 'first-link', uri: documents[0]!.uri });
  expect(first).toMatchObject({ linked: true, newModels: [expect.objectContaining({ name: 'repeat' })] });
  await harness.send({ type: 'hydrate', id: 'same', documents });
  expect(harness.hasDeferredModel(documents[0]!.uri)).toBe(false);
  const snapshot = await harness.send({ type: 'linkDocument', id: 'again', uri: documents[0]!.uri, snapshot: true });
  expect(snapshot).toMatchObject({ linked: true, newModels: [expect.objectContaining({ name: 'repeat' })] });
});

it('rejects a malformed transitive artifact without publishing a partial closure and permits a repaired install', async () => {
  const { createParserWorkerHarness } = await import('./parser-worker-harness.js');
  const harness = createParserWorkerHarness();
  const rootUri = 'file:///[cdm]/root.rosetta';
  const dependencyUri = 'file:///[cdm]/dependency.rosetta';
  const root = JSON.parse(harness.serializeSample('pinned', 'Parent'));
  root.elements[0].attributes[0].typeCall.type = {
    $ref: `${dependencyUri}#/elements@0`,
    $refText: 'Support'
  };
  const documents = [
    {
      uri: rootUri,
      content: '',
      bundleId: 'cdm',
      artifactKey: 'root-artifact',
      serializedModel: JSON.stringify(root),
      exports: []
    },
    {
      uri: dependencyUri,
      content: '',
      bundleId: 'cdm',
      artifactKey: 'dependency-artifact',
      serializedModel: '{',
      exports: []
    }
  ];
  await harness.send({ type: 'hydrate', id: 'broken', documents });
  const failed = await harness.send({ type: 'linkDocument', id: 'failed', uri: rootUri, snapshot: true });
  expect(failed).toMatchObject({ linked: false, newModels: [] });
  if (failed.type !== 'linkDocumentResult') throw new Error('Unexpected response');
  expect(failed.invalidArtifactKeys?.sort()).toEqual(['dependency-artifact', 'root-artifact']);
  expect(harness.hasDeferredModel(rootUri)).toBe(true);
  expect(harness.hasDeferredModel(dependencyUri)).toBe(true);

  const repairedDocuments = documents.map((document) =>
    document.uri === dependencyUri
      ? { ...document, serializedModel: harness.serializeSample('support', 'Support') }
      : document
  );
  await harness.send({ type: 'hydrate', id: 'repaired', documents: repairedDocuments });
  const repaired = await harness.send({ type: 'linkDocument', id: 'relinked', uri: rootUri, snapshot: true });
  expect(repaired).toMatchObject({ linked: true, errors: [] });
  if (repaired.type !== 'linkDocumentResult') throw new Error('Unexpected response');
  expect(repaired.newModels.map((model) => model.name).sort()).toEqual(['pinned', 'support']);
  expect(repaired.invalidArtifactKeys).toBeUndefined();
});
