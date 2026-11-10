// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { getEnumValueLiteral, isRosettaEnumeration, isRosettaModel, isRosettaSynonymSource } from '@rune-langium/core';
import { createProjectDraftSnapshot } from '@rune-langium/project-config';
import { buildEffectiveProject } from '../src/effective-project.js';
import {
  codeListCases,
  codeListDeclarations,
  createCuratedCodeListProject,
  expectedCodeListResult
} from '../../../test/helpers/cdm-code-list-loader.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../test/helpers/vitest-budget.js';
import { generatePreviewSchemas, generatePythonModule, generateSelected } from '@rune-langium/codegen/export';
import { compileGeneratedTypeScript } from '../../codegen/test/helpers/compiled-typescript.js';
import { runPython } from '../../codegen/test/projection/python-test-utils.js';

let project: Awaited<ReturnType<typeof createCuratedCodeListProject>>;
let graph: Awaited<ReturnType<typeof buildEffectiveProject>>;
beforeAll(async () => {
  project = await createCuratedCodeListProject();
  graph = await buildEffectiveProject(project.snapshot, project.references);
  expect(graph.diagnostics).toEqual([]);
});

it('links the published Rune enums and exposes their wire codes in the form without a resource copy', () => {
  const enums = graph.documents
    .filter((document) => document.uri.path.includes('/derived/code-lists/'))
    .flatMap((document) => (isRosettaModel(document.parseResult.value) ? document.parseResult.value.elements : []))
    .filter(isRosettaEnumeration);
  expect(enums.map((node) => node.name).sort()).toEqual(['CreditEventType', 'LoanLegalActionType', 'OptionType']);
  const option = enums.find((node) => node.name === 'OptionType')!;
  expect(option.enumValues).toHaveLength(10);
  expect(option.enumValues.map(getEnumValueLiteral)).toContain('Put');
  expect(project.snapshot.files.has('resources/option-type-1-0.json')).toBe(false);
  const [preview] = generatePreviewSchemas([...graph.documents], { targetId: 'example.codelists.CheckOptionType' });
  expect(preview?.fields[0]).toMatchObject({
    kind: 'enum',
    enumValues: expect.arrayContaining([
      { value: 'Call', label: 'Call' },
      { value: 'Put', label: 'Put' }
    ])
  });
});

it('reuses the curated synonym source when a project also materializes a local list', async () => {
  const draft = await createProjectDraftSnapshot(
    project.snapshot,
    new Map([
      ['model/local.rosetta', 'namespace example.local\ntypeAlias Basis: string\ntype Local:\n basis Basis (1..1)'],
      ['resources/basis.json', '{"ACT/360":"Actual / 360"}'],
      [
        'build-config.yml',
        JSON.stringify({
          ...project.snapshot.project.build,
          overrides: [
            {
              kind: 'resource',
              source: { model: 'local', id: 'example.local.Basis#RosettaTypeAlias' },
              path: 'resources/basis.json'
            }
          ]
        })
      ]
    ]),
    () => []
  );
  const linked = await buildEffectiveProject(draft, project.references);
  expect(linked.diagnostics).toEqual([]);
  const sources = linked.documents
    .flatMap((document) => (isRosettaModel(document.parseResult.value) ? document.parseResult.value.elements : []))
    .filter((node) => isRosettaSynonymSource(node) && node.name === 'CodeList');
  expect(sources).toHaveLength(1);
  const [preview] = generatePreviewSchemas([...linked.documents], { targetId: 'example.local.Local' });
  expect(preview?.fields[0]).toMatchObject({
    kind: 'enum',
    enumValues: [{ value: 'ACT/360', label: 'Actual / 360' }]
  });
});

it.each(['single-file', 'per-namespace', 'barrel'] as const)(
  'loads the pinned code lists in strict %s TypeScript and keeps the upstream validator',
  async (layout) => {
    const { outputs } = await generateSelected(
      [...graph.documents],
      {
        namespaces: [],
        declarations: [
          ...codeListDeclarations,
          { namespace: 'example.codelists', name: 'CheckOptionType', kind: 'RosettaFunction' }
        ]
      },
      { target: 'typescript', strict: true, typescript: { layout } }
    );
    expect(outputs.flatMap((output) => output.diagnostics)).toEqual([]);
    const caller = outputs.find((output) => output.funcs.some((fn) => fn.name === 'CheckOptionType'))!;
    const checkOptionType = caller.funcs.find((fn) => fn.name === 'CheckOptionType')!.exportName!;
    const projectFunctions = compileGeneratedTypeScript(outputs, {
      entry: caller.relativePath,
      assertions: `${checkOptionType}('Put');
// @ts-expect-error A code outside the published enum is invalid.
${checkOptionType}('Unknown');`
    });
    expect(projectFunctions[checkOptionType]!('Put')).toBe(true);
    const entry = outputs.find((output) => output.funcs.some((fn) => fn.name === 'LoadCodeList'))!;
    const functions =
      entry === caller
        ? projectFunctions
        : compileGeneratedTypeScript(outputs, { entry: entry.relativePath, checkTypes: false });
    for (const test of codeListCases) {
      const name = entry.funcs.find((fn) => fn.name === test.function)!.exportName!;
      const { domain, code } = test.inputs;
      const run = () => (code === undefined ? functions[name]!(domain) : functions[name]!(code, domain));
      if (test.expectedError) expect(run, test.id).toThrow(test.expectedError);
      else expect(JSON.parse(JSON.stringify(run())), test.id).toEqual(expectedCodeListResult(test));
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it('loads the same pinned code lists in standalone Python', () => {
  const python = generatePythonModule(graph.documents);
  expect(python.diagnostics).toEqual([]);
  const results = runPython(
    [
      ...codeListCases.map((test) => ({
        expression: `${python.bindings.get('cdm.base.staticdata.codelist.' + test.function)}(data)`,
        data: test.inputs
      })),
      { expression: `${python.bindings.get('example.codelists.CheckOptionType')}(data)`, data: { option: 'Put' } }
    ],
    python.code,
    { includeRuntime: false }
  );
  expect(results).toEqual([
    ...codeListCases.map((test) =>
      test.expectedError
        ? { error: expect.stringContaining(test.expectedError) }
        : { value: expectedCodeListResult(test) }
    ),
    { value: true }
  ]);
});
