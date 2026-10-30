// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import type { Target } from '@rune-langium/codegen/export';
import { findGeneratedDeclarationLine } from '../../src/utils/generated-declaration.js';

const declaration = { name: 'Party', namespace: 'test', kind: 'Data' };
const cases: { target: Target; content: string; expected: string }[] = [
  {
    target: 'typescript',
    content: 'export interface PartyIdentifier {}\nexport type Other = Party;\nexport class Party {}',
    expected: 'export class Party {}'
  },
  {
    target: 'zod',
    content:
      'export const PartyIdentifierSchema = z.object({});\nexport const PartySchema = z.object({});\nexport type Party = z.infer<typeof PartySchema>;',
    expected: 'export type Party = z.infer<typeof PartySchema>;'
  },
  {
    target: 'json-schema',
    content: JSON.stringify(
      {
        title: 'test',
        metadata: { Party: {} },
        $defs: { PartyIdentifier: {}, Other: { properties: { Party: {} } }, Party: { type: 'object' } }
      },
      null,
      2
    ),
    expected: '    "Party": {'
  },
  {
    target: 'json-schema',
    content: JSON.stringify(
      {
        title: 'Bundle: test, other',
        $defs: { 'other.Party': {}, 'test.PartyIdentifier': {}, 'test.Party': { type: 'object' } }
      },
      null,
      2
    ),
    expected: '    "test.Party": {'
  },
  {
    target: 'openapi',
    content: JSON.stringify(
      {
        openapi: '3.1.0',
        info: { title: 'test', Party: {} },
        paths: { '/Party': {} },
        components: {
          schemas: { PartyIdentifier: {}, Other: { properties: { Party: {} } }, Party: { type: 'object' } }
        }
      },
      null,
      2
    ),
    expected: '      "Party": {'
  },
  {
    target: 'sql',
    content:
      '-- Party\nCREATE TABLE "PartyIdentifier" (\n);\nCREATE TABLE "Other" (\n  "Party" TEXT\n);\nCREATE TABLE "Party" (\n);',
    expected: 'CREATE TABLE "Party" ('
  },
  {
    target: 'sql',
    content: 'CREATE TABLE [PartyIdentifier] (\n);\nCREATE TABLE [Party] (\n);',
    expected: 'CREATE TABLE [Party] ('
  },
  {
    target: 'xsd',
    content:
      '<xs:schema targetNamespace="urn:rune:test">\n<xs:complexType name="PartyIdentifier"/>\n  <xs:element name="Party" type="Party"/>\n<xs:complexType name="Party"/>\n</xs:schema>',
    expected: '<xs:complexType name="Party"/>'
  },
  {
    target: 'xsd',
    content:
      '<xs:schema targetNamespace="urn:rune:test">\n<xs:simpleType name="Party">\n  <xs:restriction base="xs:string"/>\n</xs:simpleType>\n</xs:schema>',
    expected: '<xs:simpleType name="Party">'
  }
];

describe('generated declaration destinations', () => {
  it.each(['Data', 'Choice', 'data', 'choice'])(
    'locates the public %s type alongside its same-name value factory',
    (kind) => {
      const file = {
        relativePath: 'test.ts',
        sourceMap: [],
        content: [
          '// Source namespace: test',
          'export const Party = Object.assign($Party$Data, { from: () => undefined });',
          'export class $Party$Data {}',
          'export type Party = $Party$Data;'
        ].join('\n')
      };
      expect(findGeneratedDeclarationLine('typescript', file, { ...declaration, kind })).toBe(3);
      expect(
        findGeneratedDeclarationLine(
          'typescript',
          { ...file, content: file.content + '\nexport type Party = Other;' },
          {
            ...declaration,
            kind
          }
        )
      ).toBeUndefined();
      expect(
        findGeneratedDeclarationLine('typescript', file, { ...declaration, namespace: 'other', kind })
      ).toBeUndefined();
    }
  );

  it.each(cases)('locates exact scoped declarations for $target', ({ target, content, expected }) => {
    const line = findGeneratedDeclarationLine(target, { content, sourceMap: [], relativePath: 'model' }, declaration);
    expect(line).toBeDefined();
    expect(content.split('\n')[line!]).toBe(expected);
  });

  it.each(['json-schema', 'openapi'] as const)(
    'does not confuse nested properties or metadata for %s declarations',
    (target) => {
      const content = JSON.stringify(
        {
          metadata: { Party: {} },
          $defs: { Other: { properties: { Party: {} } } },
          components: { schemas: { Other: { properties: { Party: {} } } } }
        },
        null,
        2
      );
      expect(
        findGeneratedDeclarationLine(target, { content, sourceMap: [], relativePath: 'model' }, declaration)
      ).toBeUndefined();
    }
  );

  it('rejects ambiguous SQL declarations and unimplemented formats', () => {
    const file = {
      content: 'CREATE TABLE "Party" (\n);\nCREATE TABLE "Party" (\n);',
      sourceMap: [],
      relativePath: 'model.sql'
    };
    expect(findGeneratedDeclarationLine('sql', file, declaration)).toBeUndefined();
    expect(findGeneratedDeclarationLine('markdown', { ...file, content: '## Party' }, declaration)).toBeUndefined();
  });

  it('ignores inherited OpenAPI source-map offsets and uses the actual schema key', () => {
    const content = cases.find((item) => item.target === 'openapi')!.content;
    const file = {
      content,
      relativePath: 'model.openapi.json',
      sourceMap: [{ outputLine: 2, sourceUri: 'file:///test.rune', sourceLine: 1, sourceChar: 1 }]
    };
    const line = findGeneratedDeclarationLine('openapi', file, {
      ...declaration,
      sourceUri: 'file:///test.rune',
      sourceRange: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }
    });
    expect(content.split('\n')[line!]).toBe('      "Party": {');
  });

  it('finds OpenAPI function operations instead of schemas or references', () => {
    const content = JSON.stringify(
      {
        info: { title: 'test' },
        paths: { '/functions/PartyIdentifier': {}, '/functions/Party': { post: { operationId: 'Party' } } },
        components: { schemas: { Party: {} } }
      },
      null,
      2
    );
    const line = findGeneratedDeclarationLine(
      'openapi',
      { content, relativePath: 'model.openapi.json', sourceMap: [] },
      { ...declaration, kind: 'RosettaFunction' }
    );
    expect(content.split('\n')[line!]).toBe('    "/functions/Party": {');
  });
});

it('uses matching one-based source coordinates only to disambiguate real declarations', () => {
  const content = 'export function Party() {}\nexport function Party() {}';
  const file = {
    content,
    relativePath: 'model.ts',
    sourceMap: [{ outputLine: 1, sourceUri: 'file:///test.rune', sourceLine: 5, sourceChar: 1 }]
  };
  const target = {
    ...declaration,
    kind: 'RosettaFunction',
    sourceUri: 'file:///test.rune',
    sourceRange: { start: { line: 4, character: 0 }, end: { line: 5, character: 0 } }
  };
  expect(findGeneratedDeclarationLine('typescript', file, target)).toBe(1);
  expect(
    findGeneratedDeclarationLine(
      'typescript',
      { ...file, sourceMap: [{ ...file.sourceMap[0]!, outputLine: 200 }] },
      target
    )
  ).toBeUndefined();
});

it('does not treat schema-shaped metadata inside arrays as root declarations', () => {
  const content = JSON.stringify(
    { metadata: [{ $defs: { Party: {} }, components: { schemas: { Party: {} } } }] },
    null,
    2
  );
  for (const target of ['json-schema', 'openapi'] as const)
    expect(
      findGeneratedDeclarationLine(target, { content, relativePath: 'model', sourceMap: [] }, declaration)
    ).toBeUndefined();
});

it.each([
  { target: 'typescript', content: '// Source namespace: other\nexport class Party {}' },
  { target: 'zod', content: '// Source namespace: other\nexport type Party = string;' },
  { target: 'sql', content: '-- SQL DDL generated from namespace other (postgres)\nCREATE TABLE "Party" (\n);' },
  {
    target: 'xsd',
    content: '<xs:schema targetNamespace="urn:rune:other">\n<xs:complexType name="Party"/>\n</xs:schema>'
  },
  { target: 'json-schema', content: JSON.stringify({ title: 'other', $defs: { Party: {} } }, null, 2) },
  {
    target: 'openapi',
    content: JSON.stringify({ info: { title: 'other' }, components: { schemas: { Party: {} } } }, null, 2)
  }
] as const)('rejects same-name declarations from a different $target namespace', ({ target, content }) => {
  expect(
    findGeneratedDeclarationLine(target, { content, relativePath: 'model', sourceMap: [] }, declaration)
  ).toBeUndefined();
});
