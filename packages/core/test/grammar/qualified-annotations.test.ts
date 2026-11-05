// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { expect, it } from 'vitest';
import { URI } from 'langium';
import {
  addLegacyAnnotations,
  assertValidDocuments,
  BASICTYPES_ROSETTA,
  createRuneDslServices,
  hydrateModelDocuments,
  isRosettaFunction,
  isRosettaModel
} from '../../src/index.js';
import { serializeRuneModel } from '../../src/serializer/rune-serialize.js';

async function workspace(annotation: string) {
  const services = createRuneDslServices();
  const { RuneDsl } = services;
  const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
  const annotations = addLegacyAnnotations(
    factory.fromString(
      `namespace com.rosetta.model
annotation metadata:
 scheme string (0..1)
`,
      URI.parse('inmemory:///annotations.rosetta')
    ),
    factory
  );
  const schemas = factory.fromString(
    `namespace fpml.schemas
enum SerializationFormat:
 XML
 CUSTOM_FORMAT
schema fpml514ConfirmationXML XML
`,
    URI.parse('inmemory:///schemas.rosetta')
  );
  const custom = factory.fromString(
    `namespace custom.annotations
annotation marking:
 scheme string (0..1)
annotation ingest:
 CUSTOM boolean (0..1)
`,
    URI.parse('inmemory:///custom.rosetta')
  );
  const owner = factory.fromString(
    `namespace example
import fpml.schemas.* as fpml
import custom.annotations.* as custom
func Read:
 ${annotation}
 output: result string (0..1)
`,
    URI.parse('inmemory:///owner.rosetta')
  );
  const docs = [
    annotations,
    schemas,
    custom,
    owner,
    factory.fromString(BASICTYPES_ROSETTA, URI.parse('inmemory:///basics.rosetta'))
  ];
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs, { validation: false });
  const model = owner.parseResult.value;
  if (!isRosettaModel(model)) throw new Error('Missing owner model');
  const fn = model.elements.find(isRosettaFunction)!;
  return { services, RuneDsl, docs, owner, annotation: fn.annotations[0]! };
}

it.each(['ingest', 'projection', 'enrich'])('links %s annotations to an aliased schema', async (kind) => {
  const result = await workspace(`[${kind} fpml.fpml514ConfirmationXML]`);
  assertValidDocuments(result.docs);
  expect(result.annotation.attribute?.ref).toMatchObject({ $type: 'Schema', name: 'fpml514ConfirmationXML' });
  expect(result.annotation.attribute?.$refText).toBe('fpml.fpml514ConfirmationXML');
});

it.each([
  ['[com.rosetta.model.ingest fpml.schemas.fpml514ConfirmationXML]', 'Schema', 'fpml514ConfirmationXML'],
  ['[ingest CUSTOM_FORMAT]', 'RosettaEnumValue', 'CUSTOM_FORMAT'],
  ['[ingest XML]', 'Attribute', 'XML'],
  ['[custom.marking scheme "scheme"="ISIN"]', 'Attribute', 'scheme'],
  ['[custom.ingest CUSTOM]', 'Attribute', 'CUSTOM']
])('retains qualified annotation identity and legacy arguments: %s', async (annotation, type, name) => {
  const result = await workspace(annotation!);
  assertValidDocuments(result.docs);
  expect(result.annotation.attribute?.ref).toMatchObject({ $type: type, name });
});

it.each([
  '[ingest fpml.MissingSchema]',
  '[metadata fpml.fpml514ConfirmationXML]',
  '[custom.ingest fpml.fpml514ConfirmationXML]',
  '[missing.ingest fpml.fpml514ConfirmationXML]'
])('rejects unknown or inappropriate qualified arguments: %s', async (annotation) => {
  const result = await workspace(annotation);
  expect(() => assertValidDocuments(result.docs)).toThrow();
});

it('preserves exact schema targets through serialized workspace hydration', async () => {
  const result = await workspace('[ingest fpml.fpml514ConfirmationXML]');
  assertValidDocuments(result.docs);
  const entries = result.docs.map((doc) => ({
    uri: doc.uri,
    json: serializeRuneModel(result.RuneDsl.serializer.JsonSerializer, doc.parseResult.value)
  }));
  const hydrated = hydrateModelDocuments(createRuneDslServices(), entries.reverse());
  const owner = hydrated.find(({ document }) => document.uri.toString() === result.owner.uri.toString())!.model;
  const fn = owner.elements.find(isRosettaFunction)!;
  const schemas = hydrated.find(({ model }) => model.name === 'fpml.schemas')!.model;
  expect(fn.annotations[0]?.attribute?.$refText).toBe('fpml.fpml514ConfirmationXML');
  expect(fn.annotations[0]?.attribute?.ref).toBe(schemas.elements.find((node) => node.$type === 'Schema'));
});
