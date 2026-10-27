// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { beforeAll, expect, it } from 'vitest';
import { URI, type LangiumDocument } from 'langium';
import ExcelJS from 'exceljs';
import {
  createRuneDslServices,
  BASICTYPES_ROSETTA,
  getEnumValueLiteral,
  getEnumValues,
  isRosettaEnumeration,
  isRosettaModel,
  assertValidDocuments,
  serializeRuneModel,
  hydrateModelDocuments
} from '@rune-langium/core';
import { generate, generatePreviewSchemas, generatePythonModule } from '../../src/export.js';
import { renderCodeListEnum } from '../../src/runtime/code-list-enum.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { runPython } from '../projection/python-test-utils.js';
const codes = [
  { value: 'ACT/360', label: 'Actual / 360' },
  { value: 'ACT_360', label: 'Distinct code' },
  { value: "O'Reilly", label: 'A quoted label\nwith a new line' },
  { value: '__proto__', label: 'Prototype name' },
  { value: 'condition', label: 'Keyword' }
];
let documents: LangiumDocument[];
beforeAll(async () => {
  const { RuneDsl } = createRuneDslServices();
  const texts = [
    BASICTYPES_ROSETTA,
    'namespace rune.resources\nsynonym source CodeList',
    renderCodeListEnum('Codes', codes, { declareSource: false }),
    `namespace enum_usage
import rune.resources.*
type Contract:
 code Codes (1..1)
func Select:
 inputs: text string (1..1)
 output: result Codes (0..1)
 set result: text to-enum Codes
func First:
 output: result Codes (1..1)
 set result: Codes -> ACT_360
`
  ];
  documents = texts.map((text, index) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(text, URI.parse(`inmemory:///enum-${index}.rosetta`))
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build(documents, { validation: true, eagerLinking: true });
  assertValidDocuments(documents);
});
it('retains distinct codes, escaped identifiers and display labels in the canonical Rune enum', () => {
  const root = documents[2]!.parseResult.value;
  if (!isRosettaModel(root)) throw new Error('Expected a model');
  const enumeration = root.elements.find(isRosettaEnumeration)!;
  expect(getEnumValues(enumeration).map(getEnumValueLiteral)).toEqual(codes.map((code) => code.value));
  expect(new Set(enumeration.enumValues.map((member) => member.name)).size).toBe(codes.length);
  expect(generatePreviewSchemas(documents, { targetId: 'enum_usage.Contract' })[0]!.fields[0]).toMatchObject({
    enumValues: codes
  });
});
it('executes TypeScript enum literals and to-enum using codes instead of identifiers or labels', async () => {
  const outputs = await generate(documents, { target: 'typescript', typescript: { layout: 'single-file' } });
  const module = compileGeneratedTypeScript(outputs);
  expect(module.First!()).toBe('ACT/360');
  for (const { value } of codes) expect(module.Select!(value)).toBe(value);
  expect(module.Select!('Actual / 360')).toBeUndefined();
  expect(module.Select!('not-a-code')).toBeUndefined();
});
it('executes the same enum literals and conversions in standalone Python', () => {
  const python = generatePythonModule(documents);
  const select = python.bindings.get('enum_usage.Select');
  const first = python.bindings.get('enum_usage.First');
  expect(
    runPython(
      [
        { expression: `${first}()` },
        ...codes.map(({ value }) => ({ expression: `${select}(${JSON.stringify(value)})` })),
        { expression: `${select}("not-a-code")` }
      ],
      python.code,
      { includeRuntime: false }
    )
  ).toEqual(['ACT/360', ...codes.map((code) => code.value), null].map((value) => ({ value })));
});
it('compiles and validates Zod enum codes with quote and newline labels', async () => {
  const outputs = await generate(documents, { target: 'zod', zod: { layout: 'single-file' } });
  const module =
    compileGeneratedTypeScript<Record<string, { safeParse(value: unknown): { success: boolean } }>>(outputs);
  for (const code of codes) expect(module.CodesSchema!.safeParse(code.value).success).toBe(true);
  expect(module.CodesSchema!.safeParse('not-a-code').success).toBe(false);
});
it('keeps ordinary foreign synonyms and display labels out of enum wire semantics', async () => {
  const { RuneDsl } = createRuneDslServices();
  const document = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    `namespace foreign
synonym source CodeList
enum Ordinary:
 Identifier displayName "Presentation"
  [synonym CodeList value "Foreign"]
`,
    URI.parse('inmemory:///ordinary.rosetta')
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([document]);
  const root = document.parseResult.value;
  if (!isRosettaModel(root)) throw new Error('Expected model');
  const enumeration = root.elements.find(isRosettaEnumeration)!;
  expect(getEnumValueLiteral(enumeration.enumValues[0]!)).toBe('Identifier');
});

it('exports the same wire values in the Excel enum dictionary', async () => {
  const outputs = await generate(documents, { target: 'excel' });
  const workbook = new ExcelJS.Workbook();
  const binary = outputs.find((output) => output.binary)!.binary!;
  await workbook.xlsx.load(
    binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength) as ArrayBuffer
  );
  const rows: unknown[] = [];
  workbook.getWorksheet('Enums')!.eachRow((row) => rows.push(row.values));
  const text = JSON.stringify(rows);
  for (const code of codes) expect(text).toContain(code.value);
});

it('preserves code semantics through canonical serialization and linked worker-style hydration', () => {
  const services = createRuneDslServices();
  const serialized = documents.map((document) => ({
    uri: document.uri,
    json: serializeRuneModel(services.RuneDsl.serializer.JsonSerializer, document.parseResult.value)
  }));
  const hydrated = hydrateModelDocuments(services, serialized).map((entry) => entry.document);
  const schema = generatePreviewSchemas(hydrated, { targetId: 'enum_usage.Contract' })[0]!;
  expect(schema.fields[0]).toMatchObject({ enumValues: codes });
});

it('rejects ambiguous literal mappings instead of selecting a code by annotation order', () => {
  const root = documents[2]!.parseResult.value;
  if (!isRosettaModel(root)) throw new Error('Expected model');
  const member = root.elements.find(isRosettaEnumeration)!.enumValues[0]!;
  expect(() =>
    getEnumValueLiteral({ ...member, enumSynonyms: [...member.enumSynonyms, ...member.enumSynonyms] })
  ).toThrow(/one literal/);
});

it('renders a self-contained Rune enum document for ordinary parser and generator consumers', async () => {
  const { RuneDsl } = createRuneDslServices();
  const document = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
    renderCodeListEnum('Standalone', codes),
    URI.parse('inmemory:///standalone.rosetta')
  );
  await RuneDsl.shared.workspace.DocumentBuilder.build([document], { validation: true, eagerLinking: true });
  assertValidDocuments([document]);
  const schema = await generate([document], { target: 'json-schema' });
  expect(schema.flatMap((file) => file.diagnostics).filter((issue) => issue.severity === 'error')).toEqual([]);
  expect(schema.map((file) => file.content).join('\n')).toContain('ACT/360');
});
