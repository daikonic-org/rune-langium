// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { createRuneDslServices, getModelSourceUri, serializeRuneModel, type RosettaModel } from '@rune-langium/core';
import { URI } from 'langium';
import { buildSourceFileOwnership } from '../../src/shell/source-file-ownership.js';

it.each([false, true])(
  'uses parsed document ownership and namespace instead of URI paths or stale metadata, serialized=%s',
  async (serialized) => {
    const { RuneDsl, shared } = createRuneDslServices();
    await shared.workspace.WorkspaceManager.initializeWorkspace([]);
    const files = [
      {
        name: 'model.rosetta',
        path: 'one/model.rosetta',
        content: 'namespace current.one\ntype First:\n value string (0..1)',
        namespace: 'stale.one',
        dirty: false
      },
      {
        name: 'model.rosetta',
        path: 'two/model.rosetta',
        content: 'namespace current.two\ntype Second:\n value string (0..1)',
        namespace: 'stale.two',
        dirty: false
      }
    ];
    const docs = files.map((file, index) =>
      shared.workspace.LangiumDocumentFactory.fromString<RosettaModel>(
        file.content,
        URI.parse(`file:///${index}.rosetta`)
      )
    );
    for (const doc of docs) shared.workspace.LangiumDocuments.addDocument(doc);
    await shared.workspace.DocumentBuilder.build(docs, { validation: false, eagerLinking: true });
    const models = docs.map((doc, index) => ({
      filePath: files[index]!.path,
      model: serialized
        ? (JSON.parse(serializeRuneModel(RuneDsl.serializer.JsonSerializer, doc.parseResult.value)) as RosettaModel)
        : doc.parseResult.value
    }));
    const ownership = buildSourceFileOwnership(models, files);
    expect(ownership.byUri.get(getModelSourceUri(models[1]!.model)!)).toBe('two/model.rosetta');
    expect(ownership.byUri.get('file:///0.rosetta')).toBe('one/model.rosetta');
    expect(ownership.namespaceByFile.get('one/model.rosetta')).toBe('current.one');
    expect(ownership.urisByFile.get('two/model.rosetta')).toContain('file:///workspace/two/model.rosetta');
  }
);

it('does not select an arbitrary file for an ambiguous model URI', () => {
  const files = ['a.rosetta', 'b.rosetta'].map((path) => ({ name: path, path, content: '', dirty: false }));
  const models = files.map((file) => ({
    filePath: file.path,
    model: {
      $type: 'RosettaModel',
      name: 'shared',
      elements: [],
      $textRegion: { documentURI: 'file:///ambiguous.rosetta' }
    } as unknown as RosettaModel
  }));
  expect(buildSourceFileOwnership(models, files).byUri.get('file:///ambiguous.rosetta')).toBeUndefined();
});
