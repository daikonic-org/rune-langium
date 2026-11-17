// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { dispatchWorkerRequest, isLinkDocumentResponse, _testInternals } from '../../src/workers/parser-worker.js';
import { declarationDocuments } from '../helpers/curated-declaration-fixture.js';
import { readLspModelMetadata } from '@rune-langium/core';

it('returns the complete linked closure as identities without sending disposable AST snapshots', async () => {
  const declared = await declarationDocuments([
    ['base', 'namespace example.base\n\ntype Base:\n  inherited string (1..1)\n'],
    [
      'selected',
      'namespace example.selected\nimport example.base.*\n\ntype Selected extends Base:\n  own int (0..1)\n'
    ],
    ['other', 'namespace example.other\n\ntype Other:\n  unrelated string (1..1)\n']
  ]);
  const documents = declared.map((doc) => {
    const uri = readLspModelMetadata(doc.serializedModel).sourceUri;
    if (!uri) throw new Error('Expected canonical fixture identity');
    return { ...doc, uri };
  });
  await dispatchWorkerRequest({ type: 'hydrate', id: 'install', documents });
  const request = { type: 'linkDocument' as const, id: 'identities', uri: documents[1]!.uri };
  const first = await dispatchWorkerRequest({ ...request, snapshot: 'uris' });
  if (first.type !== 'linkDocumentResult') throw new Error('Expected linked closure');
  expect(first).toMatchObject({ linked: true, errors: [], newModels: [] });
  expect(first.materializedUris?.toSorted()).toEqual(
    documents
      .slice(0, 2)
      .map((doc) => doc.uri)
      .toSorted()
  );
  expect(_testInternals().deferredModelJson.size).toBe(1);
  const repeated = await dispatchWorkerRequest({ ...request, id: 'repeat', snapshot: 'uris' });
  expect(repeated).toMatchObject({ linked: true, errors: [], newModels: [], materializedUris: first.materializedUris });
  const models = await dispatchWorkerRequest({ ...request, id: 'models', snapshot: true });
  if (models.type !== 'linkDocumentResult') throw new Error('Expected model snapshots');
  expect(models.newModels.map((model) => model.name).toSorted()).toEqual(['example.base', 'example.selected']);
  expect(models.materializedUris).toBeUndefined();
});

it('rejects malformed closure identities at the worker boundary', () => {
  const result = { type: 'linkDocumentResult', id: 'link', linked: true, errors: [], newModels: [] };
  expect(isLinkDocumentResponse(result)).toBe(true);
  expect(isLinkDocumentResponse({ ...result, materializedUris: ['file:///verified.rosetta'] })).toBe(true);
  expect(isLinkDocumentResponse({ ...result, materializedUris: [123] })).toBe(false);
  expect(isLinkDocumentResponse({ ...result, materializedUris: 'file:///verified.rosetta' })).toBe(false);
});
