// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { it, expect } from 'vitest';
import { URI } from 'langium';
import { createRuneDslServices, BASICTYPES_ROSETTA, type Data, type RosettaModel } from '../../src/index.js';
import {
  declarationKey,
  setProjectRedirects,
  setProjectDocumentModel
} from '../../src/references/project-resolution.js';

it('redirects source references by model, namespace and kind without a name-only collision', async () => {
  const services = createRuneDslServices();
  const factory = services.shared.workspace.LangiumDocumentFactory;
  const documents = [
    factory.fromString(BASICTYPES_ROSETTA, URI.parse('file:///basictypes.rosetta')),
    factory.fromString(
      'namespace upstream\ntype Same:\n value string (1..1)\nenum Other:\n One',
      URI.parse('file:///cdm.rosetta')
    ),
    factory.fromString('namespace local\ntype Same:\n value string (1..1)', URI.parse('file:///local.rosetta')),
    factory.fromString(
      'namespace consumer\nimport upstream.*\ntype User:\n value Same (1..1)\n other Other (1..1)',
      URI.parse('file:///consumer.rosetta')
    )
  ];
  setProjectDocumentModel(services.RuneDsl, documents[1]!.uri, 'cdm');
  setProjectDocumentModel(services.RuneDsl, documents[2]!.uri, 'local');
  setProjectDocumentModel(services.RuneDsl, documents[3]!.uri, 'fpml');
  const source = { model: 'cdm', namespace: 'upstream', kind: 'Data', name: 'Same' };
  const destination = { model: 'local', namespace: 'local', kind: 'Data', name: 'Same' };
  for (const document of documents) services.shared.workspace.LangiumDocuments.addDocument(document);
  setProjectRedirects(services.RuneDsl, {
    resolve: (identity) => (declarationKey(identity) === declarationKey(source) ? destination : identity)
  });
  await services.shared.workspace.DocumentBuilder.build(documents, { eagerLinking: true });
  const user = (documents[3]!.parseResult.value as RosettaModel).elements[0] as Data;
  expect(user.attributes[0]!.typeCall.type.ref).toBe((documents[2]!.parseResult.value as RosettaModel).elements[0]);
  expect(user.attributes[1]!.typeCall.type.ref).toBe((documents[1]!.parseResult.value as RosettaModel).elements[1]);
  expect(declarationKey(source)).not.toBe(declarationKey({ ...source, kind: 'RosettaFunction' }));
  expect(declarationKey(source)).not.toBe(declarationKey({ ...source, model: 'fpml' }));
});

it('keeps same-name type, enum and function mappings distinct in parsed Rune', async () => {
  const { RuneDsl: services, shared } = createRuneDslServices();
  const factory = shared.workspace.LangiumDocumentFactory;
  const definitions = [
    ['shapes', 'Data', 'type Same:\n value string (1..1)'],
    ['vocabulary', 'RosettaEnumeration', 'enum Same:\n One'],
    ['callables', 'RosettaFunction', 'func Same:\n output: result number (1..1)\n set result: 1']
  ] as const;
  const documents = [factory.fromString(BASICTYPES_ROSETTA, URI.parse('file:///basictypes.rosetta'))];
  const mappings = new Map();
  for (const [suffix, kind, body] of definitions) {
    for (const model of ['cdm', 'local']) {
      const document = factory.fromString(
        'namespace ' + model + '.' + suffix + '\n' + body,
        URI.parse('file:///' + model + '-' + suffix + '.rosetta')
      );
      documents.push(document);
      setProjectDocumentModel(services, document.uri, model);
    }
    mappings.set(declarationKey({ model: 'cdm', namespace: 'cdm.' + suffix, kind, name: 'Same' }), {
      model: 'local',
      namespace: 'local.' + suffix,
      kind,
      name: 'Same'
    });
  }
  const consumer = factory.fromString(
    'namespace consumer\ntype Use:\n value cdm.shapes.Same (1..1)\n status cdm.vocabulary.Same (1..1)\nfunc Call:\n output: result number (1..1)\n set result: cdm.callables.Same()',
    URI.parse('file:///consumer.rosetta')
  );
  documents.push(consumer);
  for (const document of documents) shared.workspace.LangiumDocuments.addDocument(document);
  setProjectRedirects(services, { resolve: (identity) => mappings.get(declarationKey(identity)) ?? identity });
  await shared.workspace.DocumentBuilder.build(documents, { eagerLinking: true });
  expect(consumer.parseResult.parserErrors.map((error) => error.message)).toEqual([]);
  expect(consumer.references.flatMap((ref) => (ref.error ? [ref.error.message] : []))).toEqual([]);
  const model = consumer.parseResult.value as RosettaModel;
  const use = model.elements[0] as Data;
  expect(use.attributes.map((attr) => attr.typeCall.type.ref?.$container?.name)).toEqual([
    'local.shapes',
    'local.vocabulary'
  ]);
  const { AstUtils } = await import('langium');
  const { isRosettaSymbolReference } = await import('../../src/index.js');
  const call = AstUtils.streamAllContents(model)
    .filter(isRosettaSymbolReference)
    .find((node) => node.symbol.$refText === 'cdm.callables.Same')!;
  expect(call.symbol.ref?.$container?.name).toBe('local.callables');
});
