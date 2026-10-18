// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { URI, EmptyFileSystem } from 'langium';
import {
  createRuneDslServices,
  hydrateModelDocument,
  isData,
  RuneDslIndexManager,
  RuneDslLinker,
  serializeRuneModel,
  type RosettaModel
} from '../../src/index.js';

it('discovers a description without its document but requires materialization for an AST reference', async () => {
  const publisher = createRuneDslServices(EmptyFileSystem).RuneDsl;
  const uri = URI.parse('file:///published.rosetta');
  const parent = publisher.shared.workspace.LangiumDocumentFactory.fromString(
    'namespace published\ntype Parent:\n',
    uri
  );
  const json = serializeRuneModel(publisher.serializer.JsonSerializer, parent.parseResult.value);

  const { RuneDsl, shared } = createRuneDslServices(EmptyFileSystem);
  expect(shared.workspace.IndexManager).toBeInstanceOf(RuneDslIndexManager);
  const index = shared.workspace.IndexManager as RuneDslIndexManager;
  index.registerExports(uri, [{ name: 'published.Parent', type: 'Data', path: '/elements@0', documentUri: uri }]);
  const user = shared.workspace.LangiumDocumentFactory.fromString<RosettaModel>(
    'namespace user\nimport published.*\ntype Child extends Parent:\n',
    URI.parse('file:///user.rosetta')
  );
  await shared.workspace.DocumentBuilder.build([user], { validation: false, eagerLinking: false });
  const child = user.parseResult.value.elements.find(isData)!;
  expect(user.parseResult.parserErrors).toEqual([]);
  const description = RuneDsl.references.ScopeProvider.getScope({
    container: child,
    property: 'superType',
    reference: child.superType!
  }).getElement('Parent');
  expect(description).toMatchObject({ name: 'published.Parent', type: 'Data', documentUri: uri });
  expect(shared.workspace.LangiumDocuments.getDocument(uri)).toBeUndefined();
  expect(RuneDsl.references.Linker).toBeInstanceOf(RuneDslLinker);
  const linker = RuneDsl.references.Linker as RuneDslLinker;
  expect(linker.loadAstNode(description!)).toBeUndefined();

  const hydrated = hydrateModelDocument({ RuneDsl, shared }, uri, json, { register: 'always' });
  expect(linker.loadAstNode(description!)).toBe(hydrated.model.elements[0]);
  expect(child.superType?.ref).toBe(hydrated.model.elements[0]);
});
