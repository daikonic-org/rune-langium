// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { isRosettaEnumeration, isRosettaModel } from '@rune-langium/core';
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

let graph: Awaited<ReturnType<typeof buildEffectiveProject>>;
beforeAll(async () => {
  const project = await createCuratedCodeListProject();
  graph = await buildEffectiveProject(project.snapshot, project.references);
  expect(graph.diagnostics).toEqual([]);
});

it('materializes the selected resource as a Rune enum and uses its wire codes in the form', () => {
  const enums = graph.documents
    .filter((document) => document.uri.toString().startsWith('file:///project-resources/'))
    .flatMap((document) => (isRosettaModel(document.parseResult.value) ? document.parseResult.value.elements : []))
    .filter(isRosettaEnumeration);
  expect(enums).toHaveLength(1);
  expect(enums[0]!.enumValues).toHaveLength(10);
  const [preview] = generatePreviewSchemas([...graph.documents], { targetId: 'example.codelists.CheckOptionType' });
  expect(preview?.fields[0]).toMatchObject({
    kind: 'enum',
    enumValues: expect.arrayContaining([
      { value: 'Call', label: 'Call' },
      { value: 'Put', label: 'Put' }
    ])
  });
});

it.each(['single-file', 'per-namespace', 'barrel'] as const)(
  'loads the pinned code lists in strict %s TypeScript and keeps the upstream validator',
  async (layout) => {
    const { outputs } = await generateSelected(
      [...graph.documents],
      { namespaces: [], declarations: codeListDeclarations },
      { target: 'typescript', strict: true, typescript: { layout } }
    );
    expect(outputs.flatMap((output) => output.diagnostics)).toEqual([]);
    const entry = outputs.find((output) => output.funcs.some((fn) => fn.name === 'LoadCodeList'))!;
    const functions = compileGeneratedTypeScript(outputs, { entry: entry.relativePath });
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
    codeListCases.map((test) => ({
      expression: `${python.bindings.get('cdm.base.staticdata.codelist.' + test.function)}(data)`,
      data: test.inputs
    })),
    python.code,
    { includeRuntime: false }
  );
  expect(results).toEqual(
    codeListCases.map((test) =>
      test.expectedError
        ? { error: expect.stringContaining(test.expectedError) }
        : { value: expectedCodeListResult(test) }
    )
  );
});
