// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { it, expect } from 'vitest';
import { URI, AstUtils, DocumentState } from 'langium';
import { createRuneDslServices, BASICTYPES_ROSETTA, type Data, type RosettaModel } from '../../src/index.js';
import {
  declarationKey,
  getEffectiveProjectDeclaration,
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

async function namespaceOverrides(sources: string[]) {
  const { RuneDsl: services, shared } = createRuneDslServices();
  const docs = [BASICTYPES_ROSETTA, ...sources].map((source, i) =>
    shared.workspace.LangiumDocumentFactory.fromString(source, URI.parse(`file:///namespace-${i}.rosetta`))
  );
  for (const document of docs) shared.workspace.LangiumDocuments.addDocument(document);
  await shared.workspace.DocumentBuilder.build(docs, { eagerLinking: true, validation: true });
  expect(docs.flatMap((doc) => doc.parseResult.parserErrors.map((error) => error.message))).toEqual([]);
  return { services, shared, docs };
}

it.each([false, true])(
  'uses override namespace for ordinary Rune linking regardless of document order (%s)',
  async (reverse) => {
    const original =
      'namespace upstream\ntype Value:\n original string (1..1)\ntype Retained:\n value string (1..1)\nfunc Calculate:\n output: result number (1..1)\n set result: 1';
    const replacement =
      'override namespace upstream\ntype Value:\n replacement string (1..1)\nfunc Calculate:\n output: result number (1..1)\n set result: 2';
    const { docs } = await namespaceOverrides([
      ...(reverse ? [replacement, original] : [original, replacement]),
      'namespace consumer\nimport upstream.* as u\ntype Use:\n value u.Value (1..1)\n retained u.Retained (1..1)\nfunc Call:\n output: result number (1..1)\n set result: u.Calculate()'
    ]);
    const override = docs[reverse ? 1 : 2]!.parseResult.value as RosettaModel;
    const source = docs[reverse ? 2 : 1]!.parseResult.value as RosettaModel;
    const consumer = docs[3]!;
    expect(consumer.references.flatMap((ref) => (ref.error ? [ref.error.message] : []))).toEqual([]);
    const use = (consumer.parseResult.value as RosettaModel).elements[0] as Data;
    expect(use.attributes[0]!.typeCall.type.ref).toBe(override.elements[0]);
    expect(use.attributes[1]!.typeCall.type.ref).toBe(source.elements[1]);
    const { isRosettaSymbolReference } = await import('../../src/index.js');
    const call = AstUtils.streamAllContents(consumer.parseResult.value)
      .filter(isRosettaSymbolReference)
      .find((node) => node.symbol.$refText === 'u.Calculate')!;
    expect(call.symbol.ref).toBe(override.elements[1]);
    expect(getEffectiveProjectDeclaration(source.elements[0]!)).toBe(override.elements[0]);
    expect(getEffectiveProjectDeclaration(source.elements[2]!)).toBe(override.elements[1]);
    expect((source.elements[0] as Data).attributes[0]!.name).toBe('original');
  }
);

it('selects namespace overrides even for declarations with no references to link', async () => {
  const { docs } = await namespaceOverrides([
    'namespace vocabulary\nenum State:\n Old',
    'override namespace vocabulary\nenum State:\n New'
  ]);
  expect(getEffectiveProjectDeclaration((docs[1]!.parseResult.value as RosettaModel).elements[0]!)).toBe(
    (docs[2]!.parseResult.value as RosettaModel).elements[0]
  );
});
it('rejects an incomplete native function dispatch override', async () => {
  const base = 'func Compute:\n inputs: kind Kind (1..1)\n output: result number (1..1)\n set result: 1';
  const { docs } = await namespaceOverrides([
    'namespace upstream\nenum Kind:\n Cash\n' + base + '\nfunc Compute(kind: Kind -> Cash):\n set result: 2',
    'override namespace upstream\n' + base
  ]);
  expect(
    docs.flatMap((doc) => doc.diagnostics ?? []).some((issue) => issue.code === 'NAMESPACE_OVERRIDE_DISPATCH')
  ).toBe(true);
});

it('accepts a complete native dispatch override while retaining its shared enum', async () => {
  const family = (base: number, branch: number) =>
    `func Compute:\n inputs: kind Kind (1..1)\n output: result number (1..1)\n set result: ${base}\nfunc Compute(kind: Kind -> Cash):\n set result: ${branch}`;
  const { docs } = await namespaceOverrides([
    'namespace upstream\nenum Kind:\n Cash\n' + family(1, 2),
    'override namespace upstream\n' + family(3, 4)
  ]);
  expect(docs.flatMap((document) => document.diagnostics ?? []).filter((issue) => issue.severity === 1)).toEqual([]);
  const original = docs[1]!.parseResult.value as RosettaModel;
  const local = docs[2]!.parseResult.value as RosettaModel;
  expect(getEffectiveProjectDeclaration(original.elements[0]!)).toBe(original.elements[0]);
  expect(getEffectiveProjectDeclaration(original.elements[1]!)).toBe(local.elements[0]);
  expect(getEffectiveProjectDeclaration(original.elements[2]!)).toBe(local.elements[1]);
});

it('rejects competing namespace override declarations instead of choosing by file order', async () => {
  const { docs } = await namespaceOverrides([
    'namespace upstream\ntype Value:\n original string (1..1)',
    'override namespace upstream\ntype Value:\n firstValue string (1..1)',
    'override namespace upstream\ntype Value:\n second string (1..1)'
  ]);
  expect(
    docs.flatMap((doc) => doc.diagnostics ?? []).filter((issue) => issue.code === 'NAMESPACE_OVERRIDE_AMBIGUOUS')
  ).toHaveLength(2);
  expect(getEffectiveProjectDeclaration((docs[1]!.parseResult.value as RosettaModel).elements[0]!)).toBeUndefined();
});

it('invalidates native namespace selection when an override document is reparsed', async () => {
  const { shared, docs } = await namespaceOverrides([
    'namespace upstream\ntype Value:\n original string (1..1)',
    'override namespace upstream\ntype Value:\n firstValue string (1..1)',
    'namespace consumer\ntype Use:\n value upstream.Value (1..1)'
  ]);
  const replacement = shared.workspace.LangiumDocumentFactory.fromString(
    'override namespace upstream\ntype Value:\n second string (1..1)',
    docs[2]!.uri
  );
  shared.workspace.LangiumDocuments.deleteDocument(docs[2]!.uri);
  shared.workspace.LangiumDocuments.addDocument(replacement);
  shared.workspace.DocumentBuilder.resetToState(docs[3]!, DocumentState.IndexedContent);
  await shared.workspace.DocumentBuilder.build([replacement, docs[3]!], { eagerLinking: true });
  const use = (docs[3]!.parseResult.value as RosettaModel).elements[0] as Data;
  expect(use.attributes[0]!.typeCall.type.ref).toBe((replacement.parseResult.value as RosettaModel).elements[0]);
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
