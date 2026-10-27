// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { it, expect, vi } from 'vitest';
import {
  generate,
  generatePreviewSchemas,
  validateProjectPreviewBindings,
  previewTypeSymbol
} from '@rune-langium/codegen/export';
import { createProjectSnapshot } from '@rune-langium/project-config';
import { buildEffectiveProject } from '../src/effective-project.js';
import { decodeProjectCodeList, readReferenceCodeList } from '../src/code-lists.js';
import { resolveProjectResource } from '../src/resources.js';
const base = new URL('../../../test/fixtures/third-party/cdm-codelists/', import.meta.url);
const text = readFileSync(new URL('option-type-1-0.json', base), 'utf8');
const expected = {
  format: 'cdm-json' as const,
  canonicalUri: 'http://www.fpml.org/coding-scheme/option-type',
  version: '1-0'
};
it('decodes real CDM lists and retains descriptions, dates and distinct version identity', () => {
  const manifest = JSON.parse(readFileSync(new URL('sources.json', base), 'utf8'));
  for (const [path, checksum] of Object.entries(manifest.sha256))
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(path, base)))
        .digest('hex')
    ).toBe(checksum);
  const result = decodeProjectCodeList(text, expected);
  expect(result.values).toHaveLength(10);
  expect(result.values.find((entry) => entry.value === 'Call')).toMatchObject({
    source: 'FpML',
    effectiveDate: '2012-05-11',
    label: 'Call',
    description: expect.stringContaining('right')
  });
  expect(() => decodeProjectCodeList(text, { ...expected, version: '2-0' })).toThrow(/version differs/);
  expect(() => decodeProjectCodeList(text, { ...expected, canonicalUri: 'urn:other' })).toThrow(/scheme URI differs/);
  expect(() => decodeProjectCodeList(text)).toThrow();
});
it('retains deprecation metadata without silently dropping historical values and rejects duplicate/bad dates', () => {
  const value = { value: 'old', label: 'Old', deprecatedDate: '2020-01-01' };
  expect(decodeProjectCodeList(JSON.stringify([value])).values).toEqual([value]);
  expect(() => decodeProjectCodeList(JSON.stringify([value, value]))).toThrow(/distinct/);
  expect(() => decodeProjectCodeList(JSON.stringify([{ ...value, deprecatedDate: 'yesterday' }]))).toThrow();
});
it('uses one real CDM code list in linked form choices, native constraints and captured resource provenance', async () => {
  const source = {
    model: 'cdm',
    repository: 'https://github.com/finos/common-domain-model',
    release: 'nightly',
    commit: '1704b23907b3dc4b87ba7a0133cb75aad9b43c77',
    path: 'rosetta-source/src/main/resources/codelist/json/option-type-1-0.json'
  };
  const identity = { model: 'local', id: 'option.OptionType#RosettaTypeAlias' };
  const snapshot = await createProjectSnapshot(
    'codes',
    new Map([
      ['rune-config.yml', 'model: {name: Codes}'],
      [
        'build-config.yml',
        JSON.stringify({
          schemaVersion: 1,
          overrides: [
            {
              kind: 'resource',
              source: identity,
              path: 'resources/option-type.json',
              codeList: expected,
              provenance: source
            }
          ]
        })
      ],
      [
        'model/options.rosetta',
        'namespace option\ntypeAlias OptionType: string\ntype Contract:\n option OptionType (0..1)'
      ],
      ['resources/option-type.json', text]
    ]),
    () => []
  );
  const graph = await buildEffectiveProject(snapshot, []);
  expect(graph.diagnostics).toEqual([]);
  expect(
    graph.capabilities
      .filter((entry) => entry.id.startsWith('resource:'))
      .every((entry) => entry.status === 'available')
  ).toBe(true);
  const preview = generatePreviewSchemas([...graph.documents], {
    targetId: 'option.Contract',
    projectBindings: graph.bindings
  })[0]!;
  expect(preview.fields[0]).toMatchObject({ kind: 'enum', enumValues: decodeProjectCodeList(text, expected).values });
  expect(validateProjectPreviewBindings(preview, { option: 'Call' }, graph.bindings)).toEqual([]);
  expect(validateProjectPreviewBindings(preview, { option: 'Unknown' }, graph.bindings)).toHaveLength(1);
  const outputs = await generate([...graph.documents], {
    target: 'json-schema',
    projectResources: graph.bindings
  });
  expect(outputs.map((file) => file.content).join('\n')).toContain('"Call"');
  expect(resolveProjectResource(snapshot, identity)).toMatchObject({
    checksum: snapshot.fileRevisions.get('resources/option-type.json'),
    provenance: source
  });
  expect(snapshot.files.get('resources/option-type.json')).toBe(text);
});

it('stages a code-list copy from verified Git bytes without fetching its scheme URI', async () => {
  const source = {
    model: 'cdm',
    repository: 'https://github.com/finos/common-domain-model',
    release: 'nightly',
    commit: '1704b23907b3dc4b87ba7a0133cb75aad9b43c77',
    path: 'rosetta-source/src/main/resources/codelist/json/option-type-1-0.json'
  };
  const bytes = new TextEncoder().encode(text);
  const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const responses = [
    Response.json({ sha: source.commit, commit: { tree: { sha: 'b'.repeat(40) } } }),
    Response.json({
      truncated: false,
      tree: [{ path: source.path, sha, size: bytes.length, mode: '100644', type: 'blob' }]
    }),
    new Response(text)
  ];
  const fetcher = vi.fn(async (_url: string) => responses.shift()!);
  const staged = await readReferenceCodeList(source, new AbortController().signal, expected, fetcher);
  expect(staged).toMatchObject({
    content: text,
    provenance: source,
    codeList: expected,
    values: decodeProjectCodeList(text, expected).values
  });
  expect(
    fetcher.mock.calls.every(([url]) => url.startsWith('https://api.github.com/repos/finos/common-domain-model/'))
  ).toBe(true);
});

it('materializes mapped code lists into portable Rune enums consumed without generator-specific bindings', async () => {
  const codes = [
    { value: 'ACT/360', label: 'Actual / 360', description: 'First basis' },
    { value: 'ACT_360', label: 'A distinct code' },
    { value: "O'Reilly", label: 'Quoted code', deprecatedDate: '2020-01-01' },
    { value: 'condition', label: 'A keyword' }
  ];
  const files = new Map([
    ['rune-config.yml', 'model: {name: Codes}'],
    [
      'build-config.yml',
      JSON.stringify({
        schemaVersion: 1,
        overrides: [
          {
            kind: 'resource',
            source: { model: 'local', id: 'demo.Basis#RosettaTypeAlias' },
            path: 'resources/basis.json'
          }
        ]
      })
    ],
    ['model/demo.rosetta', 'namespace demo\ntypeAlias Basis: string\ntype Contract:\n basis Basis (1..1)'],
    ['resources/basis.json', JSON.stringify(codes)]
  ]);
  const snapshot = await createProjectSnapshot('portable-enums', files, () => []);
  const graph = await buildEffectiveProject(snapshot, []);
  expect(graph.diagnostics).toEqual([]);
  const schema = generatePreviewSchemas([...graph.documents], { targetId: 'demo.Contract' })[0]!;
  expect(schema.fields[0]).toMatchObject({
    kind: 'enum',
    enumValues: codes.map((code) => expect.objectContaining({ value: code.value }))
  });
  const outputs = new Map<string, string>();
  for (const target of ['typescript', 'zod', 'json-schema', 'sql', 'xsd', 'openapi'] as const) {
    const result = await generate([...graph.documents], { target });
    expect(result.flatMap((file) => file.diagnostics).filter((issue) => issue.severity === 'error')).toEqual([]);
    outputs.set(target, result.map((file) => file.content).join('\n'));
  }
  for (const target of ['typescript', 'zod', 'json-schema', 'sql', 'xsd', 'openapi'])
    expect(outputs.get(target)).toContain('ACT/360');
  const sources = graph.documents
    .filter((document) => document.uri.toString().startsWith('file:///project-resources/'))
    .map((document) => document.textDocument.getText())
    .join('\n');
  expect(sources).toContain('enum ');
  expect(sources).toContain('value "ACT/360"');
  const reopened = await buildEffectiveProject(snapshot, []);
  expect(reopened.diagnostics).toEqual([]);
  expect(generatePreviewSchemas([...reopened.documents], { targetId: 'demo.Contract' })).toEqual([schema]);
  expect(snapshot.files).toEqual(files);
});

it('keeps empty code lists on the explicit never-value adapter boundary', async () => {
  const snapshot = await createProjectSnapshot(
    'empty-list',
    new Map([
      ['rune-config.yml', 'model: {name: Empty}'],
      [
        'build-config.yml',
        JSON.stringify({
          schemaVersion: 1,
          overrides: [
            {
              kind: 'resource',
              source: { model: 'local', id: 'empty_list.Code#RosettaTypeAlias' },
              path: 'resources/empty.json'
            }
          ]
        })
      ],
      ['model/empty.rosetta', 'namespace empty_list\ntypeAlias Code: string'],
      ['resources/empty.json', '[]']
    ]),
    () => []
  );
  const graph = await buildEffectiveProject(snapshot, []);
  expect(graph.diagnostics).toEqual([]);
  expect(graph.documents.some((document) => document.uri.toString().startsWith('file:///project-resources/'))).toBe(
    false
  );
  expect(graph.bindings.codeListForType(previewTypeSymbol('RosettaTypeAlias', 'empty_list.Code')!)).toEqual([]);
  const { assertProjectGenerationCapabilities } = await import('../src/effective-project.js');
  expect(() => assertProjectGenerationCapabilities(graph, undefined, 'sql')).toThrow();
});

it('materializes an explicitly mapped reference alias while retaining reference and workspace bytes', async () => {
  const source = 'namespace reference_codes\ntypeAlias Code: string';
  const references = [{ uri: 'cdm/codes.rosetta', content: source }];
  const files = new Map([
    ['rune-config.yml', 'model: {name: ReferenceCodes}'],
    [
      'build-config.yml',
      JSON.stringify({
        schemaVersion: 1,
        overrides: [
          {
            kind: 'resource',
            source: { model: 'cdm', id: 'reference_codes.Code#RosettaTypeAlias' },
            path: 'resources/codes.json'
          }
        ]
      })
    ],
    ['model/use.rosetta', 'namespace usage\nimport reference_codes.*\ntype Contract:\n code Code (1..1)'],
    ['resources/codes.json', '[{"value":"ACT/360","label":"Actual / 360"}]']
  ]);
  const snapshot = await createProjectSnapshot('reference-enum', files, () => []);
  const graph = await buildEffectiveProject(snapshot, references);
  expect(graph.diagnostics).toEqual([]);
  const schema = generatePreviewSchemas([...graph.documents], { targetId: 'usage.Contract' })[0]!;
  expect(schema.fields[0]).toMatchObject({ kind: 'enum', enumValues: [{ value: 'ACT/360', label: 'Actual / 360' }] });
  expect(references[0]!.content).toBe(source);
  expect(snapshot.files).toEqual(files);
});
