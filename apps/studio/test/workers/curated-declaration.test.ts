// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { astToModel } from '@rune-langium/visual-editor';
import { declarationDocuments } from '../helpers/curated-declaration-fixture.js';
import { dispatchWorkerRequest } from '../../src/workers/parser-worker.js';

it('reads canonical own fields without requiring dependencies or replacing authoritative documents', async () => {
  const documents = await declarationDocuments();
  await dispatchWorkerRequest({ type: 'hydrate', id: 'full', documents });
  const result = await dispatchWorkerRequest({ type: 'inspectNamespace', id: 'first', documents: [documents[1]!] });
  expect(result.type).toBe('inspectNamespaceResult');
  if (result.type !== 'inspectNamespaceResult') throw new Error('Wrong response');
  expect(result.error).toBeUndefined();
  const node = astToModel(result.models).nodes[0]!;
  expect(node.id).toBe('example.selected.Selected#Data');
  expect(node.data).toMatchObject({
    $type: 'Data',
    superType: { $refText: 'Base' },
    attributes: [{ name: 'own', typeCall: { type: { $refText: 'int' } }, card: { inf: 0, sup: 1 } }]
  });
  expect(node.meta.deferred).toBeUndefined();
  const full = await dispatchWorkerRequest({ type: 'linkDocument', id: 'linked', uri: documents[1]!.uri });
  expect(full).toMatchObject({ type: 'linkDocumentResult', linked: true, errors: [] });
  if (full.type !== 'linkDocumentResult') throw new Error('Wrong response');
  const base = await dispatchWorkerRequest({ type: 'linkDocument', id: 'base-linked', uri: documents[0]!.uri });
  expect(base).toMatchObject({ type: 'linkDocumentResult', linked: true, errors: [] });
  if (base.type !== 'linkDocumentResult') throw new Error('Wrong response');
  expect(
    astToModel([...full.newModels, ...base.newModels])
      .nodes.map((node) => node.data.name)
      .sort()
  ).toEqual(['Base', 'Selected']);
});

it('contains malformed artifact failures without poisoning the next declaration read', async () => {
  expect(
    await dispatchWorkerRequest({
      type: 'inspectNamespace',
      id: 'bad',
      documents: [{ uri: 'cdm/bad.rosetta', serializedModel: '{bad' }]
    })
  ).toMatchObject({ type: 'inspectNamespaceResult', models: [], error: expect.any(String) });
  const documents = await declarationDocuments();
  expect(await dispatchWorkerRequest({ type: 'inspectNamespace', id: 'next', documents })).toMatchObject({
    type: 'inspectNamespaceResult',
    models: [{ name: 'example.base' }, { name: 'example.selected' }]
  });
});
